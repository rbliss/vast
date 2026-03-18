/**
 * Reference Images panel.
 *
 * Drag-and-drop or click-to-browse for external reference images.
 * Images are for discussion/comparison only — not part of the simulation.
 * Stored as object URLs in memory (session-only for v1).
 */

import { LitElement, html, css } from 'lit';
import { customElement, state } from 'lit/decorators.js';

interface RefImage {
  id: string;
  name: string;
  url: string;
  width: number;
  height: number;
}

@customElement('vast-references')
export class ReferencePanel extends LitElement {
  @state() private _images: RefImage[] = [];
  @state() private _previewUrl: string | null = null;
  @state() private _open = true;

  static styles = css`
    :host {
      display: block;
      font: 11px/1.5 monospace;
      color: #ccc;
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
      font-size: 11px;
    }
    .section-header:hover { color: #ddd; }
    .section-header .arrow { margin-right: 6px; font-size: 9px; }
    .section-header .count {
      margin-left: auto;
      font-weight: normal;
      font-size: 9px;
      color: #888;
    }

    .section-body {
      padding: 4px 12px 12px;
    }

    .dropzone {
      border: 2px dashed rgba(255,255,255,0.15);
      border-radius: 6px;
      padding: 12px;
      text-align: center;
      color: #777;
      font-size: 10px;
      cursor: pointer;
      transition: border-color 0.2s, background 0.2s;
    }
    .dropzone:hover, .dropzone.dragover {
      border-color: rgba(100,140,200,0.5);
      background: rgba(100,140,200,0.08);
      color: #aab;
    }

    .thumbnails {
      display: grid;
      grid-template-columns: repeat(3, 1fr);
      gap: 4px;
      margin-top: 8px;
    }

    .thumb {
      position: relative;
      aspect-ratio: 1;
      border-radius: 4px;
      overflow: hidden;
      cursor: pointer;
      border: 1px solid rgba(255,255,255,0.1);
    }
    .thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .thumb:hover .thumb-remove {
      opacity: 1;
    }
    .thumb-remove {
      position: absolute;
      top: 2px;
      right: 2px;
      width: 16px;
      height: 16px;
      background: rgba(0,0,0,0.7);
      color: #fff;
      border: 0;
      border-radius: 50%;
      font-size: 10px;
      line-height: 16px;
      text-align: center;
      cursor: pointer;
      opacity: 0;
      transition: opacity 0.15s;
    }

    .clear-btn {
      margin-top: 6px;
      width: 100%;
      padding: 4px;
      font: 10px/1 monospace;
      background: rgba(60,60,65,0.8);
      color: #999;
      border: 0;
      border-radius: 3px;
      cursor: pointer;
    }
    .clear-btn:hover { background: rgba(80,60,60,0.9); color: #caa; }

    .preview-overlay {
      position: fixed;
      top: 0; left: 0; right: 0; bottom: 0;
      background: rgba(0,0,0,0.85);
      display: flex;
      align-items: center;
      justify-content: center;
      z-index: 1000;
      cursor: pointer;
    }
    .preview-overlay img {
      max-width: 90vw;
      max-height: 90vh;
      border-radius: 4px;
      box-shadow: 0 4px 20px rgba(0,0,0,0.5);
    }

    input[type="file"] { display: none; }
  `;

  render() {
    return html`
      <div class="section">
        <div class="section-header" @click=${() => this._open = !this._open}>
          <span class="arrow">${this._open ? '▼' : '▶'}</span>
          References
          ${this._images.length > 0 ? html`<span class="count">${this._images.length}</span>` : ''}
        </div>
        ${this._open ? html`
          <div class="section-body">
            <div class="dropzone ${this._dragOver ? 'dragover' : ''}"
              @click=${this._openFilePicker}
              @dragover=${this._onDragOver}
              @dragleave=${this._onDragLeave}
              @drop=${this._onDrop}
            >
              Drop images here or click to browse
            </div>

            ${this._images.length > 0 ? html`
              <div class="thumbnails">
                ${this._images.map(img => html`
                  <div class="thumb" @click=${() => this._preview(img.url)}>
                    <img src=${img.url} alt=${img.name}>
                    <button class="thumb-remove" @click=${(e: Event) => { e.stopPropagation(); this._remove(img.id); }}>×</button>
                  </div>
                `)}
              </div>
              <button class="clear-btn" @click=${this._clearAll}>Clear All</button>
            ` : ''}
          </div>
        ` : ''}
      </div>

      ${this._previewUrl ? html`
        <div class="preview-overlay" @click=${() => this._previewUrl = null}>
          <img src=${this._previewUrl}>
        </div>
      ` : ''}

      <input type="file" id="ref-file-input"
        accept=".png,.jpg,.jpeg,.webp"
        multiple
        @change=${this._onFileSelect}>
    `;
  }

  @state() private _dragOver = false;

  private _onDragOver(e: DragEvent) {
    e.preventDefault();
    this._dragOver = true;
  }

  private _onDragLeave() {
    this._dragOver = false;
  }

  private _onDrop(e: DragEvent) {
    e.preventDefault();
    this._dragOver = false;
    const files = e.dataTransfer?.files;
    if (files) this._addFiles(files);
  }

  private _openFilePicker() {
    const input = this.shadowRoot?.getElementById('ref-file-input') as HTMLInputElement;
    if (input) input.click();
  }

  private _onFileSelect(e: Event) {
    const input = e.target as HTMLInputElement;
    if (input.files) this._addFiles(input.files);
    input.value = '';
  }

  private _addFiles(files: FileList) {
    const validTypes = ['image/png', 'image/jpeg', 'image/webp'];
    for (const file of Array.from(files)) {
      if (!validTypes.includes(file.type)) continue;

      const url = URL.createObjectURL(file);
      const id = `ref_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;

      // Read dimensions
      const img = new Image();
      img.onload = () => {
        this._images = [...this._images, {
          id,
          name: file.name,
          url,
          width: img.naturalWidth,
          height: img.naturalHeight,
        }];
      };
      img.src = url;
    }
  }

  private _remove(id: string) {
    const img = this._images.find(i => i.id === id);
    if (img) URL.revokeObjectURL(img.url);
    this._images = this._images.filter(i => i.id !== id);
  }

  private _clearAll() {
    for (const img of this._images) URL.revokeObjectURL(img.url);
    this._images = [];
  }

  private _preview(url: string) {
    this._previewUrl = url;
  }
}

declare global {
  interface HTMLElementTagNameMap {
    'vast-references': ReferencePanel;
  }
}
