/**
 * Renderer backend interface.
 * TerrainApp consumes this — never imports three/webgpu directly.
 *
 * Note: renderer type uses three's WebGLRenderer as a duck-type base
 * since WebGPURenderer shares the same interface shape. This is a
 * pragmatic type alias, not an actual WebGL dependency.
 */

import type { WebGLRenderer, Scene, PerspectiveCamera, DirectionalLight, HemisphereLight, Texture } from 'three';

export interface BackendRenderer {
  /** The three.js renderer instance (WebGPURenderer duck-typed as WebGLRenderer) */
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
  createRenderer(opts?: { preserveDrawingBuffer?: boolean }): Promise<BackendRenderer>;
  createScene(): Scene;
  createCamera(aspect: number): PerspectiveCamera;
  createLighting(scene: Scene): BackendLighting;
  createEnvironment(): BackendEnvironment;
  captureFrame(renderer: WebGLRenderer, scene: Scene, camera: PerspectiveCamera): string;
}
