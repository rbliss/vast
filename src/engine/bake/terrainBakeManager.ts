/**
 * Terrain bake manager.
 *
 * Main-thread orchestrator for terrain bake jobs.
 * Launches a dedicated module worker, tracks progress,
 * and delivers artifacts via a Promise.
 *
 * Falls back to main-thread synchronous bake if workers
 * are unavailable or fail to initialize.
 */

import type { TerrainBakeRequest, TerrainBakeArtifacts } from './types';
import { executeBake } from './terrainBakePipeline';
import { loadFromCache, saveToCache } from './bakeCache';

// ── Progress events ──

export interface BakeProgress {
  stage: string;
  stageIndex: number;
  totalStages: number;
  elapsedMs: number;
}

export type BakeProgressCallback = (progress: BakeProgress) => void;

// ── Manager ──

/**
 * Run a terrain bake with cache-first strategy:
 *   1. Check OPFS cache for matching artifacts
 *   2. If miss, run bake in worker (or main-thread fallback)
 *   3. Save result to cache
 *
 * @param request The bake request
 * @param onProgress Optional progress callback
 * @returns Promise resolving to bake artifacts
 */
export type StageCaptureHandler = (stage: string, grid: Float32Array) => void;

export async function runBake(
  request: TerrainBakeRequest,
  onProgress?: BakeProgressCallback,
  preSampledGrid?: Float32Array,
  onStageCapture?: StageCaptureHandler,
  aeChannelStrength?: Float32Array,
): Promise<TerrainBakeArtifacts> {
  // Step 1: Check cache (skip for pre-sampled grids — they're deterministic but not macro-keyed)
  if (!preSampledGrid) {
    try {
      const cached = await loadFromCache(request);
      if (cached.hit && cached.artifacts) {
        onProgress?.({
          stage: 'cache-hit',
          stageIndex: 0,
          totalStages: 1,
          elapsedMs: 0,
        });
        return cached.artifacts;
      }
    } catch (err) {
      console.warn('[bake] cache check failed:', err);
    }
  }

  // Step 2: Compute (worker preferred)
  let artifacts: TerrainBakeArtifacts;
  try {
    artifacts = await runBakeInWorker(request, onProgress, preSampledGrid, onStageCapture, aeChannelStrength);
  } catch (err) {
    console.warn('[bake] worker failed, falling back to main thread:', err);
    artifacts = runBakeOnMainThread(request, preSampledGrid, onStageCapture, aeChannelStrength);
  }

  // Step 3: Save to cache (skip for pre-sampled grids)
  if (!preSampledGrid) {
    saveToCache(request, artifacts).catch(err => {
      console.warn('[bake] cache save failed:', err);
    });
  }

  return artifacts;
}

/**
 * Run bake in a dedicated module worker.
 */
function runBakeInWorker(
  request: TerrainBakeRequest,
  onProgress?: BakeProgressCallback,
  preSampledGrid?: Float32Array,
  onStageCapture?: StageCaptureHandler,
  aeChannelStrength?: Float32Array,
): Promise<TerrainBakeArtifacts> {
  return new Promise((resolve, reject) => {
    let worker: Worker;

    try {
      worker = new Worker(
        new URL('./terrainBake.worker.ts', import.meta.url),
        { type: 'module' },
      );
    } catch (err) {
      reject(new Error(`Worker creation failed: ${err}`));
      return;
    }

    const timeout = setTimeout(() => {
      worker.terminate();
      reject(new Error('Bake worker timed out (300s)'));
    }, 300000);

    worker.onmessage = (e: MessageEvent) => {
      const msg = e.data;

      if (msg.type === 'progress' && onProgress) {
        onProgress({
          stage: msg.stage,
          stageIndex: msg.stageIndex,
          totalStages: msg.totalStages,
          elapsedMs: msg.elapsedMs,
        });
      }

      if (msg.type === 'stage-capture' && onStageCapture) {
        onStageCapture(msg.stage, new Float32Array(msg.grid));
      }

      if (msg.type === 'result') {
        clearTimeout(timeout);
        worker.terminate();
        resolve(msg.artifacts);
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
      reject(new Error(`Worker error: ${err.message}`));
    };

    // Send bake request (with optional pre-sampled grid + AE guidance transfer)
    const workerMsg: any = { type: 'bake', request, captureStages: !!onStageCapture };
    const transfer: Transferable[] = [];
    if (preSampledGrid) {
      const gridCopy = new Float32Array(preSampledGrid);
      workerMsg.preSampledGrid = gridCopy;
      transfer.push(gridCopy.buffer);
    }
    if (aeChannelStrength) {
      const csCopy = new Float32Array(aeChannelStrength);
      workerMsg.aeChannelStrength = csCopy;
      transfer.push(csCopy.buffer);
      // Full guidance fields passed via window global if available
      const fullGuidance = typeof globalThis !== 'undefined' && (globalThis as any).__aeFullGuidance;
      if (fullGuidance) {
        workerMsg.aeDistToChannel = new Float32Array(fullGuidance.distToChannel);
        workerMsg.aeValleyWidth = new Float32Array(fullGuidance.valleyWidth);
        workerMsg.aeValleyDepth = new Float32Array(fullGuidance.valleyDepth);
        transfer.push(workerMsg.aeDistToChannel.buffer, workerMsg.aeValleyWidth.buffer, workerMsg.aeValleyDepth.buffer);
      }
    }
    worker.postMessage(workerMsg, { transfer });
    console.log('[bake] dispatched to worker');
  });
}

/**
 * Synchronous main-thread fallback.
 */
function runBakeOnMainThread(request: TerrainBakeRequest, preSampledGrid?: Float32Array, onStageCapture?: StageCaptureHandler, aeChannelStrength?: Float32Array): TerrainBakeArtifacts {
  console.log('[bake] running on main thread (fallback)');
  return executeBake(request, preSampledGrid, onStageCapture, aeChannelStrength ? { channelStrength: aeChannelStrength, distToChannel: new Float32Array(0), valleyWidth: new Float32Array(0), valleyDepth: new Float32Array(0) } : undefined);
}
