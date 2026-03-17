/**
 * Terrain bake contracts.
 *
 * Separates the expensive terrain computation (bake) from the
 * lightweight runtime sampling (BakedTerrainSource). This is
 * the core seam for workerization and caching.
 */

import type { MacroTerrainConfig } from '../terrain/macroTerrain';
import type { ErosionConfig } from '../terrain/erodedTerrain';

// ── Request: pure inputs describing what to bake ──

export interface TerrainBakeRequest {
  /** Macro terrain config (field primitives + noise + presets) */
  macro: MacroTerrainConfig;
  /** Erosion config (stream-power + thermal + fan + optional droplets) */
  erosion: ErosionConfig;
}

// ── Metadata: inspectable bake provenance ──

export interface TerrainBakeMetadata {
  /** Grid dimensions */
  gridSize: number;
  /** World-space half-extent */
  extent: number;
  /** Cell spacing in world units */
  cellSize: number;
  /** Bake compute time in ms */
  computeTimeMs: number;
  /** Whether deposition map is available */
  hasDeposition: boolean;
  /** Timing breakdown by stage */
  timings: {
    sampling: number;
    streamPower: number;
    fan: number;
    thermal: number;
    total: number;
  };
}

// ── Artifacts: immutable outputs from a completed bake ──

export interface TerrainBakeArtifacts {
  /** Eroded height grid (gridSize x gridSize Float32Array) */
  heightGrid: Float32Array;
  /** Accumulated deposition map (same dimensions, may be all zeros) */
  depositionMap: Float32Array;
  /** Metadata about the bake */
  metadata: TerrainBakeMetadata;
}
