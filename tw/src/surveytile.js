// Ground from Canada's laser survey (HRDEM), as the app's terrain tiles.
//
// Runs in the helpers (worker.js for the terrain, nearworker.js for the
// ground roads and buildings stand on). A tile asked for as "hrdem:z/x/y"
// (placetiles.js decides which) gets its 256 x 256 heights from the survey,
// at the survey level whose cells are no bigger than the tile's mesh squares:
// 2 m at zoom 16, 4 m at 15, 8 m at 14, 16 m at 13 (in southern Canada). Where
// the survey has no data, the usual height tile fills in, pixel by pixel; where
// there is no survey at all, the tile is simply the usual one.
//
// The survey files are read a piece at a time. Every piece downloaded is kept
// in the browser's own storage (CachedRangeClient), shared by all the helpers
// and kept between visits, so the same bytes are never downloaded twice.
//
// The GeoTIFF reader is a public library, loaded the first time it is needed.

import { PX, decodeTerrarium, pxMetersFor, sample } from './heightgrid.js';
import { tileToMerc, tileSizeMerc, mercXToLon, mercYToLat } from './geo.js';
import { toCanadaAtlas } from './lcc.js';
import { TILE_URL } from './config.js';
import { cachedFetch } from './cache.js';
import { findPiece, describeSurvey, levelFor, SurveyBlocks } from './hrdemsource.js';
import { SURVEY_PREFIX } from './placetiles.js';

export const GEOTIFF_URL = 'https://cdn.jsdelivr.net/npm/geotiff@2.1.3/+esm';
export const SURVEY_BLOCKS_PER_HELPER = 32;    // decoded blocks kept in memory by each helper (about 1 MB each)

export const parseSurveyUrl = (u) => {
  const [z, x, y] = u.slice(SURVEY_PREFIX.length).split('/').map(Number);
  return { z, x, y };
};

// ---- reading parts of a file, keeping every part ------------------------------

export const CHUNK = 131072;           // the file is read and kept in pieces of this many bytes
const STORE = 'tw-survey-v1';

// A stand-in for the GeoTIFF reader's own web client. It answers each request
// for a range of bytes from kept pieces where it can, fetches the missing
// pieces (whole pieces, so every helper asks for the same ones), keeps them,
// and hands back exactly the range asked for.
export class CachedRangeClient {
  constructor(url, opts = {}) {
    this.url = url;
    this.fetch = opts.fetch || ((u, i) => fetch(u, i));
    this.store = opts.store !== undefined ? opts.store
      : (typeof caches !== 'undefined' ? caches.open(STORE).catch(() => null) : Promise.resolve(null));
    this.total = null;
    this.downloaded = 0;     // bytes fetched from the network by this client
  }

  _key(k) { return this.url + '?piece=' + k; }

  async request({ headers = {}, signal } = {}) {
    const range = headers.Range || headers.range || '';
    const m = /bytes=(\d+)-(\d+)/.exec(range);
    if (!m) throw new Error('survey: only ranges are read');
    const a = Number(m[1]), b = Number(m[2]);
    const c0 = Math.floor(a / CHUNK), c1 = Math.floor(b / CHUNK);
    const store = await this.store;
    const parts = new Map();
    for (let k = c0; k <= c1; k++) {
      if (!store) break;
      try {
        const hit = await store.match(this._key(k));
        if (hit) {
          parts.set(k, new Uint8Array(await hit.arrayBuffer()));
          const t = Number(hit.headers.get('x-total'));
          if (t) this.total = t;
        }
      } catch (e) { /* keeping is a bonus */ }
    }
    // Fetch each run of missing pieces with one request.
    for (let k = c0; k <= c1; k++) {
      if (parts.has(k)) continue;
      let e = k;
      while (e + 1 <= c1 && !parts.has(e + 1)) e++;
      const from = k * CHUNK;
      let to = (e + 1) * CHUNK - 1;
      if (this.total) to = Math.min(to, this.total - 1);
      const r = await this.fetch(this.url, { headers: { Range: `bytes=${from}-${to}` }, signal, mode: 'cors' });
      if (r.status !== 206 && r.status !== 200) throw new Error('survey HTTP ' + r.status);
      const data = new Uint8Array(await r.arrayBuffer());
      this.downloaded += data.length;
      let start = from;
      if (r.status === 206) {
        const cr = /bytes (\d+)-(\d+)\/(\d+|\*)/.exec(r.headers.get('content-range') || '');
        if (cr) { start = Number(cr[1]); if (cr[3] !== '*') this.total = Number(cr[3]); }
      } else {
        start = 0; this.total = data.length;
      }
      for (let q = k; q <= e; q++) {
        const off = q * CHUNK - start;
        if (off < 0 || off >= data.length) continue;
        const piece = data.slice(off, Math.min(data.length, off + CHUNK));
        parts.set(q, piece);
        if (store) {
          const h = new Headers({ 'content-type': 'application/octet-stream' });
          if (this.total) h.set('x-total', String(this.total));
          store.put(this._key(q), new Response(piece, { status: 200, headers: h })).catch(() => {});
        }
      }
      k = e;
    }
    const end = this.total ? Math.min(b, this.total - 1) : b;
    const out = new Uint8Array(Math.max(0, end - a + 1));
    for (let k = c0; k <= c1; k++) {
      const p = parts.get(k);
      if (!p) continue;
      const s = Math.max(a, k * CHUNK), e = Math.min(end, k * CHUNK + p.length - 1);
      if (e >= s) out.set(p.subarray(s - k * CHUNK, e - k * CHUNK + 1), s - a);
    }
    const total = this.total;
    return {
      ok: true, status: 206,
      getHeader: (name) => {
        const n = name.toLowerCase();
        if (n === 'content-range') return `bytes ${a}-${end}/${total || '*'}`;
        if (n === 'content-type') return 'application/octet-stream';
        if (n === 'content-length') return String(out.length);
        return null;
      },
      getData: async () => out.buffer,
    };
  }
}

// ---- which survey file, opened once per helper --------------------------------

let lib = null;
const loadLib = () => (lib || (lib = import(/* external */ GEOTIFF_URL)));

const pieces = [];               // catalogue answers: { bbox, href } (bbox may be null)
const noPiece = new Set();       // zoom-10 tiles the catalogue said nothing for
const opened = new Map();        // href -> Promise<{ survey, blocks }>

async function pieceFor(z, x, y) {
  const s = tileSizeMerc(z), nw = tileToMerc(x, y, z);
  const lon0 = mercXToLon(nw.x), lon1 = mercXToLon(nw.x + s), lat0 = mercYToLat(nw.y - s), lat1 = mercYToLat(nw.y);
  for (const p of pieces) {
    const b = p.bbox;
    if (b && lon0 >= b[0] && lon1 <= b[2] && lat0 >= b[1] && lat1 <= b[3]) return p;
  }
  const k10 = z >= 10 ? (x >> (z - 10)) + '/' + (y >> (z - 10)) : null;
  if (k10 && noPiece.has(k10)) return null;
  const p = await findPiece(lon0, lat0, lon1, lat1, 'dtm');
  if (!p) { if (k10) noPiece.add(k10); return null; }
  if (!pieces.some((q) => q.href === p.href)) pieces.push(p);
  return p;
}

function openCached(href) {
  if (!opened.has(href)) {
    const p = (async () => {
      const G = await loadLib();
      const client = new CachedRangeClient(href);
      const tiff = await G.fromCustomClient(client, { allowFullFile: false, cacheSize: 64 });
      const survey = await describeSurvey(tiff, href);
      return { survey, blocks: new SurveyBlocks(survey, SURVEY_BLOCKS_PER_HELPER), client };
    })();
    opened.set(href, p);
    p.catch(() => opened.delete(href));
  }
  return opened.get(href);
}

// ---- the usual tile, for whatever the survey does not cover -------------------

async function usualHeights(z, x, y) {
  const pz = Math.min(z, 14), d = z - pz, px = x >> d, py = y >> d;
  const r = await cachedFetch(TILE_URL.replace('{z}', pz).replace('{x}', px).replace('{y}', py), { mode: 'cors' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  const bmp = await createImageBitmap(await r.blob());
  const cv = new OffscreenCanvas(PX, PX), cx = cv.getContext('2d', { willReadFrequently: true });
  cx.drawImage(bmp, 0, 0, PX, PX); bmp.close();
  const h = decodeTerrarium(cx.getImageData(0, 0, PX, PX).data, pxMetersFor(pz, py));
  if (!d) return h;
  // A finer tile: its part of the zoom-14 tile, enlarged.
  const n = 1 << d, ox = x - (px << d), oy = y - (py << d), out = new Float32Array(PX * PX);
  for (let j = 0; j < PX; j++) for (let i = 0; i < PX; i++) {
    out[j * PX + i] = sample(h, (ox + i / (PX - 1)) / n * (PX - 1), (oy + j / (PX - 1)) / n * (PX - 1));
  }
  return out;
}

// ---- a survey tile ----------------------------------------------------------------

// Heights for tile z/x/y laid out as an elevation tile (pixel i of 256 sits at
// i/255 of the way across, edge to edge). Returns { heights, surveyed (0..1),
// cell (metres, the survey level used), note }.
export async function surveyTileHeights(z, x, y) {
  const usual = usualHeights(z, x, y);
  let piece = null, opened2 = null, note = '';
  try {
    piece = await pieceFor(z, x, y);
    if (piece) opened2 = await openCached(piece.href);
  } catch (e) { note = String(e && e.message || e); }
  if (!opened2) return { heights: await usual, surveyed: 0, cell: 0, note: note || 'no survey here' };
  const { survey, blocks } = opened2;
  const s = tileSizeMerc(z), nw = tileToMerc(x, y, z);
  const k = Math.cos(mercYToLat(nw.y - s / 2) * Math.PI / 180);
  const lvl = levelFor(survey, s * k / 128), li = survey.levels.indexOf(lvl);
  // Canada's grid at a 17 x 17 lattice over the tile, smoothly in between.
  const M = 16, LX = new Float64Array((M + 1) ** 2), LY = new Float64Array((M + 1) ** 2);
  let X0 = Infinity, Y0 = Infinity, X1 = -Infinity, Y1 = -Infinity;
  for (let j = 0; j <= M; j++) for (let i = 0; i <= M; i++) {
    const [X, Y] = toCanadaAtlas(mercXToLon(nw.x + s * i / M), mercYToLat(nw.y - s * j / M));
    LX[j * (M + 1) + i] = X; LY[j * (M + 1) + i] = Y;
    X0 = Math.min(X0, X); X1 = Math.max(X1, X); Y0 = Math.min(Y0, Y); Y1 = Math.max(Y1, Y);
  }
  try { await blocks.ensure(li, X0, Y0, X1, Y1); }
  catch (e) { return { heights: await usual, surveyed: 0, cell: 0, note: 'survey read failed: ' + (e && e.message || e) }; }
  const out = new Float32Array(PX * PX);
  let got = 0;
  for (let j = 0; j < PX; j++) {
    const fv = j / (PX - 1) * M, jj = Math.min(M - 1, Math.floor(fv)), tv = fv - jj;
    for (let i = 0; i < PX; i++) {
      const fu = i / (PX - 1) * M, ii = Math.min(M - 1, Math.floor(fu)), tu = fu - ii, q = jj * (M + 1) + ii;
      const X = (LX[q] * (1 - tu) + LX[q + 1] * tu) * (1 - tv) + (LX[q + M + 1] * (1 - tu) + LX[q + M + 2] * tu) * tv;
      const Y = (LY[q] * (1 - tu) + LY[q + 1] * tu) * (1 - tv) + (LY[q + M + 1] * (1 - tu) + LY[q + M + 2] * tu) * tv;
      const v = blocks.at(li, X, Y);
      out[j * PX + i] = v;
      if (!Number.isNaN(v)) got++;
    }
  }
  if (got < PX * PX) {
    const u = await usual;
    for (let i = 0; i < out.length; i++) if (Number.isNaN(out[i])) out[i] = u[i];
  }
  return { heights: out, surveyed: got / (PX * PX), cell: lvl.cell, note: '' };
}
