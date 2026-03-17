/**
 * Authoring store — terrain editing state.
 *
 * Tracks draft vs applied parameter state and rebake requirements.
 * This is where the Live/Apply/Rebake classification lives.
 */

import { Observable } from './observable';

export type BakeState = 'idle' | 'pending' | 'baking' | 'complete' | 'error';

export class AuthoringStore extends Observable {
  private _bakeState: BakeState = 'idle';
  private _bakeProgress = '';
  private _needsRebake = false;
  private _lastBakeTimeMs = 0;

  get bakeState() { return this._bakeState; }
  get bakeProgress() { return this._bakeProgress; }
  get needsRebake() { return this._needsRebake; }
  get lastBakeTimeMs() { return this._lastBakeTimeMs; }

  setBakeState(state: BakeState) {
    this._bakeState = state;
    this.notify();
  }

  setBakeProgress(msg: string) {
    this._bakeProgress = msg;
    this.notify();
  }

  setNeedsRebake(v: boolean) {
    this._needsRebake = v;
    this.notify();
  }

  setLastBakeTime(ms: number) {
    this._lastBakeTimeMs = ms;
    this.notify();
  }
}

export const authoringStore = new AuthoringStore();
