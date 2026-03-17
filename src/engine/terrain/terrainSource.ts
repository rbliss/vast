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
import type { WorldDocument } from '../document';
import { MacroTerrainSource, MACRO_PRESETS } from './macroTerrain';
import type { TerrainBakeRequest, TerrainBakeArtifacts } from '../bake/types';
import { runBake, type BakeProgressCallback } from '../bake/terrainBakeManager';
import { BakedTerrainSource } from '../bake/bakedTerrainSource';
import { type TerrainDomainConfig, domainFromBakeMetadata, defaultDomain } from '../bake/terrainDomain';

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

export function buildBakeRequest(doc: WorldDocument): TerrainBakeRequest | null {
  if (doc.terrain.type !== 'macro') return null;
  const preset = MACRO_PRESETS[doc.terrain.preset || 'chain'];
  if (!preset) return null;
  if (!preset.erosion) return null;

  // Start from preset defaults, override with document-authored values
  const baseErosion = preset.erosion;
  const docErosion = doc.terrain.erosion;

  return {
    macro: preset,
    erosion: {
      gridSize: doc.terrain.bakeGridSize || baseErosion.gridSize,
      extent: doc.terrain.bakeExtent || baseErosion.extent,
      streamPower: {
        ...baseErosion.streamPower,
        iterations: docErosion.streamPowerIterations ?? baseErosion.streamPower.iterations,
        erosionK: docErosion.erosionStrength ?? baseErosion.streamPower.erosionK,
        diffusionRate: docErosion.diffusionStrength ?? baseErosion.streamPower.diffusionRate,
      },
      thermal: {
        ...baseErosion.thermal,
        iterations: docErosion.thermalIterations ?? baseErosion.thermal.iterations,
      },
      hydraulic: baseErosion.hydraulic,
      fan: {
        ...baseErosion.fan,
        fanBlend: docErosion.fanStrength ?? baseErosion.fan.fanBlend,
      },
    },
  };
}

// ── Factory ──

export interface TerrainSourceResult {
  source: TerrainSource;
  /** Bake artifacts if erosion was used */
  bakeArtifacts: TerrainBakeArtifacts | null;
  /** Terrain domain config — single source of truth for spatial bounds */
  domain: TerrainDomainConfig;
}

export async function createTerrainSource(
  doc: WorldDocument,
  onProgress?: BakeProgressCallback,
): Promise<TerrainSourceResult> {
  if (doc.terrain.type === 'legacyProcedural') {
    return {
      source: new LegacyProceduralTerrainSource(doc.terrain.heightScale),
      bakeArtifacts: null,
      domain: defaultDomain(),
    };
  }

  if (doc.terrain.type === 'macro') {
    const preset = MACRO_PRESETS[doc.terrain.preset || 'chain'];
    if (!preset) throw new Error(`Unknown macro preset: ${doc.terrain.preset}`);

    const base = new MacroTerrainSource(preset);

    if (preset.erosion) {
      let wasCached = false;
      const wrappedProgress: BakeProgressCallback = (p) => {
        if (p.stage === 'cache-hit') wasCached = true;
        onProgress?.(p);
      };
      const request = buildBakeRequest(doc)!;
      const artifacts = await runBake(request, wrappedProgress);
      const source = new BakedTerrainSource(base, artifacts);
      const domain = domainFromBakeMetadata(artifacts.metadata, 256, wasCached);
      return { source, bakeArtifacts: artifacts, domain };
    }

    return { source: base, bakeArtifacts: null, domain: defaultDomain() };
  }

  throw new Error(`Unknown terrain type: ${doc.terrain.type}`);
}
