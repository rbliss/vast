/**
 * Multiscale drainage graph extraction (AE2.1).
 *
 * Extracts an explicit graph representation from the coarse MFD
 * accumulation field. The graph contains:
 *   - outlet basins (which outlet arc each cell drains toward)
 *   - primary trunk edges (high-area channel paths)
 *   - secondary tributary edges (moderate-area feeders)
 *   - headwater candidates (channel tips near the rim)
 *   - per-edge drainage area and hierarchy level
 *
 * This graph is the missing representation between "coarse solve"
 * and "terrain shaping" — it enables valley profiles, branching
 * control, and guidance field generation without trench-carving.
 */

export interface DrainageNode {
  /** Grid index in the coarse grid */
  idx: number;
  /** Grid x coordinate */
  x: number;
  /** Grid z coordinate */
  z: number;
  /** Accumulated drainage area (world units) */
  area: number;
  /** Hierarchy level: 0 = outlet, 1 = primary trunk, 2 = secondary, 3 = headwater */
  level: number;
  /** Index of downstream node in the graph (-1 = outlet) */
  downstream: number;
  /** Indices of upstream nodes */
  upstream: number[];
}

export interface DrainageEdge {
  /** Source node index (upstream) */
  from: number;
  /** Target node index (downstream) */
  to: number;
  /** Drainage area at the downstream end */
  area: number;
  /** Hierarchy level */
  level: number;
  /** World-space length of this edge */
  length: number;
  /** Smoothed polyline path (x,z pairs) from source to destination */
  path: number[];
}

export interface DrainageGraph {
  nodes: DrainageNode[];
  edges: DrainageEdge[];
  /** Map from coarse grid index → graph node index (-1 = not on graph) */
  gridToNode: Int32Array;
  /** Number of outlet basins */
  basinCount: number;
  /** Coarse grid dimensions */
  gridSize: number;
  cellSize: number;
}

/**
 * Extract a drainage graph from coarse MFD accumulation + receiver data.
 *
 * @param area - MFD accumulated drainage area (world units)
 * @param receiver - Primary (steepest descent) receiver for each cell
 * @param grid - Coarse height grid
 * @param w - Grid width
 * @param h - Grid height
 * @param cellSize - Coarse cell spacing
 * @param primaryThreshold - Area threshold for primary trunk edges
 */
export function extractDrainageGraph(
  area: Float32Array,
  receiver: Int32Array,
  grid: Float32Array,
  w: number, h: number,
  cellSize: number,
  primaryThreshold: number,
): DrainageGraph {
  const n = w * h;
  const secondaryThreshold = primaryThreshold * 0.3;

  // Step 1: Build sparse channel network using receiver convergence
  // Count how many cells drain INTO each cell via the primary receiver tree
  // Cells with multiple incoming receivers are junction/channel cells
  const incomingCount = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    if (receiver[i] !== i) incomingCount[receiver[i]]++;
  }

  // Channel cells: have ≥2 incoming receivers (convergence points)
  // OR have area above primary threshold (trunk channels)
  // Walk downstream from convergence points to mark trunk paths
  const isChannel = new Uint8Array(n);
  let channelCellCount = 0;
  for (let i = 0; i < n; i++) {
    if (area[i] > primaryThreshold || incomingCount[i] >= 2) {
      // Mark this cell and walk downstream to outlet
      let cur = i;
      let steps = w + h;
      while (cur >= 0 && cur < n && !isChannel[cur] && steps-- > 0) {
        if (area[cur] > secondaryThreshold) {
          isChannel[cur] = 1;
          channelCellCount++;
        }
        if (receiver[cur] === cur) break;
        cur = receiver[cur];
      }
    }
  }

  // Subsample: only every Nth channel cell becomes a graph node
  // This creates edges long enough for polyline smoothing to work
  const nodeSpacing = Math.max(3, Math.floor(Math.sqrt(channelCellCount / 1500)));
  let nodeCounter = 0;

  // Step 2: Build sparse graph nodes — subsample channel cells
  // Keep: outlets, junctions (≥2 incoming), and every Nth cell along channels
  const nodes: DrainageNode[] = [];
  const gridToNode = new Int32Array(n).fill(-1);

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const idx = z * w + x;
      if (!isChannel[idx]) continue;

      const isOutlet = receiver[idx] === idx;
      const isJunction = incomingCount[idx] >= 2;
      const isPrimary = area[idx] > primaryThreshold;

      // Always keep outlets, junctions, and primary trunk cells
      // Subsample other channel cells
      const keep = isOutlet || isJunction || isPrimary || (nodeCounter++ % nodeSpacing === 0);
      if (!keep) continue;

      let level: number;
      if (isOutlet) level = 0;
      else if (isPrimary) level = 1;
      else if (area[idx] > secondaryThreshold) level = 2;
      else level = 3;

      const nodeIdx = nodes.length;
      gridToNode[idx] = nodeIdx;
      nodes.push({
        idx, x, z,
        area: area[idx],
        level,
        downstream: -1,
        upstream: [],
      });
    }
  }

  console.log(`[graph] channel cells: ${channelCellCount}, nodes after subsample: ${nodes.length} (spacing=${nodeSpacing})`);

  // Step 3: Build edges by following receiver links between graph nodes
  const edges: DrainageEdge[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const recv = receiver[node.idx];
    if (recv === node.idx) continue; // outlet

    // Walk downstream, recording the path
    const rawPath: number[] = [node.x, node.z];
    let current = recv;
    let pathLength = cellSize;
    let maxSteps = w + h;
    while (gridToNode[current] === -1 && receiver[current] !== current && maxSteps-- > 0) {
      rawPath.push(current % w, Math.floor(current / w));
      current = receiver[current];
      pathLength += cellSize;
    }

    const downstreamNodeIdx = gridToNode[current];
    if (downstreamNodeIdx >= 0 && downstreamNodeIdx !== i) {
      const dst = nodes[downstreamNodeIdx];
      rawPath.push(dst.x, dst.z);
      node.downstream = downstreamNodeIdx;
      dst.upstream.push(i);

      // Smooth the path: 3-pass Laplacian smoothing (keep endpoints fixed)
      const smoothed = new Float64Array(rawPath);
      const nPts = smoothed.length / 2;
      if (nPts > 3) {
        for (let pass = 0; pass < 3; pass++) {
          for (let p = 1; p < nPts - 1; p++) {
            smoothed[p * 2]     = smoothed[(p-1) * 2] * 0.25 + smoothed[p * 2] * 0.5 + smoothed[(p+1) * 2] * 0.25;
            smoothed[p * 2 + 1] = smoothed[(p-1) * 2 + 1] * 0.25 + smoothed[p * 2 + 1] * 0.5 + smoothed[(p+1) * 2 + 1] * 0.25;
          }
        }
      }

      edges.push({
        from: i,
        to: downstreamNodeIdx,
        area: Math.min(node.area, dst.area),
        level: Math.max(node.level, dst.level),
        length: pathLength,
        path: Array.from(smoothed),
      });
    }
  }

  // Count outlet basins
  let basinCount = 0;
  for (const node of nodes) {
    if (node.level === 0) basinCount++;
  }

  console.log(`[graph] extracted: ${nodes.length} nodes, ${edges.length} edges, ${basinCount} basins (primary>${primaryThreshold.toFixed(0)} secondary>${secondaryThreshold.toFixed(0)})`);

  return { nodes, edges, gridToNode, basinCount, gridSize: w, cellSize };
}

/**
 * Generate raster guidance fields from the drainage graph.
 *
 * Produces per-cell fields that can be used to shape terrain or
 * seed the H2 bake pipeline:
 *   - channelStrength: 0-1, how strongly this cell should be a channel
 *   - distToChannel: world-space distance to nearest channel edge
 *   - valleyWidth: area-dependent target valley width at this location
 *   - valleyDepth: target incision depth based on area + position
 */
export interface GuidanceFields {
  channelStrength: Float32Array;
  distToChannel: Float32Array;
  valleyWidth: Float32Array;
  valleyDepth: Float32Array;
}

export function generateGuidanceFields(
  graph: DrainageGraph,
  w: number, h: number,
  cellSize: number,
): GuidanceFields {
  const n = w * h;
  const channelStrength = new Float32Array(n);
  const distToChannel = new Float32Array(n).fill(Infinity);
  const valleyWidth = new Float32Array(n);
  const valleyDepth = new Float32Array(n);

  // AE2.5: Continuous spline centerline + exact distance field
  // For each edge, build a continuous polyline centerline with per-vertex
  // attributes (width, depth, level). Then for each raster cell, compute
  // exact distance to the nearest point on any centerline and derive
  // valley profile from continuous interpolated attributes.

  // Step 1: Build centerline segments with interpolated attributes
  interface CenterSeg {
    x1: number; z1: number; x2: number; z2: number;
    w1: number; w2: number; // half-width at each endpoint
    d1: number; d2: number; // max depth at each endpoint
    level: number;
  }
  const centerlines: CenterSeg[] = [];

  for (const edge of graph.edges) {
    const src = graph.nodes[edge.from];
    const dst = graph.nodes[edge.to];
    const path = edge.path;
    const nPts = path.length / 2;
    if (nPts < 2) continue;

    const levelScale = edge.level <= 1 ? 1.0 : edge.level === 2 ? 0.55 : 0.25;

    // Compute width/depth at each path vertex (monotone downstream)
    for (let p = 0; p < nPts - 1; p++) {
      const t1 = p / Math.max(1, nPts - 1);
      const t2 = (p + 1) / Math.max(1, nPts - 1);
      const a1 = Math.max(src.area * 0.5, src.area + (dst.area - src.area) * t1);
      const a2 = Math.max(src.area * 0.5, src.area + (dst.area - src.area) * t2);

      centerlines.push({
        x1: path[p * 2], z1: path[p * 2 + 1],
        x2: path[(p+1) * 2], z2: path[(p+1) * 2 + 1],
        w1: Math.min(8, 1.2 + Math.pow(a1 / 800, 0.25) * 2) * cellSize,
        w2: Math.min(8, 1.2 + Math.pow(a2 / 800, 0.25) * 2) * cellSize,
        d1: Math.min(25, 1.5 + Math.pow(a1 / 400, 0.35) * 4) * levelScale,
        d2: Math.min(25, 1.5 + Math.pow(a2 / 400, 0.35) * 4) * levelScale,
        level: edge.level,
      });
    }
  }

  // Step 2: Spatial grid for fast centerline lookup
  const bucketSize = 12;
  const bw = Math.ceil(w / bucketSize), bh = Math.ceil(h / bucketSize);
  const buckets: number[][] = new Array(bw * bh);
  for (let i = 0; i < buckets.length; i++) buckets[i] = [];

  const maxHalfWidth = 10; // cells
  for (let si = 0; si < centerlines.length; si++) {
    const seg = centerlines[si];
    const pad = maxHalfWidth;
    const minBX = Math.max(0, Math.floor((Math.min(seg.x1, seg.x2) - pad) / bucketSize));
    const maxBX = Math.min(bw - 1, Math.floor((Math.max(seg.x1, seg.x2) + pad) / bucketSize));
    const minBZ = Math.max(0, Math.floor((Math.min(seg.z1, seg.z2) - pad) / bucketSize));
    const maxBZ = Math.min(bh - 1, Math.floor((Math.max(seg.z1, seg.z2) + pad) / bucketSize));
    for (let bz = minBZ; bz <= maxBZ; bz++) {
      for (let bx = minBX; bx <= maxBX; bx++) {
        buckets[bz * bw + bx].push(si);
      }
    }
  }

  // Step 3: For each raster cell, find closest point on any centerline
  // and compute valley profile from interpolated attributes
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const idx = z * w + x;
      const bx = Math.floor(x / bucketSize), bz = Math.floor(z / bucketSize);
      const bucket = buckets[bz * bw + bx];

      let bestDist = Infinity;
      let bestHalfW = 0, bestDepth = 0, bestLevel = 3;

      for (const si of bucket) {
        const seg = centerlines[si];
        const sdx = seg.x2 - seg.x1, sdz = seg.z2 - seg.z1;
        const len2 = sdx * sdx + sdz * sdz;
        let t = len2 > 0 ? ((x - seg.x1) * sdx + (z - seg.z1) * sdz) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = seg.x1 + sdx * t, pz = seg.z1 + sdz * t;
        const dist = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz)) * cellSize;

        // Interpolate attributes at the closest point
        const halfW = seg.w1 + (seg.w2 - seg.w1) * t;

        if (dist < halfW && dist < bestDist) {
          bestDist = dist;
          bestHalfW = halfW;
          bestDepth = seg.d1 + (seg.d2 - seg.d1) * t;
          bestLevel = seg.level;
        }
      }

      if (bestDist < Infinity) {
        distToChannel[idx] = bestDist;
        const dt = bestDist / bestHalfW;
        const profile = 1 - dt * dt * (3 - 2 * dt); // smoothstep
        const levelScale = bestLevel <= 1 ? 1.0 : bestLevel === 2 ? 0.55 : 0.25;

        const depthHere = bestDepth * profile;
        const strengthHere = profile * levelScale;

        // Smooth-max: keep deepest, blend secondaries
        if (depthHere > valleyDepth[idx]) {
          valleyDepth[idx] = depthHere;
          channelStrength[idx] = strengthHere;
          valleyWidth[idx] = bestHalfW;
        }
      }
    }
  }

  return { channelStrength, distToChannel, valleyWidth, valleyDepth };
}

/**
 * Apply guidance fields to shape terrain.
 * Carves valleys using the graph-derived depth/width fields
 * instead of binary trench solving.
 */
export function applyGuidanceToTerrain(
  grid: Float32Array,
  initial: Float32Array,
  fields: GuidanceFields,
  w: number, h: number,
  blendStrength: number,
): void {
  for (let i = 0; i < w * h; i++) {
    if (fields.channelStrength[i] > 0.01) {
      const carveDepth = fields.valleyDepth[i] * fields.channelStrength[i] * blendStrength;
      grid[i] = Math.max(1.0, initial[i] - carveDepth);
    }
  }
}
