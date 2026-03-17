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
  /** RGBA float texture: R=slope, G=normalizedAltitude, B=curvature, A=depositionOrFlow */
  fieldMap: THREE.DataTexture;
  /** Single-channel float texture: raw terrain height at each cell */
  heightMap: THREE.DataTexture;
  /** World-space bounds of the field map */
  extent: number;
  /** CPU-side field sampler for scatter/foliage placement */
  sampleAt: (wx: number, wz: number) => { slope: number; altitude: number; curvature: number; deposition: number };
  /** Dispose all GPU resources */
  dispose: () => void;
}

/**
 * Generate terrain field textures from a terrain source.
 * Samples the source over a grid and computes slope, altitude,
 * curvature. If a deposition map is available (from erosion),
 * uses it for the alpha channel; otherwise falls back to local flow proxy.
 */
export function generateFieldTextures(
  terrain: TerrainSource,
  gridSize: number,
  extent: number,
  depositionMap?: Float32Array | null,
  depositionGridSize?: number,
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

  // Alpha channel: use explicit deposition map if available, otherwise local flow proxy
  if (depositionMap && depositionGridSize) {
    // Resample deposition map (may be different resolution than field grid)
    let maxDep = 0;
    for (let i = 0; i < depositionMap.length; i++) {
      if (depositionMap[i] > maxDep) maxDep = depositionMap[i];
    }
    const depScale = maxDep > 0 ? 1 / maxDep : 0;

    for (let z = 0; z < n; z++) {
      for (let x = 0; x < n; x++) {
        // Map field grid cell to deposition grid cell
        const dx = (x / (n - 1)) * (depositionGridSize - 1);
        const dz = (z / (n - 1)) * (depositionGridSize - 1);
        const ix = Math.min(Math.floor(dx), depositionGridSize - 2);
        const iz = Math.min(Math.floor(dz), depositionGridSize - 2);
        const fx = dx - ix;
        const fz = dz - iz;
        const dn = depositionGridSize;
        const d00 = depositionMap[iz * dn + ix];
        const d10 = depositionMap[iz * dn + ix + 1];
        const d01 = depositionMap[(iz + 1) * dn + ix];
        const d11 = depositionMap[(iz + 1) * dn + ix + 1];
        const dep = (d00 * (1 - fx) * (1 - fz) + d10 * fx * (1 - fz) +
                     d01 * (1 - fx) * fz + d11 * fx * fz) * depScale;
        data[(z * n + x) * 4 + 3] = dep;
      }
    }
    console.log(`[fields] using explicit deposition map (max=${maxDep.toFixed(2)})`);
  } else {
    // Fallback: local flow proxy (log-scaled)
    let maxFlow = 1;
    for (let i = 0; i < n * n; i++) {
      if (area[i] > maxFlow) maxFlow = area[i];
    }
    const logMaxFlow = Math.log2(maxFlow) || 1;
    for (let i = 0; i < n * n; i++) {
      data[i * 4 + 3] = Math.log2(area[i]) / logMaxFlow;
    }
  }

  // Create height texture (raw heights for water depth calculation)
  const heightData = new Float32Array(n * n);
  heightData.set(heights);
  const heightMap = new THREE.DataTexture(heightData, n, n, THREE.RedFormat, THREE.FloatType);
  heightMap.wrapS = THREE.ClampToEdgeWrapping;
  heightMap.wrapT = THREE.ClampToEdgeWrapping;
  heightMap.magFilter = THREE.LinearFilter;
  heightMap.minFilter = THREE.LinearFilter;
  heightMap.needsUpdate = true;

  // Create field texture
  const fieldMap = new THREE.DataTexture(data, n, n, THREE.RGBAFormat, THREE.FloatType);
  fieldMap.wrapS = THREE.ClampToEdgeWrapping;
  fieldMap.wrapT = THREE.ClampToEdgeWrapping;
  fieldMap.magFilter = THREE.LinearFilter;
  fieldMap.minFilter = THREE.LinearFilter;
  fieldMap.needsUpdate = true;

  console.log(`[fields] baked ${n}x${n} field texture (height range: ${minH.toFixed(1)} - ${maxH.toFixed(1)})`);

  // CPU-side sampler for scatter/foliage placement
  function sampleAt(wx: number, wz: number) {
    const gx = ((wx + extent) / (extent * 2)) * (n - 1);
    const gz = ((wz + extent) / (extent * 2)) * (n - 1);

    if (gx < 0 || gx >= n - 1 || gz < 0 || gz >= n - 1) {
      return { slope: 0, altitude: 0, curvature: 0, deposition: 0 };
    }

    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;

    // Bilinear interpolation of each channel
    const i00 = (iz * n + ix) * 4;
    const i10 = (iz * n + ix + 1) * 4;
    const i01 = ((iz + 1) * n + ix) * 4;
    const i11 = ((iz + 1) * n + ix + 1) * 4;

    function bilerp(ch: number) {
      return data[i00 + ch] * (1 - fx) * (1 - fz) +
             data[i10 + ch] * fx * (1 - fz) +
             data[i01 + ch] * (1 - fx) * fz +
             data[i11 + ch] * fx * fz;
    }

    return {
      slope: bilerp(0),
      altitude: bilerp(1),
      curvature: bilerp(2),
      deposition: bilerp(3),
    };
  }

  return {
    fieldMap,
    heightMap,
    extent,
    sampleAt,
    dispose: () => { fieldMap.dispose(); heightMap.dispose(); },
  };
}
