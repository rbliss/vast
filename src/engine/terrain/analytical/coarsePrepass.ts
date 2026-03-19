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

  // ── Step 1: Relief-aware downsample to coarse grid ──
  // Blend between bilinear average and local minimum to preserve
  // reentrant hollows and convergent features at the rim.
  const coarseGrid = new Float32Array(coarseSize * coarseSize);
  const sampleRadius = Math.max(1, Math.round(fullCellSize > 0 ? coarseCellSize / fullCellSize * 0.5 : 1));
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

      // Bilinear average
      const bilinear =
        grid[iz * gridSize + ix] * (1 - fx) * (1 - fz) +
        grid[iz * gridSize + ix + 1] * fx * (1 - fz) +
        grid[(iz + 1) * gridSize + ix] * (1 - fx) * fz +
        grid[(iz + 1) * gridSize + ix + 1] * fx * fz;

      // Local minimum in a small neighborhood (preserves hollows)
      let localMin = bilinear;
      for (let dz = -sampleRadius; dz <= sampleRadius; dz++) {
        for (let dx = -sampleRadius; dx <= sampleRadius; dx++) {
          const sx = Math.min(gridSize - 1, Math.max(0, ix + dx));
          const sz = Math.min(gridSize - 1, Math.max(0, iz + dz));
          const h = grid[sz * gridSize + sx];
          if (h < localMin) localMin = h;
        }
      }

      // Blend: 70% bilinear + 30% local min (preserves hollows without creating pits)
      coarseGrid[cz * coarseSize + cx] = bilinear * 0.7 + localMin * 0.3;
    }
  }

  // Save initial coarse heights
  const coarseInitial = new Float32Array(coarseGrid);

  // ── Step 2: Fill depressions so all cells can drain to boundary ──
  fillDepressions(coarseGrid, coarseSize, coarseSize);
  console.log(`[analytical] depressions filled on ${coarseSize}² grid`);

  // ── Step 3: Fixed-point coupling loop ──
  // AE1a.7: Extract channel tree from MFD accumulation, solve strongly on-tree
  const n = coarseSize * coarseSize;
  // AE1a.7: much more selective — need ~200 coarse cells (~5% of tableland)
  const channelThreshold = 200 * coarseCellSize * coarseCellSize;

  for (let fp = 0; fp < config.fixedPointIterations; fp++) {
    // 3a. Compute drainage (MFD accumulation + primary receiver)
    const { receiver, area, order } = computeCoarseDrainage(
      coarseGrid, coarseSize, coarseSize, coarseCellSize,
    );

    // 3b. Build channel influence field from MFD accumulation
    // On-tree cells get full erosion (1.0), nearby cells get tapered
    // influence based on distance — creates corridor-shaped channels
    // instead of knife-cut slots. Area also scales corridor width.
    const channelInfluence = new Float32Array(n);
    let channelCount = 0;

    // First: mark on-tree cells and compute their corridor radius
    const corridorRadius = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      if (area[i] > channelThreshold) {
        channelInfluence[i] = 1.0;
        channelCount++;
        // Corridor width scales with drainage area (bigger channels = wider valleys)
        corridorRadius[i] = Math.min(8, 1.5 + Math.pow(area[i] / channelThreshold, 0.3) * 2);
      }
    }

    // Second: spread influence to nearby cells (distance-weighted corridor)
    for (let z = 0; z < coarseSize; z++) {
      for (let x = 0; x < coarseSize; x++) {
        const idx = z * coarseSize + x;
        if (channelInfluence[idx] >= 1.0) continue; // already on-tree

        // Check neighbors in a radius for channel cells
        let bestInfluence = 0;
        const searchR = 6;
        for (let dz = -searchR; dz <= searchR; dz++) {
          for (let dx = -searchR; dx <= searchR; dx++) {
            const nz = z + dz, nx = x + dx;
            if (nz < 0 || nz >= coarseSize || nx < 0 || nx >= coarseSize) continue;
            const ni = nz * coarseSize + nx;
            if (channelInfluence[ni] < 1.0) continue; // not a channel cell

            const dist = Math.sqrt(dx * dx + dz * dz);
            const radius = corridorRadius[ni];
            if (dist < radius) {
              // Smooth falloff: 1.0 at channel center, 0 at radius edge
              const t = dist / radius;
              const influence = (1 - t * t) * 0.6; // quadratic falloff, max 0.6 in corridor
              if (influence > bestInfluence) bestInfluence = influence;
            }
          }
        }
        channelInfluence[idx] = bestInfluence;
      }
    }

    // Log diagnostics
    if (fp === 0 || fp === config.fixedPointIterations - 1) {
      let maxArea = 0, outletCount = 0, corridorCount = 0;
      for (let i = 0; i < n; i++) {
        if (area[i] > maxArea) maxArea = area[i];
        if (receiver[i] === i) outletCount++;
        if (channelInfluence[i] > 0.01) corridorCount++;
      }
      console.log(`[analytical] fp=${fp}: channels=${channelCount} corridors=${corridorCount}/${n} (${(corridorCount/n*100).toFixed(1)}%) maxArea=${maxArea.toFixed(0)} outlets=${outletCount}`);
    }

    // 3c. Solve with channel influence field
    implicitElevationSolve(
      coarseGrid, coarseInitial,
      receiver, area, order,
      coarseSize, coarseSize,
      coarseCellSize,
      config.erosionK, config.areaExponent, config.slopeExponent,
      config.age,
      channelInfluence,
    );

    // 3d. Re-fill depressions periodically
    if (fp === 2 || fp === 5 || fp === 8) {
      fillDepressions(coarseGrid, coarseSize, coarseSize);
    }
  }

  // ── Step 4: Channel-aware smoothing ──
  // Stronger smoothing near channel edges (reduce stair-step walls),
  // lighter smoothing on mesa interiors (preserve flat caps).
  // Use the last computed channel influence field for guidance.
  for (let s = 0; s < config.smoothingPasses + 2; s++) {
    const tmp = new Float32Array(coarseGrid);
    for (let z = 1; z < coarseSize - 1; z++) {
      for (let x = 1; x < coarseSize - 1; x++) {
        const idx = z * coarseSize + x;
        const avg = (
          tmp[idx - 1] + tmp[idx + 1] +
          tmp[idx - coarseSize] + tmp[idx + coarseSize]
        ) / 4;
        // Stronger smoothing near channel edges, lighter on mesa
        const smoothStrength = 0.15 + 0.25 * Math.min(1, Math.abs(coarseGrid[idx] - avg) / 3);
        coarseGrid[idx] = tmp[idx] * (1 - smoothStrength) + avg * smoothStrength;
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
