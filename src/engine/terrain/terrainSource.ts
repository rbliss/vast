/**
 * Terrain source abstraction.
 *
 * Consumers (chunk geometry, foliage) sample height through this interface
 * instead of importing the procedural height function directly.
 * This is the migration seam: future field-backed or document-driven
 * terrain sources implement the same interface.
 */

import { terrainHeight, MACRO_HEIGHT_SCALE } from '../terrainHeight';
import type { WorldDocumentV0 } from '../document';
import { createMacroTerrainSource, MACRO_PRESETS } from './macroTerrain';

// ── Interface ──

export interface TerrainSource {
  /** Sample scaled terrain height at world position (x, z). */
  sampleHeight(x: number, z: number): number;
}

// ── Legacy procedural source ──

/**
 * Wraps the existing 4-layer procedural heightfield.
 * Produces identical output to the pre-abstraction code path.
 */
export class LegacyProceduralTerrainSource implements TerrainSource {
  private readonly _heightScale: number;

  constructor(heightScale: number = MACRO_HEIGHT_SCALE) {
    this._heightScale = heightScale;
  }

  sampleHeight(x: number, z: number): number {
    return terrainHeight(x, z) * this._heightScale;
  }
}

// ── Factory ──

export function createTerrainSource(doc: WorldDocumentV0): TerrainSource {
  if (doc.terrain.type === 'legacyProcedural') {
    return new LegacyProceduralTerrainSource(doc.terrain.heightScale);
  }
  if (doc.terrain.type === 'macro') {
    const preset = MACRO_PRESETS[doc.terrain.preset || 'chain'];
    if (!preset) throw new Error(`Unknown macro preset: ${doc.terrain.preset}`);
    return createMacroTerrainSource(preset);
  }
  throw new Error(`Unknown terrain type: ${doc.terrain.type}`);
}
