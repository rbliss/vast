/**
 * Baked terrain source.
 *
 * Lightweight runtime sampler over pre-computed TerrainBakeArtifacts.
 * Performs bilinear interpolation of the baked height grid.
 * Edge-blends to a base source outside the baked region.
 *
 * This replaces `ErodedTerrainSource` as the runtime terrain provider
 * once a bake is complete.
 */

import type { TerrainSource } from '../terrain/terrainSource';
import type { TerrainBakeArtifacts, TerrainBakeMetadata } from './types';

const EDGE_BLEND_FRACTION = 0.12;

export class BakedTerrainSource implements TerrainSource {
  private readonly _grid: Float32Array;
  private readonly _gridSize: number;
  private readonly _extent: number;
  private readonly _cellSize: number;
  private readonly _blendStart: number;
  private readonly _base: TerrainSource;

  /** Bake metadata — public for field textures, UI, and diagnostics */
  readonly metadata: TerrainBakeMetadata;

  /** Deposition map from the bake — public for field texture generation */
  readonly depositionMap: Float32Array;

  constructor(base: TerrainSource, artifacts: TerrainBakeArtifacts) {
    this._base = base;
    this._grid = artifacts.heightGrid;
    this._gridSize = artifacts.metadata.gridSize;
    this._extent = artifacts.metadata.extent;
    this._cellSize = artifacts.metadata.cellSize;
    this._blendStart = artifacts.metadata.extent * (1 - EDGE_BLEND_FRACTION);
    this.metadata = artifacts.metadata;
    this.depositionMap = artifacts.depositionMap;
  }

  sampleHeight(x: number, z: number): number {
    const gx = (x + this._extent) / this._cellSize;
    const gz = (z + this._extent) / this._cellSize;

    // Outside grid: base source
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

    const erodedH = h00 * (1 - fx) * (1 - fz) +
                    h10 * fx * (1 - fz) +
                    h01 * (1 - fx) * fz +
                    h11 * fx * fz;

    // Edge blend
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
