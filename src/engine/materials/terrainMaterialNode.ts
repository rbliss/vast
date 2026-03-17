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
  min, floor, fract, dot, sign, exp, negate, sub,
  positionWorld, positionLocal, normalWorld, normalLocal,
  normalView, cameraViewMatrix, cameraPosition,
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

// ── Anti-tiling: dual-scale tri-planar with macro variation ──
// Samples at two scales and blends with low-frequency noise to break repetition.
// Also applies a macro tint shift for landscape-scale color variation.

const triSampleAntiTile = Fn(([tex, wPos, wNorm, scale]: [any, any, any, any]) => {
  // Primary scale (detail)
  const primary = triSample(tex, wPos, wNorm, scale);

  // Secondary scale (macro — ~0.31x to avoid exact harmonic alignment)
  const macroScale = scale.mul(0.31);
  const secondary = triSample(tex, wPos, wNorm, macroScale);

  // Blend mask: low-frequency noise determines which scale dominates locally
  const blendNoise = biomeNoise(wPos.xz.mul(0.008));
  const blendFactor = smoothstep(float(0.35), float(0.65), blendNoise);

  // Mix scales
  const mixed = mix(primary, secondary, blendFactor.mul(0.4));

  // Macro tint variation: subtle hue/value shift at landscape scale
  const tintNoise = biomeNoise(wPos.xz.mul(0.003).add(vec2(17.3, 31.7)));
  const tintShift = tintNoise.sub(0.5).mul(0.12);
  return mixed.add(vec4(tintShift, tintShift.mul(0.8), tintShift.mul(0.5), 0));
});

// ── Sediment color: lighter, smoother than dirt (deposited alluvium) ──
const SEDIMENT_COLOR = vec3(0.45, 0.42, 0.36);
const SEDIMENT_ROUGHNESS = float(0.78);

// ── Field-driven biome weights ──
// Reads from field texture: R=slope, G=normalizedAltitude, B=curvature, A=flowProxy
// Returns vec4(rock, grass, dirt, snow) normalized

// Returns: { rock, grass, dirt, snow, sediment } as separate floats via a struct-like object
// We pack into two outputs since TSL doesn't do structs well:
//   weights1 = vec4(rock, grass, dirt, snow)
//   sedimentWeight = float

const fieldBiomeWeights = Fn(([wPos, wNorm, fieldTex, fieldExtent]: [any, any, any, any]) => {
  // Sample field texture (world XZ → UV in [-extent, extent] → [0, 1])
  const fieldUV = wPos.xz.div(fieldExtent.mul(2)).add(0.5);
  const fields = texture(fieldTex, fieldUV);
  const fieldSlope = fields.r;
  const fieldAlt = fields.g;
  const fieldCurvature = fields.b;
  const fieldFlow = fields.a;

  // Geometric slope fallback
  const geoSlope = float(1).sub(abs(wNorm.y));

  // Field coverage mask (smooth edges)
  const inField = smoothstep(float(0.01), float(0.05), fieldUV.x)
    .mul(smoothstep(float(0.01), float(0.05), fieldUV.y))
    .mul(smoothstep(float(0.99), float(0.95), fieldUV.x))
    .mul(smoothstep(float(0.99), float(0.95), fieldUV.y));
  const slope = mix(geoSlope, fieldSlope.mul(0.5), inField);

  // Breakup noise
  const bn = biomeNoise(wPos.xz.mul(0.04));
  const detailNoise = biomeNoise(wPos.xz.mul(0.12)).mul(0.15);

  // ── Snow: high altitude + flat (threshold from uniform) ──
  const snowStart = matSnowThreshold;
  const snowEnd = matSnowThreshold.add(0.14);
  const snowBase = smoothstep(snowStart, snowEnd, fieldAlt.add(detailNoise.mul(0.5)));
  const snowSlopeMask = smoothstep(float(0.7), float(0.4), slope);
  const snow = snowBase.mul(snowSlopeMask).mul(inField);

  // ── Rock: steep, high altitude, or high curvature (cliff-band edges) ──
  const rockFromSlope = smoothstep(matRockSlopeMin, matRockSlopeMax, slope.add(detailNoise.mul(0.3)));
  const rockFromAlt = smoothstep(float(0.6), float(0.8), fieldAlt).mul(0.4).mul(inField);
  // Curvature boost: positive curvature (convex/ridge edges) exposes more rock
  const curvatureRock = smoothstep(float(0), float(3), fieldCurvature.mul(50)).mul(0.25).mul(inField);
  const rock = max(rockFromSlope, max(rockFromAlt, curvatureRock));

  // ── Sediment: driven by deposition mask, emphasis from uniform ──
  const flatness = float(1).sub(rock);
  const sedimentFromDeposition = smoothstep(float(0.08), float(0.35), fieldFlow).mul(inField);
  const sedimentSlopeMask = smoothstep(float(0.3), float(0.1), slope);
  const sediment = flatness.mul(sedimentFromDeposition).mul(sedimentSlopeMask).mul(matSedimentEmphasis.div(0.4));

  // ── Grass: flat, mid altitude, not in wet channels ──
  const grassAlt = smoothstep(float(0.15), float(0.35), fieldAlt)
    .mul(smoothstep(float(0.75), float(0.55), fieldAlt));
  const grassNoise = smoothstep(float(0.3), float(0.65), bn);
  const grassFlowDamp = smoothstep(float(0.45), float(0.25), fieldFlow.mul(inField));
  const grass = flatness.mul(float(1).sub(sediment))
    .mul(grassAlt.mul(inField).add(grassNoise.mul(float(1).sub(inField))))
    .mul(grassFlowDamp.mul(inField).add(float(1).sub(inField)));

  // ── Dirt: remaining weight ──
  const dirt = max(float(0), flatness.mul(float(1).sub(grass).sub(snow).sub(sediment)));

  // Normalize all 5
  const sum = rock.add(grass).add(dirt).add(snow).add(sediment).add(1e-6);
  // Pack: vec4(rock, grass, dirt, snow) + we encode sediment in a creative way
  // Use .w for snow, and we'll compute sediment separately
  // Actually, return vec4 and encode sediment as: sediment steals from dirt
  const normRock = rock.div(sum);
  const normGrass = grass.div(sum);
  const normDirt = dirt.div(sum);
  const normSnow = snow.div(sum);
  const normSediment = sediment.div(sum);

  // Pack: x=rock, y=grass, z=dirt+sediment combined, w=snow
  // Store sediment ratio in dirt channel: we'll split it in the color function
  // Simpler: just return 4 weights where dirt includes sediment, and separately
  // compute sediment fraction for color mixing
  // Actually easiest: return vec4(rock, grass, dirtFraction, snow) where
  // dirtFraction = dirt + sediment, and separately compute sediment ratio
  const dirtTotal = normDirt.add(normSediment);
  const sedimentRatio = normSediment.div(dirtTotal.add(1e-6)); // 0 = pure dirt, 1 = pure sediment

  // Return: x=rock, y=grass, z=dirt+sediment, w=snow
  // We'll pass sedimentRatio separately via a second call or encode it
  // For simplicity, use a 5th "channel" by packing sedimentRatio into negative z range
  // No, let's just return vec4 and reconstruct sediment from flow in the color function
  return vec4(normRock, normGrass, dirtTotal, normSnow);
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

// ── Aerial perspective / height-aware atmosphere ──
// Blends terrain color toward haze based on view distance and fragment height.
// Low terrain fades faster (valley haze), high terrain stays clearer (alpine clarity).

// Base haze colors (cool/neutral sky)
const HAZE_COOL_HORIZON = vec3(0.72, 0.78, 0.88);
const HAZE_WARM_HORIZON = vec3(0.85, 0.78, 0.65); // golden hour horizon
const HAZE_COOL_ZENITH = vec3(0.53, 0.63, 0.82);
const HAZE_WARM_ZENITH = vec3(0.65, 0.58, 0.52); // warm overhead

const aerialPerspective = Fn(([surfaceColor, wPos, sunWarmthU]: [any, any, any]) => {
  // Distance from camera to fragment
  const viewVec = sub(wPos, cameraPosition);
  const dist = viewVec.length();

  // Fragment height (world Y)
  const fragHeight = wPos.y;

  // Height-based density: denser at low altitude, thinner at high altitude
  const heightFade = smoothstep(float(5), float(60), fragHeight); // 0 at ground, 1 at peaks
  const densityScale = mix(float(1.0), float(0.25), heightFade); // valleys get 4x more haze

  // Distance-based extinction
  const fogDensity = float(0.004).mul(densityScale);
  const extinction = float(1).sub(exp(negate(dist.mul(fogDensity))));

  // Haze color: blend cool↔warm by sun warmth, vary by view angle
  const viewDir = normalize(viewVec);
  const upDot = clamp(viewDir.y.negate(), float(0), float(1));
  const horizonColor = mix(HAZE_COOL_HORIZON, HAZE_WARM_HORIZON, sunWarmthU);
  const zenithColor = mix(HAZE_COOL_ZENITH, HAZE_WARM_ZENITH, sunWarmthU);
  const hazeColor = mix(horizonColor, zenithColor, upDot.mul(0.5));

  // Blend surface toward haze
  return mix(surfaceColor, hazeColor, extinction.mul(0.85));
});

/** Shared sun warmth uniform — updated by TerrainApp when sun direction changes */
export const sunWarmthUniform = uniform(0.0);

/** Material parameter uniforms — updated by TerrainApp from document values */
export const matSnowThreshold = uniform(0.85);
export const matRockSlopeMin = uniform(0.25);
export const matRockSlopeMax = uniform(0.55);
export const matSedimentEmphasis = uniform(0.55);

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

        // Rock: anti-tiled dual-scale tri-planar
        const rc = triSampleAntiTile(textures.rockDiff, wp, wn, rk);

        // Grass
        const gc = texture(textures.grassDiff, wp.xz.mul(gr));

        // Dirt + sediment blend: use explicit deposition mask for alluvial identity
        const fieldUV = wp.xz.div(extentU.mul(2)).add(0.5);
        const deposition = texture(fieldMap, fieldUV).a;
        const sedimentMix = smoothstep(float(0.08), float(0.35), deposition);
        const dirtColor = texture(textures.dirtDiff, wp.xz.mul(dt));
        const dc = mix(dirtColor, vec4(SEDIMENT_COLOR, 1.0), sedimentMix.mul(0.4));

        const surfaceColor = rc.mul(bw.x).add(gc.mul(bw.y)).add(dc.mul(bw.z)).add(SNOW_COLOR.mul(bw.w));
        return aerialPerspective(surfaceColor, wp, sunWarmthUniform);
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
      const fallbackColor = rc.mul(rock.div(sum)).add(gc.mul(grass.div(sum))).add(dc.mul(dirt.div(sum)));
      return aerialPerspective(fallbackColor, wp, sunWarmthUniform);
    })();

    // ── Roughness ──
    mat.roughnessNode = Fn(() => {
      const wp = positionWorld;
      const wn = normalWorld;

      if (fieldMap) {
        const bw = fieldBiomeWeights(wp, wn, fieldMap, extentU);
        const rr = triSampleAntiTile(textures.rockRough, wp, wn, rk).g;
        const gR = texture(textures.grassRough, wp.xz.mul(gr)).g;
        // Dirt roughness blended with smoother sediment roughness
        const fieldUV = wp.xz.div(extentU.mul(2)).add(0.5);
        const flow = texture(fieldMap, fieldUV).a;
        const depositionR = texture(fieldMap, wp.xz.div(extentU.mul(2)).add(0.5)).a;
        const sedimentMixR = smoothstep(float(0.08), float(0.35), depositionR);
        const dR = mix(texture(textures.dirtRough, wp.xz.mul(dt)).g, SEDIMENT_ROUGHNESS, sedimentMixR.mul(0.3));
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
