/**
 * WebGPU renderer backend.
 * Uses three/webgpu classes for proper node mapping + TSL materials.
 * The async createRenderer() caches the three/webgpu module for
 * subsequent synchronous calls.
 */

// @ts-nocheck — three/webgpu types not fully declared
import type { RendererBackend, BackendRenderer, BackendLighting, BackendEnvironment } from './types';
import { createEnvironment } from '../core/environment';

// Cached three/webgpu module — populated by createRenderer()
let GPU: any = null;

export const webgpuBackend: RendererBackend = {
  mode: 'webgpu',

  async createRenderer(opts = {}) {
    const { default: WebGPU } = await import('three/examples/jsm/capabilities/WebGPU.js');
    if (!WebGPU.isAvailable()) {
      throw new Error('WebGPU not available on this browser/origin');
    }

    // Cache the module for synchronous scene/camera/lighting creation
    GPU = await import('three/webgpu');

    const renderer = new GPU.WebGPURenderer({ antialias: true });
    renderer.toneMapping = GPU.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    await renderer.init();

    console.log('[backend:webgpu] renderer created');
    return { renderer: renderer as any, reversedDepthSupported: false };
  },

  createScene() {
    const scene = new GPU.Scene();
    scene.background = new GPU.Color(0x87ceeb);
    scene.fog = new GPU.FogExp2(0x87ceeb, 0.005);
    return scene;
  },

  createCamera(aspect: number) {
    const camera = new GPU.PerspectiveCamera(55, aspect, 0.1, 800);
    camera.position.set(50, 30, 50);
    return camera;
  },

  createLighting(scene) {
    const sun = new GPU.DirectionalLight(0xfff4e6, 2.5);
    sun.position.set(30, 50, 20);
    scene.add(sun);

    const hemi = new GPU.HemisphereLight(0x87ceeb, 0x556b2f, 0.5);
    scene.add(hemi);

    const fill = new GPU.DirectionalLight(0xadd8e6, 0.4);
    fill.position.set(-20, 10, -20);
    scene.add(fill);

    return { sun, hemi, fill };
  },

  createEnvironment(renderer, scene) {
    return createEnvironment(renderer, scene, true);
  },

  captureFrame(renderer, scene, camera) {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  },
};
