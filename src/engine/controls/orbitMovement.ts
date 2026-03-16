/**
 * OrbitControls + WASD/arrow keyboard movement.
 */

import * as THREE from 'three';
import type { PerspectiveCamera } from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

const _fwd = new THREE.Vector3();
const _right = new THREE.Vector3();
const _delta = new THREE.Vector3();

export interface OrbitMovement {
  controls: OrbitControls;
  applyMovement: (dt: number) => void;
}

export function createOrbitMovement(camera: PerspectiveCamera, domElement: HTMLElement): OrbitMovement {
  const controls = new OrbitControls(camera, domElement);
  controls.target.set(0, 5, 0);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.maxPolarAngle = Math.PI / 2.05;
  controls.minDistance = 3;
  controls.maxDistance = 300;
  controls.update();

  const moveState = { forward: false, back: false, left: false, right: false, fast: false };

  function setMoveKey(code: string, down: boolean): boolean {
    if (code === 'KeyW' || code === 'ArrowUp')        moveState.forward = down;
    else if (code === 'KeyS' || code === 'ArrowDown')  moveState.back = down;
    else if (code === 'KeyA' || code === 'ArrowLeft')  moveState.left = down;
    else if (code === 'KeyD' || code === 'ArrowRight') moveState.right = down;
    else if (code === 'ShiftLeft' || code === 'ShiftRight') moveState.fast = down;
    else return false;
    return true;
  }

  window.addEventListener('keydown', (e) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (document.activeElement && /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) return;
    if (setMoveKey(e.code, true)) e.preventDefault();
  });
  window.addEventListener('keyup', (e) => { setMoveKey(e.code, false); });

  function applyMovement(dt: number) {
    _fwd.copy(controls.target).sub(camera.position);
    _fwd.y = 0;
    if (_fwd.lengthSq() < 1e-6) return;
    _fwd.normalize();
    _right.crossVectors(_fwd, camera.up).normalize();

    _delta.set(0, 0, 0);
    if (moveState.forward) _delta.add(_fwd);
    if (moveState.back)    _delta.sub(_fwd);
    if (moveState.right)   _delta.add(_right);
    if (moveState.left)    _delta.sub(_right);
    if (_delta.lengthSq() === 0) return;

    const speed = moveState.fast ? 55 : 28;
    _delta.normalize().multiplyScalar(speed * dt);
    camera.position.add(_delta);
    controls.target.add(_delta);
  }

  return { controls, applyMovement };
}
