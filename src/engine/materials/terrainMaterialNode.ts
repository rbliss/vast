/**
 * TSL/NodeMaterial terrain material for WebGPU mode.
 * Stage B: albedo + roughness + biome blend + displacement fade
 *          + rock tri-planar normals + biome AO
 */

// @ts-nocheck — TSL types not fully typed in @types/three
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4,
  texture, uniform, mix, smoothstep, abs, pow, normalize,
  min, floor, fract, dot, sign,
  positionWorld, positionLocal, normalWorld, normalLocal,
  normalView, cameraViewMatrix,
} from 'three/tsl';

import { CHUNK_SIZE, ROCK_WORLD_SIZE, GRASS_WORLD_SIZE, DIRT_WORLD_SIZE } from '../config';
import type { TextureSet, TerrainMaterials } from '../types';
import {
  ROCK_SLOPE_MIN, ROCK_SLOPE_MAX, ROCK_HEIGHT_MIN, ROCK_HEIGHT_MAX,
  ROCK_HEIGHT_BIAS_STRENGTH, BIOME_NOISE_FREQUENCY,
  GRASS_NOISE_MIN, GRASS_NOISE_MAX, DIRT_NOISE_MIN, DIRT_NOISE_MAX,
  DIRT_WEIGHT_SCALE, TRIPLANAR_SHARPNESS,
  DISPLACEMENT_SCALE, DISPLACEMENT_BIAS, DISPLACEMENT_FADE_DISTANCE,
  ROCK_NORMAL_SCALE, GRASS_NORMAL_SCALE, DIRT_NORMAL_SCALE,
  TERRAIN_ENV_MAP_INTENSITY,
} from './terrain/featureModel';

// ── Pure expression helpers ──

const biomeHash = Fn(([p]: [any]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(0.1031));
  const d = dot(p3, p3.yzx.add(33.33));
  return fract(p3.x.add(p3.y).mul(p3.z).add(d));
});

const biomeNoise = Fn(([p]: [any]) => {
  const i = floor(p);
  const f = fract(p);
  const ff = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = biomeHash(i);
  const b = biomeHash(i.add(vec2(1, 0)));
  const c = biomeHash(i.add(vec2(0, 1)));
  const d = biomeHash(i.add(vec2(1, 1)));
  return mix(mix(a, b, ff.x), mix(c, d, ff.x), ff.y);
});

const triSample = Fn(([tex, wPos, wNorm, scale]: [any, any, any, any]) => {
  const w = pow(abs(wNorm), vec3(TRIPLANAR_SHARPNESS));
  const ws = w.div(w.x.add(w.y).add(w.z).add(1e-6));
  return texture(tex, wPos.zy.mul(scale)).mul(ws.x)
    .add(texture(tex, wPos.xz.mul(scale)).mul(ws.y))
    .add(texture(tex, wPos.xy.mul(scale)).mul(ws.z));
});

// Shared biome weight computation — returns vec3(rock, grass, dirt) normalized
const biomeWeights = Fn(([wPos, wNorm]: [any, any]) => {
  const slope = float(1).sub(abs(wNorm.y));
  const bn = biomeNoise(wPos.xz.mul(BIOME_NOISE_FREQUENCY));
  const hBias = smoothstep(float(ROCK_HEIGHT_MIN), float(ROCK_HEIGHT_MAX), wPos.y).mul(ROCK_HEIGHT_BIAS_STRENGTH);
  const rock = smoothstep(float(ROCK_SLOPE_MIN), float(ROCK_SLOPE_MAX), slope.add(hBias));
  const flat_ = float(1).sub(rock);
  const grass = flat_.mul(smoothstep(float(GRASS_NOISE_MIN), float(GRASS_NOISE_MAX), bn));
  const dirt = flat_.mul(float(1).sub(smoothstep(float(DIRT_NOISE_MIN), float(DIRT_NOISE_MAX), bn))).mul(DIRT_WEIGHT_SCALE);
  const sum = rock.add(grass).add(dirt).add(1e-6);
  return vec3(rock.div(sum), grass.div(sum), dirt.div(sum));
});

// Rock tri-planar normal with Whiteout blending (Golus method)
// Matches WebGL path: normal scale + axis-sign correction + world-space output
const triplanarRockNormal = Fn(([tex, wPos, wNorm, scale]: [any, any, any, any]) => {
  const axisSign = sign(wNorm);
  const w = pow(abs(wNorm), vec3(TRIPLANAR_SHARPNESS));
  const ws = w.div(w.x.add(w.y).add(w.z).add(1e-6));
  const ns = float(ROCK_NORMAL_SCALE);

  // Sample normal maps on each axis
  const tnX = texture(tex, wPos.zy.mul(scale)).xyz.mul(2).sub(1);
  const tnY = texture(tex, wPos.xz.mul(scale)).xyz.mul(2).sub(1);
  const tnZ = texture(tex, wPos.xy.mul(scale)).xyz.mul(2).sub(1);

  // Apply normal scale to XY + axis-sign correction (matching WebGL path)
  const tnXc = vec3(tnX.x.mul(ns).mul(axisSign.x), tnX.y.mul(ns), tnX.z);
  const tnYc = vec3(tnY.x.mul(ns).mul(axisSign.y), tnY.y.mul(ns), tnY.z);
  const tnZc = vec3(tnZ.x.mul(ns).mul(axisSign.z).negate(), tnZ.y.mul(ns), tnZ.z);

  // Whiteout blending: swizzle world normal into tangent frame
  const blendX = vec3(tnXc.xy.add(wNorm.zy), abs(wNorm.x));
  const blendY = vec3(tnYc.xy.add(wNorm.xz), abs(wNorm.y));
  const blendZ = vec3(tnZc.xy.add(wNorm.xy), abs(wNorm.z));

  // Swizzle back to world space and blend
  return normalize(
    blendX.zyx.mul(ws.x)
      .add(blendY.xzy.mul(ws.y))
      .add(blendZ.mul(ws.z))
  );
});

export function createNodeTerrainMaterials(textures: TextureSet): TerrainMaterials {
  const rk = uniform(1.0 / ROCK_WORLD_SIZE);
  const gr = uniform(1.0 / GRASS_WORLD_SIZE);
  const dt = uniform(1.0 / DIRT_WORLD_SIZE);
  const chunkHalf = uniform(CHUNK_SIZE / 2);

  function makeMat(useDisplacement: boolean) {
    const mat = new MeshStandardNodeMaterial();

    // ── Albedo ──
    mat.colorNode = Fn(() => {
      const wp = positionWorld;
      const wn = normalWorld;
      const bw = biomeWeights(wp, wn);
      const rc = triSample(textures.rockDiff, wp, wn, rk);
      const gc = texture(textures.grassDiff, wp.xz.mul(gr));
      const dc = texture(textures.dirtDiff, wp.xz.mul(dt));
      return rc.mul(bw.x).add(gc.mul(bw.y)).add(dc.mul(bw.z));
    })();

    // ── Roughness ──
    mat.roughnessNode = Fn(() => {
      const wp = positionWorld;
      const wn = normalWorld;
      const bw = biomeWeights(wp, wn);
      const rr = triSample(textures.rockRough, wp, wn, rk).g;
      const gR = texture(textures.grassRough, wp.xz.mul(gr)).g;
      const dR = texture(textures.dirtRough, wp.xz.mul(dt)).g;
      return rr.mul(bw.x).add(gR.mul(bw.y)).add(dR.mul(bw.z));
    })();

    // ── Metalness ──
    mat.metalnessNode = float(0);

    // ── Normal: per-biome normals blended → view space ──
    mat.normalNode = Fn(() => {
      const wp = positionWorld;
      const wn = normalWorld;
      const bw = biomeWeights(wp, wn);

      // Rock: tri-planar Whiteout → world space → view space
      const rockNrmWorld = triplanarRockNormal(textures.rockNorm, wp, wn, rk);
      const rockNrmView = normalize(cameraViewMatrix.mul(vec4(rockNrmWorld, 0)).xyz);

      // Grass: planar XZ normal (Y-up tangent basis) → world space → view space
      const grassTn = texture(textures.grassNorm, wp.xz.mul(gr)).xyz.mul(2).sub(1);
      const grassNrmWorld = normalize(vec3(
        grassTn.x.mul(GRASS_NORMAL_SCALE),
        grassTn.z,
        grassTn.y.mul(GRASS_NORMAL_SCALE),
      ));
      const grassNrmView = normalize(cameraViewMatrix.mul(vec4(grassNrmWorld, 0)).xyz);

      // Dirt: planar XZ normal (Y-up tangent basis) → world space → view space
      const dirtTn = texture(textures.dirtNorm, wp.xz.mul(dt)).xyz.mul(2).sub(1);
      const dirtNrmWorld = normalize(vec3(
        dirtTn.x.mul(DIRT_NORMAL_SCALE),
        dirtTn.z,
        dirtTn.y.mul(DIRT_NORMAL_SCALE),
      ));
      const dirtNrmView = normalize(cameraViewMatrix.mul(vec4(dirtNrmWorld, 0)).xyz);

      // Blend all biome normals by weight
      const blended = normalize(
        rockNrmView.mul(bw.x)
          .add(grassNrmView.mul(bw.y))
          .add(dirtNrmView.mul(bw.z))
      );
      return blended;
    })();

    // ── AO: rock gets AO, grass/dirt → 1.0 ──
    mat.aoNode = Fn(() => {
      const wp = positionWorld;
      const wn = normalWorld;
      const bw = biomeWeights(wp, wn);
      const rockAo = triSample(textures.rockAo, wp, wn, rk).r;
      // Grass/dirt get 1.0 (no darkening), rock gets actual AO
      return mix(float(1), rockAo, bw.x);
    })();

    // ── Edge displacement fade via positionNode ──
    if (useDisplacement) {
      mat.positionNode = Fn(() => {
        const lp = positionLocal.toVar();
        const ln = normalLocal;
        const edgeDist = min(
          min(lp.x.add(chunkHalf), chunkHalf.sub(lp.x)),
          min(lp.z.add(chunkHalf), chunkHalf.sub(lp.z)),
        );
        const fade = smoothstep(float(0), float(DISPLACEMENT_FADE_DISTANCE), edgeDist);
        const disp = texture(textures.rockDisp, positionWorld.xz.mul(rk)).x;
        const offset = ln.mul(disp.mul(DISPLACEMENT_SCALE).add(DISPLACEMENT_BIAS).mul(fade));
        return lp.add(offset);
      })();
    }

    mat.envMapIntensity = TERRAIN_ENV_MAP_INTENSITY;

    return mat;
  }

  return {
    matDisp: makeMat(true) as any,
    matNoDisp: makeMat(false) as any,
  };
}
