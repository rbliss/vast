/**
 * Resistance / lithology field for differential erosion.
 *
 * Creates layered strata with varying erodibility:
 *   - Hard caprock layers resist erosion (low K)
 *   - Soft underlayers erode faster (high K)
 *   - Warped bands prevent perfect horizontal striping
 *
 * The resistance field modulates erosion coefficients so that
 * stream-power, channel geometry, and hillslope transport all
 * respect material hardness.
 */

import { fbm } from '../noise';

export interface ResistanceParams {
  /** Number of strata layers */
  layerCount: number;
  /** World-height spacing between layer centers */
  layerSpacing: number;
  /** Hard-layer thickness as fraction of spacing (0-1) */
  hardFraction: number;
  /** Resistance of hard layers (0 = no erosion, 1 = normal erosion) */
  hardResistance: number;
  /** Resistance of soft layers */
  softResistance: number;
  /** Warp amplitude (world units) — prevents perfect horizontal bands */
  warpAmplitude: number;
  /** Warp frequency */
  warpFrequency: number;
  /** Base height offset for strata start */
  baseHeight: number;
}

export const DEFAULT_RESISTANCE_PARAMS: ResistanceParams = {
  layerCount: 5,
  layerSpacing: 12,
  hardFraction: 0.35,
  hardResistance: 0.15,
  softResistance: 1.0,
  warpAmplitude: 4,
  warpFrequency: 0.015,
  baseHeight: 15,
};

/**
 * Compute resistance (erodibility) at a given world position.
 * Returns 0-1 where 0 = very resistant, 1 = easily eroded.
 *
 * Uses height + warped strata to determine which layer the point sits in.
 */
export function sampleResistance(
  x: number, z: number, height: number,
  params: ResistanceParams = DEFAULT_RESISTANCE_PARAMS,
): number {
  // Warp the height coordinate to prevent perfect horizontal bands
  const warp = fbm(x * params.warpFrequency + 7.3, z * params.warpFrequency + 13.1, 2, 2.0, 0.5) * params.warpAmplitude;
  const effectiveHeight = height + warp - params.baseHeight;

  if (effectiveHeight < 0) return params.softResistance; // Below strata = soft

  // Determine which strata band this height falls in
  const layerPos = effectiveHeight / params.layerSpacing;
  const fractional = layerPos - Math.floor(layerPos);

  // Hard layer occupies the center of each band
  const hardStart = 0.5 - params.hardFraction * 0.5;
  const hardEnd = 0.5 + params.hardFraction * 0.5;

  if (fractional >= hardStart && fractional <= hardEnd) {
    return params.hardResistance;
  }

  // Smooth transition at band edges
  const distToHard = Math.min(
    Math.abs(fractional - hardStart),
    Math.abs(fractional - hardEnd),
  );
  const transitionWidth = 0.1;
  if (distToHard < transitionWidth) {
    const t = distToHard / transitionWidth;
    return params.hardResistance + (params.softResistance - params.hardResistance) * t;
  }

  return params.softResistance;
}

/**
 * Generate a resistance grid for the entire bake domain.
 * Each cell gets an erodibility value based on its height and strata.
 */
export function generateResistanceGrid(
  heights: Float32Array,
  w: number, h: number,
  extent: number,
  cellSize: number,
  params: ResistanceParams = DEFAULT_RESISTANCE_PARAMS,
): Float32Array {
  const resistance = new Float32Array(w * h);

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const idx = z * w + x;
      const wx = -extent + x * cellSize;
      const wz = -extent + z * cellSize;
      const height = heights[idx];
      resistance[idx] = sampleResistance(wx, wz, height, params);
    }
  }

  return resistance;
}
