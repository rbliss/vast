/**
 * HUD: FPS counter + DPR + revZ info display.
 */

import type { DprCtrlState } from '../engine/controls/dprController';

export interface HudTickResult {
  fps: number;
  elapsed: number;
}

export interface HudOpts {
  reversedDepth?: boolean;
}

export function createHud(fpsEl: HTMLElement, opts: HudOpts = {}) {
  let frameCount = 0;
  let lastTime = performance.now();
  let lastFps = 0;
  const revZTag = opts.reversedDepth ? ' | revZ' : '';

  function tick(now: number, dprCtrl: DprCtrlState): HudTickResult | null {
    frameCount++;
    const elapsed = now - lastTime;
    if (elapsed >= 500) {
      lastFps = frameCount / (elapsed / 1000);
      const dprInfo = dprCtrl.mode === 'auto'
        ? ` | dpr ${dprCtrl.current.toFixed(2)} | auto`
        : ` | dpr ${dprCtrl.current.toFixed(2)}`;
      fpsEl.textContent = `${lastFps.toFixed(0)} fps${dprInfo}${revZTag}`;
      frameCount = 0;
      lastTime = now;
      return { fps: lastFps, elapsed };
    }
    return null;
  }

  return { tick, getFps: () => lastFps };
}
