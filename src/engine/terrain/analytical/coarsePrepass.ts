/**
 * Analytical coarse fluvial prepass (AE1a).
 *
 * Benchmark-only stage that runs before the production bake pipeline.
 * Downsamples the benchmark terrain to a coarse grid, runs an implicit
 * upstream-ordered drainage solve to establish large-scale drainage
 * organization, then upsamples and blends back with the original terrain.
 *
 * This gives the production pipeline a better drainage skeleton to
 * refine, rather than starting from a nearly flat tableland.
 */

import type { AnalyticalPrepassConfig } from './types';
import { computeCoarseDrainage, implicitElevationSolve } from './drainageSolve';

/**
 * Run the analytical coarse prepass on a benchmark heightfield.
 *
 * @param grid - Full-resolution height grid (1024², modified in place)
 * @param gridSize - Full grid dimension (e.g. 1024)
 * @param extent - World-space half-extent (e.g. 800)
 * @param config - Prepass configuration
 * @returns The coarse grid (for diagnostic capture)
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
      // Map coarse cell to world position
      const wx = -extent + cx * coarseCellSize;
      const wz = -extent + cz * coarseCellSize;

      // Sample from full grid (bilinear)
      const gx = (wx + extent) / fullCellSize;
      const gz = (wz + extent) / fullCellSize;
      const ix = Math.min(gridSize - 2, Math.max(0, Math.floor(gx)));
      const iz = Math.min(gridSize - 2, Math.max(0, Math.floor(gz)));
      const fx = gx - ix;
      const fz = gz - iz;

      const h00 = grid[iz * gridSize + ix];
      const h10 = grid[iz * gridSize + ix + 1];
      const h01 = grid[(iz + 1) * gridSize + ix];
      const h11 = grid[(iz + 1) * gridSize + ix + 1];

      coarseGrid[cz * coarseSize + cx] =
        h00 * (1 - fx) * (1 - fz) +
        h10 * fx * (1 - fz) +
        h01 * (1 - fx) * fz +
        h11 * fx * fz;
    }
  }

  // Save initial coarse heights for blending
  const coarseInitial = new Float32Array(coarseGrid);

  // ── Step 2: Fixed-point coupling loop ──
  for (let fp = 0; fp < config.fixedPointIterations; fp++) {
    // 2a. Compute drainage on current coarse grid
    const { receiver, area, order } = computeCoarseDrainage(
      coarseGrid, coarseSize, coarseSize, coarseCellSize,
    );

    // 2b. Implicit upstream-ordered elevation solve
    implicitElevationSolve(
      coarseGrid, coarseInitial,
      receiver, area, order,
      coarseSize, coarseSize,
      coarseCellSize,
      config.erosionK, config.areaExponent, config.slopeExponent,
      config.age,
    );
  }

  // ── Step 3: Smoothing passes (reduce coarse grid artifacts) ──
  for (let s = 0; s < config.smoothingPasses; s++) {
    const tmp = new Float32Array(coarseGrid);
    for (let z = 1; z < coarseSize - 1; z++) {
      for (let x = 1; x < coarseSize - 1; x++) {
        const idx = z * coarseSize + x;
        const avg = (
          tmp[idx - 1] + tmp[idx + 1] +
          tmp[idx - coarseSize] + tmp[idx + coarseSize]
        ) / 4;
        // Gentle smoothing: blend toward neighbor average
        coarseGrid[idx] = tmp[idx] * 0.7 + avg * 0.3;
      }
    }
  }

  const tCoarse = performance.now() - t0;
  console.log(`[analytical] coarse prepass: ${config.fixedPointIterations} fp iterations on ${coarseSize}² grid (${tCoarse.toFixed(0)}ms)`);

  // ── Step 4: Upsample coarse result back to full resolution ──
  // Compute the delta (change from coarse initial) and apply it to the full grid
  const coarseDelta = new Float32Array(coarseSize * coarseSize);
  for (let i = 0; i < coarseGrid.length; i++) {
    coarseDelta[i] = coarseGrid[i] - coarseInitial[i];
  }

  // Bilinear upsample delta to full resolution and blend
  for (let fz = 0; fz < gridSize; fz++) {
    for (let fx = 0; fx < gridSize; fx++) {
      const wx = -extent + fx * fullCellSize;
      const wz = -extent + fz * fullCellSize;

      // Map to coarse grid coordinates
      const cx = (wx + extent) / coarseCellSize;
      const cz = (wz + extent) / coarseCellSize;
      const ix = Math.min(coarseSize - 2, Math.max(0, Math.floor(cx)));
      const iz = Math.min(coarseSize - 2, Math.max(0, Math.floor(cz)));
      const fracX = cx - ix;
      const fracZ = cz - iz;

      // Bilinear interpolation of the delta
      const d00 = coarseDelta[iz * coarseSize + ix];
      const d10 = coarseDelta[iz * coarseSize + ix + 1];
      const d01 = coarseDelta[(iz + 1) * coarseSize + ix];
      const d11 = coarseDelta[(iz + 1) * coarseSize + ix + 1];

      const delta =
        d00 * (1 - fracX) * (1 - fracZ) +
        d10 * fracX * (1 - fracZ) +
        d01 * (1 - fracX) * fracZ +
        d11 * fracX * fracZ;

      // Apply blended delta to full grid
      const fullIdx = fz * gridSize + fx;
      grid[fullIdx] += delta * config.blendStrength;

      // Clamp to minimum
      if (grid[fullIdx] < 0.5) grid[fullIdx] = 0.5;
    }
  }

  const tTotal = performance.now() - t0;
  console.log(`[analytical] prepass complete: ${tTotal.toFixed(0)}ms total`);

  return { coarseGrid, coarseSize };
}
