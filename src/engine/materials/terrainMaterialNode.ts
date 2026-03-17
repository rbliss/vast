/**
 * TSL/NodeMaterial terrain material for WebGPU mode.
 * Phase B: terrain-field-driven material blending.
 *
 * Reads pre-computed terrain analysis (slope, altitude, curvature, flow)
 * from a field texture to drive material distribution. Materials follow
 * erosion-carved structure rather than just geometric normals.
 */

// @ts-nocheck — TSL types not fully typed in @types/three
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4,
  texture, uniform, mix, smoothstep, abs, pow, normalize, clamp, max,
  min, floor, fract, dot, sign,
  positionWorld, positionLocal, normalWorld, normalLocal,
  normalView, cameraViewMatrix,
} from 'three/tsl';

import { CHUNK_SIZE, ROCK_WORLD_SIZE, GRASS_WORLD_SIZE, DIRT_WORLD_SIZE } from '../config';
import type { TextureSet, TerrainMaterials } from '../types';
import {
  TRIPLANAR_SHARPNESS,
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

// ── Field-driven biome weights ──
// Reads from field texture: R=slope, G=normalizedAltitude, B=curvature, A=flowProxy
// Returns vec4(rock, grass, dirt, snow) normalized

const fieldBiomeWeights = Fn(([wPos, wNorm, fieldTex, fieldExtent]: [any, any, any, any]) => {
  // Sample field texture (world XZ → UV in [-extent, extent] → [0, 1])
  const fieldUV = wPos.xz.div(fieldExtent.mul(2)).add(0.5);
  const fields = texture(fieldTex, fieldUV);
  const fieldSlope = fields.r;
  const fieldAlt = fields.g;
  const fieldCurvature = fields.b;
  const fieldFlow = fields.a;

  // Also use geometric slope as fallback for areas outside field coverage
  const geoSlope = float(1).sub(abs(wNorm.y));

  // Blend between field and geometric slope (field dominates inside coverage)
  const inField = smoothstep(float(0.01), float(0.05), fieldUV.x)
    .mul(smoothstep(float(0.01), float(0.05), fieldUV.y))
    .mul(smoothstep(float(0.99), float(0.95), fieldUV.x))
    .mul(smoothstep(float(0.99), float(0.95), fieldUV.y));
  const slope = mix(geoSlope, fieldSlope.mul(0.5), inField);

  // Breakup noise (prevents banding at transitions)
  const bn = biomeNoise(wPos.xz.mul(0.04));
  const detailNoise = biomeNoise(wPos.xz.mul(0.12)).mul(0.15);

  // ── Snow: high altitude + not too steep ──
  const snowBase = smoothstep(float(0.72), float(0.88), fieldAlt.add(detailNoise));
  const snowSlopeMask = smoothstep(float(0.8), float(0.5), slope); // less snow on steep faces
  const snow = snowBase.mul(snowSlopeMask).mul(inField);

  // ── Rock: steep slopes or very high altitude ──
  const rockFromSlope = smoothstep(float(0.3), float(0.6), slope.add(detailNoise.mul(0.3)));
  const rockFromAlt = smoothstep(float(0.6), float(0.8), fieldAlt).mul(0.4).mul(inField);
  const rock = max(rockFromSlope, rockFromAlt);

  // ── Grass: flat, mid altitude, not too wet ──
  const flatness = float(1).sub(rock);
  const grassAlt = smoothstep(float(0.15), float(0.35), fieldAlt)
    .mul(smoothstep(float(0.75), float(0.55), fieldAlt));
  const grassNoise = smoothstep(float(0.3), float(0.65), bn);
  const grassFlowDamp = smoothstep(float(0.5), float(0.3), fieldFlow.mul(inField)); // less grass in wet channels
  const grass = flatness.mul(grassAlt.mul(inField).add(grassNoise.mul(float(1).sub(inField))))
    .mul(grassFlowDamp.mul(inField).add(float(1).sub(inField)));

  // ── Dirt: fills remaining weight, boosted by flow/deposition ──
  const dirtBase = flatness.mul(float(1).sub(grass).sub(snow));
  const flowBoost = fieldFlow.mul(0.3).mul(inField);
  const dirt = max(float(0), dirtBase.add(flowBoost));

  // Normalize
  const sum = rock.add(grass).add(dirt).add(snow).add(1e-6);
  return vec4(rock.div(sum), grass.div(sum), dirt.div(sum), snow.div(sum));
});

// Rock tri-planar normal with Whiteout blending
const triplanarRockNormal = Fn(([tex, wPos, wNorm, scale]: [any, any, any, any]) => {
  const axisSign = sign(wNorm);
  const w = pow(abs(wNorm), vec3(TRIPLANAR_SHARPNESS));
  const ws = w.div(w.x.add(w.y).add(w.z).add(1e-6));
  const ns = float(ROCK_NORMAL_SCALE);

  const tnX = texture(tex, wPos.zy.mul(scale)).xyz.mul(2).sub(1);
  const tnY = texture(tex, wPos.xz.mul(scale)).xyz.mul(2).sub(1);
  const tnZ = texture(tex, wPos.xy.mul(scale)).xyz.mul(2).sub(1);

  const tnXc = vec3(tnX.x.mul(ns).mul(axisSign.x), tnX.y.mul(ns), tnX.z);
  const tnYc = vec3(tnY.x.mul(ns).mul(axisSign.y), tnY.y.mul(ns), tnY.z);
  const tnZc = vec3(tnZ.x.mul(ns).mul(axisSign.z).negate(), tnZ.y.mul(ns), tnZ.z);

  const blendX = vec3(tnXc.xy.add(wNorm.zy), abs(wNorm.x));
  const blendY = vec3(tnYc.xy.add(wNorm.xz), abs(wNorm.y));
  const blendZ = vec3(tnZc.xy.add(wNorm.xy), abs(wNorm.z));

  return normalize(
    blendX.zyx.mul(ws.x)
      .add(blendY.xzy.mul(ws.y))
      .add(blendZ.mul(ws.z))
  );
});

// ── Snow color: white with slight blue tint ──
const SNOW_COLOR = vec3(0.92, 0.93, 0.96);
const SNOW_ROUGHNESS = float(0.4);

export function createNodeTerrainMaterials(
  textures: TextureSet,
  fieldMap?: THREE.DataTexture,
  fieldExtent?: number,
): TerrainMaterials {
  const rk = uniform(1.0 / ROCK_WORLD_SIZE);
  const gr = uniform(1.0 / GRASS_WORLD_SIZE);
  const dt = uniform(1.0 / DIRT_WORLD_SIZE);
  const chunkHalf = uniform(CHUNK_SIZE / 2);
  const extentU = uniform(fieldExtent ?? 200);

  function makeMat(useDisplacement: boolean) {
    const mat = new MeshStandardNodeMaterial();

    // ── Albedo ──
    mat.colorNode = Fn(() => {
      const wp = positionWorld;
      const wn = normalWorld;

      if (fieldMap) {
        const bw = fieldBiomeWeights(wp, wn, fieldMap, extentU);
        const rc = triSample(textures.rockDiff, wp, wn, rk);
        const gc = texture(textures.grassDiff, wp.xz.mul(gr));
        const dc = texture(textures.dirtDiff, wp.xz.mul(dt));
        return rc.mul(bw.x).add(gc.mul(bw.y)).add(dc.mul(bw.z)).add(SNOW_COLOR.mul(bw.w));
      }

      // Fallback: geometric slope only (legacy path)
      const slope = float(1).sub(abs(wn.y));
      const rock = smoothstep(float(0.35), float(0.65), slope);
      const flat_ = float(1).sub(rock);
      const bn = biomeNoise(wp.xz.mul(0.03));
      const grass = flat_.mul(smoothstep(float(0.25), float(0.6), bn));
      const dirt = flat_.mul(float(1).sub(smoothstep(float(0.2), float(0.55), bn))).mul(0.6);
      const sum = rock.add(grass).add(dirt).add(1e-6);
      const rc = triSample(textures.rockDiff, wp, wn, rk);
      const gc = texture(textures.grassDiff, wp.xz.mul(gr));
      const dc = texture(textures.dirtDiff, wp.xz.mul(dt));
      return rc.mul(rock.div(sum)).add(gc.mul(grass.div(sum))).add(dc.mul(dirt.div(sum)));
    })();

    // ── Roughness ──
    mat.roughnessNode = Fn(() => {
      const wp = positionWorld;
      const wn = normalWorld;

      if (fieldMap) {
        const bw = fieldBiomeWeights(wp, wn, fieldMap, extentU);
        const rr = triSample(textures.rockRough, wp, wn, rk).g;
        const gR = texture(textures.grassRough, wp.xz.mul(gr)).g;
        const dR = texture(textures.dirtRough, wp.xz.mul(dt)).g;
        return rr.mul(bw.x).add(gR.mul(bw.y)).add(dR.mul(bw.z)).add(SNOW_ROUGHNESS.mul(bw.w));
      }

      // Fallback
      const slope = float(1).sub(abs(wn.y));
      const rock = smoothstep(float(0.35), float(0.65), slope);
      const rr = triSample(textures.rockRough, wp, wn, rk).g;
      const gR = texture(textures.grassRough, wp.xz.mul(gr)).g;
      return mix(gR, rr, rock);
    })();

    // ── Metalness ──
    mat.metalnessNode = float(0);

    // ── Normal ──
    mat.normalNode = Fn(() => {
      const wp = positionWorld;
      const wn = normalWorld;

      if (fieldMap) {
        const bw = fieldBiomeWeights(wp, wn, fieldMap, extentU);
        // Rock
        const rockNrmWorld = triplanarRockNormal(textures.rockNorm, wp, wn, rk);
        const rockNrmView = normalize(cameraViewMatrix.mul(vec4(rockNrmWorld, 0)).xyz);
        // Grass
        const grassTn = texture(textures.grassNorm, wp.xz.mul(gr)).xyz.mul(2).sub(1);
        const grassNrmWorld = normalize(vec3(grassTn.x.mul(GRASS_NORMAL_SCALE), grassTn.z, grassTn.y.mul(GRASS_NORMAL_SCALE)));
        const grassNrmView = normalize(cameraViewMatrix.mul(vec4(grassNrmWorld, 0)).xyz);
        // Dirt
        const dirtTn = texture(textures.dirtNorm, wp.xz.mul(dt)).xyz.mul(2).sub(1);
        const dirtNrmWorld = normalize(vec3(dirtTn.x.mul(DIRT_NORMAL_SCALE), dirtTn.z, dirtTn.y.mul(DIRT_NORMAL_SCALE)));
        const dirtNrmView = normalize(cameraViewMatrix.mul(vec4(dirtNrmWorld, 0)).xyz);
        // Snow: use geometry normal (smooth)
        const snowNrmView = normalView;

        return normalize(
          rockNrmView.mul(bw.x)
            .add(grassNrmView.mul(bw.y))
            .add(dirtNrmView.mul(bw.z))
            .add(snowNrmView.mul(bw.w))
        );
      }

      // Fallback: rock-only normals
      const rockNrmWorld = triplanarRockNormal(textures.rockNorm, wp, wn, rk);
      return normalize(cameraViewMatrix.mul(vec4(rockNrmWorld, 0)).xyz);
    })();

    // ── AO ──
    mat.aoNode = Fn(() => {
      const wp = positionWorld;
      const wn = normalWorld;
      if (fieldMap) {
        const bw = fieldBiomeWeights(wp, wn, fieldMap, extentU);
        const rockAo = triSample(textures.rockAo, wp, wn, rk).r;
        return mix(float(1), rockAo, bw.x);
      }
      return float(1);
    })();

    // ── Edge displacement fade ──
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
