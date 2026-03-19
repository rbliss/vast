/**
 * Terrain bake pipeline.
 *
 * Pure computation: takes a TerrainBakeRequest, produces TerrainBakeArtifacts.
 * No side effects, no GPU, no DOM. Suitable for main-thread or worker execution.
 */

import type { TerrainBakeRequest, TerrainBakeArtifacts, TerrainBakeMetadata } from './types';
import { MacroTerrainSource } from '../terrain/macroTerrain';
import { thermalErosion } from '../terrain/erosion';
import { streamPowerErosion } from '../terrain/streamPower';
import { applyChannelGeometry } from '../terrain/channelGeometry';
import { applyHillslopeTransport } from '../terrain/hillslopeTransport';
import { applyFanDeposition } from '../terrain/fanDeposition';
import { applyTerraceFormation } from '../terrain/terraceFormation';
import { generateResistanceGrid } from '../terrain/resistanceField';

/**
 * Execute the full terrain bake pipeline synchronously.
 *
 * Stages:
 *   1. Sample macro terrain into height grid
 *   2. Stream-power erosion (hierarchical channels)
 *   3. Fan/debris deposition
 *   4. Thermal relaxation
 *
 * Returns immutable artifacts suitable for runtime sampling.
 */
/**
 * Execute the full terrain bake pipeline synchronously.
 *
 * @param request - Bake configuration (macro terrain + erosion params)
 * @param preSampledGrid - Optional pre-built height grid (skips macro sampling).
 *   Used by the benchmark to feed a deterministic heightfield through
 *   the same pipeline as production.
 */
/**
 * Stage capture callback: receives a copy of the grid after each pipeline stage.
 * Used for diagnostics (H2.1b.1) to identify where tributaries are lost.
 */
export type StageCaptureCallback = (stage: string, grid: Float32Array) => void;

/** Log per-stage numeric diagnostics */
function logStageDiag(stage: string, grid: Float32Array, initial: Float32Array) {
  let maxDelta = 0, totalDelta = 0, changedCells = 0;
  for (let i = 0; i < grid.length; i++) {
    const d = Math.abs(grid[i] - initial[i]);
    if (d > 0.001) { changedCells++; totalDelta += d; }
    if (d > maxDelta) maxDelta = d;
  }
  const meanDelta = changedCells > 0 ? totalDelta / changedCells : 0;
  console.log(`[bake-diag] ${stage}: maxΔ=${maxDelta.toFixed(2)} meanΔ=${meanDelta.toFixed(3)} changed=${changedCells} (${(changedCells/grid.length*100).toFixed(1)}%)`);
}

/** AE3 guidance fields from analytical prepass */
export interface AEGuidanceFields {
  channelStrength: Float32Array;
  distToChannel: Float32Array;
  valleyWidth: Float32Array;
  valleyDepth: Float32Array;
}

export function executeBake(
  request: TerrainBakeRequest,
  preSampledGrid?: Float32Array,
  onStageCapture?: StageCaptureCallback,
  aeGuidance?: AEGuidanceFields,
): TerrainBakeArtifacts {
  const { macro, erosion } = request;
  const n = erosion.gridSize;
  const extent = erosion.extent;
  const cellSize = (extent * 2) / (n - 1);

  const t0 = performance.now();

  // ── Stage 1: Sample macro terrain (or use pre-sampled grid) ──
  const tSample0 = performance.now();
  let grid: Float32Array;
  if (preSampledGrid && preSampledGrid.length === n * n) {
    grid = new Float32Array(preSampledGrid); // copy to avoid mutating the source
  } else {
    const base = new MacroTerrainSource(macro);
    grid = new Float32Array(n * n);
    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        const wx = -extent + x * cellSize;
        const wz = -extent + z * cellSize;
        grid[z * n + x] = base.sampleHeight(wx, wz);
      }
    }
  }
  const tSample = performance.now() - tSample0;

  // Save initial state for per-stage diagnostics
  const initialGrid = new Float32Array(grid);

  // ── Stage 2: Stream-power erosion (with dynamic per-iteration resistance) ──
  // Resistance generator: recomputes strata from current evolving heights each iteration
  const resistanceGen = (heights: Float32Array) => generateResistanceGrid(heights, n, n, extent, cellSize);
  console.log(`[bake] resistance: dynamic per-iteration strata`);

  let spResult: ReturnType<typeof streamPowerErosion> | null = null;
  let tStreamPower = 0;
  if (erosion.streamPower.enabled) {
    const t = performance.now();
    spResult = streamPowerErosion(grid, n, n, cellSize, erosion.streamPower, resistanceGen, undefined, undefined, aeGuidance ? {
      channelStrength: aeGuidance.channelStrength,
      distToChannel: aeGuidance.distToChannel,
      valleyWidth: aeGuidance.valleyWidth,
      valleyDepth: aeGuidance.valleyDepth,
    } : undefined);
    tStreamPower = performance.now() - t;
    console.log(`[bake] stream-power: ${erosion.streamPower.iterations} iterations (${tStreamPower.toFixed(0)}ms)`);
  }
  logStageDiag('after-stream-power', grid, initialGrid);
  onStageCapture?.('after-stream-power', new Float32Array(grid));

  // ── Stage 2b: Channel geometry shaping (resistance-aware) ──
  if (spResult) {
    const postChannelResistance = resistanceGen(grid);
    const tChan0 = performance.now();
    applyChannelGeometry(grid, spResult.area, spResult.receiver, n, n, cellSize, undefined, postChannelResistance);
    console.log(`[bake] channel geometry (${(performance.now() - tChan0).toFixed(0)}ms)`);
  }
  logStageDiag('after-channel-geometry', grid, initialGrid);
  onStageCapture?.('after-channel-geometry', new Float32Array(grid));

  // ── Stage 2c: Hillslope transport / mass wasting (resistance-aware) ──
  {
    // Recompute resistance after erosion changed heights
    const postErosionResistance = generateResistanceGrid(grid, n, n, extent, cellSize);
    const tHill0 = performance.now();
    applyHillslopeTransport(grid, n, n, cellSize, undefined, postErosionResistance);
    console.log(`[bake] hillslope transport (${(performance.now() - tHill0).toFixed(0)}ms)`);
  }
  logStageDiag('after-hillslope', grid, initialGrid);
  onStageCapture?.('after-hillslope', new Float32Array(grid));

  // ── Stage 2d: Terrace / bench formation ──
  if (spResult) {
    const tTerr0 = performance.now();
    // Recompute slopes from current heights for terrace detection
    const terrSlopes = new Float32Array(n * n);
    const inv2cs = 1 / (2 * cellSize);
    for (let z = 1; z < n - 1; z++) {
      for (let x = 1; x < n - 1; x++) {
        const idx = z * n + x;
        const dhdx = (grid[idx + 1] - grid[idx - 1]) * inv2cs;
        const dhdz = (grid[idx + n] - grid[idx - n]) * inv2cs;
        terrSlopes[idx] = Math.sqrt(dhdx * dhdx + dhdz * dhdz);
      }
    }
    applyTerraceFormation(grid, spResult.area, terrSlopes, n, n, cellSize);
    console.log(`[bake] terrace formation (${(performance.now() - tTerr0).toFixed(0)}ms)`);
  }
  logStageDiag('after-terraces', grid, initialGrid);
  onStageCapture?.('after-terraces', new Float32Array(grid));

  // ── Stage 3: Fan/debris deposition ──
  const depositionAccum = spResult?.deposition ?? new Float32Array(n * n);
  let tFan = 0;
  if (erosion.fan.enabled && spResult) {
    const preFan = new Float32Array(grid);
    const t = performance.now();
    applyFanDeposition(
      grid, spResult.area, spResult.receiver, spResult.slopes,
      n, n, cellSize, erosion.fan,
    );
    // Track fan deposits in deposition map
    for (let i = 0; i < n * n; i++) {
      const delta = grid[i] - preFan[i];
      if (delta > 0) depositionAccum[i] += delta;
    }
    tFan = performance.now() - t;
    console.log(`[bake] fan deposition (${tFan.toFixed(0)}ms)`);
  }
  logStageDiag('after-fan-deposition', grid, initialGrid);
  onStageCapture?.('after-fan-deposition', new Float32Array(grid));

  // ── Stage 4: Thermal relaxation ──
  let tThermal = 0;
  if (erosion.thermal.enabled) {
    const t = performance.now();
    thermalErosion(grid, n, n, cellSize, erosion.thermal);
    tThermal = performance.now() - t;
    console.log(`[bake] thermal: ${erosion.thermal.iterations} iterations (${tThermal.toFixed(0)}ms)`);
  }
  logStageDiag('after-thermal', grid, initialGrid);
  onStageCapture?.('after-thermal', new Float32Array(grid));

  const totalTime = performance.now() - t0;
  console.log(`[bake] complete: ${totalTime.toFixed(0)}ms (${n}x${n} grid, extent ±${extent})`);

  // ── Package artifacts ──
  const metadata: TerrainBakeMetadata = {
    gridSize: n,
    extent,
    cellSize,
    computeTimeMs: totalTime,
    hasDeposition: depositionAccum.some(v => v > 0),
    timings: {
      sampling: tSample,
      streamPower: tStreamPower,
      fan: tFan,
      thermal: tThermal,
      total: totalTime,
    },
  };

  return {
    heightGrid: grid,
    depositionMap: depositionAccum,
    metadata,
  };
}
