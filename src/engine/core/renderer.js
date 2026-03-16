/**
 * Renderer, scene, camera, and lighting setup.
 * No DOM dependency beyond receiving a parent element.
 */

import * as THREE from 'three';

export function createRenderer(opts = {}) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true,
    preserveDrawingBuffer: opts.preserveDrawingBuffer || false,
  });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  return renderer;
}

export function createScene() {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x87ceeb);
  scene.fog = new THREE.FogExp2(0x87ceeb, 0.005);
  return scene;
}

export function createCamera(aspect) {
  const camera = new THREE.PerspectiveCamera(55, aspect, 0.1, 800);
  camera.position.set(50, 30, 50);
  return camera;
}

export function createLighting(scene) {
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
