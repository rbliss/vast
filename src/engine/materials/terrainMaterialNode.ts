/**
 * TSL/NodeMaterial terrain material for WebGPU mode.
 * Uses Three Shading Language with Fn()-based node composition.
 *
 * Stage A: albedo + roughness + biome blend (no tri-planar normals yet).
 */

// @ts-nocheck — TSL types not fully typed in @types/three
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4,
  texture, uniform, mix, smoothstep, abs, pow,
  min, floor, fract, dot,
  positionWorld, positionLocal, normalWorld, normalLocal,
} from 'three/tsl';

import {
  CHUNK_SIZE, ROCK_WORLD_SIZE, GRASS_WORLD_SIZE, DIRT_WORLD_SIZE,
} from '../config';
import type { TextureSet, TerrainMaterials } from '../types';

// ── TSL helper functions (all inside Fn() for proper stack) ──

const biomeHashFn = Fn(([p_immutable]: [any]) => {
  const p = p_immutable.toVar();
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031)).toVar();
  const d = dot(p3, vec3(p3.y.add(33.33), p3.z.add(33.33), p3.x.add(33.33)));
  return fract(p3.x.add(p3.y).mul(p3.z).add(d));
});

const biomeNoiseFn = Fn(([p_immutable]: [any]) => {
  const p = p_immutable.toVar();
  const i = floor(p).toVar();
  const f = fract(p).toVar();
  const ff = f.mul(f).mul(float(3.0).sub(f.mul(2.0)));
  const a = biomeHashFn(i);
  const b = biomeHashFn(i.add(vec2(1.0, 0.0)));
  const c = biomeHashFn(i.add(vec2(0.0, 1.0)));
  const d = biomeHashFn(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, ff.x), mix(c, d, ff.x), ff.y);
});

const triplanarSampleFn = Fn(([tex, wPos, wNorm, scale]: [any, any, any, any]) => {
  const absN = abs(wNorm).toVar();
  const weights = pow(absN, vec3(4.0)).toVar();
  const wSum = weights.x.add(weights.y).add(weights.z).add(1e-6);
  const w = weights.div(wSum);

  const sX = texture(tex, wPos.zy.mul(scale));
  const sY = texture(tex, wPos.xz.mul(scale));
  const sZ = texture(tex, wPos.xy.mul(scale));

  return sX.mul(w.x).add(sY.mul(w.y)).add(sZ.mul(w.z));
});

export function createNodeTerrainMaterials(textures: TextureSet): TerrainMaterials {
  const rockScaleU = uniform(1.0 / ROCK_WORLD_SIZE);
  const grassScaleU = uniform(1.0 / GRASS_WORLD_SIZE);
  const dirtScaleU = uniform(1.0 / DIRT_WORLD_SIZE);

  function makeMat(useDisplacement: boolean) {
    const mat = new MeshStandardNodeMaterial();

    // ── Albedo: biome-blended ──
    mat.colorNode = Fn(() => {
      const wPos = positionWorld.toVar();
      const wNorm = normalWorld.toVar();

      // Biome weights
      const slope = float(1.0).sub(abs(wNorm.y));
      const bNoise = biomeNoiseFn(wPos.xz.mul(0.03));
      const heightBias = smoothstep(float(4.0), float(9.0), wPos.y).mul(0.3);
      const wRock = smoothstep(float(0.35), float(0.65), slope.add(heightBias)).toVar();
      const flatWeight = float(1.0).sub(wRock);
      const wGrass = flatWeight.mul(smoothstep(float(0.25), float(0.6), bNoise)).toVar();
      const wDirt = flatWeight.mul(float(1.0).sub(smoothstep(float(0.2), float(0.55), bNoise))).mul(0.6).toVar();
      const wSum = wRock.add(wGrass).add(wDirt).add(1e-6);
      const nRock = wRock.div(wSum);
      const nGrass = wGrass.div(wSum);
      const nDirt = wDirt.div(wSum);

      // Rock: tri-planar
      const rockCol = triplanarSampleFn(textures.rockDiff, wPos, wNorm, rockScaleU);
      // Grass + dirt: planar
      const grassCol = texture(textures.grassDiff, wPos.xz.mul(grassScaleU));
      const dirtCol = texture(textures.dirtDiff, wPos.xz.mul(dirtScaleU));

      return rockCol.mul(nRock).add(grassCol.mul(nGrass)).add(dirtCol.mul(nDirt));
    })();

    // ── Roughness: biome-blended ──
    mat.roughnessNode = Fn(() => {
      const wPos = positionWorld.toVar();
      const wNorm = normalWorld.toVar();

      const slope = float(1.0).sub(abs(wNorm.y));
      const bNoise = biomeNoiseFn(wPos.xz.mul(0.03));
      const heightBias = smoothstep(float(4.0), float(9.0), wPos.y).mul(0.3);
      const wRock = smoothstep(float(0.35), float(0.65), slope.add(heightBias)).toVar();
      const flatWeight = float(1.0).sub(wRock);
      const wGrass = flatWeight.mul(smoothstep(float(0.25), float(0.6), bNoise)).toVar();
      const wDirt = flatWeight.mul(float(1.0).sub(smoothstep(float(0.2), float(0.55), bNoise))).mul(0.6).toVar();
      const wSum = wRock.add(wGrass).add(wDirt).add(1e-6);
      const nRock = wRock.div(wSum);
      const nGrass = wGrass.div(wSum);
      const nDirt = wDirt.div(wSum);

      const rockRgh = triplanarSampleFn(textures.rockRough, wPos, wNorm, rockScaleU).g;
      const grassRgh = texture(textures.grassRough, wPos.xz.mul(grassScaleU)).g;
      const dirtRgh = texture(textures.dirtRough, wPos.xz.mul(dirtScaleU)).g;

      return rockRgh.mul(nRock).add(grassRgh.mul(nGrass)).add(dirtRgh.mul(nDirt));
    })();

    // ── Metalness: terrain is non-metallic ──
    mat.metalnessNode = float(0);

    // ── Displacement fade (Stage A: skip custom positionNode, use standard) ──
    if (useDisplacement) {
      mat.displacementMap = textures.rockDisp;
      mat.displacementScale = 0.25;
      mat.displacementBias = -0.1;
    }

    mat.envMapIntensity = 0.08;

    return mat;
  }

  return {
    matDisp: makeMat(true) as any,
    matNoDisp: makeMat(false) as any,
  };
}
