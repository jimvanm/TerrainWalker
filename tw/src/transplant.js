// Transplant: draw an outline on the ground, pick up the ground inside it, fly
// anywhere and lay it down there: Everest in Lake Ontario, say. (Tools mode.)
//
//   N          start an outline; each click adds a corner where the pointer
//              meets the ground
//   Backspace  take back the last corner
//   Enter      close the outline and pick the ground up
//   , and .    turn it 15 degrees;  U  how high it stands (below); U over a
//              laid piece, with nothing in hand, changes it where it lies
//   click      lay it down; it stays in hand, so click again for another.
//              With nothing in hand, a click on a laid piece picks it up again.
//   Delete     remove a laid piece the pointer is on
//   N again    put it away (or Esc, where the browser passes Esc on)
//
// How high it stands. A piece of ground is never level, so there is a choice:
//   rise    (default) its rise above the outline's edge, stood on the ground
//           at the destination's edge. Outline Everest from base camp and it
//           rises about 3,500 m out of Lake Ontario.
//   sea     its height above sea level: Everest stands 8,849 m above the sea.
// Either way nothing in the piece goes below its base, so it never dips under
// the water it is laid in.
//
// The piece is drawn like a landmark (a solid model at true size), with a
// wall around its edge down into the ground, so it meets the ground there
// whatever that ground does. The ground under it is not changed. Pieces last
// until a reload.
//
// A city comes along: the map's water, built-up areas and cover painted on the
// piece, its roads, railways, airports and buildings standing on it (city.js,
// citykit.js), and the landmarks inside the outline, standing where they
// stood, turned with it. While you carry it only the shape is drawn; the map
// is fetched in the background and shows once the piece is laid.

import { mercScale, mercYToLat, mercXToLon, lonToMercX, latToMercY, wrapMercDx, HALF, tileSizeMerc, R_MEAN } from './geo.js';
import { aimPoint, forward } from './dropper.js';
import { pieceGrid, slabHeightFn, inside, alongEdge, median } from './piecegrid.js';
import { City } from './city.js';
import { SINK } from './landmarks.js';

export { inside, alongEdge, median };

const TURN = 15;
const MAX_CELLS = 360;         // grid cells across the piece's longer side
const MAX_TILES = 64;          // source tiles fetched for one piece
const WALL = 400;              // metres the edge wall reaches down
const PX = 256;
let count = 0;

// ---- plain geometry (exported for the tests) ----------------------------------

export function area(poly) {
  let a = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) a += (poly[j][0] + poly[i][0]) * (poly[j][1] - poly[i][1]);
  return Math.abs(a / 2);
}

// A turn of `yawDeg` clockwise seen from above, applied to [east, north].
export function turnEN(e, n, yawDeg) {
  const c = Math.cos(yawDeg * Math.PI / 180), s = Math.sin(yawDeg * Math.PI / 180);
  return [e * c + n * s, n * c - e * s];
}

// Ground colour by height and steepness (the model shader adds the light).
function colour(h, steep) {
  if (h > 4800) return [0.93, 0.94, 0.96];                       // snow
  if (steep > 0.7) return [0.47, 0.44, 0.41];                    // rock (over about 35 degrees)
  const t = Math.min(1, Math.max(0, h / 3000));
  return [0.33 + 0.17 * t, 0.45 - 0.03 * t, 0.25 + 0.05 * t];    // green, to brown higher up
}

// The model for a piece. heightAt(e, n): the source height at [east, north]
// metres from the outline's middle. poly: the outline in the same metres.
// mode 'rise' or 'sea' (see the top). cut: in rise mode, the height it is cut
// at (a traced mountain's valleys round it); without one, the middle height
// along its edge. Returns { pos, col, idx, rise, edge }: pos x east, y up,
// z south (true metres), as landmark models are.
export function buildPiece(heightAt, poly, mode = 'rise', cut = null) {
  const grid = pieceGrid(heightAt, poly, mode, cut);
  const { e0, n1, step, W, H, hs, cellIn, edge, base } = grid;
  const isIn = (i, j) => i >= 0 && j >= 0 && i < W - 1 && j < H - 1 && cellIn[j * (W - 1) + i] === 1;

  const pos = [], col = [], idx = [];
  let rise = 0;
  const vert = (x, y, z, c) => { pos.push(x, y, z); col.push(...c.map((v) => Math.round(v * 255))); return pos.length / 3 - 1; };
  // The top: one vertex per node, used by any cell inside.
  const node = new Int32Array(W * H).fill(-1);
  const top = (i, j) => {
    const k = j * W + i;
    if (node[k] >= 0) return node[k];
    const h = hs[k];
    const y = Math.max(0, h - base);        // never below its base
    rise = Math.max(rise, y);
    const gx = (hs[j * W + Math.min(W - 1, i + 1)] - hs[j * W + Math.max(0, i - 1)]) / (2 * step);
    const gy = (hs[Math.min(H - 1, j + 1) * W + i] - hs[Math.max(0, j - 1) * W + i]) / (2 * step);
    node[k] = vert(e0 + i * step, y, -(n1 - j * step), colour(h, Math.hypot(gx, gy)));
    return node[k];
  };
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    if (!isIn(i, j)) continue;
    const a = top(i, j), b = top(i + 1, j), c = top(i, j + 1), d = top(i + 1, j + 1);
    idx.push(a, c, b, b, c, d);
    // A wall down from each side that borders the outside.
    const wall = (p, q) => {
      const [x1, , z1] = pos.slice(p * 3, p * 3 + 3), [x2, , z2] = pos.slice(q * 3, q * 3 + 3);
      const shade = [0.36, 0.33, 0.30];
      const p2 = vert(x1, -WALL, z1, shade), q2 = vert(x2, -WALL, z2, shade);
      idx.push(p, q, p2, q, q2, p2);
    };
    if (!isIn(i, j - 1)) wall(a, b);
    if (!isIn(i, j + 1)) wall(c, d);
    if (!isIn(i - 1, j)) wall(a, c);
    if (!isIn(i + 1, j)) wall(b, d);
  }
  // grid: the ground as numbers (piecegrid.js); nodeVert: the vertex of each grid node, -1 for none.
  return { pos: new Float32Array(pos), col: new Uint8Array(col), idx: new Uint32Array(idx), rise, edge, base, grid, nodeVert: node };
}

// The source zoom: as fine as the piece's grid needs, and no more tiles than MAX_TILES.
export function chooseZoom(spanM, lat) {
  const cellM = spanM / MAX_CELLS;
  let z = Math.round(Math.log2(40075016 * Math.cos(lat * Math.PI / 180) / (PX * cellM)));
  z = Math.max(4, Math.min(14, z));
  while (z > 4 && (spanM / (tileSizeMerc(z) * Math.cos(lat * Math.PI / 180)) + 2) ** 2 > MAX_TILES) z--;
  return z;
}

// Height at a mercator point from decoded tiles (Map 'x/y' -> Float32Array PX*PX) at zoom z.
export function sampler(tiles, z) {
  const s = tileSizeMerc(z), n = 2 ** z;
  return (mx, my) => {
    const fx = (mx + HALF) / s * PX - 0.5, fy = (HALF - my) / s * PX - 0.5;
    const get = (px, py) => {
      const tx = Math.floor(px / PX), ty = Math.floor(py / PX);
      const t = tiles.get(((tx % n) + n) % n + '/' + ty);
      if (!t) return null;
      return t[(py - ty * PX) * PX + (px - tx * PX)];
    };
    const x0 = Math.floor(fx), y0 = Math.floor(fy), ax = fx - x0, ay = fy - y0;
    const a = get(x0, y0), b = get(x0 + 1, y0), c = get(x0, y0 + 1), d = get(x0 + 1, y0 + 1);
    if (a === null || b === null || c === null || d === null) return a ?? b ?? c ?? d;
    return (a + (b - a) * ax) * (1 - ay) + (c + (d - c) * ax) * ay;
  };
}

// ---- the tool -----------------------------------------------------------------------

export class Transplant {
  // landmarks: draws the pieces. fetchTile(z, x, y): Promise of the tile's
  // heights (Float32Array PX*PX), from the usual tiles.
  constructor(landmarks, fetchTile) {
    this.L = landmarks;
    this.fetchTile = fetchTile;
    this.state = 'off';        // off | drawing | loading | carrying
    this.corners = [];         // [{ mx, my, h }] while drawing
    this.piece = null;         // what is in hand: { id, poly (east, north m), rise, name }
    this.preview = null;
    this.yawDeg = 0;
    this.mode = 'rise';
    this.aim = null;
    this.message = '';
    this.mapUrl = null;        // (z, x, y) -> a map tile's address, or null before it is known (set by the page)
    this.runCity = null;       // (spec) -> Promise of a map tile built by a helper (city.js)
  }

  get active() { return this.state !== 'off'; }

  // N: start an outline, or put away what is in hand.
  toggle() {
    if (this.state === 'off') { this.state = 'drawing'; this.corners = []; return; }
    this.cancel();
  }

  cancel() {
    if (this.preview) {
      if (this.piece && this.piece.layers && !this._used(this.preview.model)) this.piece.layers.cancel();
      this.L.remove(this.preview); this.preview = null;
    }
    this.state = 'off'; this.corners = []; this.piece = null;
  }

  // Click: a corner while drawing; lay the piece down while carrying.
  click(groundAt) {
    if (this.state === 'drawing' && this.aim) {
      this.corners.push({ mx: this.aim.mx, my: this.aim.my, h: groundAt(this.aim.mx, this.aim.my) });
    } else if (this.state === 'carrying' && this.preview && this.preview.base !== null && !this.preview.hidden) {
      const p = this.preview;
      const it = this.L.add({ model: p.model, name: p.name, lat: p.lat, lon: p.lon, height: p.height, yawDeg: p.yawDeg,
        maskR: 0, id: 'piece:' + (count++), dropped: true, piece: { ...this.piece, mode: this.mode, modelId: p.model } });
      it.fixedBase = true; it.base = p.base;
      this._layCarried(it);
      this._say('Laid down. Click again for another; N to put it away.');
    }
  }

  // The landmarks inside an outline (listed, dropped or carried ones, but not
  // pieces), as they stand relative to its middle: they come along as copies.
  _gather(poly, cx, cy, k) {
    const out = [];
    for (const it of this.L.items) {
      if (it.piece || it.preview || it.carriedBy) continue;
      const e = wrapMercDx(it.mx - cx) * k, n = (it.my - cy) * k;
      if (!inside(poly, e, n)) continue;
      out.push({ model: it.model, name: it.name, height: it.height, yawDeg: it.yawDeg || 0, fold: it.fold || 0, oval: !!it.oval, e, n });
    }
    return out;
  }

  // Stand a laid piece's landmarks on it, turned with it, each on the piece's
  // ground where it stood. They go when the piece does (Landmarks.remove).
  _layCarried(it) {
    it.carried = [];
    const carry = it.piece.carry || [];
    if (!carry.length || !it.piece.grid) return;
    const slabH = slabHeightFn(it.piece.grid), kk = mercScale(mercYToLat(it.my));
    for (const c of carry) {
      const [te, tn] = turnEN(c.e, c.n, it.yawDeg);
      const mx = it.mx + te / kk, my = it.my + tn / kk;
      const lm = this.L.add({ model: c.model, name: c.name, lat: mercYToLat(my), lon: mercXToLon(mx), height: c.height,
        yawDeg: ((c.yawDeg + it.yawDeg) % 360 + 360) % 360, fold: c.fold, oval: c.oval, maskR: 0,
        id: 'carried:' + (count++), dropped: true });
      lm.carriedBy = it; lm.fixedBase = true;
      lm.base = it.base + slabH(c.e, -c.n) - SINK;
      it.carried.push(lm);
    }
  }

  // Is a model still stood somewhere (a laid piece), so its layers must keep loading?
  _used(modelId) { return this.L.items.some((it) => it.piece && it.piece.modelId === modelId); }

  // A short note in the message line, for a few seconds.
  _say(text) { this.note = text; this.noteUntil = Date.now() + 3000; }

  // From the saved pieces list: put that piece in hand, wherever you are.
  // The ground is fetched again (usually from the tile cache).
  take(saved) {
    this.cancel();
    this.state = 'drawing';
    this.mode = saved.mode === 'sea' ? 'sea' : 'rise';
    this.corners = saved.corners.map(([lat, lon]) => ({ mx: lonToMercX(lon), my: latToMercY(lat), h: null }));
    return this.close(saved);
  }

  undo() { if (this.state === 'drawing') this.corners.pop(); }

  turn(sign) {
    if (this.state !== 'carrying') return;
    this.yawDeg = ((this.yawDeg + sign * TURN) % 360 + 360) % 360;
    this.L.turnTo(this.preview, this.yawDeg);
  }

  // U: rise above its edge, or height above sea level. The model is rebuilt.
  toggleHeight() {
    if (this.state !== 'carrying') return;
    this.mode = this.mode === 'rise' ? 'sea' : 'rise';
    this._model();
  }

  // Enter: close the outline and fetch the ground inside it. A new outline is
  // passed to onPicked (the saved pieces list), which gives back its name;
  // one taken from that list (fromList) already has one.
  async close(fromList = null) {
    if (this.state !== 'drawing' || this.corners.length < 3) return;
    const cs = this.corners;
    const cx = cs.reduce((s, c) => s + c.mx, 0) / cs.length, cy = cs.reduce((s, c) => s + c.my, 0) / cs.length;
    const lat = mercYToLat(cy), k = mercScale(lat);
    const poly = cs.map((c) => [wrapMercDx(c.mx - cx) * k, (c.my - cy) * k]);
    if (area(poly) < 100) { this._say('That outline has no area.'); return; }
    this.state = 'loading';
    const span = Math.max(...poly.map((p) => Math.abs(p[0]))) * 2 + Math.max(...poly.map((p) => Math.abs(p[1]))) * 2;
    const z = chooseZoom(span / 2, lat);
    const s = tileSizeMerc(z), n = 2 ** z;
    const xs = cs.map((c) => (c.mx + HALF) / s), ys = cs.map((c) => (HALF - c.my) / s);
    const tiles = new Map(), jobs = [];
    for (let ty = Math.floor(Math.min(...ys)) - 1; ty <= Math.floor(Math.max(...ys)) + 1; ty++) {
      for (let tx = Math.floor(Math.min(...xs)) - 1; tx <= Math.floor(Math.max(...xs)) + 1; tx++) {
        if (ty < 0 || ty >= n) continue;
        const x = ((tx % n) + n) % n;
        jobs.push(this.fetchTile(z, x, ty).then((h) => tiles.set(x + '/' + ty, h)).catch(() => {}));
      }
    }
    this.loading = jobs.length;
    await Promise.all(jobs);
    if (this.state !== 'loading') return;           // put away while loading
    if (!tiles.size) { this._say('Could not load the ground there.'); this.state = 'drawing'; return; }
    const at = sampler(tiles, z);
    let name = fromList ? fromList.name : 'Piece of ground';
    if (!fromList && this.onPicked) {
      name = this.onPicked({ corners: cs.map((c) => [+mercYToLat(c.my).toFixed(6), +mercXToLon(c.mx).toFixed(6)]), mode: this.mode }) || name;
    }
    const cut = fromList && Number.isFinite(fromList.cut) ? fromList.cut : null;
    this.piece = { poly, heightAt: (e, nn) => at(cx + e / k, cy + nn / k), name, z, cut, cx, cy, k };
    this.piece.carry = this._gather(poly, cx, cy, k);
    this.piece.city = this.runCity && this.mapUrl
      ? new City({ poly, cx, cy, k, run: this.runCity, mapUrl: this.mapUrl, maskModels: [...new Set(this.piece.carry.map((c) => c.model))] })
      : null;
    this.yawDeg = 0;
    this.state = 'carrying';
    this._model();
  }

  _model() {
    const built = buildPiece(this.piece.heightAt, this.piece.poly, this.mode, this.piece.cut);
    const prev = this.preview ? { model: this.preview.model, layers: this.piece.layers } : null;
    Object.assign(this.piece, built);
    // What stands on this ground (it depends on the mode), filling up as the map arrives.
    built.layers = this.piece.layers = this.piece.city ? this.piece.city.attach(built) : null;
    const id = 'piece-model:' + (count++);
    this.L.addModel(id, built);
    if (prev && prev.layers && !this._used(prev.model)) prev.layers.cancel();
    if (this.preview) this.L.remove(this.preview);
    this.preview = this.L.add({ model: id, name: this.piece.name, lat: 0, lon: 0, height: Math.max(built.rise, 50),
      yawDeg: this.yawDeg, maskR: 0, id: 'piece-preview', preview: true, ground: true });
    this.preview.fixedBase = true;
    this.preview.hidden = true;
  }

  // Every frame: where the pointer meets the ground; the piece in hand stands
  // there, on the destination's ground at its edge.
  update(cam, groundAt, dir) {
    const note = this.note && Date.now() < this.noteUntil ? this.note : '';
    if (this.state === 'off') { this.message = note; return; }
    this.aim = aimPoint(cam, groundAt, dir || forward(cam));
    if (this.state === 'drawing') {
      this.message = note || `Outline: ${this.corners.length} corner${this.corners.length === 1 ? '' : 's'}  ·  click adds  ·  Backspace takes back  ·  Enter picks it up  ·  N cancels`;
      return;
    }
    if (this.state === 'loading') { this.message = `Picking up the ground (${this.loading} tiles)...`; return; }
    const p = this.preview;
    if (!this.aim) { p.hidden = true; this.message = 'Point at the ground to place it'; return; }
    this.L.moveTo(p, this.aim.mx, this.aim.my);
    p.base = this._base(this.piece.poly, this.mode, this.aim.mx, this.aim.my, this.yawDeg, groundAt);
    p.hidden = p.base === null;
    const rise = Math.round(this.piece.rise), ly = this.piece.layers;
    const map = !ly ? '' : ly.noMap ? '  ·  no map yet' : ly.settled < ly.total ? `  ·  map ${ly.settled}/${ly.total}` : '';
    this.message = note || `${this.mode === 'rise' ? `Rises ${rise} m above its edge` : 'Height above sea level'} (U changes)${map}  ·  click lays it down  ·  , . turn  ·  N puts it away`;
  }

  // Where a piece stands: the destination's ground along its turned outline's
  // edge (rise), or sea level.
  _base(poly, mode, mx, my, yawDeg, groundAt) {
    if (mode === 'sea') return 0;
    const k = mercScale(mercYToLat(my));
    return median(alongEdge(poly, Math.max(20, Math.sqrt(area(poly)) / 12)).map(([e, n]) => {
      const [te, tn] = turnEN(e, n, yawDeg);
      return groundAt(mx + te / k, my + tn / k);
    }));
  }

  // Out of Tools mode: what is in hand is kept, only hidden, and comes back
  // on returning. An outline half drawn is kept too.
  park() {
    if (this.preview) this.preview.hidden = true;
    this.message = '';
  }

  // U with nothing in hand: switch the laid piece the pointer is on between
  // rise and sea level, where it lies. Returns true if there was one.
  toggleAt(aim, groundAt) {
    const it = this._resolve(aim);
    if (!it) return false;
    const mode = it.piece.mode === 'rise' ? 'sea' : 'rise';
    const built = buildPiece(it.piece.heightAt, it.piece.poly, mode, it.piece.cut);
    const base = this._base(it.piece.poly, mode, it.mx, it.my, it.yawDeg, groundAt);
    if (base === null) return false;
    built.layers = it.piece.city ? it.piece.city.attach(built) : null;
    const id = 'piece-model:' + (count++);
    this.L.addModel(id, built);
    this.L.remove(it);
    if (it.piece.layers && !this._used(it.piece.modelId)) it.piece.layers.cancel();
    const nu = this.L.add({ model: id, name: it.name, lat: it.lat, lon: it.lon, height: Math.max(built.rise, 50), yawDeg: it.yawDeg,
      maskR: 0, id: 'piece:' + (count++), dropped: true, piece: { ...it.piece, ...built, mode, modelId: id } });
    nu.fixedBase = true; nu.base = base;
    this._layCarried(nu);
    this._say(mode === 'rise' ? `Now rises ${Math.round(built.rise)} m above its edge` : 'Now at its height above sea level');
    return true;
  }

  // A click with nothing in hand: pick up the laid piece the pointer is on,
  // turned as it lay, so it can be moved again. Returns true if there was one.
  pickUpAt(aim) {
    const it = this._resolve(aim);
    if (!it) return false;
    this.L.remove(it);
    this.piece = it.piece;
    this.mode = it.piece.mode;
    this.yawDeg = it.yawDeg;
    this.state = 'carrying';
    this.preview = this.L.add({ model: it.piece.modelId, name: it.name, lat: it.lat, lon: it.lon, height: it.height,
      yawDeg: it.yawDeg, maskR: 0, id: 'piece-preview', preview: true, ground: true });
    this.preview.fixedBase = true;
    this.preview.hidden = true;
    this._say('Picked it up. Click to lay it down again.');
    return true;
  }

  // pickUpAt, removeAt and toggleAt take either a laid piece (from pointedAt)
  // or a ground point, which finds the piece whose outline it is in.
  _resolve(x) { return x && x.piece ? x : this._pieceAt(x); }

  // The laid piece your line of sight (dir: the pointer's, or where you look)
  // meets first, sides and all, as it is drawn. Marched along the line up to
  // where it meets the ground; failing that, the piece whose outline the
  // ground point is in.
  pointedAt(cam, groundAt, dir) {
    dir = dir || forward(cam);
    const pieces = this.L.items.filter((it) => it.piece && it.base !== null);
    if (!pieces.length) return null;
    const ground = aimPoint(cam, groundAt, dir);
    const k = mercScale(mercYToLat(cam.mercY)), flat = Math.hypot(dir.e, dir.n);
    const stop = ground ? ground.d / Math.max(flat, 1e-6) : 100000;
    const curv = 1 / (2 * R_MEAN);
    for (let t = 1; t < stop; t = t * 1.02 + 2) {
      const mx = cam.mercX + dir.e * t / k, my = cam.mercY + dir.n * t / k;
      const d = t * flat, y = cam.alt + dir.u * t + curv * d * d;   // the line, in the drawn world's heights
      for (const it of pieces) {
        const kk = mercScale(mercYToLat(it.my));
        const [pe, pn] = turnEN(wrapMercDx(mx - it.mx) * kk, (my - it.my) * kk, -it.yawDeg);
        if (!inside(it.piece.poly, pe, pn)) continue;
        const h = it.piece.heightAt(pe, pn);
        if (h !== null && y <= it.base + Math.max(0, h - it.piece.base)) return it;
      }
    }
    return this._pieceAt(ground);
  }

  _pieceAt(aim) {
    if (!aim) return null;
    for (const it of this.L.items) {
      if (!it.piece) continue;
      const k = mercScale(mercYToLat(it.my));
      const e = wrapMercDx(aim.mx - it.mx) * k, n = (aim.my - it.my) * k;
      const [pe, pn] = turnEN(e, n, -it.yawDeg);       // back into the piece's own frame
      if (inside(it.piece.poly, pe, pn)) return it;
    }
    return null;
  }

  // Delete: the laid piece the pointer is on. Returns it, or null.
  removeAt(aim) {
    const it = this._resolve(aim);
    if (it) { this.L.remove(it); this._say('Removed the piece.'); }
    return it;
  }

  // The outline being drawn, for the screen overlay: [{ mx, my, h }], plus the
  // pointer's point while drawing.
  outline() {
    if (this.state !== 'drawing') return null;
    return { corners: this.corners, next: this.aim };
  }
}

// For the overlay: a ground point on the screen, or null if behind you.
// The same camera as screenDir() in dropper.js, the other way round.
export function toScreen(cam, mx, my, h, w, hpx, fovDeg) {
  const k = mercScale(mercYToLat(cam.mercY));
  const e = wrapMercDx(mx - cam.mercX) * k, n = (my - cam.mercY) * k;
  const d = Math.hypot(e, n);
  const u = h - d * d / (2 * R_MEAN) - cam.alt;
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch), cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
  const fz = e * sy * cp + n * cy * cp + u * sp;
  if (fz < 1) return null;
  const x = (e * cy - n * sy) / fz, y = (-e * sp * sy - n * sp * cy + u * cp) / fz;
  const t = Math.tan(fovDeg * Math.PI / 360);
  return { x: (x / (t * w / hpx) + 1) / 2 * w, y: (1 - y / t) / 2 * hpx };
}
