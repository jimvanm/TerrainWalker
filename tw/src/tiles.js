// Worker pool and request queue.
// Only MAX_INFLIGHT requests are ever outstanding: this endpoint is a free
// public good and does not deserve to be hammered.

import { TILE_URL, WORKERS, MAX_INFLIGHT, VECTOR_MAXZOOM } from './config.js';

export const keyOf = (z, x, y) => z + '/' + x + '/' + y;

export class Loader {
  constructor(onTile, fatal) {
    this.onTile = onTile;
    this.fatal = fatal || ((m) => console.error(m));
    this.lastError = null;
    this.vectorTemplate = null;   // set once the TileJSON resolves
    this.pool = [];
    this.free = [];
    this.queue = new Map();     // key -> spec, waiting
    this.inflight = new Map();  // id  -> key
    this.pending = new Set();   // keys queued or in flight
    this.retry = new Map();     // key -> timestamp to retry after
    this.nextId = 1;
    this.stats = { done: 0, failed: 0, bytes: 0 };

    for (let i = 0; i < WORKERS; i++) {
      let w;
      try {
        w = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      } catch (e) {
        this.fatal('Could not start a module worker: ' + e.message +
          '\n\nThis browser may not support module workers. Firefox needs 114+.');
        return;
      }
      w.onmessage = (ev) => this._done(w, ev.data);
      w.onerror = (e) => {
        this.fatal('The tile worker failed to load.\n\n' + (e.message || '') +
          '\n\nAlmost always means src/worker.js is being served with the wrong MIME ' +
          'type. Run  python serve.py  instead of  python -m http.server, ' +
          'and open /diag.html to confirm.');
        e.preventDefault && e.preventDefault();
      };
      this.pool.push(w);
      this.free.push(w);
    }
  }

  // Ask for a tile. Repeat calls for the same key are free.
  want(spec) {
    if (this.pending.has(spec.key)) {
      const q = this.queue.get(spec.key);
      if (q) q.priority = spec.priority;
      return;
    }
    const until = this.retry.get(spec.key);
    if (until && performance.now() < until) return;
    this.queue.set(spec.key, spec);
    this.pending.add(spec.key);
  }

  // Drop queued requests that are no longer wanted. Anything already in flight
  // is allowed to finish; cancelling mid-fetch wastes the bytes already spent.
  keepOnly(wantedKeys) {
    for (const k of [...this.queue.keys()]) {
      if (!wantedKeys.has(k)) { this.queue.delete(k); this.pending.delete(k); }
    }
  }

  pump() {
    while (this.free.length && this.inflight.size < MAX_INFLIGHT && this.queue.size) {
      let best = null;
      for (const s of this.queue.values()) {
        if (!best || s.priority < best.priority) best = s;
      }
      this.queue.delete(best.key);
      const w = this.free.pop();
      const id = this.nextId++;
      this.inflight.set(id, best.key);
      const sub = (t) => t.replace('{z}', best.z).replace('{x}', best.x).replace('{y}', best.y);
      const url = sub(TILE_URL);
      const vurl = this.vectorTemplate && best.z <= VECTOR_MAXZOOM ? sub(this.vectorTemplate) : null;
      w.postMessage({
        id, url, vurl, z: best.z, x: best.rawX, y: best.rawY,
        grid: best.grid, keepHeights: best.keepHeights,
      });
      this._specById = this._specById || new Map();
      this._specById.set(id, best);
    }
  }

  _done(w, msg) {
    const key = this.inflight.get(msg.id);
    const spec = this._specById && this._specById.get(msg.id);
    this.inflight.delete(msg.id);
    if (this._specById) this._specById.delete(msg.id);
    this.free.push(w);
    this.pending.delete(key);

    if (msg.ok) {
      this.stats.done++;
      this.retry.delete(key);
      this.onTile(key, spec, msg);
    } else {
      this.stats.failed++;
      this.lastError = msg.error;
      // One retry after two seconds, then give up on this tile.
      if (!this.retry.has(key)) this.retry.set(key, performance.now() + 2000);
      else this.retry.set(key, performance.now() + 1e12);
    }
  }

  get queued() { return this.queue.size + this.inflight.size; }
}
