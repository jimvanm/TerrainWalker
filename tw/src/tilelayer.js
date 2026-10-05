// What the near field and the skyline have in common: map tiles turned into
// meshes by background helpers (nearworker.js), held on the GPU, and drawn.
//
// The two layers differ only in which tiles they want and which they draw;
// near.js and skyline.js decide that. Which of them draws a given piece of
// ground is decided in handover.js, not here.

import { probe } from './perf.js';
import { tileCentreMerc, mercYToLat, mercXToLon } from './geo.js';
import { TYPE_NAMES, SIZE_NAMES } from './look.js';
import { elevationUrl } from './placetiles.js';
import { WorkerPool } from './pool.js';

const RETRY_MS = 10000;   // a failed tile is asked for again after this long

export class TileLayer {
  // mesh:        the shared MeshProgram
  // getTemplate: () => vector tile URL template, or null until it is known
  // opts:        { zoom, elevationZoom, workers }
  constructor(gl, mesh, getTemplate, opts) {
    this.gl = gl;
    this.mesh = mesh;
    this.getTemplate = getTemplate;
    this.Z = opts.zoom;
    this.EZ = opts.elevationZoom;   // the terrain zoom roads and buildings drape on
    this.tiles = new Map();      // key -> tile record (see _upload)
    this.failed = new Map();     // key -> retry-after timestamp
    this.want = [];              // what update() asked for, nearest first
    this.active = false;         // drawing at all
    this.blocked = false;        // not allowed to fetch right now
    this.stats = { done: 0, failed: 0 };
    this.skip = () => false;     // set by handover.js: ground another layer draws

    this.pool = new WorkerPool(new URL('./nearworker.js', import.meta.url), opts.workers, {
      message: (s) => this._message(s),
      onResult: (spec, msg) => {
        this.stats.done++;
        const t0 = performance.now();
        this._upload(spec, msg);
        probe.uploadMs += performance.now() - t0;
        probe.nearTiles++;
      },
      onFail: (spec, error) => {
        this.stats.failed++;
        this.lastError = error;
        this.failed.set(spec.key, performance.now() + RETRY_MS);
      },
      onError: (text) => { this.lastError = 'helper failed: ' + text; },
    });
  }

  get disabled() { return this.pool.dead; }
  get busy() { return this.pool.busy; }

  // Everything wanted has arrived (or failed for now), and nothing is waiting.
  get complete() {
    if (!this.active || this.disabled || !this.want.length) return false;
    if (this.blocked || this.pool.busy) return false;
    for (const w of this.want) if (!this.tiles.has(w.key) && !this.failed.has(w.key)) return false;
    return true;
  }

  // Queue what is wanted and missing, drop what is no longer wanted, and start
  // jobs, nearest first (rank).
  _request(fetchOk, rank) {
    const tpl = this.getTemplate();
    this.pool.keepOnly(new Set(this.want.map((w) => w.key)));
    if (fetchOk && tpl) {
      const now = performance.now();
      for (const w of this.want) {
        if (this.tiles.has(w.key) || this.pool.has(w.key)) continue;
        const retry = this.failed.get(w.key);
        if (retry !== undefined) { if (now < retry) continue; this.failed.delete(w.key); }
        this.pool.want(w.key, w);
      }
    }
    if (tpl) this.pool.pump(rank);
  }

  // The job for one tile. The elevation is the zoom-EZ tile underneath.
  _message(spec) {
    const Z = spec.z || this.Z;
    const nT = Math.pow(2, Z), x = ((spec.rawX % nT) + nT) % nT;
    const sub = (u, z, xx, yy) => u.replace('{z}', z).replace('{x}', xx).replace('{y}', yy);
    const ez = this.EZ;
    return {
      x, y: spec.y, z: Z, ez, ...this._jobOptions(spec),
      vurl: sub(this.getTemplate(), Z, x, spec.y),
      eurl: elevationUrl(ez, x >> (Z - ez), spec.y >> (Z - ez)),
    };
  }

  _jobOptions() { return {}; }       // extra fields for the helper; see skyline.js
  _tileExtras() { return {}; }       // extra fields on the tile record; see skyline.js

  _upload(spec, msg) {
    const roads = this.mesh.buffers(msg.vertices, msg.indices, null);   // roads need no facts
    const bld = msg.bIndices ? this.mesh.buffers(msg.bVertices, msg.bIndices, msg.bInfo) : { count: 0, vao: null };
    const z = spec.z || this.Z;
    this.tiles.set(spec.key, {
      key: spec.key, rawX: spec.rawX, y: spec.y, z,
      centre: tileCentreMerc(spec.rawX, spec.y, z),
      roads, bld, count: roads.count + bld.count,
      stats: msg.stats || null,
      rEnds: msg.rEnds || null, bEnds: (msg.stats && msg.stats.ends) || null,
      ...this._tileExtras(spec, msg),
    });
  }

  // Free tiles beyond `limit`, never one that is wanted or that keep(tile) protects.
  _evict(limit, keep = () => false) {
    if (this.tiles.size <= limit) return;
    const wk = new Set(this.want.map((w) => w.key));
    for (const [k, tile] of this.tiles) {
      if (this.tiles.size <= limit) break;
      if (wk.has(k) || keep(tile)) continue;
      this.mesh.freeBuffers(tile.roads);
      this.mesh.freeBuffers(tile.bld);
      this.tiles.delete(k);
    }
  }

  // How much of a tile's index buffer to draw. Buffers are written most
  // important first (motorways, then smaller roads; skyline, then large
  // buildings, then the rest), so a prefix is a simpler version of the tile.
  //   ring 0-1: everything   ring 2: middle   ring 3+: only the top
  _take(b, ends, ring) {
    if (!ends) return b.count;
    const n = ring <= 1 ? ends[2] : ring === 2 ? ends[1] : ends[0];
    return Math.min(b.count, n);
  }

  // Draw the given tiles. ringOf(tile) says how far out each one is, for _take.
  // The mesh program must already be in use for this pass. Returns how many
  // tiles had roads drawn.
  _drawTiles(tiles, pass, roadsOn, bldOn, ringOf) {
    const gl = this.gl, u = this.mesh.u;
    let drawn = 0;
    const offset = (t) => gl.uniform2f(u.uTileOffset, (t.centre.x - pass.mercX) * pass.k, (pass.mercY - t.centre.y) * pass.k);
    // Buildings stand clear of the ground, so they need no help with depth.
    if (bldOn) {
      for (const t of tiles) {
        if (!t.bld.count) continue;
        const n = this._take(t.bld, t.bEnds, ringOf(t));
        if (!n) continue;
        offset(t);
        gl.bindVertexArray(t.bld.vao);
        gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_INT, 0);
      }
    }
    // Roads lie on the ground. Pull them toward the camera in proportion to
    // surface slope, which a fixed height offset cannot do at both 5 m and 500 m.
    if (roadsOn) {
      gl.enable(gl.POLYGON_OFFSET_FILL);
      gl.polygonOffset(-2, -2);
      for (const t of tiles) {
        if (!t.roads.count) continue;
        const n = this._take(t.roads, t.rEnds, ringOf(t));
        if (!n) continue;
        offset(t);
        gl.bindVertexArray(t.roads.vao);
        gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_INT, 0);
        drawn++;
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    return drawn;
  }

  // Data report: how building heights are labelled in everything loaded here,
  // plus a close look at the tiles around a point (mercator metres).
  report(cmx, cmy) {
    const hist = [0, 0, 0, 0, 0, 0, 0];
    const types = [0, 0, 0, 0, 0, 0, 0, 0], sizes = [0, 0, 0, 0];
    let seen = 0, kept = 0, tiles = 0, real = 0, rail = 0, aeroAreas = 0, aeroLines = 0, runways = 0, runwayNumbers = 0;
    for (const t of this.tiles.values()) {
      if (!t.stats || !t.stats.hist) continue;
      tiles++; seen += t.stats.seen; kept += t.stats.kept;
      for (let i = 0; i < 7; i++) hist[i] += t.stats.hist[i];
      real += t.stats.real || 0;
      if (t.stats.types) for (let i = 0; i < 8; i++) types[i] += t.stats.types[i];
      if (t.stats.sizes) for (let i = 0; i < 4; i++) sizes[i] += t.stats.sizes[i];
      rail += t.stats.rail || 0; aeroAreas += t.stats.aeroAreas || 0; aeroLines += t.stats.aeroLines || 0;
      runways += t.stats.runways || 0; runwayNumbers += t.stats.runwayNumbers || 0;
    }
    const out = { tiles, buildingsSeen: seen, buildingsKept: kept,
             withMapColour: real, byType: Object.fromEntries(TYPE_NAMES.map((n, i) => [n, types[i]])),
             bySize: Object.fromEntries(SIZE_NAMES.map((n, i) => [n, sizes[i]])),
             railLines: rail, airportAreas: aeroAreas, airportLines: aeroLines, runwayPieces: runways, runwayNumbers,
             heightBands: { none: hist[0], upTo5: hist[1], upTo10: hist[2], upTo25: hist[3], upTo50: hist[4], upTo100: hist[5], over100: hist[6] } };
    if (cmx !== undefined) {
      const reach = 6000 / 0.73;                       // about 6 km on the ground, in mercator metres
      const near = [], marks = [];
      for (const t of this.tiles.values()) {
        const dx = t.centre.x - cmx, dy = t.centre.y - cmy;
        const d = Math.hypot(dx, dy);
        if (!t.stats || d > reach) continue;
        const km = +(d * 0.73 / 1000).toFixed(1);
        if (t.marker) {
          marks.push({ km, x: t.rawX, y: t.y, urban: t.urban, cover: +(t.stats.cover || 0).toFixed(2), built: +(t.stats.built || 0).toFixed(2), seen: t.stats.seen });
        } else if (t.stats.tall) {
          near.push({ km, tile: t.key, buildings: t.stats.kept,
            tallest: t.stats.tall.map((b) => ({ h: b[0], lat: +mercYToLat(t.centre.y - b[2]).toFixed(5), lon: +mercXToLon(t.centre.x + b[1]).toFixed(5), m2: b[3] })) });
        }
      }
      near.sort((a, b) => a.km - b.km); marks.sort((a, b) => a.km - b.km);
      // Runway data, raw from the map, for tiles within about 4 km.
      const rw = [];
      for (const t of this.tiles.values()) {
        if (!t.stats || !t.stats.runwayDebug) continue;
        const km = Math.hypot(t.centre.x - cmx, t.centre.y - cmy) * 0.73 / 1000;
        if (km <= 4) rw.push({ tile: t.z + '/' + t.key, km: +km.toFixed(1), ...t.stats.runwayDebug });
      }
      rw.sort((a, b) => a.km - b.km);
      if (rw.length) out.runways = rw;
      out.around = { tiles: near.slice(0, 12), markers: marks.slice(0, 8) };
    }
    return out;
  }
}
