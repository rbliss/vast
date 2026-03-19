/**
 * Implicit upstream-ordered drainage elevation solve.
 *
 * Clean-room implementation inspired by the Braun-Willett approach:
 * process cells downstream → upstream, computing each cell's eroded
 * elevation from its already-resolved receiver's elevation plus the
 * stream-power incision contribution.
 *
 * AE1a.2 improvements:
 * - Priority-flood depression filling before drainage routing
 * - Explicit boundary outlet enforcement
 * - Correct downstream→upstream solve ordering
 */

// D8 neighbor offsets
const DX = [-1, 0, 1, -1, 1, -1, 0, 1];
const DZ = [-1, -1, -1, 0, 0, 1, 1, 1];
const DIST = [Math.SQRT2, 1, Math.SQRT2, 1, 1, Math.SQRT2, 1, Math.SQRT2];

/**
 * Simple binary min-heap for priority-flood.
 */
class MinHeap {
  private data: Float64Array; // interleaved [height, index] pairs
  private size = 0;

  constructor(capacity: number) {
    this.data = new Float64Array(capacity * 2);
  }

  push(h: number, idx: number): void {
    let i = this.size++;
    this.data[i * 2] = h;
    this.data[i * 2 + 1] = idx;
    // Bubble up
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[parent * 2] <= this.data[i * 2]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { h: number; idx: number } {
    const h = this.data[0];
    const idx = this.data[1];
    this.size--;
    if (this.size > 0) {
      this.data[0] = this.data[this.size * 2];
      this.data[1] = this.data[this.size * 2 + 1];
      this.sinkDown(0);
    }
    return { h, idx };
  }

  get length(): number { return this.size; }

  private swap(a: number, b: number): void {
    const h = this.data[a * 2], i = this.data[a * 2 + 1];
    this.data[a * 2] = this.data[b * 2]; this.data[a * 2 + 1] = this.data[b * 2 + 1];
    this.data[b * 2] = h; this.data[b * 2 + 1] = i;
  }

  private sinkDown(i: number): void {
    while (true) {
      let smallest = i;
      const l = 2 * i + 1, r = 2 * i + 2;
      if (l < this.size && this.data[l * 2] < this.data[smallest * 2]) smallest = l;
      if (r < this.size && this.data[r * 2] < this.data[smallest * 2]) smallest = r;
      if (smallest === i) break;
      this.swap(i, smallest);
      i = smallest;
    }
  }
}

/**
 * Priority-flood depression filling (Barnes et al. 2014 simplified).
 * Ensures all cells can drain to the boundary — no internal sinks.
 * Modifies grid in place (only raises cells, never lowers).
 * Uses binary min-heap for O(n log n) performance.
 */
export function fillDepressions(grid: Float32Array, w: number, h: number): void {
  const n = w * h;
  const filled = new Float32Array(n);
  filled.fill(Infinity);

  const heap = new MinHeap(n);
  const visited = new Uint8Array(n);

  // Seed boundary cells
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      if (x === 0 || x === w - 1 || z === 0 || z === h - 1) {
        const idx = z * w + x;
        filled[idx] = grid[idx];
        heap.push(grid[idx], idx);
        visited[idx] = 1;
      }
    }
  }

  // Process
  while (heap.length > 0) {
    const { idx } = heap.pop();
    const x = idx % w;
    const z = (idx - x) / w;

    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d];
      const nz = z + DZ[d];
      if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;
      const ni = nz * w + nx;
      if (visited[ni]) continue;

      filled[ni] = Math.max(grid[ni], filled[idx] + 0.001);
      visited[ni] = 1;
      heap.push(filled[ni], ni);
    }
  }

  grid.set(filled);
}

/**
 * Check if a boundary cell is a preferred outlet.
 * Only cells below a height threshold on the boundary are valid outlets.
 * This forces drainage to organize toward the lower piedmont instead of
 * exiting equally through the entire perimeter.
 */
function isPreferredOutlet(x: number, z: number, w: number, h: number, grid: Float32Array): boolean {
  if (x > 0 && x < w - 1 && z > 0 && z < h - 1) return false; // not boundary
  // Only boundary cells below the median-ish height are outlets
  // This ensures high escarpment-edge boundary cells route inward
  const height = grid[z * w + x];
  return height < 20; // piedmont-level cells are outlets (tableland is ~60+)
}

/**
 * Compute D8 flow directions and drainage area on the coarse grid.
 * Assumes depressions have been filled (no internal sinks).
 * Uses preferred outlets — only low boundary cells are valid exits.
 */
export function computeCoarseDrainage(
  grid: Float32Array, w: number, h: number, cellSize: number,
): { receiver: Int32Array; area: Float32Array; order: Int32Array } {
  const n = w * h;
  const receiver = new Int32Array(n);
  const area = new Float32Array(n);

  // Find steepest descent receiver for each cell
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const idx = z * w + x;
      const hc = grid[idx];
      let bestSlope = 0;
      // Only preferred outlets self-receive; others must route downstream
      let bestRecv = isPreferredOutlet(x, z, w, h, grid) ? idx : -1;

      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d];
        const nz = z + DZ[d];
        if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;
        const ni = nz * w + nx;
        const slope = (hc - grid[ni]) / (DIST[d] * cellSize);
        if (slope > bestSlope) {
          bestSlope = slope;
          bestRecv = ni;
        }
      }
      // Fallback: if no downhill neighbor found, self-receive (pit)
      receiver[idx] = bestRecv >= 0 ? bestRecv : idx;
    }
  }

  // Topological sort: highest to lowest (for area accumulation)
  const highToLow = new Int32Array(n);
  for (let i = 0; i < n; i++) highToLow[i] = i;
  highToLow.sort((a, b) => grid[b] - grid[a]);

  // Accumulate area in upstream order (highest first → area flows downstream)
  area.fill(cellSize * cellSize);
  for (let i = 0; i < n; i++) {
    const idx = highToLow[i];
    const recv = receiver[idx];
    if (recv !== idx) {
      area[recv] += area[idx];
    }
  }

  // Reverse order: lowest to highest (for elevation solve — downstream first)
  const lowToHigh = new Int32Array(n);
  for (let i = 0; i < n; i++) lowToHigh[i] = highToLow[n - 1 - i];

  return { receiver, area, order: lowToHigh };
}

/**
 * Implicit upstream-ordered elevation solve.
 *
 * For n≈1 (linear slope): analytical solution per cell:
 *   h_i = (h_initial + factor * h_receiver) / (1 + factor)
 *   where factor = K * A^m * age / L
 *
 * Processes downstream → upstream so receiver elevations are known.
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

  // Process downstream → upstream (lowest first)
  for (let i = 0; i < totalCells; i++) {
    const idx = order[i];
    const recv = receiver[idx];

    // Skip outlets / boundary cells (receiver = self)
    if (recv === idx) continue;

    // Distance to receiver
    const ix = idx % w;
    const iz = (idx - ix) / w;
    const rx = recv % w;
    const rz = (recv - rx) / w;
    const ddx = Math.abs(ix - rx);
    const ddz = Math.abs(iz - rz);
    const L = (ddx + ddz > 1 ? Math.SQRT2 : 1) * cellSize;

    const h_recv = grid[recv];
    const h_init = initial[idx];
    const A = area[idx];

    // Channelized erosion: concentrate incision into drainage paths
    // Cells with small drainage area get much less erosion (hillslope regime)
    // This prevents uniform sheet lowering and creates organized channels.
    const channelThreshold = 50.0; // world-area units — below this, mostly hillslope
    const channelFraction = Math.min(1.0, Math.pow(A / channelThreshold, 0.6));

    // Erosion power term: K * A^m * age, modulated by channel fraction
    const erosionTerm = K * Math.pow(A, m) * age * (0.05 + 0.95 * channelFraction);

    if (Math.abs(n_exp - 1.0) < 0.01) {
      // Linear slope case: analytical solution
      const factor = erosionTerm / L;
      const h_new = (h_init + factor * h_recv) / (1 + factor);
      grid[idx] = Math.min(h_init, Math.max(h_recv + 0.001, h_new));
    } else {
      // Nonlinear case: simple iteration
      let h_current = grid[idx];
      for (let iter = 0; iter < 5; iter++) {
        const slope = Math.max(0.001, (h_current - h_recv) / L);
        const erosion = erosionTerm * Math.pow(slope, n_exp);
        const h_new = h_init - erosion;
        h_current = Math.min(h_init, Math.max(h_recv + 0.001, h_new));
      }
      grid[idx] = h_current;
    }
  }
}
