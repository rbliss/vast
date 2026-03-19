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
  const secondaryThreshold = primaryThreshold * 0.08;
  const headwaterThreshold = primaryThreshold * 0.04; // not too low — prevents node explosion

  // Step 1: Identify all channel cells (above headwater threshold)
  const isChannel = new Uint8Array(n);
  for (let i = 0; i < n; i++) {
    if (area[i] > headwaterThreshold) isChannel[i] = 1;
  }

  // Step 2: Build graph nodes from channel cells
  const nodes: DrainageNode[] = [];
  const gridToNode = new Int32Array(n).fill(-1);

  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const idx = z * w + x;
      if (!isChannel[idx]) continue;

      // Determine hierarchy level
      let level: number;
      if (receiver[idx] === idx) {
        level = 0; // outlet
      } else if (area[idx] > primaryThreshold) {
        level = 1; // primary trunk
      } else if (area[idx] > secondaryThreshold) {
        level = 2; // secondary tributary
      } else {
        level = 3; // headwater
      }

      const nodeIdx = nodes.length;
      gridToNode[idx] = nodeIdx;
      nodes.push({
        idx,
        x, z,
        area: area[idx],
        level,
        downstream: -1,
        upstream: [],
      });
    }
  }

  // Step 3: Build edges by following receiver links between graph nodes
  const edges: DrainageEdge[] = [];

  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];
    const recv = receiver[node.idx];
    if (recv === node.idx) continue; // outlet

    // Walk downstream until we hit another graph node or an outlet
    // Cycle protection: limit walk to grid size
    let current = recv;
    let pathLength = cellSize;
    let maxSteps = w + h;
    while (gridToNode[current] === -1 && receiver[current] !== current && maxSteps-- > 0) {
      current = receiver[current];
      pathLength += cellSize;
    }

    const downstreamNodeIdx = gridToNode[current];
    if (downstreamNodeIdx >= 0 && downstreamNodeIdx !== i) {
      node.downstream = downstreamNodeIdx;
      nodes[downstreamNodeIdx].upstream.push(i);

      edges.push({
        from: i,
        to: downstreamNodeIdx,
        area: Math.min(node.area, nodes[downstreamNodeIdx].area),
        level: Math.max(node.level, nodes[downstreamNodeIdx].level),
        length: pathLength,
      });
    }
  }

  // Count outlet basins
  let basinCount = 0;
  for (const node of nodes) {
    if (node.level === 0) basinCount++;
  }

  console.log(`[graph] extracted: ${nodes.length} nodes, ${edges.length} edges, ${basinCount} basins (primary>${primaryThreshold.toFixed(0)} secondary>${secondaryThreshold.toFixed(0)} headwater>${headwaterThreshold.toFixed(0)})`);

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

  // AE2.2: Distance-field rasterization
  // Step 1: For each cell, find its nearest point on any graph edge.
  //         Record distance, nearest edge's area, and hierarchy level.
  // Step 2: Derive valley profile from the distance field.
  // This replaces per-step stamping and produces smooth, continuous valleys.

  // Build edge segments for efficient distance queries
  interface EdgeSeg { x1: number; z1: number; x2: number; z2: number; area: number; level: number; }
  const segments: EdgeSeg[] = [];
  for (const edge of graph.edges) {
    const src = graph.nodes[edge.from];
    const dst = graph.nodes[edge.to];
    // Subdivide long edges for better distance accuracy
    const edgeDx = dst.x - src.x;
    const edgeDz = dst.z - src.z;
    const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDz * edgeDz);
    if (edgeLen < 0.5) continue;
    const subdivs = Math.max(1, Math.ceil(edgeLen / 3));
    for (let s = 0; s < subdivs; s++) {
      const t0 = s / subdivs, t1 = (s + 1) / subdivs;
      segments.push({
        x1: src.x + edgeDx * t0, z1: src.z + edgeDz * t0,
        x2: src.x + edgeDx * t1, z2: src.z + edgeDz * t1,
        area: src.area + (dst.area - src.area) * (t0 + t1) * 0.5,
        level: edge.level,
      });
    }
  }

  // Build spatial grid for fast segment lookup
  const bucketSize = 16; // cells per bucket
  const bw = Math.ceil(w / bucketSize), bh = Math.ceil(h / bucketSize);
  const buckets: number[][] = new Array(bw * bh);
  for (let i = 0; i < buckets.length; i++) buckets[i] = [];

  const maxSearchDist = 12; // cells — max valley half-width
  for (let si = 0; si < segments.length; si++) {
    const seg = segments[si];
    const minBX = Math.max(0, Math.floor((Math.min(seg.x1, seg.x2) - maxSearchDist) / bucketSize));
    const maxBX = Math.min(bw - 1, Math.floor((Math.max(seg.x1, seg.x2) + maxSearchDist) / bucketSize));
    const minBZ = Math.max(0, Math.floor((Math.min(seg.z1, seg.z2) - maxSearchDist) / bucketSize));
    const maxBZ = Math.min(bh - 1, Math.floor((Math.max(seg.z1, seg.z2) + maxSearchDist) / bucketSize));
    for (let bz = minBZ; bz <= maxBZ; bz++) {
      for (let bx = minBX; bx <= maxBX; bx++) {
        buckets[bz * bw + bx].push(si);
      }
    }
  }

  // For each raster cell, find nearest segment via spatial grid
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const idx = z * w + x;
      const bx = Math.floor(x / bucketSize), bz = Math.floor(z / bucketSize);
      const bucket = buckets[bz * bw + bx];

      let bestDist = Infinity;
      let bestArea = 0;
      let bestLevel = 3;

      for (const si of bucket) {
        const seg = segments[si];
        const dx = seg.x2 - seg.x1, dz = seg.z2 - seg.z1;
        const len2 = dx * dx + dz * dz;
        let t = len2 > 0 ? ((x - seg.x1) * dx + (z - seg.z1) * dz) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = seg.x1 + dx * t, pz = seg.z1 + dz * t;
        const dist = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz)) * cellSize;

        if (dist < bestDist) {
          bestDist = dist;
          bestArea = seg.area;
          bestLevel = seg.level;
        }
      }

      distToChannel[idx] = bestDist;

      // Derive valley profile from distance field
      const width = Math.min(10, 1.5 + Math.pow(bestArea / 1000, 0.25) * 2.5) * cellSize;
      const depth = Math.min(30, 2 + Math.pow(bestArea / 500, 0.35) * 5);
      const levelScale = bestLevel <= 1 ? 1.0 : bestLevel === 2 ? 0.55 : 0.25;

      if (bestDist < width) {
        const t = bestDist / width;
        // Smooth valley cross-section: smoothstep for rounder profile
        const profile = 1 - t * t * (3 - 2 * t);
        channelStrength[idx] = profile * levelScale;
        valleyWidth[idx] = width;
        valleyDepth[idx] = depth * profile * levelScale;
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
