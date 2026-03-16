/**
 * Terrain heightfield sampling.
 * Combines multiple noise layers into the macro terrain shape.
 */

import { fbm, ridgedFBM } from './noise.js';

export const MACRO_HEIGHT_SCALE = 12;

export function terrainHeight(x, z) {
  const broad = fbm(x * 0.012, z * 0.012, 4, 2.0, 0.5) * 0.5 + 0.5;
  const ridged = ridgedFBM(x * 0.025, z * 0.025, 4, 2.0, 0.45);
  const medium = fbm(x * 0.05, z * 0.05, 3, 2.0, 0.5) * 0.5 + 0.5;
  const blend = broad * 0.45 + ridged * 0.35 + medium * 0.2;
  const detail = fbm(x * 0.12, z * 0.12, 3, 2.0, 0.4) * 0.04;
  return blend + detail;
}
