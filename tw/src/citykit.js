// What stands on a moved piece of ground, built for one map tile at a time:
// roads, railways, airport pavement and buildings, draped on the slab's own
// ground (piecegrid.js) instead of a terrain tile. The same code as the near
// field (roads.js, buildings.js), pointed at a different ground: see g.hAt and
// g.cell there.
//
// The output is in the slab's frame (x east, z south, true metres, y up from
// the piece's base), ready to be drawn with the slab, turned and laid anywhere.
//
// Plain functions, no fetching and no canvas, so they run in tests. The helper
// (nearworker.js, a `city` job) does the fetching and the painting.

import { buildRoads } from './roads.js';
import { buildBuildings } from './buildings.js';
import { MeshBuilder } from './meshbuilder.js';
import { LINESTRING } from './mvt.js';
import { tileSizeMerc, tileCentreMerc, mercYToLat, wrapMercDx } from './geo.js';
import { slabHeightFn, inside } from './piecegrid.js';
import { MASK } from './overlayraster.js';

// slab = { poly, cx, cy, k, grid }: the outline (east, north true metres from
// its middle), the middle in mercator metres, true metres per mercator metre,
// and the ground grid (piecegrid.js pieceGrid). tile = { x, y, z }.
//
// Returns { g, dx, dy, size, c }: g is what roads.js and buildings.js take, in
// the tile's local mercator metres (east, south from the tile's middle);
// (dx, dy) is the tile's middle east and north of the slab's middle.
export function tileFrame(slab, tile) {
  const { k, cx, cy, grid } = slab;
  const size = tileSizeMerc(tile.z);
  const c = tileCentreMerc(tile.x, tile.y, tile.z);
  const dx = wrapMercDx(c.x - cx), dy = c.y - cy;
  const slabH = slab.slabH || (slab.slabH = slabHeightFn(grid));
  const g = {
    size14: size, size12: size,
    // The slab's grid in this tile's units: node (i, j) sits at u = i, v = j
    // when u = (e + bx) / cell and v = (by + s) / cell.
    bx: dx - grid.e0 / k, by: grid.n1 / k - dy, cell: grid.step / k,
    cosLat: Math.cos(mercYToLat(c.y) * Math.PI / 180),
    nodes: null, cx: c.x, cy: c.y,
    hAt: (e, s) => slabH((dx + e) * k, (s - dy) * k),
  };
  return { g, dx, dy, size, c };
}

// The outline in a layer's own units (0..extent across the tile, y south).
function outlineIn(slab, fr, ext) {
  const { k } = slab;
  return slab.poly.map(([E, N]) => [(E / k - fr.dx) / fr.size * ext + ext / 2, (fr.dy - N / k) / fr.size * ext + ext / 2]);
}

// The parts of a line (flat [x, y, ...]) that lie inside the outline, cut
// exactly where it crosses the edge.
export function clipLine(part, poly) {
  const out = [];
  let cur = null;
  for (let i = 0; i + 3 < part.length; i += 2) {
    const ax = part[i], ay = part[i + 1], bx = part[i + 2], by = part[i + 3];
    const dx = bx - ax, dy = by - ay;
    const ts = [0, 1];
    for (let a = 0, b = poly.length - 1; a < poly.length; b = a++) {
      const px = poly[b][0], py = poly[b][1], ex = poly[a][0] - px, ey = poly[a][1] - py;
      const r = dx * ey - dy * ex;
      if (r === 0) continue;
      const t = ((px - ax) * ey - (py - ay) * ex) / r;
      const u = ((px - ax) * dy - (py - ay) * dx) / r;
      if (t > 0 && t < 1 && u >= 0 && u < 1) ts.push(t);
    }
    ts.sort((p, q) => p - q);
    for (let m = 0; m + 1 < ts.length; m++) {
      const t0 = ts[m], t1 = ts[m + 1];
      if (t1 - t0 < 1e-9) continue;
      const tm = (t0 + t1) / 2;
      if (inside(poly, ax + dx * tm, ay + dy * tm)) {
        const x0 = ax + dx * t0, y0 = ay + dy * t0, x1 = ax + dx * t1, y1 = ay + dy * t1;
        if (cur && Math.abs(cur[cur.length - 2] - x0) < 1e-6 && Math.abs(cur[cur.length - 1] - y0) < 1e-6) cur.push(x1, y1);
        else { if (cur) out.push(cur); cur = [x0, y0, x1, y1]; }
      } else if (cur) { out.push(cur); cur = null; }
    }
  }
  if (cur) out.push(cur);
  return out;
}

// Where a feature's middle is: the average of its first part's points.
function middle(f) {
  const p = f.parts && f.parts[0];
  if (!p || p.length < 2) return null;
  let sx = 0, sy = 0, n = 0;
  for (let i = 0; i + 1 < p.length; i += 2) { sx += p[i]; sy += p[i + 1]; n++; }
  return [sx / n, sy / n];
}

// A layer cut to the outline. Roads and railways are cut exactly. Areas and
// whole things (buildings, airport pavement) are kept or dropped by where their
// middle is, so one that crosses the edge hangs over it.
function cutLayer(layer, poly, lines) {
  if (!layer) return null;
  const features = [];
  for (const f of layer.features) {
    if (lines && f.type === LINESTRING) {
      const parts = [];
      for (const part of f.parts) for (const q of clipLine(part, poly)) parts.push(q);
      if (parts.length) features.push({ ...f, parts });
      continue;
    }
    const m = middle(f);
    if (m && inside(poly, m[0], m[1])) features.push(f);
  }
  return { ...layer, features };
}

// One map tile's roads and buildings for a piece, in the slab's frame.
//   layers  the tile's decoded map layers (mvt.js decodeMVT, full properties)
//   spec    { slab, tile, mask }: mask = landmark circles and outlines in tile
//           units (nearworker.js landmarkMask), where no map building is wanted
// Returns { roads, bld, stats }: roads { vertices, indices, verts, info },
// bld the same for buildings (info says how the shader colours each vertex).
export function buildCityTile(layers, spec) {
  const { slab, tile, mask = [] } = spec;
  const fr = tileFrame(slab, tile);
  const L = (name, lines) => {
    const l = layers[name];
    return l ? cutLayer(l, outlineIn(slab, fr, l.extent), lines) : null;
  };
  const tr = L('transportation', true), ae = L('aeroway', false), bl = L('building', false);
  const counts = {};
  const rb = new MeshBuilder(), bb = new MeshBuilder();
  buildRoads(tr, fr.g, rb, ae, counts);
  const stats = buildBuildings(bl, fr.g, bb, undefined, { mask, landuse: layers.landuse });
  Object.assign(stats, counts);
  return { roads: toSlab(rb, fr, slab.k), bld: toSlab(bb, fr, slab.k), stats };
}

// The mesh's vertices from the tile's local mercator metres into the slab's
// true metres. Heights are true already, and measured from the base.
function toSlab(mb, fr, k) {
  const r = mb.finish();
  const f = new Float32Array(r.vertices);
  for (let i = 0; i < r.verts; i++) {
    f[4 * i] = (fr.dx + f[4 * i]) * k;
    f[4 * i + 2] = (f[4 * i + 2] - fr.dy) * k;
  }
  return r;
}

// What the painted map says about each slab grid node in this tile, from the
// tile's two images (overlayraster.js rasterOverlays: ov = { mask, cover } or
// null). Only nodes that are used by a cell inside the outline, and that have
// something painted on them, are listed.
// Returns { idx, water, built, cov, cover }: node numbers, 0..255 strengths,
// and the cover colour (three bytes a node).
export function samplePaint(ov, slab, tile) {
  const empty = { idx: new Uint32Array(0), water: new Uint8Array(0), built: new Uint8Array(0), cov: new Uint8Array(0), cover: new Uint8Array(0) };
  if (!ov) return empty;
  const fr = tileFrame(slab, tile);
  const { e0, n1, step, W, H, cellIn } = slab.grid, k = slab.k, h = fr.size / 2;
  // Half-open, so a node on a tile's edge belongs to exactly one tile.
  const i0 = Math.max(0, Math.ceil(((fr.dx - h) * k - e0) / step)), i1 = Math.min(W - 1, Math.ceil(((fr.dx + h) * k - e0) / step) - 1);
  const j0 = Math.max(0, Math.ceil(((-h - fr.dy) * k + n1) / step)), j1 = Math.min(H - 1, Math.ceil(((h - fr.dy) * k + n1) / step) - 1);
  const used = (i, j) => {
    for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) {
      const a = i + di, b = j + dj;
      if (a >= 0 && b >= 0 && a < W - 1 && b < H - 1 && cellIn[b * (W - 1) + a]) return true;
    }
    return false;
  };
  const idx = [], water = [], built = [], cov = [], cover = [];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      if (!used(i, j)) continue;
      const e = (e0 + i * step) / k - fr.dx, s = (-n1 + j * step) / k + fr.dy;
      const px = Math.max(0, Math.min(MASK - 1, Math.floor((e / fr.size + 0.5) * MASK)));
      const py = Math.max(0, Math.min(MASK - 1, Math.floor((s / fr.size + 0.5) * MASK)));
      const p = py * MASK + px;
      const wa = ov.mask[4 * p], bu = ov.mask[4 * p + 2], co = ov.mask[4 * p + 3];
      if (!wa && !bu && !co) continue;
      idx.push(j * W + i); water.push(wa); built.push(bu); cov.push(co);
      cover.push(ov.cover[3 * p], ov.cover[3 * p + 1], ov.cover[3 * p + 2]);
    }
  }
  return { idx: Uint32Array.from(idx), water: Uint8Array.from(water), built: Uint8Array.from(built),
           cov: Uint8Array.from(cov), cover: Uint8Array.from(cover) };
}

// Paint colours for the slab (0..255), as the terrain shader's, before light.
export const WATER_RGB = [36, 80, 122];
export const BUILT_RGB = [117, 112, 107];
const smooth = (a, b, x) => { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// The slab's vertex colours with the painted map laid on them. col0: the
// colours as built (3 bytes a vertex); col: the colours to write into.
// paints: the list of samplePaint results. on: { water, built, cover }.
// Painted in the shader's order: cover, then built-up, then water on top.
export function paintSlab(col, col0, nodeVert, paints, on) {
  col.set(col0);
  for (const p of paints) {
    for (let t = 0; t < p.idx.length; t++) {
      const v = nodeVert[p.idx[t]];
      if (v < 0) continue;
      let r = col[3 * v], g = col[3 * v + 1], b = col[3 * v + 2];
      const mix = (c, a) => { r += (c[0] - r) * a; g += (c[1] - g) * a; b += (c[2] - b) * a; };
      if (on.cover) mix([p.cover[3 * t], p.cover[3 * t + 1], p.cover[3 * t + 2]], smooth(0.15, 0.55, p.cov[t] / 255));
      if (on.built) mix(BUILT_RGB, smooth(0.2, 0.6, p.built[t] / 255) * 0.8);
      if (on.water) mix(WATER_RGB, smooth(0.35, 0.65, p.water[t] / 255));
      col[3 * v] = r; col[3 * v + 1] = g; col[3 * v + 2] = b;
    }
  }
}
