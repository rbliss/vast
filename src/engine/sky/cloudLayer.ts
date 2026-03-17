/**
 * Procedural cloud sky layer.
 *
 * A hemisphere dome above the terrain with animated procedural clouds.
 * Uses layered noise for cloud density, animated by wind.
 * Renders behind terrain (depth test but no depth write).
 *
 * This is a composition-friendly sky enhancement, not volumetric clouds.
 * It adds scale and depth cues to wide views.
 */

// @ts-nocheck — TSL types not fully typed
import * as THREE from 'three';
import { MeshBasicNodeMaterial } from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4,
  uniform, mix, smoothstep, abs, pow, sin, cos, clamp, max, min,
  positionWorld, normalWorld, cameraPosition,
  time, fract, floor, dot,
} from 'three/tsl';
import { sunWarmthUniform } from '../materials/terrainMaterialNode';

export interface CloudConfig {
  /** Dome radius */
  radius: number;
  /** Cloud layer height (center of dome) */
  height: number;
  /** Cloud coverage (0 = clear, 1 = overcast) */
  coverage: number;
  /** Wind speed for animation */
  windSpeed: number;
  /** Wind direction in radians */
  windAngle: number;
  /** Cloud opacity at full density */
  maxOpacity: number;
}

export const DEFAULT_CLOUD_CONFIG: CloudConfig = {
  radius: 600,
  height: 150,
  coverage: 0.55,
  windSpeed: 0.4,
  windAngle: 0.7,
};

export interface CloudSystem {
  mesh: THREE.Mesh;
  setCoverage: (c: number) => void;
  dispose: () => void;
}

// ── Simple hash for cloud noise ──
const cloudHash = Fn(([p]: [any]) => {
  const p3 = fract(vec3(p.x, p.y, p.x).mul(vec3(0.1031, 0.1030, 0.0973)));
  const d = dot(p3, p3.yzx.add(33.33));
  return fract(p3.x.add(p3.y).mul(p3.z).add(d));
});

const cloudNoise = Fn(([p]: [any]) => {
  const i = floor(p);
  const f = fract(p);
  const ff = f.mul(f).mul(float(3).sub(f.mul(2)));
  const a = cloudHash(i);
  const b = cloudHash(i.add(vec2(1, 0)));
  const c = cloudHash(i.add(vec2(0, 1)));
  const d = cloudHash(i.add(vec2(1, 1)));
  return mix(mix(a, b, ff.x), mix(c, d, ff.x), ff.y);
});

// FBM for cloud density
const cloudFBM = Fn(([p, octaves]: [any, any]) => {
  const sum = float(0).toVar();
  const amp = float(1).toVar();
  const freq = float(1).toVar();
  const maxAmp = float(0).toVar();

  // Unrolled 4 octaves (TSL doesn't support dynamic loops well)
  sum.addAssign(cloudNoise(p.mul(freq)).mul(amp));
  maxAmp.addAssign(amp); amp.mulAssign(0.5); freq.mulAssign(2.0);

  sum.addAssign(cloudNoise(p.mul(freq)).mul(amp));
  maxAmp.addAssign(amp); amp.mulAssign(0.5); freq.mulAssign(2.0);

  sum.addAssign(cloudNoise(p.mul(freq)).mul(amp));
  maxAmp.addAssign(amp); amp.mulAssign(0.5); freq.mulAssign(2.0);

  sum.addAssign(cloudNoise(p.mul(freq)).mul(amp));
  maxAmp.addAssign(amp);

  return sum.div(maxAmp);
});

export function createCloudSystem(
  scene: THREE.Scene,
  config: CloudConfig = DEFAULT_CLOUD_CONFIG,
): CloudSystem {
  const coverageU = uniform(config.coverage);

  // Hemisphere dome geometry
  const geo = new THREE.SphereGeometry(config.radius, 32, 16, 0, Math.PI * 2, 0, Math.PI * 0.45);
  geo.scale(1, 0.3, 1); // Flatten into a dome

  const mat = new MeshBasicNodeMaterial();
  mat.transparent = true;
  mat.side = THREE.BackSide; // Render inside of dome
  mat.depthWrite = false;

  // ── Cloud color + opacity ──
  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const t = time;

    // Cloud plane UV from world XZ (dome maps to sky coordinates)
    const windDx = float(config.windSpeed).mul(cos(float(config.windAngle))).mul(t);
    const windDz = float(config.windSpeed).mul(sin(float(config.windAngle))).mul(t);
    const cloudUV = vec2(
      wp.x.mul(0.002).add(windDx),
      wp.z.mul(0.002).add(windDz),
    );

    // Multi-octave cloud density
    const density = cloudFBM(cloudUV, float(4));

    // Coverage threshold: higher coverage = more clouds
    const cloudMask = smoothstep(
      float(1).sub(coverageU).sub(0.1),
      float(1).sub(coverageU).add(0.15),
      density,
    );

    // Cloud color: white, tinted slightly warm by sun
    const cloudWhite = mix(vec3(1, 1, 1), vec3(1, 0.97, 0.92), sunWarmthUniform);

    // Cloud shadow: darker underside for depth
    const heightFade = smoothstep(float(config.height * 0.7), float(config.height * 1.1), wp.y);
    const shadowedColor = mix(cloudWhite.mul(0.7), cloudWhite, heightFade);

    return shadowedColor;
  })();

  mat.opacityNode = Fn(() => {
    const wp = positionWorld;
    const t = time;

    const windDx = float(config.windSpeed).mul(cos(float(config.windAngle))).mul(t);
    const windDz = float(config.windSpeed).mul(sin(float(config.windAngle))).mul(t);
    const cloudUV = vec2(
      wp.x.mul(0.002).add(windDx),
      wp.z.mul(0.002).add(windDz),
    );

    const density = cloudFBM(cloudUV, float(4));

    const cloudMask = smoothstep(
      float(1).sub(coverageU).sub(0.1),
      float(1).sub(coverageU).add(0.15),
      density,
    );

    // Horizon fade: clouds less visible near horizon to blend with aerial perspective
    const viewDir = wp.sub(cameraPosition);
    const upDot = clamp(viewDir.y.div(viewDir.length()), float(0), float(1));
    const horizonFade = smoothstep(float(0.02), float(0.12), upDot);

    return cloudMask.mul(0.85).mul(horizonFade);
  })();

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = config.height;
  mesh.renderOrder = -1; // Render before terrain
  (scene as any).add(mesh);

  console.log(`[clouds] dome at height ${config.height}, coverage ${config.coverage}`);

  return {
    mesh,
    setCoverage: (c: number) => { coverageU.value = Math.max(0, Math.min(1, c)); },
    dispose: () => {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}
