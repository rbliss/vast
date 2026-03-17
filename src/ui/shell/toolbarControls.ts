/**
 * Toolbar controls — structured replacement for ad-hoc toolbar buttons.
 *
 * Renders into the top-bar toolbar slot of the editor shell.
 * Each control dispatches custom events consumed by main.ts.
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('vast-toolbar')
export class ToolbarControls extends LitElement {
  @property({ type: Boolean }) clayMode = false;
  @property({ type: Boolean }) presentMode = false;
  @property({ type: String }) overlayMode = 'none';
  @property({ type: String }) sunLabel = 'SW 35°';
  @property({ type: String }) saveStatus = '';

  static styles = css`
    :host {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    button {
      border: 0;
      border-radius: 4px;
      padding: 4px 10px;
      font: 11px/1 monospace;
      background: rgba(60, 60, 65, 0.8);
      color: #bbb;
      cursor: pointer;
    }
    button:hover { background: rgba(80, 80, 85, 0.9); color: #ddd; }
    button.active { background: rgba(60, 120, 200, 0.7); color: #fff; }
    button.clay-active { background: rgba(180, 160, 140, 0.8); color: #fff; }
    button.present-active { background: rgba(200, 160, 60, 0.8); color: #fff; }
    button.overlay-active { background: rgba(60, 140, 100, 0.8); color: #fff; }

    .separator {
      width: 1px;
      height: 16px;
      background: rgba(255, 255, 255, 0.12);
      margin: 0 4px;
    }
  `;

  render() {
    return html`
      <button
        class=${this.presentMode ? 'present-active' : ''}
        @click=${() => this._emit('toggle-present')}
      >${this.presentMode ? 'Present On' : 'Present'}</button>

      <button @click=${() => this._emit('cycle-sun')}>Sun: ${this.sunLabel}</button>

      <div class="separator"></div>

      <button
        class=${this.clayMode ? 'clay-active' : ''}
        @click=${() => this._emit('toggle-clay')}
      >${this.clayMode ? 'Clay On' : 'Clay'}</button>

      <button
        class=${this.overlayMode !== 'none' ? 'overlay-active' : ''}
        @click=${() => this._emit('cycle-overlay')}
      >Overlay: ${this.overlayMode === 'none' ? 'Off' : this.overlayMode}</button>

      <div class="separator"></div>

      <button @click=${() => this._emit('take-snapshot')}>Snapshot</button>

      <div class="separator"></div>

      <button @click=${() => this._emit('save-project')}>Save</button>
      <button @click=${() => this._emit('open-project')}>Open</button>
      ${this.saveStatus ? html`<span style="color:#888; font-size:10px;">${this.saveStatus}</span>` : ''}

      <div class="separator"></div>

      <button @click=${() => this._emit('blank-canvas')}>Blank Canvas</button>
      <button @click=${() => this._emit('test-environment')}>Test Environment</button>
      <button @click=${() => this._emit('reset-canvas')}>Reset Canvas</button>
    `;
  }

  private _emit(name: string) {
    this.dispatchEvent(new CustomEvent(name, { bubbles: true, composed: true }));
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vast-toolbar': ToolbarControls;
  }
}
