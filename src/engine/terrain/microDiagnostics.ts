/**
 * Micro-benchmark diagnostics: direct grid-level evidence.
 *
 * Generates heightmap images, difference heatmaps, cross-section plots,
 * and proper canyon metrics — all from raw Float32Array grids,
 * bypassing the 3D renderer entirely.
 */

// ── Heightmap rendering ──

/**
 * Render a height grid as a grayscale PNG image (base64).
 * Normalizes to [0, 255] using provided or auto-detected range.
 */
export function gridToGrayscale(
  grid: Float32Array, w: number, h: number,
  minH?: number, maxH?: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);

  let lo = minH ?? Infinity, hi = maxH ?? -Infinity;
  if (minH === undefined || maxH === undefined) {
    for (let i = 0; i < grid.length; i++) {
      if (grid[i] < lo) lo = grid[i];
      if (grid[i] > hi) hi = grid[i];
    }
  }
  const range = Math.max(0.001, hi - lo);

  for (let i = 0; i < grid.length; i++) {
    const v = Math.max(0, Math.min(255, ((grid[i] - lo) / range) * 255));
    img.data[i * 4 + 0] = v;
    img.data[i * 4 + 1] = v;
    img.data[i * 4 + 2] = v;
    img.data[i * 4 + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1]; // base64 without prefix
}

/**
 * Render a difference grid as a blue-white-red heatmap PNG (base64).
 * Blue = lowered (erosion), Red = raised (deposition), White = no change.
 */
export function diffToHeatmap(
  initial: Float32Array, final: Float32Array,
  w: number, h: number,
  maxDelta?: number,
): string {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(w, h);

  // Auto-detect max delta if not provided
  let maxD = maxDelta ?? 0;
  if (!maxDelta) {
    for (let i = 0; i < initial.length; i++) {
      const d = Math.abs(final[i] - initial[i]);
      if (d > maxD) maxD = d;
    }
  }
  maxD = Math.max(0.001, maxD);

  for (let i = 0; i < initial.length; i++) {
    const delta = final[i] - initial[i];
    const t = Math.max(-1, Math.min(1, delta / maxD)); // [-1, 1]

    let r: number, g: number, b: number;
    if (t < 0) {
      // Erosion: white → blue
      const s = -t;
      r = Math.round(255 * (1 - s));
      g = Math.round(255 * (1 - s));
      b = 255;
    } else {
      // Deposition: white → red
      const s = t;
      r = 255;
      g = Math.round(255 * (1 - s));
      b = Math.round(255 * (1 - s));
    }

    img.data[i * 4 + 0] = r;
    img.data[i * 4 + 1] = g;
    img.data[i * 4 + 2] = b;
    img.data[i * 4 + 3] = 255;
  }

  ctx.putImageData(img, 0, 0);
  return canvas.toDataURL('image/png').split(',')[1];
}

// ── Cross-section extraction ──

export interface CrossSection {
  z: number;
  points: { x: number; h: number }[];
}

/**
 * Extract a cross-section at a given world z-coordinate.
 */
export function extractCrossSection(
  grid: Float32Array, gridSize: number, extent: number, wz: number,
): CrossSection {
  const cs = (extent * 2) / (gridSize - 1);
  const gz = Math.round((wz + extent) / cs);
  const clampedGz = Math.max(0, Math.min(gridSize - 1, gz));
  const points: { x: number; h: number }[] = [];
  for (let gx = 0; gx < gridSize; gx++) {
    const wx = -extent + gx * cs;
    points.push({ x: wx, h: grid[clampedGz * gridSize + gx] });
  }
  return { z: wz, points };
}

/**
 * Render cross-sections as an SVG string (before + after overlay).
 */
export function crossSectionsToSvg(
  before: CrossSection, after: CrossSection,
  width = 800, height = 300,
): string {
  const allH = [...before.points.map(p => p.h), ...after.points.map(p => p.h)];
  const minH = Math.min(...allH);
  const maxH = Math.max(...allH);
  const hRange = Math.max(0.1, maxH - minH);

  const xMin = before.points[0].x;
  const xMax = before.points[before.points.length - 1].x;
  const xRange = xMax - xMin;

  const margin = 40;
  const plotW = width - margin * 2;
  const plotH = height - margin * 2;

  const toSvgX = (x: number) => margin + ((x - xMin) / xRange) * plotW;
  const toSvgY = (h: number) => margin + plotH - ((h - minH) / hRange) * plotH;

  const beforePath = before.points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${toSvgX(p.x).toFixed(1)},${toSvgY(p.h).toFixed(1)}`
  ).join(' ');

  const afterPath = after.points.map((p, i) =>
    `${i === 0 ? 'M' : 'L'}${toSvgX(p.x).toFixed(1)},${toSvgY(p.h).toFixed(1)}`
  ).join(' ');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" style="background:#fff">
  <text x="${width / 2}" y="15" text-anchor="middle" font-size="12" fill="#333">z=${before.z}</text>
  <path d="${beforePath}" fill="none" stroke="#888" stroke-width="1.5" stroke-dasharray="4,2"/>
  <path d="${afterPath}" fill="none" stroke="#2244cc" stroke-width="2"/>
  <text x="${margin}" y="${height - 5}" font-size="10" fill="#888">gray dashed=initial, blue=final</text>
  <line x1="${margin}" y1="${margin}" x2="${margin}" y2="${margin + plotH}" stroke="#ccc"/>
  <line x1="${margin}" y1="${margin + plotH}" x2="${margin + plotW}" y2="${margin + plotH}" stroke="#ccc"/>
  <text x="${margin - 5}" y="${margin + 4}" text-anchor="end" font-size="9" fill="#666">${maxH.toFixed(0)}</text>
  <text x="${margin - 5}" y="${margin + plotH + 4}" text-anchor="end" font-size="9" fill="#666">${minH.toFixed(0)}</text>
</svg>`;
}

// ── Proper canyon metrics ──

export interface CanyonMetrics {
  /** z-sections with before/after comparison */
  sections: {
    z: number;
    before: { depth: number; canyonWidth: number; bedWidth: number; centerX: number };
    after: { depth: number; canyonWidth: number; bedWidth: number; centerX: number };
    deltaDepth: number;
    deltaCanyonWidth: number;
  }[];
  /** Headcut retreat: how far the canyon has advanced into the plateau beyond the initial rim */
  headcutRetreatDistance: number;
  /** Bank asymmetry at the escarpment face */
  bankAsymmetry: { leftRimDist: number; rightRimDist: number; ratio: number };
}

/**
 * Measure a single cross-section's canyon geometry.
 *
 * Default mode: finds the deepest point in the center 60%, then searches
 * outward to find actual bank-top/rim shoulders.
 *
 * Detrended mode (`detrended: true`): fits a linear baseline from the
 * far-left and far-right edges of the cross-section, subtracts it, then
 * measures bed depth below baseline.  Width is reported at two thresholds:
 *   - `canyonWidth` — at 50% of detrended depth
 *   - `bedWidth`    — at 25% of detrended depth (narrower, near the bed)
 *
 * This is robust on sloped terrain where rim-shoulder detection fails.
 */
function measureCanyon(
  cs: CrossSection,
  detrended = false,
): { depth: number; canyonWidth: number; bedWidth: number; centerX: number; leftRimX: number; rightRimX: number } {
  const pts = cs.points;

  if (detrended) {
    // ── Detrended mode ──
    // Fit baseline from far-left and far-right edge averages (use outer 5%)
    const edgeN = Math.max(1, Math.floor(pts.length * 0.05));
    let leftSum = 0, rightSum = 0;
    for (let i = 0; i < edgeN; i++) leftSum += pts[i].h;
    for (let i = pts.length - edgeN; i < pts.length; i++) rightSum += pts[i].h;
    const leftH = leftSum / edgeN;
    const rightH = rightSum / edgeN;
    const leftX = pts[0].x;
    const rightX = pts[pts.length - 1].x;
    const xRange = rightX - leftX;
    // baseline(x) = leftH + (rightH - leftH) * (x - leftX) / xRange
    const slope = xRange > 0 ? (rightH - leftH) / xRange : 0;

    // Subtract baseline to get detrended heights
    const det: number[] = new Array(pts.length);
    for (let i = 0; i < pts.length; i++) {
      const baseline = leftH + slope * (pts[i].x - leftX);
      det[i] = pts[i].h - baseline; // negative = below baseline
    }

    // Find deepest point (most negative detrended value)
    let minDet = Infinity, minIdx = 0;
    for (let i = 0; i < det.length; i++) {
      if (det[i] < minDet) { minDet = det[i]; minIdx = i; }
    }
    const depth = -minDet; // positive depth below baseline
    const centerX = pts[minIdx].x;

    // Width at a given fraction of depth: find leftmost and rightmost crossings
    const widthAtFraction = (frac: number): { left: number; right: number } => {
      const threshold = -depth * frac; // detrended threshold (negative)
      let left = pts[minIdx].x;
      let right = pts[minIdx].x;
      // Scan left from min
      for (let i = minIdx; i >= 0; i--) {
        if (det[i] >= threshold) {
          // Interpolate between i and i+1
          if (i < minIdx && i + 1 < pts.length) {
            const t = (threshold - det[i]) / (det[i + 1] - det[i]);
            left = pts[i].x + t * (pts[i + 1].x - pts[i].x);
          } else {
            left = pts[i].x;
          }
          break;
        }
        left = pts[i].x;
      }
      // Scan right from min
      for (let i = minIdx; i < pts.length; i++) {
        if (det[i] >= threshold) {
          if (i > minIdx && i - 1 >= 0) {
            const t = (threshold - det[i]) / (det[i - 1] - det[i]);
            right = pts[i].x + t * (pts[i - 1].x - pts[i].x);
          } else {
            right = pts[i].x;
          }
          break;
        }
        right = pts[i].x;
      }
      return { left, right };
    };

    const w50 = widthAtFraction(0.5); // canyon width at 50% depth
    const w25 = widthAtFraction(0.25); // bed width at 25% depth

    return {
      depth,
      canyonWidth: w50.right - w50.left,
      bedWidth: w25.right - w25.left,
      centerX,
      leftRimX: w50.left,
      rightRimX: w50.right,
    };
  }

  // ── Default (rim-shoulder) mode ──
  const margin = Math.floor(pts.length * 0.2);
  const center = pts.slice(margin, pts.length - margin);

  // Find deepest point
  let minH = Infinity, minIdx = 0;
  for (let i = 0; i < center.length; i++) {
    if (center[i].h < minH) { minH = center[i].h; minIdx = i; }
  }
  const centerX = center[minIdx].x;
  const absMinIdx = margin + minIdx;

  // Search outward from canyon center to find rim shoulders (local maxima)
  // Left rim: search leftward from canyon center
  let leftRimH = minH, leftRimX = center[0].x;
  for (let i = absMinIdx - 1; i >= 0; i--) {
    if (pts[i].h > leftRimH) {
      leftRimH = pts[i].h;
      leftRimX = pts[i].x;
    }
    // Stop if we start descending again (found the rim peak)
    if (pts[i].h < leftRimH - 0.5 && leftRimH > minH + 1) break;
  }

  // Right rim: search rightward from canyon center
  let rightRimH = minH, rightRimX = center[center.length - 1].x;
  for (let i = absMinIdx + 1; i < pts.length; i++) {
    if (pts[i].h > rightRimH) {
      rightRimH = pts[i].h;
      rightRimX = pts[i].x;
    }
    if (pts[i].h < rightRimH - 0.5 && rightRimH > minH + 1) break;
  }

  const rimH = Math.min(leftRimH, rightRimH); // use lower rim for depth
  const depth = rimH - minH;
  const canyonWidth = rightRimX - leftRimX;

  // In rim-shoulder mode, bedWidth defaults to canyonWidth (no detrended narrowing info)
  return { depth, canyonWidth, bedWidth: canyonWidth, centerX, leftRimX, rightRimX };
}

/**
 * Compute full canyon metrics comparing initial and final grids.
 * When `detrended` is true, uses baseline-subtraction instead of rim-shoulder detection.
 */
export function computeCanyonMetrics(
  initial: Float32Array, final: Float32Array,
  gridSize: number, extent: number,
  customZSections?: number[],
  detrended = false,
): CanyonMetrics {
  const zSections = customZSections ?? [-30, -15, 0];
  const sections = zSections.map(z => {
    const beforeCS = extractCrossSection(initial, gridSize, extent, z);
    const afterCS = extractCrossSection(final, gridSize, extent, z);
    const before = measureCanyon(beforeCS, detrended);
    const after = measureCanyon(afterCS, detrended);
    return {
      z,
      before: { depth: before.depth, canyonWidth: before.canyonWidth, bedWidth: before.bedWidth, centerX: before.centerX },
      after: { depth: after.depth, canyonWidth: after.canyonWidth, bedWidth: after.bedWidth, centerX: after.centerX },
      deltaDepth: after.depth - before.depth,
      deltaCanyonWidth: after.canyonWidth - before.canyonWidth,
    };
  });

  // Headcut retreat: compare initial vs final depth near the rim (z ~ -20)
  // Scan from the initial rim position inward (-z direction)
  // The rim is at approximately z=-20 in the single-notch terrain
  const cs = (extent * 2) / (gridSize - 1);
  const rimZ = -20; // approximate initial escarpment position
  let retreatDistance = 0;

  for (let gz = Math.round((rimZ + extent) / cs); gz >= 0; gz--) {
    const wz = -extent + gz * cs;
    // Compare initial vs final depth in a narrow band around x=0
    let initMin = Infinity, initMax = -Infinity;
    let finalMin = Infinity, finalMax = -Infinity;
    const halfBand = Math.floor(gridSize * 0.1); // ±10% of grid
    const cx = Math.floor(gridSize / 2);
    for (let gx = cx - halfBand; gx <= cx + halfBand; gx++) {
      if (gx < 0 || gx >= gridSize) continue;
      const idx = gz * gridSize + gx;
      const ih = initial[idx];
      const fh = final[idx];
      if (ih < initMin) initMin = ih;
      if (ih > initMax) initMax = ih;
      if (fh < finalMin) finalMin = fh;
      if (fh > finalMax) finalMax = fh;
    }
    const initDepth = initMax - initMin;
    const finalDepth = finalMax - finalMin;
    // Canyon has retreated to here if final depth exceeds initial by >2 units
    if (finalDepth - initDepth > 2) {
      retreatDistance = rimZ - wz;
    } else {
      break; // no more retreat beyond this point
    }
  }

  // Bank asymmetry at z=-15 (escarpment face)
  const faceCS = extractCrossSection(final, gridSize, extent, -15);
  const faceM = measureCanyon(faceCS, detrended);
  const leftDist = Math.abs(faceM.centerX - faceM.leftRimX);
  const rightDist = Math.abs(faceM.rightRimX - faceM.centerX);
  const asymRatio = leftDist / Math.max(0.1, rightDist);

  return {
    sections,
    headcutRetreatDistance: retreatDistance,
    bankAsymmetry: { leftRimDist: leftDist, rightRimDist: rightDist, ratio: asymRatio },
  };
}

// ── Upload helper ──

/**
 * Upload a base64 image to the API server with a label.
 */
export async function uploadDiagnostic(
  base64: string, label: string, format: 'png' | 'svg' = 'png',
): Promise<void> {
  try {
    await fetch('/api/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: base64, label, format, metadata: { type: 'micro-diagnostic' } }),
    });
    console.log(`[diag] uploaded: ${label}`);
  } catch (err) {
    console.warn(`[diag] upload failed for ${label}:`, err);
  }
}

/**
 * Run full micro diagnostics: heightmaps, heatmaps, cross-sections, metrics.
 * Uploads all artifacts to the API server and saves metrics to window.
 */
export interface PerNotchMetrics {
  z: number;
  left: { depth: number; bed: number };
  right: { depth: number; bed: number };
  divideH: number;
  divideAboveLeft: number;
  divideAboveRight: number;
}

export async function runMicroDiagnostics(
  initialGrid: Float32Array,
  stageGrids: Map<string, Float32Array>,
  finalGrid: Float32Array,
  gridSize: number,
  extent: number,
  label: string,
  zSections?: number[],
  detrended = false,
  provenanceField?: Float32Array,
  notchCenters?: { leftX: number; rightX: number; divideX: number },
): Promise<CanyonMetrics> {
  // Shared height range for all heightmaps (consistent coloring)
  let globalMin = Infinity, globalMax = -Infinity;
  for (let i = 0; i < initialGrid.length; i++) {
    if (initialGrid[i] < globalMin) globalMin = initialGrid[i];
    if (initialGrid[i] > globalMax) globalMax = initialGrid[i];
  }
  for (let i = 0; i < finalGrid.length; i++) {
    if (finalGrid[i] < globalMin) globalMin = finalGrid[i];
    if (finalGrid[i] > globalMax) globalMax = finalGrid[i];
  }

  // 1. Heightmap per stage
  const allStages = new Map<string, Float32Array>();
  allStages.set('initial', initialGrid);
  for (const [k, v] of stageGrids) allStages.set(k, v);
  allStages.set('final', finalGrid);

  const uploads: Promise<void>[] = [];

  for (const [stage, grid] of allStages) {
    const heightmap = gridToGrayscale(grid, gridSize, gridSize, globalMin, globalMax);
    uploads.push(uploadDiagnostic(heightmap, `${label}-heightmap-${stage}`));

    // 2. Difference heatmap (skip for initial)
    if (stage !== 'initial') {
      const heatmap = diffToHeatmap(initialGrid, grid, gridSize, gridSize);
      uploads.push(uploadDiagnostic(heatmap, `${label}-diff-${stage}`));
    }
  }

  // 3. Cross-section SVGs
  const diagZSections = zSections ?? [-30, -15, 0];
  for (const z of diagZSections) {
    const beforeCS = extractCrossSection(initialGrid, gridSize, extent, z);
    const afterCS = extractCrossSection(finalGrid, gridSize, extent, z);
    const svg = crossSectionsToSvg(beforeCS, afterCS);
    const svgBase64 = btoa(svg);
    uploads.push(uploadDiagnostic(svgBase64, `${label}-xsection-z${z}`, 'svg'));
  }

  // 3b. Provenance heatmap (if available)
  if (provenanceField && provenanceField.length === gridSize * gridSize) {
    const canvas = document.createElement('canvas');
    canvas.width = gridSize;
    canvas.height = gridSize;
    const ctx = canvas.getContext('2d')!;
    const img = ctx.createImageData(gridSize, gridSize);
    for (let i = 0; i < provenanceField.length; i++) {
      const p = provenanceField[i];
      // Red = right system (p≈0), Blue = left system (p≈1), White = balanced divide (p≈0.5)
      const balance = 1 - 2 * Math.abs(p - 0.5); // 0 at extremes, 1 at 0.5
      img.data[i * 4 + 0] = Math.round(255 * (1 - p) * (1 - balance * 0.5)); // red for right
      img.data[i * 4 + 1] = Math.round(255 * balance); // green for divide
      img.data[i * 4 + 2] = Math.round(255 * p * (1 - balance * 0.5)); // blue for left
      img.data[i * 4 + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);
    const provBase64 = canvas.toDataURL('image/png').split(',')[1];
    uploads.push(uploadDiagnostic(provBase64, `${label}-provenance`));
  }

  // Wait for all uploads
  await Promise.all(uploads);

  // 4. Compute proper metrics
  const metrics = computeCanyonMetrics(initialGrid, finalGrid, gridSize, extent, diagZSections, detrended);

  console.log(`[micro-metrics] ${label}:`);
  for (const s of metrics.sections) {
    const wdRatio = s.after.depth > 0 ? (s.after.canyonWidth / s.after.depth) : 0;
    console.log(`  z=${s.z}: depth ${s.before.depth.toFixed(1)} → ${s.after.depth.toFixed(1)} (Δ${s.deltaDepth.toFixed(1)}), width ${s.before.canyonWidth.toFixed(1)} → ${s.after.canyonWidth.toFixed(1)} (Δ${s.deltaCanyonWidth.toFixed(1)}), bedWidth ${s.after.bedWidth.toFixed(1)}, w/d ratio ${wdRatio.toFixed(2)}`);
  }
  console.log(`  headcut retreat: ${metrics.headcutRetreatDistance.toFixed(1)} units from rim`);
  console.log(`  bank asymmetry: L=${metrics.bankAsymmetry.leftRimDist.toFixed(1)} R=${metrics.bankAsymmetry.rightRimDist.toFixed(1)} ratio=${metrics.bankAsymmetry.ratio.toFixed(2)}`);

  // 5. Persist metrics as JSON artifact
  const metricsJson = JSON.stringify({
    label,
    timestamp: new Date().toISOString(),
    sections: metrics.sections.map(s => ({
      z: s.z,
      before: { depth: +s.before.depth.toFixed(1), canyonWidth: +s.before.canyonWidth.toFixed(1), bedWidth: +s.before.bedWidth.toFixed(1) },
      after: { depth: +s.after.depth.toFixed(1), canyonWidth: +s.after.canyonWidth.toFixed(1), bedWidth: +s.after.bedWidth.toFixed(1) },
      deltaDepth: +s.deltaDepth.toFixed(1),
      deltaCanyonWidth: +s.deltaCanyonWidth.toFixed(1),
    })),
    headcutRetreatDistance: +metrics.headcutRetreatDistance.toFixed(1),
    bankAsymmetry: {
      leftRimDist: +metrics.bankAsymmetry.leftRimDist.toFixed(1),
      rightRimDist: +metrics.bankAsymmetry.rightRimDist.toFixed(1),
      ratio: +metrics.bankAsymmetry.ratio.toFixed(2),
    },
  }, null, 2);
  // Save metrics as a .metrics.json file (using .txt extension to avoid sidecar collision)
  try {
    await fetch('/api/snapshot', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ image: btoa(metricsJson), label: `${label}-metrics`, format: 'metrics.json', metadata: { type: 'micro-metrics', metricsInline: JSON.parse(metricsJson) } }),
    });
    console.log(`[micro-metrics] persisted: ${label}-metrics`);
  } catch (err) {
    console.warn(`[micro-metrics] failed to persist metrics:`, err);
  }

  // 6. Per-notch metrics (for double-notch and similar multi-system cases)
  if (notchCenters) {
    const cs = (extent * 2) / (gridSize - 1);
    const perNotch: PerNotchMetrics[] = [];

    for (const z of diagZSections) {
      const gz = Math.max(0, Math.min(gridSize - 1, Math.round((z + extent) / cs)));
      const halfBand = Math.round(15 / cs); // ±15 world units around each notch center

      // Left notch
      const lgx = Math.round((notchCenters.leftX + extent) / cs);
      let lMin = Infinity, lMax = -Infinity;
      for (let gx = Math.max(0, lgx - halfBand); gx <= Math.min(gridSize - 1, lgx + halfBand); gx++) {
        const h = finalGrid[gz * gridSize + gx];
        if (h < lMin) lMin = h;
        if (h > lMax) lMax = h;
      }

      // Right notch
      const rgx = Math.round((notchCenters.rightX + extent) / cs);
      let rMin = Infinity, rMax = -Infinity;
      for (let gx = Math.max(0, rgx - halfBand); gx <= Math.min(gridSize - 1, rgx + halfBand); gx++) {
        const h = finalGrid[gz * gridSize + gx];
        if (h < rMin) rMin = h;
        if (h > rMax) rMax = h;
      }

      // Divide
      const dgx = Math.round((notchCenters.divideX + extent) / cs);
      const divideH = finalGrid[gz * gridSize + dgx];

      perNotch.push({
        z,
        left: { depth: lMax - lMin, bed: lMin },
        right: { depth: rMax - rMin, bed: rMin },
        divideH,
        divideAboveLeft: divideH - lMin,
        divideAboveRight: divideH - rMin,
      });

      console.log(`  [per-notch z=${z}] L depth=${(lMax - lMin).toFixed(1)} R depth=${(rMax - rMin).toFixed(1)} divide=${divideH.toFixed(1)} divAboveL=${(divideH - lMin).toFixed(1)} divAboveR=${(divideH - rMin).toFixed(1)}`);
    }

    // Persist per-notch metrics
    try {
      const perNotchJson = JSON.stringify({ label, notchCenters, perNotch: perNotch.map(p => ({
        z: p.z,
        left: { depth: +p.left.depth.toFixed(1), bed: +p.left.bed.toFixed(1) },
        right: { depth: +p.right.depth.toFixed(1), bed: +p.right.bed.toFixed(1) },
        divideH: +p.divideH.toFixed(1),
        divideAboveLeft: +p.divideAboveLeft.toFixed(1),
        divideAboveRight: +p.divideAboveRight.toFixed(1),
      })) }, null, 2);
      await fetch('/api/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: btoa(perNotchJson), label: `${label}-per-notch`, format: 'metrics.json', metadata: { type: 'per-notch-metrics', metricsInline: JSON.parse(perNotchJson) } }),
      });
      console.log(`[micro-metrics] persisted: ${label}-per-notch`);
    } catch (err) {
      console.warn(`[micro-metrics] per-notch persist failed:`, err);
    }
  }

  return metrics;
}
