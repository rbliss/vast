/**
 * Shared environment module.
 * Generates a PMREM environment map using a dedicated temporary WebGL
 * renderer. The result is a plain Texture consumed by any backend.
 *
 * This approach is renderer-agnostic: neither WebGL nor WebGPU backends
 * need to know how the environment map was generated.
 */

import * as THREE from 'three';
import type { Texture } from 'three';
import { Sky } from 'three/examples/jsm/objects/Sky.js';
import { SUN_ELEVATION, SUN_AZIMUTH } from '../config';

export interface EnvironmentResult {
  environmentMap: Texture;
  sunDirection: THREE.Vector3;
  dispose: () => void;
}

/**
 * Generate a PMREM environment map from a procedural sky.
 * Always uses a dedicated temporary WebGL renderer for PMREM generation
 * (PMREMGenerator requires WebGL). The resulting texture is backend-agnostic.
 */
export function generateEnvironment(): EnvironmentResult {
  // Procedural sky
  const sky = new Sky();
  sky.scale.setScalar(10000);

  const skyUniforms = sky.material.uniforms;
  skyUniforms['turbidity'].value = 10;
  skyUniforms['rayleigh'].value = 0.5;
  skyUniforms['mieCoefficient'].value = 0.02;
  skyUniforms['mieDirectionalG'].value = 0.3;

  // Sun direction
  const phi = THREE.MathUtils.degToRad(90 - SUN_ELEVATION);
  const theta = THREE.MathUtils.degToRad(SUN_AZIMUTH);
  const sunDirection = new THREE.Vector3();
  sunDirection.setFromSphericalCoords(1, phi, theta);
  skyUniforms['sunPosition'].value.copy(sunDirection);

  // Generate PMREM via dedicated temp WebGL renderer
  const tempRenderer = new THREE.WebGLRenderer();
  tempRenderer.setSize(256, 256);

  const pmrem = new THREE.PMREMGenerator(tempRenderer);
  pmrem.compileEquirectangularShader();

  const skyScene = new THREE.Scene();
  skyScene.add(sky);
  const environmentMap = pmrem.fromScene(skyScene, 0, 0.1, 1000).texture;

  // Cleanup
  pmrem.dispose();
  tempRenderer.dispose();
  tempRenderer.domElement.remove();

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

// Keep old API for backward compat (called by backends)
export function createEnvironment(_renderer: THREE.WebGLRenderer, _scene: THREE.Scene, _isWebGPU = false): EnvironmentResult {
  return generateEnvironment();
}
