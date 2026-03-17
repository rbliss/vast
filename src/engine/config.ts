/**
 * World, material, and LOD constants.
 */

export interface LodLevel {
  segments: number;
  displacement: boolean;
}

export const CHUNK_SIZE = 40;
export const SKIRT_DEPTH = 12.0;
export const SKIRT_INSET = 0.05;
export const TEXTURE_WORLD_SIZE = 10;

export const ROCK_WORLD_SIZE = 10;
export const GRASS_WORLD_SIZE = 8;
export const DIRT_WORLD_SIZE = 6;

export const LOD_NEAR: LodLevel      = { segments: 256, displacement: true };
export const LOD_MID: LodLevel       = { segments: 64,  displacement: true };
export const LOD_FAR: LodLevel       = { segments: 32,  displacement: false };
export const LOD_ULTRA_FAR: LodLevel = { segments: 16,  displacement: false };
export const LOD_HORIZON: LodLevel   = { segments: 8,   displacement: false };

export const BASE_GRID_RADIUS = 2;
export const SHALLOW_GRID_RADIUS = 3;
export const HORIZON_GRID_RADIUS = 4;
/** Pitch threshold (degrees) — below this, outer rings activate */
export const SHALLOW_PITCH_THRESHOLD = 30;
/** Tighter pitch threshold for horizon mode */
export const HORIZON_PITCH_THRESHOLD = 25;
/** Orbit distance threshold for horizon mode */
export const HORIZON_DISTANCE_THRESHOLD = 95;
/** Camera height-above-target threshold for horizon mode */
export const HORIZON_HEIGHT_THRESHOLD = 25;
/** Forward-dot cutoff for horizon ring chunks (> this → visible) */
export const HORIZON_FORWARD_DOT = -0.15;

export const GRASS_PER_CHUNK = 600;
export const ROCK_PER_CHUNK = 80;
export const SHRUB_PER_CHUNK = 120;

// Foliage IBL (terrain IBL is in materials/terrain/featureModel.ts)
export const FOLIAGE_ENV_INTENSITY = 0.03;
export const SUN_ELEVATION = 45;   // degrees above horizon
export const SUN_AZIMUTH = 210;    // degrees from north
