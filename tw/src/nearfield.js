// Near field: real geometry (roads now, buildings next) for the few map tiles
// around a low, slow camera. Everything farther away stays on the draped
// textures. Geometry is camera-independent and built once per tile in a worker;
// a moving camera only changes uniforms, exactly like the terrain.

import * as G from './gl.js';
import { probe } from './perf.js';
import { mercToTile, tileCentreMerc, tileToMerc, mercYToLat, mercXToLon } from './geo.js';
import { TILE_URL, NF_Z, NF_WORKERS, SKY_MIN_HEIGHT, SKY_RADIUS, SKY_URBAN, SKY_URBAN_BUILT } from './config.js';

const VS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec4 aCol;
uniform mat4  uProj;
uniform mat4  uView;
uniform vec2  uTileOffset;
uniform float uScale;
uniform float uCamAlt;
uniform float uCurv;
out vec3 vPos;
out vec3 vCol;
void main() {
  float x = aPos.x * uScale + uTileOffset.x;
  float z = aPos.z * uScale + uTileOffset.y;
  float y = aPos.y - uCamAlt;
  vPos = vec3(x, y, z);
  vCol = aCol.rgb;
  float drop = (x * x + z * z) * uCurv;
  gl_Position = uProj * uView * vec4(x, y - drop, z, 1.0);
}`;

const FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vCol;
uniform vec3 uSunDir;
out vec4 frag;
void main() {
  vec3 n = cross(dFdx(vPos), dFdy(vPos));
  float len = length(n);
  n = len > 1e-9 ? n / len : vec3(0.0, 1.0, 0.0);
  if (dot(n, vPos) > 0.0) n = -n;     // always the side facing the camera (walls have n.y ~ 0)
  float lit = 0.55 + 0.45 * max(dot(n, uSunDir), 0.0);
  vec3 c = floor(vCol * lit * 31.0 + 0.5) / 31.0;   // same 5-bit look as terrain
  frag = vec4(c, 1.0);
}`;


export class NearField {
  // opts.zoom     map tile zoom (14 for the near field)
  // opts.skyline  buildings only, and only tall ones: the far layer (zoom 13)
  // opts.workers  how many build workers to start
  constructor(gl, getTemplate, opts = {}) {
    this.gl = gl;
    this.getTemplate = getTemplate;
    this.Z = opts.zoom || NF_Z;
    this.skyline = !!opts.skyline;
    this.block = null;           // wanted area in zoom-14 tiles { x0, x1, y0, y1 }, near field only
    this.partner = null;         // the other layer (near <-> far), set by the caller
    this.maxRing = this.skyline ? SKY_RADIUS + 3 : 14;   // never draw tiles farther than this, in tiles
    this.prog = G.program(gl, VS, FS);
    this.u = {};
    for (const n of ['uProj', 'uView', 'uTileOffset', 'uScale', 'uCamAlt', 'uCurv', 'uSunDir']) {
      this.u[n] = gl.getUniformLocation(this.prog, n);
    }
    this.aPos = gl.getAttribLocation(this.prog, 'aPos');
    this.aCol = gl.getAttribLocation(this.prog, 'aCol');

    this.tiles = new Map();      // key -> { vao, vbo, ibo, count, centre, verts }
    this.queue = new Map();      // key -> spec, waiting
    this.pending = new Set();    // queued or in flight
    this.inflight = new Map();   // id -> spec
    this.failed = new Map();     // key -> retry-after timestamp
    this.want = [];
    this.ready = false;          // a covered block exists
    this.rect = null;
    this.R = 1;
    this.blocked = false;
    this.active = false;
    this.cx = 0; this.cy = 0;
    this.nextId = 1;
    this.stats = { done: 0, failed: 0 };
    this.workers = [];
    this.free = [];
    this.disabled = false;
    this.wantWorkers = opts.workers || NF_WORKERS;
    this.workerFails = 0;
    for (let i = 0; i < this.wantWorkers; i++) this._spawn();
  }

  // A helper can fail to start (a dropped download of one of its files, say).
  // That used to switch the whole layer off for good. Now the helper is
  // replaced, and its job is put back in the queue. Only repeated failures
  // switch the layer off.
  _spawn() {
    try {
      const w = new Worker(new URL('./nearworker.js', import.meta.url), { type: 'module' });
      w.job = null;
      w.onmessage = (ev) => this._done(w, ev.data);
      w.onerror = (ev) => {
        this.lastError = 'helper failed: ' + ((ev && ev.message) || 'could not load');
        this.workers = this.workers.filter((x) => x !== w);
        this.free = this.free.filter((x) => x !== w);
        try { w.terminate(); } catch (e) { /* ignore */ }
        if (w.job) {
          this.inflight.delete(w.job.id);
          this.queue.set(w.job.spec.key, w.job.spec);
          w.job = null;
        }
        if (++this.workerFails > 12) { if (!this.workers.length) this.disabled = true; return; }
        setTimeout(() => this._spawn(), 1000);
      };
      this.workers.push(w);
      this.free.push(w);
    } catch (e) {
      if (++this.workerFails > 12) { if (!this.workers.length) this.disabled = true; }
      else setTimeout(() => this._spawn(), 1000);
    }
  }

  _wrapX(x) { const n = Math.pow(2, this.Z); return ((x % n) + n) % n; }

  // Everything wanted has arrived (or failed for good), and nothing is waiting.
  get complete() {
    if (!this.active || this.disabled || !this.want.length) return false;
    if (this.blocked || this.queue.size || this.inflight.size) return false;
    for (const w of this.want) if (!this.tiles.has(w.key) && !this.failed.has(w.key)) return false;
    return true;
  }

  // Data report: how building heights are labelled in everything loaded here,
  // plus a close look at the tiles around a point (cx, cy in mercator metres).
  report(cmx, cmy) {
    const hist = [0, 0, 0, 0, 0, 0, 0];
    let seen = 0, kept = 0, tiles = 0;
    for (const t of this.tiles.values()) {
      if (!t.stats || !t.stats.hist) continue;
      tiles++; seen += t.stats.seen; kept += t.stats.kept;
      for (let i = 0; i < 7; i++) hist[i] += t.stats.hist[i];
    }
    const out = { tiles, buildingsSeen: seen, buildingsKept: kept,
             heightBands: { none: hist[0], upTo5: hist[1], upTo10: hist[2], upTo25: hist[3], upTo50: hist[4], upTo100: hist[5], over100: hist[6] } };
    if (cmx !== undefined) {
      const reach = 6000 / 0.73;                       // about 6 km on the ground, in mercator metres
      const near = [], marks = [];
      for (const t of this.tiles.values()) {
        const dx = t.centre.x - cmx, dy = t.centre.y - cmy;
        const d = Math.hypot(dx, dy);
        if (!t.stats || d > reach) continue;
        const km = +(d * 0.73 / 1000).toFixed(1);
        if (t.z === 13 && this.skyline) {
          marks.push({ km, x: t.rawX, y: t.y, urban: t.urban, cover: +(t.stats.cover || 0).toFixed(2), built: +(t.stats.built || 0).toFixed(2), seen: t.stats.seen });
        } else if (t.stats.tall) {
          near.push({ km, tile: t.key, buildings: t.stats.kept,
            tallest: t.stats.tall.map((b) => ({ h: b[0], lat: +mercYToLat(t.centre.y - b[2]).toFixed(5), lon: +mercXToLon(t.centre.x + b[1]).toFixed(5), m2: b[3] })) });
        }
      }
      near.sort((a, b) => a.km - b.km); marks.sort((a, b) => a.km - b.km);
      out.around = { tiles: near.slice(0, 12), markers: marks.slice(0, 8) };
    }
    return out;
  }

  get busy() { return this.queue.size + this.inflight.size > 0; }

  // Called every frame.
  //   active  - draw at all (the caller decides from height)
  //   fetchOk - allowed to request new tiles (the caller decides from speed)
  //   radius  - tiles each side of the camera tile: 1 = 3x3, 2 = 5x5
  update(mercX, mercY, active, fetchOk, radius, leadX, leadY, useLead) {
    this.active = active;
    this.R = radius;
    this.blocked = !fetchOk;
    if (!active || this.disabled) { this.ready = false; this.want = []; this.rect = null; this.block = null; return; }

    const t = mercToTile(mercX, mercY, this.Z);
    const cx = Math.floor(t.x), cy = Math.floor(t.y);
    this.cx = cx; this.cy = cy;
    const n = Math.pow(2, this.Z);
    const R = radius;
    const want = [];
    // The block is stretched outward to whole zoom-13 tiles (pairs of these
    // tiles), so the far skyline layer can take over exactly where it stops,
    // with no gap and no overlap.
    const x0 = (cx - R) & ~1, x1 = (cx + R) | 1;
    const y0 = Math.max(0, (cy - R) & ~1), y1 = Math.min(n - 1, (cy + R) | 1);
    this.block = { x0, x1, y0, y1 };
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) want.push({ key: x + '/' + y, rawX: x, y });
    }
    // Look-ahead: a 3x3 around where we will be shortly, so tiles are already
    // loaded when we arrive. Queued behind the tiles around the present position.
    if (useLead) {
      const lt = mercToTile(leadX, leadY, this.Z);
      const lx = Math.floor(lt.x), ly = Math.floor(lt.y);
      const have = new Set(want.map((w) => w.key));
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const y = ly + dy, key = (lx + dx) + '/' + y;
          if (y < 0 || y >= n || have.has(key)) continue;
          have.add(key);
          want.push({ key, rawX: lx + dx, y });
        }
      }
    }
    this.want = want;
    const tpl = this.getTemplate();
    const wk = new Set(want.map((w) => w.key));
    for (const k of [...this.queue.keys()]) {
      if (!wk.has(k)) { this.queue.delete(k); this.pending.delete(k); }
    }

    if (fetchOk && tpl) {
      const now = performance.now();
      for (const w of want) {
        if (this.tiles.has(w.key) || this.pending.has(w.key)) continue;
        const retry = this.failed.get(w.key);
        if (retry !== undefined) {
          if (now < retry) continue;
          this.failed.delete(w.key);
        }
        this.queue.set(w.key, { ...w });
        this.pending.add(w.key);
      }
    }

    this.rect = this._coverRect(cx, cy, Math.min(R, 1));   // full detail only: that is where painted roads can go
    this.ready = !!this.rect;

    // Keep a margin beyond the wanted area so turning back is free.
    if (this.tiles.size > 360) {
      for (const [k, tile] of this.tiles) {
        if (this.tiles.size <= 360) break;
        if (wk.has(k)) continue;
        if (Math.abs(tile.rawX - cx) <= R + 2 && Math.abs(tile.y - cy) <= R + 2) continue;
        this._free(tile);
        this.tiles.delete(k);
      }
    }
    if (tpl) this._pump(tpl);
  }

  // Far skyline layer, in two stages.
  //   1. Cheap marker tiles at zoom 13: they carry no building heights, so all
  //      they can say is how built-up the tile is.
  //   2. For the built-up ones only, the four zoom-14 tiles beneath, built with
  //      just the tall buildings (the heights are there at zoom 14).
  // Everything inside the near field's block is skipped; that is the near
  // field's ground. Nothing is asked for until the near field has finished.
  updateFar(mercX, mercY, active, fetchOk, radius, block) {
    this.active = active && !!block;
    this.R = radius;
    this.blocked = !fetchOk;
    if (!this.active || this.disabled) { this.want = []; return; }
    const t13 = mercToTile(mercX, mercY, 13), t14 = mercToTile(mercX, mercY, 14);
    const cx = Math.floor(t13.x), cy = Math.floor(t13.y);
    this.cx = cx; this.cy = cy;
    this.cx14 = Math.floor(t14.x); this.cy14 = Math.floor(t14.y);
    const n = Math.pow(2, 13);
    const inBlock = (x, y, z) => {          // is this tile wholly inside the near block?
      const s = 1 << (14 - z);
      return x * s >= block.x0 && (x + 1) * s - 1 <= block.x1 && y * s >= block.y0 && (y + 1) * s - 1 <= block.y1;
    };
    const want = [];                         // markers
    const kids = [];                         // zoom-14 children of built-up markers
    for (let y = Math.max(0, cy - radius); y <= Math.min(n - 1, cy + radius); y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (inBlock(x, y, 13)) continue;
        const key = '13/' + x + '/' + y;
        want.push({ key, rawX: x, y, z: 13, marker: true });
        const m = this.tiles.get(key);
        if (m && m.urban) {
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            kids.push({ key: '14/' + (2 * x + dx) + '/' + (2 * y + dy), rawX: 2 * x + dx, y: 2 * y + dy, z: 14 });
          }
        }
      }
    }
    this.want = want.concat(kids);
    this.nMarkers = want.length;
    this.nKids = kids.length;
    const tpl = this.getTemplate();
    const wk = new Set(this.want.map((w) => w.key));
    for (const k of [...this.queue.keys()]) {
      if (!wk.has(k)) { this.queue.delete(k); this.pending.delete(k); }
    }
    if (fetchOk && tpl) {
      const now = performance.now();
      for (const w of this.want) {
        if (this.tiles.has(w.key) || this.pending.has(w.key)) continue;
        const retry = this.failed.get(w.key);
        if (retry !== undefined) { if (now < retry) continue; this.failed.delete(w.key); }
        this.queue.set(w.key, { ...w });
        this.pending.add(w.key);
      }
    }
    if (this.tiles.size > 600) {
      for (const [k, tile] of this.tiles) {
        if (this.tiles.size <= 600) break;
        if (wk.has(k)) continue;
        this._free(tile);
        this.tiles.delete(k);
      }
    }
    if (tpl) this._pump(tpl);
  }

  // Far layer: does it fully cover this zoom-13 square, so the near field can
  // stop drawing its own copy without leaving a hole?
  owns(x13, y13) {
    const m = this.tiles.get('13/' + x13 + '/' + y13);
    if (!m) return false;
    if (!m.urban) return true;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const key = '14/' + (2 * x13 + dx) + '/' + (2 * y13 + dy);
      if (!this.tiles.has(key) && !this.failed.has(key)) return false;
    }
    return true;
  }

  // The largest block of loaded tiles around the camera tile, grown outward one
  // whole row or column at a time. Painted roads are hidden only inside this
  // block, so a road is never removed where the real one has not arrived. A
  // failed tile is simply not loaded, so the painted road stays there.
  _coverRect(cx, cy, R) {
    const has = (x, y) => this.tiles.has(x + '/' + y);
    if (!has(cx, cy)) return null;
    let x0 = cx, x1 = cx, y0 = cy, y1 = cy;
    const col = (x) => { for (let y = y0; y <= y1; y++) if (!has(x, y)) return false; return true; };
    const row = (y) => { for (let x = x0; x <= x1; x++) if (!has(x, y)) return false; return true; };
    for (let grew = true; grew;) {
      grew = false;
      if (x0 > cx - R && col(x0 - 1)) { x0--; grew = true; }
      if (x1 < cx + R && col(x1 + 1)) { x1++; grew = true; }
      if (y0 > cy - R && row(y0 - 1)) { y0--; grew = true; }
      if (y1 < cy + R && row(y1 + 1)) { y1++; grew = true; }
    }
    const nw = tileToMerc(x0, y0, this.Z), se = tileToMerc(x1 + 1, y1 + 1, this.Z);
    return { w: nw.x, e: se.x, n: nw.y, s: se.y };
  }

  // The covered block as camera-relative true metres (minX, minZ, maxX, maxZ),
  // for the terrain shader. An empty rectangle when there is nothing to hide.
  rectUniform(camMercX, camMercY, k, roadsOn) {
    const r = this.rect;
    if (!r || !roadsOn || !this.active) return [1, 1, -1, -1];
    return [(r.w - camMercX) * k, (camMercY - r.n) * k, (r.e - camMercX) * k, (camMercY - r.s) * k];
  }

  _pump(tpl) {
    while (this.free.length && this.queue.size) {
      let best = null, bd = Infinity;
      for (const s of this.queue.values()) {
        const d = this.skyline
          ? ((s.z === 13 ? 2 * s.rawX + 1 : s.rawX) - this.cx14) ** 2 + ((s.z === 13 ? 2 * s.y + 1 : s.y) - this.cy14) ** 2
          : (s.rawX - this.cx) ** 2 + (s.y - this.cy) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      this.queue.delete(best.key);
      const w = this.free.pop();
      const id = this.nextId++;
      this.inflight.set(id, best);
      w.job = { id, spec: best };
      const Z = best.z || this.Z;
      const nT = Math.pow(2, Z), x = ((best.rawX % nT) + nT) % nT;
      const sub = (u, z, xx, yy) => u.replace('{z}', z).replace('{x}', xx).replace('{y}', yy);
      w.postMessage({
        id, x, y: best.y, z: Z, skyline: this.skyline, marker: !!best.marker, skyMin: SKY_MIN_HEIGHT,
        vurl: sub(tpl, Z, x, best.y),
        eurl: sub(TILE_URL, 12, x >> (Z - 12), best.y >> (Z - 12)),
      });
    }
  }

  _done(w, msg) {
    const spec = this.inflight.get(msg.id);
    this.inflight.delete(msg.id);
    w.job = null;
    this.free.push(w);
    if (!spec) return;
    this.pending.delete(spec.key);
    if (msg.ok) {
      this.stats.done++;
      this._upload(spec, msg);
    } else {
      this.stats.failed++;
      this.lastError = msg.error;
      this.failed.set(spec.key, performance.now() + 10000);
    }
  }

  _upload(spec, msg) {
    const t0 = performance.now();
    this._uploadInner(spec, msg);
    probe.uploadMs += performance.now() - t0;
    probe.nearTiles++;
  }

  _buffers(vertices, indices) {
    const gl = this.gl;
    const b = { count: indices.length, vao: null, vbo: null, ibo: null };
    if (!b.count) return b;
    b.vao = gl.createVertexArray();
    b.vbo = gl.createBuffer();
    b.ibo = gl.createBuffer();
    gl.bindVertexArray(b.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.aCol);
    gl.vertexAttribPointer(this.aCol, 4, gl.UNSIGNED_BYTE, true, 16, 12);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return b;
  }

  _uploadInner(spec, msg) {
    const roads = this._buffers(msg.vertices, msg.indices);
    const bld = msg.bIndices ? this._buffers(msg.bVertices, msg.bIndices) : { count: 0, vao: null };
    this.tiles.set(spec.key, {
      key: spec.key, rawX: spec.rawX, y: spec.y,
      z: spec.z || this.Z,
      urban: !!spec.marker && !!msg.stats &&
        (msg.stats.cover >= SKY_URBAN || msg.stats.built >= SKY_URBAN_BUILT),
      centre: tileCentreMerc(spec.rawX, spec.y, spec.z || this.Z),
      roads, bld, count: roads.count + bld.count,
      stats: msg.stats || null,
      rEnds: msg.rEnds || null, bEnds: (msg.stats && msg.stats.ends) || null,
    });
  }

  _free(t) {
    const gl = this.gl;
    for (const b of [t.roads, t.bld]) {
      if (b && b.vao) { gl.deleteVertexArray(b.vao); gl.deleteBuffer(b.vbo); gl.deleteBuffer(b.ibo); }
    }
  }

  // `restore` is the program to hand back to the caller afterwards.
  // How much of a tile's index buffer to draw. The buffers are written most
  // important first (motorways, then smaller roads; skyline, then large
  // buildings, then the rest), so a prefix is a simpler version of the tile.
  //   ring 0-1: everything   ring 2: middle   ring 3+: only the top
  _take(b, ends, ring) {
    if (!ends) return b.count;
    const n = ring <= 1 ? ends[2] : ring === 2 ? ends[1] : ends[0];
    return Math.min(b.count, n);
  }
  _ring(t) { return Math.max(Math.abs(t.rawX - this.cx), Math.abs(t.y - this.cy)); }

  draw(restore, proj, view, k, camAlt, camMercX, camMercY, curv, roadsOn, bldOn = true) {
    if (!this.active || (!roadsOn && !bldOn)) return 0;
    const gl = this.gl, u = this.u;
    let drawn = 0;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform1f(u.uScale, k);
    gl.uniform1f(u.uCamAlt, camAlt);
    gl.uniform1f(u.uCurv, curv);
    gl.uniform3f(u.uSunDir, 0.40, 0.82, 0.41);
    // Draw everything that is already in memory, not just what is wanted right
    // now. Drawing only the wanted set made far buildings appear while moving
    // (look-ahead tiles were wanted) and vanish the moment you slowed down.
    // Two rules stop the near and far layers drawing the same ground twice.
    const tiles = [];
    const partner = this.partner;
    for (const t of this.tiles.values()) {
      if (!t.count) continue;
      if (this.skyline) {
        const s = 1 << (14 - t.z);
        if (Math.max(Math.abs(t.rawX * s + s / 2 - this.cx14), Math.abs(t.y * s + s / 2 - this.cy14)) > 2 * this.maxRing) continue;
        const b = partner && partner.block;
        if (b && t.rawX * s >= b.x0 && (t.rawX + 1) * s - 1 <= b.x1 && t.y * s >= b.y0 && (t.y + 1) * s - 1 <= b.y1) continue;
      } else {
        if (this._ring(t) > this.maxRing) continue;
        const b = this.block;
        const outside = !b || t.rawX < b.x0 || t.rawX > b.x1 || t.y < b.y0 || t.y > b.y1;
        // Outside the block the far layer draws this ground, once it has it.
        if (outside && partner && partner.owns(t.rawX >> 1, t.y >> 1)) continue;
      }
      tiles.push(t);
    }
    // Buildings stand clear of the ground, so they need no help with depth.
    if (bldOn) {
      for (const t of tiles) {
        if (!t.bld.count) continue;
        const n = this._take(t.bld, t.bEnds, this._ring(t));
        if (!n) continue;
        gl.uniform2f(u.uTileOffset, (t.centre.x - camMercX) * k, (camMercY - t.centre.y) * k);
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
        const n = this._take(t.roads, t.rEnds, this._ring(t));
        if (!n) continue;
        gl.uniform2f(u.uTileOffset, (t.centre.x - camMercX) * k, (camMercY - t.centre.y) * k);
        gl.bindVertexArray(t.roads.vao);
        gl.drawElements(gl.TRIANGLES, n, gl.UNSIGNED_INT, 0);
        drawn++;
      }
      gl.disable(gl.POLYGON_OFFSET_FILL);
    }
    gl.useProgram(restore);
    return drawn;
  }

  get status() {
    if (this.disabled) return 'off (no worker)';
    if (!this.active) return 'off';
    if (this.skyline) {
      let marks = 0, urban = 0, kids = 0, tris = 0, bld = 0;
      for (const t of this.tiles.values()) {
        if (t.z === 13) { marks++; if (t.urban) urban++; } else { kids++; tris += t.count / 3; if (t.stats) bld += t.stats.kept; }
      }
      return marks + '/' + (this.nMarkers || 0) + ' urban ' + urban + ' z14 ' + kids + '/' + (this.nKids || 0) +
        ' ' + (tris / 1000).toFixed(0) + 'k tris ' + bld + ' bldg' + (this.blocked ? ' (waiting)' : '');
    }
    let n = 0, tris = 0, kept = 0, dropped = 0;
    for (const w of this.want) {
      const t = this.tiles.get(w.key);
      if (t) {
        n++; tris += (this._take(t.roads, t.rEnds, this._ring(t)) + this._take(t.bld, t.bEnds, this._ring(t))) / 3;
        if (t.stats) { kept += t.stats.kept; dropped += t.stats.dropped; }
      }
    }
    return n + '/' + this.want.length + ' r' + this.R + ' ' + (tris / 1000).toFixed(0) + 'k tris' +
      (kept ? ' ' + kept + ' bldg' + (dropped ? ' (' + dropped + ' skipped)' : '') : '') +
      (this.blocked ? ' (too fast to fetch)' : '');
  }
}
