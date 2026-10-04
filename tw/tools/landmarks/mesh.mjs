// Tiny mesh builder for toy-resolution landmark models.
// Units: metres. x = east, y = up, z = south/north (just a horizontal axis). Origin: centre of the base on the ground.
// Every vertex carries a flat RGB colour (0-255). No textures.

const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const len = (a) => Math.hypot(a[0], a[1], a[2]);
const norm = (a) => { const l = len(a) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const d2 = (p, q) => (p[0] - q[0]) ** 2 + (p[1] - q[1]) ** 2;

export function ringPts(cx, cz, rx, rz, n, rot = 0) {
  const pts = [];
  for (let k = 0; k < n; k++) {
    const a = rot + (2 * Math.PI * k) / n;
    pts.push([cx + rx * Math.cos(a), cz + rz * Math.sin(a)]);
  }
  return pts;
}

export class Mesh {
  constructor() { this.pos = []; this.col = []; this.idx = []; }
  v(x, y, z, c) { this.pos.push(x, y, z); this.col.push(c[0], c[1], c[2]); return this.pos.length / 3 - 1; }
  get tris() { return this.idx.length / 3; }

  // Loft between layers of plan-view points. layers: [{y, pts:[[x,z],...], c}], same point count in all layers.
  // The colour of the band between layer i-1 and i is layers[i].c (falls back to layers[i-1].c).
  loftPts(layers, opts = {}) {
    const n = layers[0].pts.length;
    for (let i = 1; i < layers.length; i++) {
      const A = layers[i - 1], B = layers[i];
      const c = B.c || A.c;
      const a = [], b = [];
      for (let k = 0; k < n; k++) {
        a.push(this.v(A.pts[k][0], A.y, A.pts[k][1], c));
        b.push(this.v(B.pts[k][0], B.y, B.pts[k][1], c));
      }
      for (let k = 0; k < n; k++) {
        const k2 = (k + 1) % n;
        const da = d2(A.pts[k], A.pts[k2]) < 1e-9, db = d2(B.pts[k], B.pts[k2]) < 1e-9;
        if (da && db) continue;
        if (da) this.idx.push(a[k], b[k2], b[k]);
        else if (db) this.idx.push(a[k], a[k2], b[k]);
        else this.idx.push(a[k], a[k2], b[k2], a[k], b[k2], b[k]);
      }
    }
    if (opts.capBottom) this._cap(layers[0], layers[1].c || layers[0].c);
    if (opts.capTop) this._cap(layers[layers.length - 1], layers[layers.length - 1].c || layers[layers.length - 2].c);
  }
  _cap(L, c) {
    const n = L.pts.length;
    let cx = 0, cz = 0;
    for (const p of L.pts) { cx += p[0]; cz += p[1]; }
    cx /= n; cz /= n;
    let spread = 0;
    for (const p of L.pts) spread = Math.max(spread, d2(p, [cx, cz]));
    if (spread < 1e-9) return;
    const o = this.v(cx, L.y, cz, c);
    const ids = L.pts.map((p) => this.v(p[0], L.y, p[1], c));
    for (let k = 0; k < n; k++) this.idx.push(o, ids[k], ids[(k + 1) % n]);
  }

  // Round-ish loft: rings = [{y, r | (rx,rz), cx, cz, rot, c}], n sides.
  loft(rings, n, opts = {}) {
    const layers = rings.map((r) => ({
      y: r.y,
      pts: ringPts(r.cx || 0, r.cz || 0, r.rx ?? r.r, r.rz ?? r.rx ?? r.r, n, (r.rot || 0) + (opts.rot || 0)),
      c: r.c,
    }));
    this.loftPts(layers, opts);
  }

  box(cx, cy, cz, sx, sy, sz, c) {
    const rect = [[cx - sx / 2, cz - sz / 2], [cx + sx / 2, cz - sz / 2], [cx + sx / 2, cz + sz / 2], [cx - sx / 2, cz + sz / 2]];
    this.loftPts([{ y: cy - sy / 2, pts: rect, c }, { y: cy + sy / 2, pts: rect, c }], { capBottom: true, capTop: true });
  }

  // Straight tube between two 3D points (any direction).
  tube(a, b, r0, r1, c, n = 6, caps = false) {
    const d = norm(sub(b, a));
    const ref = Math.abs(d[1]) < 0.95 ? [0, 1, 0] : [1, 0, 0];
    const u = norm(cross(ref, d));
    const w = cross(d, u);
    const ra = [], rb = [];
    for (let k = 0; k < n; k++) {
      const ang = (2 * Math.PI * k) / n + Math.PI / n;
      const dir = [u[0] * Math.cos(ang) + w[0] * Math.sin(ang), u[1] * Math.cos(ang) + w[1] * Math.sin(ang), u[2] * Math.cos(ang) + w[2] * Math.sin(ang)];
      ra.push(this.v(a[0] + dir[0] * r0, a[1] + dir[1] * r0, a[2] + dir[2] * r0, c));
      rb.push(this.v(b[0] + dir[0] * r1, b[1] + dir[1] * r1, b[2] + dir[2] * r1, c));
    }
    for (let k = 0; k < n; k++) {
      const k2 = (k + 1) % n;
      this.idx.push(ra[k], ra[k2], rb[k2], ra[k], rb[k2], rb[k]);
    }
    if (caps) {
      const oa = this.v(a[0], a[1], a[2], c), ob = this.v(b[0], b[1], b[2], c);
      for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; this.idx.push(oa, ra[k], ra[k2], ob, rb[k2], rb[k]); }
    }
  }

  sphere(cx, cy, cz, r, c, seg = 12, rings = 8) {
    const rs = [];
    for (let i = 0; i <= rings; i++) {
      const phi = -Math.PI / 2 + (Math.PI * i) / rings;
      let rad = r * Math.cos(phi);
      if (i === 0 || i === rings) rad = 0;
      rs.push({ y: cy + r * Math.sin(phi), r: rad, cx, cz, c });
    }
    this.loft(rs, seg);
  }

  get bounds() {
    const b = { min: [1e9, 1e9, 1e9], max: [-1e9, -1e9, -1e9] };
    for (let i = 0; i < this.pos.length; i += 3) for (let k = 0; k < 3; k++) {
      b.min[k] = Math.min(b.min[k], this.pos[i + k]); b.max[k] = Math.max(b.max[k], this.pos[i + k]);
    }
    return b;
  }
}
