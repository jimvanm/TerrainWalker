// The city on a moved piece of ground: fetches the map tiles under its outline
// in the background, and gathers what the helpers build (citykit.js) so the
// piece can be drawn with its roads, buildings and painted map.
//
// One City per outline picked up: it knows the tiles and the outline. A piece's
// ground can stand in two ways (rise above its edge, or height above sea level),
// and what stands on it depends on which, so each drawn model gets its own
// layers (attach): the meshes and paint for that ground, filling up as tiles
// arrive. A tile that arrives after the piece is laid is added to it then.
//
// The helpers are reached through run(spec): Promise of a result. In the app
// that is workerRunner() below; tests pass their own.

import { mapTiles } from './piecegrid.js';
import { tileCentreMerc, wrapMercDx } from './geo.js';
import { WorkerPool } from './pool.js';

const CONCURRENCY = 3;   // map tiles being built at once

export class City {
  // poly: the outline (east, north true metres); cx, cy: its middle in mercator
  // metres; k: true metres per mercator metre.
  // mapUrl(z, x, y): the map tile's address, or null while that is not known.
  // maskModels: the landmarks that come along, whose map buildings are hidden.
  constructor({ poly, cx, cy, k, run, mapUrl, maskModels = [], concurrency = CONCURRENCY }) {
    this.poly = poly; this.cx = cx; this.cy = cy; this.k = k;
    this.run = run; this.mapUrl = mapUrl; this.maskModels = maskModels;
    this.concurrency = concurrency;
    this.map = mapTiles(poly, cx, cy, k);       // { z, tiles }
    this.queue = [];
    this.inflight = 0;
  }

  // Layers for one drawn model of the piece. built: buildPiece's result (its
  // grid is the ground). Returns the layers, filled in as tiles arrive:
  //   roads, built  lists of { vertices, indices[, info] } in the slab's frame
  //   paint         lists of citykit samplePaint results
  //   version       goes up whenever something is added
  //   total, settled  map tiles wanted, and done (built, or failed for good)
  attach(built) {
    const layers = { roads: [], built: [], paint: [], version: 0, total: 0, settled: 0, failed: 0,
      noMap: false, cancelled: false, lastError: '', stats: { kept: 0, dropped: 0, seen: 0 } };
    layers.cancel = () => { layers.cancelled = true; };
    const { z, tiles } = this.map;
    if (!tiles.length || !tiles.every((t) => this.mapUrl(z, t.x, t.y))) { layers.noMap = true; return layers; }
    const slab = { poly: this.poly, cx: this.cx, cy: this.cy, k: this.k, grid: gridForWorker(built.grid) };
    layers.total = tiles.length;
    const jobs = tiles.map((t) => {
      const c = tileCentreMerc(t.rawX, t.y, z);
      const rank = Math.hypot(wrapMercDx(c.x - this.cx), c.y - this.cy);
      return { layers, rank, spec: { city: true, vurl: this.mapUrl(z, t.x, t.y), tile: { x: t.x, y: t.y, z }, slab, maskModels: this.maskModels } };
    });
    this.queue.push(...jobs);
    this.queue.sort((a, b) => a.rank - b.rank);
    this._pump();
    return layers;
  }

  _pump() {
    while (this.inflight < this.concurrency && this.queue.length) {
      const job = this.queue.shift();
      const ly = job.layers;
      if (ly.cancelled) continue;
      this.inflight++;
      Promise.resolve().then(() => this.run(job.spec)).then((msg) => {
        if (!ly.cancelled) this._accept(ly, msg);
      }, (e) => {
        ly.failed++; ly.lastError = String((e && e.message) || e);
      }).finally(() => {
        ly.settled++; this.inflight--; this._pump();
      });
    }
  }

  _accept(ly, m) {
    const roads = m.roads || (m.rIndices ? { vertices: m.rVertices, indices: m.rIndices, verts: m.rVerts } : null);
    const bld = m.bld || (m.bIndices ? { vertices: m.bVertices, indices: m.bIndices, info: m.bInfo, verts: m.bVerts } : null);
    if (roads && roads.indices.length) ly.roads.push({ vertices: roads.vertices, indices: roads.indices });
    if (bld && bld.indices.length) ly.built.push({ vertices: bld.vertices, indices: bld.indices, info: bld.info });
    if (m.paint && m.paint.idx.length) ly.paint.push(m.paint);
    if (m.stats) { ly.stats.kept += m.stats.kept || 0; ly.stats.dropped += m.stats.dropped || 0; ly.stats.seen += m.stats.seen || 0; }
    ly.version++;
  }
}

// What a helper needs of the ground: only the numbers, not the heights above sea level.
function gridForWorker(g) {
  return { e0: g.e0, n1: g.n1, step: g.step, W: g.W, H: g.H, up: g.up, cellIn: g.cellIn };
}

// Reaches the near-field helpers (nearworker.js) for the app: run(spec) sends
// the job to the next free helper and answers with its result.
export function workerRunner(size = 3) {
  let pool = null;
  const waiting = new Map();      // key -> { resolve, reject }
  let n = 0;
  const make = () => new WorkerPool(new URL('./nearworker.js', import.meta.url), size, {
    message: (s) => ({ msg: s.msg, transfer: [] }),
    onResult: (spec, msg) => { const w = waiting.get(spec.key); waiting.delete(spec.key); if (w) w.resolve(msg); pool.pump(rank); },
    onFail: (spec, error) => { const w = waiting.get(spec.key); waiting.delete(spec.key); if (w) w.reject(new Error(error)); pool.pump(rank); },
    onError: () => {},
  });
  const rank = (s) => s.rank || 0;
  return (spec) => new Promise((resolve, reject) => {
    if (!pool) pool = make();
    if (pool.dead) { reject(new Error('no helper')); return; }
    const key = 'city:' + (n++);
    waiting.set(key, { resolve, reject });
    pool.want(key, { msg: spec, rank: 0 });
    pool.pump(rank);
  });
}
