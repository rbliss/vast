/**
 * Fan and debris-flow deposition.
 *
 * Post-processing pass that runs after stream-power erosion:
 *   1. Detects fan apices (where channels exit confinement)
 *   2. Stamps sector/lobe fan shapes from each apex
 *   3. Adds debris-flow deposits on steep mountain flanks
 *
 * Fan shapes are morphological stamps, not iterative routing —
 * this produces the cone/lobe shapes that D8 deposition cannot.
 */

// ── Types ──

export interface FanParams {
  /** Minimum drainage area to qualify as a fan-producing channel */
  minDrainageArea: number;
  /** Confinement drop threshold to detect apex (confined→open) */
  confinementDropThreshold: number;
  /** Fan opening half-angle in radians */
  fanHalfAngle: number;
  /** Fan slope (height drop per unit distance from apex) */
  fanSlope: number;
  /** Maximum fan radius in cells */
  maxFanRadius: number;
  /** Fan deposit blending strength (0-1) */
  fanBlend: number;
  /** Enable debris-flow deposits on steep slopes */
  debrisEnabled: boolean;
  /** Slope threshold for debris flow (steeper triggers debris) */
  debrisSlopeThreshold: number;
  /** Maximum drainage area for debris (low-area steep slopes only) */
  debrisMaxArea: number;
  /** Debris deposit distance in cells */
  debrisRadius: number;
  /** Debris deposit amount per unit slope excess */
  debrisRate: number;
}

export const DEFAULT_FAN_PARAMS: FanParams = {
  minDrainageArea: 500,
  confinementDropThreshold: 0.2,
  fanHalfAngle: Math.PI * 0.4,
  fanSlope: 0.08,
  maxFanRadius: 40,
  fanBlend: 0.8,
  debrisEnabled: true,
  debrisSlopeThreshold: 2.0,
  debrisMaxArea: 15,
  debrisRadius: 10,
  debrisRate: 0.2,
};

// D8 neighbor offsets
const D8_DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const D8_DZ = [-1, -1, -1, 0, 0, 1, 1, 1];
const D8_DIST = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

// ── Fan apex detection ──

interface FanApex {
  x: number;
  z: number;
  /** Flow direction at apex (radians) */
  flowAngle: number;
  /** Drainage area at apex */
  area: number;
  /** Height at apex */
  height: number;
}

function detectFanApices(
  grid: Float32Array,
  area: Float32Array,
  receiver: Int32Array,
  confinement: Float32Array,
  w: number, h: number,
  params: FanParams,
): FanApex[] {
  const apices: FanApex[] = [];
  const margin = 3;

  for (let z = margin; z < h - margin; z++) {
    for (let x = margin; x < w - margin; x++) {
      const idx = z * w + x;

      // Must have significant drainage area
      if (area[idx] < params.minDrainageArea) continue;

      const conf = confinement[idx];
      const recv = receiver[idx];
      if (recv < 0) continue;

      // Check if confinement drops at this cell's receiver
      const recvConf = confinement[recv];
      const confDrop = conf - recvConf;

      if (confDrop < params.confinementDropThreshold) continue;
      // Cell must be at least moderately confined itself
      if (conf < 0.5) continue;

      // Compute flow direction from this cell to receiver
      const rx = recv % w;
      const rz = (recv - rx) / w;
      const flowAngle = Math.atan2(rz - z, rx - x);

      apices.push({
        x, z,
        flowAngle,
        area: area[idx],
        height: grid[idx],
      });
    }
  }

  // Filter: keep only the strongest apex per local region
  // (prevent overlapping fans from adjacent cells)
  apices.sort((a, b) => b.area - a.area);
  const used = new Set<number>();
  const filtered: FanApex[] = [];
  const suppressRadius = 15;

  for (const apex of apices) {
    const key = Math.floor(apex.z / suppressRadius) * 1000 + Math.floor(apex.x / suppressRadius);
    if (used.has(key)) continue;
    used.add(key);
    filtered.push(apex);
  }

  return filtered;
}

// ── Fan shape stamping ──

function stampFans(
  grid: Float32Array,
  w: number, h: number,
  cellSize: number,
  apices: FanApex[],
  params: FanParams,
): void {
  for (const apex of apices) {
    const maxR = params.maxFanRadius;
    const halfAngle = params.fanHalfAngle;

    // Scale fan size and deposit by drainage area
    const areaScale = Math.min(3.0, Math.sqrt(apex.area / params.minDrainageArea));
    const fanR = Math.round(maxR * Math.min(2.0, areaScale * 0.6));
    // Max deposit height at apex (proportional to catchment size)
    const maxDeposit = areaScale * params.fanSlope * fanR * cellSize * 0.15;

    for (let dz = -fanR; dz <= fanR; dz++) {
      for (let dx = -fanR; dx <= fanR; dx++) {
        const px = apex.x + dx;
        const pz = apex.z + dz;
        if (px < 1 || px >= w - 1 || pz < 1 || pz >= h - 1) continue;

        const dist = Math.sqrt(dx * dx + dz * dz);
        if (dist < 1 || dist > fanR) continue;

        // Check if point is within the fan sector
        const angle = Math.atan2(dz, dx);
        let angleDiff = angle - apex.flowAngle;
        while (angleDiff > Math.PI) angleDiff -= 2 * Math.PI;
        while (angleDiff < -Math.PI) angleDiff += 2 * Math.PI;

        if (Math.abs(angleDiff) > halfAngle) continue;

        // Angular falloff: strongest along flow direction, fades at sector edges
        const angularFade = Math.cos(angleDiff / halfAngle * Math.PI * 0.5);

        // Distance falloff: conical taper (deposit decreases with distance)
        const distT = dist / fanR;
        const distFade = (1 - distT) * (1 - distT); // Quadratic falloff for convex cone

        // Deposit amount: additive, builds up terrain
        const deposit = maxDeposit * angularFade * distFade * params.fanBlend;

        const idx = pz * w + px;
        grid[idx] += deposit;
      }
    }
  }
}

// ── Debris-flow deposits ──

function debrisFlowDeposits(
  grid: Float32Array,
  area: Float32Array,
  slopes: Float32Array,
  w: number, h: number,
  cellSize: number,
  params: FanParams,
): void {
  const deposits = new Float32Array(w * h);

  for (let z = 2; z < h - 2; z++) {
    for (let x = 2; x < w - 2; x++) {
      const idx = z * w + x;

      // Debris flow only on steep, low-drainage-area slopes
      if (area[idx] > params.debrisMaxArea) continue;
      if (slopes[idx] < params.debrisSlopeThreshold) continue;

      const slopeExcess = slopes[idx] - params.debrisSlopeThreshold;
      const deposit = slopeExcess * params.debrisRate;

      // Find downslope direction
      const hc = grid[idx];
      let bestDrop = 0;
      let bestDx = 0;
      let bestDz = 0;

      for (let d = 0; d < 8; d++) {
        const nx = x + D8_DX[d];
        const nz = z + D8_DZ[d];
        const ni = nz * w + nx;
        const drop = (hc - grid[ni]) / D8_DIST[d];
        if (drop > bestDrop) {
          bestDrop = drop;
          bestDx = D8_DX[d];
          bestDz = D8_DZ[d];
        }
      }

      if (bestDrop <= 0) continue;

      // Deposit debris in a cone downslope
      const r = params.debrisRadius;
      for (let dz = -r; dz <= r; dz++) {
        for (let dx = -r; dx <= r; dx++) {
          const px = x + dx;
          const pz = z + dz;
          if (px < 2 || px >= w - 2 || pz < 2 || pz >= h - 2) continue;

          const dist = Math.sqrt(dx * dx + dz * dz);
          if (dist > r) continue;

          // Bias toward downslope direction
          const dirDot = dist > 0 ? (dx * bestDx + dz * bestDz) / dist : 1;
          if (dirDot < -0.2) continue; // Skip upslope cells

          const directionalWeight = Math.max(0, (dirDot + 0.2) / 1.2);
          const distFade = 1 - dist / r;
          const amount = deposit * directionalWeight * distFade * distFade;

          deposits[pz * w + px] += amount;
        }
      }

      // Remove some material from the source
      grid[idx] -= deposit * 0.3;
    }
  }

  // Apply deposits
  for (let i = 0; i < w * h; i++) {
    grid[i] += deposits[i];
  }
}

// ── Confinement (reused from streamPower, exported for apex detection) ──

export function computeConfinement(grid: Float32Array, w: number, h: number): Float32Array {
  const n = w * h;
  const conf = new Float32Array(n);

  for (let z = 1; z < h - 1; z++) {
    for (let x = 1; x < w - 1; x++) {
      const idx = z * w + x;
      const hc = grid[idx];
      let higher = 0;
      for (let d = 0; d < 8; d++) {
        const ni = (z + D8_DZ[d]) * w + (x + D8_DX[d]);
        if (grid[ni] > hc) higher++;
      }
      conf[idx] = higher / 8;
    }
  }

  return conf;
}

// ── Public API ──

/**
 * Apply fan and debris-flow deposition as a post-processing pass.
 *
 * Call after stream-power erosion has established channels.
 * Requires pre-computed flow accumulation, receivers, slopes, and confinement.
 */
export function applyFanDeposition(
  grid: Float32Array,
  area: Float32Array,
  receiver: Int32Array,
  slopes: Float32Array,
  w: number, h: number,
  cellSize: number,
  params: FanParams = DEFAULT_FAN_PARAMS,
): void {
  // Compute confinement
  const confinement = computeConfinement(grid, w, h);

  // Detect fan apices
  const apices = detectFanApices(grid, area, receiver, confinement, w, h, params);
  console.log(`[erosion] detected ${apices.length} fan apices`);

  // Stamp fan shapes
  if (apices.length > 0) {
    stampFans(grid, w, h, cellSize, apices, params);
  }

  // Debris-flow deposits
  if (params.debrisEnabled) {
    debrisFlowDeposits(grid, area, slopes, w, h, cellSize, params);
  }
}
