/**
 * Sculpt erosion manager.
 *
 * Launches the sculptErosion worker from the same directory
 * (matches the pattern of terrainBakeManager.ts which works).
 */

export interface SculptErosionOpts {
  grid: Float32Array;
  gridSize: number;
  extent: number;
  cellSize: number;
  iterations: number;
  erosionStrength: number;
  channelGeometry: boolean;
  hillslope: boolean;
  resistance: boolean;
  onProgress?: (iteration: number) => void;
  onPreview?: (grid: Float32Array, iteration: number) => void;
}

export interface SculptErosionResult {
  grid: Float32Array;
  elapsed: number;
}

export function runSculptErosion(opts: SculptErosionOpts): Promise<SculptErosionResult> {
  return new Promise((resolve, reject) => {
    let worker: Worker;

    try {
      worker = new Worker(
        new URL('./sculptErosion.worker.ts', import.meta.url),
        { type: 'module' },
      );
    } catch (err) {
      reject(new Error(`Worker creation failed: ${err}`));
      return;
    }

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Erosion timed out (120s)'));
    }, 120000);

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'progress' && opts.onProgress) {
        opts.onProgress(msg.iteration);
      }

      if (msg.type === 'preview' && opts.onPreview) {
        opts.onPreview(new Float32Array(msg.grid), msg.iteration);
      }

      if (msg.type === 'result') {
        clearTimeout(timeout);
        worker.terminate();
        resolve({ grid: new Float32Array(msg.grid), elapsed: msg.elapsed });
      }

      if (msg.type === 'error') {
        clearTimeout(timeout);
        worker.terminate();
        reject(new Error(msg.message));
      }
    };

    worker.onerror = (err) => {
      clearTimeout(timeout);
      worker.terminate();
      reject(new Error(`Worker error: ${err.message || 'unknown'}`));
    };

    worker.postMessage({
      type: 'erode',
      grid: opts.grid,
      gridSize: opts.gridSize,
      extent: opts.extent,
      cellSize: opts.cellSize,
      iterations: opts.iterations,
      erosionStrength: opts.erosionStrength,
      channelGeometry: opts.channelGeometry,
      hillslope: opts.hillslope,
      resistance: opts.resistance,
    }, { transfer: [opts.grid.buffer] });

    console.log('[erosion] dispatched to worker');
  });
}
