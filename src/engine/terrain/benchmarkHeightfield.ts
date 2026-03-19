/**
 * Reference Benchmark heightfield generator.
 *
 * Creates a deterministic macro-deformed plane that approximates
 * the massing of an erosion reference image:
 *   - broad elevated plateau / tableland
 *   - strong outer escarpment
 *   - 1-2 major ridge / shoulder masses
 *   - open lower piedmont / apron area
 *   - room for drainage trees to incise inward
 *
 * All shapes built from simple analytic functions — no randomness.
 * Deterministic and reloadable for apples-to-apples erosion comparison.
 */

import { EditableHeightfield } from './editableHeightfield';
import type { ErosionConfig } from './erodedTerrain';
import { DEFAULT_STREAM_POWER } from './streamPower';

// ── Benchmark erosion config (H2.1c) ──
// Explicit config tuned for benchmark scale: 1024 grid, ±800 extent, cellSize ~1.56
// All area values are in world-area units (m²) after H2.1c normalization.

export const BENCHMARK_EROSION: ErosionConfig = {
  gridSize: 1024,
  extent: 800,
  streamPower: {
    ...DEFAULT_STREAM_POWER,
    enabled: true,
    iterations: 160,           // H2.cal strong incision regime (only runs on explicit "Full Bake")
    erosionK: 0.002,           // H2.cal: 4x stronger K for visible drainage skeleton
    areaExponent: 0.4,
    slopeExponent: 1.0,
    upliftRate: 0.0,           // H2.cal: zero uplift — maximum erosion
    diffusionRate: 0.001,      // H2.cal: minimal diffusion — preserve all detail
    maxErosion: 2.0,           // H2.cal: allow deep cuts
  },
  thermal: {
    enabled: true,
    iterations: 15,
    talusThreshold: 1.2,
    transferRate: 0.3,
  },
  hydraulic: {
    enabled: false,
    droplets: 0,
    maxLifetime: 60,
    inertia: 0.3,
    sedimentCapacity: 6.0,
    minCapacity: 0.02,
    erosionRate: 0.4,
    depositionRate: 0.2,
    evaporationRate: 0.02,
    gravity: 8.0,
    erosionRadius: 2,
    seed: 42,
  },
  fan: {
    enabled: true,
    minDrainageArea: 400,
    confinementDropThreshold: 0.2,
    fanHalfAngle: Math.PI * 0.4,
    fanSlope: 0.08,
    maxFanRadius: 35,
    fanBlend: 0.8,
    debrisEnabled: true,
    debrisSlopeThreshold: 2.0,
    debrisMaxArea: 12,
    debrisRadius: 12,
    debrisRate: 0.2,
  },
};

// ── Primitives ──

/** Smoothstep: 0→1 over [0,1] with smooth acceleration/deceleration */
function smoothstep(t: number): number {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

/** Gaussian bump: peak 1 at center, falls off with sigma */
function gaussian(x: number, z: number, cx: number, cz: number, sigma: number): number {
  const dx = x - cx;
  const dz = z - cz;
  return Math.exp(-(dx * dx + dz * dz) / (2 * sigma * sigma));
}

/** Elongated ridge lobe — gaussian cross-section along perpendicular axis */
function ridgeLobe(
  x: number, z: number,
  cx: number, cz: number,
  angle: number, length: number, width: number,
  height: number,
): number {
  // Rotate point into ridge-local space
  const cos = Math.cos(angle);
  const sin = Math.sin(angle);
  const dx = x - cx;
  const dz = z - cz;
  const along = dx * cos + dz * sin;    // distance along ridge axis
  const across = -dx * sin + dz * cos;  // perpendicular distance

  // Along-axis: fade in from center, fade out at length
  const alongNorm = along / length;
  const alongFade = smoothstep(1 - Math.abs(alongNorm));

  // Across-axis: gaussian cross-section
  const acrossFade = Math.exp(-(across * across) / (2 * width * width));

  // Only forward half of the ridge (from center outward)
  const forwardMask = alongNorm > -0.3 ? 1 : smoothstep((alongNorm + 0.5) * 5);

  return height * alongFade * acrossFade * forwardMask;
}

/** Low-frequency deterministic undulation (no RNG) */
function undulation(x: number, z: number): number {
  return Math.sin(x * 0.015) * Math.cos(z * 0.012) * 3.0
       + Math.sin(x * 0.008 + 1.3) * Math.cos(z * 0.009 + 0.7) * 2.0
       + Math.sin((x + z) * 0.006) * 1.5;
}

/** Medium-frequency terrain texture — adds pre-existing drainage hints */
function terrainTexture(x: number, z: number): number {
  // Several octaves of analytic "noise" to break up smooth surfaces
  return Math.sin(x * 0.03 + z * 0.02) * Math.cos(z * 0.025 - x * 0.01) * 1.2
       + Math.sin(x * 0.05 + 0.8) * Math.cos(z * 0.04 + 1.2) * 0.6
       + Math.sin((x - z) * 0.07) * 0.3
       + Math.cos(x * 0.02 + z * 0.06 + 2.1) * Math.sin(x * 0.04 - z * 0.03) * 0.8;
}

/** Sharp escarpment profile: flat top → steep cliff → gentle apron */
function escarpmentProfile(dist: number, sharpness: number): number {
  // Use a power-smoothstep for sharper cliff edge
  const t = Math.max(0, Math.min(1, dist));
  const s = t * t * t * (t * (t * 6 - 15) + 10); // quintic smoothstep (sharper)
  // Apply sharpness: higher = steeper cliff
  return 1 - Math.pow(s, 1 / sharpness);
}

// ── Main generator ──

/**
 * Create a reference benchmark heightfield with deterministic pre-shaped terrain.
 *
 * V2: Sharper escarpment, stronger ridge/shoulder massing, medium-frequency
 * surface texture to provide pre-existing drainage hints.
 *
 * Grid: 1024×1024, extent ±800 world units.
 * Returns an EditableHeightfield ready for erosion experiments.
 */
export function createReferenceBenchmarkHeightfield(): EditableHeightfield {
  const gridSize = 1024;
  const extent = 800;
  const hf = new EditableHeightfield(gridSize, extent);
  const grid = hf.grid;
  const cellSize = (extent * 2) / (gridSize - 1);

  // ── V3: Single broad tableland with escarpment shoulders ──

  // Plateau: one dominant flat-topped mass, NOT separate hills
  const plateauCX = 0;
  const plateauCZ = 0;
  const plateauRadiusX = 300;    // slightly smaller to keep edges in view
  const plateauRadiusZ = 280;
  const plateauHeight = 60;      // base tableland elevation
  const escarpmentSharpness = 3.0; // very steep cliff

  // ── Shoulder masses — steeper elevation along plateau EDGES ──
  // H2.4c: steeper shoulders feed more organized drainage into reentrant hollows
  const shoulders = [
    // NE shoulder ridge — highest, steepest
    { cx: 200, cz: -180, angle: 0.8, length: 200, width: 80, height: 25 },
    // NW shoulder
    { cx: -180, cz: -120, angle: 2.8, length: 180, width: 70, height: 20 },
    // SE shoulder
    { cx: 150, cz: 160, angle: 1.5, length: 160, width: 70, height: 16 },
    // S shoulder (new — more organized rim relief)
    { cx: -40, cz: 220, angle: 2.0, length: 130, width: 65, height: 14 },
  ];

  // ── Gentle summit domes — very broad, low-relief features ON the tableland ──
  // These create subtle drainage direction without making separate peaks
  const domes = [
    { cx: 60, cz: -40, sigma: 200, height: 8 },   // broad central high
    { cx: -80, cz: 60, sigma: 180, height: 6 },    // secondary
    { cx: 140, cz: 80, sigma: 150, height: 5 },    // subtle eastern rise
  ];

  // ── Reentrant hollows — where escarpment edge is concave (drainage focus) ──
  // H2.4c: more hollows for denser rim-focused tributary initiation
  const hollows = [
    { cx: 0, cz: -220, angle: 1.57, length: 120, width: 60, depth: 12 },   // N reentrant (deeper)
    { cx: -200, cz: 40, angle: 0.3, length: 100, width: 50, depth: 10 },   // W reentrant (deeper)
    { cx: 100, cz: 200, angle: 4.5, length: 100, width: 45, depth: 9 },    // SE reentrant (deeper)
    { cx: -120, cz: -160, angle: 0.9, length: 90, width: 40, depth: 8 },   // NW notch
    { cx: 180, cz: -80, angle: 5.5, length: 80, width: 35, depth: 7 },     // E notch
    { cx: -60, cz: 200, angle: 3.5, length: 85, width: 40, depth: 7 },     // S notch
    { cx: 220, cz: 120, angle: 5.0, length: 70, width: 30, depth: 6 },     // SE2 notch
    { cx: -220, cz: -100, angle: 1.2, length: 75, width: 35, depth: 6 },   // W2 notch
  ];

  // ── Fill grid ──
  for (let gz = 0; gz < gridSize; gz++) {
    for (let gx = 0; gx < gridSize; gx++) {
      const wx = -extent + gx * cellSize;
      const wz = -extent + gz * cellSize;

      // 1. Tableland — one broad flat-topped plateau with sharp escarpment
      const pdx = (wx - plateauCX) / plateauRadiusX;
      const pdz = (wz - plateauCZ) / plateauRadiusZ;
      const plateauDist = Math.sqrt(pdx * pdx + pdz * pdz);

      // Angular warping: irregular escarpment edge
      const angle = Math.atan2(pdz, pdx);
      const edgeWarp = Math.sin(angle * 3 + 0.5) * 0.05
                     + Math.sin(angle * 5 + 1.8) * 0.03
                     + Math.sin(angle * 7 + 3.1) * 0.02
                     + Math.sin(angle * 2 + 0.3) * 0.04;
      const warpedDist = plateauDist + edgeWarp;

      // Very sharp escarpment: the plateau top stays FLAT, drops steeply at edge
      const escarpmentNorm = (warpedDist - 0.80) / 0.12; // narrow transition = steeper cliff
      const plateauMask = escarpmentProfile(escarpmentNorm, escarpmentSharpness);

      let h = plateauHeight * plateauMask;

      // 2. Shoulder masses — raise the escarpment edge to create shoulder ridges
      for (const s of shoulders) {
        const shoulderH = ridgeLobe(wx, wz, s.cx, s.cz, s.angle, s.length, s.width, s.height);
        // Shoulders are strongest at the plateau edge, fade inward
        const edgeBias = smoothstep((warpedDist - 0.5) / 0.4); // stronger near edge
        h += shoulderH * plateauMask * (0.4 + edgeBias * 0.6);
      }

      // 3. Gentle summit domes — very low relief, maintain tableland flatness
      for (const d of domes) {
        h += d.height * gaussian(wx, wz, d.cx, d.cz, d.sigma) * plateauMask;
      }

      // 4. Reentrant hollows — concavities in the escarpment edge
      for (const hollow of hollows) {
        const hollowH = ridgeLobe(wx, wz, hollow.cx, hollow.cz, hollow.angle,
                                   hollow.length, hollow.width, hollow.depth);
        h -= hollowH * plateauMask;
      }

      // 5. Very subtle summit texture (NOT strong enough to create separate peaks)
      h += undulation(wx, wz) * plateauMask * 0.4; // reduced from 1.0
      h += terrainTexture(wx, wz) * plateauMask * 0.5;

      // 6. Piedmont / surrounding terrain (H2.4d: larger passive surround)
      // Beyond the escarpment, create rolling piedmont that gives visual context.
      // Height decreases with distance from the tableland but stays above minimum.
      const outsidePlateau = 1.0 - plateauMask;
      if (outsidePlateau > 0.01) {
        // Piedmont toe slope — steeper near escarpment base, flattening outward
        const distFromEdge = Math.max(0, warpedDist - 0.85);
        const toeSlope = Math.max(0, 15 - distFromEdge * 18); // steep near base

        // Rolling piedmont — gentle undulation across the surrounding terrain
        const piedmontRoll = 4.0
          + Math.sin(wx * 0.008 + 0.5) * Math.cos(wz * 0.007 + 1.2) * 3.0
          + Math.sin(wx * 0.012 + wz * 0.01) * 2.0
          + Math.sin((wx - wz) * 0.005 + 2.1) * 1.5;

        // Radial distance fade — terrain drops gently toward domain edges
        const distFromCenter = Math.sqrt(wx * wx + wz * wz);
        const edgeFade = Math.max(0, 1.0 - distFromCenter / 750);

        h += (toeSlope + piedmontRoll * edgeFade) * outsidePlateau;
      }

      // 7. Large-scale tilt (drainage direction bias — NE slightly higher)
      h += (wx * 0.003 + wz * 0.002) * plateauMask * 0.5;

      // Minimum base height prevents chunk edge artifacts
      grid[gz * gridSize + gx] = Math.max(1.5, h);
    }
  }

  return hf;
}

// ── Benchmark review cameras ──

export interface BenchmarkCamera {
  name: string;
  judges: string;
  camX: number;
  camZ: number;
  clearance: number;
  tgtX: number;
  tgtZ: number;
  tgtClearance: number;
}

export const BENCHMARK_CAMERAS: BenchmarkCamera[] = [
  {
    name: 'reference-wide',
    judges: 'Overall tableland massing, escarpment form, drainage potential',
    camX: 300, camZ: 300, clearance: 300,
    tgtX: 0, tgtZ: 0, tgtClearance: 30,
  },
  {
    name: 'reference-oblique',
    judges: 'Ridge hierarchy, summit variation, tableland silhouette',
    camX: -250, camZ: 300, clearance: 280,
    tgtX: 0, tgtZ: 0, tgtClearance: 25,
  },
  {
    name: 'reference-escarpment',
    judges: 'Escarpment steepness, edge-inward canyon potential, shoulder definition',
    camX: 250, camZ: -250, clearance: 200,
    tgtX: 30, tgtZ: -50, tgtClearance: 30,
  },
  {
    name: 'reference-piedmont',
    judges: 'Lower-slope drainage texture, apron form, depositional receiving area',
    camX: -300, camZ: -250, clearance: 180,
    tgtX: -50, tgtZ: -30, tgtClearance: 15,
  },
];
