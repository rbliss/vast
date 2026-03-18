/**
 * Terrace / bench formation pass.
 *
 * Simulates incision history by identifying valley floors at the current
 * erosion level and selectively preserving them as benches while cutting
 * new channels below. Creates the "stepped valley" effect of multiple
 * incision epochs.
 *
 * Applied after the main erosion + channel geometry passes.
 * Works on low-gradient valley/basin areas, not everywhere.
 */

export interface TerraceParams {
  /** Number of terrace levels to create */
  levels: number;
  /** Minimum drainage area to qualify for terrace formation */
  minDrainageArea: number;
  /** Maximum slope for terrace preservation (steeper = not a valley floor) */
  maxSlope: number;
  /** Width of each terrace bench in cells */
  benchWidth: number;
  /** Height drop between terrace levels (world units) */
  levelDrop: number;
  /** Smoothing passes on terrace surfaces */
  smoothPasses: number;
}

export const DEFAULT_TERRACE_PARAMS: TerraceParams = {
  levels: 3,
  minDrainageArea: 40,     // H2.1c: world-area units (m²), was 60 cell-count
  maxSlope: 0.4,
  benchWidth: 4,
  levelDrop: 1.5,
  smoothPasses: 2,
};

const D8_DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const D8_DZ = [-1, -1, -1, 0, 0, 1, 1, 1];

/**
 * Apply terrace formation to the height grid.
 *
 * For each terrace level:
 *   1. Identify valley-floor cells (high drainage area + low slope)
 *   2. Compute a local floor elevation for each cluster
 *   3. Preserve the floor as a bench, cutting a new channel below
 *   4. Smooth bench surfaces to prevent staircase artifacts
 */
export function applyTerraceFormation(
  grid: Float32Array,
  area: Float32Array,
  slopes: Float32Array,
  w: number, h: number,
  cellSize: number,
  params: TerraceParams = DEFAULT_TERRACE_PARAMS,
): void {
  const n = w * h;

  for (let level = 0; level < params.levels; level++) {
    // Increasing area threshold for each level (wider valleys get higher terraces)
    const areaThreshold = params.minDrainageArea * (1 + level * 0.8);
    const slopeThreshold = params.maxSlope * (1 - level * 0.1);

    // Step 1: Identify terrace-candidate cells
    const isCandidate = new Uint8Array(n);
    let candidateCount = 0;

    for (let z = 2; z < h - 2; z++) {
      for (let x = 2; x < w - 2; x++) {
        const idx = z * w + x;
        if (area[idx] >= areaThreshold && slopes[idx] < slopeThreshold) {
          isCandidate[idx] = 1;
          candidateCount++;
        }
      }
    }

    if (candidateCount < 10) continue;

    // Step 2: For each candidate, check if it's adjacent to deeper terrain
    // (only create terraces where there's a step to cut)
    const terraceMap = new Float32Array(n); // positive = raise to form bench

    for (let z = 2; z < h - 2; z++) {
      for (let x = 2; x < w - 2; x++) {
        const idx = z * w + x;
        if (!isCandidate[idx]) continue;

        const hc = grid[idx];

        // Check if any neighbor is significantly lower (a channel below)
        let hasLowerNeighbor = false;
        let minNeighborH = hc;
        for (let d = 0; d < 8; d++) {
          const ni = (z + D8_DZ[d]) * w + (x + D8_DX[d]);
          if (grid[ni] < minNeighborH) minNeighborH = grid[ni];
          if (hc - grid[ni] > params.levelDrop * 0.5) {
            hasLowerNeighbor = true;
          }
        }

        if (!hasLowerNeighbor) continue;

        // Compute bench elevation: snap to a terrace level
        const dropFromMax = hc - minNeighborH;
        if (dropFromMax < params.levelDrop * 0.3) continue;

        // Create a bench by raising this cell slightly to form a flat step
        const benchTarget = minNeighborH + params.levelDrop * (level + 1);
        if (benchTarget > hc + params.levelDrop * 0.5) continue;
        if (benchTarget < minNeighborH) continue;

        const raise = benchTarget - hc;
        if (raise > 0 && raise < params.levelDrop) {
          terraceMap[idx] = raise * 0.4; // Partial raise to suggest bench
        }
      }
    }

    // Step 3: Apply terrace raises
    for (let i = 0; i < n; i++) {
      if (terraceMap[i] > 0) {
        grid[i] += terraceMap[i];
      }
    }

    // Step 4: Smooth terrace surfaces to prevent staircase artifacts
    for (let pass = 0; pass < params.smoothPasses; pass++) {
      for (let z = 2; z < h - 2; z++) {
        for (let x = 2; x < w - 2; x++) {
          const idx = z * w + x;
          if (terraceMap[idx] <= 0) continue;

          // Only smooth within the bench zone
          const avg = (grid[idx - 1] + grid[idx + 1] +
                       grid[idx - w] + grid[idx + w]) * 0.25;
          grid[idx] = grid[idx] * 0.6 + avg * 0.4;
        }
      }
    }
  }

  // Count terraced cells
  let terraced = 0;
  for (let z = 2; z < h - 2; z++) {
    for (let x = 2; x < w - 2; x++) {
      const idx = z * w + x;
      if (area[idx] >= params.minDrainageArea && slopes[idx] < params.maxSlope) {
        terraced++;
      }
    }
  }
  console.log(`[terrace] ${params.levels} levels, ${terraced} valley-floor cells`);
}
