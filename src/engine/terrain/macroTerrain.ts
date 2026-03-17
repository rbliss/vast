/**
 * Composable macro terrain system.
 *
 * Combines parameterized field primitives into a complete heightfield.
 * Three presets demonstrate the system's range:
 *   - chain: mountain corridor with spurs and ridges
 *   - basin: central depression with highland rim
 *   - plateau: elevated mesa with escarpment and lower terrain
 */

import { fbm } from '../noise';
import type { TerrainSource } from './terrainSource';
import {
  rangeField, basinField, plateauField, ridgeField, drainageField,
  type RangeParams, type BasinParams, type PlateauParams,
  type RidgeParams, type DrainageParams,
} from './macroFields';
import { ErodedTerrainSource, type ErosionConfig, DEFAULT_EROSION } from './erodedTerrain';

// ── Configuration ──

export interface MacroTerrainConfig {
  ranges: RangeParams[];
  basins: BasinParams[];
  plateaus: PlateauParams[];
  ridges: RidgeParams[];
  drainages: DrainageParams[];
  /** Low-frequency rolling base */
  baseNoise: { frequency: number; octaves: number; amplitude: number; seed: number };
  /** High-frequency surface detail */
  reliefNoise: { frequency: number; octaves: number; amplitude: number; seed: number };
  /** Final height multiplier (world units) */
  heightScale: number;
  /** Erosion refinement config (null = no erosion) */
  erosion: ErosionConfig | null;
}

// ── Presets ──

const CHAIN_PRESET: MacroTerrainConfig = {
  ranges: [
    // Primary range: NW-SE diagonal
    {
      dirX: 0.707, dirZ: 0.707, offset: 0, width: 45, height: 2.8,
      meanderFreq: 0.004, meanderAmp: 25, alongModFreq: 0.007,
      crestWidth: 18, seed: 42,
    },
    // Secondary spur: branching NE
    {
      dirX: 0.95, dirZ: 0.31, offset: -30, width: 25, height: 1.4,
      meanderFreq: 0.006, meanderAmp: 12, alongModFreq: 0.012,
      crestWidth: 10, seed: 137,
    },
  ],
  basins: [],
  plateaus: [],
  ridges: [
    // Ridge spur from main range
    { startX: -20, startZ: -20, endX: 60, endZ: -80, height: 4, width: 20, sharpness: 1.5, seed: 71 },
    // Foothills ridge
    { startX: -60, startZ: 40, endX: 40, endZ: 80, height: 3, width: 30, sharpness: 1.2, seed: 93 },
  ],
  drainages: [
    // Valley cutting through the range
    { dirX: -0.5, dirZ: 0.866, offset: 15, width: 12, depth: 4, meanderFreq: 0.008, meanderAmp: 8, seed: 201 },
  ],
  baseNoise: { frequency: 0.006, octaves: 4, amplitude: 0.4, seed: 0 },
  reliefNoise: { frequency: 0.04, octaves: 3, amplitude: 0.08, seed: 100 },
  heightScale: 20,
  erosion: { ...DEFAULT_EROSION },
};

const BASIN_PRESET: MacroTerrainConfig = {
  ranges: [
    // Surrounding highland arc (partial ring)
    {
      dirX: 0.0, dirZ: 1.0, offset: -80, width: 35, height: 2.0,
      meanderFreq: 0.005, meanderAmp: 20, alongModFreq: 0.008,
      crestWidth: 14, seed: 55,
    },
    // Second arc segment
    {
      dirX: 0.866, dirZ: 0.5, offset: -60, width: 30, height: 1.6,
      meanderFreq: 0.006, meanderAmp: 15, alongModFreq: 0.01,
      crestWidth: 12, seed: 88,
    },
  ],
  basins: [
    // Central depression
    { centerX: 0, centerZ: 0, radius: 70, depth: 4, rimHeight: 2.5, rimWidth: 0.18, seed: 33 },
  ],
  plateaus: [],
  ridges: [
    // Rim ridges radiating outward
    { startX: 50, startZ: 0, endX: 110, endZ: 30, height: 6, width: 15, sharpness: 1.3, seed: 44 },
    { startX: -40, startZ: 40, endX: -90, endZ: 80, height: 5, width: 18, sharpness: 1.2, seed: 67 },
  ],
  drainages: [
    // Drainage cutting through the rim (outflow corridor)
    { dirX: 0.707, dirZ: -0.707, offset: 5, width: 10, depth: 3, meanderFreq: 0.01, meanderAmp: 6, seed: 150 },
  ],
  baseNoise: { frequency: 0.005, octaves: 4, amplitude: 0.35, seed: 7 },
  reliefNoise: { frequency: 0.035, octaves: 3, amplitude: 0.06, seed: 107 },
  heightScale: 20,
  erosion: {
    ...DEFAULT_EROSION,
    hydraulic: { ...DEFAULT_EROSION.hydraulic, droplets: 60000, seed: 99 },
  },
};

const PLATEAU_PRESET: MacroTerrainConfig = {
  ranges: [
    // Distant background range
    {
      dirX: 0.1, dirZ: 0.995, offset: -120, width: 40, height: 1.8,
      meanderFreq: 0.003, meanderAmp: 20, alongModFreq: 0.006,
      crestWidth: 16, seed: 200,
    },
  ],
  basins: [],
  plateaus: [
    // Main plateau
    { centerX: 0, centerZ: -10, radius: 60, height: 2.5, escarpmentWidth: 30, irregularity: 0.25, seed: 77 },
    // Smaller mesa
    { centerX: 85, centerZ: 55, radius: 28, height: 1.8, escarpmentWidth: 18, irregularity: 0.3, seed: 111 },
  ],
  ridges: [
    // Escarpment-edge ridge
    { startX: -50, startZ: -60, endX: 50, endZ: -70, height: 3, width: 12, sharpness: 2.0, seed: 160 },
  ],
  drainages: [
    // Canyon cutting into the plateau edge
    { dirX: 0.0, dirZ: 1.0, offset: 20, width: 8, depth: 6, meanderFreq: 0.012, meanderAmp: 5, seed: 180 },
    // Secondary canyon
    { dirX: 0.3, dirZ: 0.954, offset: -25, width: 6, depth: 4, meanderFreq: 0.015, meanderAmp: 4, seed: 195 },
  ],
  baseNoise: { frequency: 0.005, octaves: 3, amplitude: 0.25, seed: 15 },
  reliefNoise: { frequency: 0.045, octaves: 3, amplitude: 0.05, seed: 115 },
  heightScale: 20,
  erosion: {
    ...DEFAULT_EROSION,
    hydraulic: { ...DEFAULT_EROSION.hydraulic, droplets: 60000, seed: 77 },
  },
};

export const MACRO_PRESETS: Record<string, MacroTerrainConfig> = {
  chain: CHAIN_PRESET,
  basin: BASIN_PRESET,
  plateau: PLATEAU_PRESET,
};

// ── Terrain source ──

export class MacroTerrainSource implements TerrainSource {
  private readonly _config: MacroTerrainConfig;

  constructor(config: MacroTerrainConfig) {
    this._config = config;
  }

  sampleHeight(x: number, z: number): number {
    const c = this._config;
    let h = 0;

    // Base noise (gentle rolling landform)
    const bn = c.baseNoise;
    h += (fbm(x * bn.frequency + bn.seed, z * bn.frequency + bn.seed + 3.7, bn.octaves, 2.0, 0.5) * 0.5 + 0.5) * bn.amplitude;

    // Additive fields: ranges
    for (const r of c.ranges) {
      h += rangeField(x, z, r);
    }

    // Additive fields: ridges
    for (const r of c.ridges) {
      h += ridgeField(x, z, r);
    }

    // Additive fields: plateaus
    for (const p of c.plateaus) {
      h += plateauField(x, z, p);
    }

    // Subtractive fields: basins
    for (const b of c.basins) {
      h += basinField(x, z, b);
    }

    // Subtractive fields: drainage corridors
    for (const d of c.drainages) {
      h += drainageField(x, z, d);
    }

    // Surface relief
    const rn = c.reliefNoise;
    const medium = fbm(x * rn.frequency + rn.seed, z * rn.frequency + rn.seed + 5.3, rn.octaves, 2.0, 0.5);
    const fine = fbm(x * rn.frequency * 2.5 + rn.seed + 20, z * rn.frequency * 2.5 + rn.seed + 25, 2, 2.0, 0.4);
    h += medium * rn.amplitude + fine * rn.amplitude * 0.3;

    // Clamp to non-negative before scaling
    h = Math.max(0, h);

    return h * c.heightScale;
  }
}

/**
 * Create a macro terrain source, optionally with erosion refinement.
 * When erosion is enabled, the macro source is sampled into a grid,
 * eroded, and the result is served via bilinear interpolation.
 */
export function createMacroTerrainSource(config: MacroTerrainConfig): TerrainSource {
  const base = new MacroTerrainSource(config);
  if (config.erosion) {
    return new ErodedTerrainSource(base, config.erosion);
  }
  return base;
}
