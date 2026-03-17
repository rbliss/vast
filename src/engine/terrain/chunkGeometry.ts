/**
 * Chunk geometry creation, normals, LOD stitching, and per-frame rebuild.
 *
 * Exports:
 *   createChunkSlot(lod, dx, dz, scene, matDisp, matNoDisp)
 *   computeGridNormals(geo, gridVertCount)
 *   stitchEdge(pos, edgeVerts, ratio)
 *   lodForRingPos(dx, dz)
 *   rebuildChunkSlot(slot, centerCX, centerCZ)
 */

import * as THREE from 'three';
import type { Scene, MeshStandardMaterial, BufferGeometry, BufferAttribute as BA } from 'three';
import {
  CHUNK_SIZE, SKIRT_DEPTH, SKIRT_INSET, TEXTURE_WORLD_SIZE,
  LOD_NEAR, LOD_MID, LOD_FAR, LOD_ULTRA_FAR, LOD_HORIZON,
} from '../config';
import type { LodLevel } from '../config';
import type { ChunkSlot, FoliagePayload } from '../types';
import { terrainHeight, MACRO_HEIGHT_SCALE } from '../terrainHeight';

/** One-time slot creation: allocates geometry, topology, mesh. Never freed. */
export function createChunkSlot(
  lod: LodLevel, dx: number, dz: number,
  scene: Scene, matDisp: MeshStandardMaterial, matNoDisp: MeshStandardMaterial,
  foliage: FoliagePayload,
): ChunkSlot {
  const seg = lod.segments;
  const gridW = seg + 1;
  const gridVertCount = gridW * gridW;

  // Build base plane for local X/Z coords
  const tmpGeo = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, seg, seg);
  tmpGeo.rotateX(-Math.PI / 2);
  const tmpPos = tmpGeo.getAttribute('position');
  const tmpIdx = tmpGeo.getIndex();

  // Compute edge indices (4 edges, named for stitching + skirts)
  // -Z edge (row 0, left->right)
  const edgeMinZ = []; for (let c = 0; c < gridW; c++) edgeMinZ.push(c);
  // +X edge (last col, top->bottom)
  const edgePlusX = []; for (let r = 0; r < gridW; r++) edgePlusX.push(r * gridW + gridW - 1);
  // +Z edge (last row, right->left)
  const edgePlusZ = []; for (let c = gridW - 1; c >= 0; c--) edgePlusZ.push((gridW - 1) * gridW + c);
  // -X edge (first col, bottom->top)
  const edgeMinX = []; for (let r = gridW - 1; r >= 0; r--) edgeMinX.push(r * gridW);
  const edges = [edgeMinZ, edgePlusX, edgePlusZ, edgeMinX];

  // Flatten edge indices -> skirt vertex mapping
  const edgeIndices = [];
  for (const e of edges) edgeIndices.push(...e);
  const skirtVertCount = edgeIndices.length;
  const totalVertCount = gridVertCount + skirtVertCount;

  // Allocate permanent arrays
  const posArr  = new Float32Array(totalVertCount * 3);
  const uvArr   = new Float32Array(totalVertCount * 2);
  const normArr = new Float32Array(totalVertCount * 3);
  const uv2Arr  = new Float32Array(totalVertCount * 2);

  // Write fixed local X/Z for grid vertices
  for (let i = 0; i < gridVertCount; i++) {
    posArr[i * 3]     = tmpPos.getX(i);
    posArr[i * 3 + 1] = 0;
    posArr[i * 3 + 2] = tmpPos.getZ(i);
  }

  // Write fixed local X/Z for skirt vertices (inward-nudged)
  for (let i = 0; i < skirtVertCount; i++) {
    const ei = edgeIndices[i];
    const ex = tmpPos.getX(ei), ez = tmpPos.getZ(ei);
    const ndx = -ex, ndz = -ez; // toward center (0,0)
    const len = Math.sqrt(ndx * ndx + ndz * ndz) || 1;
    const ni = gridVertCount + i;
    posArr[ni * 3]     = ex + (ndx / len) * SKIRT_INSET;
    posArr[ni * 3 + 1] = 0;
    posArr[ni * 3 + 2] = ez + (ndz / len) * SKIRT_INSET;
  }

  // Build permanent index buffer: grid triangles + skirt quads
  let skirtTriCount = 0;
  for (const e of edges) skirtTriCount += (e.length - 1) * 2;
  const oldIdxArr = tmpIdx!.array;
  const idxArr = new Uint32Array(oldIdxArr.length + skirtTriCount * 3);
  idxArr.set(oldIdxArr);

  let idxPtr = oldIdxArr.length;
  let skirtBase = gridVertCount;
  for (const edge of edges) {
    for (let i = 0; i < edge.length - 1; i++) {
      const a = edge[i], b = edge[i + 1];
      const c = skirtBase + i + 1, d = skirtBase + i;
      idxArr[idxPtr++] = a; idxArr[idxPtr++] = d; idxArr[idxPtr++] = c;
      idxArr[idxPtr++] = a; idxArr[idxPtr++] = c; idxArr[idxPtr++] = b;
    }
    skirtBase += edge.length;
  }

  // Create permanent geometry with typed attribute refs
  const geo = new THREE.BufferGeometry();
  const posAttr = new THREE.BufferAttribute(posArr, 3);
  const uvAttr  = new THREE.BufferAttribute(uvArr, 2);
  const normAttr = new THREE.BufferAttribute(normArr, 3);
  const uv2Attr = new THREE.BufferAttribute(uv2Arr, 2);
  const idxAttr = new THREE.BufferAttribute(idxArr, 1);
  geo.setAttribute('position', posAttr);
  geo.setAttribute('uv', uvAttr);
  geo.setAttribute('normal', normAttr);
  geo.setAttribute('uv2', uv2Attr);
  geo.setIndex(idxAttr);

  const mat = lod.displacement ? matDisp : matNoDisp;
  const mesh = new THREE.Mesh(geo, mat);
  scene.add(mesh);

  tmpGeo.dispose();

  const attrs = { position: posAttr, uv: uvAttr, uv2: uv2Attr, normal: normAttr, index: idxAttr };

  return {
    dx, dz, lod, mesh, geo, attrs,
    gridW, gridVertCount, skirtVertCount, totalVertCount,
    edgeIndices,
    edgeMinZ, edgePlusZ, edgeMinX, edgePlusX,
    cx: Infinity, cz: Infinity,
    foliage,
  };
}

/** Compute vertex normals for grid vertices only, ignoring skirt faces. */
export function computeGridNormals(slot: ChunkSlot): void {
  const { position: pos, normal: norm, index } = slot.attrs;
  const gridVertCount = slot.gridVertCount;
  const idxArr = index.array;

  // Zero grid normals
  for (let i = 0; i < gridVertCount * 3; i++) norm.array[i] = 0;

  // Accumulate face normals — skip any face touching a skirt vertex
  for (let f = 0; f < idxArr.length; f += 3) {
    const a = idxArr[f], b = idxArr[f + 1], c = idxArr[f + 2];
    if (a >= gridVertCount || b >= gridVertCount || c >= gridVertCount) continue;

    const ax = pos.getX(a), ay = pos.getY(a), az = pos.getZ(a);
    const e1x = pos.getX(b) - ax, e1y = pos.getY(b) - ay, e1z = pos.getZ(b) - az;
    const e2x = pos.getX(c) - ax, e2y = pos.getY(c) - ay, e2z = pos.getZ(c) - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;

    const na = norm.array;
    na[a*3] += nx; na[a*3+1] += ny; na[a*3+2] += nz;
    na[b*3] += nx; na[b*3+1] += ny; na[b*3+2] += nz;
    na[c*3] += nx; na[c*3+1] += ny; na[c*3+2] += nz;
  }

  // Normalize grid, set skirt normals to (0,-1,0)
  const na = norm.array;
  for (let i = 0; i < gridVertCount; i++) {
    const x = na[i*3], y = na[i*3+1], z = na[i*3+2];
    const len = Math.sqrt(x*x + y*y + z*z) || 1;
    na[i*3] = x/len; na[i*3+1] = y/len; na[i*3+2] = z/len;
  }
  for (let i = gridVertCount; i < pos.count; i++) {
    na[i*3] = 0; na[i*3+1] = -1; na[i*3+2] = 0;
  }
  norm.needsUpdate = true;
}

/** Constrain high-res edge vertices to match lower-res neighbor interpolation. */
export function stitchEdge(pos: THREE.BufferAttribute, edgeVerts: number[], ratio: number): void {
  for (let i = 0; i < edgeVerts.length; i++) {
    if (i % ratio !== 0) {
      const prev = Math.floor(i / ratio) * ratio;
      const next = Math.min(prev + ratio, edgeVerts.length - 1);
      const t = (i - prev) / (next - prev);
      const y = pos.getY(edgeVerts[prev]) * (1 - t) + pos.getY(edgeVerts[next]) * t;
      pos.setY(edgeVerts[i], y);
    }
  }
}

/** Get LOD for a ring position. d=0 near, d=1 mid, d=2 far, d=3 ultra-far, d>=4 horizon. */
export function lodForRingPos(dx: number, dz: number): LodLevel {
  const d = Math.max(Math.abs(dx), Math.abs(dz));
  if (d === 0) return LOD_NEAR;
  if (d === 1) return LOD_MID;
  if (d === 2) return LOD_FAR;
  if (d === 3) return LOD_ULTRA_FAR;
  return LOD_HORIZON;
}

/** Mutate existing buffers in-place. Zero allocation. */
export function rebuildChunkSlot(slot: ChunkSlot, centerCX: number, centerCZ: number): boolean {
  const cx = centerCX + slot.dx;
  const cz = centerCZ + slot.dz;
  if (cx === slot.cx && cz === slot.cz) return false;
  slot.cx = cx;
  slot.cz = cz;

  const originX = cx * CHUNK_SIZE;
  const originZ = cz * CHUNK_SIZE;

  const { position: pos, uv, uv2 } = slot.attrs;

  // Update grid vertices: Y from heightfield, UVs from world pos
  for (let i = 0; i < slot.gridVertCount; i++) {
    const lx = pos.getX(i), lz = pos.getZ(i);
    const wx = lx + originX, wz = lz + originZ;
    pos.setY(i, terrainHeight(wx, wz) * MACRO_HEIGHT_SCALE);
    const u = wx / TEXTURE_WORLD_SIZE, v = wz / TEXTURE_WORLD_SIZE;
    uv.setXY(i, u, v);
    uv2.setXY(i, u, v);
  }

  // LOD edge stitching: constrain border vertices where neighbor is lower-res
  const mySegs = slot.lod.segments;
  const stitchDirs = [
    { ddx:  0, ddz: -1, edge: slot.edgeMinZ  },
    { ddx:  0, ddz:  1, edge: slot.edgePlusZ  },
    { ddx: -1, ddz:  0, edge: slot.edgeMinX   },
    { ddx:  1, ddz:  0, edge: slot.edgePlusX  },
  ];
  for (const s of stitchDirs) {
    const nSegs = lodForRingPos(slot.dx + s.ddx, slot.dz + s.ddz).segments;
    if (nSegs < mySegs) {
      stitchEdge(pos, s.edge, mySegs / nSegs);
    }
  }

  // Update skirt vertices: Y = edge Y - depth, UV = edge UV
  for (let i = 0; i < slot.skirtVertCount; i++) {
    const ei = slot.edgeIndices[i];
    const ni = slot.gridVertCount + i;
    pos.setY(ni, pos.getY(ei) - SKIRT_DEPTH);
    uv.setXY(ni, uv.getX(ei), uv.getY(ei));
    uv2.setXY(ni, uv.getX(ei), uv.getY(ei));
  }

  pos.needsUpdate = true;
  uv.needsUpdate = true;
  uv2.needsUpdate = true;

  // Compute normals for grid only — skirt faces excluded
  computeGridNormals(slot);

  slot.mesh.position.set(originX, 0, originZ);
  slot.geo.computeBoundingSphere();
  return true;
}
