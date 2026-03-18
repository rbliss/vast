/**
 * Terrain bake worker.
 *
 * Dedicated module worker that runs the terrain bake pipeline
 * off the main thread. Delegates to the shared executeBake() in
 * terrainBakePipeline.ts — single source of truth for bake logic.
 *
 *   Main → Worker: { type: 'bake', request, preSampledGrid?, captureStages? }
 *   Worker → Main: { type: 'progress', stage, stageIndex, totalStages, elapsedMs }
 *   Worker → Main: { type: 'stage-capture', stage, grid }  (diagnostics only)
 *   Worker → Main: { type: 'result', artifacts }
 *   Worker → Main: { type: 'error', message }
 */

import { executeBake, type StageCaptureCallback } from './terrainBakePipeline';

// ── Message handler ──

self.onmessage = (e: MessageEvent) => {
  const msg = e.data;
  if (msg.type === 'bake') {
    try {
      // Stage capture callback for diagnostics
      const onStageCapture: StageCaptureCallback | undefined = msg.captureStages
        ? (stage: string, grid: Float32Array) => {
            self.postMessage({ type: 'stage-capture', stage, grid }, { transfer: [grid.buffer] });
          }
        : undefined;

      const artifacts = executeBake(msg.request, msg.preSampledGrid, onStageCapture);

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
