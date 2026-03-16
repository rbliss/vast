/**
 * TerrainApp: top-level engine facade.
 * Framework-agnostic — no DOM creation, no UI knowledge.
 */

import type { WebGLRenderer, Scene, PerspectiveCamera, MeshStandardMaterial } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TerrainAppOptions, TerrainUpdateResult, ChunkSlot, FoliageSystem, TextureSet } from './types';
import type { DprController } from './controls/dprController';

import { createRenderer, createScene, createCamera, createLighting } from './core/renderer';
import { createOrbitMovement } from './controls/orbitMovement';
import { createDprController } from './controls/dprController';
import { loadTextureSet } from './materials/textureSet';
import { createTerrainMaterials } from './materials/terrainMaterial';
import { createChunkSlot, rebuildChunkSlot } from './terrain/chunkGeometry';
import { createFoliageSystem } from './foliage/foliageSystem';
import { CHUNK_SIZE, LOD_NEAR, LOD_MID, LOD_FAR, GRID_RADIUS } from './config';

export class TerrainApp {
  readonly debug: boolean;
  readonly renderer: WebGLRenderer;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly dpr: DprController;
  readonly textures: TextureSet;
  readonly matDisp: MeshStandardMaterial;
  readonly matNoDisp: MeshStandardMaterial;
  readonly foliage: FoliageSystem;
  readonly slots: ChunkSlot[];

  centerCX: number;
  centerCZ: number;

  private _applyMovement: (dt: number) => void;
  private _prevTime: number;

  constructor(container: HTMLElement, opts: TerrainAppOptions = {}) {
    this.debug = opts.debug || false;

    this.renderer = createRenderer({ preserveDrawingBuffer: this.debug });
    this.scene = createScene();
    this.camera = createCamera(window.innerWidth / window.innerHeight);
    createLighting(this.scene);

    this.dpr = createDprController(this.renderer, {
      mode: opts.dprMode || 'fixed',
      initial: opts.dprInitial,
    });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    container.appendChild(this.renderer.domElement);

    const { controls, applyMovement } = createOrbitMovement(this.camera, this.renderer.domElement);
    this.controls = controls;
    this._applyMovement = applyMovement;

    this.textures = loadTextureSet(this.renderer);
    const { matDisp, matNoDisp } = createTerrainMaterials(this.textures);
    this.matDisp = matDisp;
    this.matNoDisp = matNoDisp;

    this.foliage = createFoliageSystem(this.scene);

    this.slots = [];
    this.centerCX = Infinity;
    this.centerCZ = Infinity;
    this._buildSlots();
    this.updateChunks();

    this._prevTime = performance.now();
  }

  private _buildSlots(): void {
    for (let dz = -GRID_RADIUS; dz <= GRID_RADIUS; dz++) {
      for (let dx = -GRID_RADIUS; dx <= GRID_RADIUS; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        const lod = d === 0 ? LOD_NEAR : d === 1 ? LOD_MID : LOD_FAR;
        const slot = createChunkSlot(lod, dx, dz, this.scene, this.matDisp, this.matNoDisp) as ChunkSlot;
        slot.foliage = this.foliage.createInstances();
        this.slots.push(slot);
      }
    }
    console.log(`[terrain] ${this.slots.length} permanent slots + foliage created`);
  }

  updateChunks(): void {
    const camCX = Math.round(this.controls.target.x / CHUNK_SIZE);
    const camCZ = Math.round(this.controls.target.z / CHUNK_SIZE);
    if (camCX === this.centerCX && camCZ === this.centerCZ) return;
    this.centerCX = camCX;
    this.centerCZ = camCZ;

    let rebuilt = 0;
    for (const slot of this.slots) {
      if (rebuildChunkSlot(slot, this.centerCX, this.centerCZ)) {
        const d = Math.max(Math.abs(slot.dx), Math.abs(slot.dz));
        this.foliage.rebuild(slot.foliage!, slot.cx, slot.cz, d >= GRID_RADIUS);
        rebuilt++;
      }
    }
    if (rebuilt > 0) {
      console.log(`[terrain] rebuilt ${rebuilt} slots, center: (${this.centerCX}, ${this.centerCZ})`);
    }
  }

  update(): TerrainUpdateResult {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._prevTime) / 1000);
    this._prevTime = now;

    this._applyMovement(dt);
    this.controls.update();
    this.updateChunks();
    this.renderer.render(this.scene, this.camera);

    return { now, dt };
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.dpr.ctrl.current);
    this.renderer.setSize(w, h);
  }
}
