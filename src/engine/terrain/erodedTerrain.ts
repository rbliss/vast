/**
 * Bounded erosion preview bake.
 *
 * Pipeline stage that wraps a base TerrainSource:
 *   1. Samples the base source into a fixed-resolution height grid
 *   2. Runs stream-power erosion (hierarchical channel incision)
 *   3. Runs thermal relaxation (slope stabilization)
 *   4. Optionally runs droplet erosion (fine detail)
 *   5. Samples the eroded grid via bilinear interpolation
 *
 * ARCHITECTURE LIMITATION: This is a bounded preview bake, NOT a
 * general infinite-terrain erosion system. The eroded grid covers
 * a fixed world-space extent centered at the origin. Near the edges,
 * eroded heights blend smoothly back to the uneroded base source
 * to prevent hard seams. Outside the blended region, the base source
 * is used directly.
 *
 * A future tile/cell-local erosion cache aligned with chunked terrain
 * would remove this limitation.
 */

import type { TerrainSource } from './terrainSource';
import { thermalErosion, hydraulicErosion, type ThermalParams, type HydraulicParams } from './erosion';
import { streamPowerErosion, type StreamPowerParams, DEFAULT_STREAM_POWER } from './streamPower';
import { applyFanDeposition, type FanParams, DEFAULT_FAN_PARAMS } from './fanDeposition';
import type { ChannelGeometryParams } from './channelGeometry';
import type { HillslopeParams } from './hillslopeTransport';

/** Lateral erosion parameters (exposed from streamPower.ts hardcoded values) */
export interface LateralErosionParams {
  bankSlopeThreshold: number;
  lateralRate: number;
  maxReach: number;
  minChannelArea: number;
  /** Enable provenance-based divide penalty (default: false) */
  divideProtection?: boolean;
  /** H2.5e: Piedmont planform migration params */
  maxMigrationSlope?: number;
  curvatureThreshold?: number;
  curvatureStrength?: number;
  outerBankBoost?: number;
  innerBankProtection?: number;
  innerBankDeposition?: number;
  tangentSmoothSteps?: number;
  curvatureSmoothSteps?: number;
  migrationReach?: number;
}

export const DEFAULT_LATERAL: LateralErosionParams = {
  bankSlopeThreshold: 0.5,
  lateralRate: 0.35,
  maxReach: 4,
  minChannelArea: 20.0,
};

export interface ErosionConfig {
  /** Grid resolution (gridSize x gridSize cells) */
  gridSize: number;
  /** World-space half-extent (grid covers -extent to +extent) */
  extent: number;
  /** Stream-power erosion (primary channel generator) */
  streamPower: StreamPowerParams & { enabled: boolean };
  /** Thermal relaxation (slope stabilization, runs after stream-power) */
  thermal: ThermalParams & { enabled: boolean };
  /** Droplet hydraulic erosion (optional fine detail, runs last) */
  hydraulic: HydraulicParams & { enabled: boolean };
  /** Fan and debris-flow deposition (runs after stream-power) */
  fan: FanParams & { enabled: boolean };
  /** Channel geometry shaping (optional override; set enabled:false to skip) */
  channelGeometry?: Partial<ChannelGeometryParams> & { enabled?: boolean };
  /** Hillslope transport (optional override; set enabled:false to skip) */
  hillslope?: Partial<HillslopeParams> & { enabled?: boolean };
  /** Lateral erosion (optional override) */
  lateral?: Partial<LateralErosionParams>;
  /** Terrace formation (optional — defaults to enabled) */
  terraces?: { enabled: boolean };
}

export const DEFAULT_EROSION: ErosionConfig = {
  gridSize: 512,
  extent: 200,
  streamPower: {
    enabled: true,
    ...DEFAULT_STREAM_POWER,
  },
  thermal: {
    enabled: true,
    iterations: 20,
    talusThreshold: 1.2,
    transferRate: 0.35,
  },
  hydraulic: {
    enabled: false, // Droplet erosion off by default — stream-power handles channels
    droplets: 30000,
    maxLifetime: 60,
    inertia: 0.3,
    sedimentCapacity: 6.0,
    minCapacity: 0.02,
    erosionRate: 0.4,
    depositionRate: 0.2,
    evaporationRate: 0.02,
    gravity: 8.0,
    erosionRadius: 2,
    seed: 42,
  },
  fan: {
    enabled: true,
    ...DEFAULT_FAN_PARAMS,
  },
};

/** Fraction of extent used for edge blend (0.12 = outer 12% blends to base) */
const EDGE_BLEND_FRACTION = 0.12;

export class ErodedTerrainSource implements TerrainSource {
  private readonly _base: TerrainSource;
  private readonly _grid: Float32Array;
  private readonly _gridSize: number;
  private readonly _extent: number;
  private readonly _cellSize: number;
  private readonly _blendStart: number;
  private readonly _computeTimeMs: number;
  /** Accumulated deposition map from stream-power erosion (null if erosion disabled) */
  readonly depositionMap: Float32Array | null;

  constructor(base: TerrainSource, config: ErosionConfig = DEFAULT_EROSION) {
    this._base = base;
    this._gridSize = config.gridSize;
    this._extent = config.extent;
    this._cellSize = (config.extent * 2) / (config.gridSize - 1);
    this._blendStart = config.extent * (1 - EDGE_BLEND_FRACTION);

    const t0 = performance.now();

    // Step 1: Sample base terrain into grid
    const n = config.gridSize;
    this._grid = new Float32Array(n * n);
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const wx = -config.extent + x * this._cellSize;
        const wz = -config.extent + z * this._cellSize;
        this._grid[z * n + x] = base.sampleHeight(wx, wz);
      }
    }

    // Step 2: Stream-power erosion (primary — creates hierarchical channels)
    let spResult: import('./streamPower').StreamPowerResult | null = null;
    if (config.streamPower.enabled) {
      const spT0 = performance.now();
      spResult = streamPowerErosion(this._grid, n, n, this._cellSize, config.streamPower);
      console.log(`[erosion] stream-power: ${config.streamPower.iterations} iterations (${(performance.now() - spT0).toFixed(0)}ms)`);
    }
    const depositionAccum = spResult?.deposition ?? new Float32Array(n * n);

    // Step 2b: Fan and debris-flow deposition (uses flow data from stream-power)
    // Snapshot heights before fan pass to capture fan/debris deposits in the mask
    if (config.fan.enabled && spResult) {
      const preFan = new Float32Array(this._grid);
      const fanT0 = performance.now();
      applyFanDeposition(
        this._grid, spResult.area, spResult.receiver, spResult.slopes,
        n, n, this._cellSize, config.fan,
      );
      // Add fan/debris deposit deltas to the deposition mask
      for (let i = 0; i < n * n; i++) {
        const delta = this._grid[i] - preFan[i];
        if (delta > 0) depositionAccum[i] += delta;
      }
      console.log(`[erosion] fan deposition (${(performance.now() - fanT0).toFixed(0)}ms)`);
    }

    this.depositionMap = depositionAccum;

    // Step 3: Thermal relaxation (stabilize oversteepened slopes)
    if (config.thermal.enabled) {
      thermalErosion(this._grid, n, n, this._cellSize, config.thermal);
      console.log(`[erosion] thermal: ${config.thermal.iterations} iterations`);
    }

    // Step 4: Droplet hydraulic detail (optional fine-scale)
    if (config.hydraulic.enabled) {
      hydraulicErosion(this._grid, n, n, this._cellSize, config.hydraulic);
      console.log(`[erosion] hydraulic detail: ${config.hydraulic.droplets} droplets`);
    }

    this._computeTimeMs = performance.now() - t0;
    console.log(`[erosion] bounded preview bake: ${this._computeTimeMs.toFixed(0)}ms total (${n}x${n} grid, extent ±${config.extent})`);
  }

  get computeTimeMs(): number { return this._computeTimeMs; }

  sampleHeight(x: number, z: number): number {
    // Convert world coords to grid coords
    const gx = (x + this._extent) / this._cellSize;
    const gz = (z + this._extent) / this._cellSize;

    // Fully outside grid: fall back to base source
    if (gx < 0 || gx >= this._gridSize - 1 || gz < 0 || gz >= this._gridSize - 1) {
      return this._base.sampleHeight(x, z);
    }

    // Bilinear interpolation of eroded grid
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const n = this._gridSize;

    const h00 = this._grid[iz * n + ix];
    const h10 = this._grid[iz * n + ix + 1];
    const h01 = this._grid[(iz + 1) * n + ix];
    const h11 = this._grid[(iz + 1) * n + ix + 1];

    const erodedH = h00 * (1 - fx) * (1 - fz) +
                    h10 * fx * (1 - fz) +
                    h01 * (1 - fx) * fz +
                    h11 * fx * fz;

    // Edge blend: smooth transition from eroded → base near grid boundary
    const distFromCenter = Math.max(Math.abs(x), Math.abs(z));
    if (distFromCenter > this._blendStart) {
      const baseH = this._base.sampleHeight(x, z);
      const t = Math.min(1, (distFromCenter - this._blendStart) / (this._extent * EDGE_BLEND_FRACTION));
      const blend = t * t * (3 - 2 * t);
      return erodedH * (1 - blend) + baseH * blend;
    }

    return erodedH;
  }
}
