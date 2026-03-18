/**
 * Sculpt erosion worker.
 *
 * Runs the erosion pipeline on an editable heightfield off the main thread.
 * Receives the height grid, runs erosion, returns the modified grid.
 * Reports per-iteration progress.
 */

import { streamPowerErosion, DEFAULT_STREAM_POWER } from '../terrain/streamPower';
import type { StreamPowerParams } from '../terrain/streamPower';
import { applyChannelGeometry } from '../terrain/channelGeometry';
import { applyHillslopeTransport } from '../terrain/hillslopeTransport';
import { applyTerraceFormation } from '../terrain/terraceFormation';
import { applyFanDeposition } from '../terrain/fanDeposition';
import { thermalErosion } from '../terrain/erosion';
import { generateResistanceGrid } from '../terrain/resistanceField';

interface ErosionRequest {
  type: 'erode';
  grid: Float32Array;
  gridSize: number;
  extent: number;
  cellSize: number;
  iterations: number;
  erosionStrength: number;
  channelGeometry: boolean;
  hillslope: boolean;
  resistance: boolean;
  /** Run full bake stages (terraces, fans, thermal) after erosion */
  fullPipeline: boolean;
}

self.onmessage = (e: MessageEvent) => {
  const msg = e.data as ErosionRequest;
  if (msg.type !== 'erode') return;

  const { grid, gridSize: n, extent, cellSize: cs, iterations, erosionStrength } = msg;

  try {
    const t0 = performance.now();

    // Build params
    const spParams: StreamPowerParams = {
      ...DEFAULT_STREAM_POWER,
      iterations,
      erosionK: erosionStrength,
    };

    // Resistance generator
    const resistanceGen = msg.resistance
      ? (heights: Float32Array) => generateResistanceGrid(heights, n, n, extent, cs)
      : undefined;

    // Stream-power erosion with progress + throttled previews
    const PREVIEW_INTERVAL = 4; // send preview every N iterations
    const spResult = streamPowerErosion(grid, n, n, cs, spParams, resistanceGen, (iter) => {
      self.postMessage({ type: 'progress', iteration: iter, total: iterations });

      // Send throttled preview during stream-power
      if (iter % PREVIEW_INTERVAL === 0 || iter === iterations) {
        const previewCopy = new Float32Array(grid);
        self.postMessage(
          { type: 'preview', iteration: iter, grid: previewCopy },
          { transfer: [previewCopy.buffer] },
        );
      }
    });

    // Channel geometry — skip in fullPipeline mode (creates synthetic contour artifacts)
    if (msg.channelGeometry && !msg.fullPipeline) {
      const chanResistance = msg.resistance
        ? generateResistanceGrid(grid, n, n, extent, cs)
        : undefined;
      applyChannelGeometry(grid, spResult.area, spResult.receiver, n, n, cs, undefined, chanResistance);
    }

    // Hillslope transport
    if (msg.hillslope) {
      const hillResistance = msg.resistance
        ? generateResistanceGrid(grid, n, n, extent, cs)
        : undefined;
      applyHillslopeTransport(grid, n, n, cs, undefined, hillResistance);
    }

    // Full pipeline stages (fans, thermal) — for benchmark realism
    // Note: terraces and channel geometry are skipped to avoid synthetic artifacts
    if (msg.fullPipeline && spResult) {
      // Fan / debris deposition
      applyFanDeposition(grid, spResult.area, spResult.receiver, spResult.slopes, n, n, cs);

      // Thermal relaxation (smooths oversteepened faces)
      thermalErosion(grid, n, n, cs, { iterations: 10, talusThreshold: 1.5, transferRate: 0.3 });
    }

    const elapsed = performance.now() - t0;

    // Transfer the grid back (zero-copy)
    self.postMessage(
      { type: 'result', grid, elapsed },
      { transfer: [grid.buffer] },
    );
  } catch (err) {
    self.postMessage({
      type: 'error',
      message: err instanceof Error ? err.message : String(err),
    });
  }
};
