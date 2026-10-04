// A pool of background helpers (web workers) and the queue of jobs waiting for
// them. Used by terrain, the near field and the skyline: each has its own pool,
// but they all work the same way.
//
// - want(key, spec) queues a job once; asking again is free (and refreshes it).
// - keepOnly(keys) drops queued jobs nobody wants any more. Jobs already
//   running are allowed to finish; cancelling mid-download wastes the bytes.
// - pump() hands queued jobs to free helpers, best first (lowest rank()).
// - A helper that dies is replaced and its job put back in the queue. Only
//   repeated failures give up, and then onDead() is called.
//
// What to do with a result, and whether and when to retry a failed job, is up
// to the owner: onResult(spec, msg) and onFail(spec, error).

const RESPAWN_MS = 1000;
const MAX_HELPER_FAILS = 12;

export class WorkerPool {
  // url:   the helper script, a URL object
  // size:  how many helpers
  // opts:  { onResult, onFail, onError, onDead, maxInflight, message }
  //   message(spec) -> { msg, transfer } or just msg: what to post for a job
  //   onError(text)  a helper failed to start or crashed (it will be replaced)
  constructor(url, size, opts) {
    this.url = url;
    this.opts = opts;
    this.maxInflight = opts.maxInflight || Infinity;
    this.helpers = [];
    this.free = [];
    this.queue = new Map();      // key -> spec, waiting
    this.inflight = new Map();   // id -> spec, running
    this.nextId = 1;
    this.helperFails = 0;
    this.dead = false;
    for (let i = 0; i < size; i++) this._spawn();
  }

  _spawn() {
    let w;
    try {
      w = new Worker(this.url, { type: 'module' });
    } catch (e) {
      this._helperFailed(null, 'could not start a helper: ' + e.message);
      return;
    }
    w.job = null;
    w.onmessage = (ev) => this._done(w, ev.data);
    w.onerror = (ev) => {
      if (ev && ev.preventDefault) ev.preventDefault();
      this._helperFailed(w, (ev && ev.message) || 'helper failed to load');
    };
    this.helpers.push(w);
    this.free.push(w);
  }

  _helperFailed(w, text) {
    if (w) {
      this.helpers = this.helpers.filter((x) => x !== w);
      this.free = this.free.filter((x) => x !== w);
      try { w.terminate(); } catch (e) { /* already gone */ }
      if (w.job) {                     // put its job back
        this.inflight.delete(w.job.id);
        this.queue.set(w.job.spec.key, w.job.spec);
        w.job = null;
      }
    }
    this.lastError = text;
    if (this.opts.onError) this.opts.onError(text);
    if (++this.helperFails > MAX_HELPER_FAILS) {
      if (!this.helpers.length) {
        this.dead = true;
        if (this.opts.onDead) this.opts.onDead(text);
      }
      return;
    }
    setTimeout(() => this._spawn(), RESPAWN_MS);
  }

  // Queued or running.
  has(key) {
    if (this.queue.has(key)) return true;
    for (const s of this.inflight.values()) if (s.key === key) return true;
    return false;
  }

  want(key, spec) {
    const q = this.queue.get(key);
    if (q) { Object.assign(q, spec); return; }
    if (this.has(key)) return;
    this.queue.set(key, { ...spec, key });
  }

  keepOnly(keys) {
    for (const k of [...this.queue.keys()]) if (!keys.has(k)) this.queue.delete(k);
  }

  clearQueue() { this.queue.clear(); }

  // rank(spec): lower runs first.
  pump(rank) {
    while (this.free.length && this.inflight.size < this.maxInflight && this.queue.size) {
      let best = null, bestRank = Infinity;
      for (const s of this.queue.values()) {
        const r = rank(s);
        if (best === null || r < bestRank) { best = s; bestRank = r; }
      }
      this.queue.delete(best.key);
      const w = this.free.pop();
      const id = this.nextId++;
      this.inflight.set(id, best);
      w.job = { id, spec: best };
      const m = this.opts.message(best);
      if (m && m.msg) w.postMessage({ ...m.msg, id }, m.transfer || []);
      else w.postMessage({ ...m, id });
    }
  }

  _done(w, msg) {
    const spec = this.inflight.get(msg.id);
    this.inflight.delete(msg.id);
    w.job = null;
    if (this.helpers.includes(w)) this.free.push(w);
    if (!spec) return;
    if (msg.ok) this.opts.onResult(spec, msg);
    else {
      this.lastError = msg.error;
      this.opts.onFail(spec, msg.error);
    }
  }

  get size() { return this.queue.size + this.inflight.size; }
  get busy() { return this.size > 0; }
}
