/**
 * Minimal reactive store base.
 *
 * Stores extend this to get subscribe/notify. Lit components
 * can subscribe in connectedCallback and requestUpdate on change.
 * No framework dependency — just a Set of callbacks.
 */

export type Listener = () => void;

export class Observable {
  private _listeners = new Set<Listener>();

  subscribe(fn: Listener): () => void {
    this._listeners.add(fn);
    return () => this._listeners.delete(fn);
  }

  protected notify() {
    for (const fn of this._listeners) fn();
  }
}
