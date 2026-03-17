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

// ── Create engine (WebGPU) ──
const app = await TerrainApp.createAsync(document.body, {
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
    renderer: app.renderer,
    scene: app.scene,
    camera: app.camera,
    getLabel: () => `terrain_${app.centerCX}_${app.centerCZ}`,
    captureFrame: () => app.captureFrame(),
    getSnapshotState: () => app.getSnapshotState(),
  },
);

// Expose snapshot API globally for automation / browser console
window.__snapshot = snapshotUi.take;

const hud = createHud(mustEl('fps'));

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
