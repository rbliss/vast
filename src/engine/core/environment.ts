/**
 * Procedural sky environment with PMREM for IBL.
 * Generates a single environment map at startup for PBR lighting.
 */

import * as THREE from 'three';
import type { WebGLRenderer, Scene, Texture, Vector3 } from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { SUN_ELEVATION, SUN_AZIMUTH } from '../config';

export interface EnvironmentResult {
  environmentMap: Texture;
  sunDirection: THREE.Vector3;
  dispose: () => void;
}

/**
 * Generate PMREM environment map. Uses a temporary WebGL renderer if the
 * main renderer is WebGPU (PMREMGenerator requires WebGL internals).
 * The resulting texture is renderer-agnostic once generated.
 */
export function createEnvironment(renderer: WebGLRenderer, scene: Scene, isWebGPU = false): EnvironmentResult {
  // Create procedural sky
  const sky = new Sky();
  sky.scale.setScalar(10000);

  const skyUniforms = sky.material.uniforms;
  // Overcast/dim sky for subtle IBL — avoids overpowering terrain textures
  skyUniforms['turbidity'].value = 10;
  skyUniforms['rayleigh'].value = 0.5;
  skyUniforms['mieCoefficient'].value = 0.02;
  skyUniforms['mieDirectionalG'].value = 0.3;

  // Compute sun direction from elevation/azimuth
  const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION);
  const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
  const sunDirection = new THREE.Vector3();
  sunDirection.setFromSphericalCoords(1, phi, theta);
  skyUniforms['sunPosition'].value.copy(sunDirection);

  // Generate PMREM — use temporary WebGL renderer if main is WebGPU
  let pmremRenderer: THREE.WebGLRenderer;
  let ownRenderer = false;
  if (isWebGPU) {
    pmremRenderer = new THREE.WebGLRenderer();
    pmremRenderer.setSize(256, 256);
    ownRenderer = true;
  } else {
    pmremRenderer = renderer;
  }

  const pmremGenerator = new THREE.PMREMGenerator(pmremRenderer);
  pmremGenerator.compileEquirectangularShader();

  const skyScene = new THREE.Scene();
  skyScene.add(sky);
  const environmentMap = pmremGenerator.fromScene(skyScene, 0, 0.1, 1000).texture;
  pmremGenerator.dispose();

  if (ownRenderer) {
    pmremRenderer.dispose();
  }

  // Don't set scene.environment — it produces too much specular on terrain.
  // Instead, the env map is returned for selective per-material application.

  console.log(`[environment] PMREM generated (sun: elev=${SUN_ELEVATION}° az=${SUN_AZIMUTH}°)`);

  return {
    environmentMap,
    sunDirection,
    dispose: () => {
      environmentMap.dispose();
      sky.geometry.dispose();
      (sky.material as THREE.ShaderMaterial).dispose();
    },
  };
}
