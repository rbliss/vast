/**
 * Project store — document lifecycle state.
 *
 * Tracks the current world document, dirty state, and save status.
 * Consumed by the shell top bar and future save/load UI.
 */

import { Observable } from './observable';
import type { WorldDocument } from '../engine/document';

export type SaveStatus = 'clean' | 'dirty' | 'saving' | 'error';

export class ProjectStore extends Observable {
  private _document: WorldDocument | null = null;
  private _name = 'Untitled World';
  private _saveStatus: SaveStatus = 'clean';
  private _presetName = 'chain';

  get document() { return this._document; }
  get name() { return this._name; }
  get saveStatus() { return this._saveStatus; }
  get presetName() { return this._presetName; }

  setDocument(doc: WorldDocument) {
    this._document = doc;
    this._name = doc.meta.name;
    this.notify();
  }

  setPresetName(name: string) {
    this._presetName = name;
    this.notify();
  }

  setSaveStatus(status: SaveStatus) {
    this._saveStatus = status;
    this.notify();
  }

  markDirty() {
    this._saveStatus = 'dirty';
    this.notify();
  }
}

export const projectStore = new ProjectStore();
