/**
 * Terrain bake worker.
 *
 * Dedicated module worker that runs the terrain bake pipeline
 * off the main thread. Communicates via structured messages:
 *   Main → Worker: { type: 'bake', request: TerrainBakeRequest }
 *   Worker → Main: { type: 'progress', stage, stageIndex, totalStages, elapsedMs }
 *   Worker → Main: { type: 'result', artifacts: TerrainBakeArtifacts }
 *   Worker → Main: { type: 'error', message: string }
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

// ── Progress reporting ──

type ProgressStage = 'sampling' | 'stream-power' | 'fan-deposition' | 'thermal' | 'packaging';
const STAGES: ProgressStage[] = ['sampling', 'stream-power', 'fan-deposition', 'thermal', 'packaging'];

function reportProgress(stage: ProgressStage, t0: number) {
  const stageIndex = STAGES.indexOf(stage);
  self.postMessage({
    type: 'progress',
    stage,
    stageIndex,
    totalStages: STAGES.length,
    elapsedMs: performance.now() - t0,
  });
}

// ── Bake execution (same logic as terrainBakePipeline.ts, with progress) ──

function executeBakeInWorker(request: TerrainBakeRequest): TerrainBakeArtifacts {
  const { macro, erosion } = request;
  const n = erosion.gridSize;
  const extent = erosion.extent;
  const cellSize = (extent * 2) / (n - 1);

  const t0 = performance.now();

  // Stage 1: Sample
  reportProgress('sampling', t0);
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

  // Stage 2: Stream-power (dynamic per-iteration resistance)
  const resistanceGen = (heights: Float32Array) => generateResistanceGrid(heights, n, n, extent, cellSize);
  reportProgress('stream-power', t0);
  let spResult: ReturnType<typeof streamPowerErosion> | null = null;
  let tStreamPower = 0;
  if (erosion.streamPower.enabled) {
    const t = performance.now();
    spResult = streamPowerErosion(grid, n, n, cellSize, erosion.streamPower, resistanceGen);
    tStreamPower = performance.now() - t;
  }

  // Stage 2b: Channel geometry (resistance-aware)
  if (spResult) {
    const chanResistance = generateResistanceGrid(grid, n, n, extent, cellSize);
    applyChannelGeometry(grid, spResult.area, spResult.receiver, n, n, cellSize, undefined, chanResistance);
  }

  // Stage 2c: Hillslope transport (resistance-aware)
  const postResistance = generateResistanceGrid(grid, n, n, extent, cellSize);
  applyHillslopeTransport(grid, n, n, cellSize, undefined, postResistance);

  // Stage 2d: Terraces
  if (spResult) {
    const inv2cs = 1 / (2 * cellSize);
    const terrSlopes = new Float32Array(n * n);
    for (let z = 1; z < n - 1; z++) {
      for (let x = 1; x < n - 1; x++) {
        const idx = z * n + x;
        const dhdx = (grid[idx + 1] - grid[idx - 1]) * inv2cs;
        const dhdz = (grid[idx + n] - grid[idx - n]) * inv2cs;
        terrSlopes[idx] = Math.sqrt(dhdx * dhdx + dhdz * dhdz);
      }
    }
    applyTerraceFormation(grid, spResult.area, terrSlopes, n, n, cellSize);
  }

  // Stage 3: Fan/debris
  reportProgress('fan-deposition', t0);
  const depositionAccum = spResult?.deposition ?? new Float32Array(n * n);
  let tFan = 0;
  if (erosion.fan.enabled && spResult) {
    const preFan = new Float32Array(grid);
    const t = performance.now();
    applyFanDeposition(
      grid, spResult.area, spResult.receiver, spResult.slopes,
      n, n, cellSize, erosion.fan,
    );
    for (let i = 0; i < n * n; i++) {
      const delta = grid[i] - preFan[i];
      if (delta > 0) depositionAccum[i] += delta;
    }
    tFan = performance.now() - t;
  }

  // Stage 4: Thermal
  reportProgress('thermal', t0);
  let tThermal = 0;
  if (erosion.thermal.enabled) {
    const t = performance.now();
    thermalErosion(grid, n, n, cellSize, erosion.thermal);
    tThermal = performance.now() - t;
  }

  // Stage 5: Package
  reportProgress('packaging', t0);
  const totalTime = performance.now() - t0;

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

  return { heightGrid: grid, depositionMap: depositionAccum, metadata };
}

// ── Message handler ──

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'bake') {
    try {
      const artifacts = executeBakeInWorker(msg.request);
      // Transfer large buffers instead of copying
      self.postMessage(
        { type: 'result', artifacts },
        { transfer: [artifacts.heightGrid.buffer, artifacts.depositionMap.buffer] },
      );
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
