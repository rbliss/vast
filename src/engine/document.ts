/**
 * World document schema v0.
 *
 * Represents the serialized state of a VAST world.
 * The v0 shape is deliberately minimal — it encodes just enough
 * to boot the current runtime from saved defaults and provides
 * a placeholder layer stack for future terrain/material/object layers.
 */

// ── Schema types ──

export interface WorldDocumentV0 {
  schema: 'vast-world';
  version: 0;
  meta: {
    name: string;
    created: string;
    modified: string;
  };
  terrain: {
    type: 'legacyProcedural' | 'macro';
    heightScale: number;
    /** Macro terrain preset name (only for type 'macro') */
    preset?: string;
  };
  scene: {
    camera: {
      position: [number, number, number];
      target: [number, number, number];
      fov: number;
    };
    ibl: boolean;
    dpr: {
      mode: 'fixed' | 'auto';
      initial: number;
    };
  };
  layers: WorldLayerV0[];
}

/** Placeholder layer type — future layers (sculpt, stamp, mask, material, object, scene) extend this. */
export interface WorldLayerV0 {
  id: string;
  type: string;
  name: string;
  enabled: boolean;
}

// ── Factory ──

export function createDefaultDocument(): WorldDocumentV0 {
  const now = new Date().toISOString();
  return {
    schema: 'vast-world',
    version: 0,
    meta: {
      name: 'Untitled World',
      created: now,
      modified: now,
    },
    terrain: {
      type: 'legacyProcedural',
      heightScale: 20,
    },
    scene: {
      camera: {
        position: [50, 50, 50],
        target: [0, 0, 0],
        fov: 55,
      },
      ibl: true,
      dpr: {
        mode: 'fixed',
        initial: 2,
      },
    },
    layers: [],
  };
}

// ── Serialization ──

export function serializeDocument(doc: WorldDocumentV0): string {
  doc.meta.modified = new Date().toISOString();
  return JSON.stringify(doc, null, 2);
}

export function deserializeDocument(json: string): WorldDocumentV0 {
  const raw = JSON.parse(json);
  if (raw.schema !== 'vast-world') {
    throw new Error(`Unknown document schema: ${raw.schema}`);
  }
  if (raw.version !== 0) {
    throw new Error(`Unsupported document version: ${raw.version}`);
  }
  return raw as WorldDocumentV0;
}
