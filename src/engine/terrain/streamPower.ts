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
  erosionK: 0.006,
  areaExponent: 0.5,
  slopeExponent: 1.0,
  dt: 1.0,
  diffusionRate: 0.005,
  minSlope: 0.001,
  upliftRate: 0.1,
  maxErosion: 0.5,
  depositionEnabled: true,
  sedimentFraction: 0.6,
  transportK: 0.08,
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
): { area: Float32Array; receiver: Int32Array } {
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

  return { area, receiver };
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
}

/**
 * Resistance generator: called each iteration with current heights
 * to produce a per-cell erodibility grid (0 = resistant, 1 = soft).
 */
export type ResistanceGenerator = (heights: Float32Array) => Float32Array;

export function streamPowerErosion(
  grid: Float32Array, w: number, h: number,
  cellSize: number, params: StreamPowerParams,
  resistanceGen?: ResistanceGenerator,
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
  let lastReceiver: Int32Array = new Int32Array(n);
  let lastSlopes: Float32Array = new Float32Array(n);

  for (let iter = 0; iter < iterations; iter++) {
    // Step 0: Recompute resistance from current heights (dynamic strata)
    const resistance = resistanceGen ? resistanceGen(grid) : null;

    // Step 1: Flow accumulation + receiver graph
    const flowResult = computeFlowAccumulation(grid, w, h, cellSize);
    const { area, receiver } = flowResult;
    lastArea = area as Float32Array;
    lastReceiver = receiver as Int32Array;

    // Step 2: Slopes
    const slopes = computeSlopes(grid, w, h, cellSize);
    lastSlopes = slopes as Float32Array;

    // Step 3: Stream-power incision + sediment production
    if (sedimentFlux) sedimentFlux.fill(0);

    for (let z = 1; z < h - 1; z++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = z * w + x;
        const A = area[idx];
        const S = Math.max(slopes[idx], minSlope);

        // Resistance from dynamic strata
        const R = resistance ? resistance[idx] : 1.0;

        // Mesa-top protection: on resistant + flat cells, require much larger
        // drainage area before channel incision begins (suppresses summit spires)
        let effectiveA = A;
        if (R < 0.4 && S < 0.3) {
          // This is a resistant flat surface — mesa top / tableland
          // Raise the effective channel-initiation threshold
          const tablelandFactor = (0.4 - R) / 0.4; // 0-1, stronger for harder rock
          const flatFactor = (0.3 - S) / 0.3;      // 0-1, stronger for flatter terrain
          const protection = tablelandFactor * flatFactor;
          // Reduce effective drainage area → less erosion on mesa top
          effectiveA = A * (1 - protection * 0.85);
        }

        // Rim amplification: where slope transitions from flat to steep (rim edge),
        // slightly amplify erosion to create retreat behavior
        let rimBoost = 1.0;
        if (resistance) {
          // Check if this cell is at a resistance boundary near a steep edge
          const slopeUp = slopes[idx - w] ?? 0;
          const slopeDown = slopes[idx + w] ?? 0;
          const slopeL = slopes[idx - 1] ?? 0;
          const slopeR = slopes[idx + 1] ?? 0;
          const maxNeighborSlope = Math.max(slopeUp, slopeDown, slopeL, slopeR);
          // If we're relatively flat but adjacent to steep terrain → rim edge
          if (S < 0.5 && maxNeighborSlope > 1.0 && R < 0.5) {
            rimBoost = 1.0 + (maxNeighborSlope - 1.0) * 0.3;
          }
        }

        // E = K * R * A^m * S^n
        const erosion = Math.min(
          erosionK * R * rimBoost * Math.pow(effectiveA, areaExponent) * Math.pow(S, slopeExponent),
          maxErosion,
        );
        const eroded = dt * erosion;
        grid[idx] -= eroded;

        // Produce transportable sediment
        if (sedimentFlux) {
          sedimentFlux[idx] += eroded * sedimentFraction;
        }

        // Uplift (optional, maintains relief)
        grid[idx] += upliftRate;
      }
    }

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

  return { area: lastArea, receiver: lastReceiver, slopes: lastSlopes, deposition };
}
