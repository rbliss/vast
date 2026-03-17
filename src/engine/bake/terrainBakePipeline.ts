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
import { applyFanDeposition } from '../terrain/fanDeposition';

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
export function executeBake(request: TerrainBakeRequest): TerrainBakeArtifacts {
  const { macro, erosion } = request;
  const n = erosion.gridSize;
  const extent = erosion.extent;
  const cellSize = (extent * 2) / (n - 1);

  const t0 = performance.now();

  // ── Stage 1: Sample macro terrain ──
  const tSample0 = performance.now();
  const base = new MacroTerrainSource(macro);
  const grid = new Float32Array(n * n);
  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const wx = -extent + x * cellSize;
      const wz = -extent + z * cellSize;
      grid[z * n + x] = base.sampleHeight(wx, wz);
    }
  }
  const tSample = performance.now() - tSample0;

  // ── Stage 2: Stream-power erosion ──
  let spResult: ReturnType<typeof streamPowerErosion> | null = null;
  let tStreamPower = 0;
  if (erosion.streamPower.enabled) {
    const t = performance.now();
    spResult = streamPowerErosion(grid, n, n, cellSize, erosion.streamPower);
    tStreamPower = performance.now() - t;
    console.log(`[bake] stream-power: ${erosion.streamPower.iterations} iterations (${tStreamPower.toFixed(0)}ms)`);
  }

  // ── Stage 2b: Channel geometry shaping ──
  if (spResult) {
    const tChan0 = performance.now();
    applyChannelGeometry(grid, spResult.area, spResult.receiver, n, n, cellSize);
    console.log(`[bake] channel geometry (${(performance.now() - tChan0).toFixed(0)}ms)`);
  }

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

  // ── Stage 4: Thermal relaxation ──
  let tThermal = 0;
  if (erosion.thermal.enabled) {
    const t = performance.now();
    thermalErosion(grid, n, n, cellSize, erosion.thermal);
    tThermal = performance.now() - t;
    console.log(`[bake] thermal: ${erosion.thermal.iterations} iterations (${tThermal.toFixed(0)}ms)`);
  }

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
