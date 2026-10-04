// Turns road centrelines into flat ribbons draped on the terrain mesh. Also
// railways (two dark rails each) and airport runways, taxiways and aprons.
//
// The vector tiles carry no lane count or width, so width comes from road class
// (two-way, one-way). One-way matters most on motorways and trunk roads, where
// OSM maps each carriageway as its own line.

import { LINESTRING, POLYGON } from './mvt.js';
import { nodeHeightAt, GRID } from './heightgrid.js';
import { rgba } from './meshbuilder.js';
import { triangulate } from './earclip.js';
import { clip, polygons } from './buildings.js';

// w = [two-way, one-way] in true metres, c = colour, r = stacking rank.
export const ROAD_STYLE = {
  motorway:  { w: [24, 12],   c: [78, 78, 84],   r: 6 },
  trunk:     { w: [14, 9],    c: [82, 82, 87],   r: 5 },
  primary:   { w: [11, 7],    c: [86, 86, 90],   r: 4 },
  secondary: { w: [9, 6],     c: [90, 90, 94],   r: 3 },
  tertiary:  { w: [8, 5.5],   c: [96, 96, 98],   r: 2 },
  minor:     { w: [6, 4.5],   c: [104, 103, 102], r: 1 },
  raceway:   { w: [10, 10],   c: [90, 90, 92],   r: 1 },
  service:   { w: [4, 3.5],   c: [112, 109, 104], r: 0 },
  track:     { w: [3, 3],     c: [140, 118, 84], r: 0 },
  path:      { w: [1.6, 1.6], c: [158, 140, 108], r: 0 },
};

// Railways. w = width across both rails, line = width of each rail (true
// metres; drawn wider than real rails so they can be seen like a road).
// r = rank, which decides how far away it is drawn, the same as roads.
// Main lines show as far as primary roads; trams, sidings and yards as far as
// minor roads.
const RAIL_C = [24, 24, 26];
export const RAIL_STYLE = {
  main:    { w: 6,   line: 1.3, r: 4 },
  minor:   { w: 5,   line: 1.1, r: 1 },   // sidings, yards, spurs, narrow gauge, heritage
  transit: { w: 4.5, line: 1.0, r: 1 },   // tram, light rail, subway above ground, monorail
};
const RAIL_LIFT_RANK = 7;                 // above every road, so level crossings show the rails

export function railStyle(f) {
  const p = f.props || {};
  if (f.cls === 'transit') return RAIL_STYLE.transit;
  if (f.cls !== 'rail') return null;
  if (p.service || (p.subclass && p.subclass !== 'rail')) return RAIL_STYLE.minor;
  return RAIL_STYLE.main;
}

// Airports. Areas are laid flat on the ground; runways and taxiways mapped
// only as a line get a standard width (w, true metres). Runways show from as
// far as motorways, the rest as far as primary roads. Lifts sit below the
// roads, so a service road across an apron stays visible.
export const AERO_STYLE = {
  runway:  { c: [64, 64, 68],    w: 45, lift: 0.10, r: 5 },
  taxiway: { c: [98, 98, 100],   w: 20, lift: 0.08, r: 3 },
  apron:   { c: [126, 126, 124],        lift: 0.06, r: 3 },
  helipad: { c: [98, 98, 100],          lift: 0.08, r: 3 },
};

// Per-class lift above the terrain (metres). Tiny, but each class gets its own
// so crossing roads of different colour never share a depth value.
const LIFT = 0.12;
const LIFT_STEP = 0.02;

// Points of one line, in local metres, subdivided so a ribbon follows the
// terrain triangles closely instead of cutting across them.
function linePoints(part, ext, size, step) {
  const pts = [];
  let le = 0, ls = 0;
  for (let i = 0; i < part.length; i += 2) {
    const e = (part[i] / ext - 0.5) * size;
    const s = (part[i + 1] / ext - 0.5) * size;
    if (i === 0) { pts.push(e, s); }
    else {
      const dx = e - le, dz = s - ls, L = Math.hypot(dx, dz);
      if (L < 1e-3) continue;
      const n = Math.ceil(L / step);
      for (let k = 1; k <= n; k++) pts.push(le + dx * k / n, ls + dz * k / n);
    }
    le = e; ls = s;
  }
  return pts;
}

// One or more strips along a line. strips = [[o1, o2, colour], ...], where o1
// and o2 are sideways offsets from the centreline (mercator metres, + = left).
// A road is one strip [+half, -half]; a railway is two narrow ones.
function ribbon(pts, strips, lift, hAt, mb) {
  const m = pts.length / 2;
  if (m < 2) return;
  // Segment unit normals.
  const nx = new Float64Array(m - 1), nz = new Float64Array(m - 1);
  for (let k = 0; k < m - 1; k++) {
    const dx = pts[2 * k + 2] - pts[2 * k], dz = pts[2 * k + 3] - pts[2 * k + 1];
    const L = Math.hypot(dx, dz) || 1;
    nx[k] = -dz / L; nz[k] = dx / L;
  }
  // Mitre: average the neighbouring segment normals and lengthen the offset so
  // the ribbon keeps its width round a bend. Clamped so a hairpin cannot spike.
  const ax = new Float64Array(m), az = new Float64Array(m), dd = new Float64Array(m);
  for (let k = 0; k < m; k++) {
    let x, z, ref;
    if (k === 0) { x = nx[0]; z = nz[0]; ref = 0; }
    else if (k === m - 1) { x = nx[m - 2]; z = nz[m - 2]; ref = m - 2; }
    else {
      x = nx[k - 1] + nx[k]; z = nz[k - 1] + nz[k]; ref = k;
      const L = Math.hypot(x, z);
      if (L < 1e-6) { x = nx[k]; z = nz[k]; }
      else { x /= L; z /= L; }
    }
    ax[k] = x; az[k] = z; dd[k] = Math.max(0.5, x * nx[ref] + z * nz[ref]);
  }
  for (const [o1, o2, colour] of strips) {
    const base = mb.verts;
    for (let k = 0; k < m; k++) {
      const e = pts[2 * k], s = pts[2 * k + 1];
      const p1 = o1 / dd[k], p2 = o2 / dd[k];
      const e1 = e + ax[k] * p1, s1 = s + az[k] * p1;
      const e2 = e + ax[k] * p2, s2 = s + az[k] * p2;
      mb.vert(e1, hAt(e1, s1) + lift, s1, colour);
      mb.vert(e2, hAt(e2, s2) + lift, s2, colour);
    }
    for (let k = 0; k < m - 1; k++) {
      const a = base + 2 * k, b = a + 1, c = a + 2, d = a + 3;
      mb.tri(a, b, c);
      mb.tri(b, d, c);
    }
  }
}

// Clip a convex polygon (flat [x, y, ...]) to the side where f(x, y) <= 0.
// f must be linear, so the crossing point is found by interpolation.
function clipHalf(pts, f) {
  const out = [];
  const n = pts.length / 2;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * j], by = pts[2 * j + 1];
    const fa = f(ax, ay), fb = f(bx, by);
    if (fa <= 0) out.push(ax, ay);
    if ((fa <= 0) !== (fb <= 0)) { const t = fa / (fa - fb); out.push(ax + (bx - ax) * t, ay + (by - ay) * t); }
  }
  return out.length >= 6 ? out : [];
}

// Lay one flat triangle on the terrain. It is cut along the terrain's own grid
// lines and cell diagonals, so every piece lies on one terrain triangle and
// neither floats nor sinks on a slope. Points are in local metres.
function drapeTri(t, g, hAt, lift, colour, mb) {
  const cell = g.size12 / GRID;
  // Grid units: whole numbers are terrain grid lines (see nodeHeightAt).
  const U = (e) => (e + g.bx) / cell, V = (s) => (g.by + s) / cell;
  const us = [U(t[0]), U(t[2]), U(t[4])], vs = [V(t[1]), V(t[3]), V(t[5])];
  const i0 = Math.floor(Math.min(...us)), i1 = Math.floor(Math.max(...us));
  const j0 = Math.floor(Math.min(...vs)), j1 = Math.floor(Math.max(...vs));
  const tri = [us[0], vs[0], us[1], vs[1], us[2], vs[2]];
  for (let j = j0; j <= j1; j++) {
    for (let i = i0; i <= i1; i++) {
      let p = clipHalf(tri, (u) => i - u);
      if (p.length) p = clipHalf(p, (u) => u - (i + 1));
      if (p.length) p = clipHalf(p, (u, v) => j - v);
      if (p.length) p = clipHalf(p, (u, v) => v - (j + 1));
      if (!p.length) continue;
      // The terrain splits each cell along u + v = 1 (cell-local).
      for (const half of [clipHalf(p, (u, v) => (u - i) + (v - j) - 1), clipHalf(p, (u, v) => 1 - (u - i) - (v - j))]) {
        if (!half.length) continue;
        const base = mb.verts;
        for (let k = 0; k < half.length; k += 2) {
          const e = half[k] * cell - g.bx, s = half[k + 1] * cell - g.by;
          mb.vert(e, hAt(e, s) + lift, s, colour);
        }
        for (let k = 1; k < half.length / 2 - 1; k++) mb.tri(base, base + k, base + k + 1);
      }
    }
  }
}

// An airport area (polygon feature), clipped to the tile and laid on the ground.
function drapePolygon(f, ext, g, hAt, lift, colour, mb) {
  for (const poly of polygons(f.parts)) {
    const rings = [];
    for (let k = 0; k < poly.length; k++) {
      const c = clip(poly[k], ext);
      if (c.length < 6) { if (k === 0) { rings.length = 0; break; } continue; }
      const m = new Float64Array(c.length);
      for (let i = 0; i < c.length; i += 2) {
        m[i] = (c[i] / ext - 0.5) * g.size14;
        m[i + 1] = (c[i + 1] / ext - 0.5) * g.size14;
      }
      rings.push(m);
    }
    if (!rings.length) continue;
    const flat = [];
    for (const r of rings) for (let i = 0; i < r.length; i++) flat.push(r[i]);
    const t = triangulate(rings);
    for (let i = 0; i < t.tris.length; i += 3) {
      const a = t.src[t.tris[i]], b = t.src[t.tris[i + 1]], c = t.src[t.tris[i + 2]];
      drapeTri([flat[2 * a], flat[2 * a + 1], flat[2 * b], flat[2 * b + 1], flat[2 * c], flat[2 * c + 1]],
        g, hAt, lift, colour, mb);
    }
  }
}

// g = { size14, size12, bx, by, cosLat, nodes }
//   bx, by : offset from the near tile centre to the elevation tile NW corner,
//            in mercator metres, so local (east, south) maps to tile (u, v).
// aero : the tile's aeroway layer (optional).
// counts (optional) gets { rail, aeroAreas, aeroLines } for the K report.
export function buildRoads(layer, g, mb, aero = null, counts = null) {
  if (!layer && !aero) return [0, 0, 0];
  const step = g.size12 / GRID / 3;       // a third of a terrain cell
  const hAt = (e, s) =>
    nodeHeightAt(g.nodes, (e + g.bx) / g.size12, (g.by + s) / g.size12);
  const cnt = counts || {};
  cnt.rail = 0; cnt.aeroAreas = 0; cnt.aeroLines = 0;

  // Emitted in three passes, biggest roads first, so the index buffer reads
  // motorways and trunks, then primary and secondary, then everything else.
  // Drawing only the first part of it is how far-away tiles show major roads
  // alone. Returns where each pass ends, in indices.
  const passes = [(rank) => rank >= 5, (rank) => rank >= 3 && rank < 5, (rank) => rank < 3];
  const ends = [];
  for (const keep of passes) {
  if (aero) {
    const ext = aero.extent;
    for (const f of aero.features) {
      const st = AERO_STYLE[f.cls];
      if (!st || !keep(st.r)) continue;
      const colour = rgba(st.c[0], st.c[1], st.c[2]);
      if (f.type === POLYGON) { drapePolygon(f, ext, g, hAt, st.lift, colour, mb); cnt.aeroAreas++; }
      else if (f.type === LINESTRING && st.w) {
        const half = (st.w / g.cosLat) / 2;
        for (const part of f.parts) {
          if (part.length < 4) continue;
          ribbon(linePoints(part, ext, g.size14, step), [[half, -half, colour]], st.lift, hAt, mb);
        }
        cnt.aeroLines++;
      }
    }
  }
  if (layer) {
  const ext = layer.extent;
  for (const f of layer.features) {
    if (f.type !== LINESTRING) continue;
    const p = f.props || {};
    if (p.brunnel === 'tunnel') continue;
    const rs = ROAD_STYLE[f.cls] ? null : railStyle(f);
    if (rs) {
      if (!keep(rs.r)) continue;
      const half = (rs.w / g.cosLat) / 2, line = rs.line / g.cosLat;
      const colour = rgba(RAIL_C[0], RAIL_C[1], RAIL_C[2]);
      const strips = [[half, half - line, colour], [-half + line, -half, colour]];
      for (const part of f.parts) {
        if (part.length < 4) continue;
        ribbon(linePoints(part, ext, g.size14, step), strips, LIFT + RAIL_LIFT_RANK * LIFT_STEP, hAt, mb);
      }
      cnt.rail++;
      continue;
    }
    const st = ROAD_STYLE[f.cls];
    if (!st || !keep(st.r)) continue;
    const oneway = p.oneway === 1 || p.oneway === -1 || p.oneway === true;
    const half = (st.w[oneway ? 1 : 0] / g.cosLat) / 2;   // mercator metres
    const lift = LIFT + st.r * LIFT_STEP;
    const colour = rgba(st.c[0], st.c[1], st.c[2]);
    for (const part of f.parts) {
      if (part.length < 4) continue;
      ribbon(linePoints(part, ext, g.size14, step), [[half, -half, colour]], lift, hAt, mb);
    }
  }
  }
  ends.push(mb.idx.length);
  }
  return ends;
}
