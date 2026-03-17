/**
 * Terrain erosion algorithms.
 *
 * CPU reference implementation. Operates on a 2D float height grid.
 * Both thermal and hydraulic erosion are deterministic given the same
 * input grid, parameters, and seed.
 */

// ── Thermal erosion ──

export interface ThermalParams {
  /** Number of relaxation passes */
  iterations: number;
  /** Maximum stable height difference per cell (talus threshold) */
  talusThreshold: number;
  /** Fraction of excess material transferred per step (0-0.5) */
  transferRate: number;
}

/**
 * Thermal erosion via angle-of-repose relaxation.
 * Redistributes material from steep cells to lower neighbors.
 */
export function thermalErosion(
  grid: Float32Array, w: number, h: number,
  cellSize: number, params: ThermalParams,
): void {
  const maxDh = params.talusThreshold * cellSize;
  const rate = Math.min(0.5, params.transferRate);

  for (let iter = 0; iter < params.iterations; iter++) {
    for (let z = 1; z < h - 1; z++) {
      for (let x = 1; x < w - 1; x++) {
        const idx = z * w + x;
        const hc = grid[idx];

        // Find max height difference to 4-connected neighbors
        let maxDiff = 0;
        let totalDiff = 0;
        let lowerCount = 0;
        const diffs = [0, 0, 0, 0];
        const ni = [idx - 1, idx + 1, idx - w, idx + w];

        for (let n = 0; n < 4; n++) {
          const diff = hc - grid[ni[n]];
          if (diff > maxDh) {
            diffs[n] = diff - maxDh;
            totalDiff += diffs[n];
            lowerCount++;
            if (diff > maxDiff) maxDiff = diff;
          }
        }

        // Distribute excess proportionally to qualifying neighbors
        if (totalDiff > 0) {
          const transfer = (maxDiff - maxDh) * rate;
          for (let n = 0; n < 4; n++) {
            if (diffs[n] > 0) {
              const share = transfer * (diffs[n] / totalDiff);
              grid[ni[n]] += share;
              grid[idx] -= share;
            }
          }
        }
      }
    }
  }
}

// ── Hydraulic erosion (particle-based) ──

export interface HydraulicParams {
  /** Number of rain droplets */
  droplets: number;
  /** Max steps per droplet */
  maxLifetime: number;
  /** Inertia for direction smoothing (0 = pure gradient, 1 = pure momentum) */
  inertia: number;
  /** Sediment capacity multiplier */
  sedimentCapacity: number;
  /** Minimum sediment capacity (prevents zero-capacity on flat terrain) */
  minCapacity: number;
  /** Erosion speed */
  erosionRate: number;
  /** Deposition speed */
  depositionRate: number;
  /** Evaporation rate per step */
  evaporationRate: number;
  /** Gravity constant */
  gravity: number;
  /** Erosion brush radius in cells */
  erosionRadius: number;
  /** Random seed for reproducibility */
  seed: number;
}

/**
 * Hydraulic erosion via particle simulation.
 * Drops particles that flow downhill, erode, carry, and deposit sediment.
 */
export function hydraulicErosion(
  grid: Float32Array, w: number, h: number,
  cellSize: number, params: HydraulicParams,
): void {
  // Precompute erosion brush weights
  const radius = params.erosionRadius;
  const brushOffsets: number[] = [];
  const brushWeights: number[] = [];
  let brushWeightSum = 0;

  for (let dz = -radius; dz <= radius; dz++) {
    for (let dx = -radius; dx <= radius; dx++) {
      const dist = Math.sqrt(dx * dx + dz * dz);
      if (dist <= radius) {
        brushOffsets.push(dx, dz);
        const weight = Math.max(0, radius - dist);
        brushWeights.push(weight);
        brushWeightSum += weight;
      }
    }
  }
  // Normalize
  for (let i = 0; i < brushWeights.length; i++) {
    brushWeights[i] /= brushWeightSum;
  }

  // Simple deterministic PRNG
  let rngState = params.seed;
  function rand(): number {
    rngState = (rngState * 1103515245 + 12345) & 0x7fffffff;
    return rngState / 0x7fffffff;
  }

  const margin = radius + 2;

  for (let drop = 0; drop < params.droplets; drop++) {
    // Random start position (avoiding edges)
    let posX = margin + rand() * (w - 2 * margin);
    let posZ = margin + rand() * (h - 2 * margin);
    let dirX = 0;
    let dirZ = 0;
    let speed = 1;
    let water = 1;
    let sediment = 0;

    for (let step = 0; step < params.maxLifetime; step++) {
      const cellX = Math.floor(posX);
      const cellZ = Math.floor(posZ);

      if (cellX < 1 || cellX >= w - 2 || cellZ < 1 || cellZ >= h - 2) break;

      // Bilinear interpolation of height and gradient
      const fx = posX - cellX;
      const fz = posZ - cellZ;
      const idx00 = cellZ * w + cellX;
      const h00 = grid[idx00];
      const h10 = grid[idx00 + 1];
      const h01 = grid[idx00 + w];
      const h11 = grid[idx00 + w + 1];

      // Gradient
      const gradX = (h10 - h00) * (1 - fz) + (h11 - h01) * fz;
      const gradZ = (h01 - h00) * (1 - fx) + (h11 - h10) * fx;

      // Update direction with inertia
      dirX = dirX * params.inertia - gradX * (1 - params.inertia);
      dirZ = dirZ * params.inertia - gradZ * (1 - params.inertia);
      const dirLen = Math.sqrt(dirX * dirX + dirZ * dirZ);
      if (dirLen < 1e-8) {
        // Random direction if stuck on flat terrain
        const angle = rand() * Math.PI * 2;
        dirX = Math.cos(angle);
        dirZ = Math.sin(angle);
      } else {
        dirX /= dirLen;
        dirZ /= dirLen;
      }

      // Move
      const newX = posX + dirX;
      const newZ = posZ + dirZ;

      // Height at old and new position
      const oldH = h00 * (1 - fx) * (1 - fz) + h10 * fx * (1 - fz) +
                   h01 * (1 - fx) * fz + h11 * fx * fz;

      const newCellX = Math.floor(newX);
      const newCellZ = Math.floor(newZ);
      if (newCellX < 1 || newCellX >= w - 2 || newCellZ < 1 || newCellZ >= h - 2) break;

      const nfx = newX - newCellX;
      const nfz = newZ - newCellZ;
      const nidx = newCellZ * w + newCellX;
      const newH = grid[nidx] * (1 - nfx) * (1 - nfz) +
                   grid[nidx + 1] * nfx * (1 - nfz) +
                   grid[nidx + w] * (1 - nfx) * nfz +
                   grid[nidx + w + 1] * nfx * nfz;

      const heightDiff = newH - oldH;

      // Sediment capacity
      const capacity = Math.max(
        -heightDiff * speed * water * params.sedimentCapacity,
        params.minCapacity,
      );

      if (sediment > capacity || heightDiff > 0) {
        // Deposit: either we're over capacity or going uphill
        const depositAmount = heightDiff > 0
          ? Math.min(sediment, heightDiff) // Fill up to new height
          : (sediment - capacity) * params.depositionRate;

        sediment -= depositAmount;

        // Deposit at current cell (bilinear splat)
        grid[idx00] += depositAmount * (1 - fx) * (1 - fz);
        grid[idx00 + 1] += depositAmount * fx * (1 - fz);
        grid[idx00 + w] += depositAmount * (1 - fx) * fz;
        grid[idx00 + w + 1] += depositAmount * fx * fz;
      } else {
        // Erode using brush
        const erodeAmount = Math.min(
          (capacity - sediment) * params.erosionRate,
          -heightDiff, // Don't erode more than the drop
        );

        for (let b = 0; b < brushWeights.length; b++) {
          const bx = cellX + brushOffsets[b * 2];
          const bz = cellZ + brushOffsets[b * 2 + 1];
          if (bx >= 0 && bx < w && bz >= 0 && bz < h) {
            const amount = erodeAmount * brushWeights[b];
            grid[bz * w + bx] -= amount;
          }
        }

        sediment += erodeAmount;
      }

      // Update physics
      // heightDiff = newH - oldH, so downhill is negative. Speed increases going downhill.
      speed = Math.sqrt(Math.max(0, speed * speed - heightDiff * params.gravity));
      water *= (1 - params.evaporationRate);

      posX = newX;
      posZ = newZ;

      if (water < 0.01) break;
    }
  }
}
