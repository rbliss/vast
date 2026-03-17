/**
 * Terrain domain configuration.
 *
 * Single source of truth for terrain bake/field/water/preview extents.
 * All systems that need to know about terrain spatial bounds should
 * consume this config instead of hardcoding or inferring values.
 */

import type { TerrainBakeMetadata } from './types';

export interface TerrainDomainConfig {
  /** World-space half-extent (terrain covers -extent to +extent) */
  extent: number;
  /** Bake grid resolution (gridSize x gridSize cells) */
  bakeGridSize: number;
  /** Cell spacing in the bake grid */
  bakeCellSize: number;
  /** Field texture resolution (may differ from bake grid) */
  fieldTextureSize: number;
  /** Whether this domain has baked erosion data */
  hasErosion: boolean;
  /** Whether deposition data is available */
  hasDeposition: boolean;
  /** Bake compute time (0 if no bake or cached) */
  bakeTimeMs: number;
  /** Whether this came from a cache hit */
  fromCache: boolean;
}

/**
 * Create domain config from bake metadata.
 */
export function domainFromBakeMetadata(
  metadata: TerrainBakeMetadata,
  fieldTextureSize: number = 256,
  fromCache: boolean = false,
): TerrainDomainConfig {
  return {
    extent: metadata.extent,
    bakeGridSize: metadata.gridSize,
    bakeCellSize: metadata.cellSize,
    fieldTextureSize,
    hasErosion: true,
    hasDeposition: metadata.hasDeposition,
    bakeTimeMs: metadata.computeTimeMs,
    fromCache,
  };
}

/**
 * Default domain config for non-eroded or legacy terrain.
 */
export function defaultDomain(extent: number = 200): TerrainDomainConfig {
  return {
    extent,
    bakeGridSize: 0,
    bakeCellSize: 0,
    fieldTextureSize: 256,
    hasErosion: false,
    hasDeposition: false,
    bakeTimeMs: 0,
    fromCache: false,
  };
}
