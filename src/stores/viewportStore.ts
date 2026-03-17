/**
 * Viewport store — controls that affect the live viewport.
 *
 * All "Class A" (live) parameters: changes apply immediately
 * without rebake. The shell/toolbar reads from this store,
 * and main.ts/TerrainApp writes to it.
 */

import { Observable } from './observable';

export class ViewportStore extends Observable {
  private _clayMode = false;
  private _overlayMode: string = 'none';
  private _presentationMode = false;
  private _sunAzimuth = 210;
  private _sunElevation = 35;
  private _exposure = 1.0;
  private _waterLevel: number | null = null;
  private _cloudCoverage = 0.55;
  private _iblEnabled = true;

  // ── Getters ──
  get clayMode() { return this._clayMode; }
  get overlayMode() { return this._overlayMode; }
  get presentationMode() { return this._presentationMode; }
  get sunAzimuth() { return this._sunAzimuth; }
  get sunElevation() { return this._sunElevation; }
  get sunLabel() { return `${Math.round(this._sunAzimuth)}° ${Math.round(this._sunElevation)}°`; }
  get exposure() { return this._exposure; }
  get waterLevel() { return this._waterLevel; }
  get cloudCoverage() { return this._cloudCoverage; }
  get iblEnabled() { return this._iblEnabled; }

  // ── Setters (notify on change) ──
  setClayMode(v: boolean) { this._clayMode = v; this.notify(); }
  setOverlayMode(v: string) { this._overlayMode = v; this.notify(); }
  setPresentationMode(v: boolean) { this._presentationMode = v; this.notify(); }
  setSunDirection(az: number, el: number) {
    this._sunAzimuth = az;
    this._sunElevation = el;
    this.notify();
  }
  setExposure(v: number) { this._exposure = v; this.notify(); }
  setWaterLevel(v: number | null) { this._waterLevel = v; this.notify(); }
  setCloudCoverage(v: number) { this._cloudCoverage = v; this.notify(); }
  setIblEnabled(v: boolean) { this._iblEnabled = v; this.notify(); }
}

export const viewportStore = new ViewportStore();
