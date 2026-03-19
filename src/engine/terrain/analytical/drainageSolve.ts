/**
 * Implicit upstream-ordered drainage elevation solve.
 *
 * Clean-room implementation inspired by the Braun-Willett approach:
 * process cells from highest to lowest (upstream order), computing
 * each cell's eroded elevation from its downstream receiver's elevation
 * plus the stream-power incision contribution.
 *
 * Key insight: in upstream order, each cell's steady-state elevation
 * can be solved analytically because all downstream cells are already
 * resolved. This converges much faster than iterative stream-power
 * because it directly computes the equilibrium drainage profile.
 *
 * The solve produces organized drainage trees because it respects
 * the hierarchical flow structure — trunk channels with consistent
 * downstream gradients, tributaries feeding into them.
 */

/**
 * Compute D8 flow directions and drainage area on the coarse grid.
 * Returns receiver indices and accumulated area (in cell counts).
 */
export function computeCoarseDrainage(
  grid: Float32Array, w: number, h: number, cellSize: number,
): { receiver: Int32Array; area: Float32Array; order: Int32Array } {
  const n = w * h;
  const receiver = new Int32Array(n);
  const area = new Float32Array(n);

  // D8 neighbor offsets
  const dx = [-1, 0, 1, -1, 1, -1, 0, 1];
  const dz = [-1, -1, -1, 0, 0, 1, 1, 1];
  const dist = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

  // Find steepest descent receiver for each cell
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const idx = z * w + x;
      const hc = grid[idx];
      let bestSlope = 0;
      let bestRecv = idx; // self = pit/boundary

      for (let d = 0; d < 8; d++) {
        const nx = x + dx[d];
        const nz = z + dz[d];
        if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;
        const ni = nz * w + nx;
        const slope = (hc - grid[ni]) / (dist[d] * cellSize);
        if (slope > bestSlope) {
          bestSlope = slope;
          bestRecv = ni;
        }
      }
      receiver[idx] = bestRecv;
    }
  }

  // Topological sort: highest to lowest (upstream order)
  // Create sorted indices by descending elevation
  const indices = new Int32Array(n);
  for (let i = 0; i < n; i++) indices[i] = i;
  indices.sort((a, b) => grid[b] - grid[a]);

  // Accumulate area in upstream order (highest first)
  area.fill(cellSize * cellSize); // each cell starts with its own area (world units)
  for (let i = 0; i < n; i++) {
    const idx = indices[i];
    const recv = receiver[idx];
    if (recv !== idx) {
      area[recv] += area[idx];
    }
  }

  return { receiver, area, order: indices };
}

/**
 * Implicit upstream-ordered elevation solve.
 *
 * For each cell in upstream order (highest first), compute the
 * steady-state eroded elevation based on:
 *   h_i = h_receiver + dt * K * A^m * (slope)^n
 *
 * Rearranged for implicit solve:
 *   h_i = h_receiver + L * K * A^m * ((h_i - h_receiver) / L)^n
 *
 * For n=1 (linear slope dependence), this has an analytical solution:
 *   h_i = (h_initial + age * K * A^m * h_receiver / L) / (1 + age * K * A^m / L)
 *
 * For n≠1, we use a simple fixed-point iteration per cell.
 *
 * @param grid - Height grid (modified in place)
 * @param initial - Original heights (for blending/limiting)
 * @param receiver - D8 receiver indices
 * @param area - Drainage area (world units)
 * @param order - Upstream-sorted cell indices
 * @param w - Grid width
 * @param h - Grid height
 * @param cellSize - Cell spacing
 * @param K - Erosion coefficient
 * @param m - Area exponent
 * @param n_exp - Slope exponent
 * @param age - Erosion age (scales the solve intensity)
 */
export function implicitElevationSolve(
  grid: Float32Array,
  initial: Float32Array,
  receiver: Int32Array,
  area: Float32Array,
  order: Int32Array,
  w: number, h: number,
  cellSize: number,
  K: number, m: number, n_exp: number,
  age: number,
): void {
  const totalCells = w * h;

  // Process in upstream order (highest first)
  for (let i = 0; i < totalCells; i++) {
    const idx = order[i];
    const recv = receiver[idx];

    // Skip pits / boundary cells (receiver = self)
    if (recv === idx) continue;

    // Distance to receiver
    const ix = idx % w;
    const iz = (idx - ix) / w;
    const rx = recv % w;
    const rz = (recv - rx) / w;
    const dx = Math.abs(ix - rx);
    const dz = Math.abs(iz - rz);
    const L = (dx + dz > 1 ? Math.SQRT2 : 1) * cellSize;

    const h_recv = grid[recv];
    const h_init = initial[idx];
    const A = area[idx];

    // Erosion power term: K * A^m * age
    const erosionTerm = K * Math.pow(A, m) * age;

    if (Math.abs(n_exp - 1.0) < 0.01) {
      // Linear slope case (n≈1): analytical solution
      // h_i = (h_init + erosionTerm * h_recv / L) / (1 + erosionTerm / L)
      const factor = erosionTerm / L;
      const h_new = (h_init + factor * h_recv) / (1 + factor);

      // Only allow erosion (lowering), not deposition above initial
      grid[idx] = Math.min(h_init, Math.max(h_recv, h_new));
    } else {
      // Nonlinear case: simple iteration
      let h_current = grid[idx];
      for (let iter = 0; iter < 4; iter++) {
        const slope = Math.max(0.001, (h_current - h_recv) / L);
        const erosion = erosionTerm * Math.pow(slope, n_exp);
        const h_new = h_init - erosion;
        h_current = Math.min(h_init, Math.max(h_recv + 0.001, h_new));
      }
      grid[idx] = h_current;
    }
  }
}
