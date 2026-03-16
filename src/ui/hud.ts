/**
 * HUD: FPS counter + DPR info display.
 */

import type { DprCtrlState } from '../engine/controls/dprController';

export interface HudTickResult {
  fps: number;
  elapsed: number;
}

export function createHud(fpsEl: HTMLElement) {
  let frameCount = 0;
  let lastTime = performance.now();
  let lastFps = 0;

  function tick(now: number, dprCtrl: DprCtrlState): HudTickResult | null {
    frameCount++;
    const elapsed = now - lastTime;
    if (elapsed >= 500) {
      lastFps = frameCount / (elapsed / 1000);
      const dprInfo = dprCtrl.mode === 'auto'
        ? ` | dpr ${dprCtrl.current.toFixed(2)} | auto`
        : ` | dpr ${dprCtrl.current.toFixed(2)}`;
      fpsEl.textContent = `${lastFps.toFixed(0)} fps${dprInfo}`;
      frameCount = 0;
      lastTime = now;
      return { fps: lastFps, elapsed };
    }
    return null;
  }

  return { tick, getFps: () => lastFps };
}
