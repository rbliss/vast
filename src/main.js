/**
 * Application entry point.
 * Wires the TerrainApp engine to DOM, UI controls, and animation loop.
 */

import './styles.css';

import { TerrainApp } from './engine/TerrainApp.js';
import { createHud } from './ui/hud.js';
import { createScreenshotUi } from './ui/screenshotUi.js';
import { createDprButtons } from './ui/dprButtons.js';

// ── Parse URL params ──
const debugMode = location.search.includes('debug');
const dprParam = new URLSearchParams(location.search).get('dpr');
let dprMode = 'fixed';
let dprInitial = 2;
if (dprParam === 'auto') {
  dprMode = 'auto';
  dprInitial = Math.min(window.devicePixelRatio, 2);
} else if (dprParam) {
  const v = parseFloat(dprParam);
  if (v >= 1.0 && v <= Math.min(window.devicePixelRatio, 2)) dprInitial = v;
}

// ── Create engine ──
const app = new TerrainApp(document.body, {
  debug: debugMode,
  dprMode,
  dprInitial,
});

// ── Wire UI ──
const dprBtns = createDprButtons(document.getElementById('dprRow'), app.dpr);

createScreenshotUi(
  document.getElementById('screenshotBtn'),
  document.getElementById('shotStatus'),
  {
    renderer: app.renderer,
    scene: app.scene,
    camera: app.camera,
    getLabel: () => `terrain_${app.centerCX}_${app.centerCZ}`,
  }
);

const hud = createHud(document.getElementById('fps'));

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
console.log(`[terrain] v9.2 — TerrainApp facade (mode: ${app.dpr.ctrl.mode})`);
