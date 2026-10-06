// Turns road centrelines into flat ribbons draped on the terrain mesh. Also
// railways (two dark rails each) and airport runways, taxiways and aprons.
//
// The vector tiles carry no lane count or width, so width comes from road class
// (two-way, one-way). One-way matters most on motorways and trunk roads, where
// OSM maps each carriageway as its own line.

import { LINESTRING, POLYGON } from './mvt.js';
import { nodeHeightAt, GRID } from './heightgrid.js';
import { rgba } from './meshbuilder.js';
import { drapeConvex, drapePolygon } from './drape.js';
import { runwayMarkings, PAVE } from './runways.js';

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

// Railways, at true size. Each track is its own line in the map.
//   gauge : distance between the inner edges of the two rails, metres.
//           The map tiles carry no gauge, so standard (1.435 m) is used for
//           everything except lines the map calls narrow gauge (1.000 m, the
//           commonest narrow gauge). Toronto's subway and streetcars are really
//           1.495 m; that 6 cm is not visible.
//   RAIL_HEAD: width of the top of one rail, about 70 mm (UIC 60 is 72 mm,
//           North American 115 lb rail 68 mm).
//   bed   : width of the stone bed (ballast) under the track. It is what a
//           railway looks like from the air, and keeps it visible from far away
//           where the rails themselves are thinner than a pixel. 5 m is a bit
//           more than the 4.3 m between neighbouring tracks, so a corridor of
//           several tracks reads as one bed, not stripes. Streetcar track sits
//           in the road and has none.
// r = rank, which decides how far away it is drawn, the same as roads. Main
// lines show as far as primary roads; trams, sidings and yards as far as
// minor roads.
const STANDARD = 1.435, NARROW = 1.0, RAIL_HEAD = 0.07;
const RAIL_C = [150, 148, 144];        // worn steel tops, light against the bed
const BED_C = [58, 56, 54];            // charcoal stone
export const RAIL_STYLE = {
  main:    { gauge: STANDARD, bed: 5, r: 4 },
  minor:   { gauge: STANDARD, bed: 5, r: 1 },   // sidings, yards, spurs, heritage
  narrow:  { gauge: NARROW,   bed: 4, r: 1 },
  transit: { gauge: STANDARD, bed: 5, r: 1 },   // light rail, subway above ground, monorail
  tram:    { gauge: STANDARD, bed: 0,   r: 1 },
};
export { RAIL_HEAD };
const RAIL_LIFT_RANK = 7;                 // above every road, so level crossings show the rails

export function railStyle(f) {
  const p = f.props || {};
  if (f.cls === 'transit') return p.subclass === 'tram' ? RAIL_STYLE.tram : RAIL_STYLE.transit;
  if (f.cls !== 'rail') return null;
  if (p.subclass === 'narrow_gauge') return RAIL_STYLE.narrow;
  if (p.service || (p.subclass && p.subclass !== 'rail')) return RAIL_STYLE.minor;
  return RAIL_STYLE.main;
}

// Airports. Areas are laid flat on the ground; runways and taxiways mapped
// only as a line get a standard width (w, true metres). Runways show from as
// far as motorways, the rest as far as primary roads. The lift sits above every
// road and railway (roads reach 0.24 m, rails 0.28 m), so nothing mapped across
// the pavement shows through it.
// One pavement colour for all of it: the same grey the distant ground paint
// uses (gl.js, 0.37 0.37 0.39), so near and far match. White markings go on
// top (runways.js).
export const AERO_STYLE = {
  runway:  { c: PAVE, w: 45, lift: 0.32, r: 5 },
  taxiway: { c: PAVE, w: 20, lift: 0.32, r: 3 },
  apron:   { c: PAVE,        lift: 0.32, r: 3 },
  helipad: { c: PAVE,        lift: 0.32, r: 3 },
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
// drapeG (optional, the tile's g): lay each piece exactly on the terrain
// (drape.js) instead of setting heights at the strip's edges only. Needed for
// wide strips: across a 45 m runway the ground rises above a strip that is
// flat between its edges, and shows through it.
function ribbon(pts, strips, lift, hAt, mb, drapeG = null) {
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
    if (drapeG) {
      const P = (k, o) => [pts[2 * k] + ax[k] * o / dd[k], pts[2 * k + 1] + az[k] * o / dd[k]];
      for (let k = 0; k < m - 1; k++) {
        const a = P(k, o1), b = P(k + 1, o1), c = P(k + 1, o2), d = P(k, o2);
        drapeConvex([a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]], drapeG, hAt, lift, colour, mb);
      }
      continue;
    }
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

// g = { size14, size12, bx, by, cosLat, nodes }
//   Optional, for a ground that is not a terrain tile (a moved piece, city.js):
//   g.hAt(e, s) gives the ground height at local metres, and g.cell is the
//   ground grid's cell size in the same metres (with bx, by placing the grid
//   as before). Without them the terrain tile's own grid is used.
//   bx, by : offset from the near tile centre to the elevation tile NW corner,
//            in mercator metres, so local (east, south) maps to tile (u, v).
// aero : the tile's aeroway layer (optional).
// counts (optional) gets { rail, aeroAreas, aeroLines, runways, runwayNumbers } for the K report.
// g.cx, g.cy (optional): the tile centre in mercator metres, for runway dashes.
export function buildRoads(layer, g, mb, aero = null, counts = null) {
  if (!layer && !aero) return [0, 0, 0];
  const step = (g.cell || g.size12 / GRID) / 3;       // a third of a terrain cell
  const hAt = g.hAt || ((e, s) =>
    nodeHeightAt(g.nodes, (e + g.bx) / g.size12, (g.by + s) / g.size12));
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
      if (f.cls === 'runway') continue;      // runways.js draws runways, pavement and paint
      const st = AERO_STYLE[f.cls];
      if (!st || !keep(st.r)) continue;
      const colour = rgba(st.c[0], st.c[1], st.c[2]);
      if (f.type === POLYGON) { drapePolygon(f, ext, g, hAt, st.lift, colour, mb); cnt.aeroAreas++; }
      else if (f.type === LINESTRING && st.w) {
        const half = (st.w / g.cosLat) / 2;
        for (const part of f.parts) {
          if (part.length < 4) continue;
          ribbon(linePoints(part, ext, g.size14, 1e9), [[half, -half, colour]], st.lift, hAt, mb, g);
        }
        cnt.aeroLines++;
      }
    }
    if (keep(AERO_STYLE.runway.r)) runwayMarkings(aero, g, hAt, mb, cnt);
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
      // Rail centres sit half a gauge plus half a rail head from the middle.
      const k = 1 / g.cosLat, inner = rs.gauge / 2 * k, outer = (rs.gauge / 2 + RAIL_HEAD) * k;
      const steel = rgba(RAIL_C[0], RAIL_C[1], RAIL_C[2]), stone = rgba(BED_C[0], BED_C[1], BED_C[2]);
      const rails = [[outer, inner, steel], [-inner, -outer, steel]];
      const bed = rs.bed / 2 * k;
      const lift = LIFT + RAIL_LIFT_RANK * LIFT_STEP;
      for (const part of f.parts) {
        if (part.length < 4) continue;
        const pts = linePoints(part, ext, g.size14, step);
        if (bed) ribbon(pts, [[bed, -bed, stone]], lift, hAt, mb);
        ribbon(pts, rails, lift + LIFT_STEP, hAt, mb);
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
