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

import { executeBake, type StageCaptureCallback, type AEGuidanceFields } from './terrainBakePipeline';

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

      // Build AE guidance if provided
      const aeGuidance: AEGuidanceFields | undefined = msg.aeChannelStrength
        ? {
            channelStrength: msg.aeChannelStrength,
            distToChannel: msg.aeDistToChannel ?? new Float32Array(0),
            valleyWidth: msg.aeValleyWidth ?? new Float32Array(0),
            valleyDepth: msg.aeValleyDepth ?? new Float32Array(0),
          }
        : undefined;

      const artifacts = executeBake(msg.request, msg.preSampledGrid, onStageCapture, aeGuidance);

      // Transfer large buffers instead of copying
      const transfer: Transferable[] = [artifacts.heightGrid.buffer, artifacts.depositionMap.buffer];
      if (artifacts.provenance) transfer.push(artifacts.provenance.buffer);
      self.postMessage(
        { type: 'result', artifacts },
        { transfer },
      );
    } catch (err) {
      self.postMessage({
        type: 'error',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }
};
