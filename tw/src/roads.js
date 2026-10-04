// Turns road centrelines into flat ribbons draped on the terrain mesh.
//
// The vector tiles carry no lane count or width, so width comes from road class
// (two-way, one-way). One-way matters most on motorways and trunk roads, where
// OSM maps each carriageway as its own line.

import { LINESTRING } from './mvt.js';
import { nodeHeightAt, GRID } from './heightgrid.js';
import { rgba } from './meshbuilder.js';

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

// Per-class lift above the terrain (metres). Tiny, but each class gets its own
// so crossing roads of different colour never share a depth value.
const LIFT = 0.12;
const LIFT_STEP = 0.02;

// g = { size14, size12, bx, by, cosLat, nodes }
//   bx, by : offset from the near tile centre to the elevation tile NW corner,
//            in mercator metres, so local (east, south) maps to tile (u, v).
export function buildRoads(layer, g, mb) {
  if (!layer) return [0, 0, 0];
  const ext = layer.extent;
  const step = g.size12 / GRID / 3;       // a third of a terrain cell
  const hAt = (e, s) =>
    nodeHeightAt(g.nodes, (e + g.bx) / g.size12, (g.by + s) / g.size12);

  // Emitted in three passes, biggest roads first, so the index buffer reads
  // motorways and trunks, then primary and secondary, then everything else.
  // Drawing only the first part of it is how far-away tiles show major roads
  // alone. Returns where each pass ends, in indices.
  const passes = [(rank) => rank >= 5, (rank) => rank >= 3 && rank < 5, (rank) => rank < 3];
  const ends = [];
  for (const keep of passes) {
  for (const f of layer.features) {
    if (f.type !== LINESTRING) continue;
    const st = ROAD_STYLE[f.cls];
    if (!st || !keep(st.r)) continue;
    const p = f.props || {};
    if (p.brunnel === 'tunnel') continue;
    const oneway = p.oneway === 1 || p.oneway === -1 || p.oneway === true;
    const half = (st.w[oneway ? 1 : 0] / g.cosLat) / 2;   // mercator metres
    const lift = LIFT + st.r * LIFT_STEP;
    const colour = rgba(st.c[0], st.c[1], st.c[2]);

    for (const part of f.parts) {
      if (part.length < 4) continue;
      // Convert to local metres and subdivide, so the ribbon follows the
      // terrain triangles closely instead of cutting across them.
      const pts = [];
      let le = 0, ls = 0;
      for (let i = 0; i < part.length; i += 2) {
        const e = (part[i] / ext - 0.5) * g.size14;
        const s = (part[i + 1] / ext - 0.5) * g.size14;
        if (i === 0) { pts.push(e, s); }
        else {
          const dx = e - le, dz = s - ls, L = Math.hypot(dx, dz);
          if (L < 1e-3) continue;
          const n = Math.ceil(L / step);
          for (let k = 1; k <= n; k++) pts.push(le + dx * k / n, ls + dz * k / n);
        }
        le = e; ls = s;
      }
      const m = pts.length / 2;
      if (m < 2) continue;

      // Segment unit normals.
      const nx = new Float64Array(m - 1), nz = new Float64Array(m - 1);
      for (let k = 0; k < m - 1; k++) {
        const dx = pts[2 * k + 2] - pts[2 * k], dz = pts[2 * k + 3] - pts[2 * k + 1];
        const L = Math.hypot(dx, dz) || 1;
        nx[k] = -dz / L; nz[k] = dx / L;
      }

      const base = mb.verts;
      for (let k = 0; k < m; k++) {
        // Mitre: average the neighbouring segment normals and lengthen the
        // offset so the ribbon keeps its width round a bend. Clamped so a
        // hairpin cannot spike.
        let ax, az, ref;
        if (k === 0) { ax = nx[0]; az = nz[0]; ref = 0; }
        else if (k === m - 1) { ax = nx[m - 2]; az = nz[m - 2]; ref = m - 2; }
        else {
          ax = nx[k - 1] + nx[k]; az = nz[k - 1] + nz[k]; ref = k;
          const L = Math.hypot(ax, az);
          if (L < 1e-6) { ax = nx[k]; az = nz[k]; }
          else { ax /= L; az /= L; }
        }
        const d = Math.max(0.5, ax * nx[ref] + az * nz[ref]);
        const off = half / d;
        const e = pts[2 * k], s = pts[2 * k + 1];
        const le2 = e + ax * off, ls2 = s + az * off;
        const re2 = e - ax * off, rs2 = s - az * off;
        mb.vert(le2, hAt(le2, ls2) + lift, ls2, colour);
        mb.vert(re2, hAt(re2, rs2) + lift, rs2, colour);
      }
      for (let k = 0; k < m - 1; k++) {
        const a = base + 2 * k, b = a + 1, c = a + 2, d = a + 3;
        mb.tri(a, b, c);
        mb.tri(b, d, c);
      }
    }
  }
  ends.push(mb.idx.length);
  }
  return ends;
}
