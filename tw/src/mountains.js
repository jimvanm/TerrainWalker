// Finding a mountain by name, and tracing its outline (Tools mode, PIECES).
//
// 1. The name is looked up in Wikidata (the free database behind Wikipedia),
//    live, for its summit's position. Nothing else is needed from it.
// 2. The outline comes from the same height tiles the app streams, by the
//    rules at RULES below (tuned in mountainlab.html).

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

// Where a mountain ends has no single right answer (see "Do mountains
// exist?", Smith and Mark 2003, and "Where is Helvellyn?", Fisher, Wood and
// Cheng 2004). These rules, and their settings, were tuned by eye in
// mountainlab.html:
//
//   1. Every spot belongs to the peak that walking steepest uphill from it
//      ends on. Bumps rising less than `bump` metres above where they meet a
//      bigger peak are not peaks of their own.
//   2. A neighbouring peak joins ours if the saddle between them is at least
//      `join` of the way up our mountain (from its base to its top), and its
//      top is within `joinKm` of our summit. (Lhotse joins Everest.)
//   3. Near the summit everything is kept; further out, only ground at least
//      `trim` of the way up the mountain at the reach, less nearer in. (The
//      low spurs reaching out go.)
//   4. It is sliced at the low ground along its edge: the lowest `slice` of it.
//   5. Nothing beyond `reach` (a circle round the summit).
//   6. Arms narrower than `neck` metres are cut off: the shape is shrunk by
//      half that, grown back by the same, and only what still reaches the
//      summit is kept. 0: no cutting.
export const RULES = { reach: 15, bump: 60, join: 0.6, joinKm: 5, trim: 0.25, slice: 0.1, neck: 0 };

// heights: Float32Array N*N (row 0 north), cells `cell` metres; the summit is
// near cell (si, sj). rules: as RULES. Returns { inside, col, top, ti, tj,
// cut, joined: [cell, ...] (the tops of the peaks that joined), area }.
export function traceGrid(heights, N, si, sj, cell, rules = RULES) {
  const r = { ...RULES, ...rules };
  // The summit's position from a gazetteer is rarely exact: take the highest
  // cell within 300 m of it.
  const near = Math.max(2, Math.round(300 / cell));
  let ti = si, tj = sj, top = -Infinity;
  for (let j = Math.max(0, sj - near); j <= Math.min(N - 1, sj + near); j++) {
    for (let i = Math.max(0, si - near); i <= Math.min(N - 1, si + near); i++) {
      if (heights[j * N + i] > top) { top = heights[j * N + i]; ti = i; tj = j; }
    }
  }
  const R = Math.min(Math.min(ti, tj, N - 1 - ti, N - 1 - tj) - 1, r.reach * 1000 / cell);
  const d2 = (i, j) => (i - ti) * (i - ti) + (j - tj) * (j - tj);
  const inCircle = (i, j) => d2(i, j) < R * R;
  const nbrs = (i, j) => [[i + 1, j], [i - 1, j], [i, j + 1], [i, j - 1]];

  // 1. Highest first, each spot joins the peak its highest neighbour already
  // belongs to, or starts a peak of its own. Where two peaks meet, the lesser
  // joins the greater if it rises less than `bump` above the meeting point;
  // otherwise the meeting point is a saddle between them, remembered.
  const order = [];
  for (let k = 0; k < N * N; k++) if (heights[k] > -1e8 && inCircle(k % N, (k / N) | 0)) order.push(k);
  order.sort((a, b) => heights[b] - heights[a]);
  const label = new Int32Array(N * N).fill(-1), parent = [], peak = [], peakCell = [];
  const root = (x) => { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; };
  const saddles = [];                                   // [a, b, height], highest first
  for (const k of order) {
    const i = k % N, j = (k / N) | 0, h = heights[k];
    let best = -1, bestH = -Infinity;
    const roots = [];
    for (const [a, b] of nbrs(i, j)) {
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      const q = b * N + a;
      if (label[q] < 0) continue;
      const rt = root(label[q]);
      if (!roots.includes(rt)) roots.push(rt);
      if (heights[q] > bestH) { bestH = heights[q]; best = rt; }
    }
    if (best < 0) { parent.push(parent.length); peak.push(h); peakCell.push(k); label[k] = parent.length - 1; continue; }
    label[k] = best;
    for (const rt of roots) {
      const a = root(rt), b = root(best);
      if (a === b) continue;
      const [lo, hi] = peak[a] < peak[b] ? [a, b] : [b, a];
      if (peak[lo] - h < r.bump) parent[lo] = hi;
      else saddles.push([a, b, h]);
    }
  }
  const s0 = tj * N + ti, ours = root(label[s0]);
  const basin = (set) => {
    const reg = new Uint8Array(N * N);
    for (const k of order) if (set.has(root(label[k]))) reg[k] = 1;
    return reg;
  };
  const sliceOf = (reg) => {
    const edge = [];
    for (const k of order) {
      if (!reg[k]) continue;
      const i = k % N, j = (k / N) | 0;
      if (nbrs(i, j).some(([a, b]) => !inCircle(a, b) || !reg[b * N + a])) edge.push(heights[k]);
    }
    edge.sort((a, b) => a - b);
    return edge.length ? edge[Math.min(edge.length - 1, Math.floor(edge.length * r.slice))] : top;
  };

  // 2. Neighbours that join: a high saddle, and close.
  const set = new Set([ours]);
  const base0 = sliceOf(basin(set));
  const joined = [];
  for (let changed = true; changed;) {
    changed = false;
    for (const [a0, b0, h] of saddles) {
      const a = root(a0), b = root(b0);
      const inA = set.has(a), inB = set.has(b);
      if (inA === inB) continue;
      const other = inA ? b : a;
      const up = (h - base0) / Math.max(1, top - base0);
      const pc = peakCell[other];
      const km = Math.sqrt(d2(pc % N, (pc / N) | 0)) * cell / 1000;
      if (up >= r.join && km <= r.joinKm) { set.add(other); joined.push(pc); changed = true; }
    }
  }
  const region = basin(set);
  const col = sliceOf(region);

  // 3 and 4: above the slice, high enough for how far out it is, attached.
  const need = (i, j) => r.trim * Math.sqrt(d2(i, j)) / R;     // fraction of the way up
  const keep = (k) => {
    const i = k % N, j = (k / N) | 0;
    return region[k] && heights[k] > col && (heights[k] - col) / Math.max(1, top - col) >= need(i, j);
  };
  const inside = new Uint8Array(N * N), stack = [s0];
  inside[s0] = 1;
  let area = 1, cut = false;
  while (stack.length) {
    const k = stack.pop(), i = k % N, j = (k / N) | 0;
    for (const [a, b] of nbrs(i, j)) {
      if (a < 0 || b < 0 || a >= N || b >= N) continue;
      if (!inCircle(a, b)) { cut = true; continue; }
      const q = b * N + a;
      if (!inside[q] && keep(q)) { inside[q] = 1; stack.push(q); area++; }
    }
  }
  // 6. Thin arms off.
  if (r.neck > 0) {
    const thin = openUp(inside, N, r.neck / 2 / cell);
    if (thin[s0]) {
      inside.fill(0); inside[s0] = 1; area = 1;
      const st = [s0];
      while (st.length) {
        const k = st.pop(), i = k % N, j = (k / N) | 0;
        for (const [a, b] of nbrs(i, j)) {
          if (a < 0 || b < 0 || a >= N || b >= N) continue;
          const q = b * N + a;
          if (!inside[q] && thin[q]) { inside[q] = 1; st.push(q); area++; }
        }
      }
    }
  }
  return { inside, col, top, ti, tj, cut, joined, area: area * cell * cell / 1e6 };
}

// How far each cell is from the nearest cell where `on` is false (or true,
// with `to`), in cells: two sweeps, steps of 1 and 1.414.
function distance(on, N, to = 0) {
  const d = new Float32Array(N * N);
  for (let k = 0; k < N * N; k++) d[k] = (on[k] ? 1 : 0) === to ? 0 : 1e9;
  const D = Math.SQRT2;
  const step = (k, i, j, a, b, w) => {
    if (a < 0 || b < 0 || a >= N || b >= N) { if (!to && d[k] > w) d[k] = w; return; }
    const v = d[b * N + a] + w;
    if (v < d[k]) d[k] = v;
  };
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const k = j * N + i;
    if (!d[k]) continue;
    step(k, i, j, i - 1, j, 1); step(k, i, j, i - 1, j - 1, D); step(k, i, j, i, j - 1, 1); step(k, i, j, i + 1, j - 1, D);
  }
  for (let j = N - 1; j >= 0; j--) for (let i = N - 1; i >= 0; i--) {
    const k = j * N + i;
    if (!d[k]) continue;
    step(k, i, j, i + 1, j, 1); step(k, i, j, i + 1, j + 1, D); step(k, i, j, i, j + 1, 1); step(k, i, j, i - 1, j + 1, D);
  }
  return d;
}

// The cells of `inside` that a disc of radius `rad` cells fits round:
// shrink by rad, grow back by rad. Anything thinner than 2 rad goes.
export function openUp(inside, N, rad) {
  const toEdge = distance(inside, N, 0);
  const core = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) core[k] = toEdge[k] > rad ? 1 : 0;
  const toCore = distance(core, N, 1);
  const out = new Uint8Array(N * N);
  for (let k = 0; k < N * N; k++) out[k] = inside[k] && toCore[k] <= rad ? 1 : 0;
  return out;
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

// The height grid round a summit: { heights, N, cell, reach, k, cx, cy },
// cells `cell` metres, N across, `reach` metres each way.
export async function heightGrid(lat, lon, reach, fetchTile, N = GRID) {
  const z = chooseZoom(2 * reach, lat);
  const k = mercScale(lat), cx = lonToMercX(lon), cy = latToMercY(lat);
  const s = tileSizeMerc(z), n = 2 ** z, rr = reach / k;
  const tiles = new Map(), jobs = [];
  for (let ty = Math.floor((HALF - cy - rr) / s) - 1; ty <= Math.floor((HALF - cy + rr) / s) + 1; ty++) {
    for (let tx = Math.floor((cx - rr + HALF) / s) - 1; tx <= Math.floor((cx + rr + HALF) / s) + 1; tx++) {
      if (ty < 0 || ty >= n) continue;
      const x = ((tx % n) + n) % n;
      jobs.push(fetchTile(z, x, ty).then((h) => tiles.set(x + '/' + ty, h)).catch(() => {}));
    }
  }
  await Promise.all(jobs);
  const at = sampler(tiles, z);
  const cell = 2 * reach / N;
  const heights = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const e = -reach + (i + 0.5) * cell, nn = reach - (j + 0.5) * cell;
    const h = at(cx + e / k, cy + nn / k);
    heights[j * N + i] = h === null || h === undefined ? -1e9 : h;
  }
  return { heights, N, cell, reach, k, cx, cy };
}

// A traced grid's outline as [[lat, lon], ...], or null.
export function cornersOf(g, t) {
  const pts = simplify(outlineOf(t.inside, g.N), 0.75);
  if (pts.length < 3) return null;
  return pts.map(([i, j]) => {
    const e = -g.reach + i * g.cell, nn = g.reach - j * g.cell;
    return [+mercYToLat(g.cy + nn / g.k).toFixed(6), +mercXToLon(g.cx + e / g.k).toFixed(6)];
  });
}

// The whole thing: summit (lat, lon), rules (RULES, reach in km), and
// fetchTile(z, x, y) for height tiles. Returns { corners: [[lat, lon], ...],
// prominence (its rise above the slice), col (the slice), top, cut }.
export async function traceMountain(lat, lon, rules, fetchTile) {
  const r = { ...RULES, ...rules };
  const g = await heightGrid(lat, lon, r.reach * 1000, fetchTile);
  const mid = (g.N / 2) | 0;
  const t = traceGrid(g.heights, g.N, mid, mid, g.cell, r);
  const corners = cornersOf(g, t);
  if (!corners) return null;
  return { corners, prominence: Math.round(t.top - t.col), col: Math.round(t.col), top: Math.round(t.top), cut: t.cut };
}
