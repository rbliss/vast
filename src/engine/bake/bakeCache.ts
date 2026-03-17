/**
 * Terrain bake cache using OPFS.
 *
 * Stores bake artifacts (height grid + deposition map + metadata)
 * keyed by a deterministic hash of the bake request config.
 * Warm starts skip the entire erosion computation.
 *
 * Falls back gracefully if OPFS is unavailable.
 */

import type { TerrainBakeRequest, TerrainBakeArtifacts, TerrainBakeMetadata } from './types';

// ── Cache version: bump to invalidate all cached bakes ──
const CACHE_VERSION = 'v9-h1-drainage';

// ── Cache key generation ──

/**
 * Generate a deterministic cache key from a bake request.
 * Includes all parameters that affect bake output.
 */
function generateCacheKey(request: TerrainBakeRequest): string {
  // Serialize the full config deterministically
  const configStr = JSON.stringify({
    v: CACHE_VERSION,
    macro: request.macro,
    erosion: {
      gridSize: request.erosion.gridSize,
      extent: request.erosion.extent,
      streamPower: request.erosion.streamPower,
      thermal: request.erosion.thermal,
      fan: request.erosion.fan,
      // Exclude hydraulic if disabled (doesn't affect output)
      ...(request.erosion.hydraulic.enabled ? { hydraulic: request.erosion.hydraulic } : {}),
    },
  });

  // Simple hash (djb2)
  let hash = 5381;
  for (let i = 0; i < configStr.length; i++) {
    hash = ((hash << 5) + hash + configStr.charCodeAt(i)) & 0xffffffff;
  }
  return `bake_${(hash >>> 0).toString(36)}`;
}

// ── OPFS operations ──

async function getOPFSRoot(): Promise<FileSystemDirectoryHandle | null> {
  try {
    const root = await navigator.storage.getDirectory();
    return await root.getDirectoryHandle('bakes', { create: true });
  } catch {
    return null;
  }
}

async function writeBlobToOPFS(
  dir: FileSystemDirectoryHandle,
  name: string,
  data: ArrayBuffer | string,
): Promise<void> {
  const fileHandle = await dir.getFileHandle(name, { create: true });
  const writable = await fileHandle.createWritable();
  await writable.write(data);
  await writable.close();
}

async function readBlobFromOPFS(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<ArrayBuffer | null> {
  try {
    const fileHandle = await dir.getFileHandle(name);
    const file = await fileHandle.getFile();
    return await file.arrayBuffer();
  } catch {
    return null;
  }
}

async function readTextFromOPFS(
  dir: FileSystemDirectoryHandle,
  name: string,
): Promise<string | null> {
  try {
    const fileHandle = await dir.getFileHandle(name);
    const file = await fileHandle.getFile();
    return await file.text();
  } catch {
    return null;
  }
}

// ── Public API ──

export interface CacheResult {
  hit: boolean;
  artifacts: TerrainBakeArtifacts | null;
  cacheKey: string;
}

/**
 * Try to load cached bake artifacts for the given request.
 */
export async function loadFromCache(request: TerrainBakeRequest): Promise<CacheResult> {
  const cacheKey = generateCacheKey(request);

  const root = await getOPFSRoot();
  if (!root) {
    console.log(`[cache] OPFS unavailable, cache miss`);
    return { hit: false, artifacts: null, cacheKey };
  }

  let cacheDir: FileSystemDirectoryHandle;
  try {
    cacheDir = await root.getDirectoryHandle(cacheKey);
  } catch {
    console.log(`[cache] miss: ${cacheKey}`);
    return { hit: false, artifacts: null, cacheKey };
  }

  // Read metadata
  const metaStr = await readTextFromOPFS(cacheDir, 'meta.json');
  if (!metaStr) {
    console.log(`[cache] miss (no metadata): ${cacheKey}`);
    return { hit: false, artifacts: null, cacheKey };
  }

  let metadata: TerrainBakeMetadata;
  try {
    metadata = JSON.parse(metaStr);
  } catch {
    console.log(`[cache] miss (corrupt metadata): ${cacheKey}`);
    return { hit: false, artifacts: null, cacheKey };
  }

  // Read height grid
  const heightBuf = await readBlobFromOPFS(cacheDir, 'height.f32');
  if (!heightBuf) {
    console.log(`[cache] miss (no height data): ${cacheKey}`);
    return { hit: false, artifacts: null, cacheKey };
  }

  // Read deposition map
  const depBuf = await readBlobFromOPFS(cacheDir, 'deposition.f32');
  if (!depBuf) {
    console.log(`[cache] miss (no deposition data): ${cacheKey}`);
    return { hit: false, artifacts: null, cacheKey };
  }

  // Validate sizes
  const expectedSize = metadata.gridSize * metadata.gridSize * 4;
  if (heightBuf.byteLength !== expectedSize || depBuf.byteLength !== expectedSize) {
    console.log(`[cache] miss (size mismatch): ${cacheKey}`);
    return { hit: false, artifacts: null, cacheKey };
  }

  const artifacts: TerrainBakeArtifacts = {
    heightGrid: new Float32Array(heightBuf),
    depositionMap: new Float32Array(depBuf),
    metadata,
  };

  console.log(`[cache] hit: ${cacheKey} (${metadata.computeTimeMs.toFixed(0)}ms saved)`);
  return { hit: true, artifacts, cacheKey };
}

/**
 * Store bake artifacts in the cache.
 */
export async function saveToCache(
  request: TerrainBakeRequest,
  artifacts: TerrainBakeArtifacts,
): Promise<void> {
  const cacheKey = generateCacheKey(request);

  const root = await getOPFSRoot();
  if (!root) {
    console.log(`[cache] OPFS unavailable, skip save`);
    return;
  }

  try {
    const cacheDir = await root.getDirectoryHandle(cacheKey, { create: true });

    await writeBlobToOPFS(cacheDir, 'meta.json', JSON.stringify(artifacts.metadata, null, 2));
    await writeBlobToOPFS(cacheDir, 'height.f32', artifacts.heightGrid.buffer as ArrayBuffer);
    await writeBlobToOPFS(cacheDir, 'deposition.f32', artifacts.depositionMap.buffer as ArrayBuffer);

    console.log(`[cache] saved: ${cacheKey}`);
  } catch (err) {
    console.warn(`[cache] save failed:`, err);
  }
}

/**
 * Clear all cached bakes.
 */
export async function clearCache(): Promise<void> {
  try {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry('bakes', { recursive: true });
    console.log('[cache] cleared');
  } catch (err) {
    console.warn('[cache] clear failed:', err);
  }
}
