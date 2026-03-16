/**
 * TSL/NodeMaterial terrain material for WebGPU mode.
 * Uses Three Shading Language with expression-based node composition.
 *
 * Stage A+B: albedo + roughness + biome blend + edge displacement fade
 */

// @ts-nocheck — TSL types not fully typed in @types/three
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4,
  texture, uniform, mix, smoothstep, abs, pow, normalize,
  min, floor, fract, dot, sign,
  positionWorld, positionLocal, normalWorld, normalLocal,
} from 'three/tsl';

import {
  CHUNK_SIZE, ROCK_WORLD_SIZE, GRASS_WORLD_SIZE, DIRT_WORLD_SIZE,
} from '../config';
import type { TextureSet, TerrainMaterials } from '../types';

// ── Pure expression helpers (no .toVar() needed) ──

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
  const w = pow(abs(wNorm), vec3(4));
  const ws = w.div(w.x.add(w.y).add(w.z).add(1e-6));
  return texture(tex, wPos.zy.mul(scale)).mul(ws.x)
    .add(texture(tex, wPos.xz.mul(scale)).mul(ws.y))
    .add(texture(tex, wPos.xy.mul(scale)).mul(ws.z));
});

// Shared biome weight computation — returns vec3(rock, grass, dirt) normalized
const biomeWeights = Fn(([wPos, wNorm]: [any, any]) => {
  const slope = float(1).sub(abs(wNorm.y));
  const bn = biomeNoise(wPos.xz.mul(0.03));
  const hBias = smoothstep(float(4), float(9), wPos.y).mul(0.3);
  const rock = smoothstep(float(0.35), float(0.65), slope.add(hBias));
  const flat = float(1).sub(rock);
  const grass = flat.mul(smoothstep(float(0.25), float(0.6), bn));
  const dirt = flat.mul(float(1).sub(smoothstep(float(0.2), float(0.55), bn))).mul(0.6);
  const sum = rock.add(grass).add(dirt).add(1e-6);
  return vec3(rock.div(sum), grass.div(sum), dirt.div(sum));
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

    // ── Edge displacement fade via positionNode ──
    if (useDisplacement) {
      mat.positionNode = Fn(() => {
        const lp = positionLocal.toVar();
        const ln = normalLocal;
        const edgeDist = min(
          min(lp.x.add(chunkHalf), chunkHalf.sub(lp.x)),
          min(lp.z.add(chunkHalf), chunkHalf.sub(lp.z)),
        );
        const fade = smoothstep(float(0), float(3), edgeDist);
        const disp = texture(textures.rockDisp, positionWorld.xz.mul(rk)).x;
        const offset = ln.mul(disp.mul(0.25).sub(0.1).mul(fade));
        return lp.add(offset);
      })();
    }

    mat.envMapIntensity = 0.08;

    return mat;
  }

  return {
    matDisp: makeMat(true) as any,
    matNoDisp: makeMat(false) as any,
  };
}
