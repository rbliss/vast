/**
 * Application entry point.
 * Wires the TerrainApp engine to DOM, UI controls, and animation loop.
 */

import './styles.css';
// Initialize error buffer early — must be before any app code that may throw
import './utils/runtimeErrors';

import { TerrainApp } from './engine/TerrainApp';
import { mustEl } from './engine/types';
import { createHud } from './ui/hud';
import { createScreenshotUi } from './ui/screenshotUi';
import { createDprButtons } from './ui/dprButtons';
import { createDefaultDocument } from './engine/document';
import { createTerrainSource } from './engine/terrain/terrainSource';

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

const terrainSource = createTerrainSource(worldDoc);

// ── Create engine (WebGPU) ──
const app = await TerrainApp.createAsync(document.body, worldDoc, terrainSource, {
  debug: debugMode,
  dprMode,
  dprInitial,
});

// ── Wire UI ──
const dprBtns = createDprButtons(mustEl('dprRow'), app.dpr);

const snapshotUi = createScreenshotUi(
  mustEl<HTMLButtonElement>('screenshotBtn'),
  mustEl('shotStatus'),
  {
    getLabel: () => `terrain_${app.centerCX}_${app.centerCZ}`,
    captureFrame: () => app.captureFrame(),
    getSnapshotState: () => app.getSnapshotState(),
  },
);

// Expose snapshot API globally for automation / browser console
window.__snapshot = snapshotUi.take;

const hud = createHud(mustEl('fps'));

// ── Sun direction controls ──
const sunBtn = mustEl<HTMLButtonElement>('sunBtn');
const sunPresets = [
  { label: 'SW 35°', az: 210, el: 35 },
  { label: 'SE 25°', az: 135, el: 25 },
  { label: 'E 15°', az: 90, el: 15 },
  { label: 'NW 45°', az: 315, el: 45 },
  { label: 'S 60°', az: 180, el: 60 },
];
let sunPresetIdx = 0;

// Apply URL params if present
const sunAzParam = params.get('sunaz');
const sunElParam = params.get('sunel');
if (sunAzParam || sunElParam) {
  const az = sunAzParam ? parseFloat(sunAzParam) : 210;
  const el = sunElParam ? parseFloat(sunElParam) : 35;
  app.setSunDirection(az, el);
  sunBtn.textContent = `Sun: ${Math.round(az)}° ${Math.round(el)}°`;
}

sunBtn.addEventListener('click', () => {
  sunPresetIdx = (sunPresetIdx + 1) % sunPresets.length;
  const p = sunPresets[sunPresetIdx];
  app.setSunDirection(p.az, p.el);
  sunBtn.textContent = `Sun: ${p.label}`;
});

// ── Debug overlay toggle ──
const overlayBtn = mustEl<HTMLButtonElement>('overlayBtn');
const overlayLabels: Record<string, string> = {
  none: 'Overlay: Off',
  slope: 'Slope',
  curvature: 'Curvature',
  flow: 'Flow',
};

function updateOverlayButton() {
  const mode = app.getOverlayMode();
  overlayBtn.textContent = overlayLabels[mode];
  overlayBtn.classList.toggle('active', mode !== 'none');
}

overlayBtn.addEventListener('click', () => {
  app.cycleOverlay();
  updateOverlayButton();
});

// ── Clay mode toggle ──
const clayBtn = mustEl<HTMLButtonElement>('clayBtn');
const clayParam = params.get('clay');

function updateClayButton() {
  const on = app.isClayMode();
  clayBtn.textContent = on ? 'Clay On' : 'Clay';
  clayBtn.classList.toggle('active', on);
}

if (clayParam !== null) {
  app.setClayMode(true);
}

clayBtn.addEventListener('click', () => {
  app.toggleClayMode();
  updateClayButton();
});
updateClayButton();

// ── IBL toggle ──
const iblBtn = mustEl<HTMLButtonElement>('iblBtn');
const iblParam = new URLSearchParams(location.search).get('ibl');
if (iblParam === 'off') {
  app.setIblEnabled(false);
}

function updateIblButton() {
  const on = app.isIblEnabled();
  iblBtn.textContent = on ? 'IBL On' : 'IBL Off';
  iblBtn.classList.toggle('off', !on);
  const params = new URLSearchParams(location.search);
  params.set('ibl', on ? 'on' : 'off');
  history.replaceState(null, '', '?' + params.toString());
}

iblBtn.addEventListener('click', () => {
  app.toggleIbl();
  updateIblButton();
});
updateIblButton();

// ── Resize ──
window.addEventListener('resize', () => {
  app.resize(window.innerWidth, window.innerHeight);
});

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
    dprBtns.updateHighlights();
  }
}

animate();
console.log(`[terrain] WebGPU | revZ: ${app.reversedDepthSupported} | IBL: ${app.isIblEnabled()}`);
