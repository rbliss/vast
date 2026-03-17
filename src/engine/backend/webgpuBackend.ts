/**
 * WebGPU renderer backend.
 * Uses three/webgpu classes for proper node mapping + TSL materials.
 * The async createRenderer() caches the three/webgpu module for
 * subsequent synchronous calls.
 */

import type { Scene, PerspectiveCamera } from 'three';
import type { RendererBackend, BackendRenderer, BackendLighting, BackendEnvironment } from './types';
import { generateEnvironment } from '../core/environment';

/**
 * Minimal typed shape of the cached three/webgpu module.
 * Avoids @ts-nocheck while acknowledging the module is untyped.
 */
interface GpuModule {
  WebGPURenderer: new (opts: { antialias: boolean }) => {
    toneMapping: number;
    toneMappingExposure: number;
    init(): Promise<void>;
    setSize(w: number, h: number): void;
    setPixelRatio(dpr: number): void;
    render(scene: Scene, camera: PerspectiveCamera): void;
    domElement: HTMLCanvasElement;
    dispose(): void;
    capabilities: Record<string, unknown>;
    getRenderTarget(): unknown;
    setRenderTarget(rt: unknown): void;
  };
  ACESFilmicToneMapping: number;
  Scene: new () => Scene;
  PerspectiveCamera: new (fov: number, aspect: number, near: number, far: number) => PerspectiveCamera;
  Color: new (hex: number) => { r: number; g: number; b: number };
  FogExp2: new (color: number, density: number) => unknown;
  DirectionalLight: new (color: number, intensity: number) => { position: { set(x: number, y: number, z: number): void } };
  HemisphereLight: new (sky: number, ground: number, intensity: number) => { intensity: number };
}

// Cached module — populated by createRenderer(), used by sync methods
let GPU: GpuModule | null = null;

function assertGpu(): GpuModule {
  if (!GPU) throw new Error('WebGPU backend: createRenderer() must be called first');
  return GPU;
}

export const webgpuBackend: RendererBackend = {
  async createRenderer(opts = {}) {
    const { default: WebGPU } = await import('three/examples/jsm/capabilities/WebGPU.js');
    if (!(WebGPU as { isAvailable(): boolean }).isAvailable()) {
      throw new Error('WebGPU not available on this browser/origin');
    }

    GPU = await import('three/webgpu') as unknown as GpuModule;
    const g = GPU;

    const renderer = new g.WebGPURenderer({ antialias: true });
    renderer.toneMapping = g.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;
    (renderer as any).shadowMap = { enabled: true, type: 2 }; // PCFSoftShadowMap = 2
    await renderer.init();

    console.log('[backend:webgpu] renderer created');
    return { renderer: renderer as unknown as import('./types').RendererLike, reversedDepthSupported: false };
  },

  createScene() {
    const g = assertGpu();
    const scene = new g.Scene() as unknown as Scene;
    (scene as any).background = new g.Color(0x87ceeb);
    (scene as any).fog = new g.FogExp2(0x87ceeb, 0.005);
    return scene;
  },

  createCamera(aspect: number) {
    const g = assertGpu();
    const camera = new g.PerspectiveCamera(55, aspect, 0.1, 1200);
    camera.position.set(50, 50, 50);
    return camera;
  },

  createLighting(scene) {
    const g = assertGpu();
    const sun = new g.DirectionalLight(0xfff4e6, 2.5);
    sun.position.set(30, 50, 20);
    (scene as any).add(sun);

    // Shadow setup for the sun
    const sunAny = sun as any;
    sunAny.castShadow = true;
    sunAny.shadow.mapSize.width = 2048;
    sunAny.shadow.mapSize.height = 2048;
    sunAny.shadow.bias = -0.0005;
    // Shadow camera covers the visible terrain area
    const sc = sunAny.shadow.camera;
    sc.left = -120;
    sc.right = 120;
    sc.top = 120;
    sc.bottom = -120;
    sc.near = 0.5;
    sc.far = 300;

    const hemi = new g.HemisphereLight(0x87ceeb, 0x556b2f, 0.5);
    (scene as any).add(hemi);

    const fill = new g.DirectionalLight(0xadd8e6, 0.4);
    fill.position.set(-20, 10, -20);
    (scene as any).add(fill);

    return { sun: sun as any, hemi: hemi as any, fill: fill as any };
  },

  createEnvironment() {
    return generateEnvironment();
  },

  captureFrame(renderer, scene, camera) {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  },
};
