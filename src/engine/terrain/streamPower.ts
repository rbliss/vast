/**
 * Stream-power erosion with flow accumulation.
 *
 * Implements the core geomorphic erosion model:
 *   E = K * A^m * S^n
 * where A = upstream drainage area, S = local slope,
 * K = erosion coefficient, m/n = exponents.
 *
 * This produces hierarchical drainage: larger catchments erode
 * faster, creating branching channel networks that converge
 * downstream — unlike droplet erosion which carves independently.
 *
 * Also includes hillslope diffusion for realistic slope profiles
 * between channels (concave-up hillslopes).
 */

// ── Types ──

export interface StreamPowerParams {
  /** Number of erosion iterations (more = deeper/more developed channels) */
  iterations: number;
  /** Erosion coefficient K */
  erosionK: number;
  /** Drainage area exponent m (typically 0.4-0.5) */
  areaExponent: number;
  /** Slope exponent n (typically 1.0-1.3) */
  slopeExponent: number;
  /** Time step per iteration */
  dt: number;
  /** Hillslope diffusion coefficient (smooths between channels) */
  diffusionRate: number;
  /** Minimum slope to prevent division issues */
  minSlope: number;
  /** Uplift rate per iteration (counteracts erosion to maintain relief) */
  upliftRate: number;
  /** Maximum erosion per cell per iteration (prevents runaway incision) */
  maxErosion: number;
  /** Enable sediment transport and deposition pass */
  depositionEnabled: boolean;
  /** Fraction of eroded material that becomes transportable sediment */
  sedimentFraction: number;
  /** Transport capacity coefficient: Tc = Kd * A^md * S^nd */
  transportK: number;
  /** Transport area exponent */
  transportAreaExp: number;
  /** Transport slope exponent */
  transportSlopeExp: number;
}

export const DEFAULT_STREAM_POWER: StreamPowerParams = {
  iterations: 35,
  erosionK: 0.0003,        // H2.1c: recalibrated for world-area A (was 0.008 for cell-count A)
  areaExponent: 0.4,       // H2.1: reduced from 0.5 to let small tributaries erode more
  slopeExponent: 1.0,
  dt: 1.0,
  diffusionRate: 0.003,    // H2.1: reduced from 0.005 to preserve tributary detail
  minSlope: 0.001,
  upliftRate: 0.02,        // H2.1c: reduced from 0.06 to allow erosion at benchmark scale
  maxErosion: 0.5,
  depositionEnabled: true,
  sedimentFraction: 0.6,
  transportK: 0.003,       // H2.1c: recalibrated for world-area A
  transportAreaExp: 0.4,
  transportSlopeExp: 1.1,
};

// ── D8 flow direction + accumulation ──

/** D8 neighbor offsets: [dx, dz] for 8 directions */
const D8_DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const D8_DZ = [-1, -1, -1, 0, 0, 1, 1, 1];
const D8_DIST = [
  Math.SQRT2, 1, Math.SQRT2,
  1, 1,
  Math.SQRT2, 1, Math.SQRT2,
];

/**
 * D-infinity flow accumulation (Tarboton 1997 inspired).
 *
 * For each cell, finds the steepest descent direction as a continuous
 * angle, then distributes flow proportionally to the two D8 neighbors
 * that bracket that angle. This produces smoother, less grid-biased
 * drainage patterns than pure D8.
 *
 * Also computes a D8 "primary receiver" for use by transport/deposition
 * (which still needs a single downstream target).
 */

// 8 facet triangles for D-inf: each defined by two adjacent D8 neighbors
// Facet i uses neighbors at D8 indices FACET_N1[i] and FACET_N2[i]
// Ordered counterclockwise starting from +X direction
const FACET_N1 = [4, 2, 1, 0, 3, 5, 6, 7]; // first neighbor of each facet
const FACET_N2 = [2, 1, 0, 3, 5, 6, 7, 4]; // second neighbor of each facet

function computeFlowAccumulation(
  grid: Float32Array, w: number, h: number, cellSize: number,
): { area: Float32Array; receiver: Int32Array; sorted: Uint32Array; recv1: Int32Array; recv2: Int32Array; frac1: Float32Array } {
  const n = w * h;
  const area = new Float32Array(n);
  area.fill(1.0);

  const receiver = new Int32Array(n);
  receiver.fill(-1);

  // Per-cell flow fractions to two receivers (D-inf proportional split)
  const recv1 = new Int32Array(n);
  const recv2 = new Int32Array(n);
  const frac1 = new Float32Array(n); // fraction to recv1
  recv1.fill(-1);
  recv2.fill(-1);

  for (let z = 1; z < h - 1; z++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = z * w + x;
      const hc = grid[idx];

      // Find steepest facet slope among 8 triangular facets
      let bestFacetSlope = 0;
      let bestN1 = -1;
      let bestN2 = -1;
      let bestFrac = 1.0; // fraction going to n1 (1-frac goes to n2)
      let bestD8 = -1;
      let bestD8Slope = 0;

      for (let f = 0; f < 8; f++) {
        const d1 = FACET_N1[f];
        const d2 = FACET_N2[f];

        const nx1 = x + D8_DX[d1], nz1 = z + D8_DZ[d1];
        const nx2 = x + D8_DX[d2], nz2 = z + D8_DZ[d2];

        const ni1 = nz1 * w + nx1;
        const ni2 = nz2 * w + nx2;

        const drop1 = (hc - grid[ni1]) / (D8_DIST[d1] * cellSize);
        const drop2 = (hc - grid[ni2]) / (D8_DIST[d2] * cellSize);

        // Track best D8 receiver (steepest single neighbor)
        if (drop1 > bestD8Slope) { bestD8Slope = drop1; bestD8 = ni1; }
        if (drop2 > bestD8Slope) { bestD8Slope = drop2; bestD8 = ni2; }

        // Only consider facets where at least one neighbor is downhill
        if (drop1 <= 0 && drop2 <= 0) continue;

        // Facet slope: average of the two edge slopes
        const facetSlope = (Math.max(0, drop1) + Math.max(0, drop2)) * 0.5;

        if (facetSlope > bestFacetSlope) {
          bestFacetSlope = facetSlope;

          if (drop1 > 0 && drop2 > 0) {
            // Both downhill: split proportionally
            const total = drop1 + drop2;
            bestN1 = ni1;
            bestN2 = ni2;
            bestFrac = drop1 / total;
          } else if (drop1 > 0) {
            // Only n1 is downhill
            bestN1 = ni1;
            bestN2 = -1;
            bestFrac = 1.0;
          } else {
            // Only n2 is downhill
            bestN1 = ni2;
            bestN2 = -1;
            bestFrac = 1.0;
          }
        }
      }

      recv1[idx] = bestN1;
      recv2[idx] = bestN2;
      frac1[idx] = bestFrac;
      receiver[idx] = bestD8; // D8 primary receiver for transport/deposition
    }
  }

  // Sort cells by height (descending) for topological accumulation
  const sorted = new Uint32Array(n);
  for (let i = 0; i < n; i++) sorted[i] = i;
  sorted.sort((a, b) => grid[b] - grid[a]);

  // Accumulate: distribute area proportionally (D-inf)
  for (let i = 0; i < n; i++) {
    const idx = sorted[i];
    const a = area[idx];
    const r1 = recv1[idx];
    const r2 = recv2[idx];
    const f1 = frac1[idx];

    if (r1 >= 0) {
      area[r1] += a * f1;
    }
    if (r2 >= 0) {
      area[r2] += a * (1 - f1);
    }
  }

  return { area, receiver, sorted, recv1, recv2, frac1 };
}

/**
 * H2.5d: Propagate a provenance field downstream using the same D-inf routing.
 * Each cell starts with a seed value (e.g., x-position-based left/right identity).
 * Downstream cells get area-weighted average of upstream provenance.
 * Returns: per-cell provenance in [0,1] (0 = right-system, 1 = left-system).
 */
function propagateProvenance(
  seed: Float32Array,
  area: Float32Array,
  sorted: Uint32Array,
  recv1: Int32Array, recv2: Int32Array, frac1: Float32Array,
  n: number,
): Float32Array {
  // Track provenance*area product and total area for weighted average
  const provArea = new Float32Array(n);
  const totalArea = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    provArea[i] = seed[i]; // each cell contributes its own seed * 1 cell
    totalArea[i] = 1;
  }

  // Propagate downstream (same sorted order as flow accumulation)
  for (let i = 0; i < sorted.length; i++) {
    const idx = sorted[i];
    const pa = provArea[idx];
    const ta = totalArea[idx];
    const r1 = recv1[idx];
    const r2 = recv2[idx];
    const f1 = frac1[idx];

    if (r1 >= 0) {
      provArea[r1] += pa * f1;
      totalArea[r1] += ta * f1;
    }
    if (r2 >= 0) {
      provArea[r2] += pa * (1 - f1);
      totalArea[r2] += ta * (1 - f1);
    }
  }

  // Compute weighted average provenance
  const prov = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    prov[i] = totalArea[i] > 0 ? provArea[i] / totalArea[i] : seed[i];
  }
  return prov;
}

/**
 * Compute local slope magnitude at each cell using central differences.
 */
function computeSlopes(
  grid: Float32Array, w: number, h: number, cellSize: number,
): Float32Array {
  const slopes = new Float32Array(w * h);
  const inv2cs = 1 / (2 * cellSize);

  for (let z = 1; z < h - 1; z++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = z * w + x;
      const dhdx = (grid[idx + 1] - grid[idx - 1]) * inv2cs;
      const dhdz = (grid[idx + w] - grid[idx - w]) * inv2cs;
      slopes[idx] = Math.sqrt(dhdx * dhdx + dhdz * dhdz);
    }
  }

  return slopes;
}

/**
 * Compute planform (contour) curvature at each cell.
 *
 * Planform curvature measures flow convergence/divergence:
 *   positive = convergent (hollow/channel head) → water concentrates
 *   negative = divergent (ridge/nose) → water spreads
 *   zero = planar slope
 *
 * Uses the second-order surface fit method (Zevenbergen & Thorne 1987).
 * Returns raw curvature values (not clamped).
 */
function computePlanformCurvature(
  grid: Float32Array, w: number, h: number, cellSize: number,
): Float32Array {
  const curv = new Float32Array(w * h);
  const cs2 = cellSize * cellSize;

  for (let z = 1; z < h - 1; z++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = z * w + x;

      // First derivatives (central differences)
      const p = (grid[idx + 1] - grid[idx - 1]) / (2 * cellSize);     // dh/dx
      const q = (grid[idx + w] - grid[idx - w]) / (2 * cellSize);     // dh/dz

      // Second derivatives
      const r = (grid[idx + 1] - 2 * grid[idx] + grid[idx - 1]) / cs2; // d²h/dx²
      const t = (grid[idx + w] - 2 * grid[idx] + grid[idx - w]) / cs2; // d²h/dz²
      const s = (grid[idx + w + 1] - grid[idx + w - 1]
               - grid[idx - w + 1] + grid[idx - w - 1]) / (4 * cs2);   // d²h/dxdz

      // Planform curvature: positive = convergent (hollow)
      const denom = p * p + q * q;
      if (denom > 1e-10) {
        curv[idx] = -(q * q * r - 2 * p * q * s + p * p * t) / Math.pow(denom, 1.5);
      }
    }
  }

  return curv;
}

/**
 * Apply one pass of hillslope diffusion (linear).
 * Smooths terrain between channels, creating concave-up slope profiles.
 */
function diffuse(
  grid: Float32Array, w: number, h: number,
  cellSize: number, rate: number,
): void {
  const cs2 = cellSize * cellSize;
  const factor = rate / cs2;

  // Use a temporary buffer for Jacobi-style iteration
  const tmp = new Float32Array(grid.length);
  tmp.set(grid);

  for (let z = 1; z < h - 1; z++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = z * w + x;
      const laplacian = grid[idx - 1] + grid[idx + 1] +
                        grid[idx - w] + grid[idx + w] -
                        4 * grid[idx];
      tmp[idx] = grid[idx] + laplacian * factor;
    }
  }

  grid.set(tmp);
}

// ── Confinement detection ──

/**
 * Compute channel confinement at each cell.
 * Confinement = fraction of 8-neighbors that are higher than this cell.
 * High (near 1.0) = valley bottom. Low (near 0.0) = ridge/open terrain.
 */
function computeConfinement(grid: Float32Array, w: number, h: number): Float32Array {
  const n = w * h;
  const conf = new Float32Array(n);

  for (let z = 1; z < h - 1; z++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = z * w + x;
      const hc = grid[idx];
      let higher = 0;
      for (let d = 0; d < 8; d++) {
        const ni = (z + D8_DZ[d]) * w + (x + D8_DX[d]);
        if (grid[ni] > hc) higher++;
      }
      conf[idx] = higher / 8;
    }
  }

  return conf;
}

// ── Divergent fan deposition ──

/**
 * Route sediment downstream with divergent deposition.
 *
 * Incision routing uses D8 (single steepest receiver).
 * Deposition uses MULTI-FLOW: when sediment exceeds transport capacity,
 * deposit is spread across ALL lower neighbors proportionally to slope,
 * creating fan-like spreading at channel exits and unconfined zones.
 *
 * Confinement detection triggers wider spreading where channels exit
 * valleys into open terrain.
 */
function transportAndDeposit(
  grid: Float32Array,
  sedimentFlux: Float32Array,
  area: Float32Array,
  receiver: Int32Array,
  slopes: Float32Array,
  deposition: Float32Array,
  w: number, h: number, cellSize: number,
  transportK: number, transportAreaExp: number, transportSlopeExp: number,
  minSlope: number,
): void {
  const n = w * h;

  // Compute confinement
  const confinement = computeConfinement(grid, w, h);

  // Sort cells by height descending — process upstream before downstream
  const sorted = new Uint32Array(n);
  for (let i = 0; i < n; i++) sorted[i] = i;
  sorted.sort((a, b) => grid[b] - grid[a]);

  for (let i = 0; i < n; i++) {
    const idx = sorted[i];
    const x = idx % w;
    const z = (idx - x) / w;
    if (x < 1 || x >= w - 1 || z < 1 || z >= h - 1) continue;

    const flux = sedimentFlux[idx];
    if (flux <= 0) continue;

    const A = area[idx];
    const S = Math.max(slopes[idx], minSlope);

    // Transport capacity
    const capacity = transportK * Math.pow(A, transportAreaExp) * Math.pow(S, transportSlopeExp);

    if (flux > capacity) {
      // Over capacity: deposit the excess with fan spreading
      const excess = flux - capacity;
      const deposit = excess * 0.5;
      const conf = confinement[idx];

      // Unconfined deposition: spread across lower neighbors
      // Confined deposition: deposit at current cell
      const spreadFactor = Math.max(0, 1 - conf * 1.5); // 0 = fully confined, 1 = fully open

      if (spreadFactor > 0.1) {
        // Multi-flow fan deposition
        const hc = grid[idx];
        let totalDrop = 0;
        const drops: number[] = [];
        const nIdxs: number[] = [];

        for (let d = 0; d < 8; d++) {
          const nx = x + D8_DX[d];
          const nz = z + D8_DZ[d];
          if (nx < 1 || nx >= w - 1 || nz < 1 || nz >= h - 1) continue;
          const ni = nz * w + nx;
          const drop = hc - grid[ni];
          if (drop > 0) {
            // Weight by drop / distance (steeper neighbors get more)
            const weight = drop / D8_DIST[d];
            drops.push(weight);
            nIdxs.push(ni);
            totalDrop += weight;
          }
        }

        if (totalDrop > 0) {
          const fanDeposit = deposit * spreadFactor;
          const selfDeposit = deposit * (1 - spreadFactor);

          // Deposit at self
          grid[idx] += selfDeposit;
          deposition[idx] += selfDeposit;

          // Spread fan deposit to lower neighbors proportionally
          for (let d = 0; d < drops.length; d++) {
            const amount = fanDeposit * (drops[d] / totalDrop);
            grid[nIdxs[d]] += amount;
            deposition[nIdxs[d]] += amount;
          }
        } else {
          grid[idx] += deposit;
          deposition[idx] += deposit;
        }
      } else {
        // Confined: deposit at self
        grid[idx] += deposit;
        deposition[idx] += deposit;
      }

      sedimentFlux[idx] -= deposit;
    }

    // Pass remaining sediment to D8 receiver
    const recv = receiver[idx];
    if (recv >= 0) {
      sedimentFlux[recv] += sedimentFlux[idx];
    }
  }
}

// ── Main stream-power erosion loop ──

/**
 * Run stream-power erosion on the height grid.
 *
 * Each iteration:
 *   1. Compute flow accumulation (drainage area A)
 *   2. Compute local slopes (S)
 *   3. Erode: h -= dt * K * A^m * S^n
 *   4. Apply hillslope diffusion
 *   5. Optional uplift
 *
 * This produces hierarchical channels because cells with larger
 * drainage areas (more upstream catchment) erode faster.
 */
export interface StreamPowerResult {
  area: Float32Array;
  receiver: Int32Array;
  slopes: Float32Array;
  /** Accumulated deposition at each cell (total material deposited over all iterations) */
  deposition: Float32Array;
  /** H2.5d: Last-iteration headwater provenance field (0=right system, 1=left system) */
  provenance: Float32Array;
}

/**
 * Resistance generator: called each iteration with current heights
 * to produce a per-cell erodibility grid (0 = resistant, 1 = soft).
 */
export type ResistanceGenerator = (heights: Float32Array) => Float32Array;

/** AE3 guidance fields for persistent H2 integration */
export interface AE3Guidance {
  channelStrength: Float32Array;  // [0,1] trunk/tributary strength
  distToChannel: Float32Array;    // world-space distance to nearest channel
  valleyWidth: Float32Array;      // target valley half-width
  valleyDepth: Float32Array;      // target valley depth
}

import { type LateralErosionParams, DEFAULT_LATERAL } from './erodedTerrain';

export function streamPowerErosion(
  grid: Float32Array, w: number, h: number,
  cellSize: number, params: StreamPowerParams,
  resistanceGen?: ResistanceGenerator,
  onProgress?: (iteration: number) => void,
  aeChannelStrength?: Float32Array,
  aeGuidance?: AE3Guidance,
  lateralParams?: LateralErosionParams,
): StreamPowerResult {
  const { iterations, erosionK, areaExponent, slopeExponent, dt,
          diffusionRate, minSlope, upliftRate, maxErosion,
          depositionEnabled, sedimentFraction, transportK,
          transportAreaExp, transportSlopeExp } = params;

  const n = w * h;
  // Sediment flux: how much sediment is being carried through each cell
  const sedimentFlux = depositionEnabled ? new Float32Array(n) : null;
  // Accumulated deposition mask
  const deposition = new Float32Array(n);

  let lastArea: Float32Array = new Float32Array(n);
  let lastProvenance: Float32Array = new Float32Array(n);
  let lastReceiver: Int32Array = new Int32Array(n);
  let lastSlopes: Float32Array = new Float32Array(n);

  // H2.5e.8: Persistent reference + current centerline state for equilibrium migration
  let refCL: Float64Array | null = null;   // frozen reference centerline (from initial terrain)
  let refCurv: Float64Array | null = null; // reference curvature
  let refOuter: Int8Array | null = null;   // reference outer-bank side
  let refApex: Float64Array | null = null; // reference apex weighting
  let curCL: Float64Array | null = null;   // current observed centerline (updated periodically)

  // H2.4a: Persistent proto-channel susceptibility field
  // Accumulates across iterations from multiscale convergence signals + headward support.
  // Used to modulate channel-initiation threshold — NOT direct carving.
  const protoChannel = new Float32Array(n);

  // AE3.3: Build corridor influence field from all AE guidance fields
  const guidance = aeGuidance ?? (aeChannelStrength ? {
    channelStrength: aeChannelStrength,
    distToChannel: new Float32Array(n).fill(Infinity),
    valleyWidth: new Float32Array(n),
    valleyDepth: new Float32Array(n),
  } : null);

  // Precompute corridor field: smooth influence that covers the full valley width
  // corridor[i] = smoothstep(1, 0, distToChannel / max(valleyWidth, eps)) * channelStrength
  const corridor = guidance ? new Float32Array(n) : null;
  if (guidance && corridor) {
    const hasDist = guidance.distToChannel.length === n;
    const hasWidth = guidance.valleyWidth.length === n;
    for (let i = 0; i < n; i++) {
      if (!hasDist || !hasWidth) {
        corridor[i] = guidance.channelStrength[i];
        continue;
      }
      const dist = guidance.distToChannel[i];
      const width = Math.max(1, guidance.valleyWidth[i]);
      const t = Math.min(1, dist / width);
      const corr = (1 - t * t * (3 - 2 * t)) * guidance.channelStrength[i];
      corridor[i] = corr;
    }
    console.log(`[stream-power] AE3.3: corridor field built from multi-field guidance`);
  }

  for (let iter = 0; iter < iterations; iter++) {
    if (onProgress) onProgress(iter + 1);

    // Step 0: Recompute resistance from current heights (dynamic strata)
    const resistance = resistanceGen ? resistanceGen(grid) : null;

    // Step 1: Flow accumulation + receiver graph
    const flowResult = computeFlowAccumulation(grid, w, h, cellSize);
    const { area, receiver, sorted, recv1, recv2, frac1 } = flowResult;

    // H2.1c: Convert drainage area from cell-count to world-area units
    const cellArea = cellSize * cellSize;
    for (let i = 0; i < n; i++) {
      area[i] *= cellArea;
    }

    // H2.5d: Compute headwater provenance for divide preservation.
    // Gated by divideProtection config flag — skip when disabled for perf.
    const divideEnabled = lateralParams?.divideProtection ?? false;
    let provenance: Float32Array;
    const dividePenalty = new Float32Array(n); // zeros if disabled
    if (divideEnabled) {
      // Seed: left-side cells get provenance=1, right-side get 0, smooth transition at x=0.
      // Propagated downstream: balanced provenance (≈0.5) = interfluve divide zone.
      const provSeed = new Float32Array(n);
      for (let z2 = 0; z2 < h; z2++) {
        for (let x2 = 0; x2 < w; x2++) {
          const wx = -w / 2 + x2; // approximate world x in grid coords
          provSeed[z2 * w + x2] = Math.max(0, Math.min(1, 0.5 - wx / (w * 0.3)));
        }
      }
      provenance = propagateProvenance(provSeed, area, sorted, recv1, recv2, frac1, n);
      // dividePenalty: 1.0 where both systems contribute equally (provenance ≈ 0.5)
      for (let i = 0; i < n; i++) {
        dividePenalty[i] = 1.0 - 2.0 * Math.abs(provenance[i] - 0.5);
        if (dividePenalty[i] < 0) dividePenalty[i] = 0;
      }
    } else {
      provenance = new Float32Array(n);
    }

    lastArea = area as Float32Array;
    lastReceiver = receiver as Int32Array;
    lastProvenance = provenance;

    // Step 2: Slopes
    const slopes = computeSlopes(grid, w, h, cellSize);
    lastSlopes = slopes as Float32Array;

    // Step 2b: Planform curvature (convergence detection for tributary initiation)
    const curvature = computePlanformCurvature(grid, w, h, cellSize);

    // Step 2c: Update proto-channel susceptibility field (H2.4a/b/c)
    // Combines multiscale convergence + headward support into a persistent field.
    // H2.4c: strongly biased toward escarpment rims / reentrant hollows.
    {
      const baseThreshold = 20.0;
      const decayRate = 0.97;
      const convergenceGain = 0.08;
      const reliefGain = 0.05;
      const headwardGain = 0.30;     // H2.4c: stronger headward — main driver
      const rimGain = 0.20;          // H2.4c: new dedicated rim proximity signal

      // Decay existing field
      for (let i = 0; i < n; i++) {
        protoChannel[i] *= decayRate;
      }

      // AE3.3: Persistent corridor reinforcement
      // Use the full corridor field (not just channelStrength) as the floor
      if (corridor) {
        for (let i = 0; i < n; i++) {
          const aeFloor = corridor[i] * 0.75;
          if (protoChannel[i] < aeFloor) protoChannel[i] = aeFloor;
        }
      }

      for (let z = 5; z < h - 5; z++) {
        for (let x = 5; x < w - 5; x++) {
          const idx = z * w + x;
          const A_here = area[idx];
          const S_here = slopes[idx];
          const sai = A_here * S_here;

          // Skip already-channelized cells
          if (sai > baseThreshold) continue;
          // Skip very flat deep interior (mesa protection)
          if (S_here < 0.02) continue;

          // ── Rim proximity detection (H2.4c) ──
          // Detect if this cell is near the escarpment edge by checking
          // max height drop within a wider neighborhood (radius 8 cells).
          // Cells near rims: high local height but steep drop nearby.
          let maxDrop = 0;
          const hHere = grid[idx];
          for (let dz = -8; dz <= 8; dz += 4) {
            for (let dx = -8; dx <= 8; dx += 4) {
              if (dx === 0 && dz === 0) continue;
              const nz2 = z + dz, nx2 = x + dx;
              if (nz2 < 0 || nz2 >= h || nx2 < 0 || nx2 >= w) continue;
              const drop = hHere - grid[nz2 * w + nx2];
              if (drop > maxDrop) maxDrop = drop;
            }
          }
          // rimProximity: 0 = flat interior, high = near escarpment edge
          const rimProximity = Math.min(1.0, maxDrop / 20.0); // normalize: 20 units drop = full rim

          // ── Signal 1: Local convergence × rim bias ──
          const localConv = Math.max(0, curvature[idx]);
          const convSignal = localConv * convergenceGain * (1.0 + rimProximity * 3.0);
          protoChannel[idx] += convSignal;

          // ── Signal 2: Neighborhood relief × rim bias ──
          let neighborSum = 0, neighborCount = 0;
          for (let dz = -5; dz <= 5; dz += 2) {
            for (let dx = -5; dx <= 5; dx += 2) {
              if (dx === 0 && dz === 0) continue;
              const ni = (z + dz) * w + (x + dx);
              if (ni >= 0 && ni < n) { neighborSum += grid[ni]; neighborCount++; }
            }
          }
          if (neighborCount > 0) {
            const neighborMean = neighborSum / neighborCount;
            const belowMean = Math.max(0, neighborMean - grid[idx]);
            protoChannel[idx] += belowMean * reliefGain * (1.0 + rimProximity * 2.0) / Math.max(1, cellSize);
          }

          // ── Signal 3: Rim proximity directly ──
          // Cells near the escarpment rim with any slope get direct susceptibility
          if (rimProximity > 0.3 && S_here > 0.05) {
            protoChannel[idx] += rimGain * rimProximity * S_here;
          }

          // ── Signal 4: Headward support from existing channel heads ──
          // If a downstream neighbor IS channelized, this cell gets strong susceptibility.
          // Also check 2nd-order downstream for broader headward influence.
          const recv = receiver[idx];
          if (recv >= 0 && recv !== idx) {
            const recvSAI = area[recv] * slopes[recv];
            if (recvSAI > baseThreshold) {
              // Downstream is a channel — this is a potential channel head extension
              protoChannel[idx] += headwardGain * Math.min(1.0, S_here * 3.0);
            } else {
              // Check 2nd-order downstream
              const recv2 = receiver[recv];
              if (recv2 >= 0 && recv2 !== recv) {
                const recv2SAI = area[recv2] * slopes[recv2];
                if (recv2SAI > baseThreshold) {
                  protoChannel[idx] += headwardGain * 0.5 * Math.min(1.0, S_here * 2.0);
                }
              }
            }
          }

          // Clamp to [0, 1]
          if (protoChannel[idx] > 1.0) protoChannel[idx] = 1.0;
        }
      }

      // Proto-field diagnostics (every 20 iterations)
      if (iter % 20 === 0) {
        let maxProto = 0, sumProto = 0, above05 = 0, above03 = 0;
        let channelCount = 0;
        for (let i = 0; i < n; i++) {
          if (protoChannel[i] > maxProto) maxProto = protoChannel[i];
          sumProto += protoChannel[i];
          if (protoChannel[i] > 0.5) above05++;
          if (protoChannel[i] > 0.03) above03++;
          if (area[i] * slopes[i] > baseThreshold) channelCount++;
        }
        console.log(`[proto] iter=${iter}: max=${maxProto.toFixed(3)} mean=${(sumProto/n).toFixed(4)} >0.5=${above05} >0.03=${above03} channels=${channelCount}`);
      }
    }

    // H2.5e.8: Equilibrium-offset migration controller
    const hasMigrationEarly = (lateralParams?.maxMigrationSlope ?? 999) < 100;
    const signedCurvField = new Float32Array(n);
    const curvOuterSide = new Int8Array(n);
    const trunkTangentX = new Float32Array(n);
    const trunkTangentZ = new Float32Array(n);
    const smoothArea = new Float32Array(n);
    for (let i = 0; i < n; i++) smoothArea[i] = area[i];
    // Per-cell residual-driven migration gain (0 = at target, 1 = far from target)
    const migrationGain = new Float32Array(n);

    // Trunk tangents + smoothed area (for lateral pass)
    {
      const lp = lateralParams ?? DEFAULT_LATERAL;
      const minCA = lp.minChannelArea;
      for (let z2 = 1; z2 < h - 1; z2++) {
        for (let x2 = 1; x2 < w - 1; x2++) {
          const i = z2 * w + x2;
          if (area[i] < minCA) continue;
          let tdx = 0, tdz = 0, cur = i;
          let areaSum = area[i], areaCount = 1;
          for (let step = 0; step < 3; step++) {
            const r = receiver[cur];
            if (r < 0 || r === cur) break;
            tdx += (r % w) - (cur % w); tdz += Math.floor(r / w) - Math.floor(cur / w);
            cur = r; areaSum += area[r]; areaCount++;
          }
          const tlen = Math.sqrt(tdx * tdx + tdz * tdz);
          if (tlen > 0.001) { trunkTangentX[i] = tdx / tlen; trunkTangentZ[i] = tdz / tlen; }
          else {
            const dx2 = (grid[i + 1] - grid[i - 1]) / (2 * cellSize);
            const dz2 = (grid[i + w] - grid[i - w]) / (2 * cellSize);
            const gl = Math.sqrt(dx2 * dx2 + dz2 * dz2);
            if (gl > 0.001) { trunkTangentX[i] = -dx2 / gl; trunkTangentZ[i] = -dz2 / gl; }
          }
          smoothArea[i] = areaSum / areaCount;
        }
      }
    }

    if (hasMigrationEarly) {
      // Initialize reference centerline ONCE from initial terrain
      if (!refCL) {
        refCL = new Float64Array(h);
        refCurv = new Float64Array(h);
        refOuter = new Int8Array(h);
        refApex = new Float64Array(h);

        // Extract thalweg from initial grid
        const midRow = Math.floor(h / 2);
        let seedGx = Math.floor(w / 2), seedMinH = Infinity;
        for (let gx = Math.max(0, seedGx - 20); gx <= Math.min(w - 1, seedGx + 20); gx++) {
          if (grid[midRow * w + gx] < seedMinH) { seedMinH = grid[midRow * w + gx]; seedGx = gx; }
        }
        refCL[midRow] = seedGx;
        for (const dir of [1, -1]) {
          let pg = seedGx;
          for (let gz = midRow + dir; dir === 1 ? gz < h - 3 : gz >= 3; gz += dir) {
            let bg = pg, bh = Infinity;
            for (let gx = Math.max(0, Math.round(pg) - 8); gx <= Math.min(w - 1, Math.round(pg) + 8); gx++) {
              if (grid[gz * w + gx] < bh) { bh = grid[gz * w + gx]; bg = gx; }
            }
            refCL[gz] = bg; pg = bg;
          }
        }
        // Smooth reference
        for (let pass = 0; pass < 3; pass++) {
          const tmp = new Float64Array(refCL);
          for (let gz = 6; gz < h - 6; gz++) {
            let sum = 0; for (let j = gz - 5; j <= gz + 5; j++) sum += tmp[j];
            refCL[gz] = sum / 11;
          }
        }
        // Compute reference curvature + outer side
        for (let gz = 5; gz < h - 5; gz++) {
          const tx = refCL[gz + 3] - refCL[gz - 3];
          const tz = 6.0;
          const tlen = Math.sqrt(tx * tx + tz * tz);
          const d2x = refCL[gz + 3] - 2 * refCL[gz] + refCL[gz - 3];
          refCurv[gz] = d2x / (tlen * tlen) * 6;
          refOuter[gz] = refCurv[gz] > 0 ? 1 : -1;
        }
        // Apex weighting from reference curvature (non-max suppression)
        const absCurv = new Float64Array(h);
        for (let gz = 5; gz < h - 5; gz++) absCurv[gz] = Math.abs(refCurv[gz]);
        for (let gz = 10; gz < h - 10; gz++) {
          let isMax = true;
          for (let j = gz - 7; j <= gz + 7; j++) {
            if (j !== gz && absCurv[j] > absCurv[gz]) { isMax = false; break; }
          }
          if (isMax && absCurv[gz] > 0.002) {
            for (let j = Math.max(5, gz - 12); j <= Math.min(h - 6, gz + 12); j++) {
              const d = Math.abs(j - gz);
              const wt = Math.exp(-d * d / (2 * 8 * 8));
              if (wt > refApex[j]) refApex[j] = wt;
            }
          }
        }
        // Initialize current centerline tracker
        curCL = new Float64Array(refCL);
      }

      // Update current centerline every 2 iterations for responsive damping
      if (curCL && iter % 2 === 0) {
        const midRow = Math.floor(h / 2);
        // Seed from actual lowest point in wide band around grid center
        let seedGx = Math.floor(w / 2), seedMinH = Infinity;
        for (let gx = Math.max(0, seedGx - 40); gx <= Math.min(w - 1, seedGx + 40); gx++) {
          if (grid[midRow * w + gx] < seedMinH) { seedMinH = grid[midRow * w + gx]; seedGx = gx; }
        }
        curCL[midRow] = seedGx;
        let pg = seedGx;
        for (const dir of [1, -1]) {
          let prevg = pg;
          for (let gz = midRow + dir; dir === 1 ? gz < h - 3 : gz >= 3; gz += dir) {
            let bg = prevg, bh = Infinity;
            // Very wide search to track migrated channel
            for (let gx = Math.max(0, Math.round(prevg) - 40); gx <= Math.min(w - 1, Math.round(prevg) + 40); gx++) {
              if (grid[gz * w + gx] < bh) { bh = grid[gz * w + gx]; bg = gx; }
            }
            curCL[gz] = bg; prevg = bg;
          }
        }
        // Smooth current
        for (let pass = 0; pass < 2; pass++) {
          const tmp = new Float64Array(curCL);
          for (let gz = 6; gz < h - 6; gz++) {
            let sum = 0; for (let j = gz - 4; j <= gz + 4; j++) sum += tmp[j];
            curCL[gz] = sum / 9;
          }
        }
      }

      // Compute residual-driven migration gain per row, rasterize to cells
      const maxOffsetCells = 2.8; // target: ~4.4 world units at cellSize 1.57
      const kCurv = 40.0; // curvature-to-offset scaling
      const corridorRadius = 5;
      const minCA = (lateralParams ?? DEFAULT_LATERAL).minChannelArea;

      for (let gz = 5; gz < h - 5; gz++) {
        const apex = refApex![gz];
        if (apex < 0.05) continue;
        const outer = refOuter![gz];
        if (outer === 0) continue;

        // Target offset from reference curve
        const targetOffset = Math.min(maxOffsetCells,
          kCurv * Math.pow(Math.abs(refCurv![gz]), 0.8) * apex);
        if (targetOffset < 0.1) continue;

        // Absolute displacement from reference (regardless of direction)
        const absOffset = curCL ? Math.abs(curCL[gz] - refCL[gz]) : 0;

        // Residual: how much more offset is allowed?
        const residual = Math.max(0, targetOffset - absOffset);
        const gain = residual / Math.max(targetOffset, 0.01);

        // Debug: log controller state at z≈128 (mid-grid) every 20 iterations
        if (iter % 20 === 0 && gz === Math.floor(h / 2)) {
          console.log(`[mig-ctrl] iter=${iter} gz=${gz} refCL=${refCL[gz].toFixed(1)} curCL=${curCL?.[gz]?.toFixed(1)} absOff=${absOffset.toFixed(1)} target=${targetOffset.toFixed(2)} residual=${residual.toFixed(2)} gain=${gain.toFixed(3)}`);
        }

        // Compute tangent/normal from reference curve
        const tx = refCL[Math.min(h - 1, gz + 3)] - refCL[Math.max(0, gz - 3)];
        const tz = 6.0;
        const tlen = Math.sqrt(tx * tx + tz * tz);
        const tanX = tx / tlen, tanZ = tz / tlen;

        // Rasterize to corridor cells
        const clx = curCL ? curCL[gz] : refCL[gz];
        for (let gx = Math.max(3, Math.round(clx) - corridorRadius); gx <= Math.min(w - 4, Math.round(clx) + corridorRadius); gx++) {
          const idx2 = gz * w + gx;
          if (smoothArea[idx2] < minCA * 0.3) continue;
          signedCurvField[idx2] = refCurv![gz] * apex;
          curvOuterSide[idx2] = outer;
          migrationGain[idx2] = gain;
          trunkTangentX[idx2] = tanX;
          trunkTangentZ[idx2] = tanZ;
        }
      }
    }

    // H2.5e.9: Precompute per-row corridor-level overshoot damping
    const rowDampK = hasMigrationEarly && refCL && curCL && refApex && refCurv
      ? new Float32Array(h)
      : null;
    if (rowDampK && refCL && curCL && refApex && refCurv) {
      const maxOffCells = 2.0; // ~3.1 world units max
      const kCurv9 = 8.0; // low scaling — tight control
      rowDampK.fill(1.0); // default: no damping

      for (let gz = 5; gz < h - 5; gz++) {
        // Apply damping everywhere along the corridor, not just apex zones
        // Use curvature for target offset scaling, but ensure a minimum target
        const apex = Math.max(0.1, refApex[gz]); // minimum 0.1 so all rows get some target
        const targetOff = Math.max(1.5, Math.min(maxOffCells, kCurv9 * Math.pow(Math.abs(refCurv[gz]), 0.8) * apex));
        const clOvershoot = Math.max(0, Math.abs(curCL[gz] - refCL[gz]) - targetOff);

        if (clOvershoot > 0) {
          // Smoothstep: ramp from 1.0 to 0.1 over 3 cells of overshoot
          const t9 = Math.min(1, clOvershoot / 3.0);
          const ss = t9 * t9 * (3 - 2 * t9);
          rowDampK[gz] = 1.0 - ss * 0.9; // reduces to 0.1 at full overshoot
        }
      }
    }

    // H2.5e.4: Buffered incision + point bar deposits
    const incisionBuf = new Float32Array(n);
    const pointBarBuf = new Float32Array(n);

    // Step 3: Stream-power incision + sediment production
    if (sedimentFlux) sedimentFlux.fill(0);

    for (let z = 1; z < h - 1; z++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = z * w + x;
        const A = area[idx];
        const S = Math.max(slopes[idx], minSlope);

        // Resistance from dynamic strata
        const R = resistance ? resistance[idx] : 1.0;

        // ── Channel initiation model (H2.1b + H2.3 headward propagation) ──
        const planCurv = curvature[idx];

        // Base channel threshold (world-scale)
        let channelThreshold = 20.0;

        // Convergence lowers threshold (immediate planform curvature effect)
        if (planCurv > 0) {
          channelThreshold *= Math.max(0.15, 1.0 - Math.min(planCurv * 10.0, 0.85));
        }

        // AE3.3: Corridor-based threshold bias — direct from corridor field
        if (corridor) {
          const guide = corridor[idx];
          if (guide > 0.01) {
            // Strong corridor influence: threshold can drop to 25% of base
            channelThreshold *= Math.max(0.25, 1.0 - guide * 0.75);
          }
        }

        // H2.4a/b: Proto-channel susceptibility lowers threshold
        const proto = protoChannel[idx];
        if (proto > 0.03) {
          channelThreshold *= Math.max(0.1, 1.0 - proto * 0.9);
        }

        // H2.5d: Divide preservation — raise threshold at interfluve zones
        // This prevents stream-power incision from chewing across the divide
        const divPen = dividePenalty[idx];
        if (divPen > 0.1) {
          channelThreshold *= 1.0 + divPen * 3.0; // up to 4x threshold at balanced divide
        }

        // Slope-area index (Montgomery-Dietrich criterion, world-scale)
        const slopeAreaIndex = A * S;

        // ── Headward erosion (knickpoint retreat) ──
        // Above a knickpoint (downstream steeper), amplify erosion to bite inward
        let headwardBoost = 1.0;
        const recv = receiver[idx];
        if (recv >= 0 && recv !== idx) {
          const recvSlope = slopes[recv] ?? 0;
          if (recvSlope > S * 1.3 && recvSlope > 0.15) {
            headwardBoost = 1.0 + Math.min((recvSlope - S) * 2.0, 2.0);
          }
        }

        // ── Mesa-top protection ──
        // Protect flat resistant interiors, but NOT convergent rim hollows
        let mesaProtection = 1.0; // 1.0 = no protection
        if (R < 0.4 && S < 0.3) {
          const tablelandFactor = (0.4 - R) / 0.4;
          const flatFactor = (0.3 - S) / 0.3;
          const rawProtection = tablelandFactor * flatFactor;
          // Convergent hollows and knickpoints override mesa protection
          const convergenceOverride = planCurv > 0 ? Math.min(planCurv * 10.0, 0.6) : 0;
          const headwardOverride = Math.min((headwardBoost - 1.0) * 0.4, 0.3);
          mesaProtection = 1.0 - rawProtection * Math.max(0.2, 0.80 - convergenceOverride - headwardOverride);
        }

        // ── Gradual regime transition (replaces binary two-regime) ──
        // Instead of a sharp channel/hillslope gate, use a smooth transition.
        // Cells near the threshold get partial fluvial erosion, creating
        // a continuum that allows gradual tributary emergence.
        const thresholdRatio = slopeAreaIndex / Math.max(0.1, channelThreshold);
        // fluvialFraction: 0 = pure hillslope, 1 = full fluvial
        // Smooth ramp from 0.5× threshold to 2× threshold
        const fluvialFraction = Math.max(0, Math.min(1, (thresholdRatio - 0.5) / 1.5));

        // Blend between hillslope and fluvial erosion rates
        const hillslopeK = erosionK * 0.12;
        const channelIntensity = Math.min(3.0, Math.max(0, thresholdRatio - 1.0));
        const fluvialK = erosionK * (1.0 + channelIntensity * 0.5);
        const effectiveK = hillslopeK + (fluvialK - hillslopeK) * fluvialFraction;

        // Blend area/slope exponents (hillslope uses different scaling)
        const effectiveAreaExp = areaExponent * (0.7 + 0.3 * fluvialFraction);
        const effectiveSlopeExp = slopeExponent * (1.3 - 0.3 * fluvialFraction);

        // AE3.3: Corridor-based fluvial efficiency + depth maturity boost
        let aeBoost = 1.0;
        if (corridor) {
          const guide = corridor[idx];
          // Fluvial efficiency boost: guided cells erode up to 1.6x
          aeBoost += guide * 0.6;
          // Depth maturity boost: deeper AE valleys get additional intensity
          if (guidance && guidance.valleyDepth.length > 0) {
            const normalizedDepth = Math.min(1, guidance.valleyDepth[idx] / 15);
            aeBoost += normalizedDepth * guide * 0.5; // up to 0.5x more from depth
          }
        }

        // H2.5d: Reduce erosion intensity at divide cells
        const divideProtection = Math.max(0.15, 1.0 - divPen * 0.85);

        // H2.5e.9: Row/corridor-level overshoot damping (precomputed)
        // rowDampK/rowDampThresh are per-row values computed before the incision loop.
        // Applied with cross-corridor asymmetry: outer half damped more, inner less.
        let piedmontDamping = 1.0;
        if (hasMigrationEarly && rowDampK) {
          const rowDamp = rowDampK[z];
          if (rowDamp < 1.0 && curCL) {
            // Cross-corridor position: which side of the current thalweg is this cell?
            const clx = curCL[z];
            const outer9 = refOuter ? refOuter[z] : 0;
            const crossPos = (x - clx) * outer9; // positive = outer side
            if (crossPos > 0) {
              // Outer half: full damping
              piedmontDamping = rowDamp;
            } else if (crossPos > -3) {
              // Center/near-inner: moderate damping
              piedmontDamping = rowDamp + (1.0 - rowDamp) * 0.4;
            }
            // Inner side (crossPos < -3): no damping — let inner bank erode normally
          }
        }

        const dampedK = effectiveK * piedmontDamping;

        let erosion = dampedK * R * mesaProtection * headwardBoost * aeBoost * divideProtection *
          Math.pow(A, effectiveAreaExp) * Math.pow(S, effectiveSlopeExp);
        erosion = Math.min(erosion, maxErosion);
        const eroded = dt * erosion;

        // H2.5e.9: Explicit incision redistribution disabled — natural migration only
        const piedOuter = curvOuterSide[idx];
        const piedMigInt = 0; // forced off
        if (false) { // eslint-disable-line
          // H2.5e.8: Conservative residual-controlled incision kernel
          const m = piedMigInt * 0.35; // max 35% redistribution at full residual
          const outer1Share = 0.30 * m;
          const outer2Share = 0.05 * m;
          const centerShare = 1.0 - outer1Share - outer2Share;

          const opx = -trunkTangentZ[idx];
          const opz = trunkTangentX[idx];

          // Center (reduced incision)
          incisionBuf[idx] += eroded * centerShare;

          // Outer bank cells (shifted incision)
          const o1x = Math.round(x + opx * piedOuter);
          const o1z = Math.round(z + opz * piedOuter);
          if (o1x >= 1 && o1x < w - 1 && o1z >= 1 && o1z < h - 1) {
            incisionBuf[o1z * w + o1x] += eroded * outer1Share;
          } else {
            incisionBuf[idx] += eroded * outer1Share; // fallback to center
          }
          const o2x = Math.round(x + opx * piedOuter * 2);
          const o2z = Math.round(z + opz * piedOuter * 2);
          if (o2x >= 1 && o2x < w - 1 && o2z >= 1 && o2z < h - 1) {
            incisionBuf[o2z * w + o2x] += eroded * outer2Share;
          } else {
            incisionBuf[idx] += eroded * outer2Share; // fallback to center
          }

          // Separate point bar deposition (not from incision budget)
          const pointBarAmount = eroded * 0.08 * m;
          const i1x = Math.round(x - opx * piedOuter);
          const i1z = Math.round(z - opz * piedOuter);
          if (i1x >= 1 && i1x < w - 1 && i1z >= 1 && i1z < h - 1) {
            pointBarBuf[i1z * w + i1x] += pointBarAmount;
          }
        } else {
          // Normal case: all incision at center
          incisionBuf[idx] += eroded;
        }

        // Produce transportable sediment (source follows incision placement)
        // For piedmont migration, sediment comes from the outer bank, not center
        if (sedimentFlux && eroded > 0) {
          if (piedMigInt > 0.05 && piedOuter !== 0 && hasMigrationEarly) {
            // Distribute sediment to where incision actually happened
            const o1x2 = Math.round(x + (-trunkTangentZ[idx]) * piedOuter);
            const o1z2 = Math.round(z + trunkTangentX[idx] * piedOuter);
            if (o1x2 >= 1 && o1x2 < w - 1 && o1z2 >= 1 && o1z2 < h - 1) {
              sedimentFlux[o1z2 * w + o1x2] += eroded * sedimentFraction * piedMigInt;
            }
            sedimentFlux[idx] += eroded * sedimentFraction * (1 - piedMigInt);
          } else {
            sedimentFlux[idx] += eroded * sedimentFraction;
          }
        }

        // Uplift (optional, maintains relief)
        grid[idx] += upliftRate;
      }
    }

    // H2.5e.4: Apply buffered incision + point bar deposits
    for (let i = 0; i < n; i++) {
      if (incisionBuf[i] > 0) grid[i] -= incisionBuf[i];
      if (pointBarBuf[i] > 0) grid[i] += pointBarBuf[i];
    }

    // Step 3b: Lateral erosion / canyon widening (H2.5c — split trunk + rim drivers)
    // Two independent widening drivers:
    //   trunkFactor: mature channel widening (scales with drainage area)
    //   rimFactor: escarpment headcut retreat (directional upstream relief)
    {
      const lp = lateralParams ?? DEFAULT_LATERAL;
      const lateralRate = lp.lateralRate;
      const bankSlopeThreshold = lp.bankSlopeThreshold;
      const minChannelArea = lp.minChannelArea;
      const baseReach = lp.maxReach;
      const lateralBuf = new Float32Array(n);
      const migrationDepositBuf = new Float32Array(n); // H2.5e.2: deferred inner-bank deposits

      const trunkReachBonus = 6;
      const rimReachBonus = 4;

      // H2.5d.1: Use provenance-based dividePenalty (computed per-iteration above)
      // and global max area for trunk scaling (system-local via provenance, not outlets)
      let maxArea = 0;
      for (let i = 0; i < n; i++) {
        if (area[i] > maxArea) maxArea = area[i];
      }

      // (Trunk tangent, smoothed area, curvature precomputed above in H2.5e.4 block)
      const hasMigration = hasMigrationEarly;

      for (let z = 3; z < h - 3; z++) {
        for (let x = 3; x < w - 3; x++) {
          const idx = z * w + x;
          const A_here = smoothArea[idx];
          if (A_here < minChannelArea) continue;

          const hHere = grid[idx];

          // Use precomputed trunk tangent for bank normal direction
          const fdx = trunkTangentX[idx];
          const fdz = trunkTangentZ[idx];
          if (fdx === 0 && fdz === 0) continue;
          const px = -fdz;
          const pz = fdx;

          // Channel power scales with smoothed drainage area
          let channelPower = Math.min(4.0, Math.pow(A_here / 60.0, 0.4));
          if (corridor) {
            const guide = corridor[idx];
            channelPower *= 1.0 + guide * 0.8;
          }

          // ── Driver 1: trunkFactor ──
          const trunkAreaThreshold = maxArea * 0.12;
          let trunkFactor = Math.max(0, Math.min(1,
            (A_here - minChannelArea) / Math.max(1, trunkAreaThreshold - minChannelArea)));
          const divPenLateral = dividePenalty[idx];
          trunkFactor *= Math.max(0, 1.0 - divPenLateral);

          // ── Driver 2: rimFactor (directional escarpment retreat) ──
          // Only for trunk cells. Measures upstream vs downstream relief.
          let rimFactor = 0;
          if (trunkFactor > 0.2) {
            let upstreamRelief = 0, downstreamRelief = 0;
            for (let step = 1; step <= 6; step++) {
              const ux = Math.round(x - fdx * step), uz = Math.round(z - fdz * step);
              if (ux >= 0 && ux < w && uz >= 0 && uz < h) {
                const ur = grid[uz * w + ux] - hHere;
                if (ur > upstreamRelief) upstreamRelief = ur;
              }
              const dx2 = Math.round(x + fdx * step), dz2 = Math.round(z + fdz * step);
              if (dx2 >= 0 && dx2 < w && dz2 >= 0 && dz2 < h) {
                const dr = grid[dz2 * w + dx2] - hHere;
                if (dr > downstreamRelief) downstreamRelief = dr;
              }
            }
            const upstreamDominance = upstreamRelief / Math.max(1, upstreamRelief + downstreamRelief);
            rimFactor = Math.min(2.0, (upstreamRelief / 12.0) * upstreamDominance);
          }

          // ── Headcut retreat boost (rim-only) ──
          const recv = receiver[idx];
          if (rimFactor > 0.3 && recv >= 0 && recv !== idx) {
            const recvArea = area[recv];
            const headRatio = A_here / Math.max(1, recvArea);
            if (headRatio < 0.5) {
              const headcutErosion = Math.min(
                0.5 * rimFactor * channelPower * cellSize,
                10.0 * 0.15,
              );
              if (headcutErosion > 0) lateralBuf[idx] += headcutErosion;
            }
          }

          // ── Driver 3: Piedmont planform migration (H2.5e.1) ──
          // Uses precomputed smoothed signed curvature for cross-channel thalweg migration.
          const maxMigSlope = lp.maxMigrationSlope ?? 999;
          const localSlope = slopes[idx];
          const piedmontFactor = Math.max(0, Math.min(1, (maxMigSlope - localSlope) / Math.max(0.01, maxMigSlope * 0.67)));

          const signedCurvature = signedCurvField[idx];
          const outerSide = curvOuterSide[idx];

          const curvThresh = lp.curvatureThreshold ?? 0.03;
          const curvStrength = lp.curvatureStrength ?? 2.2;
          const outerBoost = lp.outerBankBoost ?? 2.5;
          const innerProtect = lp.innerBankProtection ?? 0.15;
          const innerDeposit = lp.innerBankDeposition ?? 0.25;
          const migReach = lp.migrationReach ?? 6;
          const curvMag = Math.max(0, Math.abs(signedCurvature) - curvThresh);

          // H2.5e.9: Explicit piedmont forcing disabled — natural migration + overshoot damping only
          const isPiedmontDominant = false; // disabled for proof
          const piedCtrl = 0;

          // ── Combined widening formula ──
          // In piedmont mode: suppress generic widening, all migration through controller
          const symmetricSuppression = isPiedmontDominant ? 0.0 : 1.0;
          const widenFactor = 1.0 + trunkFactor * 1.5 * symmetricSuppression + rimFactor * 1.0;
          const localLateralRate = lateralRate * widenFactor;
          const localMaxReach = Math.round(baseReach + trunkFactor * trunkReachBonus * symmetricSuppression + rimFactor * rimReachBonus);
          const localBankThreshold = bankSlopeThreshold * Math.max(0.4, 1.0 - trunkFactor * 0.2 - rimFactor * 0.15);

          // Check both bank sides, multiple cells outward
          for (const side of [-1, 1]) {
            // H2.5e.8.1: Piedmont bank asymmetry gated by controller residual
            const isOuterBank = (side === outerSide) && piedCtrl > 0.02;
            const isInnerBank = (side === -outerSide) && piedCtrl > 0.02;

            let sideRate = localLateralRate;
            let sideReach = localMaxReach;
            if (isOuterBank) {
              sideRate *= 1.0 + piedCtrl * ((lp.outerBankBoost ?? 2.5) - 1.0);
              sideReach = Math.max(sideReach, lp.migrationReach ?? 6);
            }
            if (isInnerBank) {
              sideRate *= Math.max(0.05, (lp.innerBankProtection ?? 0.15) * (1.0 - piedCtrl));
            }

            let prevH = hHere;
            for (let reach = 1; reach <= sideReach; reach++) {
              const bx = Math.round(x + px * side * reach);
              const bz = Math.round(z + pz * side * reach);
              if (bx < 1 || bx >= w - 1 || bz < 1 || bz >= h - 1) break;

              const bankIdx = bz * w + bx;
              const bankH = grid[bankIdx];

              const bankSlope = (bankH - prevH) / cellSize;
              if (bankSlope < localBankThreshold) break;

              const R_bank = resistance ? resistance[bankIdx] : 1.0;
              const reachDecay = 1.0 / reach;
              const totalRelief = bankH - hHere;
              const reliefFactor = Math.min(2.0, totalRelief / 10.0);
              const slopeExcess = bankSlope - localBankThreshold;

              const lateralErosion = Math.min(
                slopeExcess * sideRate * channelPower * R_bank * reachDecay * reliefFactor * cellSize,
                totalRelief * 0.35,
              );

              if (lateralErosion > 0) {
                lateralBuf[bankIdx] += lateralErosion;
                if (sedimentFlux) {
                  sedimentFlux[idx] += lateralErosion * 0.25;
                }
              }

              prevH = bankH;
            }

            // (Legacy direct deposition removed in H2.5e.3 — now handled by migrationDepositBuf)
          }
        }
      }

      // Apply lateral erosion + migration deposits
      for (let i = 0; i < n; i++) {
        if (lateralBuf[i] > 0) grid[i] -= lateralBuf[i];
        if (migrationDepositBuf[i] > 0) grid[i] += migrationDepositBuf[i];
      }
    }

    // (H2.4 direct-incision seeding removed — replaced by proto-channel threshold modulation in H2.4a)

    // Step 4: Sediment transport and deposition
    // Route sediment downstream; deposit where transport capacity drops
    if (sedimentFlux) {
      transportAndDeposit(
        grid, sedimentFlux, area, receiver, slopes, deposition,
        w, h, cellSize, transportK, transportAreaExp, transportSlopeExp, minSlope,
      );
    }

    // Step 5: Hillslope diffusion
    if (diffusionRate > 0) {
      diffuse(grid, w, h, cellSize, diffusionRate);
    }

    // Clamp to non-negative
    for (let i = 0; i < n; i++) {
      if (grid[i] < 0) grid[i] = 0;
    }
  }

  return { area: lastArea, receiver: lastReceiver, slopes: lastSlopes, deposition, provenance: lastProvenance };
}
