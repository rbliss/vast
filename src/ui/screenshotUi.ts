/**
 * Screenshot button: capture, upload, clipboard.
 */

import * as THREE from 'three';
import type { WebGLRenderer, Scene, PerspectiveCamera } from 'three';
import type { ScreenshotUploadResponse } from '../engine/types';

interface ScreenshotOpts {
  renderer: WebGLRenderer;
  scene: Scene;
  camera: PerspectiveCamera;
  getLabel: () => string;
  /** Optional facade capture — if provided, skips WebGL render target path */
  captureFrame?: () => string;
}

export function createScreenshotUi(
  btnEl: HTMLButtonElement,
  statusEl: HTMLElement,
  { renderer, scene, camera, getLabel, captureFrame }: ScreenshotOpts,
) {
  let busy = false;

  function setStatus(msg: string, err = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', err);
  }

  function captureToDataURL(): string {
    const sz = new THREE.Vector2();
    renderer.getDrawingBufferSize(sz);
    const w = Math.max(1, Math.floor(sz.x));
    const h = Math.max(1, Math.floor(sz.y));
    const rt = new THREE.WebGLRenderTarget(w, h, { depthBuffer: true });
    rt.texture.colorSpace = THREE.SRGBColorSpace;
    if (renderer.capabilities.isWebGL2) rt.samples = 4;

    const prev = renderer.getRenderTarget();
    renderer.setRenderTarget(rt);
    renderer.render(scene, camera);

    const px = new Uint8Array(w * h * 4);
    renderer.readRenderTargetPixels(rt, 0, 0, w, h, px);
    renderer.setRenderTarget(prev);
    rt.dispose();

    const cv = document.createElement('canvas');
    cv.width = w; cv.height = h;
    const ctx = cv.getContext('2d')!;
    const img = ctx.createImageData(w, h);
    for (let y = 0; y < h; y++) {
      const src = (h - 1 - y) * w * 4;
      img.data.set(px.subarray(src, src + w * 4), y * w * 4);
    }
    ctx.putImageData(img, 0, 0);
    return cv.toDataURL('image/png');
  }

  async function copyToClipboard(text: string): Promise<boolean> {
    try {
      if (navigator.clipboard?.writeText) { await navigator.clipboard.writeText(text); return true; }
    } catch { /* fallback below */ }
    try {
      const ta = document.createElement('textarea');
      ta.value = text; ta.style.cssText = 'position:fixed;left:-9999px';
      document.body.appendChild(ta); ta.select();
      const ok = document.execCommand('copy'); ta.remove(); return ok;
    } catch { return false; }
  }

  async function take() {
    if (busy) return;
    busy = true;
    btnEl.disabled = true;
    setStatus('Capturing...');
    try {
      // Use facade capture if available (works for both WebGL and WebGPU)
      const image = captureFrame ? captureFrame() : (() => {
        renderer.render(scene, camera);
        return captureToDataURL();
      })();
      const label = getLabel();
      const resp = await fetch('/api/screenshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, label, format: 'png' }),
      });
      if (!resp.ok) throw new Error(`upload ${resp.status}`);
      const result: ScreenshotUploadResponse = await resp.json();
      const copied = await copyToClipboard(result.filename);
      const url = new URL(result.path, location.href).href;
      setStatus(`${result.filename}${copied ? ' (copied)' : ''} — ${url}`);
    } catch (err: unknown) {
      console.error('[screenshot]', err);
      setStatus(`Failed: ${err instanceof Error ? err.message : err}`, true);
    } finally {
      busy = false;
      btnEl.disabled = false;
    }
  }

  btnEl.addEventListener('click', take);
  return { take };
}
