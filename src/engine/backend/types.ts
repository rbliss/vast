/**
 * Renderer backend interface.
 * TerrainApp consumes this — never imports three/webgpu directly.
 */

import type { Scene, PerspectiveCamera, DirectionalLight, HemisphereLight, Texture } from 'three';

/** Subset of renderer methods actually used by the engine. */
export interface RendererLike {
  domElement: HTMLCanvasElement;
  setSize(w: number, h: number, updateStyle?: boolean): void;
  setPixelRatio(dpr: number): void;
  render(scene: Scene, camera: PerspectiveCamera): void;
  capabilities: { getMaxAnisotropy?: () => number };
}

export interface BackendRenderer {
  renderer: RendererLike;
  /** Whether reversed depth buffer is active */
  reversedDepthSupported: boolean;
}

export interface BackendLighting {
  sun: DirectionalLight;
  hemi: HemisphereLight;
  fill: DirectionalLight;
}

export interface BackendEnvironment {
  environmentMap: Texture;
  sunDirection: import('three').Vector3;
  dispose: () => void;
}

export interface RendererBackend {
  createRenderer(opts?: { preserveDrawingBuffer?: boolean }): Promise<BackendRenderer>;
  createScene(): Scene;
  createCamera(aspect: number): PerspectiveCamera;
  createLighting(scene: Scene): BackendLighting;
  createEnvironment(): BackendEnvironment;
  captureFrame(renderer: RendererLike, scene: Scene, camera: PerspectiveCamera): string;
}
