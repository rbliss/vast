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

    // Stream-power erosion with progress
    const spResult = streamPowerErosion(grid, n, n, cs, spParams, resistanceGen, (iter) => {
      self.postMessage({ type: 'progress', iteration: iter, total: iterations });
    });

    // Channel geometry
    if (msg.channelGeometry) {
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
