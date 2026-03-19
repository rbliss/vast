/**
 * Analytical coarse fluvial prepass (AE1a.2).
 *
 * AE1a.2 improvements:
 * - Depression filling before drainage routing (no trapped flow)
 * - Explicit boundary base-level enforcement
 * - Direct solved-height blend (not just delta)
 * - Stronger solve with proper drainage graph
 */

import type { AnalyticalPrepassConfig } from './types';
import { fillDepressions, computeCoarseDrainage, implicitElevationSolve } from './drainageSolve';

/**
 * Run the analytical coarse prepass on a benchmark heightfield.
 *
 * @param grid - Full-resolution height grid (1024², modified in place)
 * @param gridSize - Full grid dimension (e.g. 1024)
 * @param extent - World-space half-extent (e.g. 800)
 * @param config - Prepass configuration
 */
export function runAnalyticalPrepass(
  grid: Float32Array,
  gridSize: number,
  extent: number,
  config: AnalyticalPrepassConfig,
): { coarseGrid: Float32Array; coarseSize: number } {
  const t0 = performance.now();
  const coarseSize = config.coarseGridSize;
  const fullCellSize = (extent * 2) / (gridSize - 1);
  const coarseCellSize = (extent * 2) / (coarseSize - 1);

  // ── Step 1: Downsample to coarse grid ──
  const coarseGrid = new Float32Array(coarseSize * coarseSize);
  for (let cz = 0; cz < coarseSize; cz++) {
    for (let cx = 0; cx < coarseSize; cx++) {
      const wx = -extent + cx * coarseCellSize;
      const wz = -extent + cz * coarseCellSize;

      const gx = (wx + extent) / fullCellSize;
      const gz = (wz + extent) / fullCellSize;
      const ix = Math.min(gridSize - 2, Math.max(0, Math.floor(gx)));
      const iz = Math.min(gridSize - 2, Math.max(0, Math.floor(gz)));
      const fx = gx - ix;
      const fz = gz - iz;

      coarseGrid[cz * coarseSize + cx] =
        grid[iz * gridSize + ix] * (1 - fx) * (1 - fz) +
        grid[iz * gridSize + ix + 1] * fx * (1 - fz) +
        grid[(iz + 1) * gridSize + ix] * (1 - fx) * fz +
        grid[(iz + 1) * gridSize + ix + 1] * fx * fz;
    }
  }

  // Save initial coarse heights
  const coarseInitial = new Float32Array(coarseGrid);

  // ── Step 2: Fill depressions so all cells can drain to boundary ──
  fillDepressions(coarseGrid, coarseSize, coarseSize);
  console.log(`[analytical] depressions filled on ${coarseSize}² grid`);

  // ── Step 3: Fixed-point coupling loop ──
  for (let fp = 0; fp < config.fixedPointIterations; fp++) {
    // 3a. Compute drainage on current coarse grid
    const { receiver, area, order } = computeCoarseDrainage(
      coarseGrid, coarseSize, coarseSize, coarseCellSize,
    );

    // 3b. Implicit upstream-ordered elevation solve
    implicitElevationSolve(
      coarseGrid, coarseInitial,
      receiver, area, order,
      coarseSize, coarseSize,
      coarseCellSize,
      config.erosionK, config.areaExponent, config.slopeExponent,
      config.age,
    );

    // 3c. Re-fill depressions only every few iterations (expensive)
    if (fp === 2 || fp === 5) {
      fillDepressions(coarseGrid, coarseSize, coarseSize);
    }
  }

  // ── Step 4: Light smoothing (artifact reduction only) ──
  for (let s = 0; s < config.smoothingPasses; s++) {
    const tmp = new Float32Array(coarseGrid);
    for (let z = 1; z < coarseSize - 1; z++) {
      for (let x = 1; x < coarseSize - 1; x++) {
        const idx = z * coarseSize + x;
        const avg = (
          tmp[idx - 1] + tmp[idx + 1] +
          tmp[idx - coarseSize] + tmp[idx + coarseSize]
        ) / 4;
        coarseGrid[idx] = tmp[idx] * 0.75 + avg * 0.25;
      }
    }
  }

  const tCoarse = performance.now() - t0;
  console.log(`[analytical] coarse solve: ${config.fixedPointIterations} fp iters, ${coarseSize}² (${tCoarse.toFixed(0)}ms)`);

  // ── Step 5: Upsample and blend with full-resolution grid ──
  // Direct solved-height blend: interpolate between initial and solved heights
  // This is stronger than delta-only blend because it directly imposes the
  // solved drainage structure rather than adding a subtle correction.
  for (let fz = 0; fz < gridSize; fz++) {
    for (let fx = 0; fx < gridSize; fx++) {
      const wx = -extent + fx * fullCellSize;
      const wz = -extent + fz * fullCellSize;

      // Map to coarse grid coordinates
      const ccx = (wx + extent) / coarseCellSize;
      const ccz = (wz + extent) / coarseCellSize;
      const ix = Math.min(coarseSize - 2, Math.max(0, Math.floor(ccx)));
      const iz = Math.min(coarseSize - 2, Math.max(0, Math.floor(ccz)));
      const fracX = ccx - ix;
      const fracZ = ccz - iz;

      // Bilinear interpolation of solved coarse height
      const s00 = coarseGrid[iz * coarseSize + ix];
      const s10 = coarseGrid[iz * coarseSize + ix + 1];
      const s01 = coarseGrid[(iz + 1) * coarseSize + ix];
      const s11 = coarseGrid[(iz + 1) * coarseSize + ix + 1];

      const solvedH =
        s00 * (1 - fracX) * (1 - fracZ) +
        s10 * fracX * (1 - fracZ) +
        s01 * (1 - fracX) * fracZ +
        s11 * fracX * fracZ;

      // Direct blend: lerp between original full-res height and solved height
      const fullIdx = fz * gridSize + fx;
      const originalH = grid[fullIdx];
      grid[fullIdx] = originalH * (1 - config.blendStrength) + solvedH * config.blendStrength;

      if (grid[fullIdx] < 0.5) grid[fullIdx] = 0.5;
    }
  }

  const tTotal = performance.now() - t0;
  console.log(`[analytical] prepass complete: ${tTotal.toFixed(0)}ms total`);

  return { coarseGrid, coarseSize };
}
