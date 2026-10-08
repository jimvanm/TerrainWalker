// Today's ground (the app's height tiles), sampled at any local point
// (ground labs). Tiles are fetched once per zoom and kept. Positions are local
// metres (x east, z south) round a place's middle.

import { TILE_URL } from './config.js';
import { lonToMercX, latToMercY, mercToTile } from './geo.js';
import { localToLatLon } from './hrdemsource.js';

export class TodayGround {
  constructor(lat, lon) {
    this.lat = lat; this.lon = lon;
    this.tiles = new Map();     // 'z/x/y' -> Float32Array(256 * 256), or a Promise while loading
    this.last = null; this.lastKey = null;
  }

  _tileAt(Z, x, z) {
    const [la, lo] = localToLatLon(this.lat, this.lon, x, z);
    return mercToTile(lonToMercX(lo), latToMercY(la), Z);
  }

  // Fetch every tile at zoom Z under the local box.
  async ensure(Z, x0, z0, x1, z1) {
    const a = this._tileAt(Z, x0, z0), b = this._tileAt(Z, x1, z1);
    const jobs = [];
    for (let ty = Math.floor(Math.min(a.y, b.y)); ty <= Math.floor(Math.max(a.y, b.y)); ty++) {
      for (let tx = Math.floor(Math.min(a.x, b.x)); tx <= Math.floor(Math.max(a.x, b.x)); tx++) {
        const k = Z + '/' + tx + '/' + ty;
        if (!this.tiles.has(k)) this.tiles.set(k, this._load(Z, tx, ty).then((h) => { this.tiles.set(k, h); return h; }));
        const t = this.tiles.get(k);
        if (t instanceof Promise) jobs.push(t);
      }
    }
    await Promise.all(jobs);
  }

  async _load(Z, tx, ty) {
    const r = await fetch(TILE_URL.replace('{z}', Z).replace('{x}', tx).replace('{y}', ty), { mode: 'cors' });
    if (!r.ok) return new Float32Array(256 * 256);
    const bmp = await createImageBitmap(await r.blob());
    const cv = new OffscreenCanvas(256, 256), cx = cv.getContext('2d');
    cx.drawImage(bmp, 0, 0);
    const d = cx.getImageData(0, 0, 256, 256).data, h = new Float32Array(256 * 256);
    for (let i = 0, p = 0; i < h.length; i++, p += 4) h[i] = d[p] * 256 + d[p + 1] + d[p + 2] / 256 - 32768;
    return h;
  }

  // Height at a local point from zoom Z tiles already fetched (0 if not).
  at(Z, x, z) {
    const t = this._tileAt(Z, x, z);
    const tx = Math.floor(t.x), ty = Math.floor(t.y);
    const key = (Z * 4194304 + ty) * 4194304 + tx;      // a number, not a string: this runs for every point
    let h;
    if (key === this.lastKey) h = this.last;
    else { h = this.tiles.get(Z + '/' + tx + '/' + ty); if (h instanceof Float32Array) { this.last = h; this.lastKey = key; } }
    if (!h || h instanceof Promise) return 0;
    const u = Math.min(255, Math.max(0, (t.x - tx) * 256 - 0.5)), v = Math.min(255, Math.max(0, (t.y - ty) * 256 - 0.5));
    const i = Math.floor(u), j = Math.floor(v), fu = u - i, fv = v - j, i1 = Math.min(255, i + 1), j1 = Math.min(255, j + 1);
    return (h[j * 256 + i] * (1 - fu) + h[j * 256 + i1] * fu) * (1 - fv) + (h[j1 * 256 + i] * (1 - fu) + h[j1 * 256 + i1] * fu) * fv;
  }
}
