/**
 * Macro terrain field primitives.
 *
 * Each function samples a single composable terrain feature at world (x, z).
 * Returns unnormalized height contribution — the caller scales and combines.
 */

import { fbm, ridgedFBM } from '../noise';

// ── Range (mountain chain corridor) ──

export interface RangeParams {
  /** Spine direction unit vector */
  dirX: number;
  dirZ: number;
  /** Perpendicular offset from origin */
  offset: number;
  /** Cross-range Gaussian half-width */
  width: number;
  /** Peak height */
  height: number;
  /** Spine warp frequency and amplitude */
  meanderFreq: number;
  meanderAmp: number;
  /** Along-range modulation frequency */
  alongModFreq: number;
  /** Crest narrowness (smaller = broader top) */
  crestWidth: number;
  /** Seed offset for noise uniqueness */
  seed: number;
}

export function rangeField(x: number, z: number, p: RangeParams): number {
  // Project onto spine
  const along = x * p.dirX + z * p.dirZ;
  const perpX = -p.dirZ;
  const perpZ = p.dirX;
  let across = x * perpX + z * perpZ - p.offset;

  // Spine meandering
  const warp = fbm(along * p.meanderFreq + p.seed, 0.5, 2, 2.0, 0.5) * p.meanderAmp;
  across += warp;

  // Cross-range profile: broad shoulders + narrow crest
  const shoulderFade = Math.exp(-(across * across) / (2 * p.width * p.width));
  const crestFade = Math.exp(-(across * across) / (2 * p.crestWidth * p.crestWidth));

  // Along-range modulation (peaks and saddles)
  const alongMod = fbm(along * p.alongModFreq + p.seed + 17.3, along * p.alongModFreq * 0.4, 3, 2.0, 0.5) * 0.5 + 0.5;
  const massif = Math.max(0, fbm(along * p.alongModFreq * 0.4 + p.seed + 51.7, 0.5, 2, 2.0, 0.5));

  const shoulderHeight = (alongMod * 0.5 + massif * 0.5) * shoulderFade;
  const crestHeight = alongMod * 0.6 * crestFade;

  return (shoulderHeight + crestHeight) * p.height;
}

// ── Basin (depression / bowl) ──

export interface BasinParams {
  centerX: number;
  centerZ: number;
  /** Outer radius of influence */
  radius: number;
  /** How deep below surrounding terrain */
  depth: number;
  /** Rim elevation boost */
  rimHeight: number;
  /** Rim width as fraction of radius */
  rimWidth: number;
  /** Shape distortion seed */
  seed: number;
}

export function basinField(x: number, z: number, p: BasinParams): number {
  const dx = x - p.centerX;
  const dz = z - p.centerZ;

  // Distort distance for organic shape
  const warp = fbm(x * 0.01 + p.seed, z * 0.01 + p.seed + 7.7, 2, 2.0, 0.5) * p.radius * 0.2;
  const dist = Math.sqrt(dx * dx + dz * dz) + warp;
  const t = dist / p.radius;

  if (t > 1.5) return 0;

  // Bowl shape: depression in center, rim at edge
  const rimPos = 1.0;
  const rimSigma = p.rimWidth;

  // Depression curve (inverted Gaussian-ish)
  const bowl = -p.depth * Math.max(0, 1 - t * t);

  // Rim bump (Gaussian ring)
  const rimDist = t - rimPos;
  const rim = p.rimHeight * Math.exp(-(rimDist * rimDist) / (2 * rimSigma * rimSigma));

  // Outer falloff
  const outerFade = Math.max(0, 1 - Math.max(0, (t - 1.2) / 0.3));

  return (bowl + rim) * outerFade;
}

// ── Plateau (elevated flat region with escarpment) ──

export interface PlateauParams {
  centerX: number;
  centerZ: number;
  /** Radius of the flat top */
  radius: number;
  /** Plateau elevation */
  height: number;
  /** Escarpment transition width */
  escarpmentWidth: number;
  /** Shape irregularity */
  irregularity: number;
  seed: number;
}

export function plateauField(x: number, z: number, p: PlateauParams): number {
  const dx = x - p.centerX;
  const dz = z - p.centerZ;

  // Distort boundary for organic shape
  const angle = Math.atan2(dz, dx);
  const radialNoise = fbm(angle * 3 + p.seed, p.seed + 13.1, 3, 2.0, 0.5) * p.irregularity;
  const dist = Math.sqrt(dx * dx + dz * dz);
  const effectiveRadius = p.radius * (1 + radialNoise);

  // Smooth step from plateau top to base
  const t = (dist - effectiveRadius) / p.escarpmentWidth;
  const fade = 1.0 - smoothClamp(t, 0, 1);

  return fade * p.height;
}

// ── Ridge (linear spine) ──

export interface RidgeParams {
  startX: number;
  startZ: number;
  endX: number;
  endZ: number;
  /** Peak height */
  height: number;
  /** Cross-ridge falloff width */
  width: number;
  /** Profile sharpness (1 = Gaussian, higher = sharper) */
  sharpness: number;
  seed: number;
}

export function ridgeField(x: number, z: number, p: RidgeParams): number {
  const edx = p.endX - p.startX;
  const edz = p.endZ - p.startZ;
  const len = Math.sqrt(edx * edx + edz * edz) || 1;
  const ux = edx / len;
  const uz = edz / len;

  // Project point onto ridge line
  const px = x - p.startX;
  const pz = z - p.startZ;
  const along = px * ux + pz * uz;
  const across = Math.abs(px * (-uz) + pz * ux);

  // Along-line fade (taper at endpoints)
  const alongT = along / len;
  const alongFade = smoothClamp(alongT * 4, 0, 1) * smoothClamp((1 - alongT) * 4, 0, 1);

  // Cross-ridge profile
  const crossT = across / p.width;
  const profile = Math.exp(-Math.pow(crossT, p.sharpness) * 2);

  // Add slight height variation along the ridge
  const variation = fbm(along * 0.02 + p.seed, along * 0.01 + p.seed + 5, 2, 2.0, 0.5) * 0.3 + 0.7;

  return profile * alongFade * p.height * variation;
}

// ── Drainage corridor (valley / erosion channel guide) ──

export interface DrainageParams {
  /** Spine direction */
  dirX: number;
  dirZ: number;
  /** Perpendicular offset */
  offset: number;
  /** Valley width */
  width: number;
  /** Valley depth (positive = deeper cut) */
  depth: number;
  /** Meander */
  meanderFreq: number;
  meanderAmp: number;
  seed: number;
}

export function drainageField(x: number, z: number, p: DrainageParams): number {
  const along = x * p.dirX + z * p.dirZ;
  const perpX = -p.dirZ;
  const perpZ = p.dirX;
  let across = x * perpX + z * perpZ - p.offset;

  // Meander
  across += fbm(along * p.meanderFreq + p.seed, 0.5, 2, 2.0, 0.5) * p.meanderAmp;

  // V-shaped valley profile
  const t = Math.abs(across) / p.width;
  const valley = -p.depth * Math.max(0, 1 - t * t);

  return valley;
}

// ── Helpers ──

function smoothClamp(t: number, lo: number, hi: number): number {
  const x = Math.max(0, Math.min(1, (t - lo) / (hi - lo)));
  return x * x * (3 - 2 * x);
}
