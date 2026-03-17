/**
 * Eroded terrain source.
 *
 * Pipeline stage that wraps a base TerrainSource:
 *   1. Samples the base source into a fixed-resolution height grid
 *   2. Runs thermal erosion (angle-of-repose relaxation)
 *   3. Runs hydraulic erosion (particle-based channel cutting)
 *   4. Samples the eroded grid via bilinear interpolation
 *
 * The eroded grid covers a fixed world-space extent centered at origin.
 * Out-of-bounds queries fall back to the base source.
 */

import type { TerrainSource } from './terrainSource';
import { thermalErosion, hydraulicErosion, type ThermalParams, type HydraulicParams } from './erosion';

export interface ErosionConfig {
  /** Grid resolution (gridSize x gridSize cells) */
  gridSize: number;
  /** World-space half-extent (grid covers -extent to +extent) */
  extent: number;
  thermal: ThermalParams & { enabled: boolean };
  hydraulic: HydraulicParams & { enabled: boolean };
}

export const DEFAULT_EROSION: ErosionConfig = {
  gridSize: 512,
  extent: 200,
  thermal: {
    enabled: true,
    iterations: 40,
    talusThreshold: 1.2,
    transferRate: 0.35,
  },
  hydraulic: {
    enabled: true,
    droplets: 80000,
    maxLifetime: 80,
    inertia: 0.3,
    sedimentCapacity: 6.0,
    minCapacity: 0.02,
    erosionRate: 0.4,
    depositionRate: 0.2,
    evaporationRate: 0.02,
    gravity: 8.0,
    erosionRadius: 3,
    seed: 42,
  },
};

export class ErodedTerrainSource implements TerrainSource {
  private readonly _base: TerrainSource;
  private readonly _grid: Float32Array;
  private readonly _gridSize: number;
  private readonly _extent: number;
  private readonly _cellSize: number;
  private readonly _computeTimeMs: number;

  constructor(base: TerrainSource, config: ErosionConfig = DEFAULT_EROSION) {
    this._base = base;
    this._gridSize = config.gridSize;
    this._extent = config.extent;
    this._cellSize = (config.extent * 2) / (config.gridSize - 1);

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

    // Step 2: Thermal erosion
    if (config.thermal.enabled) {
      thermalErosion(this._grid, n, n, this._cellSize, config.thermal);
      console.log(`[erosion] thermal: ${config.thermal.iterations} iterations`);
    }

    // Step 3: Hydraulic erosion
    if (config.hydraulic.enabled) {
      hydraulicErosion(this._grid, n, n, this._cellSize, config.hydraulic);
      console.log(`[erosion] hydraulic: ${config.hydraulic.droplets} droplets`);
    }

    this._computeTimeMs = performance.now() - t0;
    console.log(`[erosion] computed in ${this._computeTimeMs.toFixed(0)}ms (${n}x${n} grid, extent ±${config.extent})`);
  }

  get computeTimeMs(): number { return this._computeTimeMs; }

  sampleHeight(x: number, z: number): number {
    // Convert world coords to grid coords
    const gx = (x + this._extent) / this._cellSize;
    const gz = (z + this._extent) / this._cellSize;

    // Out-of-bounds: fall back to base source
    if (gx < 0 || gx >= this._gridSize - 1 || gz < 0 || gz >= this._gridSize - 1) {
      return this._base.sampleHeight(x, z);
    }

    // Bilinear interpolation
    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const n = this._gridSize;

    const h00 = this._grid[iz * n + ix];
    const h10 = this._grid[iz * n + ix + 1];
    const h01 = this._grid[(iz + 1) * n + ix];
    const h11 = this._grid[(iz + 1) * n + ix + 1];

    return h00 * (1 - fx) * (1 - fz) +
           h10 * fx * (1 - fz) +
           h01 * (1 - fx) * fz +
           h11 * fx * fz;
  }
}
