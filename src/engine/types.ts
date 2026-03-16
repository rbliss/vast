/**
 * Shared engine types.
 */

import type { Texture, MeshStandardMaterial, Mesh, BufferGeometry, InstancedMesh } from 'three';
import type { DprController } from './controls/dprController';
import type { LodLevel } from './config';

export interface TerrainAppOptions {
  debug?: boolean;
  dprMode?: 'fixed' | 'auto';
  dprInitial?: number;
}

export interface TerrainUpdateResult {
  now: number;
  dt: number;
}

export interface TextureSet {
  rockDiff: Texture;
  rockDisp: Texture;
  rockNorm: Texture;
  rockRough: Texture;
  rockAo: Texture;
  grassDiff: Texture;
  grassNorm: Texture;
  grassRough: Texture;
  dirtDiff: Texture;
  dirtNorm: Texture;
  dirtRough: Texture;
}

export interface TerrainMaterials {
  matDisp: MeshStandardMaterial;
  matNoDisp: MeshStandardMaterial;
}

export interface ChunkSlot {
  dx: number;
  dz: number;
  lod: LodLevel;
  mesh: Mesh;
  geo: BufferGeometry;
  gridW: number;
  gridVertCount: number;
  skirtVertCount: number;
  totalVertCount: number;
  edgeIndices: number[];
  edgeMinZ: number[];
  edgePlusZ: number[];
  edgeMinX: number[];
  edgePlusX: number[];
  cx: number;
  cz: number;
  foliage?: FoliagePayload;
}

export interface FoliagePayload {
  grass: InstancedMesh;
  rock: InstancedMesh;
  shrub: InstancedMesh;
}

export interface FoliageSystem {
  createInstances: () => FoliagePayload;
  rebuild: (foliage: FoliagePayload, cx: number, cz: number, isFar: boolean) => void;
}

export type { DprController, LodLevel };
