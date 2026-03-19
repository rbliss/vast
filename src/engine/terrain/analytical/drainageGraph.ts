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

  // Rasterize graph EDGES (not isolated nodes) to create continuous valley corridors.
  // For each edge, walk from source to target and stamp a width-profile along the path.
  for (const edge of graph.edges) {
    const src = graph.nodes[edge.from];
    const dst = graph.nodes[edge.to];

    // Interpolate along the edge
    const edgeDx = dst.x - src.x;
    const edgeDz = dst.z - src.z;
    const edgeLen = Math.sqrt(edgeDx * edgeDx + edgeDz * edgeDz);
    if (edgeLen < 0.5) continue;

    const steps = Math.max(1, Math.ceil(edgeLen));
    for (let s = 0; s <= steps; s++) {
      const t = s / steps;
      const px = src.x + edgeDx * t;
      const pz = src.z + edgeDz * t;
      const pArea = src.area + (dst.area - src.area) * t;

      // Valley width and depth scale with area along the edge
      const width = Math.min(10, 1.5 + Math.pow(pArea / 1000, 0.25) * 2.5) * cellSize;
      const depth = Math.min(35, 2 + Math.pow(pArea / 500, 0.35) * 6);
      const levelScale = edge.level <= 1 ? 1.0 : edge.level === 2 ? 0.6 : 0.35;

      const radiusCells = Math.ceil(width / cellSize) + 1;
      const cx = Math.round(px), cz = Math.round(pz);

      for (let dz = -radiusCells; dz <= radiusCells; dz++) {
        for (let dx = -radiusCells; dx <= radiusCells; dx++) {
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;

          const ni = nz * w + nx;
          const dist = Math.sqrt(dx * dx + dz * dz) * cellSize;

          if (dist < distToChannel[ni]) distToChannel[ni] = dist;

          if (dist < width) {
            const dt = dist / width;
            const profileStrength = 1 - dt * dt; // quadratic V-profile
            const strength = profileStrength * levelScale;

            if (strength > channelStrength[ni]) {
              channelStrength[ni] = strength;
              valleyWidth[ni] = width;
              valleyDepth[ni] = depth * profileStrength;
            }
          }
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
