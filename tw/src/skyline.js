// Skyline: the tall buildings beyond the near field, out to about 20 km.
//
// Built in two stages, so the countryside costs almost nothing:
//   1. Cheap marker tiles at zoom 13. They carry no building heights, so all
//      they can say is how built-up the tile is.
//   2. For the built-up ones only, the four zoom-14 tiles beneath, built with
//      just the tall buildings (heights are only there at zoom 14).
// The near field's block is skipped; that ground is the near field's.

import { mercToTile } from './geo.js';
import { SKY_MIN_HEIGHT, SKY_URBAN, SKY_URBAN_BUILT } from './config.js';
import { TileLayer } from './tilelayer.js';

const SKY_WORKERS = 2;
const KEEP_TILES = 600;

// Is tile (x, y) at zoom z wholly inside a block of zoom-14 tiles?
export function insideBlock(block, x, y, z) {
  if (!block) return false;
  const s = 1 << (14 - z);
  return x * s >= block.x0 && (x + 1) * s - 1 <= block.x1 && y * s >= block.y0 && (y + 1) * s - 1 <= block.y1;
}

export class SkylineLayer extends TileLayer {
  constructor(gl, mesh, getTemplate, opts = {}) {
    super(gl, mesh, getTemplate, { zoom: 13, workers: opts.workers || SKY_WORKERS });
    this.R = 1;
    this.maxRing = 1;
    this.cx14 = 0; this.cy14 = 0;
    this.nMarkers = 0; this.nKids = 0;
  }

  // view:    from detail.js (position, and whether the near field is on)
  // radius:  zoom-13 tiles each side of the camera
  // block:   the near field's block, which this layer leaves alone
  // fetchOk: allowed to request new tiles (handover.js holds this back until
  //          the near field has finished)
  update(view, radius, block, fetchOk) {
    this.active = view.nearOn && !!block;
    this.R = radius;
    this.maxRing = radius + 3;     // never draw tiles farther than this, in zoom-13 tiles
    this.blocked = !fetchOk;
    if (!this.active || this.disabled) { this.want = []; return; }
    const t13 = mercToTile(view.mercX, view.mercY, 13), t14 = mercToTile(view.mercX, view.mercY, 14);
    const cx = Math.floor(t13.x), cy = Math.floor(t13.y);
    this.cx14 = Math.floor(t14.x); this.cy14 = Math.floor(t14.y);
    const n = Math.pow(2, 13);
    const markers = [];
    const kids = [];                         // zoom-14 children of built-up markers
    for (let y = Math.max(0, cy - radius); y <= Math.min(n - 1, cy + radius); y++) {
      for (let x = cx - radius; x <= cx + radius; x++) {
        if (insideBlock(block, x, y, 13)) continue;
        const key = '13/' + x + '/' + y;
        markers.push({ key, rawX: x, y, z: 13, marker: true });
        const m = this.tiles.get(key);
        if (m && m.urban) {
          for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
            kids.push({ key: '14/' + (2 * x + dx) + '/' + (2 * y + dy), rawX: 2 * x + dx, y: 2 * y + dy, z: 14 });
          }
        }
      }
    }
    this.want = markers.concat(kids);
    this.nMarkers = markers.length;
    this.nKids = kids.length;
    this._evict(KEEP_TILES);
    this._request(fetchOk, (s) => this._dist14(s));
  }

  // Squared distance from the camera, in zoom-14 tiles, of a tile's centre.
  _dist14(s) {
    const x = s.z === 13 ? 2 * s.rawX + 1 : s.rawX, y = s.z === 13 ? 2 * s.y + 1 : s.y;
    return (x - this.cx14) ** 2 + (y - this.cy14) ** 2;
  }

  _jobOptions(spec) { return { skyline: true, marker: !!spec.marker, skyMin: SKY_MIN_HEIGHT }; }

  _tileExtras(spec, msg) {
    const marker = !!spec.marker;
    return {
      marker,
      urban: marker && !!msg.stats && (msg.stats.cover >= SKY_URBAN || msg.stats.built >= SKY_URBAN_BUILT),
    };
  }

  // Does this layer fully cover this zoom-13 square, so the near field can stop
  // drawing its own copy without leaving a hole?
  owns(x13, y13) {
    const m = this.tiles.get('13/' + x13 + '/' + y13);
    if (!m) return false;
    if (!m.urban) return true;
    for (let dy = 0; dy < 2; dy++) for (let dx = 0; dx < 2; dx++) {
      const key = '14/' + (2 * x13 + dx) + '/' + (2 * y13 + dy);
      if (!this.tiles.has(key) && !this.failed.has(key)) return false;
    }
    return true;
  }

  // Skyline tiles carry buildings only, and only their top tier (the skyline
  // buildings, written first in each tile) is drawn. The old code reached the
  // same result through a ring test that compared zoom-14 tiles against the
  // zoom-13 camera tile, which always came out as "far".
  draw(pass, bldOn) {
    if (!this.active || !bldOn) return 0;
    const tiles = [];
    const limit = 2 * this.maxRing;           // in zoom-14 tiles
    for (const t of this.tiles.values()) {
      if (!t.count) continue;
      const s = 1 << (14 - t.z);
      if (Math.max(Math.abs(t.rawX * s + s / 2 - this.cx14), Math.abs(t.y * s + s / 2 - this.cy14)) > limit) continue;
      if (this.skip(t)) continue;
      tiles.push(t);
    }
    return this._drawTiles(tiles, pass, false, true, () => 3);
  }

  get status() {
    if (this.disabled) return 'off (no worker)';
    if (!this.active) return 'off';
    let marks = 0, urban = 0, kids = 0, tris = 0, bld = 0;
    for (const t of this.tiles.values()) {
      if (t.z === 13) { marks++; if (t.urban) urban++; } else { kids++; tris += t.count / 3; if (t.stats) bld += t.stats.kept; }
    }
    return marks + '/' + this.nMarkers + ' urban ' + urban + ' z14 ' + kids + '/' + this.nKids +
      ' ' + (tris / 1000).toFixed(0) + 'k tris ' + bld + ' bldg' + (this.blocked ? ' (waiting)' : '');
  }
}
