/**
 * Application entry point.
 * Wires the TerrainApp engine to DOM, UI controls, and animation loop.
 */

import './styles.css';
import './utils/runtimeErrors';

// Register shell components (must be before DOM access)
import './ui/shell/editorShell';
import './ui/shell/toolbarControls';

import { TerrainApp } from './engine/TerrainApp';
import { mustEl } from './engine/types';
import { createHud } from './ui/hud';
import { createScreenshotUi } from './ui/screenshotUi';
import { createDefaultDocument } from './engine/document';
import { createTerrainSource } from './engine/terrain/terrainSource';
import type { EditorShell } from './ui/shell/editorShell';
import type { ToolbarControls } from './ui/shell/toolbarControls';

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

// ── Create world document and terrain source ──
const worldDoc = createDefaultDocument();
// Apply URL-driven overrides to document defaults
worldDoc.scene.dpr.mode = dprMode;
worldDoc.scene.dpr.initial = dprInitial;

// Macro terrain preset override
const presetParam = params.get('preset');
if (presetParam) {
  worldDoc.terrain.type = 'macro';
  worldDoc.terrain.preset = presetParam;
}

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

// Water level override
const waterParam = params.get('water');
const waterLevel = waterParam !== null ? parseFloat(waterParam) || 8 : null;

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

function syncToolbar() {
  toolbar.clayMode = app.isClayMode();
  toolbar.presentMode = app.isPresentationMode();
  toolbar.overlayMode = app.getOverlayMode();
  toolbar.sunLabel = sunPresets[sunPresetIdx].label;
}

shell.addEventListener('toggle-present', async () => {
  await app.setPresentationMode(!app.isPresentationMode());
  syncToolbar();
});

shell.addEventListener('toggle-clay', () => {
  app.toggleClayMode();
  syncToolbar();
});

shell.addEventListener('cycle-overlay', () => {
  app.cycleOverlay();
  syncToolbar();
});

shell.addEventListener('cycle-sun', () => {
  sunPresetIdx = (sunPresetIdx + 1) % sunPresets.length;
  const p = sunPresets[sunPresetIdx];
  app.setSunDirection(p.az, p.el);
  syncToolbar();
});

shell.addEventListener('take-snapshot', () => {
  snapshotUi.take();
});

// ── URL param overrides ──
if (params.has('present')) {
  app.setPresentationMode(true).then(syncToolbar);
}
if (params.get('clay') !== null) {
  app.setClayMode(true);
}
if (params.get('ibl') === 'off') {
  app.setIblEnabled(false);
}
const exposureParam = params.get('exposure');
if (exposureParam) app.setExposure(parseFloat(exposureParam));
const sunAzParam = params.get('sunaz');
const sunElParam = params.get('sunel');
if (sunAzParam || sunElParam) {
  const az = sunAzParam ? parseFloat(sunAzParam) : 210;
  const el = sunElParam ? parseFloat(sunElParam) : 35;
  app.setSunDirection(az, el);
  toolbar.sunLabel = `${Math.round(az)}° ${Math.round(el)}°`;
} else {
  syncToolbar();
}

// ── Status bar ──
shell.statusText = terrainDomain.fromCache
  ? `Cached · ±${terrainDomain.extent} · ${terrainDomain.bakeGridSize}²`
  : `Baked ${terrainDomain.bakeTimeMs.toFixed(0)}ms · ±${terrainDomain.extent} · ${terrainDomain.bakeGridSize}²`;

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

// Hide startup overlay
const startupMs = Math.round(performance.now() - startupT0);
if (startupEl) {
  startupEl.classList.add('hidden');
  setTimeout(() => startupEl.remove(), 500);
}

console.log(`[terrain] WebGPU | revZ: ${app.reversedDepthSupported} | IBL: ${app.isIblEnabled()}`);
console.log(`[terrain] domain: extent ±${terrainDomain.extent} | erosion: ${terrainDomain.hasErosion} | cache: ${terrainDomain.fromCache} | bake: ${terrainDomain.bakeTimeMs.toFixed(0)}ms`);
console.log(`[terrain] startup: ${startupMs}ms total`);
