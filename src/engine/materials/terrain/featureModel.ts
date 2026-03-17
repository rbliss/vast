/**
 * Shared terrain shader feature model.
 * Single source of truth for all biome/material behavior constants.
 * Consumed by the TSL/WebGPU material path.
 *
 * This is pure config/math semantics — no renderer code.
 */

// ── Biome weight thresholds ──
/** Slope value where rock begins (smoothstep lower bound) */
export const ROCK_SLOPE_MIN = 0.35;
/** Slope value where rock is fully dominant (smoothstep upper bound) */
export const ROCK_SLOPE_MAX = 0.65;

/** Height range where rock weight gets an additional bias */
export const ROCK_HEIGHT_MIN = 4.0;
export const ROCK_HEIGHT_MAX = 9.0;
/** Strength of the height-based rock bias (0-1) */
export const ROCK_HEIGHT_BIAS_STRENGTH = 0.3;

/** Biome noise frequency for grass/dirt variation */
export const BIOME_NOISE_FREQUENCY = 0.03;

/** Grass weight from biome noise (smoothstep bounds) */
export const GRASS_NOISE_MIN = 0.25;
export const GRASS_NOISE_MAX = 0.6;

/** Dirt weight from biome noise (inverse smoothstep bounds) */
export const DIRT_NOISE_MIN = 0.2;
export const DIRT_NOISE_MAX = 0.55;
/** Dirt weight scaling factor (reduces dirt dominance) */
export const DIRT_WEIGHT_SCALE = 0.6;

// ── Tri-planar mapping ──
/** Sharpness exponent for tri-planar blend weights */
export const TRIPLANAR_SHARPNESS = 4.0;

// ── Displacement ──
/** Micro displacement scale (world units) */
export const DISPLACEMENT_SCALE = 0.25;
/** Micro displacement bias */
export const DISPLACEMENT_BIAS = -0.1;
/** Edge fade distance for displacement at chunk borders (world units) */
export const DISPLACEMENT_FADE_DISTANCE = 3.0;

// ── AO ──
/** AO intensity for rock layer (grass/dirt get 1.0 = no darkening) */
export const ROCK_AO_INTENSITY = 1.0;

// ── Normal mapping ──
/** Normal scale for rock normal map */
export const ROCK_NORMAL_SCALE = 1.0;
/** Normal scale for grass normal map (planar XZ) */
export const GRASS_NORMAL_SCALE = 0.5;
/** Normal scale for dirt normal map (planar XZ) */
export const DIRT_NORMAL_SCALE = 0.6;

// ── Environment / IBL ──
/** Terrain material env map intensity */
export const TERRAIN_ENV_MAP_INTENSITY = 0.08;
/** Foliage material env map intensity */
export const FOLIAGE_ENV_MAP_INTENSITY = 0.03;

// ── Hemisphere light balance ──
/** Hemi intensity when IBL is active */
export const HEMI_INTENSITY_IBL_ON = 0.5;
/** Hemi intensity when IBL is off (pre-IBL baseline) */
export const HEMI_INTENSITY_IBL_OFF = 0.6;
