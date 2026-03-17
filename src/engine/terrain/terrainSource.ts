/**
 * Terrain source abstraction.
 *
 * Consumers (chunk geometry, foliage) sample height through this interface
 * instead of importing the procedural height function directly.
 *
 * For macro terrain with erosion, the factory now uses the bake pipeline:
 *   buildBakeRequest → executeBake → BakedTerrainSource
 */

import { terrainHeight, MACRO_HEIGHT_SCALE } from '../terrainHeight';
import type { WorldDocumentV0 } from '../document';
import { MacroTerrainSource, MACRO_PRESETS } from './macroTerrain';
import type { TerrainBakeRequest, TerrainBakeArtifacts } from '../bake/types';
import { runBake, type BakeProgressCallback } from '../bake/terrainBakeManager';
import { BakedTerrainSource } from '../bake/bakedTerrainSource';

// ── Interface ──

export interface TerrainSource {
  /** Sample scaled terrain height at world position (x, z). */
  sampleHeight(x: number, z: number): number;
}

// ── Legacy procedural source ──

export class LegacyProceduralTerrainSource implements TerrainSource {
  private readonly _heightScale: number;

  constructor(heightScale: number = MACRO_HEIGHT_SCALE) {
    this._heightScale = heightScale;
  }

  sampleHeight(x: number, z: number): number {
    return terrainHeight(x, z) * this._heightScale;
  }
}

// ── Bake request builder ──

export function buildBakeRequest(doc: WorldDocumentV0): TerrainBakeRequest | null {
  if (doc.terrain.type !== 'macro') return null;
  const preset = MACRO_PRESETS[doc.terrain.preset || 'chain'];
  if (!preset) return null;
  if (!preset.erosion) return null;

  return {
    macro: preset,
    erosion: preset.erosion,
  };
}

// ── Factory ──

export interface TerrainSourceResult {
  source: TerrainSource;
  /** Bake artifacts if erosion was used (for field textures, diagnostics) */
  bakeArtifacts: TerrainBakeArtifacts | null;
}

export async function createTerrainSource(
  doc: WorldDocumentV0,
  onProgress?: BakeProgressCallback,
): Promise<TerrainSourceResult> {
  if (doc.terrain.type === 'legacyProcedural') {
    return {
      source: new LegacyProceduralTerrainSource(doc.terrain.heightScale),
      bakeArtifacts: null,
    };
  }

  if (doc.terrain.type === 'macro') {
    const preset = MACRO_PRESETS[doc.terrain.preset || 'chain'];
    if (!preset) throw new Error(`Unknown macro preset: ${doc.terrain.preset}`);

    const base = new MacroTerrainSource(preset);

    if (preset.erosion) {
      // Use async bake pipeline (worker if available, main-thread fallback)
      const request = buildBakeRequest(doc)!;
      const artifacts = await runBake(request, onProgress);
      const source = new BakedTerrainSource(base, artifacts);
      return { source, bakeArtifacts: artifacts };
    }

    // No erosion — use raw macro source
    return { source: base, bakeArtifacts: null };
  }

  throw new Error(`Unknown terrain type: ${doc.terrain.type}`);
}
