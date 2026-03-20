/**
 * Piedmont-specific diagnostics: centerline tracking, sinuosity, migration.
 *
 * Measures lateral channel migration at bend apexes,
 * sinuosity changes, and outer vs inner bank erosion.
 */

export interface CenterlinePoint {
  z: number;
  x: number;
}

/**
 * Extract the channel centerline by finding the lowest point per row
 * within a local search band centered on the previous row's position.
 * Uses a two-pass approach: first find the channel at each row independently
 * in a narrow band, then smooth along-channel.
 */
export function extractCenterline(
  grid: Float32Array, gridSize: number, extent: number,
  _bandHalfWidth = 60,
): CenterlinePoint[] {
  const cs = (extent * 2) / (gridSize - 1);

  // Phase 1: Per-row local minimum with narrow search from previous position
  // Seed from the grid center row, find the deepest trough in a ±30-cell band
  const midGz = Math.floor(gridSize / 2);
  const centerGx = Math.floor(gridSize / 2);

  // Find seed at mid row: deepest point within ±20 cells of grid center
  let seedGx = centerGx;
  let seedMinH = Infinity;
  for (let gx = Math.max(0, centerGx - 20); gx <= Math.min(gridSize - 1, centerGx + 20); gx++) {
    const h = grid[midGz * gridSize + gx];
    if (h < seedMinH) { seedMinH = h; seedGx = gx; }
  }

  // Build centerline by tracking from seed in both directions
  const gxPerRow = new Float64Array(gridSize);
  gxPerRow[midGz] = seedGx;

  // Track forward and backward
  for (const dir of [1, -1]) {
    let prevGx = seedGx;
    const start = midGz + dir;
    const end = dir === 1 ? gridSize - 3 : 3;
    for (let gz = start; dir === 1 ? gz < end : gz >= end; gz += dir) {
      // Search ±8 cells from previous position for the lowest point
      let bestGx = prevGx, bestH = Infinity;
      for (let gx = Math.max(0, Math.round(prevGx) - 8); gx <= Math.min(gridSize - 1, Math.round(prevGx) + 8); gx++) {
        const h = grid[gz * gridSize + gx];
        if (h < bestH) { bestH = h; bestGx = gx; }
      }
      gxPerRow[gz] = bestGx;
      prevGx = bestGx;
    }
  }

  // Phase 2: Smooth along z (7-point moving average)
  const smoothGx = new Float64Array(gridSize);
  const halfW = 3;
  for (let gz = 3; gz < gridSize - 3; gz++) {
    let sum = 0, count = 0;
    for (let j = gz - halfW; j <= gz + halfW; j++) {
      if (j >= 3 && j < gridSize - 3) { sum += gxPerRow[j]; count++; }
    }
    smoothGx[gz] = count > 0 ? sum / count : gxPerRow[gz];
  }

  // Convert to world coordinates
  const centerline: CenterlinePoint[] = [];
  for (let gz = 5; gz < gridSize - 5; gz++) {
    centerline.push({
      z: -extent + gz * cs,
      x: -extent + smoothGx[gz] * cs,
    });
  }

  return centerline;
}

/**
 * Compute sinuosity as path length / straight-line distance.
 */
export function computeSinuosity(centerline: CenterlinePoint[]): number {
  if (centerline.length < 2) return 1;

  let pathLength = 0;
  for (let i = 1; i < centerline.length; i++) {
    const dx = centerline[i].x - centerline[i - 1].x;
    const dz = centerline[i].z - centerline[i - 1].z;
    pathLength += Math.sqrt(dx * dx + dz * dz);
  }

  const first = centerline[0];
  const last = centerline[centerline.length - 1];
  const straightDist = Math.sqrt(
    (last.x - first.x) ** 2 + (last.z - first.z) ** 2,
  );

  return straightDist > 0 ? pathLength / straightDist : 1;
}

/**
 * Find centerline x at a specific z by interpolation.
 */
export function centerlineAtZ(centerline: CenterlinePoint[], z: number): number | null {
  for (let i = 0; i < centerline.length - 1; i++) {
    if (centerline[i].z <= z && centerline[i + 1].z >= z) {
      const t = (z - centerline[i].z) / (centerline[i + 1].z - centerline[i].z);
      return centerline[i].x + t * (centerline[i + 1].x - centerline[i].x);
    }
  }
  return null;
}

export interface PiedmontMetrics {
  sinuosityBefore: number;
  sinuosityAfter: number;
  sinuosityChange: number;
  /** Migration distance at fixed z-sections */
  migrations: {
    z: number;
    beforeX: number;
    afterX: number;
    migration: number;
  }[];
  /** Outer vs inner bank erosion at bend apexes */
  bankErosion: {
    z: number;
    outerErosion: number;
    innerErosion: number;
    ratio: number;
  }[];
}

/**
 * Compute piedmont-specific metrics.
 */
export function computePiedmontMetrics(
  initialGrid: Float32Array,
  finalGrid: Float32Array,
  gridSize: number,
  extent: number,
): PiedmontMetrics {
  const beforeCL = extractCenterline(initialGrid, gridSize, extent);
  const afterCL = extractCenterline(finalGrid, gridSize, extent);

  const sinBefore = computeSinuosity(beforeCL);
  const sinAfter = computeSinuosity(afterCL);

  // Migration at fixed z-sections
  const zSections = [-120, -40, 40, 120];
  const migrations = zSections.map(z => {
    const bx = centerlineAtZ(beforeCL, z);
    const ax = centerlineAtZ(afterCL, z);
    return {
      z,
      beforeX: bx ?? 0,
      afterX: ax ?? 0,
      migration: (bx !== null && ax !== null) ? ax - bx : 0,
    };
  });

  // Outer vs inner bank erosion at bend apexes
  // Find apexes from the INITIAL smoothed centerline (local extrema of x with min separation)
  const cs = (extent * 2) / (gridSize - 1);
  const bendApexes: { z: number; x: number; curvSign: number; idx: number }[] = [];

  // Use a wider window (15 points) to find robust bend apexes
  // H2.5e.3: Use second derivative of centerline x(z) for curvature sign
  // This aligns with the solver's signed curvature convention
  for (let i = 15; i < afterCL.length - 15; i++) {
    // Second derivative of x w.r.t. z (discrete curvature)
    const d2x = afterCL[i + 5].x - 2 * afterCL[i].x + afterCL[i - 5].x;
    const prevX = afterCL[i - 10].x;
    const currX = afterCL[i].x;
    const nextX = afterCL[i + 10].x;
    // Apex = local extremum of x with significant displacement
    const isMax = currX > prevX + 0.5 && currX > nextX + 0.5;
    const isMin = currX < prevX - 0.5 && currX < nextX - 0.5;
    if (isMax || isMin) {
      const tooClose = bendApexes.some(a => Math.abs(a.idx - i) < 20);
      if (!tooClose) {
        bendApexes.push({
          z: afterCL[i].z,
          x: currX,
          // curvSign from second derivative: positive d2x = concave right = outer bank is right
          curvSign: d2x > 0 ? 1 : -1,
          idx: i,
        });
      }
    }
  }

  // Take the 2 strongest bends by displacement from straight line
  bendApexes.sort((a, b) => Math.abs(b.x) - Math.abs(a.x));
  const topBends = bendApexes.slice(0, 2);

  const bankErosion = topBends.map(bend => {
    const gz = Math.round((bend.z + extent) / cs);
    if (gz < 5 || gz >= gridSize - 5) return { z: bend.z, outerErosion: 0, innerErosion: 0, ratio: 1 };

    const centerGx = Math.round((bend.x + extent) / cs);
    // H2.5e.3: Determine outer bank from the bend direction
    // For an S-curve, the outer bank of a rightward bend is on the right side (+x)
    // Use the sign of the centerline's second derivative (curvature) at this point
    // Approximate: if bend.x is to the right of neighbors → outer bank is right
    const outerDir = bend.curvSign;
    const bankDist = 6;

    const outerGx = Math.max(0, Math.min(gridSize - 1, centerGx + outerDir * bankDist));
    const innerGx = Math.max(0, Math.min(gridSize - 1, centerGx - outerDir * bankDist));

    const outerErosion = initialGrid[gz * gridSize + outerGx] - finalGrid[gz * gridSize + outerGx];
    const innerErosion = initialGrid[gz * gridSize + innerGx] - finalGrid[gz * gridSize + innerGx];

    return {
      z: bend.z,
      outerErosion: Math.max(0, outerErosion),
      innerErosion: Math.max(0, innerErosion),
      ratio: innerErosion > 0.01 ? outerErosion / innerErosion : outerErosion > 0 ? 99 : 1,
    };
  });

  return {
    sinuosityBefore: sinBefore,
    sinuosityAfter: sinAfter,
    sinuosityChange: (sinAfter - sinBefore) / sinBefore * 100,
    migrations,
    bankErosion,
  };
}

/**
 * Generate a centerline overlay image (initial = gray dashed, final = blue solid).
 * Returns base64 PNG.
 */
export function centerlineOverlayImage(
  initialGrid: Float32Array,
  finalGrid: Float32Array,
  gridSize: number,
  extent: number,
): string {
  const beforeCL = extractCenterline(initialGrid, gridSize, extent);
  const afterCL = extractCenterline(finalGrid, gridSize, extent);
  const cs = (extent * 2) / (gridSize - 1);

  const canvas = document.createElement('canvas');
  canvas.width = gridSize;
  canvas.height = gridSize;
  const ctx = canvas.getContext('2d')!;

  // Draw heightmap as background (grayscale from final grid)
  const img = ctx.createImageData(gridSize, gridSize);
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < finalGrid.length; i++) {
    if (finalGrid[i] < lo) lo = finalGrid[i];
    if (finalGrid[i] > hi) hi = finalGrid[i];
  }
  const range = Math.max(0.001, hi - lo);
  for (let i = 0; i < finalGrid.length; i++) {
    const v = Math.max(0, Math.min(255, ((finalGrid[i] - lo) / range) * 200 + 40));
    img.data[i * 4 + 0] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }
  ctx.putImageData(img, 0, 0);

  // Draw initial centerline (gray dashed)
  ctx.strokeStyle = 'rgba(200, 100, 100, 0.8)';
  ctx.lineWidth = 2;
  ctx.setLineDash([4, 3]);
  ctx.beginPath();
  for (let i = 0; i < beforeCL.length; i++) {
    const gx = (beforeCL[i].x + extent) / cs;
    const gz = (beforeCL[i].z + extent) / cs;
    if (i === 0) ctx.moveTo(gx, gz);
    else ctx.lineTo(gx, gz);
  }
  ctx.stroke();

  // Draw final centerline (blue solid)
  ctx.strokeStyle = 'rgba(50, 100, 255, 0.9)';
  ctx.lineWidth = 2;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let i = 0; i < afterCL.length; i++) {
    const gx = (afterCL[i].x + extent) / cs;
    const gz = (afterCL[i].z + extent) / cs;
    if (i === 0) ctx.moveTo(gx, gz);
    else ctx.lineTo(gx, gz);
  }
  ctx.stroke();

  return canvas.toDataURL('image/png').split(',')[1];
}
