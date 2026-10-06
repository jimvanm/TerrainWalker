// Finding a mountain by name, and tracing its outline (Tools mode, PIECES).
//
// 1. The name is looked up in Wikidata (the free database behind Wikipedia),
//    live, for its summit's position. Nothing else is needed from it.
// 2. The outline comes from the same height tiles the app streams. From the
//    summit, the ground is taken in, highest first, until the next piece is
//    higher than the summit: the lowest point crossed on the way is the col,
//    the lowest point you must cross to reach higher ground. Everything above
//    the col and attached to the summit is the mountain; the rest is left.
//    Its rise above the col is its prominence.
// 3. A mountain whose col is further than `reach` from the summit (Everest's
//    is most of Asia) is cut at the reach instead: the col is then the lowest
//    point crossed before the ground reached that far.

import { mercScale, mercYToLat, lonToMercX, latToMercY, mercXToLon, tileSizeMerc, HALF } from './geo.js';
import { chooseZoom, sampler } from './transplant.js';

const API = 'https://www.wikidata.org/w/api.php';
const GRID = 320;              // cells across the traced square

// ---- the name ------------------------------------------------------------------

// Mountains (or anything with a summit position) matching a name, best first:
// [{ name, about, lat, lon, height }]. fetchJson(url): Promise of parsed JSON.
export async function searchMountains(text, fetchJson, lang = 'en') {
  const q = (p) => API + '?' + new URLSearchParams({ format: 'json', origin: '*', ...p });
  const found = await fetchJson(q({ action: 'wbsearchentities', search: text, language: lang, uselang: lang, type: 'item', limit: '12' }));
  const ids = (found.search || []).map((s) => s.id);
  if (!ids.length) return [];
  const got = await fetchJson(q({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels|descriptions', languages: lang }));
  const out = [];
  for (const id of ids) {
    const e = (got.entities || {})[id];
    if (!e) continue;
    const c = claim(e, 'P625');
    if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) continue;   // no summit position
    const h = claim(e, 'P2044');
    out.push({
      id, name: (e.labels && e.labels[lang] && e.labels[lang].value) || id,
      about: (e.descriptions && e.descriptions[lang] && e.descriptions[lang].value) || '',
      lat: c.latitude, lon: c.longitude,
      height: h && Number.isFinite(+h.amount) ? Math.round(+h.amount) : null,
    });
  }
  return out;
}

const claim = (e, p) => {
  const c = e.claims && e.claims[p] && e.claims[p][0];
  return c && c.mainsnak && c.mainsnak.datavalue ? c.mainsnak.datavalue.value : null;
};

// ---- the outline -------------------------------------------------------------------

// heights: Float32Array GRID*GRID (row 0 north), cell size `cell` metres,
// summit near cell (si, sj). Returns { inside: Uint8Array, col, top, ti, tj,
// cut } (cut: the square's edge, not higher ground, set the col).
export function traceGrid(heights, N, si, sj, near = 3) {
  // The summit's position from a gazetteer is rarely exact: take the highest
  // cell close to it.
  let ti = si, tj = sj, top = -Infinity;
  for (let j = Math.max(0, sj - near); j <= Math.min(N - 1, sj + near); j++) {
    for (let i = Math.max(0, si - near); i <= Math.min(N - 1, si + near); i++) {
      if (heights[j * N + i] > top) { top = heights[j * N + i]; ti = i; tj = j; }
    }
  }
  // Highest first: a heap of the cells around what is taken so far.
  const seen = new Uint8Array(N * N), heap = [];
  const push = (k) => {
    if (seen[k]) return;
    seen[k] = 1; heap.push(k);
    let i = heap.length - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (heights[heap[p]] >= heights[heap[i]]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; }
  };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i;
        if (l < heap.length && heights[heap[l]] > heights[heap[m]]) m = l;
        if (r < heap.length && heights[heap[r]] > heights[heap[m]]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i], heap[m]]; i = m;
      }
    }
    return top;
  };
  push(tj * N + ti);
  let col = top, cut = false;
  while (heap.length) {
    const k = pop(), h = heights[k], i = k % N, j = (k / N) | 0;
    if (h > top) break;                                   // higher ground: col found
    if (h < -1e8) { cut = true; break; }                  // no height data there: stop as at the reach
    col = Math.min(col, h);
    if (i === 0 || j === 0 || i === N - 1 || j === N - 1) { cut = true; break; }   // reached the reach: cut here
    push(k - 1); push(k + 1); push(k - N); push(k + N);
  }
  // The mountain: above the col and attached to the summit.
  const inside = new Uint8Array(N * N), stack = [tj * N + ti];
  inside[tj * N + ti] = 1;
  while (stack.length) {
    const k = stack.pop(), i = k % N, j = (k / N) | 0;
    for (const [di, dj] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const a = i + di, b = j + dj;
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const q = b * N + a;
      if (!inside[q] && heights[q] > col) { inside[q] = 1; stack.push(q); }
    }
  }
  return { inside, col, top, ti, tj, cut };
}

// The outer edge of the cells marked inside, as a closed list of cell
// corners [i, j] (grid units), going round once. Holes are ignored.
export function outlineOf(inside, N) {
  const at = (i, j) => i >= 0 && j >= 0 && i < N && j < N && inside[j * N + i] === 1;
  // Start at the top-left corner of the first cell inside, reading row by row.
  let s = -1;
  for (let k = 0; k < N * N; k++) if (inside[k]) { s = k; break; }
  if (s < 0) return [];
  // Walk the cell edges with the inside on the right (clockwise on screen,
  // rows going down). Directions: 0 east, 1 south, 2 west, 3 north.
  const di = [1, 0, -1, 0], dj = [0, 1, 0, -1];
  const start = [s % N, (s / N) | 0];
  let [x, y] = start, d = 0;
  const pts = [];
  // The cells either side of the edge leaving corner (x, y) in direction d.
  const right = (x, y, d) => [[x, y], [x - 1, y], [x - 1, y - 1], [x, y - 1]][d];
  const left = (x, y, d) => [[x, y - 1], [x, y], [x - 1, y], [x - 1, y - 1]][d];
  for (let guard = 0; guard < 8 * N * N; guard++) {
    pts.push([x, y]);
    x += di[d]; y += dj[d];
    if (x === start[0] && y === start[1]) break;
    // Turn right if we can, else straight, else left, else back.
    for (const turn of [1, 0, 3, 2]) {
      const nd = (d + turn) % 4, r = right(x, y, nd), l = left(x, y, nd);
      if (at(r[0], r[1]) && !at(l[0], l[1])) { d = nd; break; }
    }
  }
  return pts;
}

// Fewer corners for the same outline (Douglas-Peucker), within tol.
export function simplify(pts, tol) {
  if (pts.length < 4) return pts;
  const keep = new Uint8Array(pts.length);
  keep[0] = keep[pts.length - 1] = 1;
  const stack = [[0, pts.length - 1]];
  while (stack.length) {
    const [a, b] = stack.pop();
    const [ax, ay] = pts[a], [bx, by] = pts[b];
    const L = Math.hypot(bx - ax, by - ay) || 1;
    let far = -1, fd = tol;
    for (let i = a + 1; i < b; i++) {
      const d = Math.abs((bx - ax) * (ay - pts[i][1]) - (ax - pts[i][0]) * (by - ay)) / L;
      if (d > fd) { fd = d; far = i; }
    }
    if (far > 0) { keep[far] = 1; stack.push([a, far], [far, b]); }
  }
  return pts.filter((_, i) => keep[i]);
}

// The whole thing: summit (lat, lon), reach in metres, fetchTile(z, x, y) for
// height tiles. Returns { corners: [[lat, lon], ...], prominence, col, top,
// cut } where cut says the reach, not higher ground, set the edge.
export async function traceMountain(lat, lon, reach, fetchTile) {
  const z = chooseZoom(2 * reach, lat);
  const k = mercScale(lat), cx = lonToMercX(lon), cy = latToMercY(lat);
  const s = tileSizeMerc(z), n = 2 ** z, r = reach / k;
  const tiles = new Map(), jobs = [];
  for (let ty = Math.floor((HALF - cy - r) / s) - 1; ty <= Math.floor((HALF - cy + r) / s) + 1; ty++) {
    for (let tx = Math.floor((cx - r + HALF) / s) - 1; tx <= Math.floor((cx + r + HALF) / s) + 1; tx++) {
      if (ty < 0 || ty >= n) continue;
      const x = ((tx % n) + n) % n;
      jobs.push(fetchTile(z, x, ty).then((h) => tiles.set(x + '/' + ty, h)).catch(() => {}));
    }
  }
  await Promise.all(jobs);
  const at = sampler(tiles, z);
  const N = GRID, cell = 2 * reach / N;
  const heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const e = -reach + (i + 0.5) * cell, nn = reach - (j + 0.5) * cell;
    const h = at(cx + e / k, cy + nn / k);
    heights[j * N + i] = h === null || h === undefined ? -1e9 : h;
  }
  const mid = (N / 2) | 0;
  const t = traceGrid(heights, N, mid, mid, Math.max(2, Math.round(300 / cell)));
  let pts = simplify(outlineOf(t.inside, N), 0.75);
  if (pts.length < 3) return null;
  const corners = pts.map(([i, j]) => {
    const e = -reach + i * cell, nn = reach - j * cell;
    return [+mercYToLat(cy + nn / k).toFixed(6), +mercXToLon(cx + e / k).toFixed(6)];
  });
  return { corners, prominence: Math.round(t.top - t.col), col: Math.round(t.col), top: Math.round(t.top), cut: t.cut };
}
