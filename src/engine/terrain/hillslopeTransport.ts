/**
 * Threshold hillslope transport and mass wasting.
 *
 * Two regimes:
 *   1. Subcritical slopes: gentle nonlinear diffusion (smoothing)
 *   2. Supercritical slopes: debris transfer (collapse/talus formation)
 *
 * Supercritical transfer moves material from oversteepened cells
 * downhill, creating:
 *   - Talus aprons at cliff bases
 *   - Debris chute signatures
 *   - Steepened-to-collapsed slope transitions
 *   - Better ridge-to-channel continuity
 */

export interface HillslopeParams {
  /** Number of transport iterations */
  iterations: number;
  /** Critical slope angle (rise/run). Above this, debris transfer activates */
  criticalSlope: number;
  /** Subcritical diffusion rate (gentle smoothing) */
  diffusionRate: number;
  /** Supercritical transfer fraction per iteration */
  transferRate: number;
  /** How far debris can travel (cells) per step */
  debrisReach: number;
}

export const DEFAULT_HILLSLOPE_PARAMS: HillslopeParams = {
  iterations: 15,
  criticalSlope: 1.8,
  diffusionRate: 0.005,
  transferRate: 0.3,
  debrisReach: 3,
};

const D8_DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const D8_DZ = [-1, -1, -1, 0, 0, 1, 1, 1];
const D8_DIST = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

/**
 * Apply threshold hillslope transport to the height grid.
 *
 * For each iteration:
 *   1. Identify oversteepened cells (slope > critical)
 *   2. Transfer excess material to lower neighbors (debris flow)
 *   3. Accumulate deposits at base of slopes (talus)
 *   4. Apply gentle diffusion to subcritical slopes
 */
export function applyHillslopeTransport(
  grid: Float32Array,
  w: number, h: number,
  cellSize: number,
  params: HillslopeParams = DEFAULT_HILLSLOPE_PARAMS,
  resistance?: Float32Array,
): void {
  const n = w * h;
  const maxDh = params.criticalSlope * cellSize;

  for (let iter = 0; iter < params.iterations; iter++) {
    // ── Supercritical: debris transfer ──
    const deposits = new Float32Array(n);

    for (let z = 1; z < h - 1; z++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = z * w + x;
        const hc = grid[idx];

        // Check all neighbors for oversteepening
        let maxExcess = 0;
        let totalExcess = 0;
        const excessDirs: number[] = [];
        const excessAmounts: number[] = [];

        for (let d = 0; d < 8; d++) {
          const nx = x + D8_DX[d];
          const nz = z + D8_DZ[d];
          if (nx < 1 || nx >= w - 1 || nz < 1 || nz >= h - 1) continue;

          const ni = nz * w + nx;
          const dh = hc - grid[ni];
          const slopeToNeighbor = dh / (D8_DIST[d] * cellSize);

          if (slopeToNeighbor > params.criticalSlope) {
            const excess = dh - maxDh * D8_DIST[d];
            if (excess > 0) {
              excessDirs.push(d);
              excessAmounts.push(excess);
              totalExcess += excess;
              if (excess > maxExcess) maxExcess = excess;
            }
          }
        }

        if (totalExcess <= 0) continue;

        // Transfer material proportionally to excess, scaled by erodibility
        const R = resistance ? resistance[idx] : 1.0;
        const transfer = maxExcess * params.transferRate * R;

        for (let i = 0; i < excessDirs.length; i++) {
          const d = excessDirs[i];
          const fraction = excessAmounts[i] / totalExcess;
          const amount = transfer * fraction;

          // Remove from source
          grid[idx] -= amount;

          // Deposit along debris path (multiple cells for reach > 1)
          let px = x, pz = z;
          let remaining = amount;

          for (let step = 0; step < params.debrisReach && remaining > 0; step++) {
            const nx = px + D8_DX[d];
            const nz = pz + D8_DZ[d];
            if (nx < 1 || nx >= w - 1 || nz < 1 || nz >= h - 1) break;

            const ni = nz * w + nx;

            // Deposit more at the first step, less further out
            const depositFrac = step === 0 ? 0.6 : 0.3;
            const deposit = remaining * depositFrac;
            deposits[ni] += deposit;
            remaining -= deposit;

            // Check if the path is still going downhill
            if (grid[ni] >= grid[pz * w + px]) break;

            px = nx;
            pz = nz;
          }

          // Any remaining goes to last valid cell
          if (remaining > 0 && px >= 1 && px < w - 1 && pz >= 1 && pz < h - 1) {
            deposits[pz * w + px] += remaining;
          }
        }
      }
    }

    // Apply deposits
    for (let i = 0; i < n; i++) {
      grid[i] += deposits[i];
    }

    // ── Subcritical: gentle nonlinear diffusion ──
    if (params.diffusionRate > 0) {
      const cs2 = cellSize * cellSize;
      const tmp = new Float32Array(n);
      tmp.set(grid);

      for (let z = 1; z < h - 1; z++) {
        for (let x = 1; x < w - 1; x++) {
          const idx = z * w + x;

          // Only diffuse if all neighbor slopes are subcritical
          let allSubcritical = true;
          for (let d = 0; d < 8; d++) {
            const nx = x + D8_DX[d];
            const nz = z + D8_DZ[d];
            const ni = nz * w + nx;
            const dh = Math.abs(grid[idx] - grid[ni]);
            if (dh / (D8_DIST[d] * cellSize) > params.criticalSlope) {
              allSubcritical = false;
              break;
            }
          }

          if (allSubcritical) {
            const laplacian = grid[idx - 1] + grid[idx + 1] +
                              grid[idx - w] + grid[idx + w] -
                              4 * grid[idx];
            tmp[idx] = grid[idx] + laplacian * (params.diffusionRate / cs2);
          }
        }
      }

      grid.set(tmp);
    }
  }

  // Count affected cells for logging
  let oversteepened = 0;
  for (let z = 1; z < h - 1; z++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = z * w + x;
      for (let d = 0; d < 8; d++) {
        const nx = x + D8_DX[d];
        const nz = z + D8_DZ[d];
        const ni = nz * w + nx;
        const slope = Math.abs(grid[idx] - grid[ni]) / (D8_DIST[d] * cellSize);
        if (slope > params.criticalSlope) { oversteepened++; break; }
      }
    }
  }
  console.log(`[hillslope] ${params.iterations} iterations, ${oversteepened} remaining oversteepened cells`);
}
