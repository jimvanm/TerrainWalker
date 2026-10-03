// Accumulates coloured triangles into transferable buffers.
// Vertex layout, 16 bytes: x, y, z as float32, then r, g, b, a as bytes.
// Positions are tile-local unscaled mercator metres, same convention as terrain.

export class MeshBuilder {
  constructor() { this.pos = []; this.col = []; this.idx = []; }

  get verts() { return this.col.length; }

  vert(x, y, z, rgba) {
    this.pos.push(x, y, z);
    this.col.push(rgba);
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
    return { vertices: buf, indices: new Uint32Array(this.idx), verts: n };
  }
}

// Little-endian bytes r, g, b, 255 packed for the uint32 view above.
export const rgba = (r, g, b) => ((255 << 24) | (b << 16) | (g << 8) | r) >>> 0;
