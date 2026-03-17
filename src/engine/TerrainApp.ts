/**
 * TerrainApp: top-level engine facade.
 * WebGPU-only — uses TSL node materials.
 */

import * as THREE from 'three';
import type { Scene, PerspectiveCamera, MeshStandardMaterial } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TerrainAppOptions, TerrainUpdateResult, ChunkSlot, FoliageSystem, TextureSet, TerrainMaterials } from './types';
import type { DprController } from './controls/dprController';
import type { RendererBackend, RendererLike } from './backend/types';
import type { TerrainSource } from './terrain/terrainSource';
import type { WorldDocumentV0 } from './document';
import { applyDebugOverlay, type OverlayMode } from './terrain/debugOverlay';
import { generateFieldTextures, type FieldTextures } from './terrain/fieldTextures';

import { getBackend } from './backend';
import { createOrbitMovement } from './controls/orbitMovement';
import { createDprController } from './controls/dprController';
import { loadTextureSet } from './materials/textureSet';
import { createChunkSlot, rebuildChunkSlot, lodForRingPos } from './terrain/chunkGeometry';
import { createFoliageSystem } from './foliage/foliageSystem';
import {
  CHUNK_SIZE, BASE_GRID_RADIUS, SHALLOW_GRID_RADIUS, HORIZON_GRID_RADIUS,
  SHALLOW_PITCH_THRESHOLD, HORIZON_PITCH_THRESHOLD,
  HORIZON_DISTANCE_THRESHOLD, HORIZON_HEIGHT_THRESHOLD, HORIZON_FORWARD_DOT,
  FOLIAGE_ENV_INTENSITY,
} from './config';
import { TERRAIN_ENV_MAP_INTENSITY, HEMI_INTENSITY_IBL_ON, HEMI_INTENSITY_IBL_OFF } from './materials/terrain/featureModel';

export class TerrainApp {
  readonly debug: boolean;
  readonly renderer: RendererLike;
  readonly reversedDepthSupported: boolean;
  readonly scene: Scene;
  readonly camera: PerspectiveCamera;
  readonly controls: OrbitControls;
  readonly dpr: DprController;
  readonly textures: TextureSet;
  readonly matDisp: MeshStandardMaterial;
  readonly matNoDisp: MeshStandardMaterial;
  readonly foliage: FoliageSystem;
  readonly slots: ChunkSlot[];
  readonly terrain: TerrainSource;
  readonly document: WorldDocumentV0;

  centerCX: number;
  centerCZ: number;

  private _backend: RendererBackend;
  private _applyMovement: (dt: number) => void;
  private _prevTime: number;
  private _iblEnabled: boolean;
  private _clayMode: boolean;
  private _hemiLight: THREE.HemisphereLight;
  private _sunLight: THREE.DirectionalLight;
  private _envMap: THREE.Texture;
  private _coverageMode: 'base' | 'shallow' | 'horizon';
  private _activeRadius: number;
  private _clayMatDisp: MeshStandardMaterial | null;
  private _clayMatNoDisp: MeshStandardMaterial | null;
  private _overlayMode: OverlayMode;

  /** Async factory — initializes WebGPU backend + TSL materials. */
  static async createAsync(
    container: HTMLElement,
    doc: WorldDocumentV0,
    terrainSource: TerrainSource,
    opts: TerrainAppOptions = {},
  ): Promise<TerrainApp> {
    const backend = await getBackend();
    const { renderer, reversedDepthSupported } = await backend.createRenderer({
      preserveDrawingBuffer: opts.debug,
    });

    // Generate field textures from the terrain source for material blending
    // Use deposition map from erosion if available
    const erodedSource = terrainSource as any;
    const depositionMap = erodedSource.depositionMap ?? null;
    const erosionGridSize = erodedSource._gridSize ?? null;
    const erosionExtent = erodedSource._extent ?? 200;
    const fieldTextures = generateFieldTextures(
      terrainSource, 256, erosionExtent,
      depositionMap, erosionGridSize,
    );

    const { createNodeTerrainMaterials } = await import('./materials/terrainMaterialNode');
    return new TerrainApp(container, doc, terrainSource, opts, backend, renderer, reversedDepthSupported, createNodeTerrainMaterials, fieldTextures);
  }

  private constructor(
    container: HTMLElement,
    doc: WorldDocumentV0,
    terrainSource: TerrainSource,
    opts: TerrainAppOptions,
    backend: RendererBackend,
    renderer: RendererLike,
    reversedDepthSupported: boolean,
    materialFactory: (textures: TextureSet, fieldMap?: any, fieldExtent?: number) => TerrainMaterials,
    fieldTextures: FieldTextures | null,
  ) {
    this.debug = opts.debug || false;
    this.document = doc;
    this.terrain = terrainSource;
    this._backend = backend;
    this.renderer = renderer;
    this.reversedDepthSupported = reversedDepthSupported;

    this.scene = backend.createScene() as Scene;
    this.camera = backend.createCamera(window.innerWidth / window.innerHeight) as PerspectiveCamera;
    const lighting = backend.createLighting(this.scene);
    this._hemiLight = lighting.hemi as THREE.HemisphereLight;
    this._sunLight = lighting.sun as THREE.DirectionalLight;

    // IBL
    const env = backend.createEnvironment();
    this._envMap = env.environmentMap;
    this._iblEnabled = true;
    this._clayMode = false;
    this._clayMatDisp = null;
    this._clayMatNoDisp = null;
    this._overlayMode = 'none';
    this._sunLight.position.copy(env.sunDirection).multiplyScalar(50);
    (this.scene as any).add(this._sunLight.target);

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

    // Materials — TSL/WebGPU (field-driven if available)
    this.textures = loadTextureSet(this.renderer);
    const { matDisp, matNoDisp } = materialFactory(
      this.textures,
      fieldTextures?.fieldMap,
      fieldTextures?.extent,
    );
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
    this._coverageMode = 'base';
    this._activeRadius = BASE_GRID_RADIUS;
    this._buildSlots();
    this.updateChunks();
    this._updateSlotVisibility();

    this._prevTime = performance.now();
  }

  // ── IBL toggle ──

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

  // ── Clay mode toggle ──

  isClayMode(): boolean { return this._clayMode; }

  setClayMode(enabled: boolean): void {
    this._clayMode = enabled;

    // Create clay materials lazily
    if (enabled && !this._clayMatDisp) {
      const clay = new THREE.MeshStandardMaterial({
        color: 0xc8c0b8,
        roughness: 0.85,
        metalness: 0,
      });
      this._clayMatDisp = clay;
      this._clayMatNoDisp = clay;
    }

    const matD = enabled ? this._clayMatDisp! : this.matDisp;
    const matN = enabled ? this._clayMatNoDisp! : this.matNoDisp;

    // Swap materials on all chunk meshes
    for (const slot of this.slots) {
      slot.mesh.material = slot.lod.displacement ? matD : matN;
    }

    // Hide/show foliage
    for (const slot of this.slots) {
      if (enabled) {
        slot.foliage.grass.visible = false;
        slot.foliage.rock.visible = false;
        slot.foliage.shrub.visible = false;
      }
    }
    if (!enabled) {
      this._updateSlotVisibility();
    }

    // Disable fog in clay mode for cleaner shape evaluation
    if (enabled) {
      (this.scene as any).fog = null;
    } else {
      (this.scene as any).fog = new THREE.FogExp2(0x87ceeb, 0.0015);
    }
  }

  toggleClayMode(): boolean {
    this.setClayMode(!this._clayMode);
    return this._clayMode;
  }

  // ── Debug overlay ──

  getOverlayMode(): OverlayMode { return this._overlayMode; }

  setOverlayMode(mode: OverlayMode): void {
    this._overlayMode = mode;
    this._applyOverlayToAllSlots();
  }

  cycleOverlay(): OverlayMode {
    const modes: OverlayMode[] = ['none', 'slope', 'curvature', 'flow'];
    const idx = modes.indexOf(this._overlayMode);
    this._overlayMode = modes[(idx + 1) % modes.length];
    this._applyOverlayToAllSlots();
    return this._overlayMode;
  }

  private _applyOverlayToAllSlots(): void {
    for (const slot of this.slots) {
      if (slot.mesh.visible) {
        applyDebugOverlay(slot, this.terrain, this._overlayMode);
      }
    }
  }

  private _buildSlots(): void {
    for (let dz = -HORIZON_GRID_RADIUS; dz <= HORIZON_GRID_RADIUS; dz++) {
      for (let dx = -HORIZON_GRID_RADIUS; dx <= HORIZON_GRID_RADIUS; dx++) {
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
      if (rebuildChunkSlot(slot, this.centerCX, this.centerCZ, this.terrain)) {
        const d = Math.max(Math.abs(slot.dx), Math.abs(slot.dz));
        this.foliage.rebuild(slot.foliage, slot.cx, slot.cz, d >= BASE_GRID_RADIUS, this.terrain);
        // Recompute overlay for rebuilt slots
        if (this._overlayMode !== 'none' && slot.mesh.visible) {
          applyDebugOverlay(slot, this.terrain, this._overlayMode);
        }
        rebuilt++;
      }
    }
    if (rebuilt > 0) {
      console.log(`[terrain] rebuilt ${rebuilt} slots, center: (${this.centerCX}, ${this.centerCZ})`);
    }
  }

  private _computeCoverageMode(): { mode: 'base' | 'shallow' | 'horizon'; radius: number } {
    const dir = this.controls.target.clone().sub(this.camera.position);
    const distance = dir.length();
    dir.normalize();
    const absPitch = Math.abs(Math.asin(Math.max(-1, Math.min(1, dir.y))) * (180 / Math.PI));
    const heightAboveTarget = this.camera.position.y - this.controls.target.y;

    if (absPitch < HORIZON_PITCH_THRESHOLD &&
        (distance > HORIZON_DISTANCE_THRESHOLD || heightAboveTarget > HORIZON_HEIGHT_THRESHOLD)) {
      return { mode: 'horizon', radius: HORIZON_GRID_RADIUS };
    }
    if (absPitch < SHALLOW_PITCH_THRESHOLD) {
      return { mode: 'shallow', radius: SHALLOW_GRID_RADIUS };
    }
    return { mode: 'base', radius: BASE_GRID_RADIUS };
  }

  private _updateSlotVisibility(): void {
    const dir = this.controls.target.clone().sub(this.camera.position);
    dir.y = 0;
    const dirLen = dir.length();
    if (dirLen > 1e-6) dir.divideScalar(dirLen);

    for (const slot of this.slots) {
      const d = Math.max(Math.abs(slot.dx), Math.abs(slot.dz));
      const wasVisible = slot.mesh.visible;
      let visible: boolean;

      if (d <= SHALLOW_GRID_RADIUS) {
        visible = d <= this._activeRadius;
      } else if (this._coverageMode !== 'horizon') {
        visible = false;
      } else {
        const toChunkX = slot.dx;
        const toChunkZ = slot.dz;
        const toChunkLen = Math.sqrt(toChunkX * toChunkX + toChunkZ * toChunkZ) || 1;
        const forwardDot = (dir.x * toChunkX + dir.z * toChunkZ) / toChunkLen;
        visible = forwardDot > HORIZON_FORWARD_DOT;
      }

      slot.mesh.visible = visible;
      if (!this._clayMode) {
        slot.foliage.grass.visible = visible;
        slot.foliage.rock.visible = visible;
        slot.foliage.shrub.visible = visible;
      }

      // Apply overlay to newly visible slots
      if (visible && !wasVisible && this._overlayMode !== 'none') {
        applyDebugOverlay(slot, this.terrain, this._overlayMode);
      }
    }
  }

  update(): TerrainUpdateResult {
    const now = performance.now();
    const dt = Math.min(0.05, (now - this._prevTime) / 1000);
    this._prevTime = now;

    this._applyMovement(dt);
    this.controls.update();

    const { mode, radius } = this._computeCoverageMode();
    if (mode !== this._coverageMode || radius !== this._activeRadius) {
      this._coverageMode = mode;
      this._activeRadius = radius;
      this._updateSlotVisibility();
    } else if (mode === 'horizon') {
      this._updateSlotVisibility();
    }

    this.updateChunks();

    // Keep shadow camera centered on orbit target
    const tgt = this.controls.target;
    this._sunLight.target.position.copy(tgt);
    this._sunLight.target.updateMatrixWorld();
    this._sunLight.position.copy(tgt).add(
      new THREE.Vector3(30, 50, 20).normalize().multiplyScalar(100)
    );

    this.renderer.render(this.scene, this.camera);

    return { now, dt };
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.dpr.ctrl.current);
    this.renderer.setSize(w, h);
  }

  captureFrame(): string {
    this.controls.update();
    this.updateChunks();
    return this._backend.captureFrame(this.renderer, this.scene, this.camera);
  }

  getSnapshotState(): Record<string, unknown> {
    const cam = this.camera;
    const tgt = this.controls.target;

    const dir = tgt.clone().sub(cam.position).normalize();
    const yawDeg = Math.atan2(dir.x, dir.z) * (180 / Math.PI);
    const pitchDeg = Math.asin(Math.max(-1, Math.min(1, dir.y))) * (180 / Math.PI);
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
        coverageMode: this._coverageMode,
      },
      app: {
        renderer: 'webgpu',
        reversedDepthSupported: this.reversedDepthSupported,
        iblEnabled: this._iblEnabled,
        dpr: { mode: this.dpr.ctrl.mode, current: this.dpr.ctrl.current },
        debug: this.debug,
        url: location.href,
        query: Object.fromEntries(new URLSearchParams(location.search)),
      },
      gameState: {
        description: 'Terrain playground runtime snapshot — no formal gameplay state yet',
        renderer: 'webgpu',
        iblEnabled: this._iblEnabled,
        dpr: this.dpr.ctrl.current,
        centerCell: { x: this.centerCX, z: this.centerCZ },
      },
    };
  }
}
