/**
 * Procedural foliage instancing system.
 * 3 layers: grass clumps, small rocks, bushes.
 * Deterministic placement from chunk coordinates.
 */

import * as THREE from 'three';
import type { Scene } from 'three';
import { CHUNK_SIZE, GRASS_PER_CHUNK, ROCK_PER_CHUNK, SHRUB_PER_CHUNK } from '../config';
import { terrainHeight, MACRO_HEIGHT_SCALE } from '../terrainHeight';
import type { FoliagePayload, FoliageSystem } from '../types';

function placeHash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

// ── Grass clump geometry: 2 crossed quads ──
function makeGrassGeo() {
  const g = new THREE.BufferGeometry();
  const hw = 0.3, hh = 0.5;
  const verts = new Float32Array([
    -hw,0,0, hw,0,0, hw,hh,0, -hw,hh,0,
    0,0,-hw, 0,0,hw, 0,hh,hw, 0,hh,-hw,
  ]);
  const idx = [0,1,2, 0,2,3, 4,5,6, 4,6,7];
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ── Rock geometry: squashed icosahedron ──
function makeRockGeo() {
  const g = new THREE.IcosahedronGeometry(0.3, 0);
  const pos = g.getAttribute('position');
  for (let i = 0; i < pos.count; i++) {
    pos.setY(i, pos.getY(i) * 0.5);
  }
  pos.needsUpdate = true;
  g.computeVertexNormals();
  return g;
}

// ── Shrub geometry: small sphere-ish cluster ──
function makeShrubGeo() {
  return new THREE.IcosahedronGeometry(0.25, 1);
}

/**
 * Create the foliage system bound to a scene.
 * Geometry and materials are created once (singletons within this closure).
 *
 * @param {THREE.Scene} scene - The scene to add instanced meshes to.
 * @returns {{ createInstances: () => object, rebuild: (foliage, cx, cz, isFar) => void }}
 */
export function createFoliageSystem(scene: Scene): FoliageSystem {
  // Singleton geometry + materials, created once per system
  const grassGeo = makeGrassGeo();
  const rockGeo  = makeRockGeo();
  const shrubGeo = makeShrubGeo();

  const grassMat = new THREE.MeshLambertMaterial({ color: 0x4a7a2e, side: THREE.DoubleSide });
  const rockMat  = new THREE.MeshStandardMaterial({ color: 0x8a8a7a, roughness: 0.9 });
  const shrubMat = new THREE.MeshLambertMaterial({ color: 0x3d6b2e });

  const _dummy = new THREE.Object3D();

  /** Create persistent InstancedMesh trio for a slot. Returns instance payload. */
  function createInstances(): FoliagePayload {
    const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_PER_CHUNK);
    const rock  = new THREE.InstancedMesh(rockGeo, rockMat, ROCK_PER_CHUNK);
    const shrub = new THREE.InstancedMesh(shrubGeo, shrubMat, SHRUB_PER_CHUNK);
    grass.frustumCulled = false;
    rock.frustumCulled = false;
    shrub.frustumCulled = false;
    scene.add(grass); scene.add(rock); scene.add(shrub);
    return { grass, rock, shrub };
  }

  /** Regenerate foliage transforms for a slot. Deterministic from (cx, cz). */
  function rebuild(foliage: FoliagePayload, cx: number, cz: number, isFar: boolean): void {
    if (isFar) {
      foliage.grass.count = 0;
      foliage.rock.count = 0;
      foliage.shrub.count = 0;
      return;
    }

    const originX = cx * CHUNK_SIZE;
    const originZ = cz * CHUNK_SIZE;
    const half = CHUNK_SIZE / 2;
    let gi = 0, ri = 0, si = 0;

    // Scatter points using deterministic grid + jitter
    const step = 1.6; // ~1.6m spacing for grass candidates
    const seed = cx * 7919 + cz * 104729;

    for (let lz = -half + 1; lz < half - 1; lz += step) {
      for (let lx = -half + 1; lx < half - 1; lx += step) {
        const wx = lx + originX, wz = lz + originZ;
        // Jitter
        const jx = (placeHash(wx * 13.7, wz * 29.3) - 0.5) * step * 0.8;
        const jz = (placeHash(wx * 41.1, wz * 7.9) - 0.5) * step * 0.8;
        const px = wx + jx, pz = wz + jz;

        const h = terrainHeight(px, pz) * MACRO_HEIGHT_SCALE;

        // Compute slope from finite differences
        const eps = 0.5;
        const hx = terrainHeight(px + eps, pz) * MACRO_HEIGHT_SCALE;
        const hz = terrainHeight(px, pz + eps) * MACRO_HEIGHT_SCALE;
        const fdx = (hx - h) / eps, fdz = (hz - h) / eps;
        const slope = Math.sqrt(fdx * fdx + fdz * fdz);
        const flatness = Math.max(0, 1 - slope * 1.5);

        // Biome noise (must match shader)
        const bn = placeHash(Math.floor(px * 0.03) + 0.5, Math.floor(pz * 0.03) + 0.5);

        // Placement probability from hash
        const prob = placeHash(px * 97.1 + seed, pz * 53.7 + seed);

        // ── Grass: high flatness, high grass weight ──
        const wGrass = flatness * Math.max(0, Math.min(1, (bn - 0.25) / 0.35));
        if (prob < wGrass * 0.5 && gi < GRASS_PER_CHUNK) {
          _dummy.position.set(px - originX, h, pz - originZ);
          const sc = 0.7 + placeHash(px * 3.1, pz * 5.7) * 0.8;
          _dummy.scale.set(sc, sc + placeHash(px * 11.3, pz * 2.1) * 0.5, sc);
          _dummy.rotation.y = placeHash(px * 7.7, pz * 13.3) * Math.PI * 2;
          _dummy.updateMatrix();
          foliage.grass.setMatrixAt(gi++, _dummy.matrix);
        }

        // ── Rock: steeper or rockier areas ──
        const wRock = Math.min(1, slope * 2);
        if (prob > 0.85 && wRock > 0.2 && ri < ROCK_PER_CHUNK) {
          _dummy.position.set(px - originX, h - 0.05, pz - originZ);
          const sc = 0.4 + placeHash(px * 17.3, pz * 23.1) * 1.2;
          _dummy.scale.set(sc, sc * 0.6, sc);
          _dummy.rotation.set(
            placeHash(px * 2.3, pz * 9.1) * 0.3,
            placeHash(px * 5.1, pz * 3.7) * Math.PI * 2,
            placeHash(px * 8.9, pz * 1.3) * 0.3
          );
          _dummy.updateMatrix();
          foliage.rock.setMatrixAt(ri++, _dummy.matrix);
        }

        // ── Shrub: transition zones (moderate grass) ──
        const wShrub = flatness * Math.max(0, 1 - Math.abs(bn - 0.45) * 4);
        if (prob > 0.7 && prob < 0.85 && wShrub > 0.2 && si < SHRUB_PER_CHUNK) {
          _dummy.position.set(px - originX, h, pz - originZ);
          const sc = 0.5 + placeHash(px * 19.7, pz * 31.3) * 0.7;
          _dummy.scale.set(sc, sc * 1.2, sc);
          _dummy.rotation.y = placeHash(px * 43.1, pz * 17.9) * Math.PI * 2;
          _dummy.updateMatrix();
          foliage.shrub.setMatrixAt(si++, _dummy.matrix);
        }
      }
    }

    foliage.grass.count = gi;
    foliage.rock.count = ri;
    foliage.shrub.count = si;
    foliage.grass.instanceMatrix.needsUpdate = true;
    foliage.rock.instanceMatrix.needsUpdate = true;
    foliage.shrub.instanceMatrix.needsUpdate = true;

    // Position instance meshes at chunk world origin
    foliage.grass.position.set(originX, 0, originZ);
    foliage.rock.position.set(originX, 0, originZ);
    foliage.shrub.position.set(originX, 0, originZ);
  }

  return { createInstances, rebuild };
}
