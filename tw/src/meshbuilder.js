// Accumulates coloured triangles into transferable buffers.
// Vertex layout, 16 bytes: x, y, z as float32, then r, g, b, a as bytes.
// Positions are tile-local unscaled mercator metres, same convention as terrain.
//
// A second, separate array holds 4 "info" bytes per vertex (see INFO below).
// It is a separate buffer so the 16-byte layout above stays as it was.

export class MeshBuilder {
  constructor() { this.pos = []; this.col = []; this.info = []; this.idx = []; }

  get verts() { return this.col.length; }

  vert(x, y, z, rgba, info = 0) {
    this.pos.push(x, y, z);
    this.col.push(rgba);
    this.info.push(info);
    return this.col.length - 1;
  }

  tri(a, b, c) { this.idx.push(a, b, c); }

  finish() {
    const n = this.col.length;
    const buf = new ArrayBuffer(n * 16);
    const f = new Float32Array(buf), u = new Uint32Array(buf);
    for (let i = 0; i < n; i++) {
      f[4 * i] = this.pos[3 * i];
      f[4 * i + 1] = this.pos[3 * i + 1];
      f[4 * i + 2] = this.pos[3 * i + 2];
      u[4 * i + 3] = this.col[i];
    }
    const out = { vertices: buf, indices: new Uint32Array(this.idx), verts: n, info: new Uint32Array(this.info) };
    // Optional: four numbers per vertex for windows drawn by the shader
    // (buildings.js, opt.faces). Only buildings fill it, and only when asked.
    if (this.fac) out.fac = new Float32Array(this.fac);
    return out;
  }
}

// Little-endian bytes r, g, b, 255 packed for the uint32 view above.
export const rgba = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;

// Info bytes, packed the same way:
//   r  building type (look.js TYPE_NAMES, low 4 bits), 0 = unknown, plus the
//      size group (look.js SIZE_NAMES) times 16
//   g  per-building number 0..255 (picks a colour from the set)
//   b  wall shade, 255 = full colour
//   a  flags: 1 = building (the shader picks its colour), 2 = has a map colour,
//      4 = roof, 8 = under a landmark (hidden unless the mask is off)
// All zero means "use the vertex colour as it is" (roads, rails, airports).
export const INFO_BUILDING = 1, INFO_REAL = 2, INFO_ROOF = 4, INFO_MASKED = 8;
export const info = (type, num, shade, flags) =>
  ((flags << 24) | (shade << 16) | (num << 8) | type) >>> 0;
