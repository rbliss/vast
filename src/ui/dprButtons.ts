/**
 * DPR manual control buttons + URL sync.
 */

import type { DprController } from '../engine/controls/dprController';

export function createDprButtons(containerEl: HTMLElement, dprController: DprController) {
  const { ctrl, setMode } = dprController;
  const buttons = containerEl.querySelectorAll<HTMLButtonElement>('button[data-dpr]');

  function updateHighlights() {
    buttons.forEach(btn => {
      const val = btn.dataset.dpr;
      if (val === 'auto') {
        btn.classList.toggle('active', ctrl.mode === 'auto');
      } else {
        btn.classList.toggle('active',
          ctrl.mode === 'fixed' && Math.abs(parseFloat(val!) - ctrl.current) < 0.01);
      }
    });
  }

  function updateUrl() {
    const params = new URLSearchParams(location.search);
    params.set('dpr', ctrl.mode === 'auto' ? 'auto' : ctrl.current.toString());
    history.replaceState(null, '', '?' + params.toString());
  }

  function handleClick(mode: 'fixed' | 'auto', value?: number) {
    setMode(mode, value);
    updateHighlights();
    updateUrl();
  }

  buttons.forEach(btn => {
    btn.addEventListener('click', () => {
      const val = btn.dataset.dpr;
      if (val === 'auto') handleClick('auto');
      else handleClick('fixed', parseFloat(val!));
    });
  });

  updateHighlights();

  return { updateHighlights, updateUrl };
}
