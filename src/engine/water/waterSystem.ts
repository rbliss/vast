/**
 * Water body rendering.
 *
 * Uses a terrain height texture to compute real depth below the water
 * surface, enabling terrain-driven shoreline transitions and depth color.
 *
 * Features:
 *   - Terrain-relative depth color (shallow → deep from actual height data)
 *   - Shoreline foam/wet edge where water meets terrain
 *   - Water masking: transparent where terrain is above water level
 *   - Fresnel-based sky reflection
 *   - Animated wave displacement
 *   - Sun warmth coherence via shared uniform
 */

// @ts-nocheck — TSL types not fully typed
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn, float, vec3, vec4,
  uniform, mix, smoothstep, abs, normalize, dot, pow, sin, cos, clamp, max, sub,
  positionWorld, positionLocal, normalWorld,
  cameraPosition, time, texture,
} from 'three/tsl';
import { sunWarmthUniform } from '../materials/terrainMaterialNode';

export interface WaterConfig {
  waterLevel: number;
  extent: number;
  segments: number;
  deepColor: [number, number, number];
  shallowColor: [number, number, number];
  maxDepth: number;
  waveAmplitude: number;
  waveFrequency: number;
  foamWidth: number;
}

export const DEFAULT_WATER_CONFIG: WaterConfig = {
  waterLevel: 8,
  extent: 200,
  segments: 128,
  deepColor: [0.04, 0.10, 0.20],
  shallowColor: [0.12, 0.30, 0.28],
  maxDepth: 12,
  waveAmplitude: 0.12,
  waveFrequency: 0.8,
  foamWidth: 1.5,
};

export interface WaterSystem {
  mesh: THREE.Mesh;
  setWaterLevel: (level: number) => void;
  dispose: () => void;
}

export function createWaterSystem(
  scene: THREE.Scene,
  heightTex: THREE.DataTexture,
  fieldExtent: number,
  config: WaterConfig = DEFAULT_WATER_CONFIG,
): WaterSystem {
  const waterLevelU = uniform(config.waterLevel);
  const extentU = uniform(fieldExtent);
  const deepColorU = uniform(new THREE.Color(...config.deepColor));
  const shallowColorU = uniform(new THREE.Color(...config.shallowColor));

  const geo = new THREE.PlaneGeometry(
    config.extent * 2, config.extent * 2,
    config.segments, config.segments,
  );
  geo.rotateX(-Math.PI / 2);

  const mat = new MeshStandardNodeMaterial();
  mat.transparent = true;
  mat.side = THREE.DoubleSide;
  mat.depthWrite = false;

  // ── Vertex displacement (waves) ──
  mat.positionNode = Fn(() => {
    const lp = positionLocal.toVar();
    const wp = positionWorld;
    const t = time;
    const wave1 = sin(wp.x.mul(config.waveFrequency).add(t.mul(1.2))).mul(
      cos(wp.z.mul(config.waveFrequency * 0.7).add(t.mul(0.9)))
    ).mul(config.waveAmplitude);
    const wave2 = sin(wp.x.mul(config.waveFrequency * 1.5).add(wp.z.mul(0.8)).add(t.mul(1.8)))
      .mul(config.waveAmplitude * 0.4);
    lp.y = lp.y.add(wave1).add(wave2);
    return lp;
  })();

  // ── Color: terrain-depth-driven + fresnel ──
  mat.colorNode = Fn(() => {
    const wp = positionWorld;

    // Sample terrain height at this XZ position from height texture
    const fieldUV = wp.xz.div(extentU.mul(2)).add(0.5);
    const terrainH = texture(heightTex, fieldUV).r;

    // Real depth below water surface
    const depth = clamp(waterLevelU.sub(terrainH), float(0), float(config.maxDepth));

    // Depth color gradient
    const depthT = smoothstep(float(0), float(config.maxDepth), depth);
    const waterColor = mix(vec3(shallowColorU), vec3(deepColorU), depthT);

    // Shoreline foam: bright edge where depth is very small
    const foamT = smoothstep(float(config.foamWidth), float(0), depth);
    const foamColor = vec3(0.85, 0.88, 0.82);
    const withFoam = mix(waterColor, foamColor, foamT.mul(0.6));

    // Fresnel reflection
    const viewDir = normalize(cameraPosition.sub(wp));
    const fresnel = pow(float(1).sub(max(dot(vec3(0, 1, 0), viewDir), float(0))), float(3));
    const skyReflect = mix(vec3(0.6, 0.7, 0.85), vec3(0.75, 0.72, 0.65), sunWarmthUniform);

    return mix(withFoam, skyReflect, fresnel.mul(0.45));
  })();

  // ── Opacity: hide where terrain is above water, fade at edges ──
  mat.opacityNode = Fn(() => {
    const wp = positionWorld;

    // Sample terrain height
    const fieldUV = wp.xz.div(extentU.mul(2)).add(0.5);
    const terrainH = texture(heightTex, fieldUV).r;

    // Depth below water
    const depth = waterLevelU.sub(terrainH);

    // Fully transparent where terrain is above water
    const underwaterMask = smoothstep(float(0), float(0.5), depth);

    // Edge fade at extent boundary
    const distFromCenter = wp.xz.length().div(extentU);
    const edgeFade = smoothstep(float(1.0), float(0.9), distFromCenter);

    // Opacity: more opaque in deeper water
    const depthOpacity = smoothstep(float(0), float(5), depth).mul(0.6).add(0.25);

    return depthOpacity.mul(underwaterMask).mul(edgeFade);
  })();

  mat.roughnessNode = float(0.1);
  mat.metalnessNode = float(0.0);

  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = config.waterLevel;
  mesh.receiveShadow = true;
  (scene as any).add(mesh);

  console.log(`[water] terrain-depth water at level ${config.waterLevel}`);

  return {
    mesh,
    setWaterLevel: (level: number) => {
      waterLevelU.value = level;
      mesh.position.y = level;
    },
    dispose: () => {
      scene.remove(mesh);
      geo.dispose();
      mat.dispose();
    },
  };
}
