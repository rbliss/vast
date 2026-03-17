/**
 * Shared engine types.
 */

import type { Texture, MeshStandardMaterial, Mesh, BufferGeometry, BufferAttribute, InstancedMesh } from 'three';
import type { DprController } from './controls/dprController';
import type { LodLevel } from './config';

export interface TerrainAppOptions {
  debug?: boolean;
  dprMode?: 'fixed' | 'auto';
  dprInitial?: number;
  rendererMode?: 'webgl' | 'webgpu';
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

/** Typed attribute refs stored on slots to avoid repeated getAttribute casts. */
export interface ChunkSlotAttrs {
  position: BufferAttribute;
  uv: BufferAttribute;
  uv2: BufferAttribute;
  normal: BufferAttribute;
  index: BufferAttribute;
}

export interface ChunkSlot {
  dx: number;
  dz: number;
  lod: LodLevel;
  mesh: Mesh;
  geo: BufferGeometry;
  attrs: ChunkSlotAttrs;
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
  foliage: FoliagePayload;
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

/** Screenshot API response shape. */
export interface ScreenshotUploadResponse {
  ok: boolean;
  filename: string;
  path: string;
  size: number;
}

/** Snapshot API response shape. */
export interface SnapshotUploadResponse {
  ok: boolean;
  id: string;
  filename: string;
  path: string;
  metadataPath: string;
  size: number;
}

/** Typed DOM element lookup — throws if missing. */
export function mustEl<T extends HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing DOM element: #${id}`);
  return el as T;
}

export type { DprController, LodLevel };
