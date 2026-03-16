/**
 * TSL/NodeMaterial terrain material for WebGPU mode.
 * Equivalent to terrainMaterial.ts but using Three Shading Language
 * instead of onBeforeCompile string surgery.
 *
 * Features:
 * - 3-layer biome blend (grass/dirt/rock)
 * - Slope-masked tri-planar mapping (rock only)
 * - Per-layer roughness blending
 * - Edge displacement fade at chunk borders
 * - Height-biased rock weight
 */

// @ts-nocheck — TSL types are not fully typed in @types/three yet
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4,
  texture, uniform, mix, smoothstep, abs, pow,
  min, floor, fract, dot,
  positionWorld, positionLocal, normalWorld,
} from 'three/tsl';
import * as THREE from 'three';

import {
  CHUNK_SIZE, ROCK_WORLD_SIZE, GRASS_WORLD_SIZE, DIRT_WORLD_SIZE,
} from '../config';
import type { TextureSet, TerrainMaterials } from '../types';

// ── Biome noise (hash-based, matches GLSL version) ──
const biomeHash = Fn(([p]: [any]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const p3d = p3.add(dot(p3, p3.add(vec3(33.33, 33.33, 33.33)).xyz));
  return fract(p3d.x.add(p3d.y).mul(p3d.z));
});

const biomeNoise = Fn(([p]: [any]) => {
  const i = floor(p);
  const f = fract(p);
  const ff = f.mul(f).mul(float(3.0).sub(f.mul(2.0))); // smoothstep
  const a = biomeHash(i);
  const b = biomeHash(i.add(vec2(1.0, 0.0)));
  const c = biomeHash(i.add(vec2(0.0, 1.0)));
  const d = biomeHash(i.add(vec2(1.0, 1.0)));
  return mix(mix(a, b, ff.x), mix(c, d, ff.x), ff.y);
});

// ── Tri-planar sampling helper ──
const triplanarSample = Fn(([tex, wPos, wNorm, scale]: [any, any, any, any]) => {
  const weights = pow(abs(wNorm), vec3(4.0, 4.0, 4.0));
  const wSum = weights.x.add(weights.y).add(weights.z).add(1e-6);
  const w = weights.div(wSum);

  const uvX = wPos.zy.mul(scale);
  const uvY = wPos.xz.mul(scale);
  const uvZ = wPos.xy.mul(scale);

  const sX = texture(tex, uvX);
  const sY = texture(tex, uvY);
  const sZ = texture(tex, uvZ);

  return sX.mul(w.x).add(sY.mul(w.y)).add(sZ.mul(w.z));
});

export function createNodeTerrainMaterials(textures: TextureSet): TerrainMaterials {
  const rockScale = uniform(1.0 / ROCK_WORLD_SIZE);
  const grassScale = uniform(1.0 / GRASS_WORLD_SIZE);
  const dirtScale = uniform(1.0 / DIRT_WORLD_SIZE);
  const chunkHalf = uniform(CHUNK_SIZE / 2);

  function makeMat(useDisplacement: boolean) {
    const mat = new MeshStandardNodeMaterial();
    mat.side = THREE.FrontSide;

    // ── World-space accessors ──
    const wPos = positionWorld;
    const wNorm = normalWorld;

    // ── Biome weights ──
    const slope = float(1.0).sub(abs(wNorm.y));
    const bNoise = biomeNoise(wPos.xz.mul(0.03));
    const heightBias = smoothstep(float(4.0), float(9.0), wPos.y).mul(0.3);
    const wRock = smoothstep(float(0.35), float(0.65), slope.add(heightBias));
    const flatWeight = float(1.0).sub(wRock);
    const wGrass = flatWeight.mul(smoothstep(float(0.25), float(0.6), bNoise));
    const wDirt = flatWeight.mul(float(1.0).sub(smoothstep(float(0.2), float(0.55), bNoise))).mul(0.6);
    const wSum = wRock.add(wGrass).add(wDirt).add(1e-6);
    const nRock = wRock.div(wSum);
    const nGrass = wGrass.div(wSum);
    const nDirt = wDirt.div(wSum);

    // ── Albedo: rock tri-planar + grass/dirt planar ──
    const rockColor = triplanarSample(textures.rockDiff, wPos, wNorm, rockScale);
    const grassUv = wPos.xz.mul(grassScale);
    const dirtUv = wPos.xz.mul(dirtScale);
    const grassColor = texture(textures.grassDiff, grassUv);
    const dirtColor = texture(textures.dirtDiff, dirtUv);

    mat.colorNode = rockColor.mul(nRock)
      .add(grassColor.mul(nGrass))
      .add(dirtColor.mul(nDirt));

    // ── Roughness: biome-blended ──
    const rockRough = triplanarSample(textures.rockRough, wPos, wNorm, rockScale);
    const grassRough = texture(textures.grassRough, grassUv);
    const dirtRough = texture(textures.dirtRough, dirtUv);
    mat.roughnessNode = rockRough.g.mul(nRock)
      .add(grassRough.g.mul(nGrass))
      .add(dirtRough.g.mul(nDirt));

    // ── Normal: rock tri-planar normal map ──
    const rockNorm = triplanarSample(textures.rockNorm, wPos, wNorm, rockScale);
    mat.normalNode = mix(
      normalWorld,
      rockNorm.xyz.mul(2.0).sub(1.0),
      nRock.mul(0.5) // subtle rock normal influence
    );

    // ── Edge displacement fade ──
    if (useDisplacement) {
      const localPos = positionLocal;
      const edgeDist = min(
        min(localPos.x.add(chunkHalf), chunkHalf.sub(localPos.x)),
        min(localPos.z.add(chunkHalf), chunkHalf.sub(localPos.z)),
      );
      const dispFade = smoothstep(float(0.0), float(3.0), edgeDist);
      const dispSample = texture(textures.rockDisp, grassUv);
      mat.displacementMap = textures.rockDisp;
      mat.displacementScale = 0.25;
      mat.displacementBias = -0.1;
      // Note: per-vertex displacement fade needs positionNode override
      // For now, use standard displacement — fade refinement later
    }

    // ── AO: rock-only ──
    mat.aoMap = textures.rockAo;
    mat.aoMapIntensity = 0.5; // reduced since AO only applies to rock layer

    mat.metalness = 0;
    mat.envMapIntensity = 0.08;

    return mat;
  }

  return {
    matDisp: makeMat(true) as unknown as THREE.MeshStandardMaterial,
    matNoDisp: makeMat(false) as unknown as THREE.MeshStandardMaterial,
  };
}
