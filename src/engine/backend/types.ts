/**
 * Renderer backend interface.
 * TerrainApp consumes this — never imports three vs three/webgpu directly.
 */

import type { WebGLRenderer, Scene, PerspectiveCamera, DirectionalLight, HemisphereLight, Texture } from 'three';

export type RendererMode = 'webgl' | 'webgpu';

export interface BackendRenderer {
  /** The three.js renderer instance (WebGLRenderer or WebGPURenderer duck-typed) */
  renderer: WebGLRenderer;
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
  readonly mode: RendererMode;

  createRenderer(opts?: { preserveDrawingBuffer?: boolean }): Promise<BackendRenderer>;
  createScene(): Scene;
  createCamera(aspect: number): PerspectiveCamera;
  createLighting(scene: Scene): BackendLighting;
  createEnvironment(renderer: WebGLRenderer, scene: Scene): BackendEnvironment;
  captureFrame(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): string;
}
