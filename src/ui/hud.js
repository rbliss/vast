/**
 * HUD: FPS counter + DPR info display.
 * Writes to an existing DOM element.
 */

export function createHud(fpsEl) {
  let frameCount = 0;
  let lastTime = performance.now();
  let lastFps = 0;

  function tick(now, dprCtrl) {
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
