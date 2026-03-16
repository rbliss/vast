/**
 * TerrainApp: top-level engine facade.
 * Framework-agnostic — no DOM creation, no UI knowledge.
 * Composes: renderer, scene, camera, controls, terrain, foliage, DPR.
 */

import { createRenderer, createScene, createCamera, createLighting } from './core/renderer.js';
import { createOrbitMovement } from './controls/orbitMovement.js';
import { createDprController } from './controls/dprController.js';

export class TerrainApp {
  /**
   * @param {HTMLElement} container — element to append the canvas to
   * @param {object} opts
   * @param {boolean} opts.debug
   * @param {string} opts.dprMode — 'auto' | 'fixed'
   * @param {number} opts.dprInitial
   */
  constructor(container, opts = {}) {
    this.container = container;
    this.debug = opts.debug || false;

    // Core
    this.renderer = createRenderer({ preserveDrawingBuffer: this.debug });
    this.scene = createScene();
    this.camera = createCamera(window.innerWidth / window.innerHeight);
    this.lighting = createLighting(this.scene);

    // DPR
    this.dpr = createDprController(this.renderer, {
      mode: opts.dprMode || 'fixed',
      initial: opts.dprInitial,
    });

    // Apply initial size
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    // Controls
    const { controls, applyMovement } = createOrbitMovement(this.camera, this.renderer.domElement);
    this.controls = controls;
    this.applyMovement = applyMovement;

    // Timing
    this._prevTime = performance.now();
    this._centerCX = Infinity;
    this._centerCZ = Infinity;

    // Subsystems set externally after construction
    this.updateChunks = null;   // set by terrain system
    this.slots = [];
  }

  get centerCX() { return this._centerCX; }
  get centerCZ() { return this._centerCZ; }
  set centerCX(v) { this._centerCX = v; }
  set centerCZ(v) { this._centerCZ = v; }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.dpr.ctrl.current);
    this.renderer.setSize(w, h);
  }

  update() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._prevTime) / 1000);
    this._prevTime = now;

    this.applyMovement(dt);
    this.controls.update();
    if (this.updateChunks) this.updateChunks();
    this.renderer.render(this.scene, this.camera);

    return { now, dt };
  }

  setDprMode(mode, value) {
    this.dpr.setMode(mode, value);
  }

  takeScreenshotDataURL() {
    // Render one clean frame then capture
    this.controls.update();
    if (this.updateChunks) this.updateChunks();
    this.renderer.render(this.scene, this.camera);

    const THREE = this.renderer.constructor;
    // Defer to caller for the actual capture — they have THREE in scope
    return null;
  }
}
