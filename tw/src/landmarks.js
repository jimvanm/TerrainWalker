// Landmarks: famous buildings drawn as small solid models at true size.
//
// Two separate things:
//   placements  where a shape stands and which way it faces. One per landmark
//               in landmarks/index.json; add() makes more (the same shape can
//               stand in several places).
//   shapes      the models, loaded only when a placement using one could be
//               above your horizon, and freed again when you are well past it.
//
// Drawn like the near field (camera-relative, same curve drop, same shading).
// The Earth's curve hides a landmark beyond the horizon, which is also why that
// is the right distance to load it.
import { lonToMercX, latToMercY, mercXToLon, mercYToLat, mercScale, wrapMercDx, R_MEAN } from './geo.js';
import { loadList, loadModel, footprintOf } from './landmark_list.js';
import { polygonArea, edgesOf, dominantBearing, suggestYaw, ovalAxis, wrapTo } from './orient.js';
import { paintSlab } from './citykit.js';

export const SINK = 6;   // metres below the ground sample, so a sloping site never shows a gap
const UNLOAD = 1.5;      // free a shape once every placement using it is this many times out of range
const MIN_RANGE = 20000; // always load within 20 km, however short the landmark
const REPAINT_MS = 600;  // a moved piece's ground is repainted at most this often while map tiles arrive
const ALL_ON = { water: true, roads: true, built: true, cover: true, land: true };

// Distance at which the top of something `height` tall can just show above the
// horizon for an eye `agl` up: the two horizon distances added.
export function sightRange(height, agl) {
  return Math.max(MIN_RANGE, Math.sqrt(2 * R_MEAN * height) + Math.sqrt(2 * R_MEAN * Math.max(agl, 1)));
}

// Interleaved 16-byte vertices (float32 xyz + RGBA8), same layout as the near field.
// x and z come out in TRUE metres, y is height above the base.
export function buildVertices(model, yawDeg = 0) {
  const n = model.pos.length / 3;
  const buf = new ArrayBuffer(n * 16);
  const f = new Float32Array(buf), b = new Uint8Array(buf);
  const c = Math.cos(yawDeg * Math.PI / 180), s = Math.sin(yawDeg * Math.PI / 180);
  for (let i = 0; i < n; i++) {
    const x = model.pos[i * 3], y = model.pos[i * 3 + 1], z = model.pos[i * 3 + 2];
    // x is east, z is south. A positive yaw turns the model clockwise seen from above.
    f[i * 4] = x * c - z * s;
    f[i * 4 + 1] = y;
    f[i * 4 + 2] = x * s + z * c;
    b[i * 16 + 12] = model.col[i * 3];
    b[i * 16 + 13] = model.col[i * 3 + 1];
    b[i * 16 + 14] = model.col[i * 3 + 2];
    b[i * 16 + 15] = 255;
  }
  return { vertices: buf, indices: new Uint32Array(model.idx) };
}

// The same turn as buildVertices, for ready-made 16-byte vertices (a moved
// piece's roads and buildings, citykit.js). Colours are copied as they are.
export function turnVertices(vertices, yawDeg = 0) {
  const out = vertices.slice(0);
  if (!yawDeg) return out;
  const f = new Float32Array(out);
  const c = Math.cos(yawDeg * Math.PI / 180), s = Math.sin(yawDeg * Math.PI / 180);
  for (let i = 0; i < f.length; i += 4) {
    const x = f[i], z = f[i + 2];
    f[i] = x * c - z * s;
    f[i + 2] = x * s + z * c;
  }
  return out;
}

export class Landmarks {
  // mesh: the shared MeshProgram (meshprogram.js). Landmark vertices are
  // already in true metres, so they are drawn with uScale = 1.
  // list: the landmark list (for tests); normally read from landmarks/index.json.
  constructor(gl, mesh, list = null) {
    this.gl = gl;
    this.mesh = mesh;
    this.items = [];             // placements
    this.models = new Map();     // shape id -> { state: 'loading' | 'ready' | 'failed', vao, count, footprint, ... }
    this.listed = false;
    this.on = { ...ALL_ON };     // which layers are switched on (setLayers)
    this.kinds = [];             // the listed landmarks, as shapes to drop elsewhere (dropper.js)
    this.ready = (list ? Promise.resolve(list) : loadList()).then((all) => {
      for (const L of all) this.add({ ...L, model: L.id });
      this.kinds = all;
      this.listed = true;
    });
  }

  // Stand a shape somewhere. p: { model, name, lat, lon, height, yawDeg, fold, oval, maskR }
  add(p) {
    const it = {
      yawDeg: 0, fold: 0, oval: false, ...p,
      id: p.id || p.model + '@' + this.items.length,
      mx: lonToMercX(p.lon), my: latToMercY(p.lat), k: mercScale(p.lat),
      base: null,     // ground height, filled in once that terrain has loaded
      baseZ: -1,      // the terrain zoom the ground height came from
      km: Infinity,   // distance from the camera, updated every frame
      inRange: false,
    };
    this.items.push(it);
    return it;
  }

  // Move a placement (mercator metres). Its ground is looked up again.
  moveTo(it, mx, my) {
    if (it.mx === mx && it.my === my) return;
    it.mx = mx; it.my = my;
    it.k = mercScale(mercYToLat(my));
    it.lat = mercYToLat(my); it.lon = mercXToLon(mx);
    it.base = null; it.baseZ = -1;
  }

  // Turn a placement. The turn is baked into its buffers, so they are remade.
  turnTo(it, yawDeg) {
    it.yawDeg = yawDeg;
    this._free(it);
  }

  remove(it) {
    for (const c of it.carried || []) this.remove(c);     // what a moved piece carried goes with it
    this._free(it);
    const i = this.items.indexOf(it);
    if (i >= 0) this.items.splice(i, 1);
  }

  _free(it) {
    this._freeSlab(it);
    for (const x of it.xbufs || []) this.mesh.freeBuffers(x.buf);
    it.xbufs = []; it.xn = {};
  }

  _freeSlab(it) {
    if (it.buf) this.mesh.freeBuffers(it.buf);
    it.buf = null; it.vao = null; it.count = 0;
  }

  // Which map layers are on: water, roads, built, cover, land (settings.js).
  setLayers(on) { this.on = on; }

  // A shape made in the app rather than read from a folder (a transplanted
  // piece of ground, transplant.js). Kept until a reload.
  addModel(id, model) {
    this.models.set(id, { state: 'ready', model, footprint: [], keep: true });
  }

  _ready(it) { const m = this.models.get(it.model); return !!m && m.state === 'ready'; }

  _load(id) {
    const m = { state: 'loading', vao: null, count: 0, footprint: [], buffers: null };
    this.models.set(id, m);
    loadModel(id).then((model) => {
      if (this.models.get(id) !== m) return;            // freed while loading
      m.model = model;
      m.state = 'ready';
    }).catch((e) => {
      console.warn('landmarks: shape "' + id + '" did not load: ' + e.message);
      m.state = 'failed';
    });
  }

  // GPU buffers are made per placement, because the turn (yaw) is baked into
  // the vertices. Cheap: a few thousand triangles each.
  _buffers(it) {
    const m = this.models.get(it.model);
    if (!m || m.state !== 'ready') return false;
    if (!it.vao) {
      const { vertices, indices } = buildVertices(m.model, it.yawDeg);
      it.buf = this.mesh.buffers(vertices, indices, null);
      it.vao = it.buf.vao; it.count = indices.length;
      if (!m.footprint.length && !m.keep) m.footprint = footprintOf(m.model);   // [east, north] metres, before any turn
    }
    this._extras(it, m);
    return true;
  }

  // A laid piece's roads and buildings (the model's layers, city.js), added as
  // map tiles arrive. Only what is new is uploaded: the layers only ever grow.
  _extras(it, m) {
    const ly = m.model.layers;
    if (!ly || !it.piece || it.preview) return;
    it.xbufs = it.xbufs || []; it.xn = it.xn || {};
    for (const kind of ['roads', 'built']) {
      const list = ly[kind];
      for (let i = it.xn[kind] || 0; i < list.length; i++) {
        const p = list[i];
        it.xbufs.push({ kind, buf: this.mesh.buffers(turnVertices(p.vertices, it.yawDeg), p.indices, p.info || null) });
      }
      it.xn[kind] = list.length;
    }
  }

  // A moved piece's ground carries the painted map (water, built-up, cover)
  // from the tiles that have arrived. Redone when a layer button changes, and
  // now and then while tiles arrive.
  _paint(m, now) {
    const ly = m.model.layers;
    if (!ly || !m.model.nodeVert || !m.model.col) return;
    const on = this.on, key = (on.water ? 1 : 0) + (on.built ? 2 : 0) + (on.cover ? 4 : 0);
    const changed = m.paintKey !== key, grew = m.paintVer !== ly.version;
    if (!changed && !(grew && now - (m.paintAt || 0) >= REPAINT_MS)) return;
    if (!ly.paint.length && !m.painted) { m.paintKey = key; m.paintVer = ly.version; return; }
    if (!m.col0) m.col0 = m.model.col.slice();
    paintSlab(m.model.col, m.col0, m.model.nodeVert, ly.paint, on);
    m.painted = true; m.paintKey = key; m.paintVer = ly.version; m.paintAt = now;
    for (const it of this.items) if (this.models.get(it.model) === m) this._freeSlab(it);   // remade on the next frame
  }

  // view: from detail.js. heightAt: (mercX, mercY) -> { h, z } (terrain.groundAt),
  // a plain height, or null where no terrain has loaded.
  update(view, heightAt) {
    const used = new Map();     // shape id -> nearest placement, in units of its range
    for (const it of this.items) {
      const dx = wrapMercDx(it.mx - view.mercX) * view.k, dy = (it.my - view.mercY) * view.k;
      it.km = Math.hypot(dx, dy) / 1000;
      const range = sightRange(it.height, view.agl);
      const r = it.km * 1000 / range;
      used.set(it.model, Math.min(used.has(it.model) ? used.get(it.model) : Infinity, r));
      it.inRange = r <= 1;
      if (!it.inRange) continue;
      if (!this.models.has(it.model)) this._load(it.model);
      // Ground under it: take the first answer, then a better one whenever a
      // finer terrain tile arrives (from far away only coarse tiles cover it).
      const g = heightAt(it.mx, it.my);
      const gz = g === null || g === undefined ? null : typeof g === 'number' ? { h: g, z: 99 } : g;
      if (gz && !it.fixedBase && (it.base === null || gz.z > it.baseZ)) { it.base = gz.h - SINK; it.baseZ = gz.z; }
      this._buffers(it);
    }
    const now = Date.now();
    for (const m of this.models.values()) if (m.state === 'ready') this._paint(m, now);
    // Free shapes nobody is near any more, with their placements' buffers.
    for (const [id, m] of this.models) {
      if (m.keep || (used.get(id) ?? Infinity) <= UNLOAD) continue;
      for (const it of this.items) if (it.model === id) this._free(it);
      this.models.delete(id);
    }
  }

  // In range, and everything needed to draw it has arrived (or failed for good).
  get inRange() { return this.items.filter((it) => it.inRange).length; }
  get resolved() {
    return this.items.filter((it) => it.inRange &&
      ((it.vao && it.base !== null) || (this.models.get(it.model) || {}).state === 'failed')).length;
  }

  // Draws every placement whose shape and ground are known. The mesh program
  // must already be in use for this pass; uScale and uCamAlt are changed here,
  // so landmarks are drawn last.
  // on: which layers are switched on (default: setLayers). Moved ground is
  // always drawn; its roads and buildings follow ROADS and BUILT, and the
  // landmarks, moved or not, follow LANDMARKS.
  draw(pass, on = this.on) {
    const gl = this.gl, u = this.mesh.u;
    gl.uniform1f(u.uScale, 1);
    for (const it of this.items) {
      if (!it.vao || it.base === null || it.hidden) continue;
      if (!it.piece && !it.ground && !on.land) continue;      // landmarks follow their button; moved ground does not
      // Height is relative to the landmark's own base: shift the camera, not the model.
      gl.uniform1f(u.uCamAlt, pass.alt - it.base);
      // Offset uses the camera's scale, exactly like tile offsets do.
      // The camera's longitude can have wrapped past 180, so take the nearest copy.
      gl.uniform2f(u.uTileOffset, wrapMercDx(it.mx - pass.mercX) * pass.k, (pass.mercY - it.my) * pass.k);
      gl.bindVertexArray(it.vao);
      gl.drawElements(gl.TRIANGLES, it.count, gl.UNSIGNED_INT, 0);
      if (!it.piece || it.preview) continue;
      for (const x of it.xbufs || []) {
        if (!x.buf.vao || !(x.kind === 'roads' ? on.roads : on.built)) continue;
        gl.bindVertexArray(x.buf.vao);
        gl.drawElements(gl.TRIANGLES, x.buf.count, gl.UNSIGNED_INT, 0);
      }
    }
  }

  // What the map's building outlines say about each landmark's heading. `outlines`
  // are the { id, area, edges } records gathered from the loaded tiles. Gives a
  // suggested yaw per landmark; the number is then copied into its landmark.json.
  // Only landmarks whose shape is loaded (you are near them) can be compared.
  orientation(outlines) {
    return this.items.filter((it) => this._ready(it) && !it.dropped && !it.preview).map((it) => {
      it = { ...it, footprint: this.models.get(it.model).footprint };
      const modelEdges = edgesOf(it.footprint), modelArea = Math.round(polygonArea(it.footprint));
      const own = dominantBearing(modelEdges, it.fold);
      const seen = [];
      for (const o of outlines.filter((q) => q.id === it.id && q.edges.length >= 12)) {
        if (seen.some((q) => Math.abs(q.area - o.area) <= 0.02 * Math.max(q.area, 1))) continue;   // same building in a second tile
        let sg;
        if (it.oval) {      // an oval has no straight edges: use the long axis, and how stretched the outline is
          const pts = []; for (let i = 0; i < o.edges.length; i += 4) pts.push([o.edges[i], o.edges[i + 1]]);
          const ax = ovalAxis(pts), mo = ovalAxis(it.footprint);
          sg = { yaw: wrapTo(ax.bearing - mo.bearing, 180), mapStrength: Math.min(1, (ax.stretch - 1) * 3) };
          seen.push({ area: o.area, strength: +sg.mapStrength.toFixed(2), yaw: +sg.yaw.toFixed(1), stretch: +ax.stretch.toFixed(2) });
          continue;
        }
        sg = suggestYaw(modelEdges, o.edges, it.fold);
        seen.push({ area: o.area, strength: +sg.mapStrength.toFixed(2), yaw: it.fold ? +sg.yaw.toFixed(1) : null });
      }
      seen.sort((a, b) => Math.abs(Math.log((a.area + 1) / (modelArea + 1))) - Math.abs(Math.log((b.area + 1) / (modelArea + 1))));
      const good = seen.find((c) => c.strength >= 0.3);
      return {
        name: it.name, storedYawDeg: it.yawDeg, fold: it.fold, modelFootprintM2: modelArea,
        modelEdgeStrength: +own.strength.toFixed(2),
        outlines: seen.slice(0, 4).map((c) => ({ m2: c.area, edgeStrength: c.strength, yawDeg: c.yaw, ...(c.stretch ? { stretch: c.stretch } : {}) })),
        suggestedYawDeg: good && it.fold ? good.yaw : null,
        note: !it.fold ? 'round footprint: the outline gives no direction, needs an outside cue'
          : !seen.length ? 'no map outline touched this tower (not loaded yet, or the map has none)'
          : !good ? 'outlines found but none has clear straight edges' : 'closest-sized outline with clear edges',
      };
    });
  }

  report() {
    return this.items.filter((it) => !it.preview && (it.inRange || it.km < 200)).map((it) => ({
      name: it.name + (it.dropped ? ' (dropped)' : ''),
      ...(it.dropped ? { lat: +it.lat.toFixed(6), lon: +it.lon.toFixed(6), yawDeg: it.yawDeg } : {}), ground: it.base === null ? null : Math.round(it.base + SINK), km: +it.km.toFixed(1),
      shape: this.models.has(it.model) ? this.models.get(it.model).state : 'not loaded (out of range)',
    }));
  }
}
