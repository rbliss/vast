/**
 * Renderer, scene, camera, and lighting setup.
 * Supports both WebGL (default) and WebGPU (spike/experimental).
 */

import * as THREE from 'three';
import type { Scene, PerspectiveCamera, DirectionalLight, HemisphereLight } from 'three';

export type RendererMode = 'webgl' | 'webgpu';

interface RendererOpts {
  preserveDrawingBuffer?: boolean;
  mode?: RendererMode;
}

export interface RendererResult {
  renderer: THREE.WebGLRenderer;
  reversedDepthSupported: boolean;
  mode: RendererMode;
  /** For WebGPU: must await init() before first render */
  initPromise?: Promise<void>;
}

interface Lighting {
  sun: DirectionalLight;
  hemi: HemisphereLight;
  fill: DirectionalLight;
}

export async function createRendererAsync(opts: RendererOpts = {}): Promise<RendererResult> {
  const mode = opts.mode || 'webgl';

  if (mode === 'webgpu') {
    try {
      const WebGPU = await import('three/examples/jsm/capabilities/WebGPU.js');
      if (!WebGPU.default.isAvailable()) {
        console.warn('[renderer] WebGPU not available, falling back to WebGL');
        return createWebGLRenderer(opts);
      }

      const { default: WebGPURenderer } = await import('three/src/renderers/webgpu/WebGPURenderer.js');
      const renderer = new WebGPURenderer({ antialias: true });
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.0;

      await renderer.init();
      console.log('[renderer] WebGPU renderer initialized');

      return {
        renderer: renderer as unknown as THREE.WebGLRenderer, // duck-type for facade compat
        reversedDepthSupported: false,
        mode: 'webgpu',
      };
    } catch (err) {
      console.warn('[renderer] WebGPU init failed, falling back to WebGL:', err);
      return createWebGLRenderer(opts);
    }
  }

  return createWebGLRenderer(opts);
}

function createWebGLRenderer(opts: RendererOpts): RendererResult {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: opts.preserveDrawingBuffer || false,
    reversedDepthBuffer: true,
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const reversedDepthSupported = renderer.capabilities.reversedDepthBuffer === true;
  console.log(`[renderer] WebGL renderer (revZ: ${reversedDepthSupported})`);

  return { renderer, reversedDepthSupported, mode: 'webgl' };
}

// Keep sync version for backward compat (WebGL-only path)
export function createRenderer(opts: RendererOpts = {}): RendererResult {
  return createWebGLRenderer(opts);
}

export function createScene(): Scene {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.FogExp2(0x87ceeb, 0.005);
  return scene;
}

export function createCamera(aspect: number): PerspectiveCamera {
  const camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 800);
  camera.position.set(50, 30, 50);
  return camera;
}

export function createLighting(scene: Scene): Lighting {
  const sun = new THREE.DirectionalLight(0xfff4e6, 2.5);
  sun.position.set(30, 50, 20);
  scene.add(sun);

  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556b2f, 0.5);
  scene.add(hemi);

  const fill = new THREE.DirectionalLight(0xadd8e6, 0.4);
  fill.position.set(-20, 10, -20);
  scene.add(fill);

  return { sun, hemi, fill };
}
