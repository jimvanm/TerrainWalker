// Terrain tile requests: which tiles to fetch, and in what order.
// Only MAX_INFLIGHT requests are ever outstanding: this endpoint is a free
// public good and does not deserve to be hammered.

import { TILE_URL, WORKERS, MAX_INFLIGHT, VECTOR_MAXZOOM } from './config.js';
import { WorkerPool } from './pool.js';

export const keyOf = (z, x, y) => z + '/' + x + '/' + y;

const HELPER_FAILED = 'The tile helper failed to load.\n\n%ERR%\n\n' +
  'Almost always means src/worker.js is being served with the wrong MIME ' +
  'type. Run  python serve.py  instead of  python -m http.server, ' +
  'and open /diag.html to confirm.';

export class Loader {
  constructor(onTile, fatal) {
    this.onTile = onTile;
    this.fatal = fatal || ((m) => console.error(m));
    this.lastError = null;
    this.vectorTemplate = null;   // set once the TileJSON resolves
    this.retry = new Map();       // key -> timestamp to retry after
    this.stats = { done: 0, failed: 0, bytes: 0 };

    this.pool = new WorkerPool(new URL('./worker.js', import.meta.url), WORKERS, {
      maxInflight: MAX_INFLIGHT,
      message: (s) => {
        const sub = (t) => t.replace('{z}', s.z).replace('{x}', s.x).replace('{y}', s.y);
        return {
          url: sub(TILE_URL),
          vurl: this.vectorTemplate && s.z <= VECTOR_MAXZOOM ? sub(this.vectorTemplate) : null,
          z: s.z, x: s.rawX, y: s.rawY, grid: s.grid, keepHeights: s.keepHeights,
        };
      },
      onResult: (spec, msg) => {
        this.stats.done++;
        this.retry.delete(spec.key);
        this.onTile(spec.key, spec, msg);
      },
      onFail: (spec, error) => {
        this.stats.failed++;
        this.lastError = error;
        // One retry after two seconds, then give up on this tile.
        if (!this.retry.has(spec.key)) this.retry.set(spec.key, performance.now() + 2000);
        else this.retry.set(spec.key, performance.now() + 1e12);
      },
      // A helper that fails before any tile has ever loaded is almost always the
      // server, not the network, so say so straight away. Later failures are
      // recovered from quietly.
      onError: (text) => {
        this.lastError = text;
        if (this.stats.done === 0) this.fatal(HELPER_FAILED.replace('%ERR%', text));
      },
    });
  }

  // Ask for a tile. Repeat calls for the same key are free, and update its priority.
  want(spec) {
    if (!this.pool.has(spec.key)) {
      const until = this.retry.get(spec.key);
      if (until && performance.now() < until) return;
    }
    this.pool.want(spec.key, spec);
  }

  // Drop queued requests that are no longer wanted.
  keepOnly(wantedKeys) { this.pool.keepOnly(wantedKeys); }

  pump() { this.pool.pump((s) => s.priority); }

  get queued() { return this.pool.size; }
}
