/**
 * Editor shell — top-level layout component.
 *
 * Wraps the viewport canvas with structured panels:
 *   - Top bar: project controls, mode toggles
 *   - Left pane: layer stack / outliner (placeholder)
 *   - Center: viewport (hosts the Three.js canvas)
 *   - Right pane: inspector (placeholder)
 *   - Bottom bar: status, bake progress, diagnostics
 *
 * The canvas is NOT created by this component — it's moved into
 * the viewport slot from the renderer's domElement.
 */

import { LitElement, html, css } from 'lit';
import { customElement, property } from 'lit/decorators.js';

@customElement('vast-editor-shell')
export class EditorShell extends LitElement {
  @property({ type: Boolean }) leftOpen = false;
  @property({ type: Boolean }) rightOpen = false;
  @property({ type: String }) statusText = '';

  static styles = css`
    :host {
      display: grid;
      grid-template-areas:
        "top    top    top"
        "left   center right"
        "bottom bottom bottom";
      grid-template-columns: auto 1fr auto;
      grid-template-rows: auto 1fr auto;
      width: 100vw;
      height: 100vh;
      overflow: hidden;
      font-family: monospace;
      color: #ccc;
    }

    .top-bar {
      grid-area: top;
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 6px 12px;
      background: rgba(20, 20, 24, 0.92);
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      z-index: 10;
    }

    .top-bar .title {
      font-size: 13px;
      font-weight: bold;
      color: #ddd;
      margin-right: 12px;
    }

    .viewport {
      grid-area: center;
      position: relative;
      overflow: hidden;
    }

    .viewport ::slotted(canvas) {
      display: block;
      width: 100% !important;
      height: 100% !important;
    }

    .left-pane {
      grid-area: left;
      width: 0;
      overflow: hidden;
      background: rgba(20, 20, 24, 0.92);
      border-right: 1px solid rgba(255, 255, 255, 0.08);
      transition: width 0.2s ease;
    }
    .left-pane.open {
      width: 220px;
    }

    .right-pane {
      grid-area: right;
      width: 0;
      overflow: hidden;
      background: rgba(20, 20, 24, 0.92);
      border-left: 1px solid rgba(255, 255, 255, 0.08);
      transition: width 0.2s ease;
    }
    .right-pane.open {
      width: 280px;
    }

    .bottom-bar {
      grid-area: bottom;
      display: flex;
      align-items: center;
      gap: 12px;
      padding: 4px 12px;
      background: rgba(20, 20, 24, 0.92);
      border-top: 1px solid rgba(255, 255, 255, 0.08);
      font-size: 11px;
      color: #888;
      z-index: 10;
    }

    .bottom-bar .status {
      flex: 1;
    }

    /* Toolbar buttons inside top bar */
    ::slotted(button), button {
      border: 0;
      border-radius: 4px;
      padding: 4px 10px;
      font: 11px/1 monospace;
      background: rgba(60, 60, 65, 0.8);
      color: #bbb;
      cursor: pointer;
    }
    button:hover {
      background: rgba(80, 80, 85, 0.9);
      color: #ddd;
    }
    button.active {
      background: rgba(60, 120, 200, 0.7);
      color: #fff;
    }
  `;

  render() {
    return html`
      <div class="top-bar">
        <span class="title">VAST</span>
        <slot name="toolbar"></slot>
        <button @click=${this._toggleLeft}>Layers</button>
        <button @click=${this._toggleRight}>Inspector</button>
      </div>

      <div class="left-pane ${this.leftOpen ? 'open' : ''}">
        <slot name="left"></slot>
      </div>

      <div class="viewport">
        <slot name="viewport"></slot>
        <slot name="overlay"></slot>
      </div>

      <div class="right-pane ${this.rightOpen ? 'open' : ''}">
        <slot name="right"></slot>
      </div>

      <div class="bottom-bar">
        <span class="status">${this.statusText}</span>
        <slot name="bottom"></slot>
      </div>
    `;
  }

  private _toggleLeft() {
    this.leftOpen = !this.leftOpen;
    this._notifyResize();
  }

  private _toggleRight() {
    this.rightOpen = !this.rightOpen;
    this._notifyResize();
  }

  private _notifyResize() {
    // Give the CSS transition time to apply, then dispatch resize
    setTimeout(() => {
      window.dispatchEvent(new Event('resize'));
    }, 250);
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vast-editor-shell': EditorShell;
  }
}
