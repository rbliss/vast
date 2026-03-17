/**
 * Application entry point.
 * Wires the TerrainApp engine to DOM, UI controls, and animation loop.
 */

import './styles.css';

import { TerrainApp } from './engine/TerrainApp';
import { mustEl } from './engine/types';
import { createHud } from './ui/hud';
import { createScreenshotUi } from './ui/screenshotUi';
import { createDprButtons } from './ui/dprButtons';

// ── Parse URL params ──
const params = new URLSearchParams(location.search);
const debugMode = params.has('debug');
const dprParam = params.get('dpr');

// Renderer selection: explicit param > localStorage > default (webgpu-first)
const rendererParam = params.get('renderer');
let rendererMode: 'webgl' | 'webgpu';
if (rendererParam === 'webgl' || rendererParam === 'webgpu') {
  rendererMode = rendererParam;
} else {
  rendererMode = localStorage.getItem('terrain-renderer') as 'webgl' | 'webgpu' || 'webgpu';
}
let dprMode: 'fixed' | 'auto' = 'fixed';
let dprInitial = 2;
if (dprParam === 'auto') {
  dprMode = 'auto';
  dprInitial = Math.min(window.devicePixelRatio, 2);
} else if (dprParam) {
  const v = parseFloat(dprParam);
  if (v >= 1.0 && v <= Math.min(window.devicePixelRatio, 2)) dprInitial = v;
}

// ── Create engine (async for WebGPU support) ──
const app = await TerrainApp.createAsync(document.body, {
  debug: debugMode,
  dprMode,
  dprInitial,
  rendererMode,
});

// ── Wire UI ──
const dprBtns = createDprButtons(mustEl('dprRow'), app.dpr);

createScreenshotUi(
  mustEl<HTMLButtonElement>('screenshotBtn'),
  mustEl('shotStatus'),
  {
    renderer: app.renderer,
    scene: app.scene,
    camera: app.camera,
    getLabel: () => `terrain_${app.centerCX}_${app.centerCZ}`,
    captureFrame: () => app.captureFrame(),
  },
);

const hud = createHud(mustEl('fps'), {
  reversedDepth: app.reversedDepthSupported,
  rendererMode: app.rendererMode,
});

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

// ── Renderer toggle (reload-based) ──
const rendererRow = mustEl('rendererRow');
const rendererButtons = rendererRow.querySelectorAll<HTMLButtonElement>('button[data-renderer]');

// Show fallback notice if WebGPU was requested but unavailable
if (rendererMode === 'webgpu' && app.rendererMode === 'webgl') {
  const notice = document.createElement('span');
  notice.style.cssText = 'color:#fbbf24;font:10px/1 monospace;margin-left:4px';
  notice.textContent = '(WebGPU unavailable)';
  rendererRow.appendChild(notice);
}

// Highlight active renderer
rendererButtons.forEach(btn => {
  btn.classList.toggle('active', btn.dataset.renderer === app.rendererMode);
});

// Save preference + reload on click
rendererButtons.forEach(btn => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.renderer as 'webgl' | 'webgpu';
    if (target === app.rendererMode) return;
    localStorage.setItem('terrain-renderer', target);
    const p = new URLSearchParams(location.search);
    p.set('renderer', target);
    location.search = p.toString();
  });
});

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
console.log(`[terrain] spike — renderer: ${app.rendererMode}, revZ: ${app.reversedDepthSupported}, IBL: ${app.isIblEnabled()}`);
