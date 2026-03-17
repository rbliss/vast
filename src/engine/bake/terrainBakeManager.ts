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
 * Run a terrain bake, preferring a worker if available.
 *
 * @param request The bake request
 * @param onProgress Optional progress callback (called from worker messages)
 * @returns Promise resolving to bake artifacts
 */
export async function runBake(
  request: TerrainBakeRequest,
  onProgress?: BakeProgressCallback,
): Promise<TerrainBakeArtifacts> {
  // Try worker path first
  try {
    return await runBakeInWorker(request, onProgress);
  } catch (err) {
    console.warn('[bake] worker failed, falling back to main thread:', err);
    return runBakeOnMainThread(request);
  }
}

/**
 * Run bake in a dedicated module worker.
 */
function runBakeInWorker(
  request: TerrainBakeRequest,
  onProgress?: BakeProgressCallback,
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
      reject(new Error('Bake worker timed out (60s)'));
    }, 60000);

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

    // Send bake request
    worker.postMessage({ type: 'bake', request });
    console.log('[bake] dispatched to worker');
  });
}

/**
 * Synchronous main-thread fallback.
 */
function runBakeOnMainThread(request: TerrainBakeRequest): TerrainBakeArtifacts {
  console.log('[bake] running on main thread (fallback)');
  return executeBake(request);
}
