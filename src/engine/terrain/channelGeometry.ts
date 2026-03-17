/**
 * Channel geometry pass.
 *
 * Post-erosion pass that shapes channels based on drainage area:
 *   - Headwaters: narrow V-shaped incision
 *   - Mid-reaches: moderate width with defined banks
 *   - Downstream: broader valleys/floodplains
 *
 * Width and depth scale with drainage area following empirical
 * hydraulic geometry relationships (w ∝ A^b, d ∝ A^c).
 */

export interface ChannelGeometryParams {
  /** Minimum drainage area to qualify as a channel */
  minArea: number;
  /** Width scaling coefficient (world units at unit area) */
  widthCoeff: number;
  /** Width area exponent (typically 0.4-0.5) */
  widthExponent: number;
  /** Depth scaling coefficient */
  depthCoeff: number;
  /** Depth area exponent (typically 0.3-0.4) */
  depthExponent: number;
  /** Maximum channel half-width in cells */
  maxHalfWidth: number;
  /** Bank steepness: 0 = flat banks (U-shape), 1 = steep banks (V-shape) */
  bankSteepness: number;
}

export const DEFAULT_CHANNEL_PARAMS: ChannelGeometryParams = {
  minArea: 30,
  widthCoeff: 0.6,
  widthExponent: 0.45,
  depthCoeff: 0.15,
  depthExponent: 0.35,
  maxHalfWidth: 8,
  bankSteepness: 0.5,
};

/**
 * Apply channel geometry shaping to the height grid.
 *
 * For each cell with sufficient drainage area, carve a cross-section
 * profile that widens with drainage area. This creates readable
 * stream corridors instead of thin incision scratches.
 */
export function applyChannelGeometry(
  grid: Float32Array,
  area: Float32Array,
  receiver: Int32Array,
  w: number, h: number,
  cellSize: number,
  params: ChannelGeometryParams = DEFAULT_CHANNEL_PARAMS,
): void {
  const n = w * h;

  // Build channel centerline depth map: how much to lower the bed
  // and bank shaping radius at each channel cell
  const channelDepth = new Float32Array(n);
  const channelRadius = new Float32Array(n); // half-width in cells

  // Compute channel properties from drainage area
  for (let i = 0; i < n; i++) {
    const a = area[i];
    if (a < params.minArea) continue;

    // Hydraulic geometry scaling
    const effectiveArea = a - params.minArea;
    const widthWorld = params.widthCoeff * Math.pow(effectiveArea, params.widthExponent);
    const depth = params.depthCoeff * Math.pow(effectiveArea, params.depthExponent);

    const halfWidthCells = Math.min(params.maxHalfWidth, widthWorld / cellSize);

    channelDepth[i] = depth;
    channelRadius[i] = halfWidthCells;
  }

  // Apply channel cross-sections
  // For each channel cell, carve a profile centered on the channel
  // Use flow direction to determine channel orientation
  const carveMap = new Float32Array(n); // accumulated carving depth

  for (let z = 2; z < h - 2; z++) {
    for (let x = 2; x < w - 2; x++) {
      const idx = z * w + x;
      const depth = channelDepth[idx];
      const radius = channelRadius[idx];

      if (depth <= 0 || radius < 0.5) continue;

      // Determine channel direction from receiver
      const recv = receiver[idx];
      if (recv < 0) continue;

      const rx = recv % w;
      const rz = (recv - rx) / w;
      // Flow direction vector
      const fdx = rx - x;
      const fdz = rz - z;
      const flen = Math.sqrt(fdx * fdx + fdz * fdz) || 1;
      // Perpendicular direction (bank direction)
      const px = -fdz / flen;
      const pz = fdx / flen;

      // Carve cross-section along the perpendicular
      const iRadius = Math.ceil(radius);
      for (let di = -iRadius; di <= iRadius; di++) {
        const nx = Math.round(x + px * di);
        const nz = Math.round(z + pz * di);
        if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;

        const dist = Math.abs(di);
        if (dist > radius) continue;

        // Cross-section profile
        const t = dist / radius; // 0 = center, 1 = bank edge

        // Blend between U-shape (flat bed + steep banks) and V-shape
        // U-shape: flat center with steep bank rise
        // V-shape: linear rise from center
        const uProfile = t < 0.3 ? 0 : (t - 0.3) / 0.7; // flat center, steep bank
        const vProfile = t; // linear
        const profile = uProfile * (1 - params.bankSteepness) + vProfile * params.bankSteepness;

        const carveAmount = depth * (1 - profile * profile); // parabolic fade

        const ni = nz * w + nx;
        // Take the maximum carving from any overlapping channel
        if (carveAmount > carveMap[ni]) {
          carveMap[ni] = carveAmount;
        }
      }
    }
  }

  // Apply carving
  for (let i = 0; i < n; i++) {
    if (carveMap[i] > 0) {
      grid[i] -= carveMap[i];
      if (grid[i] < 0) grid[i] = 0;
    }
  }

  // Count channels for logging
  let channelCells = 0;
  for (let i = 0; i < n; i++) {
    if (channelDepth[i] > 0) channelCells++;
  }
  console.log(`[channel] shaped ${channelCells} channel cells (minArea=${params.minArea})`);
}
