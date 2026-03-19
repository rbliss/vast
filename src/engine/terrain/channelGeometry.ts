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
  minArea: 15,             // H2.1c: world-area units (m²), was 25 cell-count
  widthCoeff: 0.25,        // H2.1c: recalibrated for world-area A
  widthExponent: 0.48,
  depthCoeff: 0.06,        // H2.1c: recalibrated for world-area A
  depthExponent: 0.38,
  maxHalfWidth: 8,             // H2.1c.1: world units (m), was 10 cells
  bankSteepness: 0.45,
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
  resistance?: Float32Array,
  guidanceWidth?: Float32Array,
): void {
  const n = w * h;

  // Build channel centerline depth map: how much to lower the bed
  // and bank shaping radius at each channel cell
  const channelDepth = new Float32Array(n);
  const channelRadius = new Float32Array(n); // half-width in cells
  const channelArea = new Float32Array(n); // effective area for maturity calc

  // Compute channel properties from drainage area
  for (let i = 0; i < n; i++) {
    const a = area[i];
    // On resistant rock, require higher drainage area to initiate channels
    const R = resistance ? resistance[i] : 1.0;
    const effectiveMinArea = params.minArea / Math.max(0.1, R);
    if (a < effectiveMinArea) continue;

    // Hydraulic geometry scaling (reduced on resistant rock)
    const effectiveArea = a - effectiveMinArea;
    const widthWorld = params.widthCoeff * Math.pow(effectiveArea, params.widthExponent) * Math.sqrt(R);
    const depth = params.depthCoeff * Math.pow(effectiveArea, params.depthExponent) * R;

    const maxHalfWidthCells = params.maxHalfWidth / cellSize; // world→cells
    let halfWidthCells = Math.min(maxHalfWidthCells, widthWorld / cellSize);

    // AE3.4: Bias width toward AE-predicted valley width where guidance is strong
    if (guidanceWidth && guidanceWidth[i] > 0) {
      const guidedHalfWidthCells = guidanceWidth[i] / cellSize * 0.6; // 60% of AE width
      halfWidthCells = Math.max(halfWidthCells, guidedHalfWidthCells);
    }

    channelDepth[i] = depth;
    channelRadius[i] = halfWidthCells;
    channelArea[i] = effectiveArea;
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

      // Channel maturity: larger drainage area → more alluvial (flatter bed)
      const maturity = Math.min(1.0, Math.log2(Math.max(1, channelArea[idx])) / 10);
      // bedFraction: how much of the channel width is flat bed (0 = V-shape, 0.5 = half is flat)
      const bedFraction = maturity * 0.45;

      // Carve cross-section along the perpendicular
      const iRadius = Math.ceil(radius);
      for (let di = -iRadius; di <= iRadius; di++) {
        const nx = Math.round(x + px * di);
        const nz = Math.round(z + pz * di);
        if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;

        const dist = Math.abs(di);
        if (dist > radius) continue;

        const t = dist / radius; // 0 = center, 1 = bank edge

        // Geomorphic cross-section profile:
        // - Flat alluvial bed zone (width scales with maturity)
        // - Steep bank break above the bed
        // - Gradual valley-side slope above banks
        let profile: number;
        if (t < bedFraction) {
          // Flat bed zone — nearly no height change
          profile = 0;
        } else if (t < bedFraction + 0.15) {
          // Bank break — steep transition from bed to valley side
          const bankT = (t - bedFraction) / 0.15;
          profile = bankT * bankT * 0.6; // steep bank
        } else {
          // Valley side — gradual slope to surrounding terrain
          const sideT = (t - bedFraction - 0.15) / Math.max(0.01, 1 - bedFraction - 0.15);
          profile = 0.6 + sideT * 0.4; // gradual rise
        }

        const carveAmount = depth * (1 - profile);

        const ni = nz * w + nx;
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
