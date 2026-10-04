// Owns the GPU buffers for loaded tiles, decides what to request, and draws.

import * as G from './gl.js';
import { TERRAIN_VS, TERRAIN_FS } from './shaders.js';
import { probe } from './perf.js';
import { computeBlocks } from './rings.js';
import { keyOf } from './tiles.js';
import { CACHE_TILES, LEVELS, SKIRT } from './config.js';
import { tileSizeMerc, mercToTile, HALF } from './geo.js';

const PX = 256;

export class Terrain {
  constructor(gl, loader) {
    this.gl = gl;
    this.prog = G.program(gl, TERRAIN_VS, TERRAIN_FS);
    this.u = G.uniforms(gl, this.prog, ['uProj', 'uView', 'uTileOffset', 'uScale', 'uCamAlt',
      'uCurv', 'uSkirt', 'uFogColor', 'uFogDensity', 'uSunDir',
      'uTileSize', 'uMask', 'uCover', 'uLayers', 'uDebug', 'uLevel', 'uNearRect']);
    gl.useProgram(this.prog);
    gl.uniform1i(this.u.uMask, 0);    // texture units
    gl.uniform1i(this.u.uCover, 1);
    // Bound wherever a tile has no water data, so the shader needs no branch.
    this.aniso = gl.getExtension('EXT_texture_filter_anisotropic');
    this.anisoMax = this.aniso
      ? gl.getParameter(this.aniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) : 1;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    this.blank = this._tex(1, 1, gl.RGBA8, gl.RGBA, new Uint8Array(4));
    this.blankRGB = this._tex(1, 1, gl.RGB8, gl.RGB, new Uint8Array(3));
    this.loader = loader;
    this.tiles = new Map();     // key -> record, iteration order is LRU order
    this.visible = [];
    loader.onTile = (key, spec, msg) => this._upload(key, spec, msg);
  }

  _tex(w, h, internal, format, data) {
    const gl = this.gl;
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, internal, w, h, 0, format, gl.UNSIGNED_BYTE, data);
    // Mipmaps matter more here than usual. Roads are one or two texels wide and
    // pale; without mipmaps a distant screen pixel point-samples whichever texel
    // it happens to land on, and that choice changes every frame as the camera
    // moves. That is the sparkle.
    if (w > 1) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      // Terrain is viewed at grazing angles, where plain mipmapping over-blurs
      // along one axis. Anisotropy is what keeps roads readable into the distance.
      if (this.aniso) {
        gl.texParameterf(gl.TEXTURE_2D, this.aniso.TEXTURE_MAX_ANISOTROPY_EXT,
                         Math.min(8, this.anisoMax));
      }
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    return t;
  }

  _upload(key, spec, msg) {
    const t0 = performance.now();
    this._uploadInner(key, spec, msg);
    probe.uploadMs += performance.now() - t0;
    probe.terrainTiles++;
  }

  _uploadInner(key, spec, msg) {
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

    let tex = null, cover = null;
    if (msg.mask) {
      const n = Math.round(Math.sqrt(msg.mask.length / 4));
      tex = this._tex(n, n, gl.RGBA8, gl.RGBA, msg.mask);
      cover = this._tex(n, n, gl.RGB8, gl.RGB, msg.cover);
    }

    this.tiles.set(key, {
      tex, cover,
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
    // Protect everything WANTED, not merely everything currently drawn. A tile
    // held back by substitution is not in `visible`, but it is about to be
    // needed — evicting it forces a refetch at exactly the wrong moment, which
    // looks like something being destroyed with nothing to replace it.
    const live = this.wantedKeys || new Set(this.visible.map((t) => t.key));
    for (const [k, t] of this.tiles) {
      if (this.tiles.size <= CACHE_TILES) break;
      if (live.has(k)) continue;
      gl.deleteVertexArray(t.vao);
      gl.deleteBuffer(t.vbo);
      gl.deleteBuffer(t.ibo);
      if (t.tex) gl.deleteTexture(t.tex);
      if (t.cover) gl.deleteTexture(t.cover);
      this.tiles.delete(k);
      this._evicted = (this._evicted || 0) + 1;
    }
  }

  // Work out which tiles should be on screen, request the missing ones,
  // and record what is drawable this frame.
  // `lead*` is where the camera will be in a few seconds. Fetching is centred on
  // both, drawing only on the real position, so tiles are already there when
  // you arrive instead of loading after you have passed.
  update(view) {
    return this.plan(view.mercX, view.mercY, view.minLevel, view.drawLevels,
      view.lead.x, view.lead.y, view.lead.use);
  }

  plan(mercX, mercY, minLevel, activeLevels, leadX, leadY, useLead) {
    // Three separate questions. Conflating any two of them has now caused a
    // bug each time:
    //
    //   FETCH  - levels we can sustain at this speed. A tile replaced before it
    //            loads never converges, so requesting it just thrashes.
    //   DRAW   - every level, down to the finest ALREADY IN MEMORY. Speed is no
    //            reason to throw away detail we already hold.
    //   HOLD   - a coarse tile stays until its replacements have actually
    //            arrived, so nothing is ever destroyed without a stand-in.
    this.minLevel = minLevel;
    const fetchLevels = LEVELS.slice(minLevel, activeLevels);
    const drawLevels = LEVELS.slice(0, activeLevels);
    if (!fetchLevels.length) return 0;

    const has = (z, x, y) => this.tiles.has(keyOf(z, x, y));
    const fetchList = computeBlocks(mercX, mercY, fetchLevels);
    for (const b of fetchList) b.level += minLevel;
    if (useLead) {
      const seen = new Set(fetchList.map((b) => keyOf(b.z, b.x, b.y)));
      for (const b of computeBlocks(leadX, leadY, fetchLevels)) {
        const k = keyOf(b.z, b.x, b.y);
        if (seen.has(k)) continue;
        seen.add(k);
        b.level += minLevel;
        b.lead = true;
        fetchList.push(b);
      }
    }
    const blocks = computeBlocks(mercX, mercY, drawLevels, has);

    const wanted = new Set();
    this.visible = [];
    this.missing = 0;
    this.holes = 0;

    // Draw whatever is loaded, finest first.
    for (const b of blocks) {
      const key = keyOf(b.z, b.x, b.y);
      const t = this.tiles.get(key);
      if (t) {
        t.used = performance.now();
        this.tiles.delete(key); this.tiles.set(key, t);
        this.visible.push(t);
      } else {
        this.holes++;
      }
    }

    // Request only the sustainable levels.
    for (const b of fetchList) {
      const key = keyOf(b.z, b.x, b.y);
      wanted.add(key);
      if (this.tiles.has(key)) continue;
      this.missing++;
      const ct = mercToTile(mercX, mercY, b.z);
      const dist = Math.hypot(b.rawX + 0.5 - ct.x, b.rawY + 0.5 - ct.y);
      this.loader.want({
        key, z: b.z, x: b.x, y: b.y, rawX: b.rawX, rawY: b.rawY,
        grid: b.grid, level: b.level,
        keepHeights: b.level === minLevel,
        priority: (activeLevels - 1 - b.level) * 100 + dist + (b.lead ? 50 : 0),
      });
    }

    // Anything on screen must survive eviction, whether or not we would
    // re-request it at this speed.
    for (const t of this.visible) wanted.add(t.key);
    this.wantedKeys = wanted;
    this.loader.keepOnly(wanted);
    this.loader.pump();
    return fetchList.length;
  }

  // pass:    the camera for this depth pass (main.js)
  // shading: what is the same for every tile this frame
  //          { fogColor, fogDensity, debug, layers: [water, roads, built, cover], nearRect }
  draw(pass, shading) {
    const gl = this.gl, u = this.u;
    gl.useProgram(this.prog);
    G.setCamera(gl, u, pass);
    gl.uniform1f(u.uScale, pass.k);
    gl.uniform1f(u.uSkirt, SKIRT);
    gl.uniform3fv(u.uFogColor, shading.fogColor);
    // Density 0 disables fog exactly: 1 - exp(0) = 0, no branch needed.
    gl.uniform1f(u.uFogDensity, shading.fogDensity);
    gl.uniform1f(u.uDebug, shading.debug);
    gl.uniform4fv(u.uLayers, shading.layers);
    // Painted roads fade out inside the area the real geometry covers.
    gl.uniform4fv(u.uNearRect, shading.nearRect);
    let drawn = 0;
    for (const t of this.visible) {
      gl.uniform2f(u.uTileOffset,
        (t.centre.x - pass.mercX) * pass.k,
        (pass.mercY - t.centre.y) * pass.k);
      gl.uniform1f(u.uTileSize, t.size);
      gl.uniform1f(u.uLevel, t.level);
      gl.activeTexture(gl.TEXTURE0);
      gl.bindTexture(gl.TEXTURE_2D, t.tex || this.blank);
      gl.activeTexture(gl.TEXTURE1);
      gl.bindTexture(gl.TEXTURE_2D, t.cover || this.blankRGB);
      gl.bindVertexArray(t.vao);
      gl.drawElements(gl.TRIANGLES, t.count, gl.UNSIGNED_SHORT, 0);
      drawn++;
    }
    return drawn;
  }

  // Ground elevation at a mercator position, bilinear from the level-0 tile
  // that contains it. Returns null when that tile has not arrived yet.
  heightAt(mercX, mercY) {
    const z = LEVELS[this.minLevel || 0].z;
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

  get evicted() { return this._evicted || 0; }

  // How many visible tiles actually got a water mask. If this reads 0/N the
  // vector fetch is failing and the overlay is silently doing nothing.
  get waterCount() {
    let n = 0;
    for (const t of this.visible) if (t.tex) n++;
    return n;
  }
}
