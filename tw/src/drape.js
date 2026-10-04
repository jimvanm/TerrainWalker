// Laying flat shapes on the terrain so they follow it exactly.
//
// A flat triangle is cut along the terrain's own grid lines and cell
// diagonals, so every piece lies on one terrain triangle and neither floats nor
// sinks on a slope. Used for airport areas and runway markings.

import { GRID } from './heightgrid.js';
import { triangulate } from './earclip.js';
import { clip, polygons } from './buildings.js';

// Clip a convex polygon (flat [x, y, ...]) to the side where f(x, y) <= 0.
// f must be linear, so the crossing point is found by interpolation.
export function clipHalf(pts, f) {
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
export function drapeTri(t, g, hAt, lift, colour, mb) {
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


// A convex shape (flat [e, s, ...] in local metres), cut to the tile square so
// neighbouring tiles never draw it twice, then laid on the ground.
export function drapeConvex(pts, g, hAt, lift, colour, mb) {
  const h = g.size14 / 2;
  let p = clipHalf(pts, (x) => -h - x);
  if (p.length) p = clipHalf(p, (x) => x - h);
  if (p.length) p = clipHalf(p, (x, y) => -h - y);
  if (p.length) p = clipHalf(p, (x, y) => y - h);
  if (!p.length) return;
  for (let k = 2; k < p.length / 2; k++) {
    drapeTri([p[0], p[1], p[2 * k - 2], p[2 * k - 1], p[2 * k], p[2 * k + 1]], g, hAt, lift, colour, mb);
  }
}

// An airport area (polygon feature), clipped to the tile and laid on the ground.
export function drapePolygon(f, ext, g, hAt, lift, colour, mb) {
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

