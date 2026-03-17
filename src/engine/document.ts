/**
 * World document schema.
 *
 * V0: minimal boot config (legacy)
 * V1: full Phase A-E parameter surface
 *
 * All versions share the same `vast-world` schema identifier.
 * Migration from v0 → v1 applies defaults for new fields.
 */

// ── V0 (legacy, still loadable) ──

export interface WorldDocumentV0 {
  schema: 'vast-world';
  version: 0;
  meta: { name: string; created: string; modified: string };
  terrain: {
    type: 'legacyProcedural' | 'macro';
    heightScale: number;
    preset?: string;
  };
  scene: {
    camera: { position: [number, number, number]; target: [number, number, number]; fov: number };
    ibl: boolean;
    dpr: { mode: 'fixed' | 'auto'; initial: number };
  };
  layers: WorldLayerV0[];
}

export interface WorldLayerV0 {
  id: string; type: string; name: string; enabled: boolean;
}

// ── V1 (current) ──

export interface WorldDocumentV1 {
  schema: 'vast-world';
  version: 1;
  meta: {
    name: string;
    created: string;
    modified: string;
  };

  terrain: {
    type: 'legacyProcedural' | 'macro';
    heightScale: number;
    preset: string;
    /** Bake domain */
    bakeExtent: number;
    bakeGridSize: number;
    /** Erosion parameters (Class C — rebake required) */
    erosion: {
      streamPowerIterations: number;
      erosionStrength: number;
      diffusionStrength: number;
      fanStrength: number;
      thermalIterations: number;
    };
  };

  materials: {
    /** Snow altitude threshold (normalized 0-1) */
    snowThreshold: number;
    /** Rock slope dominance threshold */
    rockSlopeMin: number;
    rockSlopeMax: number;
    /** Sediment emphasis (0-1) */
    sedimentEmphasis: number;
  };

  scatter: {
    grassDensity: number;
    shrubDensity: number;
    rockDensity: number;
    /** Alpine cutoff (normalized altitude, no vegetation above) */
    alpineCutoff: number;
    /** Debris emphasis in depositional zones */
    debrisEmphasis: number;
  };

  scene: {
    camera: {
      position: [number, number, number];
      target: [number, number, number];
      fov: number;
    };
    sun: {
      azimuth: number;
      elevation: number;
    };
    exposure: number;
    waterLevel: number | null;
    cloudCoverage: number;
    ibl: boolean;
    presentation: boolean;
    dpr: { mode: 'fixed' | 'auto'; initial: number };
  };

  layers: WorldLayerV0[];
}

/** The current document type used throughout the app */
export type WorldDocument = WorldDocumentV1;

// ── Defaults ──

export function createDefaultDocument(): WorldDocument {
  const now = new Date().toISOString();
  return {
    schema: 'vast-world',
    version: 1,
    meta: {
      name: 'Untitled World',
      created: now,
      modified: now,
    },
    terrain: {
      type: 'legacyProcedural',
      heightScale: 20,
      preset: 'chain',
      bakeExtent: 200,
      bakeGridSize: 512,
      erosion: {
        streamPowerIterations: 25,
        erosionStrength: 0.004,
        diffusionStrength: 0.01,
        fanStrength: 0.8,
        thermalIterations: 20,
      },
    },
    materials: {
      snowThreshold: 0.78,
      rockSlopeMin: 0.3,
      rockSlopeMax: 0.6,
      sedimentEmphasis: 0.4,
    },
    scatter: {
      grassDensity: 1.0,
      shrubDensity: 1.0,
      rockDensity: 1.0,
      alpineCutoff: 0.78,
      debrisEmphasis: 1.0,
    },
    scene: {
      camera: {
        position: [150, 100, 150],
        target: [0, 10, 0],
        fov: 55,
      },
      sun: { azimuth: 210, elevation: 35 },
      exposure: 1.0,
      waterLevel: null,
      cloudCoverage: 0.55,
      ibl: true,
      presentation: false,
      dpr: { mode: 'fixed', initial: 2 },
    },
    layers: [],
  };
}

// ── Migration ──

function migrateV0ToV1(v0: WorldDocumentV0): WorldDocument {
  const defaults = createDefaultDocument();
  return {
    schema: 'vast-world',
    version: 1,
    meta: { ...v0.meta },
    terrain: {
      type: v0.terrain.type,
      heightScale: v0.terrain.heightScale,
      preset: v0.terrain.preset || 'chain',
      bakeExtent: defaults.terrain.bakeExtent,
      bakeGridSize: defaults.terrain.bakeGridSize,
      erosion: { ...defaults.terrain.erosion },
    },
    materials: { ...defaults.materials },
    scatter: { ...defaults.scatter },
    scene: {
      camera: { ...v0.scene.camera },
      sun: { ...defaults.scene.sun },
      exposure: defaults.scene.exposure,
      waterLevel: defaults.scene.waterLevel,
      cloudCoverage: defaults.scene.cloudCoverage,
      ibl: v0.scene.ibl,
      presentation: defaults.scene.presentation,
      dpr: { ...v0.scene.dpr },
    },
    layers: [...v0.layers],
  };
}

// ── Serialization ──

export function serializeDocument(doc: WorldDocument): string {
  doc.meta.modified = new Date().toISOString();
  return JSON.stringify(doc, null, 2);
}

export function deserializeDocument(json: string): WorldDocument {
  const raw = JSON.parse(json);
  if (raw.schema !== 'vast-world') {
    throw new Error(`Unknown document schema: ${raw.schema}`);
  }
  if (raw.version === 0) {
    return migrateV0ToV1(raw as WorldDocumentV0);
  }
  if (raw.version === 1) {
    return raw as WorldDocument;
  }
  throw new Error(`Unsupported document version: ${raw.version}`);
}
