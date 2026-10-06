// The ground of a picked-up piece as plain numbers: one source of truth for the
// slab you see (transplant.js buildPiece) and for everything that stands on it
// (roads, buildings, paint: citykit.js, city.js).
//
// The slab's frame: x east, z south, true metres, from the outline's middle;
// y up from the piece's base. Row j of the grid runs east and sits j steps
// south of the grid's north edge, so a node's south coordinate is -n1 + j*step.
// Every grid cell is split into the triangles (a, c, b) and (b, c, d), the same
// split the terrain tiles use, so the diagonal runs from the north-east node to
// the south-west one.

import { tileSizeMerc, HALF } from './geo.js';

export const MAX_CELLS = 360;     // grid cells across the piece's longer side
export const MAX_MAP_TILES = 256; // map tiles fetched for one piece, at most
export const MAP_ZOOM = 14;       // the map service's deepest zoom

// Point in polygon, even-odd. poly: [[x, y], ...]
export function inside(poly, x, y) {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) c = !c;
  }
  return c;
}

// Points along the outline, about every `step` metres.
export function alongEdge(poly, step) {
  const out = [];
  for (let i = 0; i < poly.length; i++) {
    const [ax, ay] = poly[i], [bx, by] = poly[(i + 1) % poly.length];
    const n = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / step));
    for (let k = 0; k < n; k++) out.push([ax + (bx - ax) * k / n, ay + (by - ay) * k / n]);
  }
  return out;
}

export function median(v) {
  const s = v.filter((x) => x !== null && x !== undefined && Number.isFinite(x)).sort((a, b) => a - b);
  return s.length ? s[s.length >> 1] : null;
}

// The grid for an outline. heightAt(e, n): the source height at [east, north]
// metres from the outline's middle. poly: the outline in the same metres.
// mode 'rise' or 'sea', and cut: see buildPiece.
// Returns { e0, n1, step, W, H, hs, up, cellIn, edge, base }:
//   hs   height above sea level at each node (W * H, row by row from the north)
//   up   height above the base, never below it: what the slab is drawn at
//   cellIn  1 for each (W-1) x (H-1) cell whose middle is inside the outline
export function pieceGrid(heightAt, poly, mode = 'rise', cut = null) {
  let e0 = Infinity, e1 = -Infinity, n0 = Infinity, n1 = -Infinity;
  for (const [e, n] of poly) { e0 = Math.min(e0, e); e1 = Math.max(e1, e); n0 = Math.min(n0, n); n1 = Math.max(n1, n); }
  const step = Math.max(e1 - e0, n1 - n0) / MAX_CELLS;
  const W = Math.ceil((e1 - e0) / step) + 1, H = Math.ceil((n1 - n0) / step) + 1;
  const edge = median(alongEdge(poly, step).map(([e, n]) => heightAt(e, n)));
  const base = mode === 'sea' ? 0 : (cut ?? edge ?? 0);
  const hs = new Float32Array(W * H), up = new Float32Array(W * H);
  for (let j = 0; j < H; j++) for (let i = 0; i < W; i++) {
    const h = heightAt(e0 + i * step, n1 - j * step);
    const v = h === null || h === undefined ? base : h;
    hs[j * W + i] = v;
    up[j * W + i] = Math.max(0, v - base);
  }
  const cellIn = new Uint8Array((W - 1) * (H - 1));
  for (let j = 0; j < H - 1; j++) for (let i = 0; i < W - 1; i++) {
    cellIn[j * (W - 1) + i] = inside(poly, e0 + (i + 0.5) * step, n1 - (j + 0.5) * step) ? 1 : 0;
  }
  return { e0, n1, step, W, H, hs, up, cellIn, edge, base };
}

// Height above the base of the slab's top at (E, S): east and south metres from
// the outline's middle. Exactly the surface the slab is drawn with, so what
// stands on it neither floats nor sinks. Clamped to the grid.
export function slabHeightFn(grid) {
  const { e0, n1, step, W, H, up } = grid;
  return (E, S) => {
    const fu = Math.max(0, Math.min(W - 1, (E - e0) / step));
    const fv = Math.max(0, Math.min(H - 1, (S + n1) / step));
    const i = Math.min(W - 2, Math.floor(fu)), j = Math.min(H - 2, Math.floor(fv));
    const tx = fu - i, ty = fv - j;
    const a = up[j * W + i], b = up[j * W + i + 1], c = up[(j + 1) * W + i], d = up[(j + 1) * W + i + 1];
    if (tx + ty <= 1) return a + (b - a) * tx + (c - a) * ty;
    return d + (c - d) * (1 - tx) + (b - d) * (1 - ty);
  };
}

// Does the segment (ax, ay)-(bx, by) touch the rectangle [x0, x1] x [y0, y1]?
function segHitsRect(ax, ay, bx, by, x0, y0, x1, y1) {
  let t0 = 0, t1 = 1;
  const dx = bx - ax, dy = by - ay;
  for (const [p, q] of [[-dx, ax - x0], [dx, x1 - ax], [-dy, ay - y0], [dy, y1 - ay]]) {
    if (p === 0) { if (q < 0) return false; continue; }
    const r = q / p;
    if (p < 0) { if (r > t1) return false; if (r > t0) t0 = r; }
    else { if (r < t0) return false; if (r < t1) t1 = r; }
  }
  return true;
}

// Which map tiles an outline touches, and at which zoom. The finest zoom (the
// map service's deepest) is used while that needs no more than maxTiles tiles;
// a bigger piece gets a coarser map. Only tiles the outline really touches
// count, so a long thin or diagonal piece does not pay for its bounding box.
//   poly   the outline, [east, north] true metres from its middle
//   cx, cy the middle, mercator metres;  k  true metres per mercator metre
// Returns { z, tiles: [{ x, y, rawX }] }, x wrapped into 0..2^z-1, rawX not.
export function mapTiles(poly, cx, cy, k, maxTiles = MAX_MAP_TILES) {
  for (let z = MAP_ZOOM; z >= 0; z--) {
    const s = tileSizeMerc(z), n = 2 ** z;
    // The outline in tile units: x east, y south, origin the world's NW corner.
    const pts = poly.map(([e, nn]) => [(cx + e / k + HALF) / s, (HALF - (cy + nn / k)) / s]);
    const xs = pts.map((p) => p[0]), ys = pts.map((p) => p[1]);
    const tx0 = Math.floor(Math.min(...xs)), tx1 = Math.floor(Math.max(...xs));
    const ty0 = Math.max(0, Math.floor(Math.min(...ys))), ty1 = Math.min(n - 1, Math.floor(Math.max(...ys)));
    if ((tx1 - tx0 + 1) * (ty1 - ty0 + 1) > maxTiles * 40 && z > 0) continue;   // far too many to even test
    const tiles = [];
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        let hit = inside(pts, tx + 0.5, ty + 0.5) || pts.some(([px, py]) => px >= tx && px < tx + 1 && py >= ty && py < ty + 1);
        for (let i = 0; !hit && i < pts.length; i++) {
          const a = pts[i], b = pts[(i + 1) % pts.length];
          hit = segHitsRect(a[0], a[1], b[0], b[1], tx, ty, tx + 1, ty + 1);
        }
        if (hit) tiles.push({ x: ((tx % n) + n) % n, y: ty, rawX: tx });
      }
    }
    if (tiles.length <= maxTiles || z === 0) return { z, tiles };
  }
  return { z: 0, tiles: [] };
}
