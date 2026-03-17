/**
 * TerrainApp: top-level engine facade.
 * Framework-agnostic — no DOM creation, no UI knowledge.
 * Uses a RendererBackend to abstract WebGL vs WebGPU differences.
 */

import * as THREE from 'three';
import type { WebGLRenderer, Scene, PerspectiveCamera, MeshStandardMaterial } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TerrainAppOptions, TerrainUpdateResult, ChunkSlot, FoliageSystem, TextureSet, TerrainMaterials } from './types';
import type { DprController } from './controls/dprController';
import type { RendererBackend, RendererMode } from './backend/types';

import { getBackend } from './backend';
import { createOrbitMovement } from './controls/orbitMovement';
import { createDprController } from './controls/dprController';
import { loadTextureSet } from './materials/textureSet';
import { createTerrainMaterials } from './materials/terrainMaterial';
import { createChunkSlot, rebuildChunkSlot, lodForRingPos } from './terrain/chunkGeometry';
import { createFoliageSystem } from './foliage/foliageSystem';
import { CHUNK_SIZE, BASE_GRID_RADIUS, MAX_GRID_RADIUS, SHALLOW_PITCH_THRESHOLD, FOLIAGE_ENV_INTENSITY } from './config';
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
  private _activeRadius: number;

  /** Async factory — resolves backend + lazy material imports. */
  static async createAsync(container: HTMLElement, opts: TerrainAppOptions = {}): Promise<TerrainApp> {
    const backend = await getBackend(opts.rendererMode || 'webgl');
    const { renderer, reversedDepthSupported } = await backend.createRenderer({
      preserveDrawingBuffer: opts.debug,
    });

    // Lazy-load WebGPU material only when needed (keeps main bundle smaller)
    let materialFactory: ((textures: TextureSet) => TerrainMaterials) | undefined;
    if (backend.mode === 'webgpu') {
      const { createNodeTerrainMaterials } = await import('./materials/terrainMaterialNode');
      materialFactory = createNodeTerrainMaterials;
    }

    return new TerrainApp(container, opts, backend, renderer, reversedDepthSupported, materialFactory);
  }

  private constructor(
    container: HTMLElement,
    opts: TerrainAppOptions,
    backend: RendererBackend,
    renderer: WebGLRenderer,
    reversedDepthSupported: boolean,
    webgpuMaterialFactory?: (textures: TextureSet) => TerrainMaterials,
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
    const env = backend.createEnvironment();
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
    const { matDisp, matNoDisp } = webgpuMaterialFactory
      ? webgpuMaterialFactory(this.textures)
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

    // Chunk pool — preallocate max radius, activate based on camera pitch
    this.slots = [];
    this.centerCX = Infinity;
    this.centerCZ = Infinity;
    this._activeRadius = BASE_GRID_RADIUS;
    this._buildSlots();
    this.updateChunks();
    this._updateSlotVisibility();

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
    for (let dz = -MAX_GRID_RADIUS; dz <= MAX_GRID_RADIUS; dz++) {
      for (let dx = -MAX_GRID_RADIUS; dx <= MAX_GRID_RADIUS; dx++) {
        const lod = lodForRingPos(dx, dz);
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
        // Foliage only for near/mid rings (d < 2)
        this.foliage.rebuild(slot.foliage, slot.cx, slot.cz, d >= BASE_GRID_RADIUS);
        rebuilt++;
      }
    }
    if (rebuilt > 0) {
      console.log(`[terrain] rebuilt ${rebuilt} slots, center: (${this.centerCX}, ${this.centerCZ})`);
    }
  }

  /** Compute active grid radius from camera pitch angle. */
  private _getActiveGridRadius(): number {
    const dir = this.controls.target.clone().sub(this.camera.position);
    dir.normalize();
    const pitchDeg = Math.asin(Math.max(-1, Math.min(1, dir.y))) * (180 / Math.PI);
    return Math.abs(pitchDeg) < SHALLOW_PITCH_THRESHOLD ? MAX_GRID_RADIUS : BASE_GRID_RADIUS;
  }

  /** Show/hide outer ring slots based on active radius. */
  private _updateSlotVisibility(): void {
    for (const slot of this.slots) {
      const d = Math.max(Math.abs(slot.dx), Math.abs(slot.dz));
      const visible = d <= this._activeRadius;
      slot.mesh.visible = visible;
      slot.foliage.grass.visible = visible;
      slot.foliage.rock.visible = visible;
      slot.foliage.shrub.visible = visible;
    }
  }

  update(): TerrainUpdateResult {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._prevTime) / 1000);
    this._prevTime = now;

    this._applyMovement(dt);
    this.controls.update();

    // Angle-aware outer ring activation
    const newRadius = this._getActiveGridRadius();
    if (newRadius !== this._activeRadius) {
      this._activeRadius = newRadius;
      this._updateSlotVisibility();
    }

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

  /**
   * Snapshot state — returns a plain JSON-safe object describing the
   * current engine/app runtime state. This is the "game state" for
   * the terrain playground (no formal gameplay yet).
   */
  getSnapshotState(): Record<string, unknown> {
    const cam = this.camera;
    const tgt = this.controls.target;

    // Direction from camera to target
    const dir = tgt.clone().sub(cam.position).normalize();

    // Yaw: angle of XZ direction from +Z axis (degrees)
    const yawRad = Math.atan2(dir.x, dir.z);
    const yawDeg = yawRad * (180 / Math.PI);

    // Pitch: angle above/below horizon (degrees)
    const pitchRad = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    const pitchDeg = pitchRad * (180 / Math.PI);

    // Orbit distance
    const distance = cam.position.distanceTo(tgt);

    return {
      timestamp: new Date().toISOString(),
      camera: {
        position: { x: cam.position.x, y: cam.position.y, z: cam.position.z },
        target: { x: tgt.x, y: tgt.y, z: tgt.z },
        direction: { x: dir.x, y: dir.y, z: dir.z },
        yawDeg: Math.round(yawDeg * 100) / 100,
        pitchDeg: Math.round(pitchDeg * 100) / 100,
        distance: Math.round(distance * 100) / 100,
        fov: cam.fov,
      },
      terrain: {
        centerCell: { x: this.centerCX, z: this.centerCZ },
        slotCount: this.slots.length,
        activeRadius: this._activeRadius,
        activeSlots: this.slots.filter(s => s.mesh.visible).length,
      },
      app: {
        rendererMode: this.rendererMode,
        reversedDepthSupported: this.reversedDepthSupported,
        iblEnabled: this._iblEnabled,
        dpr: { mode: this.dpr.ctrl.mode, current: this.dpr.ctrl.current },
        debug: this.debug,
        url: location.href,
        query: Object.fromEntries(new URLSearchParams(location.search)),
      },
      // Current runtime state — "game state" for the terrain playground
      gameState: {
        description: 'Terrain playground runtime snapshot — no formal gameplay state yet',
        rendererMode: this.rendererMode,
        iblEnabled: this._iblEnabled,
        dpr: this.dpr.ctrl.current,
        centerCell: { x: this.centerCX, z: this.centerCZ },
      },
    };
  }
}
