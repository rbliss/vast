/**
 * Document persistence — save/load/autosave.
 *
 * Three persistence paths:
 *   1. File System Access: save/open with native file picker
 *   2. JSON export/import: download/upload fallback
 *   3. OPFS autosave: automatic draft recovery
 *
 * Bake artifacts are NOT stored in the document — they live in
 * the F1 bake cache (OPFS /bakes/). The document is kept small
 * and human-readable.
 */

import { serializeDocument, deserializeDocument, type WorldDocument } from './document';

// ── OPFS autosave ──

const AUTOSAVE_KEY = 'vast-autosave-draft.json';

async function getAutosaveDir(): Promise<FileSystemDirectoryHandle | null> {
  try {
    return await navigator.storage.getDirectory();
  } catch {
    return null;
  }
}

export async function autosave(doc: WorldDocument): Promise<boolean> {
  const dir = await getAutosaveDir();
  if (!dir) return false;

  try {
    const fileHandle = await dir.getFileHandle(AUTOSAVE_KEY, { create: true });
    const writable = await fileHandle.createWritable();
    await writable.write(serializeDocument(doc));
    await writable.close();
    return true;
  } catch (err) {
    console.warn('[autosave] failed:', err);
    return false;
  }
}

export async function loadAutosave(): Promise<WorldDocument | null> {
  const dir = await getAutosaveDir();
  if (!dir) return null;

  try {
    const fileHandle = await dir.getFileHandle(AUTOSAVE_KEY);
    const file = await fileHandle.getFile();
    const text = await file.text();
    return deserializeDocument(text);
  } catch {
    return null;
  }
}

export async function clearAutosave(): Promise<void> {
  const dir = await getAutosaveDir();
  if (!dir) return;
  try {
    await dir.removeEntry(AUTOSAVE_KEY);
  } catch { /* ignore if not exists */ }
}

// ── File System Access (native save/open) ──

let _fileHandle: FileSystemFileHandle | null = null;

export async function saveDocument(doc: WorldDocument): Promise<boolean> {
  if (_fileHandle) {
    try {
      const writable = await (_fileHandle as any).createWritable();
      await writable.write(serializeDocument(doc));
      await writable.close();
      console.log('[save] saved to', _fileHandle.name);
      return true;
    } catch (err) {
      console.warn('[save] write failed:', err);
    }
  }
  // Fall through to save-as
  return saveDocumentAs(doc);
}

export async function saveDocumentAs(doc: WorldDocument): Promise<boolean> {
  try {
    const handle = await (window as any).showSaveFilePicker({
      suggestedName: `${doc.meta.name}.vast.json`,
      types: [{
        description: 'VAST World',
        accept: { 'application/json': ['.vast.json', '.json'] },
      }],
    });
    _fileHandle = handle;
    const writable = await handle.createWritable();
    await writable.write(serializeDocument(doc));
    await writable.close();
    console.log('[save] saved as', handle.name);
    return true;
  } catch (err) {
    // User cancelled or API unavailable
    if ((err as any)?.name !== 'AbortError') {
      console.warn('[save] save-as failed:', err);
    }
    return false;
  }
}

export async function openDocument(): Promise<WorldDocument | null> {
  try {
    const [handle] = await (window as any).showOpenFilePicker({
      types: [{
        description: 'VAST World',
        accept: { 'application/json': ['.vast.json', '.json'] },
      }],
    });
    _fileHandle = handle;
    const file = await handle.getFile();
    const text = await file.text();
    const doc = deserializeDocument(text);
    console.log('[open] loaded', handle.name);
    return doc;
  } catch (err) {
    if ((err as any)?.name !== 'AbortError') {
      console.warn('[open] failed:', err);
    }
    return null;
  }
}

// ── JSON export/import fallback ──

export function exportDocumentJSON(doc: WorldDocument): void {
  const json = serializeDocument(doc);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${doc.meta.name}.vast.json`;
  a.click();
  URL.revokeObjectURL(url);
}

export async function importDocumentJSON(): Promise<WorldDocument | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json,.vast.json';
    input.onchange = async () => {
      const file = input.files?.[0];
      if (!file) { resolve(null); return; }
      try {
        const text = await file.text();
        resolve(deserializeDocument(text));
      } catch (err) {
        console.warn('[import] failed:', err);
        resolve(null);
      }
    };
    input.click();
  });
}
