/**
 * TerrainApp: top-level engine facade.
 * Framework-agnostic — no DOM creation, no UI knowledge.
 */

import * as THREE from 'three';
import type { WebGLRenderer, Scene, PerspectiveCamera, MeshStandardMaterial } from 'three';
import type { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { TerrainAppOptions, TerrainUpdateResult, ChunkSlot, FoliageSystem, TextureSet } from './types';
import type { DprController } from './controls/dprController';

import { createRenderer, type RendererMode, type RendererResult } from './core/renderer';
import { createScene, createCamera, createLighting } from './core/renderer';
import { createWebGPURenderer, createWebGPUScene, createWebGPUCamera, createWebGPULighting } from './core/rendererWebGPU';
import { createEnvironment } from './core/environment';
import { createOrbitMovement } from './controls/orbitMovement';
import { createDprController } from './controls/dprController';
import { loadTextureSet } from './materials/textureSet';
import { createTerrainMaterials } from './materials/terrainMaterial';
import { createNodeTerrainMaterials } from './materials/terrainMaterialNode';
import { createChunkSlot, rebuildChunkSlot } from './terrain/chunkGeometry';
import { createFoliageSystem } from './foliage/foliageSystem';
import { CHUNK_SIZE, LOD_NEAR, LOD_MID, LOD_FAR, GRID_RADIUS, TERRAIN_ENV_INTENSITY, FOLIAGE_ENV_INTENSITY } from './config';

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

  private _applyMovement: (dt: number) => void;
  private _prevTime: number;
  private _iblEnabled: boolean;
  private _hemiLight: THREE.HemisphereLight;
  private _envMap: THREE.Texture;

  /** Async factory for WebGPU mode. Falls back to WebGL if unavailable. */
  static async createAsync(container: HTMLElement, opts: TerrainAppOptions = {}): Promise<TerrainApp> {
    if (opts.rendererMode === 'webgpu') {
      try {
        const result = await createWebGPURenderer();
        return new TerrainApp(container, opts, result);
      } catch (err) {
        console.warn('[terrain] WebGPU failed, falling back to WebGL:', err);
        return new TerrainApp(container, opts);
      }
    }
    return new TerrainApp(container, opts);
  }

  constructor(container: HTMLElement, opts: TerrainAppOptions = {}, prebuiltRenderer?: RendererResult) {
    this.debug = opts.debug || false;

    const { renderer, reversedDepthSupported, mode } = prebuiltRenderer
      ?? createRenderer({ preserveDrawingBuffer: this.debug });
    this.rendererMode = mode;
    this.renderer = renderer;
    this.reversedDepthSupported = reversedDepthSupported;

    // Use WebGPU-specific scene/camera/lights for proper node mapping
    if (this.rendererMode === 'webgpu') {
      this.scene = createWebGPUScene() as any;
      this.camera = createWebGPUCamera(window.innerWidth / window.innerHeight) as any;
      const lighting = createWebGPULighting(this.scene);
      this._hemiLight = lighting.hemi as any;
    } else {
      this.scene = createScene();
      this.camera = createCamera(window.innerWidth / window.innerHeight);
      const lighting = createLighting(this.scene);
      this._hemiLight = lighting.hemi;
    }

    // IBL: skip PMREM in WebGPU mode (PMREMGenerator uses WebGL internals)
    if (this.rendererMode !== 'webgpu') {
      const env = createEnvironment(this.renderer, this.scene);
      this._envMap = env.environmentMap;
      this._iblEnabled = true;
      lighting.sun.position.copy(env.sunDirection).multiplyScalar(50);
    } else {
      this._envMap = null!;
      this._iblEnabled = false;
      console.log('[terrain] IBL disabled in WebGPU mode (PMREM not compatible)');
    }

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
    // WebGPU mode: simple material (no onBeforeCompile)
    // WebGL mode: full biome/triplanar shader
    const { matDisp, matNoDisp } = this.rendererMode === 'webgpu'
      ? createNodeTerrainMaterials(this.textures)
      : createTerrainMaterials(this.textures);
    if (this._envMap) {
      matDisp.envMap = this._envMap;
      matDisp.envMapIntensity = TERRAIN_ENV_INTENSITY;
      matNoDisp.envMap = this._envMap;
      matNoDisp.envMapIntensity = TERRAIN_ENV_INTENSITY;
    }
    this.matDisp = matDisp;
    this.matNoDisp = matNoDisp;

    this.foliage = createFoliageSystem(this.scene, FOLIAGE_ENV_INTENSITY);

    this.slots = [];
    this.centerCX = Infinity;
    this.centerCZ = Infinity;
    this._buildSlots();
    this.updateChunks();

    this._prevTime = performance.now();
  }

  // ── IBL toggle ──
  // Pre-IBL baseline: hemi=0.6, env=0
  // IBL mode: hemi=0.5, env=TERRAIN_ENV_INTENSITY
  private static readonly HEMI_IBL_ON = 0.5;
  private static readonly HEMI_IBL_OFF = 0.6;

  isIblEnabled(): boolean {
    return this._iblEnabled;
  }

  setIblEnabled(enabled: boolean): void {
    this._iblEnabled = enabled;
    if (enabled) {
      this.matDisp.envMapIntensity = TERRAIN_ENV_INTENSITY;
      this.matNoDisp.envMapIntensity = TERRAIN_ENV_INTENSITY;
      this._hemiLight.intensity = TerrainApp.HEMI_IBL_ON;
    } else {
      this.matDisp.envMapIntensity = 0;
      this.matNoDisp.envMapIntensity = 0;
      this._hemiLight.intensity = TerrainApp.HEMI_IBL_OFF;
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

  /** Renderer-agnostic frame capture. Returns PNG data URL. */
  captureFrame(): string {
    // Render a clean frame
    this.controls.update();
    this.updateChunks();
    this.renderer.render(this.scene, this.camera);

    // For both WebGL and WebGPU: canvas.toDataURL works after render
    // WebGPU renderer preserves the framebuffer for one frame after render
    const canvas = this.renderer.domElement;
    return canvas.toDataURL('image/png');
  }
}
