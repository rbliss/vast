/**
 * Runtime/capabilities store — system state and diagnostics.
 *
 * Tracks bake cache state, terrain domain, device capabilities,
 * and storage info. Read-only from the UI's perspective.
 */

import { Observable } from './observable';
import type { TerrainDomainConfig } from '../engine/bake/terrainDomain';

export class RuntimeStore extends Observable {
  private _domain: TerrainDomainConfig | null = null;
  private _cacheHit = false;
  private _startupMs = 0;
  private _fps = 0;

  get domain() { return this._domain; }
  get cacheHit() { return this._cacheHit; }
  get startupMs() { return this._startupMs; }
  get fps() { return this._fps; }

  get statusLine(): string {
    if (!this._domain) return 'No terrain';
    const cache = this._domain.fromCache ? 'cached' : `baked ${this._domain.bakeTimeMs.toFixed(0)}ms`;
    return `±${this._domain.extent} · ${this._domain.bakeGridSize}² · ${cache}`;
  }

  setDomain(d: TerrainDomainConfig) {
    this._domain = d;
    this._cacheHit = d.fromCache;
    this.notify();
  }

  setStartupMs(ms: number) {
    this._startupMs = ms;
    this.notify();
  }

  setFps(fps: number) {
    this._fps = fps;
    // Don't notify on every frame — too noisy. UI polls this.
  }
}

export const runtimeStore = new RuntimeStore();
