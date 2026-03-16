/**
 * WebGPU renderer + scene primitives factory.
 * All render-side classes imported from three/webgpu to avoid node mapping issues.
 */

// @ts-nocheck — three/webgpu types not fully declared
import {
  WebGPURenderer,
  Scene, PerspectiveCamera, Color, FogExp2,
  DirectionalLight, HemisphereLight,
  ACESFilmicToneMapping,
} from 'three/webgpu';

import type { RendererResult, RendererMode } from './renderer';

export async function createWebGPURenderer(): Promise<RendererResult> {
  const { default: WebGPU } = await import('three/examples/jsm/capabilities/WebGPU.js');
  if (!WebGPU.isAvailable()) {
    throw new Error('WebGPU not available');
  }

  const renderer = new WebGPURenderer({ antialias: true });
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  await renderer.init();

  console.log('[renderer] WebGPU renderer initialized');
  return {
    renderer: renderer as any,
    reversedDepthSupported: false,
    mode: 'webgpu' as RendererMode,
  };
}

/** Create scene using three/webgpu Scene class (node-aware). */
export function createWebGPUScene() {
  const scene = new Scene();
  scene.background = new Color(0x87ceeb);
  scene.fog = new FogExp2(0x87ceeb, 0.005);
  return scene;
}

/** Create camera using three/webgpu PerspectiveCamera (node-aware). */
export function createWebGPUCamera(aspect: number) {
  const camera = new PerspectiveCamera(55, aspect, 0.1, 800);
  camera.position.set(50, 30, 50);
  return camera;
}

/** Create lights using three/webgpu light classes (node-aware). */
export function createWebGPULighting(scene: any) {
  const sun = new DirectionalLight(0xfff4e6, 2.5);
  sun.position.set(30, 50, 20);
  scene.add(sun);

  const hemi = new HemisphereLight(0x87ceeb, 0x556b2f, 0.5);
  scene.add(hemi);

  const fill = new DirectionalLight(0xadd8e6, 0.4);
  fill.position.set(-20, 10, -20);
  scene.add(fill);

  return { sun, hemi, fill };
}
