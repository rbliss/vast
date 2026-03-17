/**
 * Water body rendering.
 *
 * A flat plane at configurable water level with:
 *   - Depth-based color (shallow → deep gradient)
 *   - Shoreline foam/edge blend
 *   - Subtle animated waves via vertex displacement
 *   - Fresnel-based reflectivity
 *   - Compatible with aerial perspective
 *
 * Uses TSL/NodeMaterial for WebGPU rendering.
 */

// @ts-nocheck — TSL types not fully typed
import * as THREE from 'three';
import { MeshStandardNodeMaterial } from 'three/webgpu';
import {
  Fn, float, vec2, vec3, vec4,
  uniform, mix, smoothstep, abs, normalize, dot, pow, sin, cos, clamp, max,
  positionWorld, positionLocal, normalWorld,
  cameraPosition, time,
} from 'three/tsl';
import { sunWarmthUniform } from '../materials/terrainMaterialNode';
import type { TerrainSource } from '../terrain/terrainSource';

export interface WaterConfig {
  /** Water surface elevation in world units */
  waterLevel: number;
  /** Plane extent (half-size) */
  extent: number;
  /** Plane subdivision for wave displacement */
  segments: number;
  /** Deep water color */
  deepColor: [number, number, number];
  /** Shallow water color */
  shallowColor: [number, number, number];
  /** Maximum depth for color gradient */
  maxDepth: number;
  /** Wave amplitude */
  waveAmplitude: number;
  /** Wave frequency */
  waveFrequency: number;
  /** Shoreline foam width in world units */
  foamWidth: number;
}

export const DEFAULT_WATER_CONFIG: WaterConfig = {
  waterLevel: 8,
  extent: 200,
  segments: 128,
  deepColor: [0.05, 0.12, 0.22],
  shallowColor: [0.15, 0.35, 0.30],
  maxDepth: 15,
  waveAmplitude: 0.15,
  waveFrequency: 0.8,
  foamWidth: 2.0,
};

export interface WaterSystem {
  mesh: THREE.Mesh;
  setWaterLevel: (level: number) => void;
  dispose: () => void;
}

export function createWaterSystem(
  scene: THREE.Scene,
  terrain: TerrainSource,
  config: WaterConfig = DEFAULT_WATER_CONFIG,
): WaterSystem {
  const waterLevelU = uniform(config.waterLevel);
  const deepColorU = uniform(new THREE.Color(...config.deepColor));
  const shallowColorU = uniform(new THREE.Color(...config.shallowColor));

  // Create water plane geometry
  const geo = new THREE.PlaneGeometry(
    config.extent * 2, config.extent * 2,
    config.segments, config.segments,
  );
  geo.rotateX(-Math.PI / 2);

  // TSL water material
  const mat = new MeshStandardNodeMaterial();
  mat.transparent = true;
  mat.side = THREE.DoubleSide;
  mat.depthWrite = false;

  // ── Vertex displacement (waves) ──
  mat.positionNode = Fn(() => {
    const lp = positionLocal.toVar();
    const wp = positionWorld;
    const t = time;

    // Two overlapping sine waves for organic motion
    const wave1 = sin(wp.x.mul(config.waveFrequency).add(t.mul(1.2))).mul(
      cos(wp.z.mul(config.waveFrequency * 0.7).add(t.mul(0.9)))
    ).mul(config.waveAmplitude);

    const wave2 = sin(wp.x.mul(config.waveFrequency * 1.5).add(wp.z.mul(0.8)).add(t.mul(1.8)))
      .mul(config.waveAmplitude * 0.4);

    lp.y = lp.y.add(wave1).add(wave2);
    return lp;
  })();

  // ── Color: depth-based gradient + shoreline foam + fresnel ──
  mat.colorNode = Fn(() => {
    const wp = positionWorld;
    const wl = waterLevelU;

    // Estimate terrain depth below water
    // Sample terrain height at this XZ position (approximate — uses world position of water surface)
    // Since we can't call JS terrain.sampleHeight from TSL, we use Y position relative to water level
    // as a proxy. The water mesh sits at waterLevel, so depth ≈ waterLevel - terrainHeight.
    // For now, use a simple distance-from-shore heuristic based on noise.
    const shoreNoise = sin(wp.x.mul(0.15)).mul(cos(wp.z.mul(0.12))).mul(0.5).add(0.5);
    const distFromCenter = wp.xz.length().div(float(config.extent));
    const pseudoDepth = clamp(distFromCenter.mul(config.maxDepth).add(shoreNoise.mul(3)), float(0), float(config.maxDepth));

    // Depth color gradient
    const depthT = smoothstep(float(0), float(config.maxDepth), pseudoDepth);
    const waterColor = mix(vec3(shallowColorU), vec3(deepColorU), depthT);

    // Fresnel: more reflective at grazing angles
    const viewDir = normalize(cameraPosition.sub(wp));
    const fresnel = pow(float(1).sub(max(dot(vec3(0, 1, 0), viewDir), float(0))), float(3));

    // Sky reflection color (matches atmosphere)
    const skyReflect = mix(vec3(0.6, 0.7, 0.85), vec3(0.75, 0.72, 0.65), sunWarmthUniform);

    // Blend water color with sky reflection by fresnel
    return mix(waterColor, skyReflect, fresnel.mul(0.5));
  })();

  // ── Opacity: fade at edges, more opaque at depth ──
  mat.opacityNode = Fn(() => {
    const wp = positionWorld;
    const distFromCenter = wp.xz.length().div(float(config.extent));

    // Fade out at extent edges
    const edgeFade = smoothstep(float(0.95), float(0.85), distFromCenter);

    // Base opacity (deeper = more opaque)
    const depthOpacity = smoothstep(float(0), float(8), distFromCenter.mul(config.maxDepth)).mul(0.5).add(0.35);

    return depthOpacity.mul(edgeFade);
  })();

  // ── Roughness: slightly glossy water ──
  mat.roughnessNode = float(0.15);
  mat.metalnessNode = float(0.0);

  // Create mesh
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.y = config.waterLevel;
  mesh.receiveShadow = true;
  (scene as any).add(mesh);

  console.log(`[water] created at level ${config.waterLevel}, extent ±${config.extent}`);

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
