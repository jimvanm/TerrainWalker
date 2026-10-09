// Near field: real road and building geometry for the block of zoom-14 map
// tiles around a low, slow camera. Farther out, the draped textures on the
// terrain and the skyline layer take over.
//
// Geometry is camera-independent and built once per tile in a helper; a moving
// camera only changes uniforms, exactly like the terrain.

import { mercToTile, tileToMerc } from './geo.js';
import { NF_Z, NF_WORKERS } from './config.js';
import { TileLayer } from './tilelayer.js';
import { settings } from './settings.js';
import { OVERTURE_RELEASE, overtureUrl } from './overture.js';
import { surveyGeneration, hasPlaceTile, elevationUrl, SURVEY_PREFIX } from './placetiles.js';

const MAX_RING = 14;      // never draw tiles farther than this, in tiles
const KEEP_TILES = 360;   // tiles held before the farthest unwanted ones are freed

export class NearLayer extends TileLayer {
  constructor(gl, mesh, getTemplate) {
    // Drapes on zoom-14 heights (a place's own tile where it has one), the
    // finest level loaded everywhere whenever this layer is on.
    super(gl, mesh, getTemplate, { zoom: NF_Z, elevationZoom: NF_Z, workers: NF_WORKERS });
    this.block = null;     // wanted area in tiles { x0, x1, y0, y1 }; null when off
    this.rect = null;      // the loaded full-detail area, where painted roads are hidden
    this.ready = false;
    this.R = 1;
    this.cx = 0; this.cy = 0;
  }

  // Called every frame with the view from detail.js.
  //   nearOn       draw at all (decided from height)
  //   nearFetchOk  allowed to request new tiles (decided from speed)
  //   nearR        tiles each side of the camera tile: 2 = 5x5, 3 = 7x7, 4 = 9x9
  update(view) {
    const { nearOn: active, nearFetchOk: fetchOk, nearR: R, lead } = view;
    this.active = active;
    this.R = R;
    this.blocked = !fetchOk;
    if (!active || this.disabled) { this.ready = false; this.want = []; this.rect = null; this.block = null; return; }

    const t = mercToTile(view.mercX, view.mercY, this.Z);
    const cx = Math.floor(t.x), cy = Math.floor(t.y);
    this.cx = cx; this.cy = cy;
    const n = Math.pow(2, this.Z);
    const want = [];
    // The block is stretched outward to whole zoom-13 tiles (pairs of these
    // tiles), so the skyline layer can take over exactly where it stops, with
    // no gap and no overlap.
    const x0 = (cx - R) & ~1, x1 = (cx + R) | 1;
    const y0 = Math.max(0, (cy - R) & ~1), y1 = Math.min(n - 1, (cy + R) | 1);
    this.block = { x0, x1, y0, y1 };
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) want.push({ key: x + '/' + y, rawX: x, y });
    }
    // Look-ahead: a 3x3 around where we will be shortly, so tiles are already
    // loaded when we arrive. Queued behind the tiles around the present position.
    if (lead && lead.use) {
      const lt = mercToTile(lead.x, lead.y, this.Z);
      const lx = Math.floor(lt.x), ly = Math.floor(lt.y);
      const have = new Set(want.map((w) => w.key));
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const y = ly + dy, key = (lx + dx) + '/' + y;
          if (y < 0 || y >= n || have.has(key)) continue;
          have.add(key);
          want.push({ key, rawX: lx + dx, y });
        }
      }
    }
    this.want = want;

    this.rect = this._coverRect(cx, cy, Math.min(R, 1));   // full detail only: that is where painted roads can go
    this.ready = !!this.rect;

    // Keep a margin beyond the wanted area so turning back is free.
    this._evict(KEEP_TILES, (tile) => Math.abs(tile.rawX - cx) <= R + 2 && Math.abs(tile.y - cy) <= R + 2);
    this._request(fetchOk, (s) => (s.rawX - this.cx) ** 2 + (s.y - this.cy) ** 2);
  }

  // The largest block of loaded tiles around the camera tile, grown outward one
  // whole row or column at a time. Painted roads are hidden only inside this
  // block, so a road is never removed where the real one has not arrived. A
  // failed tile is simply not loaded, so the painted road stays there.
  _coverRect(cx, cy, R) {
    const has = (x, y) => this.tiles.has(x + '/' + y);
    if (!has(cx, cy)) return null;
    let x0 = cx, x1 = cx, y0 = cy, y1 = cy;
    const col = (x) => { for (let y = y0; y <= y1; y++) if (!has(x, y)) return false; return true; };
    const row = (y) => { for (let x = x0; x <= x1; x++) if (!has(x, y)) return false; return true; };
    for (let grew = true; grew;) {
      grew = false;
      if (x0 > cx - R && col(x0 - 1)) { x0--; grew = true; }
      if (x1 < cx + R && col(x1 + 1)) { x1++; grew = true; }
      if (y0 > cy - R && row(y0 - 1)) { y0--; grew = true; }
      if (y1 < cy + R && row(y1 + 1)) { y1++; grew = true; }
    }
    const nw = tileToMerc(x0, y0, this.Z), se = tileToMerc(x1 + 1, y1 + 1, this.Z);
    return { w: nw.x, e: se.x, n: nw.y, s: se.y, x0, x1, y0, y1 };
  }

  // The covered block as camera-relative true metres (minX, minZ, maxX, maxZ),
  // for the terrain shader. An empty rectangle when there is nothing to hide.
  rectUniform(camMercX, camMercY, k, roadsOn) {
    const r = this.rect;
    if (!r || !roadsOn || !this.active) return [1, 1, -1, -1];
    return [(r.w - camMercX) * k, (camMercY - r.n) * k, (r.e - camMercX) * k, (camMercY - r.s) * k];
  }

  // Where water is drawn as a flat surface: the same fully loaded block as
  // the roads, so every hole the terrain cuts has a surface in it. An empty
  // rectangle when off.
  waterRectUniform(camMercX, camMercY, k, on) { return this.rectUniform(camMercX, camMercY, k, on); }

  // The flat water of the tiles in that block (watersurface.js). The mesh
  // program must be in use for this pass.
  drawWater(pass) {
    const r = this.rect;
    if (!r || !this.active) return;
    const gl = this.gl, u = this.mesh.u;
    for (const t of this.tiles.values()) {
      if (!t.water || !t.water.count || t.rawX < r.x0 || t.rawX > r.x1 || t.y < r.y0 || t.y > r.y1) continue;
      gl.uniform2f(u.uTileOffset, (t.centre.x - pass.mercX) * pass.k, (pass.mercY - t.centre.y) * pass.k);
      gl.bindVertexArray(t.water.vao);
      gl.drawElements(gl.TRIANGLES, t.water.count, gl.UNSIGNED_INT, 0);
    }
    gl.bindVertexArray(null);
  }

  _ring(t) { return Math.max(Math.abs(t.rawX - this.cx), Math.abs(t.y - this.cy)); }

  // Building style (settings.buildings, key 5) goes with every job; Overture's
  // file address too when that style is on.
  _jobOptions(spec) {
    const style = settings.buildings, sgen = surveyGeneration();
    const o = style === 2 ? { style, sgen, ovtUrl: overtureUrl(OVERTURE_RELEASE) } : { style, sgen };
    // Where the terrain draws zoom-16 ground (Canada's survey, or a place's
    // own tiles), roads and buildings stand on exactly that ground.
    const n = Math.pow(2, this.Z), x = ((spec.rawX % n) + n) % n, y = spec.y;
    const e16 = [];
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      if (!hasPlaceTile(16, x * 4 + i, y * 4 + j)) return o;
      e16.push(elevationUrl(16, x * 4 + i, y * 4 + j));
    }
    o.e16 = e16;
    if (e16.some((u) => u.startsWith(SURVEY_PREFIX))) o.noFlatWater = true;
    return o;
  }

  // A tile built in a style that is no longer wanted is thrown away and asked
  // for again.
  _upload(spec, msg) {
    if (((msg.stats && msg.stats.style) || 0) !== settings.buildings) return;
    if (((msg.stats && msg.stats.sgen) || 0) !== surveyGeneration()) return;
    super._upload(spec, msg);
  }

  // The style changed: drop every tile, so each is built again in the new one.
  // Drawing goes blank for a moment where nothing has arrived yet.
  restyle() {
    for (const t of this.tiles.values()) { this.mesh.freeBuffers(t.roads); this.mesh.freeBuffers(t.bld); if (t.water) this.mesh.freeBuffers(t.water); }
    this.tiles.clear();
    this.failed.clear();
    this.pool.keepOnly(new Set());
  }

  // Draw everything already in memory, not just what is wanted right now.
  // Drawing only the wanted set made far buildings appear while moving
  // (look-ahead tiles were wanted) and vanish the moment you slowed down.
  draw(pass, roadsOn, bldOn) {
    if (!this.active || (!roadsOn && !bldOn)) return 0;
    const tiles = [];
    for (const t of this.tiles.values()) {
      if (t.count && this._ring(t) <= MAX_RING && !this.skip(t)) tiles.push(t);
    }
    return this._drawTiles(tiles, pass, roadsOn, bldOn, (t) => this._ring(t));
  }

  get status() {
    if (this.disabled) return 'off (no worker)';
    if (!this.active) return 'off';
    let n = 0, tris = 0, kept = 0, dropped = 0;
    for (const w of this.want) {
      const t = this.tiles.get(w.key);
      if (t) {
        n++; tris += (this._take(t.roads, t.rEnds, this._ring(t)) + this._take(t.bld, t.bEnds, this._ring(t))) / 3;
        if (t.stats) { kept += t.stats.kept; dropped += t.stats.dropped; }
      }
    }
    const style = ['', ' new look', ' Overture'][settings.buildings] || '';
    return n + '/' + this.want.length + ' r' + this.R + style + ' ' + (tris / 1000).toFixed(0) + 'k tris' +
      (kept ? ' ' + kept + ' bldg' + (dropped ? ' (' + dropped + ' skipped)' : '') : '') +
      (this.blocked ? ' (too fast to fetch)' : '');
  }
}
