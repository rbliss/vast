/**
 * Analytical coarse fluvial prepass (AE2).
 *
 * AE2 architecture: explicit drainage graph, not direct trench solving.
 * 1. Downsample + fill depressions
 * 2. MFD accumulation to find drainage structure
 * 3. Extract explicit drainage graph (nodes, edges, hierarchy)
 * 4. Generate raster guidance fields from graph (width, depth, profiles)
 * 5. Apply graph-shaped valleys to terrain
 * 6. Upsample and blend with original
 */

import type { AnalyticalPrepassConfig } from './types';
import { fillDepressions, computeCoarseDrainage } from './drainageSolve';
import { extractDrainageGraph, generateGuidanceFields, applyGuidanceToTerrain } from './drainageGraph';

/**
 * Run the analytical coarse prepass on a benchmark heightfield.
 *
 * @param grid - Full-resolution height grid (1024², modified in place)
 * @param gridSize - Full grid dimension (e.g. 1024)
 * @param extent - World-space half-extent (e.g. 800)
 * @param config - Prepass configuration
 */
/** Full-resolution guidance fields for H2 bake integration */
export interface FullResGuidance {
  /** Channel strength [0,1] — seed for proto-channel susceptibility */
  channelStrength: Float32Array;
  /** Distance to nearest channel centerline (world units) */
  distToChannel: Float32Array;
  /** Target valley width (world units) */
  valleyWidth: Float32Array;
  /** Target valley depth */
  valleyDepth: Float32Array;
}

export function runAnalyticalPrepass(
  grid: Float32Array,
  gridSize: number,
  extent: number,
  config: AnalyticalPrepassConfig,
): { coarseGrid: Float32Array; coarseSize: number; guidance: FullResGuidance } {
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

  // ── Step 3: AE2 — Graph-based drainage ──
  // Instead of iterative trench solving, extract an explicit drainage graph
  // and use it to shape terrain with proper valley profiles.
  const n = coarseSize * coarseSize;
  const channelThreshold = 200 * coarseCellSize * coarseCellSize;

  // 3a. Run a few fp iterations to stabilize drainage routing on the filled terrain
  for (let fp = 0; fp < Math.min(config.fixedPointIterations, 4); fp++) {
    const { receiver, area } = computeCoarseDrainage(coarseGrid, coarseSize, coarseSize, coarseCellSize);
    // Light depression-driven routing refinement (no elevation solve — just let drainage settle)
    if (fp === 1) fillDepressions(coarseGrid, coarseSize, coarseSize);
  }

  // 3b. Final drainage computation for graph extraction
  const { receiver, area } = computeCoarseDrainage(coarseGrid, coarseSize, coarseSize, coarseCellSize);

  // 3c. Extract explicit drainage graph
  const graph = extractDrainageGraph(area, receiver, coarseGrid, coarseSize, coarseSize, coarseCellSize, channelThreshold);

  // 3d. Generate raster guidance fields from graph
  const fields = generateGuidanceFields(graph, coarseSize, coarseSize, coarseCellSize);

  // 3e. Light height carving — secondary to guidance fields
  // Use reduced blend so the prepass steers but doesn't dominate
  applyGuidanceToTerrain(coarseGrid, coarseInitial, fields, coarseSize, coarseSize, config.blendStrength * 0.5);

  // ── Step 4: Light smoothing ──
  for (let s = 0; s < config.smoothingPasses + 1; s++) {
    const tmp = new Float32Array(coarseGrid);
    for (let z = 1; z < coarseSize - 1; z++) {
      for (let x = 1; x < coarseSize - 1; x++) {
        const idx = z * coarseSize + x;
        const avg = (tmp[idx - 1] + tmp[idx + 1] + tmp[idx - coarseSize] + tmp[idx + coarseSize]) / 4;
        coarseGrid[idx] = tmp[idx] * 0.8 + avg * 0.2;
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

  // ── Step 6: Upsample guidance fields to full resolution ──
  const fullN = gridSize * gridSize;
  const fullGuidance: FullResGuidance = {
    channelStrength: new Float32Array(fullN),
    distToChannel: new Float32Array(fullN).fill(Infinity),
    valleyWidth: new Float32Array(fullN),
    valleyDepth: new Float32Array(fullN),
  };

  for (let fz = 0; fz < gridSize; fz++) {
    for (let fx = 0; fx < gridSize; fx++) {
      const wx = -extent + fx * fullCellSize;
      const wz = -extent + fz * fullCellSize;
      const ccx = (wx + extent) / coarseCellSize;
      const ccz = (wz + extent) / coarseCellSize;
      const ix = Math.min(coarseSize - 2, Math.max(0, Math.floor(ccx)));
      const iz = Math.min(coarseSize - 2, Math.max(0, Math.floor(ccz)));
      const fracX = ccx - ix;
      const fracZ = ccz - iz;

      const fullIdx = fz * gridSize + fx;

      // Bilinear upsample each guidance field
      for (const [coarseField, fullField] of [
        [fields.channelStrength, fullGuidance.channelStrength],
        [fields.valleyWidth, fullGuidance.valleyWidth],
        [fields.valleyDepth, fullGuidance.valleyDepth],
      ] as [Float32Array, Float32Array][]) {
        const v00 = coarseField[iz * coarseSize + ix];
        const v10 = coarseField[iz * coarseSize + ix + 1];
        const v01 = coarseField[(iz + 1) * coarseSize + ix];
        const v11 = coarseField[(iz + 1) * coarseSize + ix + 1];
        fullField[fullIdx] =
          v00 * (1 - fracX) * (1 - fracZ) +
          v10 * fracX * (1 - fracZ) +
          v01 * (1 - fracX) * fracZ +
          v11 * fracX * fracZ;
      }

      // Distance field — take min of bilinear samples (conservative)
      const d00 = fields.distToChannel[iz * coarseSize + ix];
      const d10 = fields.distToChannel[iz * coarseSize + ix + 1];
      const d01 = fields.distToChannel[(iz + 1) * coarseSize + ix];
      const d11 = fields.distToChannel[(iz + 1) * coarseSize + ix + 1];
      fullGuidance.distToChannel[fullIdx] = Math.min(d00, d10, d01, d11);
    }
  }

  const tTotal = performance.now() - t0;
  console.log(`[analytical] prepass complete: ${tTotal.toFixed(0)}ms total, ${graph.nodes.length} graph nodes, ${graph.edges.length} edges`);

  return { coarseGrid, coarseSize, guidance: fullGuidance };
}
