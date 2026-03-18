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
import type { TerrainSourceResult } from './terrain/terrainSource';
import { EditableHeightfield, type BrushStamp } from './terrain/editableHeightfield';
import { streamPowerErosion, DEFAULT_STREAM_POWER } from './terrain/streamPower';
import { applyChannelGeometry } from './terrain/channelGeometry';
import { applyHillslopeTransport } from './terrain/hillslopeTransport';
import { generateResistanceGrid } from './terrain/resistanceField';
import type { ScatterParams } from './foliage/foliageSystem';
import type { WorldDocument } from './document';
import type { TerrainBakeArtifacts } from './bake/types';
import type { TerrainDomainConfig } from './bake/terrainDomain';
import { applyDebugOverlay, type OverlayMode } from './terrain/debugOverlay';
import { generateFieldTextures, type FieldTextures } from './terrain/fieldTextures';
import { sunWarmthUniform, matSnowThreshold, matRockSlopeMin, matRockSlopeMax, matSedimentEmphasis } from './materials/terrainMaterialNode';
import { createWaterSystem, type WaterSystem, type WaterConfig, DEFAULT_WATER_CONFIG } from './water/waterSystem';
import { createCloudSystem, type CloudSystem } from './sky/cloudLayer';
import { createPresentationPipeline, type PresentationPipeline } from './postprocess/presentationPipeline';

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
  terrain: TerrainSource;
  readonly document: WorldDocument;

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
  private _water: WaterSystem | null;
  private _clouds: CloudSystem | null;
  private _exposure: number;
  private _presentationPipeline: PresentationPipeline | null;
  private _presentationMode: boolean;
  private _domain: TerrainDomainConfig | null;
  private _clayMatDisp: MeshStandardMaterial | null;
  private _clayMatNoDisp: MeshStandardMaterial | null;
  private _overlayMode: OverlayMode;
  private _fieldTextures: FieldTextures | null;
  private _sunAzimuth: number;  // degrees from north (0=N, 90=E, 180=S, 270=W)
  private _sunElevation: number; // degrees above horizon

  /** Async factory — initializes WebGPU backend + TSL materials. */
  static async createAsync(
    container: HTMLElement,
    doc: WorldDocument,
    terrainSource: TerrainSource,
    opts: TerrainAppOptions = {},
    bakeArtifacts?: TerrainBakeArtifacts | null,
    domain?: TerrainDomainConfig,
  ): Promise<TerrainApp> {
    const backend = await getBackend();
    const { renderer, reversedDepthSupported } = await backend.createRenderer({
      preserveDrawingBuffer: opts.debug,
    });

    // Generate field textures using domain config (single source of truth for extents)
    const extent = domain?.extent ?? 200;
    const fieldTextureSize = domain?.fieldTextureSize ?? 256;
    const depositionMap = bakeArtifacts?.depositionMap ?? null;
    const bakeGridSize = domain?.bakeGridSize || undefined;
    const fieldTextures = generateFieldTextures(
      terrainSource, fieldTextureSize, extent,
      depositionMap, bakeGridSize,
    );

    const { createNodeTerrainMaterials } = await import('./materials/terrainMaterialNode');
    return new TerrainApp(container, doc, terrainSource, opts, backend, renderer, reversedDepthSupported, createNodeTerrainMaterials, fieldTextures, domain);
  }

  private constructor(
    container: HTMLElement,
    doc: WorldDocument,
    terrainSource: TerrainSource,
    opts: TerrainAppOptions,
    backend: RendererBackend,
    renderer: RendererLike,
    reversedDepthSupported: boolean,
    materialFactory: (textures: TextureSet, fieldMap?: any, fieldExtent?: number) => TerrainMaterials,
    fieldTextures: FieldTextures | null,
    domain?: TerrainDomainConfig,
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
    this._fieldTextures = fieldTextures;
    this._sunAzimuth = 210;  // SW direction (default)
    this._sunElevation = 35; // moderate elevation for good shadow definition
    this._updateSunDirection();
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

    // Water (needs height texture for terrain-depth shading)
    const waterLevel = opts.waterLevel;
    if (waterLevel != null && fieldTextures) {
      this._water = createWaterSystem(
        this.scene as any,
        fieldTextures.heightMap,
        fieldTextures.extent,
        { ...DEFAULT_WATER_CONFIG, waterLevel },
      );
    } else {
      this._water = null;
    }

    // Clouds
    this._clouds = createCloudSystem(this.scene as any);

    // Exposure + presentation
    this._exposure = 1.0;
    this._presentationPipeline = null;
    this._presentationMode = false;
    this._domain = domain ?? null;

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

    // Note: fog/aerial perspective is now per-material in the terrain shader.
    // Clay mode uses its own material which has no aerial perspective.
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

  // ── Sun direction controls ──

  getSunAzimuth(): number { return this._sunAzimuth; }
  getSunElevation(): number { return this._sunElevation; }

  setSunDirection(azimuth: number, elevation: number): void {
    this._sunAzimuth = azimuth;
    this._sunElevation = Math.max(5, Math.min(85, elevation));
    this._updateSunDirection();
  }

  private _sunDirectionVector(): THREE.Vector3 {
    const azRad = (this._sunAzimuth * Math.PI) / 180;
    const elRad = (this._sunElevation * Math.PI) / 180;
    return new THREE.Vector3(
      Math.sin(azRad) * Math.cos(elRad),
      Math.sin(elRad),
      Math.cos(azRad) * Math.cos(elRad),
    );
  }

  private _updateSunDirection(): void {
    const dir = this._sunDirectionVector();
    this._sunLight.position.copy(dir).multiplyScalar(100);

    // Warmth factor: 0 = high sun (cool), 1 = low sun (warm)
    const warmth = 1 - this._sunElevation / 85;

    // Sun color: warm at low elevation
    const r = 1.0;
    const g = 0.95 - warmth * 0.1;
    const b = 0.9 - warmth * 0.25;
    (this._sunLight as any).color.setRGB(r, g, b);
    (this._sunLight as any).intensity = 2.2 + warmth * 0.8;

    // Hemisphere light: tint sky color warm to match sun
    const skyR = 0.53 + warmth * 0.15;
    const skyG = 0.52 + warmth * 0.05;
    const skyB = 0.58 - warmth * 0.12;
    (this._hemiLight as any).color.setRGB(skyR, skyG, skyB);

    // Background: tint to match atmosphere
    const bgR = 0.53 + warmth * 0.2;
    const bgG = 0.64 + warmth * 0.08;
    const bgB = 0.82 - warmth * 0.15;
    (this.scene as any).background.setRGB(bgR, bgG, bgB);

    // Update aerial perspective uniform
    sunWarmthUniform.value = warmth * 0.6; // damped so it's subtle
  }

  // ── Sculpt: raise terrain with brush stamps ──

  private _editableHF: EditableHeightfield | null = null;
  private _brushPreview: THREE.Mesh | null = null;

  get isEditable(): boolean { return this._editableHF !== null; }

  /** Create/update brush preview ring on terrain */
  updateBrushPreview(worldX: number, worldZ: number, radius: number): void {
    if (!this._brushPreview) {
      const geo = new THREE.RingGeometry(0.9, 1.0, 32);
      geo.rotateX(-Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xffffff,
        transparent: true,
        opacity: 0.5,
        depthTest: false,
      });
      this._brushPreview = new THREE.Mesh(geo, mat);
      this._brushPreview.renderOrder = 100;
      (this.scene as any).add(this._brushPreview);
    }
    const h = this.terrain.sampleHeight(worldX, worldZ);
    this._brushPreview.position.set(worldX, h + 0.2, worldZ);
    this._brushPreview.scale.set(radius, radius, radius);
    this._brushPreview.visible = true;
  }

  hideBrushPreview(): void {
    if (this._brushPreview) this._brushPreview.visible = false;
  }

  private _groundPlane: THREE.Mesh | null = null;

  /** Initialize editable heightfield mode (blank canvas) */
  initEditableMode(gridSize: number = 256, extent: number = 200, existing?: EditableHeightfield): void {
    this._editableHF = existing ?? new EditableHeightfield(gridSize, extent);
    this.terrain = this._editableHF;

    // Rebuild all slots at uniform LOD for seamless sculpting
    this._rebuildSlotsUniformLOD();

    // Add subtle fog for blank canvas — fades non-editable areas into haze
    (this.scene as any).fog = new THREE.FogExp2(0xc8c8d0, 0.0008);
    // Match background to fog color for seamless horizon
    (this.scene as any).background = new THREE.Color(0xc8c8d0);

    // Add large ground plane for horizon continuity
    this._addGroundPlane();
    // Force rebuild all chunks
    this.centerCX = Infinity;
    this.centerCZ = Infinity;
    this.updateChunks();

    // Hide chunks fully outside the editable extent (let gray plane show)
    const hfExtent = this._editableHF.extent;
    const halfChunk = CHUNK_SIZE / 2;
    for (const slot of this.slots) {
      const slotMinX = (this.centerCX + slot.dx) * CHUNK_SIZE - halfChunk;
      const slotMaxX = slotMinX + CHUNK_SIZE;
      const slotMinZ = (this.centerCZ + slot.dz) * CHUNK_SIZE - halfChunk;
      const slotMaxZ = slotMinZ + CHUNK_SIZE;

      // Fully outside editable extent?
      if (slotMinX > hfExtent || slotMaxX < -hfExtent ||
          slotMinZ > hfExtent || slotMaxZ < -hfExtent) {
        slot.mesh.visible = false;
      }
    }
  }

  /** Rebuild all slots at uniform LOD (eliminates LOD seams for sculpting) */
  private _rebuildSlotsUniformLOD(): void {
    // Remove existing slots from scene
    for (const slot of this.slots) {
      this.scene.remove(slot.mesh);
      this.scene.remove(slot.foliage.grass);
      this.scene.remove(slot.foliage.rock);
      this.scene.remove(slot.foliage.shrub);
    }
    this.slots.length = 0;

    // Use LOD_MID (64 segments) for all slots — uniform quality, no seams
    const uniformLod = { segments: 64, displacement: false };
    for (let dz = -HORIZON_GRID_RADIUS; dz <= HORIZON_GRID_RADIUS; dz++) {
      for (let dx = -HORIZON_GRID_RADIUS; dx <= HORIZON_GRID_RADIUS; dx++) {
        const foliagePayload = this.foliage.createInstances();
        const slot = createChunkSlot(uniformLod, dx, dz, this.scene, this.matDisp, this.matNoDisp, foliagePayload);
        slot.mesh.visible = true;
        slot.foliage.grass.visible = false;
        slot.foliage.rock.visible = false;
        slot.foliage.shrub.visible = false;
        this.slots.push(slot);
      }
    }
    console.log(`[terrain] rebuilt ${this.slots.length} slots at uniform LOD (${uniformLod.segments} segments)`);
  }

  /** Add a large ground plane extending far beyond the editable area — visually distinct gray */
  private _addGroundPlane(): void {
    if (this._groundPlane) return;
    const size = 6000; // extends ±3000 from center
    const geo = new THREE.PlaneGeometry(size, size, 8, 8);
    geo.rotateX(-Math.PI / 2);
    // Non-editable area: bluish-gray haze color, suggests distance/atmosphere
    const mat = new THREE.MeshStandardMaterial({
      color: 0xa8adb8,
      roughness: 0.95,
      metalness: 0,
      fog: true,
    });
    this._groundPlane = new THREE.Mesh(geo, mat);
    this._groundPlane.position.y = -0.1;
    this._groundPlane.receiveShadow = true;
    (this.scene as any).add(this._groundPlane);
  }

  beginStroke(): void { this._editableHF?.beginStroke(); }
  endStroke(): void { this._editableHF?.endStroke(); }

  /** Apply erosion pipeline to the sculpted heightfield */
  applyErosion(opts: {
    iterations?: number;
    erosionStrength?: number;
    channelGeometry?: boolean;
    hillslope?: boolean;
    resistance?: boolean;
  } = {}): void {
    if (!this._editableHF) return;

    const hf = this._editableHF;
    const grid = hf.grid;
    const n = hf.gridSize;
    const cs = hf.cellSize;
    const extent = hf.extent;

    // Save undo state (one entry for the whole erosion pass)
    hf.beginStroke();

    const t0 = performance.now();

    // Build erosion params — higher diffusion for smoother channels on sculpted terrain
    const spParams = {
      ...DEFAULT_STREAM_POWER,
      iterations: opts.iterations ?? 15,
      erosionK: opts.erosionStrength ?? 0.006,
      diffusionRate: 0.02, // higher than default (0.005) for smoother erosion on sculpt grids
    };

    // Resistance field
    const resistanceGen = opts.resistance !== false
      ? (heights: Float32Array) => generateResistanceGrid(heights, n, n, extent, cs)
      : undefined;

    // Stream-power erosion
    const spResult = streamPowerErosion(grid, n, n, cs, spParams, resistanceGen);
    console.log(`[erosion] stream-power: ${spParams.iterations} iterations`);

    // Channel geometry
    if (opts.channelGeometry !== false) {
      const chanResistance = opts.resistance !== false
        ? generateResistanceGrid(grid, n, n, extent, cs)
        : undefined;
      applyChannelGeometry(grid, spResult.area, spResult.receiver, n, n, cs, undefined, chanResistance);
      console.log(`[erosion] channel geometry`);
    }

    // Hillslope transport
    if (opts.hillslope !== false) {
      const hillResistance = opts.resistance !== false
        ? generateResistanceGrid(grid, n, n, extent, cs)
        : undefined;
      applyHillslopeTransport(grid, n, n, cs, undefined, hillResistance);
      console.log(`[erosion] hillslope transport`);
    }

    // Post-erosion smoothing: removes pixelated stair-stepping
    // while preserving channel structure
    const smoothPasses = 3;
    for (let pass = 0; pass < smoothPasses; pass++) {
      const tmp = new Float32Array(grid.length);
      tmp.set(grid);
      for (let z = 1; z < n - 1; z++) {
        for (let x = 1; x < n - 1; x++) {
          const idx = z * n + x;
          // 5-point average weighted toward center (preserves structure)
          const neighbors = grid[idx - 1] + grid[idx + 1] + grid[idx - n] + grid[idx + n];
          tmp[idx] = grid[idx] * 0.5 + neighbors * 0.125;
        }
      }
      grid.set(tmp);
    }
    console.log(`[erosion] smoothed (${smoothPasses} passes)`);

    const elapsed = performance.now() - t0;
    console.log(`[erosion] applied in ${elapsed.toFixed(0)}ms`);

    // Commit to undo (one entry)
    hf.endStroke();

    // Force rebuild all chunks
    this.centerCX = Infinity;
    this.centerCZ = Infinity;
    this.updateChunks();
  }

  /** Apply a brush stamp and rebuild affected chunks */
  applyBrushStamp(stamp: BrushStamp): void {
    if (!this._editableHF) return;

    const affected = this._editableHF.applyStamp(stamp);

    // Force rebuild of affected chunks by invalidating their coordinates
    for (const slot of this.slots) {
      const key = `${slot.cx},${slot.cz}`;
      if (affected.has(key)) {
        slot.cx = Infinity;
        slot.cz = Infinity;
      }
    }
    // Force updateChunks to run by resetting center
    this.centerCX = Infinity;
    this.centerCZ = Infinity;
    this.updateChunks();
  }

  /** Reset canvas to flat */
  resetCanvas(): void {
    if (!this._editableHF) return;
    this._editableHF.reset();
    this.centerCX = Infinity;
    this.centerCZ = Infinity;
    this.updateChunks();
  }

  /** Undo last sculpt action */
  undoSculpt(): boolean {
    if (!this._editableHF) return false;
    const ok = this._editableHF.undo();
    if (ok) {
      this.centerCX = Infinity;
      this.centerCZ = Infinity;
      this.updateChunks();
    }
    return ok;
  }

  /** Redo last undone sculpt action */
  redoSculpt(): boolean {
    if (!this._editableHF) return false;
    const ok = this._editableHF.redo();
    if (ok) {
      this.centerCX = Infinity;
      this.centerCZ = Infinity;
      this.updateChunks();
    }
    return ok;
  }

  /** Pick terrain position — uses fast heightfield ray intersection in editable mode,
   *  falls back to mesh raycasting for baked terrain */
  raycastTerrain(ndcX: number, ndcY: number): { x: number; z: number; y: number } | null {
    const raycaster = new THREE.Raycaster();
    raycaster.setFromCamera(new THREE.Vector2(ndcX, ndcY), this.camera);

    // Fast path: direct heightfield intersection (no mesh raycasting)
    if (this._editableHF) {
      return this._rayHeightfield(raycaster.ray);
    }

    // Slow path: mesh raycasting for baked terrain
    const meshes = this.slots
      .filter(s => s.mesh.visible)
      .map(s => s.mesh);

    const intersects = raycaster.intersectObjects(meshes);
    if (intersects.length > 0) {
      const p = intersects[0].point;
      return { x: p.x, z: p.z, y: p.y };
    }
    return null;
  }

  /** Fast ray-heightfield intersection via ray march + refinement */
  private _rayHeightfield(ray: THREE.Ray): { x: number; z: number; y: number } | null {
    const origin = ray.origin;
    const dir = ray.direction;

    // Ray must be pointing downward to hit a flat-ish heightfield
    if (dir.y >= 0 && origin.y > 0) return null;

    // Step 1: intersect ray with the Y=0 base plane to get approximate XZ
    // For sculpted terrain, we refine from there
    const t0 = -origin.y / dir.y;
    if (t0 < 0) return null;

    let x = origin.x + dir.x * t0;
    let z = origin.z + dir.z * t0;

    // Step 2: refine by sampling heightfield at the intersection point
    // and iterating to find where ray.y ≈ terrain.y
    for (let i = 0; i < 8; i++) {
      const h = this.terrain.sampleHeight(x, z);
      const tH = (origin.y - h) / -dir.y;
      if (tH < 0) break;
      x = origin.x + dir.x * tH;
      z = origin.z + dir.z * tH;
    }

    const y = this.terrain.sampleHeight(x, z);
    return { x, z, y };
  }

  // ── Terrain source swap (for rebake) ──

  applyNewTerrain(result: TerrainSourceResult): void {
    this.terrain = result.source;
    if (result.domain) {
      this._domain = result.domain;
    }

    // Regenerate field textures and update existing GPU textures in-place
    // (preserves material/water shader references)
    const extent = result.domain?.extent ?? 200;
    const fieldSize = result.domain?.fieldTextureSize ?? 256;
    const bakeGridSize = result.domain?.bakeGridSize || undefined;
    const depositionMap = result.bakeArtifacts?.depositionMap ?? null;
    const newFields = generateFieldTextures(
      this.terrain, fieldSize, extent,
      depositionMap, bakeGridSize,
    );

    if (this._fieldTextures) {
      // Update existing textures in-place (materials/water keep their references)
      this._fieldTextures.updateFrom(newFields);
    } else {
      this._fieldTextures = newFields;
    }

    // Force rebuild all chunks with new terrain
    this.centerCX = Infinity;
    this.centerCZ = Infinity;
    this.updateChunks();

    console.log('[terrain] applied new terrain source');
  }

  // ── Water / cloud controls ──

  setWaterLevel(level: number | null): void {
    if (level === null || level <= 0) {
      // Destroy water
      if (this._water) {
        this._water.dispose();
        this._water = null;
      }
      return;
    }
    if (this._water) {
      this._water.setWaterLevel(level);
    } else {
      // Lazy create water system
      this._water = createWaterSystem(
        this.scene as any,
        this._fieldTextures?.heightMap ?? null as any,
        this._fieldTextures?.extent ?? 200,
        { ...DEFAULT_WATER_CONFIG, waterLevel: level },
      );
    }
  }

  setCloudCoverage(coverage: number): void {
    if (this._clouds) this._clouds.setCoverage(coverage);
  }

  // ── Scatter controls (Apply — rebuilds foliage) ──

  private _scatterParams: ScatterParams | undefined;

  applyScatterParams(params: ScatterParams): void {
    this._scatterParams = params;
    // Rebuild foliage for all visible near-ring chunks
    for (const slot of this.slots) {
      const d = Math.max(Math.abs(slot.dx), Math.abs(slot.dz));
      if (d < BASE_GRID_RADIUS && slot.mesh.visible) {
        this.foliage.rebuild(
          slot.foliage, slot.cx, slot.cz,
          false, this.terrain, this._fieldTextures,
          this._scatterParams,
        );
      }
    }
  }

  // ── Material parameter controls (Live) ──

  setMaterialParams(params: { snowThreshold?: number; rockSlopeMin?: number; rockSlopeMax?: number; sedimentEmphasis?: number }): void {
    if (params.snowThreshold !== undefined) matSnowThreshold.value = params.snowThreshold;
    if (params.rockSlopeMin !== undefined) matRockSlopeMin.value = params.rockSlopeMin;
    if (params.rockSlopeMax !== undefined) matRockSlopeMax.value = params.rockSlopeMax;
    if (params.sedimentEmphasis !== undefined) matSedimentEmphasis.value = params.sedimentEmphasis;
  }

  // ── Exposure / tone mapping ──

  getExposure(): number { return this._exposure; }

  setExposure(value: number): void {
    this._exposure = Math.max(0.2, Math.min(3.0, value));
    (this.renderer as any).toneMappingExposure = this._exposure;
  }

  // ── Presentation mode (bloom + post) ──

  isPresentationMode(): boolean { return this._presentationMode; }

  async setPresentationMode(enabled: boolean): Promise<void> {
    this._presentationMode = enabled;
    if (enabled && !this._presentationPipeline) {
      this._presentationPipeline = await createPresentationPipeline(this.renderer);
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
        this.foliage.rebuild(slot.foliage, slot.cx, slot.cz, d >= BASE_GRID_RADIUS, this.terrain, this._fieldTextures, this._scatterParams);
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

    // Skip dynamic visibility in editable/sculpt mode — keep all slots visible
    if (!this._editableHF) {
      const { mode, radius } = this._computeCoverageMode();
      if (mode !== this._coverageMode || radius !== this._activeRadius) {
        this._coverageMode = mode;
        this._activeRadius = radius;
        this._updateSlotVisibility();
      } else if (mode === 'horizon') {
        this._updateSlotVisibility();
      }
    }

    this.updateChunks();

    // Keep shadow camera following orbit target
    const tgt = this.controls.target;
    this._sunLight.target.position.copy(tgt);
    this._sunLight.target.updateMatrixWorld();
    this._sunLight.position.copy(tgt).add(
      this._sunDirectionVector().multiplyScalar(100)
    );

    if (this._presentationMode && this._presentationPipeline) {
      this._presentationPipeline.render(this.scene, this.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }

    return { now, dt };
  }

  resize(w: number, h: number): void {
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.renderer.setPixelRatio(this.dpr.ctrl.current);
    this.renderer.setSize(w, h);
  }

  async captureFrame(): Promise<string> {
    this.controls.update();
    this.updateChunks();
    // Render through presentation pipeline if active, awaiting completion
    if (this._presentationMode && this._presentationPipeline) {
      await this._presentationPipeline.renderAndWait(this.scene, this.camera);
    } else {
      this.renderer.render(this.scene, this.camera);
    }
    return this.renderer.domElement.toDataURL('image/png');
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
        presentationMode: this._presentationMode,
        exposure: this._exposure,
        sunAzimuth: this._sunAzimuth,
        sunElevation: this._sunElevation,
        dpr: { mode: this.dpr.ctrl.mode, current: this.dpr.ctrl.current },
        debug: this.debug,
        url: location.href,
        query: Object.fromEntries(new URLSearchParams(location.search)),
      },
      domain: this._domain ? {
        extent: this._domain.extent,
        bakeGridSize: this._domain.bakeGridSize,
        hasErosion: this._domain.hasErosion,
        hasDeposition: this._domain.hasDeposition,
        fromCache: this._domain.fromCache,
        bakeTimeMs: this._domain.bakeTimeMs,
      } : null,
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
