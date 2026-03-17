/**
 * Terrain field textures.
 *
 * Bakes terrain analysis data (slope, altitude, curvature, flow)
 * from the eroded heightfield into DataTextures that the material
 * shader can read. This is how materials become terrain-aware:
 * they don't just use the geometric normal, they read pre-computed
 * erosion and analysis fields.
 *
 * The textures cover the same bounded preview region as the erosion bake.
 */

import * as THREE from 'three';
import type { TerrainSource } from './terrainSource';

export interface FieldTextures {
  /** RGBA float texture: R=slope, G=normalizedAltitude, B=curvature, A=localFlowProxy */
  fieldMap: THREE.DataTexture;
  /** World-space bounds of the field map */
  extent: number;
  /** Dispose all GPU resources */
  dispose: () => void;
}

/**
 * Generate terrain field textures from a terrain source.
 * Samples the source over a grid and computes slope, altitude,
 * curvature, and local flow proxy.
 */
export function generateFieldTextures(
  terrain: TerrainSource,
  gridSize: number,
  extent: number,
): FieldTextures {
  const n = gridSize;
  const cellSize = (extent * 2) / (n - 1);

  // Sample height grid
  const heights = new Float32Array(n * n);
  let minH = Infinity, maxH = -Infinity;

  for (let z = 0; z < n; z++) {
    for (let x = 0; x < n; x++) {
      const wx = -extent + x * cellSize;
      const wz = -extent + z * cellSize;
      const h = terrain.sampleHeight(wx, wz);
      heights[z * n + x] = h;
      if (h < minH) minH = h;
      if (h > maxH) maxH = h;
    }
  }

  const hRange = maxH - minH || 1;

  // Compute fields: slope, normalized altitude, curvature, local flow
  const data = new Float32Array(n * n * 4); // RGBA

  // Slope + altitude + curvature
  for (let z = 1; z < n - 1; z++) {
    for (let x = 1; x < n - 1; x++) {
      const idx = z * n + x;
      const hc = heights[idx];

      // Slope (central differences)
      const dhdx = (heights[idx + 1] - heights[idx - 1]) / (2 * cellSize);
      const dhdz = (heights[idx + n] - heights[idx - n]) / (2 * cellSize);
      const slope = Math.sqrt(dhdx * dhdx + dhdz * dhdz);

      // Normalized altitude (0 = lowest, 1 = highest)
      const alt = (hc - minH) / hRange;

      // Curvature (Laplacian)
      const cs2 = cellSize * cellSize;
      const laplacian = (heights[idx + 1] + heights[idx - 1] +
                         heights[idx + n] + heights[idx - n] -
                         4 * hc) / cs2;

      const pi = idx * 4;
      data[pi + 0] = slope;
      data[pi + 1] = alt;
      data[pi + 2] = laplacian;
      data[pi + 3] = 0; // flow proxy filled below
    }
  }

  // Local flow proxy (D8 accumulation)
  const area = new Float32Array(n * n);
  area.fill(1);
  const sorted = new Uint32Array(n * n);
  for (let i = 0; i < n * n; i++) sorted[i] = i;
  sorted.sort((a, b) => heights[b] - heights[a]);

  const D8_DX = [-1, 0, 1, -1, 1, -1, 0, 1];
  const D8_DZ = [-1, -1, -1, 0, 0, 1, 1, 1];
  const D8_DIST = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

  for (let i = 0; i < n * n; i++) {
    const idx = sorted[i];
    const x = idx % n;
    const z = (idx - x) / n;
    if (x < 1 || x >= n - 1 || z < 1 || z >= n - 1) continue;

    const hc = heights[idx];
    let bestSlope = 0;
    let bestIdx = -1;

    for (let d = 0; d < 8; d++) {
      const ni = (z + D8_DZ[d]) * n + (x + D8_DX[d]);
      const drop = (hc - heights[ni]) / (D8_DIST[d] * cellSize);
      if (drop > bestSlope) {
        bestSlope = drop;
        bestIdx = ni;
      }
    }

    if (bestIdx >= 0) {
      area[bestIdx] += area[idx];
    }
  }

  // Write flow into alpha channel (log-scaled, normalized)
  let maxFlow = 1;
  for (let i = 0; i < n * n; i++) {
    if (area[i] > maxFlow) maxFlow = area[i];
  }
  const logMaxFlow = Math.log2(maxFlow) || 1;

  for (let i = 0; i < n * n; i++) {
    data[i * 4 + 3] = Math.log2(area[i]) / logMaxFlow;
  }

  // Create DataTexture
  const fieldMap = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.FloatType);
  fieldMap.wrapS = THREE.ClampToEdgeWrapping;
  fieldMap.wrapT = THREE.ClampToEdgeWrapping;
  fieldMap.magFilter = THREE.LinearFilter;
  fieldMap.minFilter = THREE.LinearFilter;
  fieldMap.needsUpdate = true;

  console.log(`[fields] baked ${n}x${n} field texture (height range: ${minH.toFixed(1)} - ${maxH.toFixed(1)})`);

  return {
    fieldMap,
    extent,
    dispose: () => fieldMap.dispose(),
  };
}
