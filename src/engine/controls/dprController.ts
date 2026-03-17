/**
 * Adaptive DPR controller with FPS-based hysteresis.
 * Pure logic — no DOM dependencies. Renderer passed in.
 */

import type { RendererLike } from '../backend/types';

export interface DprCtrlState {
  mode: 'fixed' | 'auto';
  current: number;
  min: number;
  max: number;
  step: number;
  buckets: readonly number[];
  belowMs: number;
  aboveMs: number;
  lastChangeTime: number;
  downFps: number;
  upFps: number;
  downDelay: number;
  upDelay: number;
  cooldown: number;
}

export interface DprController {
  ctrl: DprCtrlState;
  apply: (nextDpr: number) => void;
  forceApply: (dpr: number) => void;
  update: (fps: number, dtMs: number) => void;
  setMode: (mode: 'fixed' | 'auto', value?: number) => void;
  snapToBucket: (v: number) => number;
}

interface DprOpts {
  mode?: 'fixed' | 'auto';
  initial?: number;
}

const BUCKETS = [1.0, 1.25, 1.5, 1.75, 2.0] as const;

function snapToBucket(v: number): number {
  return BUCKETS.reduce((best, b) => Math.abs(b - v) < Math.abs(best - v) ? b : best);
}

export function createDprController(renderer: RendererLike, opts: DprOpts = {}): DprController {
  const maxDpr = Math.min(window.devicePixelRatio, 2);
  const ctrl: DprCtrlState = {
    mode: opts.mode || 'fixed',
    current: snapToBucket(opts.initial ?? maxDpr),
    min: 1.0,
    max: maxDpr,
    step: 0.25,
    buckets: BUCKETS,
    belowMs: 0,
    aboveMs: 0,
    lastChangeTime: 0,
    downFps: 78,
    upFps: 105,
    downDelay: 1000,
    upDelay: 4000,
    cooldown: 1500,
  };

  function apply(nextDpr: number) {
    nextDpr = snapToBucket(nextDpr);
    nextDpr = Math.max(ctrl.min, Math.min(ctrl.max, nextDpr));
    if (nextDpr === ctrl.current) return;
    ctrl.current = nextDpr;
    renderer.setPixelRatio(nextDpr);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    ctrl.lastChangeTime = performance.now();
    ctrl.belowMs = 0;
    ctrl.aboveMs = 0;
  }

  function forceApply(dpr: number) {
    ctrl.current = -1;
    apply(dpr);
  }

  function update(fps: number, dtMs: number) {
    if (ctrl.mode !== 'auto') return;
    const now = performance.now();
    if (now - ctrl.lastChangeTime < ctrl.cooldown) return;

    if (fps < ctrl.downFps) {
      ctrl.belowMs += dtMs;
      ctrl.aboveMs = 0;
      if (ctrl.belowMs > ctrl.downDelay) apply(ctrl.current - ctrl.step);
    } else if (fps > ctrl.upFps) {
      ctrl.aboveMs += dtMs;
      ctrl.belowMs = 0;
      if (ctrl.aboveMs > ctrl.upDelay) apply(ctrl.current + ctrl.step);
    } else {
      ctrl.belowMs = 0;
      ctrl.aboveMs = 0;
    }
  }

  function setMode(mode: 'fixed' | 'auto', value?: number) {
    if (mode === 'auto') {
      ctrl.mode = 'auto';
      ctrl.belowMs = 0;
      ctrl.aboveMs = 0;
    } else {
      ctrl.mode = 'fixed';
      if (value !== undefined) forceApply(value);
    }
  }

  renderer.setPixelRatio(ctrl.current);

  return { ctrl, apply, forceApply, update, setMode, snapToBucket };
}
