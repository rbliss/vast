/**
 * Inspector panel — property editing for terrain, materials, scene.
 *
 * Organized into collapsible sections matching the visual stack.
 * Class A (live) controls update immediately.
 * Class C (rebake) controls update the document and mark needsRebake.
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { viewportStore } from '../../stores/viewportStore';
import { authoringStore } from '../../stores/authoringStore';
import { projectStore } from '../../stores/projectStore';

@customElement('vast-inspector')
export class InspectorPanel extends LitElement {
  @state() private _sunAz = 210;
  @state() private _sunEl = 35;
  @state() private _exposure = 1.0;
  @state() private _waterLevel: number | null = null;
  @state() private _cloudCoverage = 0.55;
  @state() private _preset = 'chain';
  @state() private _needsRebake = false;

  // Section collapse state
  @state() private _sceneOpen = true;
  @state() private _terrainOpen = false;
  @state() private _materialsOpen = false;

  private _unsubs: (() => void)[] = [];

  connectedCallback() {
    super.connectedCallback();
    this._unsubs.push(
      viewportStore.subscribe(() => this._syncFromStores()),
      authoringStore.subscribe(() => this._syncFromStores()),
      projectStore.subscribe(() => this._syncFromStores()),
    );
    this._syncFromStores();
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubs.forEach(u => u());
    this._unsubs = [];
  }

  private _syncFromStores() {
    this._sunAz = viewportStore.sunAzimuth;
    this._sunEl = viewportStore.sunElevation;
    this._exposure = viewportStore.exposure;
    this._waterLevel = viewportStore.waterLevel;
    this._cloudCoverage = viewportStore.cloudCoverage;
    this._preset = projectStore.presetName;
    this._needsRebake = authoringStore.needsRebake;
  }

  static styles = css`
    :host {
      display: block;
      font: 11px/1.5 monospace;
      color: #ccc;
      overflow-y: auto;
      height: 100%;
    }

    .section {
      border-bottom: 1px solid rgba(255,255,255,0.06);
    }

    .section-header {
      display: flex;
      align-items: center;
      padding: 8px 12px;
      cursor: pointer;
      user-select: none;
      font-weight: bold;
      color: #aaa;
    }
    .section-header:hover { color: #ddd; }
    .section-header .arrow { margin-right: 6px; font-size: 9px; }

    .section-body {
      padding: 4px 12px 12px;
    }

    .field {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 6px;
    }

    .field label {
      color: #999;
      flex-shrink: 0;
      margin-right: 8px;
    }

    .field input[type="range"] {
      flex: 1;
      max-width: 120px;
      accent-color: #5588cc;
    }

    .field .value {
      min-width: 36px;
      text-align: right;
      color: #bbb;
      font-size: 10px;
    }

    .field select {
      background: rgba(40,40,45,0.9);
      color: #ccc;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 3px;
      padding: 2px 4px;
      font: 11px/1 monospace;
    }

    .rebake-badge {
      display: inline-block;
      background: rgba(200,120,40,0.7);
      color: #fff;
      font-size: 9px;
      padding: 1px 5px;
      border-radius: 3px;
      margin-left: 6px;
    }
  `;

  render() {
    return html`
      ${this._renderSceneSection()}
      ${this._renderTerrainSection()}
      ${this._renderMaterialsSection()}
    `;
  }

  // ── Scene (Class A — live) ──

  private _renderSceneSection() {
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._sceneOpen = !this._sceneOpen}>
          <span class="arrow">${this._sceneOpen ? '▼' : '▶'}</span>
          Scene
        </div>
        ${this._sceneOpen ? html`
          <div class="section-body">
            ${this._slider('Sun Az', this._sunAz, 0, 360, 1, (v) => this._setSun(v, this._sunEl), '°')}
            ${this._slider('Sun El', this._sunEl, 5, 85, 1, (v) => this._setSun(this._sunAz, v), '°')}
            ${this._slider('Exposure', this._exposure, 0.2, 3.0, 0.05, (v) => this._setExposure(v))}
            ${this._slider('Clouds', this._cloudCoverage, 0, 1, 0.05, (v) => this._setClouds(v))}
            ${this._slider('Water', this._waterLevel ?? 0, 0, 30, 0.5, (v) => this._setWater(v))}
          </div>
        ` : ''}
      </div>
    `;
  }

  // ── Terrain (Class C — rebake) ──

  private _renderTerrainSection() {
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._terrainOpen = !this._terrainOpen}>
          <span class="arrow">${this._terrainOpen ? '▼' : '▶'}</span>
          Terrain
          ${this._needsRebake ? html`<span class="rebake-badge">Rebake</span>` : ''}
        </div>
        ${this._terrainOpen ? html`
          <div class="section-body">
            <div class="field">
              <label>Preset</label>
              <select @change=${(e: Event) => this._setPreset((e.target as HTMLSelectElement).value)}>
                <option value="chain" ?selected=${this._preset === 'chain'}>Chain</option>
                <option value="basin" ?selected=${this._preset === 'basin'}>Basin</option>
                <option value="plateau" ?selected=${this._preset === 'plateau'}>Plateau</option>
              </select>
            </div>
            ${this._needsRebake ? html`
              <button
                style="margin-top:8px; width:100%; padding:6px; background:rgba(200,120,40,0.8); color:#fff; border:0; border-radius:4px; cursor:pointer; font:12px/1 monospace;"
                @click=${() => this._emit('rebake')}
              >Apply & Rebake</button>
            ` : html`
              <div style="color:#666; font-size:10px; margin-top:4px;">
                Terrain is up to date
              </div>
            `}
          </div>
        ` : ''}
      </div>
    `;
  }

  // ── Materials (Class B — apply) ──

  private _renderMaterialsSection() {
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._materialsOpen = !this._materialsOpen}>
          <span class="arrow">${this._materialsOpen ? '▼' : '▶'}</span>
          Materials
        </div>
        ${this._materialsOpen ? html`
          <div class="section-body">
            <div style="color:#666; font-size:10px;">
              Material controls coming in next phase
            </div>
          </div>
        ` : ''}
      </div>
    `;
  }

  // ── Slider helper ──

  private _slider(
    label: string, value: number,
    min: number, max: number, step: number,
    onChange: (v: number) => void,
    suffix: string = '',
  ) {
    return html`
      <div class="field">
        <label>${label}</label>
        <input type="range"
          .value=${String(value)}
          min=${min} max=${max} step=${step}
          @input=${(e: Event) => onChange(parseFloat((e.target as HTMLInputElement).value))}
        >
        <span class="value">${value.toFixed(step < 1 ? 2 : 0)}${suffix}</span>
      </div>
    `;
  }

  // ── Event dispatchers (Class A → immediate) ──

  private _setSun(az: number, el: number) {
    this.dispatchEvent(new CustomEvent('set-sun', {
      detail: { azimuth: az, elevation: el },
      bubbles: true, composed: true,
    }));
  }

  private _setExposure(v: number) {
    this.dispatchEvent(new CustomEvent('set-exposure', {
      detail: v, bubbles: true, composed: true,
    }));
  }

  private _setClouds(v: number) {
    this.dispatchEvent(new CustomEvent('set-clouds', {
      detail: v, bubbles: true, composed: true,
    }));
  }

  private _setWater(v: number) {
    this.dispatchEvent(new CustomEvent('set-water', {
      detail: v, bubbles: true, composed: true,
    }));
  }

  // ── Event dispatchers (Class C → marks rebake) ──

  private _setPreset(v: string) {
    this.dispatchEvent(new CustomEvent('set-preset', {
      detail: v, bubbles: true, composed: true,
    }));
  }

  private _emit(name: string) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vast-inspector': InspectorPanel;
  }
}
