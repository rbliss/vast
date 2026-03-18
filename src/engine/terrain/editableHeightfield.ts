/**
 * Editable heightfield for blank-canvas sculpt mode.
 *
 * A direct-edit height grid that supports:
 *   - Brush stamps (raise terrain with click)
 *   - Local dirty-region tracking for chunk rebuilds
 *   - Undo/redo via delta snapshots
 *   - Fast sampling (no erosion bake)
 */

import type { TerrainSource } from './terrainSource';
import { CHUNK_SIZE } from '../config';

export interface BrushStamp {
  /** World-space center X */
  x: number;
  /** World-space center Z */
  z: number;
  /** Brush radius in world units */
  radius: number;
  /** Height to add at center */
  strength: number;
}

export class EditableHeightfield implements TerrainSource {
  private readonly _grid: Float32Array;
  private readonly _gridSize: number;
  private readonly _extent: number;
  private readonly _cellSize: number;
  private readonly _undoStack: Float32Array[] = [];
  private readonly _redoStack: Float32Array[] = [];
  private readonly _maxUndo = 20; // reduced for 1024² grid (~4MB per snapshot)
  private _strokeActive = false;
  private _strokeSnapshot: Float32Array | null = null;

  constructor(gridSize: number = 1024, extent: number = 800) {
    this._gridSize = gridSize;
    this._extent = extent;
    this._cellSize = (extent * 2) / (gridSize - 1);
    this._grid = new Float32Array(gridSize * gridSize);
  }

  get gridSize() { return this._gridSize; }
  get extent() { return this._extent; }
  get cellSize() { return this._cellSize; }
  /** Direct access to the height grid for erosion passes */
  get grid() { return this._grid; }

  /** Sample height at world position via bilinear interpolation */
  sampleHeight(x: number, z: number): number {
    const gx = (x + this._extent) / this._cellSize;
    const gz = (z + this._extent) / this._cellSize;

    if (gx < 0 || gx >= this._gridSize - 1 || gz < 0 || gz >= this._gridSize - 1) {
      return 0;
    }

    const ix = Math.floor(gx);
    const iz = Math.floor(gz);
    const fx = gx - ix;
    const fz = gz - iz;
    const n = this._gridSize;

    const h00 = this._grid[iz * n + ix];
    const h10 = this._grid[iz * n + ix + 1];
    const h01 = this._grid[(iz + 1) * n + ix];
    const h11 = this._grid[(iz + 1) * n + ix + 1];

    return h00 * (1 - fx) * (1 - fz) +
           h10 * fx * (1 - fz) +
           h01 * (1 - fx) * fz +
           h11 * fx * fz;
  }

  /** Begin a drag stroke — snapshot saved once for the whole stroke */
  beginStroke(): void {
    if (this._strokeActive) return;
    this._strokeActive = true;
    this._strokeSnapshot = new Float32Array(this._grid);
    this._redoStack.length = 0;
  }

  /** End a drag stroke — commit the snapshot to undo history */
  endStroke(): void {
    if (!this._strokeActive) return;
    this._strokeActive = false;
    if (this._strokeSnapshot) {
      this._undoStack.push(this._strokeSnapshot);
      if (this._undoStack.length > this._maxUndo) this._undoStack.shift();
      this._strokeSnapshot = null;
    }
  }

  /**
   * Apply a brush stamp. Returns the set of affected chunk coordinates.
   * If called outside a stroke, saves undo state per stamp.
   */
  applyStamp(stamp: BrushStamp): Set<string> {
    // Save undo state only if not in a stroke (strokes save once at begin)
    if (!this._strokeActive) {
      this._pushUndo();
    }

    const n = this._gridSize;
    const cs = this._cellSize;

    // Compute grid-space bounds of brush influence
    const gxMin = Math.max(0, Math.floor((stamp.x - stamp.radius + this._extent) / cs));
    const gxMax = Math.min(n - 1, Math.ceil((stamp.x + stamp.radius + this._extent) / cs));
    const gzMin = Math.max(0, Math.floor((stamp.z - stamp.radius + this._extent) / cs));
    const gzMax = Math.min(n - 1, Math.ceil((stamp.z + stamp.radius + this._extent) / cs));

    // Apply soft dome stamp (smoothstep falloff — much rounder than Gaussian)
    const r2 = stamp.radius * stamp.radius;
    for (let gz = gzMin; gz <= gzMax; gz++) {
      for (let gx = gxMin; gx <= gxMax; gx++) {
        const wx = -this._extent + gx * cs;
        const wz = -this._extent + gz * cs;
        const dx = wx - stamp.x;
        const dz = wz - stamp.z;
        const d2 = dx * dx + dz * dz;

        if (d2 < r2) {
          // Smoothstep dome: flat top, gentle edges, no spiky peak
          const t = Math.sqrt(d2 / r2); // 0 at center, 1 at edge
          const falloff = 1 - t * t * (3 - 2 * t); // smoothstep inverse
          this._grid[gz * n + gx] += stamp.strength * falloff;
        }
      }
    }

    // Compute affected chunks
    const affectedChunks = new Set<string>();
    const wxMin = -this._extent + gxMin * cs;
    const wxMax = -this._extent + gxMax * cs;
    const wzMin = -this._extent + gzMin * cs;
    const wzMax = -this._extent + gzMax * cs;

    const cxMin = Math.floor(wxMin / CHUNK_SIZE);
    const cxMax = Math.ceil(wxMax / CHUNK_SIZE);
    const czMin = Math.floor(wzMin / CHUNK_SIZE);
    const czMax = Math.ceil(wzMax / CHUNK_SIZE);

    for (let cz = czMin; cz <= czMax; cz++) {
      for (let cx = cxMin; cx <= cxMax; cx++) {
        affectedChunks.add(`${cx},${cz}`);
      }
    }

    return affectedChunks;
  }

  /** Reset to flat plane */
  reset(): void {
    this._pushUndo();
    this._grid.fill(0);
  }

  /** Undo last stamp */
  undo(): boolean {
    if (this._undoStack.length === 0) return false;
    this._redoStack.push(new Float32Array(this._grid));
    const prev = this._undoStack.pop()!;
    this._grid.set(prev);
    return true;
  }

  /** Redo last undone action */
  redo(): boolean {
    if (this._redoStack.length === 0) return false;
    this._undoStack.push(new Float32Array(this._grid));
    const next = this._redoStack.pop()!;
    this._grid.set(next);
    return true;
  }

  private _pushUndo(): void {
    this._undoStack.push(new Float32Array(this._grid));
    if (this._undoStack.length > this._maxUndo) {
      this._undoStack.shift();
    }
    this._redoStack.length = 0; // Clear redo on new action
  }
}
