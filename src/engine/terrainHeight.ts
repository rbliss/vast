/**
 * Terrain heightfield sampling.
 *
 * Architecture: silhouette-safe layering.
 *   1. Base     — broad, low-frequency rolling landform (silhouette-safe)
 *   2. Range    — dramatic mountain range corridor (silhouette-bearing, smooth)
 *   3. Mountain — secondary peaks placed by ridged-noise mask (silhouette-safe)
 *   4. Relief   — low-amplitude surface detail (not silhouette-bearing)
 *
 * Principle: only low-frequency, smooth features shape the terrain skyline.
 * Sharp detail comes from normals, roughness, and displacement — not geometry.
 *
 * Domain warping is applied to mountain sampling to break grid-aligned
 * ridge patterns and produce more natural landforms.
 */

import { fbm, ridgedFBM } from './noise';

export const MACRO_HEIGHT_SCALE = 20;

// ── Domain warp ──
// Gentle coordinate distortion to break grid-aligned ridge patterns.

function domainWarp(x: number, z: number): [number, number] {
  const wx = fbm(x * 0.01 + 7.3, z * 0.01 + 13.7, 2, 2.0, 0.5) * 8.0;
  const wz = fbm(x * 0.01 + 31.1, z * 0.01 + 5.9, 2, 2.0, 0.5) * 8.0;
  return [x + wx, z + wz];
}

// ── Layer 1: Base terrain ──
// Very low frequency rolling hills. Sets the large-scale landform.

export function sampleTerrainBase(x: number, z: number): number {
  return fbm(x * 0.008, z * 0.008, 3, 2.0, 0.5) * 0.5 + 0.5;
}

// ── Layer 2: Mountain range corridor ──
// A large-scale warped ridge corridor that provides the main dramatic
// skyline feature. Silhouette-bearing but smooth.
//
// Structure:
//   1. Global spine direction (diagonal across world)
//   2. Spine warp — gentle FBM distortion so it's not straight
//   3. Cross-range falloff — broad Gaussian-like fade from spine
//   4. Along-range modulation — creates peaks, saddles, and subranges
//   5. Peak shape — smooth FBM, no sharp ridges

// Spine direction: roughly NW-SE diagonal
const RANGE_DIR_X = 0.7071;
const RANGE_DIR_Z = 0.7071;
// Perpendicular direction
const RANGE_PERP_X = -RANGE_DIR_Z;
const RANGE_PERP_Z = RANGE_DIR_X;
// Range offset — small so it's visible near origin/default camera
const RANGE_OFFSET = 10;
// Range height multiplier — makes the range dominate the skyline
const RANGE_HEIGHT = 2.5;

// 2-part cross profile widths:
const SHOULDER_HALF_WIDTH = 40;  // broad mountain mass
const CREST_HALF_WIDTH = 15;     // narrow higher core ridge

export function sampleTerrainRange(x: number, z: number): number {
  const along = x * RANGE_DIR_X + z * RANGE_DIR_Z;
  let across = x * RANGE_PERP_X + z * RANGE_PERP_Z - RANGE_OFFSET;

  // Spine warp — meander so the range isn't straight
  const spineWarp = fbm(along * 0.005 + 42.7, 0.5, 2, 2.0, 0.5) * 20.0;
  across += spineWarp;

  // 2-part cross profile: broad shoulders + narrow crest
  const shoulderFade = Math.exp(-(across * across) / (2 * SHOULDER_HALF_WIDTH * SHOULDER_HALF_WIDTH));
  const crestFade = Math.exp(-(across * across) / (2 * CREST_HALF_WIDTH * CREST_HALF_WIDTH));

  // Along-range modulation — peaks, saddles, subranges
  const alongBase = fbm(along * 0.008 + 17.3, along * 0.003 + 9.1, 3, 2.0, 0.5) * 0.5 + 0.5;
  // Massif sections — lower frequency, stronger presence
  const massif = Math.max(0, fbm(along * 0.003 + 51.7, along * 0.001, 2, 2.0, 0.5));
  // Along-range variation for crest height
  const crestMod = fbm(along * 0.006 + 73.1, along * 0.004 + 11.3, 2, 2.0, 0.5) * 0.5 + 0.5;

  // Shoulder height — broad mountain mass
  const shoulderHeight = (alongBase * 0.5 + massif * 0.5) * shoulderFade;
  // Crest height — narrow ridge on top of shoulders
  const crestHeight = crestMod * 0.8 * crestFade;

  // Cross-range asymmetry — slight variation
  const crossDetail = fbm(across * 0.03 + along * 0.01, along * 0.008, 2, 2.0, 0.5) * 0.1;

  return (shoulderHeight + crestHeight + crossDetail * shoulderFade) * RANGE_HEIGHT;
}

// ── Layer 3: Secondary mountain shaping ──
// Uses ridged noise as a PLACEMENT MASK (where secondary peaks occur),
// but shapes actual elevation with smooth FBM (rounded peaks).

export function sampleTerrainMountain(x: number, z: number): number {
  const [wx, wz] = domainWarp(x, z);
  const mask = ridgedFBM(wx * 0.015, wz * 0.015, 3, 2.0, 0.45);
  const shape = fbm(wx * 0.02, wz * 0.02, 3, 2.0, 0.45) * 0.5 + 0.5;
  return mask * shape;
}

// ── Layer 4: Surface relief ──
// Low-amplitude detail for surface texture, not silhouette.

export function sampleTerrainRelief(x: number, z: number): number {
  const medium = fbm(x * 0.05, z * 0.05, 3, 2.0, 0.5);
  const fine = fbm(x * 0.12, z * 0.12, 3, 2.0, 0.4);
  return medium * 0.08 + fine * 0.02;
}

// ── Composite ──

export function terrainHeight(x: number, z: number): number {
  const base = sampleTerrainBase(x, z);
  const range = sampleTerrainRange(x, z);
  const mountain = sampleTerrainMountain(x, z);
  const relief = sampleTerrainRelief(x, z);
  return base * 0.25 + range * 0.5 + mountain * 0.15 + relief;
}
