/**
 * Application entry point.
 * Wires the TerrainApp engine to DOM, UI controls, and animation loop.
 */

import './styles.css';
import './utils/runtimeErrors';

// Register shell components (must be before DOM access)
import './ui/shell/editorShell';
import './ui/shell/toolbarControls';
import './ui/shell/inspectorPanel';

import { TerrainApp } from './engine/TerrainApp';
import { mustEl } from './engine/types';
import { createHud } from './ui/hud';
import { createScreenshotUi } from './ui/screenshotUi';
import { createDefaultDocument, createBlankCanvasDocument, createTestEnvironmentDocument, type WorldDocument } from './engine/document';
import { createTerrainSource } from './engine/terrain/terrainSource';
import {
  autosave, loadAutosave,
  saveDocument, openDocument,
  exportDocumentJSON, importDocumentJSON,
} from './engine/persistence';
import type { EditorShell } from './ui/shell/editorShell';
import type { ToolbarControls } from './ui/shell/toolbarControls';
import { viewportStore } from './stores/viewportStore';
import { projectStore } from './stores/projectStore';
import { authoringStore } from './stores/authoringStore';
import { runtimeStore } from './stores/runtimeStore';

// ── Parse URL params ──
const params = new URLSearchParams(location.search);
const debugMode = params.has('debug');
const dprParam = params.get('dpr');

let dprMode: 'fixed' | 'auto' = 'fixed';
let dprInitial = 2;
if (dprParam === 'auto') {
  dprMode = 'auto';
  dprInitial = Math.min(window.devicePixelRatio, 2);
} else if (dprParam) {
  const v = parseFloat(dprParam);
  if (v >= 1.0 && v <= Math.min(window.devicePixelRatio, 2)) dprInitial = v;
}

// ── Startup status overlay (must init before autosave check) ──
const startupEl = document.getElementById('startup-status');
const startupT0 = performance.now();

function setStartupStatus(msg: string) {
  if (startupEl) startupEl.textContent = msg;
}

// ── Create document: blank canvas by default, test env via ?testenv or ?preset ──
const isTestEnv = params.has('testenv') || params.has('preset');
let worldDoc: WorldDocument;

if (isTestEnv) {
  setStartupStatus('Loading test environment...');
  worldDoc = createTestEnvironmentDocument();
} else {
  setStartupStatus('Starting blank canvas...');
  worldDoc = createBlankCanvasDocument();
}
worldDoc.scene.dpr.mode = dprMode;
worldDoc.scene.dpr.initial = dprInitial;

// Macro terrain preset
const presetParam = params.get('preset');
if (presetParam) {
  worldDoc.terrain.type = 'macro';
  worldDoc.terrain.preset = presetParam;
}

// Scene params from URL
const waterParam = params.get('water');
if (waterParam !== null) worldDoc.scene.waterLevel = parseFloat(waterParam) || 8;
const exposureUrlParam = params.get('exposure');
if (exposureUrlParam) worldDoc.scene.exposure = parseFloat(exposureUrlParam);
const sunAzUrl = params.get('sunaz');
const sunElUrl = params.get('sunel');
if (sunAzUrl) worldDoc.scene.sun.azimuth = parseFloat(sunAzUrl);
if (sunElUrl) worldDoc.scene.sun.elevation = parseFloat(sunElUrl);
if (params.has('present')) worldDoc.scene.presentation = true;
if (params.get('ibl') === 'off') worldDoc.scene.ibl = false;
if (params.get('clay') !== null) { /* clay is viewport-only, not document state */ }

// ── Terrain source: blank canvas (fast) or baked (test environment) ──
let terrainSource: import('./engine/terrain/terrainSource').TerrainSource;
let bakeArtifacts: import('./engine/bake/types').TerrainBakeArtifacts | null = null;
let terrainDomain: import('./engine/bake/terrainDomain').TerrainDomainConfig;

if (isTestEnv) {
  setStartupStatus('Checking cache...');
  const result = await createTerrainSource(worldDoc, (progress) => {
    const elapsed = `${Math.round(progress.elapsedMs / 100) / 10}s`;
    if (progress.stage === 'cache-hit') {
      setStartupStatus('Cache hit — loading terrain...');
    } else {
      const stageLabels: Record<string, string> = {
        'sampling': 'Sampling terrain',
        'stream-power': 'Eroding channels',
        'fan-deposition': 'Building fans',
        'thermal': 'Relaxing slopes',
        'packaging': 'Packaging results',
      };
      const label = stageLabels[progress.stage] || progress.stage;
      setStartupStatus(`Baking terrain: ${label}\n${progress.stageIndex + 1}/${progress.totalStages} · ${elapsed}`);
    }
  });
  terrainSource = result.source;
  bakeArtifacts = result.bakeArtifacts;
  terrainDomain = result.domain;
} else {
  // Blank canvas: use editable heightfield (no bake)
  const { EditableHeightfield } = await import('./engine/terrain/editableHeightfield');
  const hf = new EditableHeightfield(512, 400);
  terrainSource = hf;
  const { defaultDomain } = await import('./engine/bake/terrainDomain');
  terrainDomain = defaultDomain(400);
}

setStartupStatus('Loading app...');

// Water level from document
const waterLevel = worldDoc.scene.waterLevel;

// ── Create engine — canvas goes into viewport host ──
const viewportHost = mustEl('viewport-host');
const app = await TerrainApp.createAsync(viewportHost, worldDoc, terrainSource, {
  debug: debugMode,
  dprMode,
  dprInitial,
  waterLevel,
}, bakeArtifacts, terrainDomain);

// Canvas is already appended to viewportHost by TerrainApp constructor

// ── Shell + toolbar wiring ──
const shell = document.getElementById('shell') as EditorShell;
const toolbar = document.getElementById('toolbar') as ToolbarControls;

// Snapshot UI (still uses the old module for upload logic)
const snapshotUi = createScreenshotUi(
  document.createElement('button'), // dummy button — toolbar handles clicks
  mustEl('shotStatus'),
  {
    getLabel: () => `terrain_${app.centerCX}_${app.centerCZ}`,
    captureFrame: () => app.captureFrame(),
    getSnapshotState: () => app.getSnapshotState(),
  },
);
window.__snapshot = snapshotUi.take;

const hud = createHud(mustEl('fps'));

// ── Toolbar event handlers ──
const sunPresets = [
  { label: 'SW 35°', az: 210, el: 35 },
  { label: 'SE 25°', az: 135, el: 25 },
  { label: 'E 15°', az: 90, el: 15 },
  { label: 'NW 45°', az: 315, el: 45 },
  { label: 'S 60°', az: 180, el: 60 },
];
let sunPresetIdx = 0;

// ── Initialize stores + inspector ──
projectStore.setDocument(worldDoc);
const inspector = document.getElementById('inspector') as any;
if (inspector?.loadFromDocument) {
  inspector.loadFromDocument(worldDoc);
}
projectStore.setPresetName(presetParam || 'default');
runtimeStore.setDomain(terrainDomain);

function syncToolbar() {
  toolbar.clayMode = viewportStore.clayMode;
  toolbar.presentMode = viewportStore.presentationMode;
  toolbar.overlayMode = viewportStore.overlayMode;
  toolbar.sunLabel = sunPresets[sunPresetIdx]?.label ?? viewportStore.sunLabel;
}

shell.addEventListener('toggle-present', async () => {
  await app.setPresentationMode(!app.isPresentationMode());
  const on = app.isPresentationMode();
  viewportStore.setPresentationMode(on);
  worldDoc.scene.presentation = on;
  projectStore.markDirty();
  syncToolbar();
});

shell.addEventListener('toggle-clay', () => {
  app.toggleClayMode();
  viewportStore.setClayMode(app.isClayMode());
  syncToolbar();
});

shell.addEventListener('cycle-overlay', () => {
  const mode = app.cycleOverlay();
  viewportStore.setOverlayMode(mode);
  syncToolbar();
});

shell.addEventListener('cycle-sun', () => {
  sunPresetIdx = (sunPresetIdx + 1) % sunPresets.length;
  const p = sunPresets[sunPresetIdx];
  app.setSunDirection(p.az, p.el);
  viewportStore.setSunDirection(p.az, p.el);
  worldDoc.scene.sun.azimuth = p.az;
  worldDoc.scene.sun.elevation = p.el;
  projectStore.markDirty();
  syncToolbar();
});

shell.addEventListener('take-snapshot', () => {
  snapshotUi.take();
});

// ── Inspector events (Class A — live) ──
shell.addEventListener('set-sun', ((e: CustomEvent) => {
  const { azimuth, elevation } = e.detail;
  app.setSunDirection(azimuth, elevation);
  viewportStore.setSunDirection(azimuth, elevation);
  worldDoc.scene.sun.azimuth = azimuth;
  worldDoc.scene.sun.elevation = elevation;
  projectStore.markDirty();
  syncToolbar();
}) as EventListener);

shell.addEventListener('set-exposure', ((e: CustomEvent) => {
  app.setExposure(e.detail);
  viewportStore.setExposure(e.detail);
  worldDoc.scene.exposure = e.detail;
  projectStore.markDirty();
}) as EventListener);

shell.addEventListener('set-clouds', ((e: CustomEvent) => {
  app.setCloudCoverage(e.detail);
  viewportStore.setCloudCoverage(e.detail);
  worldDoc.scene.cloudCoverage = e.detail;
  projectStore.markDirty();
}) as EventListener);

shell.addEventListener('set-water', ((e: CustomEvent) => {
  app.setWaterLevel(e.detail);
  viewportStore.setWaterLevel(e.detail);
  worldDoc.scene.waterLevel = e.detail;
  projectStore.markDirty();
}) as EventListener);

// ── Inspector terrain param changes (Class C — rebake) ──
shell.addEventListener('set-terrain-param', ((e: CustomEvent) => {
  const { key, value } = e.detail;
  switch (key) {
    case 'preset':
      worldDoc.terrain.preset = value;
      worldDoc.terrain.type = 'macro';
      projectStore.setPresetName(value);
      break;
    case 'spIterations':
      worldDoc.terrain.erosion.streamPowerIterations = value;
      break;
    case 'erosionStrength':
      worldDoc.terrain.erosion.erosionStrength = value;
      break;
    case 'diffusionStrength':
      worldDoc.terrain.erosion.diffusionStrength = value;
      break;
    case 'fanStrength':
      worldDoc.terrain.erosion.fanStrength = value;
      break;
    case 'thermalIterations':
      worldDoc.terrain.erosion.thermalIterations = value;
      break;
  }
  authoringStore.setNeedsRebake(true);
  projectStore.markDirty();
}) as EventListener);

// ── Inspector material changes (Live — uniforms update immediately) ──
shell.addEventListener('set-material', ((e: CustomEvent) => {
  Object.assign(worldDoc.materials, e.detail);
  app.setMaterialParams(e.detail);
  projectStore.markDirty();
}) as EventListener);

// ── Inspector scatter changes (Apply — rebuilds foliage) ──
shell.addEventListener('set-scatter', ((e: CustomEvent) => {
  Object.assign(worldDoc.scatter, e.detail);
  app.applyScatterParams(worldDoc.scatter);
  projectStore.markDirty();
}) as EventListener);

// ── Rebake action ──
shell.addEventListener('rebake', (async () => {
  authoringStore.setBakeState('baking');
  authoringStore.setBakeProgress('Starting rebake...');
  shell.statusText = 'Rebaking terrain...';

  try {
    const { source, bakeArtifacts: newArtifacts, domain: newDomain } = await createTerrainSource(
      worldDoc,
      (progress) => {
        const stageLabels: Record<string, string> = {
          'sampling': 'Sampling', 'stream-power': 'Eroding', 'fan-deposition': 'Fans',
          'thermal': 'Relaxing', 'packaging': 'Packaging', 'cache-hit': 'Cache hit',
        };
        authoringStore.setBakeProgress(`${stageLabels[progress.stage] ?? progress.stage} (${progress.stageIndex + 1}/${progress.totalStages})`);
        shell.statusText = `Rebaking: ${stageLabels[progress.stage] ?? progress.stage}`;
      },
    );

    // Swap terrain
    app.applyNewTerrain({ source, bakeArtifacts: newArtifacts, domain: newDomain });

    // Update stores
    runtimeStore.setDomain(newDomain);
    authoringStore.setNeedsRebake(false);
    authoringStore.setBakeState('complete');
    authoringStore.setLastBakeTime(newDomain.bakeTimeMs);
    shell.statusText = runtimeStore.statusLine;
    projectStore.markDirty();

    console.log('[rebake] complete');
  } catch (err) {
    authoringStore.setBakeState('error');
    authoringStore.setBakeProgress(`Error: ${err instanceof Error ? err.message : err}`);
    shell.statusText = 'Rebake failed — previous terrain active';
    console.error('[rebake] failed:', err);
  }
}) as EventListener);

// ── Environment switching ──
shell.addEventListener('blank-canvas', () => {
  window.location.href = '/';
});

shell.addEventListener('test-environment', () => {
  window.location.href = '/?testenv';
});

shell.addEventListener('reset-canvas', () => {
  app.resetCanvas();
});

// ── Save / Open / Autosave ──
shell.addEventListener('save-project', (async () => {
  if (!isTestEnv) {
    toolbar.saveStatus = 'Save not available in canvas mode';
    setTimeout(() => { toolbar.saveStatus = ''; }, 2000);
    return;
  }
  toolbar.saveStatus = 'Saving...';
  const ok = await saveDocument(worldDoc);
  if (ok) {
    projectStore.setSaveStatus('clean');
    toolbar.saveStatus = 'Saved';
    setTimeout(() => { toolbar.saveStatus = ''; }, 2000);
  } else {
    // Try JSON export as fallback
    exportDocumentJSON(worldDoc);
    toolbar.saveStatus = 'Exported';
    setTimeout(() => { toolbar.saveStatus = ''; }, 2000);
  }
}) as EventListener);

shell.addEventListener('open-project', (async () => {
  // Try File System Access first, fall back to JSON import
  let doc = await openDocument();
  if (!doc) {
    doc = await importDocumentJSON();
  }
  if (!doc) return;

  // Apply loaded document
  Object.assign(worldDoc, doc);
  projectStore.setDocument(worldDoc);
  projectStore.setPresetName(worldDoc.terrain.preset);
  projectStore.setSaveStatus('clean');

  // Update scene live state from loaded document
  app.setSunDirection(worldDoc.scene.sun.azimuth, worldDoc.scene.sun.elevation);
  app.setExposure(worldDoc.scene.exposure);
  app.setCloudCoverage(worldDoc.scene.cloudCoverage);
  app.setWaterLevel(worldDoc.scene.waterLevel);
  app.setIblEnabled(worldDoc.scene.ibl);
  if (worldDoc.scene.presentation !== app.isPresentationMode()) {
    await app.setPresentationMode(worldDoc.scene.presentation);
  }
  viewportStore.setSunDirection(worldDoc.scene.sun.azimuth, worldDoc.scene.sun.elevation);
  viewportStore.setExposure(worldDoc.scene.exposure);
  viewportStore.setCloudCoverage(worldDoc.scene.cloudCoverage);
  viewportStore.setWaterLevel(worldDoc.scene.waterLevel);
  viewportStore.setIblEnabled(worldDoc.scene.ibl);
  viewportStore.setPresentationMode(worldDoc.scene.presentation);

  // Update inspector
  const insp = document.getElementById('inspector') as any;
  if (insp?.loadFromDocument) insp.loadFromDocument(worldDoc);

  // Mark terrain for rebake (different preset/params)
  authoringStore.setNeedsRebake(true);
  syncToolbar();
  shell.statusText = `Loaded: ${worldDoc.meta.name}`;
}) as EventListener);

// Autosave on dirty (debounced)
let autosaveTimer: ReturnType<typeof setTimeout> | null = null;
projectStore.subscribe(() => {
  if (projectStore.saveStatus === 'dirty') {
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
      const ok = await autosave(worldDoc);
      if (ok) {
        toolbar.saveStatus = 'Draft saved';
        setTimeout(() => { toolbar.saveStatus = ''; }, 1500);
      }
    }, 3000); // 3s debounce
  }
});

// ── Apply document state to engine + stores ──
app.setSunDirection(worldDoc.scene.sun.azimuth, worldDoc.scene.sun.elevation);
app.setExposure(worldDoc.scene.exposure);
app.setMaterialParams(worldDoc.materials);
app.applyScatterParams(worldDoc.scatter);
if (!worldDoc.scene.ibl) app.setIblEnabled(false);
if (worldDoc.scene.presentation) {
  app.setPresentationMode(true).then(syncToolbar);
}
// Clay mode: always on for blank canvas, optional for test env
if (!isTestEnv || !params.has('textured')) {
  app.setClayMode(true);
  viewportStore.setClayMode(true);
}

// ── Blank canvas: init editable heightfield + sculpt interaction ──
if (!isTestEnv && terrainSource instanceof (await import('./engine/terrain/editableHeightfield')).EditableHeightfield) {
  app.initEditableMode(512, 400, terrainSource as any);

  // Sculpt: click to raise terrain
  let brushRadius = 20;
  let brushStrength = 10;

  // Wire brush controls from inspector
  shell.addEventListener('set-brush', ((e: CustomEvent) => {
    brushRadius = e.detail.radius;
    brushStrength = e.detail.strength;
  }) as EventListener);

  // Brush preview on hover — throttled to once per frame
  let pendingMouseNDC: { x: number; y: number } | null = null;
  let hoverRAF: number | null = null;

  viewportHost.addEventListener('mousemove', (e: MouseEvent) => {
    const rect = viewportHost.getBoundingClientRect();
    pendingMouseNDC = {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
    if (!hoverRAF) {
      hoverRAF = requestAnimationFrame(() => {
        hoverRAF = null;
        if (pendingMouseNDC) {
          const hit = app.raycastTerrain(pendingMouseNDC.x, pendingMouseNDC.y);
          if (hit) {
            app.updateBrushPreview(hit.x, hit.z, brushRadius);
          } else {
            app.hideBrushPreview();
          }
        }
      });
    }
  });

  viewportHost.addEventListener('mouseleave', () => {
    pendingMouseNDC = null;
    app.hideBrushPreview();
  });

  // Sculpt: click and drag to raise
  let sculpting = false;
  let lastStampX = 0;
  let lastStampZ = 0;
  const stampSpacing = () => brushRadius * 0.4;
  const dragStrengthScale = 0.15; // drag is much gentler than click

  function getNDC(e: MouseEvent) {
    const rect = viewportHost.getBoundingClientRect();
    return {
      x: ((e.clientX - rect.left) / rect.width) * 2 - 1,
      y: -((e.clientY - rect.top) / rect.height) * 2 + 1,
    };
  }

  viewportHost.addEventListener('pointerdown', (e: PointerEvent) => {
    if (e.button !== 0) return; // left button only
    const ndc = getNDC(e);
    const hit = app.raycastTerrain(ndc.x, ndc.y);
    if (!hit) return;

    sculpting = true;
    viewportHost.setPointerCapture(e.pointerId);

    // Suspend orbit controls during sculpt drag
    app.controls.enabled = false;

    // Begin stroke (one undo entry for entire drag)
    app.beginStroke();
    app.applyBrushStamp({ x: hit.x, z: hit.z, radius: brushRadius, strength: brushStrength });
    lastStampX = hit.x;
    lastStampZ = hit.z;

    e.preventDefault();
  });

  viewportHost.addEventListener('pointermove', (e: PointerEvent) => {
    if (!sculpting) return;
    const ndc = getNDC(e);
    const hit = app.raycastTerrain(ndc.x, ndc.y);
    if (!hit) return;

    // Interpolate stamps along the drag path to prevent gaps
    const dx = hit.x - lastStampX;
    const dz = hit.z - lastStampZ;
    const dist = Math.sqrt(dx * dx + dz * dz);
    const spacing = stampSpacing();

    if (dist >= spacing) {
      const steps = Math.ceil(dist / spacing);
      for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        const sx = lastStampX + dx * t;
        const sz = lastStampZ + dz * t;
        app.applyBrushStamp({ x: sx, z: sz, radius: brushRadius, strength: brushStrength * dragStrengthScale });
      }
      lastStampX = hit.x;
      lastStampZ = hit.z;
    }

    // Update brush preview during drag
    app.updateBrushPreview(hit.x, hit.z, brushRadius);
  });

  viewportHost.addEventListener('pointerup', (e: PointerEvent) => {
    if (!sculpting) return;
    sculpting = false;
    viewportHost.releasePointerCapture(e.pointerId);

    // End stroke (commit to undo history)
    app.endStroke();

    // Re-enable orbit controls
    app.controls.enabled = true;
  });

  // Undo/Redo shortcuts
  document.addEventListener('keydown', (e: KeyboardEvent) => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
      e.preventDefault();
      app.undoSculpt();
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
      e.preventDefault();
      app.redoSculpt();
    }
  });
}
viewportStore.setSunDirection(worldDoc.scene.sun.azimuth, worldDoc.scene.sun.elevation);
viewportStore.setExposure(worldDoc.scene.exposure);
viewportStore.setIblEnabled(worldDoc.scene.ibl);
viewportStore.setPresentationMode(worldDoc.scene.presentation);
viewportStore.setWaterLevel(worldDoc.scene.waterLevel);
viewportStore.setCloudCoverage(worldDoc.scene.cloudCoverage);
syncToolbar();

// ── Status bar from runtime store ──
shell.statusText = runtimeStore.statusLine;
runtimeStore.subscribe(() => {
  shell.statusText = runtimeStore.statusLine;
});

// ── Resize via ResizeObserver on viewport host ──
const resizeObserver = new ResizeObserver((entries) => {
  for (const entry of entries) {
    const { width, height } = entry.contentRect;
    if (width > 0 && height > 0) {
      app.resize(width, height);
    }
  }
});
resizeObserver.observe(viewportHost);

// ── Debug access ──
if (debugMode) {
  window.__app = app;
  window.__controls = app.controls;
  window.__camera = app.camera;
  window.__scene = app.scene;
}

// ── Review harness: window.__reviewCapture() ──
import { REVIEW_PRESETS, computeReviewCamera } from './engine/reviewHarness';

/** Capture all review views for the current preset in clay mode */
(window as any).__reviewCapture = async function(presetName?: string) {
  const preset = presetName || worldDoc.terrain.preset || 'chain';
  const reviewPreset = REVIEW_PRESETS.find(p => p.preset === preset);
  if (!reviewPreset) {
    console.error(`[review] no review preset for: ${preset}`);
    return;
  }

  // Enable clay mode
  const wasClay = app.isClayMode();
  if (!wasClay) app.setClayMode(true);

  console.log(`[review] capturing ${reviewPreset.views.length} views for "${preset}"`);

  for (const view of reviewPreset.views) {
    const { camPos, tgtPos } = computeReviewCamera(view, app.terrain);
    app.camera.position.set(...camPos);
    app.controls.target.set(...tgtPos);
    app.controls.update();

    // Wait for render
    await new Promise(r => setTimeout(r, 500));
    app.update();
    await new Promise(r => setTimeout(r, 500));

    const image = await app.captureFrame();
    const label = view.name;

    // Upload via snapshot API
    const metadata = {
      ...app.getSnapshotState(),
      reviewView: view.name,
      reviewJudges: view.judges,
      reviewPreset: preset,
      clayMode: true,
    };

    try {
      const resp = await fetch('/api/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, label, format: 'png', metadata }),
      });
      if (resp.ok) {
        const result = await resp.json();
        console.log(`[review] ${view.name}: ${result.id} — judges: ${view.judges}`);
      }
    } catch (err) {
      console.error(`[review] ${view.name} failed:`, err);
    }
  }

  // Restore clay state
  if (!wasClay) app.setClayMode(false);
  console.log(`[review] done`);
};

// ── Animate ──
function animate() {
  requestAnimationFrame(animate);
  const { now } = app.update();
  const hudResult = hud.tick(now, app.dpr.ctrl);
  if (hudResult) {
    app.dpr.update(hudResult.fps, 500);
  }
}

animate();

// Hide startup overlay + record startup time
const startupMs = Math.round(performance.now() - startupT0);
runtimeStore.setStartupMs(startupMs);
if (startupEl) {
  startupEl.classList.add('hidden');
  setTimeout(() => startupEl.remove(), 500);
}

console.log(`[terrain] WebGPU | revZ: ${app.reversedDepthSupported} | IBL: ${app.isIblEnabled()}`);
console.log(`[terrain] domain: extent ±${terrainDomain.extent} | erosion: ${terrainDomain.hasErosion} | cache: ${terrainDomain.fromCache} | bake: ${terrainDomain.bakeTimeMs.toFixed(0)}ms`);
console.log(`[terrain] startup: ${startupMs}ms total`);
