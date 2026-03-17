/**
 * Derived terrain analysis maps.
 *
 * CPU reference implementation. Generates slope, curvature, and local
 * flow proxy from a TerrainSource over a padded tile region.
 *
 * Slope and curvature use halo padding for chunk-boundary-safe
 * finite differences. Flow is a LOCAL per-chunk D8 proxy — it
 * captures drainage tendency within a single chunk but does not
 * accumulate across chunk boundaries. True global flow accumulation
 * would require cross-chunk routing over the full terrain extent.
 */

import type { TerrainSource } from './terrainSource';

// ── Types ──

export interface DerivedMaps {
  /** Slope magnitude (0 = flat, 1+ = steep). Same grid as input. */
  slope: Float32Array;
  /** Mean curvature approximation (negative = concave/valley, positive = convex/ridge). */
  curvature: Float32Array;
  /** Local flow proxy (per-chunk D8 routing — captures drainage tendency, not global accumulation). */
  flow: Float32Array;
  /** Grid dimensions (without halo) */
  width: number;
  height: number;
}

export interface TileRegion {
  /** World-space origin of the tile (top-left corner) */
  originX: number;
  originZ: number;
  /** Cell spacing in world units */
  cellSize: number;
  /** Grid dimensions (number of cells, not including halo) */
  gridW: number;
  gridH: number;
}

// ── Constants ──

/** Halo cells on each side for finite differences and flow routing */
const HALO = 2;

// ── Height sampling ──

/**
 * Sample a padded height grid from the terrain source.
 * Returns (gridW + 2*HALO) x (gridH + 2*HALO) float array.
 */
function sampleHeightGrid(
  terrain: TerrainSource,
  region: TileRegion,
): { data: Float32Array; padW: number; padH: number } {
  const padW = region.gridW + 2 * HALO;
  const padH = region.gridH + 2 * HALO;
  const data = new Float32Array(padW * padH);

  for (let pz = 0; pz < padH; pz++) {
    for (let px = 0; px < padW; px++) {
      const wx = region.originX + (px - HALO) * region.cellSize;
      const wz = region.originZ + (pz - HALO) * region.cellSize;
      data[pz * padW + px] = terrain.sampleHeight(wx, wz);
    }
  }

  return { data, padW, padH };
}

// ── Slope ──

/**
 * Compute slope magnitude from finite differences.
 * Uses central differences with 1-cell spacing.
 */
function computeSlope(
  heights: Float32Array, padW: number, padH: number,
  cellSize: number, gridW: number, gridH: number,
): Float32Array {
  const slope = new Float32Array(gridW * gridH);

  for (let gz = 0; gz < gridH; gz++) {
    for (let gx = 0; gx < gridW; gx++) {
      const px = gx + HALO;
      const pz = gz + HALO;

      // Central differences
      const hL = heights[pz * padW + (px - 1)];
      const hR = heights[pz * padW + (px + 1)];
      const hU = heights[(pz - 1) * padW + px];
      const hD = heights[(pz + 1) * padW + px];

      const dhdx = (hR - hL) / (2 * cellSize);
      const dhdz = (hD - hU) / (2 * cellSize);

      slope[gz * gridW + gx] = Math.sqrt(dhdx * dhdx + dhdz * dhdz);
    }
  }

  return slope;
}

// ── Curvature ──

/**
 * Compute mean curvature (Laplacian-based approximation).
 * Positive = convex (ridge/hilltop), negative = concave (valley/depression).
 */
function computeCurvature(
  heights: Float32Array, padW: number, padH: number,
  cellSize: number, gridW: number, gridH: number,
): Float32Array {
  const curvature = new Float32Array(gridW * gridH);
  const cs2 = cellSize * cellSize;

  for (let gz = 0; gz < gridH; gz++) {
    for (let gx = 0; gx < gridW; gx++) {
      const px = gx + HALO;
      const pz = gz + HALO;

      const hC = heights[pz * padW + px];
      const hL = heights[pz * padW + (px - 1)];
      const hR = heights[pz * padW + (px + 1)];
      const hU = heights[(pz - 1) * padW + px];
      const hD = heights[(pz + 1) * padW + px];

      // Laplacian = d²h/dx² + d²h/dz²
      const d2x = (hR - 2 * hC + hL) / cs2;
      const d2z = (hD - 2 * hC + hU) / cs2;

      curvature[gz * gridW + gx] = d2x + d2z;
    }
  }

  return curvature;
}

// ── Local flow proxy (D8) ──

/**
 * Compute local flow proxy using D8 single-flow-direction routing.
 * Each cell routes all flow to its steepest downhill neighbor.
 *
 * This is a PER-CHUNK computation — it does not route across chunk
 * boundaries, so it captures local drainage tendency but underestimates
 * accumulation for cells near chunk edges. Adequate for visualization
 * and as an erosion input signal, but not a globally correct flow map.
 */
function computeFlow(
  heights: Float32Array, padW: number, padH: number,
  gridW: number, gridH: number, cellSize: number,
): Float32Array {
  const n = gridW * gridH;
  const flow = new Float32Array(n);
  flow.fill(1); // Each cell contributes 1 unit of "rainfall"

  // D8 neighbor offsets (dx, dz)
  const d8 = [
    [-1, -1], [0, -1], [1, -1],
    [-1,  0],          [1,  0],
    [-1,  1], [0,  1], [1,  1],
  ];
  const d8Dist = [
    Math.SQRT2, 1, Math.SQRT2,
    1,             1,
    Math.SQRT2, 1, Math.SQRT2,
  ];

  // Build sorted cell list by height (descending) for topological ordering
  const indices = new Uint32Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;

  // Get height for grid cell from padded array
  const gridHeight = (idx: number) => {
    const gx = idx % gridW;
    const gz = (idx - gx) / gridW;
    return heights[(gz + HALO) * padW + (gx + HALO)];
  };

  indices.sort((a, b) => gridHeight(b) - gridHeight(a));

  // Route flow downhill
  for (let i = 0; i < n; i++) {
    const idx = indices[i];
    const gx = idx % gridW;
    const gz = (idx - gx) / gridW;
    const px = gx + HALO;
    const pz = gz + HALO;
    const hC = heights[pz * padW + px];

    // Find steepest downhill neighbor
    let bestSlope = 0;
    let bestNeighbor = -1;

    for (let d = 0; d < 8; d++) {
      const nx = gx + d8[d][0];
      const nz = gz + d8[d][1];
      if (nx < 0 || nx >= gridW || nz < 0 || nz >= gridH) continue;

      const npx = nx + HALO;
      const npz = nz + HALO;
      const hN = heights[npz * padW + npx];
      const drop = (hC - hN) / (d8Dist[d] * cellSize);

      if (drop > bestSlope) {
        bestSlope = drop;
        bestNeighbor = nz * gridW + nx;
      }
    }

    // Route this cell's accumulated flow to the steepest neighbor
    if (bestNeighbor >= 0) {
      flow[bestNeighbor] += flow[idx];
    }
  }

  return flow;
}

// ── Public API ──

/**
 * Generate all derived maps for a tile region.
 * CPU reference implementation — deterministic and chunk-boundary safe.
 */
export function generateDerivedMaps(
  terrain: TerrainSource,
  region: TileRegion,
): DerivedMaps {
  const { data: heights, padW, padH } = sampleHeightGrid(terrain, region);
  const { gridW, gridH, cellSize } = region;

  return {
    slope: computeSlope(heights, padW, padH, cellSize, gridW, gridH),
    curvature: computeCurvature(heights, padW, padH, cellSize, gridW, gridH),
    flow: computeFlow(heights, padW, padH, gridW, gridH, cellSize),
    width: gridW,
    height: gridH,
  };
}

// ── Visualization helpers ──

/** Map slope to a color: green (flat) → red (steep) */
export function slopeToColor(slope: number): [number, number, number] {
  const t = Math.min(1, slope / 3);
  return [t, 1 - t, 0];
}

/** Map curvature to a color: blue (concave/valley) → white (flat) → red (convex/ridge) */
export function curvatureToColor(curvature: number): [number, number, number] {
  const t = Math.max(-1, Math.min(1, curvature * 50));
  if (t > 0) return [1, 1 - t, 1 - t]; // red = ridge
  return [1 + t, 1 + t, 1]; // blue = valley
}

/** Map local flow proxy to a color: white (low) → blue (high), log scale */
export function flowToColor(flow: number): [number, number, number] {
  const t = Math.min(1, Math.log2(flow) / 12);
  return [1 - t * 0.8, 1 - t * 0.8, 1];
}
