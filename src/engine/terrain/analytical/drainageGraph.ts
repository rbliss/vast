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

  // Build edge segments from smoothed polyline paths
  interface EdgeSeg { x1: number; z1: number; x2: number; z2: number; area: number; level: number; }
  const segments: EdgeSeg[] = [];
  for (const edge of graph.edges) {
    const src = graph.nodes[edge.from];
    const dst = graph.nodes[edge.to];
    const path = edge.path;
    const nPts = path.length / 2;
    if (nPts < 2) continue;

    // Create segments along the smoothed polyline
    // Subsample long paths to keep segment count manageable
    const step = Math.max(1, Math.floor(nPts / 20));
    for (let p = 0; p < nPts - step; p += step) {
      const p2 = Math.min(p + step, nPts - 1);
      const t = (p + p2) / 2 / Math.max(1, nPts - 1);
      segments.push({
        x1: path[p * 2], z1: path[p * 2 + 1],
        x2: path[p2 * 2], z2: path[p2 * 2 + 1],
        area: src.area + (dst.area - src.area) * t,
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

  // For each raster cell, find nearest segments and blend valleys smoothly
  for (let z = 0; z < h; z++) {
    for (let x = 0; x < w; x++) {
      const idx = z * w + x;
      const bx = Math.floor(x / bucketSize), bz = Math.floor(z / bucketSize);
      const bucket = buckets[bz * bw + bx];

      // Collect top-2 nearest segments for smooth junction blending
      let dist1 = Infinity, area1 = 0, level1 = 3;
      let dist2 = Infinity, area2 = 0, level2 = 3;

      for (const si of bucket) {
        const seg = segments[si];
        const sdx = seg.x2 - seg.x1, sdz = seg.z2 - seg.z1;
        const len2 = sdx * sdx + sdz * sdz;
        let t = len2 > 0 ? ((x - seg.x1) * sdx + (z - seg.z1) * sdz) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        const px = seg.x1 + sdx * t, pz = seg.z1 + sdz * t;
        const dist = Math.sqrt((x - px) * (x - px) + (z - pz) * (z - pz)) * cellSize;

        if (dist < dist1) {
          dist2 = dist1; area2 = area1; level2 = level1;
          dist1 = dist; area1 = seg.area; level1 = seg.level;
        } else if (dist < dist2) {
          dist2 = dist; area2 = seg.area; level2 = seg.level;
        }
      }

      distToChannel[idx] = dist1;

      // Compute valley profile for nearest channel
      const width1 = Math.min(10, 1.5 + Math.pow(area1 / 1000, 0.25) * 2.5) * cellSize;
      const depth1Raw = Math.min(30, 2 + Math.pow(area1 / 500, 0.35) * 5);
      const levelScale1 = level1 <= 1 ? 1.0 : level1 === 2 ? 0.55 : 0.25;

      if (dist1 >= width1) continue; // outside any valley

      const t1 = dist1 / width1;
      const profile1 = 1 - t1 * t1 * (3 - 2 * t1); // smoothstep
      let strength = profile1 * levelScale1;
      let depth = depth1Raw * profile1 * levelScale1;
      let vWidth = width1;

      // Smooth junction blending: if second-nearest channel is also close,
      // blend the two valley contributions using exponential soft-min
      if (dist2 < Infinity) {
        const width2 = Math.min(10, 1.5 + Math.pow(area2 / 1000, 0.25) * 2.5) * cellSize;
        if (dist2 < width2 * 1.5) {
          const depth2Raw = Math.min(30, 2 + Math.pow(area2 / 500, 0.35) * 5);
          const levelScale2 = level2 <= 1 ? 1.0 : level2 === 2 ? 0.55 : 0.25;
          const t2 = dist2 / width2;
          const profile2 = Math.max(0, 1 - t2 * t2 * (3 - 2 * t2));
          const strength2 = profile2 * levelScale2;
          const depth2 = depth2Raw * profile2 * levelScale2;

          // Smooth union: take the deeper valley, blend where they overlap
          if (depth2 > depth) {
            // Second channel dominates here
            const blend = Math.min(1, (dist1 - dist2 + 2) / 4); // smooth transition zone
            strength = strength * (1 - blend) + strength2 * blend;
            depth = depth * (1 - blend) + depth2 * blend;
            vWidth = vWidth * (1 - blend) + width2 * blend;
          } else if (strength2 > 0.05) {
            // First dominates but add a bit of the second for smooth merge
            const additive = strength2 * 0.3;
            strength = Math.min(1, strength + additive);
            depth = depth + depth2 * 0.2;
          }
        }
      }

      channelStrength[idx] = strength;
      valleyWidth[idx] = vWidth;
      valleyDepth[idx] = depth;
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
