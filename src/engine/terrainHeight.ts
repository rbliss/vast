/**
 * Terrain heightfield sampling.
 *
 * Architecture: silhouette-safe layering.
 *   1. Base     — broad, low-frequency rolling landform (silhouette-safe)
 *   2. Mountain — smooth peaks placed by ridged-noise mask (silhouette-safe)
 *   3. Relief   — low-amplitude surface detail (not silhouette-bearing)
 *
 * Principle: only low-frequency, smooth features shape the terrain skyline.
 * Sharp detail comes from normals, roughness, and displacement — not geometry.
 *
 * Domain warping is applied to mountain sampling to break grid-aligned
 * ridge patterns and produce more natural landforms.
 */

import { fbm, ridgedFBM } from './noise';

export const MACRO_HEIGHT_SCALE = 12;

// ── Domain warp ──
// Gentle coordinate distortion to break grid-aligned ridge patterns.
// Low frequency (0.01) + moderate amplitude (8 units) — just enough
// to prevent straight/regular features without distorting overall shape.

function domainWarp(x: number, z: number): [number, number] {
  const wx = fbm(x * 0.01 + 7.3, z * 0.01 + 13.7, 2, 2.0, 0.5) * 8.0;
  const wz = fbm(x * 0.01 + 31.1, z * 0.01 + 5.9, 2, 2.0, 0.5) * 8.0;
  return [x + wx, z + wz];
}

// ── Layer 1: Base terrain ──
// Very low frequency rolling hills. Sets the large-scale landform.
// This is always silhouette-safe — gentle gradients, no sharp features.

export function sampleTerrainBase(x: number, z: number): number {
  return fbm(x * 0.008, z * 0.008, 3, 2.0, 0.5) * 0.5 + 0.5;
}

// ── Layer 2: Mountain shaping ──
// Uses ridged noise as a PLACEMENT MASK (where mountains occur),
// but shapes actual elevation with smooth FBM (rounded peaks).
// This gives dramatic mountain ranges without knife-edge silhouettes.
//
// The product mask × shape means:
//   - At mountain peaks (mask ≈ 1): height governed by smooth shape
//   - At mountain edges (mask → 0): height fades to base terrain
//   - Peak roundness comes from shape FBM, not ridge function

export function sampleTerrainMountain(x: number, z: number): number {
  const [wx, wz] = domainWarp(x, z);

  // Ridge mask — determines WHERE mountains occur
  // Lower frequency than old direct ridgedFBM → larger mountain ranges
  const mask = ridgedFBM(wx * 0.015, wz * 0.015, 3, 2.0, 0.45);

  // Mountain shape — smooth FBM controls actual peak elevation
  const shape = fbm(wx * 0.02, wz * 0.02, 3, 2.0, 0.45) * 0.5 + 0.5;

  return mask * shape;
}

// ── Layer 3: Surface relief ──
// Medium/fine frequency detail for surface interest.
// Low amplitude — contributes to surface texture, NOT to skyline.
// Rock detail comes from normals and displacement, not this layer.

export function sampleTerrainRelief(x: number, z: number): number {
  const medium = fbm(x * 0.05, z * 0.05, 3, 2.0, 0.5);
  const fine = fbm(x * 0.12, z * 0.12, 3, 2.0, 0.4);
  return medium * 0.08 + fine * 0.02;
}

// ── Composite ──

export function terrainHeight(x: number, z: number): number {
  const base = sampleTerrainBase(x, z);
  const mountain = sampleTerrainMountain(x, z);
  const relief = sampleTerrainRelief(x, z);
  return base * 0.45 + mountain * 0.45 + relief;
}
