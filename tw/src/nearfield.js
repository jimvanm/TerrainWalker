// Near field: real geometry (roads now, buildings next) for the few map tiles
// around a low, slow camera. Everything farther away stays on the draped
// textures. Geometry is camera-independent and built once per tile in a worker;
// a moving camera only changes uniforms, exactly like the terrain.

import * as G from './gl.js';
import { probe } from './perf.js';
import { mercToTile, tileCentreMerc, tileToMerc } from './geo.js';
import { TILE_URL, NF_Z, NF_WORKERS } from './config.js';

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
  if (n.y < 0.0) n = -n;
  float lit = 0.55 + 0.45 * max(dot(n, uSunDir), 0.0);
  vec3 c = floor(vCol * lit * 31.0 + 0.5) / 31.0;   // same 5-bit look as terrain
  frag = vec4(c, 1.0);
}`;

const wrapX = (x) => { const n = Math.pow(2, NF_Z); return ((x % n) + n) % n; };

export class NearField {
  constructor(gl, getTemplate) {
    this.gl = gl;
    this.getTemplate = getTemplate;
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
    for (let i = 0; i < NF_WORKERS; i++) {
      try {
        const w = new Worker(new URL('./nearworker.js', import.meta.url), { type: 'module' });
        w.onmessage = (ev) => this._done(w, ev.data);
        w.onerror = () => { this.disabled = true; };
        this.workers.push(w);
        this.free.push(w);
      } catch (e) { this.disabled = true; }
    }
  }

  // Called every frame.
  //   active  - draw at all (the caller decides from height)
  //   fetchOk - allowed to request new tiles (the caller decides from speed)
  //   radius  - tiles each side of the camera tile: 1 = 3x3, 2 = 5x5
  update(mercX, mercY, active, fetchOk, radius, leadX, leadY, useLead) {
    this.active = active;
    this.R = radius;
    this.blocked = !fetchOk;
    if (!active || this.disabled) { this.ready = false; this.want = []; this.rect = null; return; }

    const t = mercToTile(mercX, mercY, NF_Z);
    const cx = Math.floor(t.x), cy = Math.floor(t.y);
    this.cx = cx; this.cy = cy;
    const n = Math.pow(2, NF_Z);
    const R = radius;
    const want = [];
    for (let dy = -R; dy <= R; dy++) {
      for (let dx = -R; dx <= R; dx++) {
        const y = cy + dy;
        if (y < 0 || y >= n) continue;
        want.push({ key: (cx + dx) + '/' + y, rawX: cx + dx, y });
      }
    }
    // Look-ahead: a 3x3 around where we will be shortly, so tiles are already
    // loaded when we arrive. Queued behind the tiles around the present position.
    if (useLead) {
      const lt = mercToTile(leadX, leadY, NF_Z);
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

    this.rect = this._coverRect(cx, cy, R);
    this.ready = !!this.rect;

    // Keep a margin beyond the wanted area so turning back is free.
    if (this.tiles.size > 100) {
      for (const [k, tile] of this.tiles) {
        if (this.tiles.size <= 100) break;
        if (wk.has(k)) continue;
        if (Math.abs(tile.rawX - cx) <= R + 2 && Math.abs(tile.y - cy) <= R + 2) continue;
        this._free(tile);
        this.tiles.delete(k);
      }
    }
    if (tpl) this._pump(tpl);
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
    const nw = tileToMerc(x0, y0, NF_Z), se = tileToMerc(x1 + 1, y1 + 1, NF_Z);
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
        const d = (s.rawX - this.cx) ** 2 + (s.y - this.cy) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      this.queue.delete(best.key);
      const w = this.free.pop();
      const id = this.nextId++;
      this.inflight.set(id, best);
      const x = wrapX(best.rawX);
      const sub = (u, z, xx, yy) => u.replace('{z}', z).replace('{x}', xx).replace('{y}', yy);
      w.postMessage({
        id, x, y: best.y,
        vurl: sub(tpl, NF_Z, x, best.y),
        eurl: sub(TILE_URL, 12, x >> (NF_Z - 12), best.y >> (NF_Z - 12)),
      });
    }
  }

  _done(w, msg) {
    const spec = this.inflight.get(msg.id);
    this.inflight.delete(msg.id);
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

  _uploadInner(spec, msg) {
    const gl = this.gl;
    const tile = {
      key: spec.key, rawX: spec.rawX, y: spec.y,
      centre: tileCentreMerc(spec.rawX, spec.y, NF_Z),
      count: msg.indices.length, verts: msg.verts,
      vao: null, vbo: null, ibo: null,
    };
    if (tile.count > 0) {
      tile.vao = gl.createVertexArray();
      tile.vbo = gl.createBuffer();
      tile.ibo = gl.createBuffer();
      gl.bindVertexArray(tile.vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, tile.vbo);
      gl.bufferData(gl.ARRAY_BUFFER, msg.vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(this.aCol);
      gl.vertexAttribPointer(this.aCol, 4, gl.UNSIGNED_BYTE, true, 16, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, tile.ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, msg.indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
    }
    this.tiles.set(spec.key, tile);
  }

  _free(t) {
    const gl = this.gl;
    if (t.vao) { gl.deleteVertexArray(t.vao); gl.deleteBuffer(t.vbo); gl.deleteBuffer(t.ibo); }
  }

  // `restore` is the program to hand back to the caller afterwards.
  draw(restore, proj, view, k, camAlt, camMercX, camMercY, curv, roadsOn) {
    if (!this.active || !roadsOn) return 0;
    const gl = this.gl, u = this.u;
    let drawn = 0;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform1f(u.uScale, k);
    gl.uniform1f(u.uCamAlt, camAlt);
    gl.uniform1f(u.uCurv, curv);
    gl.uniform3f(u.uSunDir, 0.40, 0.82, 0.41);
    // Pull the ribbons toward the camera in proportion to surface slope, which
    // a fixed height offset cannot do at both 5 m and 500 m.
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(-2, -2);
    for (const w of this.want) {
      const t = this.tiles.get(w.key);
      if (!t || !t.count) continue;
      gl.uniform2f(u.uTileOffset, (t.centre.x - camMercX) * k, (camMercY - t.centre.y) * k);
      gl.bindVertexArray(t.vao);
      gl.drawElements(gl.TRIANGLES, t.count, gl.UNSIGNED_INT, 0);
      drawn++;
    }
    gl.disable(gl.POLYGON_OFFSET_FILL);
    gl.useProgram(restore);
    return drawn;
  }

  get status() {
    if (this.disabled) return 'off (no worker)';
    if (!this.active) return 'off';
    let n = 0, tris = 0;
    for (const w of this.want) {
      const t = this.tiles.get(w.key);
      if (t) { n++; tris += t.count / 3; }
    }
    return n + '/' + this.want.length + ' r' + this.R + ' ' + (tris / 1000).toFixed(0) + 'k tris' +
      (this.blocked ? ' (too fast to fetch)' : '');
  }
}
