// Turns building outlines into plain extruded boxes with flat roofs.
//
// The map data gives an outline and, for some buildings, a height. Everything
// else is guessed: unknown heights get 6 to 9 m. The final wall colour is picked
// in the shader (look.js), from facts stored here: the map's colour if a mapper
// entered one, a type taken from the land use under the building, and a number
// from the outline's position (so a street does not look cloned, and the same
// building gets the same colour every time).
//
// A budget keeps one dense tile from swamping the others: buildings are ranked
// by size and height, and the least important are dropped when the tile runs
// out of triangles.

import { POLYGON } from './mvt.js';
import { nodeHeightAt, GRID } from './heightgrid.js';
import { rgba, info, INFO_BUILDING, INFO_REAL, INFO_ROOF, INFO_MASKED } from './meshbuilder.js';
import { LANDUSE_TYPE, TALL, SIZE_LIMITS } from './look.js';
import { triangulate, signedArea } from './earclip.js';

const PALETTE = [
  [214, 208, 196], [204, 198, 190], [222, 216, 206], [196, 192, 188],
  [210, 200, 184], [190, 196, 200], [226, 222, 214], [200, 190, 178],
];
const SUNK = 0.5;          // walls start this far below the ground, so slopes never show a gap
const MIN_AREA = 12;       // m2: smaller than this is a shed, unless it is tall
export const BUILDING_TRIS = 90000;

const shade = (c, f) => rgba(Math.round(c[0] * f), Math.round(c[1] * f), Math.round(c[2] * f));

// The map's building colour: '#rrggbb' or '#rgb'. Anything else is ignored.
export function parseColour(v) {
  if (typeof v !== 'string') return null;
  let m = /^#?([0-9a-f]{6})$/i.exec(v.trim());
  if (m) { const n = parseInt(m[1], 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }
  m = /^#?([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(v.trim());
  if (m) return [m[1], m[2], m[3]].map((h) => parseInt(h + h, 16));
  return null;
}

// Land use areas that say what kind of building stands on them, ready for
// point tests. Coordinates stay in the land use layer's own tile units.
export function landuseAreas(layer) {
  if (!layer) return [];
  const out = [];
  for (const f of layer.features) {
    const type = LANDUSE_TYPE[f.cls];
    if (f.type !== POLYGON || !type) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const r of f.parts) for (let i = 0; i < r.length; i += 2) {
      if (r[i] < x0) x0 = r[i]; if (r[i] > x1) x1 = r[i];
      if (r[i + 1] < y0) y0 = r[i + 1]; if (r[i + 1] > y1) y1 = r[i + 1];
    }
    out.push({ type, parts: f.parts, x0, y0, x1, y1, box: (x1 - x0) * (y1 - y0), E: layer.extent });
  }
  // Smallest first, so a school inside a housing area counts as a school.
  out.sort((a, b) => a.box - b.box);
  return out;
}

// Type of the land use under a point (x, y in tile units of extent E). Even-odd
// over all rings, so holes work.
export function typeAt(areas, x, y, E) {
  for (const a of areas) {
    const px = x * a.E / E, py = y * a.E / E;
    if (px < a.x0 || px > a.x1 || py < a.y0 || py > a.y1) continue;
    let inside = false;
    for (const r of a.parts) {
      const n = r.length / 2;
      for (let i = 0, j = n - 1; i < n; j = i++) {
        const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
        if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
      }
    }
    if (inside) return a.type;
  }
  return 0;
}

// Sutherland-Hodgman against the tile square. Neighbouring tiles each carry a
// strip past their edge, so without this a building near a seam is drawn twice.
export function clip(r, E) {
  let pts = r;
  const sides = [
    [(x) => x >= 0, (ax, ay, bx, by) => [0, ay + (by - ay) * (0 - ax) / (bx - ax)]],
    [(x) => x <= E, (ax, ay, bx, by) => [E, ay + (by - ay) * (E - ax) / (bx - ax)]],
  ];
  for (let pass = 0; pass < 2; pass++) {            // pass 0 clips x, pass 1 clips y
    for (const [inside, cut] of sides) {
      if (pts.length < 6) return [];
      const out = [];
      const n = pts.length / 2;
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        let ax = pts[2 * i], ay = pts[2 * i + 1], bx = pts[2 * j], by = pts[2 * j + 1];
        if (pass === 1) { [ax, ay, bx, by] = [ay, ax, by, bx]; }   // work in swapped axes
        const ia = inside(ax), ib = inside(bx);
        const push = (u, v) => { if (pass === 1) out.push(v, u); else out.push(u, v); };
        if (ia && ib) push(bx, by);
        else if (ia && !ib) { const [cx, cy] = cut(ax, ay, bx, by); push(cx, cy); }
        else if (!ia && ib) { const [cx, cy] = cut(ax, ay, bx, by); push(cx, cy); push(bx, by); }
      }
      pts = out;
    }
  }
  return pts.length >= 6 ? pts : [];
}

// An MVT polygon feature is one flat list of rings. A ring that winds the same
// way as the first starts a new polygon; the opposite way is a hole in the
// current one.
export function polygons(parts) {
  const out = [];
  let sign = 0;
  for (const raw of parts) {
    const r = raw.slice(0, raw.length - 2);          // drop the closing repeat
    if (r.length < 6) continue;
    const a = signedArea(r);
    if (a === 0) continue;
    if (!sign) sign = Math.sign(a);
    if (Math.sign(a) === sign || !out.length) out.push([r]);
    else out[out.length - 1].push(r);
  }
  return out;
}

// Does this ring touch a circle? opt.mask circles are { x, y, r } in the same
// tile-local units as the rings. True when the circle's middle is inside the
// ring or any edge passes within r of it.
export function touchesCircle(ring, c) {
  const n = ring.length / 2;
  let inside = false;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const x1 = ring[2 * i], y1 = ring[2 * i + 1], x2 = ring[2 * j], y2 = ring[2 * j + 1];
    if ((y1 > c.y) !== (y2 > c.y) && c.x < ((x2 - x1) * (c.y - y1)) / (y2 - y1) + x1) inside = !inside;
    const dx = x2 - x1, dy = y2 - y1, L = dx * dx + dy * dy;
    const t = L ? Math.max(0, Math.min(1, ((c.x - x1) * dx + (c.y - y1) * dy) / L)) : 0;
    if (Math.hypot(c.x - (x1 + t * dx), c.y - (y1 + t * dy)) < c.r) return true;
  }
  return inside;
}

// Do two outlines touch: one inside the other, or any edges crossing? Both are
// flat [x, y, x, y, ...] rings in the same units.
export function touchesPolygon(a, b) {
  const inside = (r, x, y) => {
    let c = false;
    for (let i = 0, n = r.length / 2, j = n - 1; i < n; j = i++) {
      const xi = r[2 * i], yi = r[2 * i + 1], xj = r[2 * j], yj = r[2 * j + 1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
    }
    return c;
  };
  if (inside(b, a[0], a[1]) || inside(a, b[0], b[1])) return true;
  const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
  const na = a.length / 2, nb = b.length / 2;
  for (let i = 0; i < na; i++) {
    const p1x = a[2 * i], p1y = a[2 * i + 1], p2x = a[(2 * i + 2) % a.length], p2y = a[(2 * i + 3) % a.length];
    for (let j = 0; j < nb; j++) {
      const q1x = b[2 * j], q1y = b[2 * j + 1], q2x = b[(2 * j + 2) % b.length], q2y = b[(2 * j + 3) % b.length];
      const d1 = cross(q1x, q1y, q2x, q2y, p1x, p1y), d2 = cross(q1x, q1y, q2x, q2y, p2x, p2y);
      const d3 = cross(p1x, p1y, p2x, p2y, q1x, q1y), d4 = cross(p1x, p1y, p2x, p2y, q2x, q2y);
      if (((d1 > 0) !== (d2 > 0)) && ((d3 > 0) !== (d4 > 0))) return true;
    }
  }
  return false;
}

// A landmark's mask: its footprint outline when known, and its circle.
export const masks = (mask, ring) => mask.find((c) => touchesCircle(ring, c) || (c.poly && touchesPolygon(ring, c.poly)));

// For the K report: a map building near a landmark that the mask did NOT hide,
// in metres east and north of the landmark. Within 300 m only, 20 at most.
function recordNearMiss(stats, mask, ring, g, h) {
  let sx = 0, sy = 0;
  const n = ring.length / 2;
  for (let i = 0; i < n; i++) { sx += ring[2 * i]; sy += ring[2 * i + 1]; }
  sx /= n; sy /= n;
  for (const c of mask) {
    const east = (sx - c.x) * g.cosLat, north = -(sy - c.y) * g.cosLat;
    if (Math.hypot(east, north) > 300) continue;
    const list = stats.nearMisses || (stats.nearMisses = []);
    if (list.length < 20) {
      list.push({ id: c.id, east: Math.round(east), north: Math.round(north),
        m2: Math.round(Math.abs(signedArea(ring)) * g.cosLat * g.cosLat), h: h > 0 ? Math.round(h) : null });
    }
  }
}

// Keep the outline of a masked building so orient.js can read its heading. Points
// become true metres east and north of the landmark. Edges that run along the tile
// edge are cut by the tile, not by the building, so they are left out.
function recordOutline(stats, c, ring, g) {
  const half = g.size14 / 2, k = g.cosLat, eps = 0.01;
  const pt = (i) => [(ring[2 * i] - c.x) * k, -(ring[2 * i + 1] - c.y) * k];
  const onEdge = (i) => Math.abs(Math.abs(ring[2 * i]) - half) < eps || Math.abs(Math.abs(ring[2 * i + 1]) - half) < eps;
  const n = ring.length / 2, edges = [];
  let area = 0;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n, a = pt(i), b = pt(j);
    area += a[0] * b[1] - b[0] * a[1];
    const sameSide = onEdge(i) && onEdge(j) &&
      (Math.abs(Math.abs(ring[2 * i]) - half) < eps && Math.abs(Math.abs(ring[2 * j]) - half) < eps ||
       Math.abs(Math.abs(ring[2 * i + 1]) - half) < eps && Math.abs(Math.abs(ring[2 * j + 1]) - half) < eps);
    if (!sameSide) edges.push(Math.round(a[0] * 10) / 10, Math.round(a[1] * 10) / 10, Math.round(b[0] * 10) / 10, Math.round(b[1] * 10) / 10);
  }
  (stats.outlines || (stats.outlines = [])).push({ id: c.id, area: Math.round(Math.abs(area) / 2), edges });
}

// g = { size14, size12, bx, by, cosLat, nodes }, same as roads.
// opt.minHeight : skip anything not KNOWN to be at least this tall (skyline mode)
// opt.mask      : circles { x, y, r } (tile-local) where no building is drawn: landmark sites
// opt.sunk      : how far walls start below the ground, for coarse far terrain
// opt.landuse   : the tile's land use layer, used to give buildings a type
export function buildBuildings(layer, g, mb, maxTris = BUILDING_TRIS, opt = {}) {
  const sunk = opt.sunk === undefined ? SUNK : opt.sunk;
  // hist: how the data labels building heights, as a count per band:
  //   none | up to 5 m | 10 | 25 | 50 | 100 | taller. Tells us how much is guesswork.
  // real: buildings that carry a map colour. types: kept buildings per type.
  // sizes: kept buildings per size group (look.js SIZE_NAMES).
  const stats = { tall: [], kept: 0, dropped: 0, tris: 0, ends: [0, 0, 0], seen: 0, hist: [0, 0, 0, 0, 0, 0, 0],
                  real: 0, types: [0, 0, 0, 0, 0, 0, 0, 0], sizes: [0, 0, 0, 0] };
  if (!layer) return stats;
  const areas = landuseAreas(opt.landuse);
  const E = layer.extent;
  const hAt = (e, s) => nodeHeightAt(g.nodes, (e + g.bx) / g.size12, (g.by + s) / g.size12);
  const cand = [];

  for (const f of layer.features) {
    if (f.type !== POLYGON) continue;
    const p = f.props || {};
    if (p.hide_3d === true) continue;                // an outline whose parts are drawn separately
    let h = Number(p.render_height);
    {
      stats.seen++;
      const v = h > 0 ? h : 0;
      stats.hist[v === 0 ? 0 : v <= 5 ? 1 : v <= 10 ? 2 : v <= 25 ? 3 : v <= 50 ? 4 : v <= 100 ? 5 : 6]++;
    }
    const minh = Number(p.render_min_height) > 0 ? Number(p.render_min_height) : 0;
    const colour = parseColour(p.colour);
    for (const poly of polygons(f.parts)) {
      const rings = [];
      for (let k = 0; k < poly.length; k++) {
        const c = clip(poly[k], E);
        if (c.length < 6) { if (k === 0) { rings.length = 0; break; } continue; }
        const m = new Float64Array(c.length);
        for (let i = 0; i < c.length; i += 2) {
          m[i] = (c[i] / E - 0.5) * g.size14;
          m[i + 1] = (c[i + 1] / E - 0.5) * g.size14;
        }
        rings.push(m);
      }
      if (!rings.length) continue;
      // Under a landmark: recorded for orient.js, and built but flagged, so the
      // shader hides it unless the mask is switched off (key 4) for checking.
      const hit = opt.mask && masks(opt.mask, rings[0]);
      if (hit) {
        stats.masked = (stats.masked || 0) + 1;
        recordOutline(stats, hit, rings[0], g);
      } else if (opt.mask && opt.mask.length) recordNearMiss(stats, opt.mask, rings[0], g, h);
      let area = Math.abs(signedArea(rings[0]));
      for (let k = 1; k < rings.length; k++) area -= Math.abs(signedArea(rings[k]));
      area *= g.cosLat * g.cosLat;                   // m2 true
      const hash = (((Math.round(poly[0][0]) * 73856093) ^ (Math.round(poly[0][1]) * 19349663)) >>> 0);
      const known = h > 3;
      const height = known ? h : 6 + (hash % 4);
      if (opt.minHeight && !(known && height >= opt.minHeight)) continue;
      if (area < MIN_AREA && height < 20) continue;
      let nv = 0;
      for (const r of rings) nv += r.length / 2;
      // Tier 3 is the skyline, tier 2 the large and tall, tier 1 the rest.
      const tier = height >= 60 ? 3 : (height >= 25 || area >= 2500) ? 2 : 1;
      if (known) stats.tall.push([Math.round(h), Math.round(rings[0][0]), Math.round(rings[0][1]), Math.round(area)]);
      let type = known && height >= TALL ? 5 : 0;
      if (!type && areas.length) {
        const r0 = poly[0]; let sx = 0, sy = 0;
        for (let i = 0; i < r0.length; i += 2) { sx += r0[i]; sy += r0[i + 1]; }
        type = typeAt(areas, sx / (r0.length / 2), sy / (r0.length / 2), E);
      }
      cand.push({ rings, height, minh, area, hash, tier: hit ? 0 : tier, sunk, colour, type, masked: !!hit,
        tris: 3 * nv, rank: (height + 3) * Math.sqrt(Math.max(area, 1)) });
    }
  }

  // Skyline first, then large, then the rest; the most important first within
  // each. The budget drops from the end, and distant tiles draw only the start.
  cand.sort((a, b) => (b.tier - a.tier) || (b.rank - a.rank));
  let used = 0;
  for (const b of cand) {
    if (used + b.tris > maxTris) { stats.dropped++; continue; }
    used += b.tris;
    emit(b, mb, hAt);
    if (b.masked) { stats.ends[2] = mb.idx.length; continue; }   // hidden normally; last, after every tier
    stats.kept++;
    stats.types[b.type]++;
    stats.sizes[sizeGroup(b)]++;
    if (b.colour) stats.real++;
    if (b.tier === 3) stats.ends[0] = mb.idx.length;
    if (b.tier >= 2) stats.ends[1] = mb.idx.length;
    stats.ends[2] = mb.idx.length;
  }
  // A tier with nothing in it still ends where the one above it does.
  if (!stats.ends[1]) stats.ends[1] = stats.ends[0];
  if (!stats.ends[2]) stats.ends[2] = stats.ends[1];
  stats.tall.sort((a, b) => b[0] - a[0]);
  stats.tall.length = Math.min(stats.tall.length, 5);
  stats.tris = used;
  return stats;
}

// Size group for the auto colours: 0 houses, 1 big low, 2 mid-rise, 3 towers.
export function sizeGroup(b) {
  if (b.height >= SIZE_LIMITS.tall) return 3;
  if (b.height >= SIZE_LIMITS.low) return 2;
  return b.area >= SIZE_LIMITS.bigArea ? 1 : 0;
}

function emit(b, mb, hAt) {
  // The vertex colour is the map colour when there is one (the shader shades
  // it), else the old baked colour, which is only a fallback.
  const base = PALETTE[b.hash % PALETTE.length];
  const c0 = b.colour ? rgba(b.colour[0], b.colour[1], b.colour[2]) : null;
  const wallTop = c0 || shade(base, 1), wallBot = c0 || shade(base, 0.78), roof = c0 || shade(base, 0.7);
  const fl = INFO_BUILDING | (b.colour ? INFO_REAL : 0) | (b.masked ? INFO_MASKED : 0), num = b.hash & 255;
  const tg = b.type | (sizeGroup(b) << 4);
  const iTop = info(tg, num, 255, fl), iBot = info(tg, num, 199, fl), iRoof = info(tg, num, 255, fl | INFO_ROOF);

  let gMax = -Infinity;
  const ground = b.rings.map((r) => {
    const gs = new Float64Array(r.length / 2);
    for (let i = 0; i < gs.length; i++) { gs[i] = hAt(r[2 * i], r[2 * i + 1]); if (gs[i] > gMax) gMax = gs[i]; }
    return gs;
  });
  const top = gMax + b.height;

  for (let k = 0; k < b.rings.length; k++) {
    const r = b.rings[k], gs = ground[k], m = gs.length;
    const first = mb.verts;
    for (let i = 0; i < m; i++) {
      const bottom = b.minh > 0 ? gs[i] + b.minh : gs[i] - b.sunk;
      mb.vert(r[2 * i], bottom, r[2 * i + 1], wallBot, iBot);
      mb.vert(r[2 * i], top, r[2 * i + 1], wallTop, iTop);
    }
    for (let i = 0; i < m; i++) {
      const j = (i + 1) % m;
      const a = first + 2 * i, c = first + 2 * j;        // bottoms; tops are +1
      mb.tri(a, c, a + 1);
      mb.tri(c, c + 1, a + 1);
    }
  }

  // Roof: own vertices so it can be a different colour from the wall tops.
  const roofBase = mb.verts;
  const ids = [];
  for (const r of b.rings) {
    for (let i = 0; i < r.length / 2; i++) { ids.push(mb.verts - roofBase); mb.vert(r[2 * i], top, r[2 * i + 1], roof, iRoof); }
  }
  const t = triangulate(b.rings);
  for (let i = 0; i < t.tris.length; i += 3) {
    mb.tri(roofBase + t.src[t.tris[i]], roofBase + t.src[t.tris[i + 1]], roofBase + t.src[t.tris[i + 2]]);
  }
}
