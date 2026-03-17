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
import { createDefaultDocument } from './engine/document';
import { createTerrainSource } from './engine/terrain/terrainSource';
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

// ── Create world document and apply URL overrides ──
const worldDoc = createDefaultDocument();
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

// ── Startup status overlay ──
const startupEl = document.getElementById('startup-status');
const startupT0 = performance.now();

function setStartupStatus(msg: string) {
  if (startupEl) startupEl.textContent = msg;
}

setStartupStatus('Checking cache...');

const { source: terrainSource, bakeArtifacts, domain: terrainDomain } = await createTerrainSource(worldDoc, (progress) => {
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

// ── Initialize stores ──
projectStore.setDocument(worldDoc);
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
  viewportStore.setPresentationMode(app.isPresentationMode());
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
  syncToolbar();
}) as EventListener);

shell.addEventListener('set-exposure', ((e: CustomEvent) => {
  app.setExposure(e.detail);
  viewportStore.setExposure(e.detail);
  worldDoc.scene.exposure = e.detail;
}) as EventListener);

shell.addEventListener('set-clouds', ((e: CustomEvent) => {
  app.setCloudCoverage(e.detail);
  viewportStore.setCloudCoverage(e.detail);
  worldDoc.scene.cloudCoverage = e.detail;
}) as EventListener);

shell.addEventListener('set-water', ((e: CustomEvent) => {
  app.setWaterLevel(e.detail);
  viewportStore.setWaterLevel(e.detail);
  worldDoc.scene.waterLevel = e.detail;
}) as EventListener);

// ── Inspector events (Class C — rebake required) ──
shell.addEventListener('set-preset', ((e: CustomEvent) => {
  worldDoc.terrain.preset = e.detail;
  projectStore.setPresetName(e.detail);
  authoringStore.setNeedsRebake(true);
  projectStore.markDirty();
}) as EventListener);

// ── Apply document scene state to engine + stores ──
app.setSunDirection(worldDoc.scene.sun.azimuth, worldDoc.scene.sun.elevation);
app.setExposure(worldDoc.scene.exposure);
if (!worldDoc.scene.ibl) app.setIblEnabled(false);
if (worldDoc.scene.presentation) {
  app.setPresentationMode(true).then(syncToolbar);
}
if (params.get('clay') !== null) {
  app.setClayMode(true);
  viewportStore.setClayMode(true);
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
