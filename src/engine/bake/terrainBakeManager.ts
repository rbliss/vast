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
export async function runBake(
  request: TerrainBakeRequest,
  onProgress?: BakeProgressCallback,
): Promise<TerrainBakeArtifacts> {
  // Step 1: Check cache
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

  // Step 2: Compute (worker preferred)
  let artifacts: TerrainBakeArtifacts;
  try {
    artifacts = await runBakeInWorker(request, onProgress);
  } catch (err) {
    console.warn('[bake] worker failed, falling back to main thread:', err);
    artifacts = runBakeOnMainThread(request);
  }

  // Step 3: Save to cache (fire-and-forget)
  saveToCache(request, artifacts).catch(err => {
    console.warn('[bake] cache save failed:', err);
  });

  return artifacts;
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
