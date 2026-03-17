/**
 * Debug overlay: color terrain vertices using derived map data.
 *
 * When active, vertex colors are written into chunk geometry
 * from slope/curvature/flow maps. Works with clay mode to
 * visualize terrain analysis without material interference.
 */

import * as THREE from 'three';
import type { ChunkSlot } from '../types';
import type { TerrainSource } from './terrainSource';
import {
  generateDerivedMaps, slopeToColor, curvatureToColor, flowToColor,
  type TileRegion,
} from './derivedMaps';
import { CHUNK_SIZE } from '../config';

export type OverlayMode = 'none' | 'slope' | 'curvature' | 'flow';

/**
 * Generate derived maps for a chunk and write vertex colors into its geometry.
 */
export function applyDebugOverlay(
  slot: ChunkSlot,
  terrain: TerrainSource,
  mode: OverlayMode,
): void {
  if (mode === 'none') {
    // Remove vertex colors
    if (slot.geo.hasAttribute('color')) {
      slot.geo.deleteAttribute('color');
      (slot.mesh.material as THREE.MeshStandardMaterial).vertexColors = false;
      (slot.mesh.material as THREE.MeshStandardMaterial).needsUpdate = true;
    }
    return;
  }

  const gridW = slot.gridW;
  const gridH = gridW; // Square chunks

  // Define tile region for this chunk
  const region: TileRegion = {
    originX: slot.cx * CHUNK_SIZE - CHUNK_SIZE / 2,
    originZ: slot.cz * CHUNK_SIZE - CHUNK_SIZE / 2,
    cellSize: CHUNK_SIZE / (gridW - 1),
    gridW,
    gridH,
  };

  // Generate derived maps
  const maps = generateDerivedMaps(terrain, region);

  // Create or reuse vertex color buffer
  let colorAttr = slot.geo.getAttribute('color') as THREE.BufferAttribute | null;
  if (!colorAttr || colorAttr.count !== slot.totalVertCount) {
    const colorArr = new Float32Array(slot.totalVertCount * 3);
    colorAttr = new THREE.BufferAttribute(colorArr, 3);
    slot.geo.setAttribute('color', colorAttr);
  }

  // Pick color mapper
  const colorFn = mode === 'slope' ? slopeToColor
    : mode === 'curvature' ? curvatureToColor
    : flowToColor;

  // Map derived data to vertex colors for grid vertices
  const mapData = mode === 'slope' ? maps.slope
    : mode === 'curvature' ? maps.curvature
    : maps.flow;

  for (let i = 0; i < slot.gridVertCount; i++) {
    // Map vertex index to grid position
    const gx = i % gridW;
    const gz = Math.floor(i / gridW);
    const mapIdx = gz * maps.width + gx;
    const value = mapIdx < mapData.length ? mapData[mapIdx] : 0;
    const [r, g, b] = colorFn(value);
    colorAttr.setXYZ(i, r, g, b);
  }

  // Skirt vertices: copy from their edge vertex
  for (let i = 0; i < slot.skirtVertCount; i++) {
    const ei = slot.edgeIndices[i];
    const ni = slot.gridVertCount + i;
    colorAttr.setXYZ(ni,
      colorAttr.getX(ei),
      colorAttr.getY(ei),
      colorAttr.getZ(ei),
    );
  }

  colorAttr.needsUpdate = true;

  // Enable vertex colors on the material
  const mat = slot.mesh.material as THREE.MeshStandardMaterial;
  if (!mat.vertexColors) {
    mat.vertexColors = true;
    mat.needsUpdate = true;
  }
}
