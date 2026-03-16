/**
 * TerrainApp: top-level engine facade.
 * Framework-agnostic — no DOM creation, no UI knowledge.
 * Composes: renderer, scene, camera, controls, DPR, terrain, foliage.
 */

import * as THREE from 'three';
import { createRenderer, createScene, createCamera, createLighting } from './core/renderer.js';
import { createOrbitMovement } from './controls/orbitMovement.js';
import { createDprController } from './controls/dprController.js';
import { loadTextureSet } from './materials/textureSet.js';
import { createTerrainMaterials } from './materials/terrainMaterial.js';
import { createChunkSlot, rebuildChunkSlot } from './terrain/chunkGeometry.js';
import { createFoliageSystem } from './foliage/foliageSystem.js';
import {
  CHUNK_SIZE, LOD_NEAR, LOD_MID, LOD_FAR, GRID_RADIUS,
} from './config.js';

export class TerrainApp {
  constructor(container, opts = {}) {
    this.debug = opts.debug || false;

    // Core rendering
    this.renderer = createRenderer({ preserveDrawingBuffer: this.debug });
    this.scene = createScene();
    this.camera = createCamera(window.innerWidth / window.innerHeight);
    createLighting(this.scene);

    // DPR
    this.dpr = createDprController(this.renderer, {
      mode: opts.dprMode || 'fixed',
      initial: opts.dprInitial,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    // Controls
    const { controls, applyMovement } = createOrbitMovement(this.camera, this.renderer.domElement);
    this.controls = controls;
    this._applyMovement = applyMovement;

    // Textures + materials
    this.textures = loadTextureSet(this.renderer);
    const { matDisp, matNoDisp } = createTerrainMaterials(this.textures);
    this.matDisp = matDisp;
    this.matNoDisp = matNoDisp;

    // Foliage system
    this.foliage = createFoliageSystem(this.scene);

    // Chunk pool
    this.slots = [];
    this.centerCX = Infinity;
    this.centerCZ = Infinity;
    this._buildSlots();
    this.updateChunks();

    // Timing
    this._prevTime = performance.now();
  }

  _buildSlots() {
    for (let dz = -GRID_RADIUS; dz <= GRID_RADIUS; dz++) {
      for (let dx = -GRID_RADIUS; dx <= GRID_RADIUS; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        const lod = d === 0 ? LOD_NEAR : d === 1 ? LOD_MID : LOD_FAR;
        const slot = createChunkSlot(lod, dx, dz, this.scene, this.matDisp, this.matNoDisp);
        slot.foliage = this.foliage.createInstances();
        this.slots.push(slot);
      }
    }
    console.log(`[terrain] ${this.slots.length} permanent slots + foliage created`);
  }

  updateChunks() {
    const camCX = Math.round(this.controls.target.x / CHUNK_SIZE);
    const camCZ = Math.round(this.controls.target.z / CHUNK_SIZE);
    if (camCX === this.centerCX && camCZ === this.centerCZ) return;
    this.centerCX = camCX;
    this.centerCZ = camCZ;

    let rebuilt = 0;
    for (const slot of this.slots) {
      if (rebuildChunkSlot(slot, this.centerCX, this.centerCZ)) {
        const d = Math.max(Math.abs(slot.dx), Math.abs(slot.dz));
        this.foliage.rebuild(slot.foliage, slot.cx, slot.cz, d >= GRID_RADIUS);
        rebuilt++;
      }
    }
    if (rebuilt > 0) {
      console.log(`[terrain] rebuilt ${rebuilt} slots, center: (${this.centerCX}, ${this.centerCZ})`);
    }
  }

  update() {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._prevTime) / 1000);
    this._prevTime = now;

    this._applyMovement(dt);
    this.controls.update();
    this.updateChunks();
    this.renderer.render(this.scene, this.camera);

    return { now, dt };
  }

  resize(w, h) {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.dpr.ctrl.current);
    this.renderer.setSize(w, h);
  }
}
