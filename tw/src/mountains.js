// Finding a mountain by name, and tracing its outline (Tools mode, PIECES).
//
// 1. The name is looked up in Wikidata (the free database behind Wikipedia),
//    live, for its summit's position. Nothing else is needed from it.
// 2. The outline comes from the same height tiles the app streams: the ground
//    you can reach from the summit without climbing (see traceGrid), sliced
//    at the valley floors round it, within `reach` of the summit.

import { mercScale, mercYToLat, lonToMercX, latToMercY, mercXToLon, tileSizeMerc, HALF } from './geo.js';
import { chooseZoom, sampler } from './transplant.js';

const API = 'https://www.wikidata.org/w/api.php';
const GRID = 320;              // cells across the traced square
// Wikidata: has a prominence (P2660), or is (P31) a mountain, summit, volcano
// or stratovolcano.
const MOUNTAIN = 'P2660|P31=Q8502|P31=Q207326|P31=Q8072|P31=Q169358';

// ---- the name ------------------------------------------------------------------

// Mountains (or anything with a summit position) matching a name, best first:
// [{ name, about, lat, lon, height }]. fetchJson(url): Promise of parsed JSON.
export async function searchMountains(text, fetchJson, lang = 'en') {
  const q = (p) => API + '?' + new URLSearchParams({ format: 'json', origin: '*', ...p });
  // Only mountains: things recorded as a mountain, summit, volcano or
  // stratovolcano, or that have a prominence. (A plain name search also
  // finds every town, county and airport called Logan.)
  const found = await fetchJson(q({ action: 'query', list: 'search', srnamespace: '0', srlimit: '12',
    srsearch: `${text} haswbstatement:${MOUNTAIN}` }));
  let ids = ((found.query && found.query.search) || []).map((s) => s.title).filter((t) => /^Q\d+$/.test(t));
  // If that finds nothing, a plain name search, kept to things described as
  // mountains (below).
  let byWords = false;
  if (!ids.length) {
    const plain = await fetchJson(q({ action: 'wbsearchentities', search: text, language: lang, uselang: lang, type: 'item', limit: '20' }));
    ids = (plain.search || []).map((s) => s.id);
    byWords = true;
  }
  if (!ids.length) return [];
  const got = await fetchJson(q({ action: 'wbgetentities', ids: ids.join('|'), props: 'claims|labels|descriptions', languages: lang + '|mul' }));
  const out = [];
  for (const id of ids) {
    const e = (got.entities || {})[id];
    if (!e) continue;
    const c = claim(e, 'P625');
    if (!c || !Number.isFinite(c.latitude) || !Number.isFinite(c.longitude)) continue;   // no summit position
    const h = claim(e, 'P2044');
    const about = (e.descriptions && e.descriptions[lang] && e.descriptions[lang].value) || '';
    if (byWords && !/mountain|peak|volcano|summit|mount\b|massif|hill/i.test(about)) continue;
    out.push({
      id, name: labelOf(e, lang) || id,
      about: (e.descriptions && e.descriptions[lang] && e.descriptions[lang].value) || '',
      lat: c.latitude, lon: c.longitude,
      height: h && Number.isFinite(+h.amount) ? Math.round(+h.amount) : null,
    });
  }
  return out;
}

// The name in the language asked for, else the one for all languages ('mul',
// which Wikidata now uses for many places: Denali's English name is there),
// else any.
const labelOf = (e, lang) => {
  const L = e.labels || {};
  return (L[lang] || L.mul || Object.values(L)[0] || {}).value;
};

const claim = (e, p) => {
  const c = e.claims && e.claims[p] && e.claims[p][0];
  return c && c.mainsnak && c.mainsnak.datavalue ? c.mainsnak.datavalue.value : null;
};

// ---- the outline -------------------------------------------------------------------

// heights: Float32Array N*N (row 0 north); the summit is near cell (si, sj).
//
// Which mountain does a spot belong to? Walk uphill from it, always the
// steepest way: the peak you end on. The mountain is every spot whose way up
// ends on our summit; where the way up leads to another peak, that ground is
// the other mountain's, even if it lies low (the foot of a neighbour). Bumps
// that rise less than `climb` metres above where they meet a bigger peak
// (noise in the data, a boulder field) are not peaks of their own. The reach
// is a circle round the summit. The mountain is then sliced at the low ground
// along its edge (the lowest tenth): the valley floors round it.
//
// Returns { inside: Uint8Array, col, top, ti, tj, cut }: col is the slice
// height, cut says the mountain reached the circle.
export function traceGrid(heights, N, si, sj, near = 3, climb = 60) {
  // The summit's position from a gazetteer is rarely exact: take the highest
  // cell close to it.
  let ti = si, tj = sj, top = -Infinity;
  for (let j = Math.max(0, sj - near); j <= Math.min(N - 1, sj + near); j++) {
    for (let i = Math.max(0, si - near); i <= Math.min(N - 1, si + near); i++) {
      if (heights[j * N + i] > top) { top = heights[j * N + i]; ti = i; tj = j; }
    }
  }
  const R = Math.min(ti, tj, N - 1 - ti, N - 1 - tj) - 1;
  const inCircle = (i, j) => (i - ti) * (i - ti) + (j - tj) * (j - tj) < R * R;

  // Highest first, each spot joins the peak its highest neighbour already
  // belongs to (the steepest way up), or starts a peak of its own. Where two
  // peaks meet, the lesser one joins the greater if it rises less than
  // `climb` above the meeting point.
  const order = [];
  for (let k = 0; k < N * N; k++) if (heights[k] > -1e8 && inCircle(k % N, (k / N) | 0)) order.push(k);
  order.sort((a, b) => heights[b] - heights[a]);
  const label = new Int32Array(N * N).fill(-1), parent = [], peak = [];
  const root = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  for (const k of order) {
    const i = k % N, j = (k / N) | 0, h = heights[k];
    let best = -1, bestH = -Infinity;
    const roots = [];
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const q = b * N + a;
      if (label[q] < 0) continue;
      const r = root(label[q]);
      if (!roots.includes(r)) roots.push(r);
      if (heights[q] > bestH) { bestH = heights[q]; best = r; }
    }
    if (best < 0) { parent.push(parent.length); peak.push(h); label[k] = parent.length - 1; continue; }
    label[k] = best;
    for (const r of roots) {
      const a = root(r), b = root(best);
      if (a === b) continue;
      const [lo, hi] = peak[a] < peak[b] ? [a, b] : [b, a];
      if (peak[lo] - h < climb) parent[lo] = hi;
    }
  }
  const s0 = tj * N + ti, ours = root(label[s0]);
  const region = new Uint8Array(N * N);
  let cut = false;
  for (const k of order) {
    if (root(label[k]) !== ours) continue;
    region[k] = 1;
    const i = k % N, j = (k / N) | 0;
    if (!cut && [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].some(([a, b]) => !inCircle(a, b))) cut = true;
  }

  // The slice: the lowest tenth of the ground along the region's edge.
  const edge = [];
  for (let k = 0; k < N * N; k++) {
    if (!region[k]) continue;
    const i = k % N, j = (k / N) | 0;
    if ([[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]].some(([a, b]) => a < 0 || b < 0 || a >= N || b >= N || !region[b * N + a])) edge.push(heights[k]);
  }
  edge.sort((a, b) => a - b);
  const col = edge.length ? edge[Math.floor(edge.length * 0.1)] : top;

  // The mountain: in the region, above the slice, attached to the summit.
  const inside = new Uint8Array(N * N), stack = [s0];
  inside[s0] = 1;
  while (stack.length) {
    const k = stack.pop(), i = k % N, j = (k / N) | 0;
    for (const [a, b] of [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]]) {
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const q = b * N + a;
      if (!inside[q] && region[q] && heights[q] > col) { inside[q] = 1; stack.push(q); }
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
