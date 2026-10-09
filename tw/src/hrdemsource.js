// Reading Canada's high-resolution elevation (HRDEM) a window at a time
// (ground labs). The survey is published as a few huge cloud files, each
// readable a piece at a time; Canada's catalogue says which file covers a
// place. Positions here are local metres (x east, z south) round a place's
// middle; the file is on Canada's own grid (lcc.js).
//
// Needs the geotiff.js library loaded as the global GeoTIFF.

import { toCanadaAtlas } from './lcc.js';
import { lonToMercX, latToMercY, mercXToLon, mercYToLat } from './geo.js';

export const STAC = 'https://datacube.services.geo.ca/stac/api/search';
export const COLLECTIONS = ['hrdem-mosaic-1m', 'hrdem-mosaic-2m', 'hrdem-lidar'];

// Local metres round (lat, lon) to latitude and longitude, the app's way:
// metres are mercator metres times cos(latitude of the middle), as in the
// terrain, the map and the water painting, so all of them line up.
export function localToLatLon(lat, lon, x, z) {
  const k = Math.cos(lat * Math.PI / 180);
  return [mercYToLat(latToMercY(lat) - z / k), mercXToLon(lonToMercX(lon) + x / k)];
}

// Local metres to Canada's grid, exactly for every point. (A straight-line
// fit about the middle drifts by metres within a few kilometres, because the
// grid slowly turns relative to north.)
export function localToGrid(lat, lon) {
  return (x, z) => { const [la, lo] = localToLatLon(lat, lon, x, z); return toCanadaAtlas(lo, la); };
}

// The catalogue entry covering a box of longitudes and latitudes, or null.
export async function findPiece(lon0, lat0, lon1, lat1, surf = 'dtm') {
  const bbox = [lon0, lat0, lon1, lat1].map((v) => v.toFixed(6)).join(',');
  for (const col of COLLECTIONS) {
    const r = await fetch(`${STAC}?collections=${col}&bbox=${bbox}&limit=5`, { mode: 'cors' });
    if (!r.ok) throw new Error('catalogue HTTP ' + r.status);
    const j = await r.json();
    const item = (j.features || []).find((f) => f.assets && f.assets[surf]);
    if (item) return { id: item.id, href: item.assets[surf].href, bbox: item.bbox || null };
  }
  return null;
}

// An open survey file: its levels (full detail first, then each coarser one),
// with what is needed to find a point in each.
const opened = new Map();
export async function openSurvey(href) {
  if (opened.has(href)) return opened.get(href);
  const p = (async () => describeSurvey(await GeoTIFF.fromUrl(href, { allowFullFile: false }), href))();
  opened.set(href, p);
  p.catch(() => opened.delete(href));
  return p;
}

// The same, for a file already opened (the app opens it through its own
// caching reader, surveytile.js).
export async function describeSurvey(tiff, href) {
  const img0 = await tiff.getImage(0), n = await tiff.getImageCount();
  const [ox, oy] = img0.getOrigin(), [rx, ry] = img0.getResolution();
  const levels = [];
  for (let k = 0; k < n; k++) {
    const im = k ? await tiff.getImage(k) : img0, sc = img0.getWidth() / im.getWidth();
    levels.push({ img: im, cell: Math.abs(rx) * sc, prx: rx * sc, pry: ry * sc, W: im.getWidth(), H: im.getHeight() });
  }
  const fd = img0.fileDirectory;
  return { href, ox, oy, levels, nodata: img0.getGDALNoData(),
    compression: { 1: 'none', 5: 'LZW', 8: 'Deflate', 32946: 'Deflate', 34887: 'LERC', 50000: 'ZSTD' }[fd.Compression] || fd.Compression,
    block: fd.TileWidth || null, size: [img0.getWidth(), img0.getHeight()] };
}

// The level whose cells are the largest not over `cell` metres.
export function levelFor(survey, cell) {
  let best = survey.levels[0];
  for (const L of survey.levels) if (L.cell <= cell * 1.01) best = L;
  return best;
}

// Heights on a square grid of n x n points, `step` metres apart, centred on
// local (cx, cz), from one level of the survey. Points the survey does not
// cover come back as NaN. toGrid: localToGrid for the place.
export async function surveyGrid(survey, level, toGrid, cx, cz, n, step) {
  const half = (n - 1) / 2 * step;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, z] of [[cx - half, cz - half], [cx + half, cz - half], [cx - half, cz + half], [cx + half, cz + half]]) {
    const [X, Y] = toGrid(x, z);
    x0 = Math.min(x0, X); x1 = Math.max(x1, X); y0 = Math.min(y0, Y); y1 = Math.max(y1, Y);
  }
  const { prx, pry } = level;
  const px0 = Math.max(0, Math.floor((x0 - survey.ox) / prx) - 2), px1 = Math.min(level.W, Math.ceil((x1 - survey.ox) / prx) + 2);
  const py0 = Math.max(0, Math.floor((y1 - survey.oy) / pry) - 2), py1 = Math.min(level.H, Math.ceil((y0 - survey.oy) / pry) + 2);
  const out = new Float32Array(n * n).fill(NaN);
  if (px1 <= px0 || py1 <= py0) return out;
  const win = await level.img.readRasters({ window: [px0, py0, px1, py1], samples: [0], interleave: true });
  const W = px1 - px0, H = py1 - py0, nd = survey.nodata;
  const bad = (v) => !Number.isFinite(v) || (nd !== null && Math.abs(v - nd) < 1e-3) || v < -1000;
  for (let j = 0; j < n; j++) for (let i = 0; i < n; i++) {
    const [X, Y] = toGrid(cx - half + i * step, cz - half + j * step);
    const u = (X - survey.ox) / prx - px0 - 0.5, v = (Y - survey.oy) / pry - py0 - 0.5;
    const iu = Math.floor(u), jv = Math.floor(v), fu = u - iu, fv = v - jv;
    let s = 0, w = 0;
    for (let q = 0; q < 4; q++) {
      const di = q & 1, dj = q >> 1, ii = iu + di, jj = jv + dj;
      if (ii < 0 || jj < 0 || ii >= W || jj >= H) continue;
      const val = win[jj * W + ii];
      if (bad(val)) continue;
      const ww = (di ? fu : 1 - fu) * (dj ? fv : 1 - fv);
      s += val * ww; w += ww;
    }
    if (w > 0.2) out[j * n + i] = s / w;
  }
  return out;
}

// ---- reading by blocks, each fetched once -------------------------------------
//
// The survey files are stored in square blocks (512 px). Reading a window
// that moves a little re-reads mostly the same blocks, so instead each block
// is fetched and decoded once, kept, and heights are taken from the kept
// blocks. Moving then costs only the blocks newly in reach.

export class SurveyBlocks {
  constructor(survey, maxBlocks = 600) {
    this.s = survey;
    this.max = maxBlocks;
    this.blocks = new Map();          // 'level/bx/by' -> Float32Array (NaN where not surveyed), or a Promise
    this.fetched = 0;                 // blocks fetched so far
  }

  _key(li, bx, by) { return li * 1e12 + by * 1e6 + bx; }

  // Fetch every block of level li under a box of the file's own grid
  // (X0..X1, Y0..Y1, metres). Returns when all have arrived.
  async ensure(li, X0, Y0, X1, Y1) {
    const L = this.s.levels[li], s = this.s;
    const tw = L.img.getTileWidth(), th = L.img.getTileHeight();
    const px0 = Math.floor((X0 - s.ox) / L.prx) - 1, px1 = Math.ceil((X1 - s.ox) / L.prx) + 1;
    const py0 = Math.floor((Y1 - s.oy) / L.pry) - 1, py1 = Math.ceil((Y0 - s.oy) / L.pry) + 1;
    const jobs = [];
    for (let by = Math.max(0, Math.floor(py0 / th)); by <= Math.min(Math.ceil(L.H / th) - 1, Math.floor(py1 / th)); by++) {
      for (let bx = Math.max(0, Math.floor(px0 / tw)); bx <= Math.min(Math.ceil(L.W / tw) - 1, Math.floor(px1 / tw)); bx++) {
        const k = this._key(li, bx, by);
        let b = this.blocks.get(k);
        if (!b) {
          b = this._load(L, bx, by, tw, th).then((a) => { this.blocks.set(k, a); return a; });
          b.catch(() => this.blocks.delete(k));
          this.blocks.set(k, b);
          this.fetched++;
        }
        if (b instanceof Promise) jobs.push(b);
        else { this.blocks.delete(k); this.blocks.set(k, b); }      // most recently used last
      }
    }
    await Promise.all(jobs);
    while (this.blocks.size > this.max) this.blocks.delete(this.blocks.keys().next().value);
  }

  async _load(L, bx, by, tw, th) {
    const w = Math.min(tw, L.W - bx * tw), h = Math.min(th, L.H - by * th);
    const r = await L.img.readRasters({ window: [bx * tw, by * th, bx * tw + w, by * th + h], samples: [0], interleave: true });
    const nd = this.s.nodata, a = new Float32Array(tw * th).fill(NaN);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
      const v = r[j * w + i];
      if (Number.isFinite(v) && v > -1000 && !(nd !== null && Math.abs(v - nd) < 1e-3)) a[j * tw + i] = v;
    }
    a.tw = tw; a.th = th;
    return a;
  }

  // Height at a point of the file's grid from kept blocks of level li, NaN
  // where not surveyed or not fetched.
  at(li, X, Y) {
    const L = this.s.levels[li];
    const u = (X - this.s.ox) / L.prx - 0.5, v = (Y - this.s.oy) / L.pry - 0.5;
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j;
    let s = 0, w = 0;
    for (let q = 0; q < 4; q++) {
      const di = q & 1, dj = q >> 1, val = this._px(li, i + di, j + dj);
      if (Number.isNaN(val)) continue;
      const ww = (di ? fu : 1 - fu) * (dj ? fv : 1 - fv);
      s += val * ww; w += ww;
    }
    return w > 0.2 ? s / w : NaN;
  }

  _px(li, i, j) {
    if (i < 0 || j < 0) return NaN;
    const L = this.s.levels[li], tw = L.tw || (L.tw = L.img.getTileWidth()), th = L.th || (L.th = L.img.getTileHeight());
    const bx = Math.floor(i / tw), by = Math.floor(j / th);
    const k = this._key(li, bx, by);
    let b;
    if (k === this._lk) b = this._lb;
    else { b = this.blocks.get(k); if (b instanceof Float32Array) { this._lk = k; this._lb = b; } }
    if (!(b instanceof Float32Array)) return NaN;
    return b[(j - by * b.th) * b.tw + (i - bx * b.tw)];
  }
}

// Local metres to the file's grid over one square, fast: exact on a 17 x 17
// lattice across the square, smoothly in between (well under a centimetre).
export function gridMapper(toGrid, cx, cz, half) {
  const M = 16, step = 2 * half / M, X = new Float64Array((M + 1) ** 2), Y = new Float64Array((M + 1) ** 2);
  for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) {
    const [a, b] = toGrid(cx - half + i * step, cz - half + j * step);
    X[j * (M + 1) + i] = a; Y[j * (M + 1) + i] = b;
  }
  return (x, z) => {
    const u = Math.min(M - 1e-9, Math.max(0, (x - cx + half) / step)), v = Math.min(M - 1e-9, Math.max(0, (z - cz + half) / step));
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, k = j * (M + 1) + i;
    const lerp = (A) => (A[k] * (1 - fu) + A[k + 1] * fu) * (1 - fv) + (A[k + M + 1] * (1 - fu) + A[k + M + 2] * fu) * fv;
    return [lerp(X), lerp(Y)];
  };
}
