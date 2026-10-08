// Water as a flat surface, close to you (near field).
//
// From the air, water painted onto the ground looks fine. On foot it does
// not: the height data is coarse (one height every 10 to 30 m), so a river
// bank is a long ramp and painted water climbs it. Here each water area of a
// map tile becomes a flat surface at one level, with a short bank along its
// edge from the water up to the ground. The terrain shader cuts a hole in the
// ground wherever the map says water (uWaterRect), so the flat surface shows
// through with the map's own crisp shoreline.
//
// The level: the ground inside the area, low part (water in the height data
// is mostly flat at about the right level), or the shore when the area is too
// small to have ground points inside. An area whose heights spread a lot
// (rapids, a waterfall: Niagara) is not flattened: it is laid on the ground
// instead, white where steep, so it looks as the painted water did (the
// ground under it has its hole cut all the same).

import { POLYGON } from './mvt.js';
import { nodeHeightAt, GRID } from './heightgrid.js';
import { rgba } from './meshbuilder.js';
import { triangulate, signedArea } from './earclip.js';
import { clip, polygons } from './buildings.js';
import { drapeTri } from './drape.js';

export const WATER_COLOUR = [38, 79, 122];
export const BANK_COLOUR = [104, 94, 74];
export const FOAM_COLOUR = [222, 230, 236];

// Is this triangle steeper than about 25 degrees? Positions in local units,
// k true metres per unit.
function steep(t, hAt, k) {
  const h = [hAt(t[0], t[1]), hAt(t[2], t[3]), hAt(t[4], t[5])];
  const ux = (t[2] - t[0]) * k, uz = (t[3] - t[1]) * k, uy = h[1] - h[0];
  const vx = (t[4] - t[0]) * k, vz = (t[5] - t[1]) * k, vy = h[2] - h[0];
  const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
  const len = Math.hypot(nx, ny, nz);
  return len > 0 && Math.abs(ny) / len < 0.906;
}
export const MAX_SPREAD = 8;       // metres: more than this between low and high inside, and it is falling water
const BANK_DOWN = 0.4;             // banks start this far under the water, so no gap shows at a glancing angle

const pct = (a, p) => {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(p * (s.length - 1) + 0.5))];
};

// Ground heights at grid points inside a polygon (rings in local units), and
// at its edge corners, ignoring corners on the tile's border (those are in
// the water, where the tile was cut, not on a shore).
function samples(rings, hAt, cell, half) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) {
    if (r[i] < x0) x0 = r[i]; if (r[i] > x1) x1 = r[i];
    if (r[i + 1] < y0) y0 = r[i + 1]; if (r[i + 1] > y1) y1 = r[i + 1];
  }
  const inside = (px, py) => {
    let n = false;
    for (const r of rings) {
      const m = r.length / 2;
      for (let i = 0, j = m - 1; i < m; j = i++) {
        const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) n = !n;
      }
    }
    return n;
  };
  const inner = [];
  for (let y = Math.ceil(y0 / cell) * cell; y <= y1; y += cell) {
    for (let x = Math.ceil(x0 / cell) * cell; x <= x1; x += cell) if (inside(x, y)) inner.push([x, y, hAt(x, y)]);
  }
  const shore = [];
  const onBorder = (x, y) => Math.abs(Math.abs(x) - half) < 1e-6 || Math.abs(Math.abs(y) - half) < 1e-6;
  for (const r of rings) for (let i = 0; i < r.length; i += 2) if (!onBorder(r[i], r[i + 1])) shore.push(hAt(r[i], r[i + 1]));
  return { inner, shore };
}

// The level for one water area, or null when the water is falling.
// inner: [x, y, height] of ground points inside; shore: heights at the edge;
// patch: the size of a patch in the same units as x and y.
// Coarse ground has the banks' slope reaching well inside the outline, so the
// spread of all heights says nothing. Instead the area is cut into patches,
// and each patch's low ground (the water) is compared: banks do not move a
// patch's low point, a waterfall does.
export const PATCH = 250;          // metres
export function waterLevel(inner, shore, patch = PATCH) {
  if (inner.length >= 3) {
    const groups = new Map();
    for (const [x, y, h] of inner) {
      const k = Math.floor(x / patch) + ',' + Math.floor(y / patch);
      let a = groups.get(k); if (!a) groups.set(k, a = []); a.push(h);
    }
    const lows = [];
    for (const a of groups.values()) if (a.length >= 2 || groups.size === 1) lows.push(pct(a, 0.25));
    if (!lows.length) lows.push(pct(inner.map((q) => q[2]), 0.25));
    if (Math.max(...lows) - Math.min(...lows) > MAX_SPREAD) return null;
    return pct(lows, 0.5);
  }
  if (shore.length >= 3) {
    if (pct(shore, 0.8) - pct(shore, 0.2) > MAX_SPREAD) return null;
    return pct(shore, 0.2);
  }
  return null;
}

// layer: the tile's water layer. g: the tile's frame (as for roads and
// buildings). mb: a MeshBuilder for the surfaces and banks. Returns counts.
export function buildWater(layer, g, mb) {
  const stats = { areas: 0, flat: 0, left: 0, levels: [] };
  if (!layer) return stats;
  const E = layer.extent, half = g.size14 / 2;
  const hAt = g.hAt || ((e, s) => nodeHeightAt(g.nodes, (e + g.bx) / g.size12, (g.by + s) / g.size12));
  const cell = g.cell || g.size12 / GRID;
  const water = rgba(...WATER_COLOUR), bank = rgba(...BANK_COLOUR), foam = rgba(...FOAM_COLOUR);
  // An edge lying along the tile's border is where the tile cut the water, not a shore.
  const on = (v, w) => Math.abs(v - w) < 1e-6;
  const alongBorder = (ax, ay, bx, by) => (on(ax, bx) && on(Math.abs(ax), half)) || (on(ay, by) && on(Math.abs(ay), half));

  for (const f of layer.features) {
    if (f.type !== POLYGON) continue;
    for (const poly of polygons(f.parts)) {
      const rings = [];
      for (let k = 0; k < poly.length; k++) {
        const c = clip(poly[k], E);
        if (c.length < 6) { if (k === 0) break; continue; }
        const m = new Float64Array(c.length);
        for (let i = 0; i < c.length; i += 2) {
          m[i] = (c[i] / E - 0.5) * g.size14;
          m[i + 1] = (c[i + 1] / E - 0.5) * g.size14;
        }
        rings.push(m);
      }
      if (!rings.length || Math.abs(signedArea(rings[0])) < 1) continue;
      stats.areas++;
      const { inner, shore } = samples(rings, hAt, cell, half);
      const level = waterLevel(inner, shore, PATCH / g.cosLat);
      if (level === null) {
        // Falling water: lay it on the ground, cut along the ground's own grid
        // so it neither floats nor sinks. White where steep, as painted water was.
        stats.left++;
        const t = triangulate(rings), pts = [];
        for (const r of rings) for (let i = 0; i < r.length; i += 2) pts.push(r[i], r[i + 1]);
        for (let i = 0; i < t.tris.length; i += 3) {
          const tri = [];
          for (let k = 0; k < 3; k++) { const q = t.src[t.tris[i + k]]; tri.push(pts[2 * q], pts[2 * q + 1]); }
          drapeTri(tri, g, hAt, 0.05, steep(tri, hAt, g.cosLat) ? foam : water, mb);
        }
        continue;
      }
      stats.flat++;
      if (stats.levels.length < 8) stats.levels.push(Math.round(level * 10) / 10);

      // The surface.
      const base = mb.verts;
      for (const r of rings) for (let i = 0; i < r.length; i += 2) mb.vert(r[i], level, r[i + 1], water);
      const t = triangulate(rings);
      for (let i = 0; i < t.tris.length; i += 3) mb.tri(base + t.src[t.tris[i]], base + t.src[t.tris[i + 1]], base + t.src[t.tris[i + 2]]);

      // The bank: from under the water up to the ground, along every edge that
      // is a real shore (not where the tile cut the area).
      for (const r of rings) {
        const n = r.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ax = r[2 * i], ay = r[2 * i + 1], bx = r[2 * j], by = r[2 * j + 1];
          if (alongBorder(ax, ay, bx, by)) continue;
          const ha = hAt(ax, ay), hb = hAt(bx, by);
          if (ha <= level + 0.05 && hb <= level + 0.05) continue;
          const a0 = mb.vert(ax, level - BANK_DOWN, ay, bank), a1 = mb.vert(ax, Math.max(ha, level), ay, bank);
          const b0 = mb.vert(bx, level - BANK_DOWN, by, bank), b1 = mb.vert(bx, Math.max(hb, level), by, bank);
          mb.tri(a0, b0, a1); mb.tri(b0, b1, a1);
        }
      }
    }
  }
  return stats;
}
