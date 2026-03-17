/**
 * Procedural foliage instancing system.
 * Phase C: field-aware scatter driven by slope, altitude, deposition.
 *
 * 3 layers: grass clumps, rocks/debris, shrubs.
 * Placement respects terrain analysis fields:
 *   - no vegetation above snow line
 *   - more rocks on steep slopes and at high altitude
 *   - grass on stable mid-altitude flats
 *   - debris in depositional zones (fans, channel exits)
 *   - shrubs in transition zones
 */

import * as THREE from 'three';
import type { Scene } from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { CHUNK_SIZE, GRASS_PER_CHUNK, ROCK_PER_CHUNK, SHRUB_PER_CHUNK } from '../config';
import type { TerrainSource } from '../terrain/terrainSource';
import type { FieldTextures } from '../terrain/fieldTextures';
import type { FoliagePayload, FoliageSystem } from '../types';
import { makeRockVariants } from './rockGeometry';

export interface ScatterParams {
  grassDensity: number;
  shrubDensity: number;
  rockDensity: number;
  alpineCutoff: number;
  debrisEmphasis: number;
}

export const DEFAULT_SCATTER_PARAMS: ScatterParams = {
  grassDensity: 1.0,
  shrubDensity: 1.0,
  rockDensity: 1.0,
  alpineCutoff: 0.78,
  debrisEmphasis: 1.0,
};

function placeHash(x: number, y: number): number {
  let h = x * 374761393 + y * 668265263;
  h = (h ^ (h >> 13)) * 1274126177;
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

// ── Grass clump geometry: 3 crossed quads for fuller appearance ──
function makeGrassGeo() {
  const g = new THREE.BufferGeometry();
  const hw = 0.25, hh = 0.55;
  const verts = new Float32Array([
    // Quad 1
    -hw,0,0, hw,0,0, hw,hh,0, -hw,hh,0,
    // Quad 2 (rotated 60°)
    -hw*0.5,0,-hw*0.866, hw*0.5,0,hw*0.866, hw*0.5,hh,hw*0.866, -hw*0.5,hh,-hw*0.866,
    // Quad 3 (rotated 120°)
    -hw*0.5,0,hw*0.866, hw*0.5,0,-hw*0.866, hw*0.5,hh,-hw*0.866, -hw*0.5,hh,hw*0.866,
  ]);
  const idx = [0,1,2, 0,2,3, 4,5,6, 4,6,7, 8,9,10, 8,10,11];
  g.setAttribute('position', new THREE.BufferAttribute(verts, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

// ── Shrub geometry: cluster of small spheres ──
function makeShrubGeo() {
  // Multi-sphere cluster for fuller shrub look
  const spheres: THREE.BufferGeometry[] = [];
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const r = 0.12 + i * 0.02;
    const sphere = new THREE.IcosahedronGeometry(r, 1);
    const pos = sphere.getAttribute('position');
    const ox = Math.cos(angle) * 0.06;
    const oz = Math.sin(angle) * 0.06;
    for (let j = 0; j < pos.count; j++) {
      pos.setXYZ(j, pos.getX(j) + ox, pos.getY(j) + i * 0.04, pos.getZ(j) + oz);
    }
    spheres.push(sphere);
  }
  const merged = mergeGeometries(spheres);
  if (merged) {
    merged.computeVertexNormals();
    return merged;
  }
  return new THREE.IcosahedronGeometry(0.25, 1);
}

export function createFoliageSystem(scene: Scene, envIntensity = 0.08): FoliageSystem {
  const grassGeo = makeGrassGeo();
  const rockVariants = makeRockVariants(4);
  const shrubGeo = makeShrubGeo();

  const grassMat = new THREE.MeshLambertMaterial({ color: 0x4a7a2e, side: THREE.DoubleSide });
  // Varied rock materials for visual variety
  const rockMats = [
    new THREE.MeshStandardMaterial({ color: 0x7a7a6e, roughness: 0.92, envMapIntensity: envIntensity }),
    new THREE.MeshStandardMaterial({ color: 0x8a8878, roughness: 0.88, envMapIntensity: envIntensity }),
    new THREE.MeshStandardMaterial({ color: 0x6e6e64, roughness: 0.95, envMapIntensity: envIntensity }),
    new THREE.MeshStandardMaterial({ color: 0x9a9082, roughness: 0.85, envMapIntensity: envIntensity }),
  ];
  const shrubMat = new THREE.MeshLambertMaterial({ color: 0x3d6b2e });

  const _dummy = new THREE.Object3D();

  let rockVariantIdx = 0;

  function createInstances(): FoliagePayload {
    // Cycle through rock variants for per-chunk variety
    const vi = rockVariantIdx % rockVariants.length;
    rockVariantIdx++;
    const grass = new THREE.InstancedMesh(grassGeo, grassMat, GRASS_PER_CHUNK);
    const rock  = new THREE.InstancedMesh(rockVariants[vi], rockMats[vi], ROCK_PER_CHUNK);
    const shrub = new THREE.InstancedMesh(shrubGeo, shrubMat, SHRUB_PER_CHUNK);
    grass.frustumCulled = false;
    rock.frustumCulled = false;
    shrub.frustumCulled = false;
    scene.add(grass); scene.add(rock); scene.add(shrub);
    return { grass, rock, shrub };
  }

  function rebuild(
    foliage: FoliagePayload,
    cx: number, cz: number,
    isFar: boolean,
    terrain: TerrainSource,
    fields?: FieldTextures | null,
    scatter?: ScatterParams,
  ): void {
    const sp = scatter ?? DEFAULT_SCATTER_PARAMS;
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

    // Tighter scatter step for more candidates (1.3 vs 1.6)
    const step = 1.3;
    const seed = cx * 7919 + cz * 104729;

    for (let lz = -half + 1; lz < half - 1; lz += step) {
      for (let lx = -half + 1; lx < half - 1; lx += step) {
        const wx = lx + originX, wz = lz + originZ;
        const jx = (placeHash(wx * 13.7, wz * 29.3) - 0.5) * step * 0.8;
        const jz = (placeHash(wx * 41.1, wz * 7.9) - 0.5) * step * 0.8;
        const px = wx + jx, pz = wz + jz;

        const h = terrain.sampleHeight(px, pz);

        // Compute slope from finite differences
        const eps = 0.5;
        const hx = terrain.sampleHeight(px + eps, pz);
        const hz = terrain.sampleHeight(px, pz + eps);
        const fdx = (hx - h) / eps, fdz = (hz - h) / eps;
        const slope = Math.sqrt(fdx * fdx + fdz * fdz);
        const flatness = Math.max(0, 1 - slope * 1.5);

        // Field-aware data
        let altitude = 0.5; // default mid-altitude
        let deposition = 0;
        if (fields) {
          const f = fields.sampleAt(px, pz);
          altitude = f.altitude;
          deposition = f.deposition;
        }

        // Snow line: no vegetation above alpine cutoff
        const snowMask = Math.max(0, 1 - Math.max(0, (altitude - (sp.alpineCutoff - 0.06)) / 0.12));

        // Biome noise
        const bn = placeHash(Math.floor(px * 0.03) + 0.5, Math.floor(pz * 0.03) + 0.5);
        const prob = placeHash(px * 97.1 + seed, pz * 53.7 + seed);

        // ── Grass: flat, mid altitude, below snow, not in heavy deposition ──
        const grassAlt = Math.max(0, Math.min(1, (altitude - 0.1) / 0.2))
                       * Math.max(0, Math.min(1, (0.7 - altitude) / 0.15));
        const depositionDamp = Math.max(0.2, 1 - deposition * 3);
        const wGrass = flatness * Math.max(0, Math.min(1, (bn - 0.25) / 0.35))
                     * snowMask * (fields ? grassAlt : 1) * depositionDamp;
        if (prob < wGrass * 0.6 * sp.grassDensity && gi < GRASS_PER_CHUNK) {
          _dummy.position.set(px - originX, h, pz - originZ);
          const sc = 0.8 + placeHash(px * 3.1, pz * 5.7) * 0.9;
          _dummy.scale.set(sc, sc + placeHash(px * 11.3, pz * 2.1) * 0.5, sc);
          _dummy.rotation.y = placeHash(px * 7.7, pz * 13.3) * Math.PI * 2;
          _dummy.updateMatrix();
          foliage.grass.setMatrixAt(gi++, _dummy.matrix);
        }

        // ── Rock: steep slopes, high altitude, or depositional debris zones ──
        const wRockSlope = Math.min(1, slope * 2);
        const wRockAlt = fields ? Math.max(0, (altitude - 0.5) * 1.5) : 0;
        const wRockDeposition = deposition * 3 * sp.debrisEmphasis;
        const wRock = Math.min(1, wRockSlope + wRockAlt * 0.3 + wRockDeposition * 0.5);
        const rockThreshold = 0.75 - deposition * 0.3 * sp.debrisEmphasis;
        if (prob > rockThreshold && wRock > 0.15 && ri < ROCK_PER_CHUNK && sp.rockDensity > 0) {
          _dummy.position.set(px - originX, h - 0.05, pz - originZ);
          // Larger rocks overall, even bigger in depositional zones
          const depScale = 1 + deposition * 2.5;
          const baseScale = 0.5 + placeHash(px * 17.3, pz * 23.1) * 1.5;
          const sc = baseScale * depScale;
          _dummy.scale.set(sc, sc * 0.55, sc);
          _dummy.rotation.set(
            placeHash(px * 2.3, pz * 9.1) * 0.3,
            placeHash(px * 5.1, pz * 3.7) * Math.PI * 2,
            placeHash(px * 8.9, pz * 1.3) * 0.3
          );
          _dummy.updateMatrix();
          foliage.rock.setMatrixAt(ri++, _dummy.matrix);
        }

        // ── Shrub: transition zones, below snow, low deposition ──
        const wShrub = flatness * Math.max(0, 1 - Math.abs(bn - 0.45) * 4)
                      * snowMask * depositionDamp;
        if (prob > (0.85 - 0.15 * sp.shrubDensity) && prob < 0.85 && wShrub > 0.2 && si < SHRUB_PER_CHUNK) {
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

    foliage.grass.position.set(originX, 0, originZ);
    foliage.rock.position.set(originX, 0, originZ);
    foliage.shrub.position.set(originX, 0, originZ);
  }

  return { createInstances, rebuild };
}
