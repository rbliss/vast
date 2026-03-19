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

  // AE2.4: Continuous network-wide field construction
  // Walk each edge path and paint smooth valley corridors into the raster fields.
  // Width/depth are regularized along each path (monotone widening downstream).
  // Contributions accumulate via smooth-max, not nearest-segment switching.

  for (const edge of graph.edges) {
    const src = graph.nodes[edge.from];
    const dst = graph.nodes[edge.to];
    const path = edge.path;
    const nPts = path.length / 2;
    if (nPts < 2) continue;

    const levelScale = edge.level <= 1 ? 1.0 : edge.level === 2 ? 0.55 : 0.25;

    // Walk along the smoothed path, painting corridor at each sample point
    const sampleStep = Math.max(1, Math.floor(nPts / 40)); // ~40 samples per edge max
    for (let p = 0; p < nPts; p += sampleStep) {
      const px = path[p * 2], pz = path[p * 2 + 1];
      const t = p / Math.max(1, nPts - 1); // 0 at src, 1 at dst

      // Interpolate area along path (monotone: always use max of src/dst)
      const pArea = src.area + (dst.area - src.area) * t;
      const effectiveArea = Math.max(pArea, src.area * 0.5); // never drop below half src area

      // Width/depth from area — smooth, continuous
      const halfWidth = Math.min(8, 1.2 + Math.pow(effectiveArea / 800, 0.25) * 2) * cellSize;
      const maxDepth = Math.min(25, 1.5 + Math.pow(effectiveArea / 400, 0.35) * 4) * levelScale;

      // Paint into raster within the corridor radius
      const radiusCells = Math.ceil(halfWidth / cellSize) + 1;
      const cx = Math.round(px), cz = Math.round(pz);

      for (let dz = -radiusCells; dz <= radiusCells; dz++) {
        for (let dx = -radiusCells; dx <= radiusCells; dx++) {
          const nx = cx + dx, nz = cz + dz;
          if (nx < 0 || nx >= w || nz < 0 || nz >= h) continue;

          const dist = Math.sqrt(dx * dx + dz * dz) * cellSize;
          if (dist >= halfWidth) continue;

          const ni = nz * w + nx;
          const dt = dist / halfWidth;
          // Smooth valley cross-section
          const profile = 1 - dt * dt * (3 - 2 * dt); // smoothstep
          const depthHere = maxDepth * profile;
          const strengthHere = profile * levelScale;

          // Smooth-max accumulation: keep the deepest/strongest contribution
          // This naturally handles junctions — overlapping valleys merge smoothly
          if (depthHere > valleyDepth[ni]) {
            valleyDepth[ni] = depthHere;
            channelStrength[ni] = strengthHere;
            valleyWidth[ni] = halfWidth;
          } else if (depthHere > valleyDepth[ni] * 0.5) {
            // Additive blending for nearby overlapping valleys
            valleyDepth[ni] = valleyDepth[ni] * 0.7 + depthHere * 0.3;
            channelStrength[ni] = Math.min(1, channelStrength[ni] + strengthHere * 0.2);
          }

          if (dist < distToChannel[ni]) distToChannel[ni] = dist;
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
