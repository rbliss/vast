/**
 * World, material, and LOD constants.
 */

export const CHUNK_SIZE = 40;
export const SKIRT_DEPTH = 3.0;
export const SKIRT_INSET = 0.05;
export const TEXTURE_WORLD_SIZE = 10;

export const ROCK_WORLD_SIZE = 10;
export const GRASS_WORLD_SIZE = 8;
export const DIRT_WORLD_SIZE = 6;

export const LOD_NEAR = { segments: 128, displacement: true };
export const LOD_MID  = { segments: 64,  displacement: true };
export const LOD_FAR  = { segments: 32,  displacement: false };

export const GRID_RADIUS = 2;

export const GRASS_PER_CHUNK = 600;
export const ROCK_PER_CHUNK = 80;
export const SHRUB_PER_CHUNK = 120;
