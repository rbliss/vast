/**
 * Renderer, scene, camera, and lighting setup.
 */

import * as THREE from 'three';
import type { WebGLRenderer, Scene, PerspectiveCamera, DirectionalLight, HemisphereLight } from 'three';

interface RendererOpts {
  preserveDrawingBuffer?: boolean;
}

export interface RendererResult {
  renderer: WebGLRenderer;
  reversedDepthSupported: boolean;
}

interface Lighting {
  sun: DirectionalLight;
  hemi: HemisphereLight;
  fill: DirectionalLight;
}

export function createRenderer(opts: RendererOpts = {}): RendererResult {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: opts.preserveDrawingBuffer || false,
    reversedDepthBuffer: true,
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;

  const reversedDepthSupported = renderer.capabilities.reversedDepthBuffer === true;
  if (reversedDepthSupported) {
    console.log('[renderer] reversed depth buffer enabled');
  } else {
    console.log('[renderer] reversed depth buffer not supported, using standard depth');
  }

  return { renderer, reversedDepthSupported };
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

  const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556b2f, 0.6);
  scene.add(hemi);

  const fill = new THREE.DirectionalLight(0xadd8e6, 0.4);
  fill.position.set(-20, 10, -20);
  scene.add(fill);

  return { sun, hemi, fill };
}
