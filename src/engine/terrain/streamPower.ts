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
  iterations: 25,
  erosionK: 0.004,
  areaExponent: 0.45,
  slopeExponent: 1.0,
  dt: 1.0,
  diffusionRate: 0.01,
  minSlope: 0.001,
  upliftRate: 0.15,
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
 * Compute D8 flow accumulation (drainage area) over the grid.
 * Returns drainage area at each cell (minimum 1.0 = self).
 *
 * Also returns the flow receiver index for each cell (-1 = no outflow / pit).
 */
function computeFlowAccumulation(
  grid: Float32Array, w: number, h: number, cellSize: number,
): { area: Float32Array; receiver: Int32Array } {
  const n = w * h;
  const area = new Float32Array(n);
  area.fill(1.0); // Each cell contributes 1 unit

  const receiver = new Int32Array(n);
  receiver.fill(-1);

  // Compute receiver for each cell (steepest downhill neighbor)
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const idx = z * w + x;
      const hc = grid[idx];
      let bestSlope = 0;
      let bestIdx = -1;

      for (let d = 0; d < 8; d++) {
        const nx = x + D8_DX[d];
        const nz = z + D8_DZ[d];
        if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;

        const nIdx = nz * w + nx;
        const drop = (hc - grid[nIdx]) / (D8_DIST[d] * cellSize);
        if (drop > bestSlope) {
          bestSlope = drop;
          bestIdx = nIdx;
        }
      }

      receiver[idx] = bestIdx;
    }
  }

  // Sort cells by height (descending) for topological accumulation
  const sorted = new Uint32Array(n);
  for (let i = 0; i < n; i++) sorted[i] = i;
  sorted.sort((a, b) => grid[b] - grid[a]);

  // Accumulate: pass area from each cell to its receiver
  for (let i = 0; i < n; i++) {
    const idx = sorted[i];
    const recv = receiver[idx];
    if (recv >= 0) {
      area[recv] += area[idx];
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

export function streamPowerErosion(
  grid: Float32Array, w: number, h: number,
  cellSize: number, params: StreamPowerParams,
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

        // E = K * A^m * S^n, capped to prevent runaway deep incision
        const erosion = Math.min(
          erosionK * Math.pow(A, areaExponent) * Math.pow(S, slopeExponent),
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
