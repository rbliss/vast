/**
 * Snapshot UI: capture frame + metadata, upload, clipboard.
 */

import type { SnapshotUploadResponse } from '../engine/types';
import { getRecentErrors } from '../utils/runtimeErrors';

interface ScreenshotOpts {
  getLabel: () => string;
  captureFrame: () => string | Promise<string>;
  /** Engine snapshot state provider */
  getSnapshotState?: () => Record<string, unknown>;
}

export function createScreenshotUi(
  btnEl: HTMLButtonElement,
  statusEl: HTMLElement,
  { getLabel, captureFrame, getSnapshotState }: ScreenshotOpts,
) {
  let busy = false;

  function setStatus(msg: string, err = false) {
    statusEl.textContent = msg;
    statusEl.classList.toggle('error', err);
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
      // Capture frame image (may be async in presentation mode)
      const image = await captureFrame();
      const label = getLabel();

      // Gather snapshot metadata
      const metadata: Record<string, unknown> = getSnapshotState ? getSnapshotState() : {};
      metadata.consoleErrors = getRecentErrors();

      // Try the snapshot endpoint first
      const resp = await fetch('/api/snapshot', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image, label, format: 'png', metadata }),
      });
      if (!resp.ok) throw new Error(`upload ${resp.status}`);
      const result: SnapshotUploadResponse = await resp.json();
      const copied = await copyToClipboard(result.id);
      const imgUrl = new URL(result.path, location.href).href;
      const metaUrl = new URL(result.metadataPath, location.href).href;
      setStatus(`${result.id}${copied ? ' (copied)' : ''}\n${imgUrl}\n${metaUrl}`);
    } catch (err: unknown) {
      console.error('[snapshot]', err);
      setStatus(`Failed: ${err instanceof Error ? err.message : err}`, true);
    } finally {
      busy = false;
      btnEl.disabled = false;
    }
  }

  btnEl.addEventListener('click', take);
  return { take };
}
