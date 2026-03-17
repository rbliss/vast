/**
 * WebGL renderer backend.
 * Uses standard three.js WebGLRenderer + onBeforeCompile materials.
 */

import * as THREE from 'three';
import type { RendererBackend, BackendRenderer, BackendLighting, BackendEnvironment } from './types';
import { generateEnvironment } from '../core/environment';

export const webglBackend: RendererBackend = {
  mode: 'webgl',

  async createRenderer(opts = {}) {
    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      preserveDrawingBuffer: opts.preserveDrawingBuffer || false,
      reversedDepthBuffer: true,
    });
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.0;

    const reversedDepthSupported = renderer.capabilities.reversedDepthBuffer === true;
    console.log(`[backend:webgl] renderer created (revZ: ${reversedDepthSupported})`);

    return { renderer, reversedDepthSupported };
  },

  createScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x87ceeb);
    scene.fog = new THREE.FogExp2(0x87ceeb, 0.005);
    return scene;
  },

  createCamera(aspect: number) {
    const camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 1200);
    camera.position.set(50, 50, 50);
    return camera;
  },

  createLighting(scene) {
    const sun = new THREE.DirectionalLight(0xfff4e6, 2.5);
    sun.position.set(30, 50, 20);
    scene.add(sun);

    const hemi = new THREE.HemisphereLight(0x87ceeb, 0x556b2f, 0.5);
    scene.add(hemi);

    const fill = new THREE.DirectionalLight(0xadd8e6, 0.4);
    fill.position.set(-20, 10, -20);
    scene.add(fill);

    return { sun, hemi, fill };
  },

  createEnvironment() {
    return generateEnvironment();
  },

  captureFrame(renderer, scene, camera) {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL('image/png');
  },
};
