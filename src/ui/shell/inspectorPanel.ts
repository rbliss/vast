/**
 * Inspector panel — property editing for terrain, materials, scatter, scene.
 *
 * Controls are classified:
 *   LIVE   — updates immediately (sun, exposure, clouds, water)
 *   APPLY  — updates on apply (material thresholds, scatter density)
 *   REBAKE — requires full terrain rebake (preset, erosion params)
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';
import { viewportStore } from '../../stores/viewportStore';
import { authoringStore } from '../../stores/authoringStore';
import { projectStore } from '../../stores/projectStore';

@customElement('vast-inspector')
export class InspectorPanel extends LitElement {
  // Scene (Live)
  @state() private _sunAz = 210;
  @state() private _sunEl = 35;
  @state() private _exposure = 1.0;
  @state() private _waterLevel = 0;
  @state() private _cloudCoverage = 0.55;

  // Terrain (Rebake)
  @state() private _preset = 'chain';
  @state() private _spIterations = 25;
  @state() private _erosionStrength = 0.004;
  @state() private _diffusionStrength = 0.01;
  @state() private _fanStrength = 0.8;
  @state() private _thermalIterations = 20;

  // Materials (Apply)
  @state() private _snowThreshold = 0.78;
  @state() private _rockSlopeMin = 0.3;
  @state() private _rockSlopeMax = 0.6;
  @state() private _sedimentEmphasis = 0.4;

  // Scatter (Apply)
  @state() private _grassDensity = 1.0;
  @state() private _rockDensity = 1.0;
  @state() private _shrubDensity = 1.0;
  @state() private _alpineCutoff = 0.78;
  @state() private _debrisEmphasis = 1.0;

  // Display
  @state() private _clayMode = false;
  @state() private _overlayMode = 'none';
  @state() private _presentMode = false;

  // State
  @state() private _needsRebake = false;
  @state() private _bakeProgress = '';

  // Brush (blank canvas)
  @state() private _brushRadius = 20;
  @state() private _brushStrength = 10;

  // Erosion (blank canvas)
  @state() private _canvasErosionIter = 15;
  @state() private _canvasErosionK = 0.006;
  @state() private _erosionOpen = true;

  // Section collapse
  @state() private _displayOpen = true;
  @state() private _sceneOpen = false;
  @state() private _terrainOpen = false;
  @state() private _materialsOpen = false;
  @state() private _scatterOpen = false;
  @state() private _brushOpen = true;

  private _unsubs: (() => void)[] = [];

  connectedCallback() {
    super.connectedCallback();
    this._unsubs.push(
      viewportStore.subscribe(() => this._syncFromStores()),
      authoringStore.subscribe(() => this._syncFromStores()),
      projectStore.subscribe(() => this._syncFromStores()),
    );
    this._syncFromStores();
    // Load initial values from document via custom event
    this.dispatchEvent(new CustomEvent('inspector-ready', { bubbles: true, composed: true }));
  }

  disconnectedCallback() {
    super.disconnectedCallback();
    this._unsubs.forEach(u => u());
    this._unsubs = [];
  }

  /** Called by main.ts to set initial document values */
  loadFromDocument(doc: any) {
    if (doc.terrain) {
      this._preset = doc.terrain.preset || 'chain';
      this._spIterations = doc.terrain.erosion?.streamPowerIterations ?? 25;
      this._erosionStrength = doc.terrain.erosion?.erosionStrength ?? 0.004;
      this._diffusionStrength = doc.terrain.erosion?.diffusionStrength ?? 0.01;
      this._fanStrength = doc.terrain.erosion?.fanStrength ?? 0.8;
      this._thermalIterations = doc.terrain.erosion?.thermalIterations ?? 20;
    }
    if (doc.materials) {
      this._snowThreshold = doc.materials.snowThreshold ?? 0.78;
      this._rockSlopeMin = doc.materials.rockSlopeMin ?? 0.3;
      this._rockSlopeMax = doc.materials.rockSlopeMax ?? 0.6;
      this._sedimentEmphasis = doc.materials.sedimentEmphasis ?? 0.4;
    }
    if (doc.scatter) {
      this._grassDensity = doc.scatter.grassDensity ?? 1.0;
      this._rockDensity = doc.scatter.rockDensity ?? 1.0;
      this._shrubDensity = doc.scatter.shrubDensity ?? 1.0;
      this._alpineCutoff = doc.scatter.alpineCutoff ?? 0.78;
      this._debrisEmphasis = doc.scatter.debrisEmphasis ?? 1.0;
    }
  }

  private _syncFromStores() {
    this._sunAz = viewportStore.sunAzimuth;
    this._sunEl = viewportStore.sunElevation;
    this._exposure = viewportStore.exposure;
    this._waterLevel = viewportStore.waterLevel ?? 0;
    this._cloudCoverage = viewportStore.cloudCoverage;
    this._clayMode = viewportStore.clayMode;
    this._overlayMode = viewportStore.overlayMode;
    this._presentMode = viewportStore.presentationMode;
    this._preset = projectStore.presetName;
    this._needsRebake = authoringStore.needsRebake;
    this._bakeProgress = authoringStore.bakeProgress;
  }

  static styles = css`
    :host {
      display: block;
      font: 11px/1.5 monospace;
      color: #ccc;
      overflow-y: auto;
      height: 100%;
    }
    .section { border-bottom: 1px solid rgba(255,255,255,0.06); }
    .section-header {
      display: flex; align-items: center;
      padding: 8px 12px; cursor: pointer; user-select: none;
      font-weight: bold; color: #aaa; font-size: 11px;
    }
    .section-header:hover { color: #ddd; }
    .section-header .arrow { margin-right: 6px; font-size: 9px; }
    .section-header .class-tag {
      margin-left: auto; font-weight: normal; font-size: 9px;
      padding: 1px 5px; border-radius: 3px;
    }
    .tag-live { background: rgba(60,160,80,0.5); color: #bfb; }
    .tag-apply { background: rgba(80,120,200,0.5); color: #bdf; }
    .tag-rebake { background: rgba(200,120,40,0.5); color: #fdb; }
    .tag-saved { background: rgba(100,100,110,0.5); color: #aab; }
    .section-body { padding: 4px 12px 12px; }
    .field {
      display: flex; align-items: center;
      justify-content: space-between; margin-bottom: 5px;
    }
    .field label { color: #999; flex-shrink: 0; margin-right: 8px; font-size: 10px; }
    .field input[type="range"] { flex: 1; max-width: 110px; accent-color: #5588cc; }
    .field .value { min-width: 40px; text-align: right; color: #bbb; font-size: 10px; }
    .field select {
      background: rgba(40,40,45,0.9); color: #ccc;
      border: 1px solid rgba(255,255,255,0.12);
      border-radius: 3px; padding: 2px 4px; font: 10px/1 monospace;
    }
    .rebake-btn {
      margin-top: 8px; width: 100%; padding: 6px;
      background: rgba(200,120,40,0.8); color: #fff;
      border: 0; border-radius: 4px; cursor: pointer;
      font: 12px/1 monospace;
    }
    .rebake-btn:hover { background: rgba(220,140,50,0.9); }
    .status-text { color: #888; font-size: 10px; margin-top: 4px; }
    .rebake-badge {
      display: inline-block; background: rgba(200,120,40,0.7);
      color: #fff; font-size: 9px; padding: 1px 5px;
      border-radius: 3px; margin-left: 6px;
    }
  `;

  @state() private _actionsOpen = true;

  render() {
    return html`
      ${this._renderBrush()}
      ${this._renderErosion()}
      ${this._renderActions()}
      ${this._renderDisplay()}
      ${this._renderScene()}
      ${this._renderTerrain()}
      ${this._renderMaterials()}
      ${this._renderScatter()}
    `;
  }

  // ── Actions (erode, snapshot, environment, save/open) ──
  private _renderActions() {
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._actionsOpen = !this._actionsOpen}>
          <span class="arrow">${this._actionsOpen ? '▼' : '▶'}</span>
          Actions
        </div>
        ${this._actionsOpen ? html`<div class="section-body" style="display:flex; flex-direction:column; gap:5px;">
          <button class="rebake-btn" style="background:rgba(140,100,60,0.85);"
            @click=${() => this._fire('apply-erosion', { iterations: this._canvasErosionIter, erosionStrength: this._canvasErosionK })}>
            Erode Terrain
          </button>
          <div style="display:flex; gap:4px;">
            <button style="flex:1; padding:5px; font:10px/1 monospace; background:rgba(60,60,65,0.8); color:#bbb; border:0; border-radius:4px; cursor:pointer;"
              @click=${() => this._fire('take-snapshot', null)}>Snapshot</button>
            <button style="flex:1; padding:5px; font:10px/1 monospace; background:rgba(60,60,65,0.8); color:#bbb; border:0; border-radius:4px; cursor:pointer;"
              @click=${() => this._fire('reset-canvas', null)}>Reset</button>
          </div>
          <div style="display:flex; gap:4px;">
            <button style="flex:1; padding:5px; font:10px/1 monospace; background:rgba(60,60,65,0.8); color:#bbb; border:0; border-radius:4px; cursor:pointer;"
              @click=${() => this._fire('blank-canvas', null)}>Blank Canvas</button>
            <button style="flex:1; padding:5px; font:10px/1 monospace; background:rgba(60,60,65,0.8); color:#bbb; border:0; border-radius:4px; cursor:pointer;"
              @click=${() => this._fire('test-environment', null)}>Test Env</button>
          </div>
          <div style="display:flex; gap:4px;">
            <button style="flex:1; padding:5px; font:10px/1 monospace; background:rgba(60,60,65,0.8); color:#bbb; border:0; border-radius:4px; cursor:pointer;"
              @click=${() => this._fire('save-project', null)}>Save</button>
            <button style="flex:1; padding:5px; font:10px/1 monospace; background:rgba(60,60,65,0.8); color:#bbb; border:0; border-radius:4px; cursor:pointer;"
              @click=${() => this._fire('open-project', null)}>Open</button>
          </div>
        </div>` : ''}
      </div>`;
  }

  // ── Display (clay, overlay, present, sun) ──
  private _renderDisplay() {
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._displayOpen = !this._displayOpen}>
          <span class="arrow">${this._displayOpen ? '▼' : '▶'}</span>
          Display
          <span class="class-tag tag-live">Live</span>
        </div>
        ${this._displayOpen ? html`<div class="section-body">
          <div class="field">
            <label>Mode</label>
            <button style="flex:1; padding:4px 8px; font:10px/1 monospace; background:${this._clayMode ? 'rgba(180,160,140,0.8)' : 'rgba(60,60,65,0.8)'}; color:${this._clayMode ? '#fff' : '#bbb'}; border:0; border-radius:3px; cursor:pointer;"
              @click=${() => this._fire('toggle-clay', null)}>
              ${this._clayMode ? 'Clay' : 'Textured'}
            </button>
          </div>
          <div class="field">
            <label>Overlay</label>
            <button style="flex:1; padding:4px 8px; font:10px/1 monospace; background:${this._overlayMode !== 'none' ? 'rgba(60,140,100,0.8)' : 'rgba(60,60,65,0.8)'}; color:${this._overlayMode !== 'none' ? '#fff' : '#bbb'}; border:0; border-radius:3px; cursor:pointer;"
              @click=${() => this._fire('cycle-overlay', null)}>
              ${this._overlayMode === 'none' ? 'Off' : this._overlayMode}
            </button>
          </div>
          <div class="field">
            <label>Present</label>
            <button style="flex:1; padding:4px 8px; font:10px/1 monospace; background:${this._presentMode ? 'rgba(200,160,60,0.8)' : 'rgba(60,60,65,0.8)'}; color:${this._presentMode ? '#fff' : '#bbb'}; border:0; border-radius:3px; cursor:pointer;"
              @click=${() => this._fire('toggle-present', null)}>
              ${this._presentMode ? 'On' : 'Off'}
            </button>
          </div>
          ${this._slider('Sun Az', this._sunAz, 0, 360, 1, v => this._fire('set-sun', { azimuth: v, elevation: this._sunEl }), '°')}
          ${this._slider('Sun El', this._sunEl, 5, 85, 1, v => this._fire('set-sun', { azimuth: this._sunAz, elevation: v }), '°')}
        </div>` : ''}
      </div>`;
  }

  // ── Erosion (blank canvas) ──
  private _renderErosion() {
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._erosionOpen = !this._erosionOpen}>
          <span class="arrow">${this._erosionOpen ? '▼' : '▶'}</span>
          Erosion
          <span class="class-tag tag-rebake">Apply</span>
        </div>
        ${this._erosionOpen ? html`<div class="section-body">
          ${this._slider('Iterations', this._canvasErosionIter, 5, 40, 1, v => { this._canvasErosionIter = v; })}
          ${this._slider('Strength', this._canvasErosionK, 0.001, 0.02, 0.001, v => { this._canvasErosionK = v; })}
          <button class="rebake-btn" @click=${() => this._fire('apply-erosion', {
            iterations: this._canvasErosionIter,
            erosionStrength: this._canvasErosionK,
          })}>Apply Erosion</button>
          <div class="status-text">Runs stream-power + channels + hillslope on sculpted terrain. Undoable.</div>
        </div>` : ''}
      </div>`;
  }

  // ── Brush (blank canvas sculpt) ──
  private _renderBrush() {
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._brushOpen = !this._brushOpen}>
          <span class="arrow">${this._brushOpen ? '▼' : '▶'}</span>
          Brush
          <span class="class-tag tag-live">Live</span>
        </div>
        ${this._brushOpen ? html`<div class="section-body">
          ${this._slider('Radius', this._brushRadius, 5, 80, 1, v => { this._brushRadius = v; this._fire('set-brush', { radius: v, strength: this._brushStrength }); })}
          ${this._slider('Strength', this._brushStrength, 1, 30, 1, v => { this._brushStrength = v; this._fire('set-brush', { radius: this._brushRadius, strength: v }); })}
          <div class="status-text">Click terrain to raise</div>
        </div>` : ''}
      </div>`;
  }

  // ── Scene (LIVE) ──
  private _renderScene() {
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._sceneOpen = !this._sceneOpen}>
          <span class="arrow">${this._sceneOpen ? '▼' : '▶'}</span>
          Scene
          <span class="class-tag tag-live">Live</span>
        </div>
        ${this._sceneOpen ? html`<div class="section-body">
          ${this._slider('Exposure', this._exposure, 0.2, 3.0, 0.05, v => this._fire('set-exposure', v))}
          ${this._slider('Clouds', this._cloudCoverage, 0, 1, 0.05, v => this._fire('set-clouds', v))}
          ${this._slider('Water', this._waterLevel, 0, 30, 0.5, v => this._fire('set-water', v))}
        </div>` : ''}
      </div>`;
  }

  // ── Terrain (REBAKE) ──
  private _renderTerrain() {
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._terrainOpen = !this._terrainOpen}>
          <span class="arrow">${this._terrainOpen ? '▼' : '▶'}</span>
          Terrain
          <span class="class-tag tag-rebake">Rebake</span>
          ${this._needsRebake ? html`<span class="rebake-badge">!</span>` : ''}
        </div>
        ${this._terrainOpen ? html`<div class="section-body">
          <div class="field">
            <label>Preset</label>
            <select @change=${(e: Event) => this._setRebakeParam('preset', (e.target as HTMLSelectElement).value)}>
              <option value="chain" ?selected=${this._preset === 'chain'}>Chain</option>
              <option value="basin" ?selected=${this._preset === 'basin'}>Basin</option>
              <option value="plateau" ?selected=${this._preset === 'plateau'}>Plateau</option>
            </select>
          </div>
          ${this._slider('SP Iterations', this._spIterations, 5, 50, 1, v => { this._spIterations = v; this._setRebakeParam('spIterations', v); })}
          ${this._slider('Erosion', this._erosionStrength, 0.001, 0.02, 0.001, v => { this._erosionStrength = v; this._setRebakeParam('erosionStrength', v); })}
          ${this._slider('Diffusion', this._diffusionStrength, 0, 0.05, 0.002, v => { this._diffusionStrength = v; this._setRebakeParam('diffusionStrength', v); })}
          ${this._slider('Fan', this._fanStrength, 0, 2, 0.1, v => { this._fanStrength = v; this._setRebakeParam('fanStrength', v); })}
          ${this._slider('Thermal', this._thermalIterations, 0, 50, 1, v => { this._thermalIterations = v; this._setRebakeParam('thermalIterations', v); })}
          ${this._needsRebake ? html`
            <button class="rebake-btn" @click=${() => this._fire('rebake', null)}>Apply & Rebake</button>
            ${this._bakeProgress ? html`<div class="status-text">${this._bakeProgress}</div>` : ''}
          ` : html`<div class="status-text">Terrain is up to date</div>`}
        </div>` : ''}
      </div>`;
  }

  // ── Materials (APPLY) ──
  private _renderMaterials() {
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._materialsOpen = !this._materialsOpen}>
          <span class="arrow">${this._materialsOpen ? '▼' : '▶'}</span>
          Materials
          <span class="class-tag tag-live">Live</span>
        </div>
        ${this._materialsOpen ? html`<div class="section-body">
          ${this._slider('Snow', this._snowThreshold, 0.5, 1.0, 0.01, v => { this._snowThreshold = v; this._fire('set-material', { snowThreshold: v }); })}
          ${this._slider('Rock Min', this._rockSlopeMin, 0.1, 0.8, 0.02, v => { this._rockSlopeMin = v; this._fire('set-material', { rockSlopeMin: v }); })}
          ${this._slider('Rock Max', this._rockSlopeMax, 0.2, 1.0, 0.02, v => { this._rockSlopeMax = v; this._fire('set-material', { rockSlopeMax: v }); })}
          ${this._slider('Sediment', this._sedimentEmphasis, 0, 1, 0.05, v => { this._sedimentEmphasis = v; this._fire('set-material', { sedimentEmphasis: v }); })}
          <div class="status-text">Updates terrain in real time</div>
        </div>` : ''}
      </div>`;
  }

  // ── Scatter (APPLY) ──
  private _renderScatter() {
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._scatterOpen = !this._scatterOpen}>
          <span class="arrow">${this._scatterOpen ? '▼' : '▶'}</span>
          Scatter
          <span class="class-tag tag-apply">Apply</span>
        </div>
        ${this._scatterOpen ? html`<div class="section-body">
          ${this._slider('Grass', this._grassDensity, 0, 2, 0.1, v => { this._grassDensity = v; this._fire('set-scatter', { grassDensity: v }); })}
          ${this._slider('Rocks', this._rockDensity, 0, 3, 0.1, v => { this._rockDensity = v; this._fire('set-scatter', { rockDensity: v }); })}
          ${this._slider('Shrubs', this._shrubDensity, 0, 2, 0.1, v => { this._shrubDensity = v; this._fire('set-scatter', { shrubDensity: v }); })}
          ${this._slider('Alpine', this._alpineCutoff, 0.5, 1.0, 0.02, v => { this._alpineCutoff = v; this._fire('set-scatter', { alpineCutoff: v }); })}
          ${this._slider('Debris', this._debrisEmphasis, 0, 3, 0.1, v => { this._debrisEmphasis = v; this._fire('set-scatter', { debrisEmphasis: v }); })}
          <div class="status-text">Rebuilds foliage on change</div>
        </div>` : ''}
      </div>`;
  }

  // ── Helpers ──

  private _slider(label: string, value: number, min: number, max: number, step: number, onChange: (v: number) => void, suffix = '') {
    const decimals = step < 0.01 ? 3 : step < 1 ? 2 : 0;
    return html`
      <div class="field">
        <label>${label}</label>
        <input type="range" .value=${String(value)} min=${min} max=${max} step=${step}
          @input=${(e: Event) => onChange(parseFloat((e.target as HTMLInputElement).value))}>
        <span class="value">${value.toFixed(decimals)}${suffix}</span>
      </div>`;
  }

  private _fire(name: string, detail: any) {
    this.dispatchEvent(new CustomEvent(name, { detail, bubbles: true, composed: true }));
  }

  private _setRebakeParam(key: string, value: any) {
    this._fire('set-terrain-param', { key, value });
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vast-inspector': InspectorPanel;
  }
}
