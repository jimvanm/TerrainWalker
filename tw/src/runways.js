// Runway markings: edge lines, centre-line dashes, threshold stripes and the
// runway numbers (with L, C or R for parallel runways), painted white on the
// pavement and laid on the ground like the pavement itself.
//
// Sizes follow the usual international layout, rounded:
//   threshold stripes 30 m long, 1.8 m wide, starting 6 m in from the end
//   letter, then number: 18 m tall, 6 m wide per character
//   centre line: 36 m dashes, 24 m gaps, 0.9 m wide
//   edge lines: 0.9 m wide, 1 m in from each side
//
// A runway is usually cut across several map tiles. Each tile draws only its own
// part. Numbers and stripes go only at a true end of the runway: an end that is
// cut by the tile edge is not one. Centre-line dashes are spaced from a fixed
// point on the map, so the pattern lines up across tile edges.

import { POLYGON, LINESTRING } from './mvt.js';
import { polygons } from './buildings.js';
import { rgba } from './meshbuilder.js';
import { drapeConvex, drapePolygon } from './drape.js';

const WHITE = rgba(226, 226, 222);
// Airport pavement grey: the same grey the distant ground paint uses (gl.js,
// 0.37 0.37 0.39), so near and far match. roads.js uses it for taxiways and
// aprons too.
export const PAVE = [94, 94, 99];
const PAVE_C = rgba(PAVE[0], PAVE[1], PAVE[2]);
const PAVE_LIFT = 0.32;       // metres: above every road (0.24) and rail (0.28)
const LIFT = 0.35;            // paint, just above the pavement
// Runway width. A runway mapped as an area often includes its paved shoulders
// or safety strip: JFK's 46 m 13L/31R measured 105 m. A measured width is only
// believed up to this; past it the standard width is used.
const MAX_W = 65;
const LINE_W = 45;            // true metres: width of a runway mapped only as a line
const EDGE_IN = 8;            // tile units: an end farther outside the tile than this was cut by the tile edge

// Strokes on a 3 wide x 5 tall grid, (0, 0) bottom left.
const H = 2.5;
const GLYPHS = {
  0: [[0, 0, 3, 0], [3, 0, 3, 5], [3, 5, 0, 5], [0, 5, 0, 0]],
  1: [[1.5, 0, 1.5, 5]],
  2: [[0, 5, 3, 5], [3, 5, 3, H], [3, H, 0, H], [0, H, 0, 0], [0, 0, 3, 0]],
  3: [[0, 5, 3, 5], [3, 5, 3, 0], [3, 0, 0, 0], [0, H, 3, H]],
  4: [[0, 5, 0, H], [0, H, 3, H], [3, 5, 3, 0]],
  5: [[3, 5, 0, 5], [0, 5, 0, H], [0, H, 3, H], [3, H, 3, 0], [3, 0, 0, 0]],
  6: [[3, 5, 0, 5], [0, 5, 0, 0], [0, 0, 3, 0], [3, 0, 3, H], [3, H, 0, H]],
  7: [[0, 5, 3, 5], [3, 5, 3, 0]],
  8: [[0, 0, 3, 0], [3, 0, 3, 5], [3, 5, 0, 5], [0, 5, 0, 0], [0, H, 3, H]],
  9: [[3, H, 0, H], [0, H, 0, 5], [0, 5, 3, 5], [3, 5, 3, 0], [3, 0, 0, 0]],
  L: [[0, 5, 0, 0], [0, 0, 3, 0]],
  C: [[3, 5, 0, 5], [0, 5, 0, 0], [0, 0, 3, 0]],
  R: [[0, 0, 0, 5], [0, 5, 3, 5], [3, 5, 3, H], [3, H, 0, H], [0, H, 3, 0]],
};

// Smallest rectangle around a set of points (flat [e, s, ...]), trying each
// edge's direction. u runs along the long side.
export function fitRect(pts) {
  const n = pts.length / 2;
  let best = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    const dx = pts[2 * j] - pts[2 * i], dy = pts[2 * j + 1] - pts[2 * i + 1];
    const L = Math.hypot(dx, dy);
    if (L < 1e-6) continue;
    const ux = dx / L, uy = dy / L;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const a = pts[2 * k] * ux + pts[2 * k + 1] * uy, b = -pts[2 * k] * uy + pts[2 * k + 1] * ux;
      if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b;
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) best = { area, ux, uy, a0, a1, b0, b1 };
  }
  if (!best) return null;
  let { ux, uy, a0, a1, b0, b1 } = best;
  const ca = (a0 + a1) / 2, cb = (b0 + b1) / 2;
  const c = [ca * ux - cb * uy, ca * uy + cb * ux];
  let len = a1 - a0, w = b1 - b0;
  if (w > len) { [len, w] = [w, len]; [ux, uy] = [-uy, ux]; }
  return { c, u: [ux, uy], len, w };
}

// Same runway seen from either end gives the same direction, so the dash
// pattern lines up between tiles.
function canonical(u) {
  return (u[0] > 1e-9 || (Math.abs(u[0]) <= 1e-9 && u[1] > 0)) ? u : [-u[0], -u[1]];
}

// "06L/24R" -> [{ n: 6, s: '06', letter: 'L' }, ...]. Unreadable parts are dropped.
export function parseRef(ref) {
  if (typeof ref !== 'string') return [];
  const out = [];
  for (const part of ref.split('/')) {
    const m = /^\s*(\d{1,2})\s*([LCR]?)\s*$/i.exec(part);
    if (m && +m[1] >= 1 && +m[1] <= 36) out.push({ n: +m[1], s: m[1].padStart(2, '0'), letter: m[2].toUpperCase() });
  }
  return out;
}

// Which number belongs at the end where aircraft travel along bearing b
// (degrees true): the closer one. Numbers are magnetic, but the two numbers of
// a runway are 180 degrees apart, so the closer one is always right.
export function numberFor(parts, b) {
  let best = null, bd = 999;
  for (const p of parts) {
    let d = Math.abs(((p.n * 10 - b) % 360 + 540) % 360 - 180);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

// Runway centre lines as end points, with pieces that meet end to end joined.
// The map often splits one runway's line into several pieces (some only 15 m
// long) inside one tile; drawn one by one, every split point looked like a
// runway end and got its own stripes and number. Pieces join when an end of one
// is within 2 tile units of an end of the other and their numbers agree (or
// one has none).
export function joinRunwayLines(features) {
  const segs = [];
  for (const f of features) {
    if (f.cls !== 'runway' || f.type !== LINESTRING) continue;
    const ref = (f.props && f.props.ref) || null;
    for (const part of f.parts) {
      const n = part.length;
      if (n < 4) continue;
      segs.push({ a: [part[0], part[1]], b: [part[n - 2], part[n - 1]], ref, pieces: 1 });
    }
  }
  const close = (p, q) => Math.abs(p[0] - q[0]) <= 2 && Math.abs(p[1] - q[1]) <= 2;
  for (let joined = true; joined;) {
    joined = false;
    outer:
    for (let i = 0; i < segs.length; i++) {
      for (let j = i + 1; j < segs.length; j++) {
        const A = segs[i], B = segs[j];
        if (A.ref && B.ref && A.ref !== B.ref) continue;
        let ends = null;
        if (close(A.b, B.a)) ends = [A.a, B.b];
        else if (close(A.b, B.b)) ends = [A.a, B.a];
        else if (close(A.a, B.b)) ends = [B.a, A.b];
        else if (close(A.a, B.a)) ends = [A.b, B.b];
        if (!ends) continue;
        segs[i] = { a: ends[0], b: ends[1], ref: A.ref || B.ref, pieces: A.pieces + B.pieces };
        segs.splice(j, 1);
        joined = true;
        break outer;
      }
    }
  }
  return segs;
}

// aero: the aeroway layer. counts (optional) gets runways and numbers drawn.
export function runwayMarkings(aero, g, hAt, mb, counts = {}) {
  counts.runways = 0; counts.runwayNumbers = 0;
  if (!aero) return;
  // For the K report: every runway feature as the map gave it (tile units),
  // the coordinate range of the whole layer (shows how far tiles reach past
  // their edge), and what was drawn from each.
  const dbg = { extent: aero.extent, bounds: [Infinity, Infinity, -Infinity, -Infinity], raw: [], drawn: [] };
  for (const f of aero.features) {
    for (const part of f.parts) for (let i = 0; i < part.length; i += 2) {
      if (part[i] < dbg.bounds[0]) dbg.bounds[0] = part[i]; if (part[i] > dbg.bounds[2]) dbg.bounds[2] = part[i];
      if (part[i + 1] < dbg.bounds[1]) dbg.bounds[1] = part[i + 1]; if (part[i + 1] > dbg.bounds[3]) dbg.bounds[3] = part[i + 1];
    }
    if (f.cls === 'runway') dbg.raw.push({ type: f.type === POLYGON ? 'area' : f.type === LINESTRING ? 'line' : f.type,
      props: f.props || {}, parts: f.parts.map((p) => Array.from(p, Math.round)) });
  }
  if (dbg.raw.length) counts.runwayDebug = dbg;
  const E = aero.extent, k = g.size14 / E, half = g.size14 / 2, m = 1 / g.cosLat;
  const local = (x, y) => [x * k - half, y * k - half];
  const inside = (x, y) => x > -EDGE_IN && x < E + EDGE_IN && y > -EDGE_IN && y < E + EDGE_IN;

  // 1. Runways from areas, then from centre lines. Where a runway has both, the
  //    line wins (it is the runway's true middle) and the area only lends its
  //    width, if believable.
  const rws = [];
  for (const f of aero.features) {
    if (f.cls !== 'runway' || f.type !== POLYGON) continue;
    for (const poly of polygons(f.parts)) {
      const raw = poly[0], pts = [];
      for (let i = 0; i < raw.length; i += 2) pts.push(...local(raw[i], raw[i + 1]));
      const r = fitRect(pts);
      if (!r) continue;
      r.poly = poly;
      r.short = r.len < 3 * r.w;        // too stubby to read a direction from
      r.u = canonical(r.u);
      // An end is true when every outline point near it lies within the tile.
      r.real = [-1, 1].map((sg) => {
        for (let i = 0; i < raw.length; i += 2) {
          const t = (pts[i] - r.c[0]) * r.u[0] + (pts[i + 1] - r.c[1]) * r.u[1];
          if (Math.abs(t - sg * r.len / 2) < r.w && !inside(raw[i], raw[i + 1])) return false;
        }
        return true;
      });
      r.ref = f.props && f.props.ref;
      r.src = 'area';
      rws.push(r);
    }
  }
  const nPoly = rws.length;
  for (const seg of joinRunwayLines(aero.features)) {
    {
      const A = local(seg.a[0], seg.a[1]), B = local(seg.b[0], seg.b[1]);
      const dx = B[0] - A[0], dy = B[1] - A[1], len = Math.hypot(dx, dy);
      if (len < 1) continue;
      const c = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
      const ref = seg.ref;
      // Already drawn from an area? Then only lend it the line's number.
      const host = rws.slice(0, nPoly).find((r) => {
        const t = (c[0] - r.c[0]) * r.u[0] + (c[1] - r.c[1]) * r.u[1];
        const s = -(c[0] - r.c[0]) * r.u[1] + (c[1] - r.c[1]) * r.u[0];
        return Math.abs(t) < r.len / 2 + r.w && Math.abs(s) < r.w;
      });
      let w = LINE_W * m, src = seg.pieces > 1 ? 'line (' + seg.pieces + ' pieces joined)' : 'line';
      if (host) {
        host.absorbed = true;
        if (host.w * g.cosLat <= MAX_W) { w = host.w; src += ', width from area'; }
      }
      let u = [dx / len, dy / len], real = [inside(seg.a[0], seg.a[1]), inside(seg.b[0], seg.b[1])];
      const cu = canonical(u);
      if (cu[0] !== u[0]) real = [real[1], real[0]];
      rws.push({ c, u: cu, len, w, real, ref: ref || (host && host.ref), src });
    }
  }

  // Areas with no centre line stand on their own, at a believable width.
  // A stubby piece (a corner of a runway cut by the tile) cannot give a
  // direction, so it is laid as mapped and gets no paint.
  const keep = [];
  for (const r of rws) {
    if (r.src !== 'area') { keep.push(r); continue; }
    if (r.absorbed) continue;
    if (r.short) { drapePolygon({ parts: r.poly.flatMap((ring) => [ring.concat(ring.slice(0, 2))]) }, E, g, hAt, PAVE_LIFT, PAVE_C, mb); continue; }
    if (r.w * g.cosLat > MAX_W) { r.w = LINE_W * m; r.src = 'area, width capped'; }
    keep.push(r);
  }
  rws.length = 0; rws.push(...keep);

  // 2. Pave and paint each one.
  for (const r of rws) {
    counts.runways++;
    const [ux, uy] = r.u, nx = -uy, ny = ux;          // n: to the right of u
    const W = r.w * g.cosLat;                         // true width
    const P = (t, s) => [r.c[0] + ux * t + nx * s, r.c[1] + uy * t + ny * s];
    // A rectangle from along-distance t0..t1, sideways s0..s1 (mercator metres).
    const box = (t0, t1, s0, s1) => {
      const a = P(t0, s0), b = P(t1, s0), c = P(t1, s1), d = P(t0, s1);
      drapeConvex([a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]], g, hAt, LIFT, WHITE, mb);
    };
    const L2 = r.len / 2;

    // Pavement: a strip of the runway's width, laid on the ground.
    {
      const a = P(-L2, -r.w / 2), b = P(L2, -r.w / 2), c = P(L2, r.w / 2), d = P(-L2, r.w / 2);
      drapeConvex([a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]], g, hAt, PAVE_LIFT, PAVE_C, mb);
    }

    // Edge lines.
    const eo = (W / 2 - 1) * m, ew = 0.45 * m;
    box(-L2, L2, eo - ew, eo + ew);
    box(-L2, L2, -eo - ew, -eo + ew);

    // Centre line, kept clear of the markings at a true end.
    const clear = 102 * m;
    const t0 = -L2 + (r.real[0] ? clear : 0), t1 = L2 - (r.real[1] ? clear : 0);
    const period = 60 * m, dash = 36 * m, cw = 0.45 * m;
    const base = (r.c[0] + (g.cx || 0)) * ux + (r.c[1] - (g.cy || 0)) * uy;   // world position along the runway
    for (let q = Math.floor((base + t0) / period); q * period - base < t1; q++) {
      const a = Math.max(t0, q * period - base), b = Math.min(t1, q * period - base + dash);
      if (b > a) box(a, b, -cw, cw);
    }

    // Each true end: stripes, then letter, then number.
    const parts = parseRef(r.ref);
    const rec = { src: r.src, ref: r.ref || null, lenM: Math.round(r.len * g.cosLat), widthM: Math.round(W),
      bearing: Math.round((Math.atan2(ux, -uy) * 180 / Math.PI + 360) % 360), realEnds: r.real.slice(), numbers: [] };
    if (counts.runwayDebug) counts.runwayDebug.drawn.push(rec);
    for (const end of [0, 1]) {
      if (!r.real[end]) continue;
      const sg = end === 0 ? 1 : -1;                    // direction of travel along u, landing at this end
      const tEnd = end === 0 ? -L2 : L2;
      const at = (d) => tEnd + sg * d * m;              // along-position d true metres in from this end
      // Stripes: as many as fit, in pairs either side of the middle.
      let ns = W >= 55 ? 8 : W >= 40 ? 6 : W >= 28 ? 4 : W >= 22 ? 3 : 2;
      while (ns > 1 && 2.7 + (ns - 1) * 3.6 + 0.9 > W / 2 - 1.5) ns--;
      for (let i = 0; i < ns; i++) {
        const o = 2.7 + i * 3.6;
        for (const side of [-1, 1]) box(at(6), at(36), (side * o - 0.9) * m, (side * o + 0.9) * m);
      }
      // Bearing of travel, degrees true (local s points south).
      const dirE = ux * sg, dirS = uy * sg;
      const bearing = (Math.atan2(dirE, -dirS) * 180 / Math.PI + 360) % 360;
      const num = numberFor(parts, bearing);
      if (!num) continue;
      counts.runwayNumbers++;
      rec.numbers.push((end === 0 ? 'west/north end: ' : 'east/south end: ') + num.s + num.letter);
      const sc = W < 30 ? 0.6 : 1;                      // narrow runways get smaller numbers
      const write = (text, d) => {
        const cw2 = 2 * sc, ch = 3.6 * sc, gap = 3 * sc, st = 1.6 * sc;   // metres per grid unit, gap, stroke
        const total = text.length * 3 * cw2 + (text.length - 1) * gap;
        // Glyph x runs to the pilot's right, y along the direction of travel.
        const right = [-dirS, dirE], up = [dirE, dirS];
        const o = P(at(d), 0);
        const G = (x, y) => [o[0] + (right[0] * (x - total / 2) + up[0] * y) * m, o[1] + (right[1] * (x - total / 2) + up[1] * y) * m];
        [...text].forEach((ch2, ci) => {
          const x0 = ci * (3 * cw2 + gap);
          for (const [ax, ay, bx, by] of GLYPHS[ch2] || []) {
            let x1 = x0 + ax * cw2, y1 = ay * ch, x2 = x0 + bx * cw2, y2 = by * ch;
            const L = Math.hypot(x2 - x1, y2 - y1) || 1, dx = (x2 - x1) / L, dy = (y2 - y1) / L, h = st / 2;
            x1 -= dx * h; y1 -= dy * h; x2 += dx * h; y2 += dy * h;      // square ends that overlap at corners
            const a = G(x1 - dy * h, y1 + dx * h), b = G(x2 - dy * h, y2 + dx * h);
            const c = G(x2 + dy * h, y2 - dx * h), d = G(x1 + dy * h, y1 - dx * h);
            drapeConvex([a[0], a[1], b[0], b[1], c[0], c[1], d[0], d[1]], g, hAt, LIFT, WHITE, mb);
          }
        });
      };
      let d = 48;
      if (num.letter) { write(num.letter, d); d += 24; }
      write(num.s, d);
    }
  }
}
