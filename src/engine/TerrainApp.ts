/**
 * TerrainApp: top-level engine facade.
 * Framework-agnostic — no DOM creation, no UI knowledge.
 * Uses a RendererBackend to abstract WebGL vs WebGPU differences.
 */

import * as THREE from 'three';
import type { WebGLRenderer, Scene, PerspectiveCamera, MeshStandardMaterial } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TerrainAppOptions, TerrainUpdateResult, ChunkSlot, FoliageSystem, TextureSet } from './types';
import type { DprController } from './controls/dprController';
import type { RendererBackend, RendererMode } from './backend/types';

import { getBackend } from './backend';
import { createOrbitMovement } from './controls/orbitMovement';
import { createDprController } from './controls/dprController';
import { loadTextureSet } from './materials/textureSet';
import { createTerrainMaterials } from './materials/terrainMaterial';
import { createNodeTerrainMaterials } from './materials/terrainMaterialNode';
import { createChunkSlot, rebuildChunkSlot } from './terrain/chunkGeometry';
import { createFoliageSystem } from './foliage/foliageSystem';
import { CHUNK_SIZE, LOD_NEAR, LOD_MID, LOD_FAR, GRID_RADIUS, FOLIAGE_ENV_INTENSITY } from './config';
import { TERRAIN_ENV_MAP_INTENSITY, HEMI_INTENSITY_IBL_ON, HEMI_INTENSITY_IBL_OFF } from './materials/terrain/featureModel';

export class TerrainApp {
  readonly debug: boolean;
  readonly renderer: WebGLRenderer;
  readonly reversedDepthSupported: boolean;
  readonly rendererMode: RendererMode;
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

  private _backend: RendererBackend;
  private _applyMovement: (dt: number) => void;
  private _prevTime: number;
  private _iblEnabled: boolean;
  private _hemiLight: THREE.HemisphereLight;
  private _envMap: THREE.Texture;

  /** Async factory — resolves backend, then constructs synchronously. */
  static async createAsync(container: HTMLElement, opts: TerrainAppOptions = {}): Promise<TerrainApp> {
    const backend = await getBackend(opts.rendererMode || 'webgl');
    const { renderer, reversedDepthSupported } = await backend.createRenderer({
      preserveDrawingBuffer: opts.debug,
    });
    return new TerrainApp(container, opts, backend, renderer, reversedDepthSupported);
  }

  private constructor(
    container: HTMLElement,
    opts: TerrainAppOptions,
    backend: RendererBackend,
    renderer: WebGLRenderer,
    reversedDepthSupported: boolean,
  ) {
    this.debug = opts.debug || false;
    this._backend = backend;
    this.rendererMode = backend.mode;
    this.renderer = renderer;
    this.reversedDepthSupported = reversedDepthSupported;

    // All scene primitives come from the backend — no renderer-specific branching here
    this.scene = backend.createScene() as Scene;
    this.camera = backend.createCamera(window.innerWidth / window.innerHeight) as PerspectiveCamera;
    const lighting = backend.createLighting(this.scene);
    this._hemiLight = lighting.hemi as THREE.HemisphereLight;

    // IBL
    const env = backend.createEnvironment(this.renderer, this.scene);
    this._envMap = env.environmentMap;
    this._iblEnabled = true;
    (lighting.sun as THREE.DirectionalLight).position.copy(env.sunDirection).multiplyScalar(50);

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

    // Materials — backend-specific
    this.textures = loadTextureSet(this.renderer);
    const { matDisp, matNoDisp } = this.rendererMode === 'webgpu'
      ? createNodeTerrainMaterials(this.textures)
      : createTerrainMaterials(this.textures);
    if (this._envMap) {
      matDisp.envMap = this._envMap;
      matDisp.envMapIntensity = TERRAIN_ENV_MAP_INTENSITY;
      matNoDisp.envMap = this._envMap;
      matNoDisp.envMapIntensity = TERRAIN_ENV_MAP_INTENSITY;
    }
    this.matDisp = matDisp;
    this.matNoDisp = matNoDisp;

    // Foliage
    this.foliage = createFoliageSystem(this.scene, FOLIAGE_ENV_INTENSITY);

    // Chunk pool
    this.slots = [];
    this.centerCX = Infinity;
    this.centerCZ = Infinity;
    this._buildSlots();
    this.updateChunks();

    this._prevTime = performance.now();
  }

  // ── IBL toggle ──
  // Hemi intensity values from shared feature model

  isIblEnabled(): boolean { return this._iblEnabled; }

  setIblEnabled(enabled: boolean): void {
    this._iblEnabled = enabled;
    if (enabled) {
      this.matDisp.envMapIntensity = TERRAIN_ENV_MAP_INTENSITY;
      this.matNoDisp.envMapIntensity = TERRAIN_ENV_MAP_INTENSITY;
      this._hemiLight.intensity = HEMI_INTENSITY_IBL_ON;
    } else {
      this.matDisp.envMapIntensity = 0;
      this.matNoDisp.envMapIntensity = 0;
      this._hemiLight.intensity = HEMI_INTENSITY_IBL_OFF;
    }
  }

  toggleIbl(): boolean {
    this.setIblEnabled(!this._iblEnabled);
    return this._iblEnabled;
  }

  private _buildSlots(): void {
    for (let dz = -GRID_RADIUS; dz <= GRID_RADIUS; dz++) {
      for (let dx = -GRID_RADIUS; dx <= GRID_RADIUS; dx++) {
        const d = Math.max(Math.abs(dx), Math.abs(dz));
        const lod = d === 0 ? LOD_NEAR : d === 1 ? LOD_MID : LOD_FAR;
        const foliagePayload = this.foliage.createInstances();
        const slot = createChunkSlot(lod, dx, dz, this.scene, this.matDisp, this.matNoDisp, foliagePayload);
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
        this.foliage.rebuild(slot.foliage, slot.cx, slot.cz, d >= GRID_RADIUS);
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

  /** Renderer-agnostic frame capture via backend. */
  captureFrame(): string {
    this.controls.update();
    this.updateChunks();
    return this._backend.captureFrame(this.renderer, this.scene, this.camera);
  }
}
