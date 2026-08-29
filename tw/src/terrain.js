// Owns the GPU buffers for loaded tiles, decides what to request, and draws.

import { computeBlocks } from './rings.js';
import { keyOf } from './tiles.js';
import { CACHE_TILES, LEVELS } from './config.js';
import { tileSizeMerc, mercToTile, HALF } from './geo.js';

const PX = 256;

export class Terrain {
  constructor(gl, loader) {
    this.gl = gl;
    this.loader = loader;
    this.tiles = new Map();     // key -> record, iteration order is LRU order
    this.visible = [];
    loader.onTile = (key, spec, msg) => this._upload(key, spec, msg);
  }

  _upload(key, spec, msg) {
    const gl = this.gl;
    if (this.tiles.has(key)) return;
    const vao = gl.createVertexArray();
    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, msg.positions, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, msg.indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);

    this.tiles.set(key, {
      key, vao, vbo, ibo,
      count: msg.indices.length,
      z: spec.z, level: spec.level,
      centre: msg.centre, nw: msg.nw, size: msg.size,
      heights: msg.heights || null,
      used: performance.now(),
    });
    this._evict();
  }

  _evict() {
    const gl = this.gl;
    if (this.tiles.size <= CACHE_TILES) return;
    const live = new Set(this.visible.map((t) => t.key));
    for (const [k, t] of this.tiles) {
      if (this.tiles.size <= CACHE_TILES) break;
      if (live.has(k)) continue;
      gl.deleteVertexArray(t.vao);
      gl.deleteBuffer(t.vbo);
      gl.deleteBuffer(t.ibo);
      this.tiles.delete(k);
    }
  }

  // Work out which tiles should be on screen, request the missing ones,
  // and record what is drawable this frame.
  update(mercX, mercY, activeLevels) {
    const levels = LEVELS.slice(0, activeLevels);
    const blocks = computeBlocks(mercX, mercY, levels);
    const wanted = new Set();
    this.visible = [];
    this.missing = 0;

    for (const b of blocks) {
      const key = keyOf(b.z, b.x, b.y);
      wanted.add(key);
      const t = this.tiles.get(key);
      if (t) {
        t.used = performance.now();
        // Refresh LRU position.
        this.tiles.delete(key); this.tiles.set(key, t);
        this.visible.push(t);
      } else {
        this.missing++;
        // Coarse levels first, so the whole scene appears immediately and then
        // sharpens. Within a level, nearest tile wins.
        const ct = mercToTile(mercX, mercY, b.z);
        const dist = Math.hypot(b.rawX + 0.5 - ct.x, b.rawY + 0.5 - ct.y);
        this.loader.want({
          key, z: b.z, x: b.x, y: b.y, rawX: b.rawX, rawY: b.rawY,
          grid: b.grid, level: b.level,
          keepHeights: b.level === 0,
          priority: (levels.length - 1 - b.level) * 100 + dist,
        });
      }
    }
    this.loader.keepOnly(wanted);
    this.loader.pump();
    return blocks.length;
  }

  draw(u, camMercX, camMercY, k, levelMin, levelMax) {
    const gl = this.gl;
    let drawn = 0;
    for (const t of this.visible) {
      if (t.level < levelMin || t.level > levelMax) continue;
      gl.uniform2f(u.uTileOffset,
        (t.centre.x - camMercX) * k,
        (camMercY - t.centre.y) * k);
      gl.bindVertexArray(t.vao);
      gl.drawElements(gl.TRIANGLES, t.count, gl.UNSIGNED_SHORT, 0);
      drawn++;
    }
    return drawn;
  }

  // Ground elevation at a mercator position, bilinear from the level-0 tile
  // that contains it. Returns null when that tile has not arrived yet.
  heightAt(mercX, mercY) {
    const z = LEVELS[0].z;
    const s = tileSizeMerc(z);
    const n = Math.pow(2, z);
    const fx = (mercX + HALF) / s;
    const fy = (HALF - mercY) / s;
    const tx = ((Math.floor(fx) % n) + n) % n;
    const ty = Math.floor(fy);
    const t = this.tiles.get(keyOf(z, tx, ty));
    if (!t || !t.heights) return null;

    const px = (fx - Math.floor(fx)) * (PX - 1);
    const py = (fy - Math.floor(fy)) * (PX - 1);
    const x0 = Math.max(0, Math.min(PX - 2, Math.floor(px)));
    const y0 = Math.max(0, Math.min(PX - 2, Math.floor(py)));
    const ax = px - x0, ay = py - y0;
    const h = t.heights;
    const a = h[y0 * PX + x0], b = h[y0 * PX + x0 + 1];
    const c = h[(y0 + 1) * PX + x0], d = h[(y0 + 1) * PX + x0 + 1];
    return (a + (b - a) * ax) * (1 - ay) + (c + (d - c) * ax) * ay;
  }

  get loaded() { return this.tiles.size; }
}
