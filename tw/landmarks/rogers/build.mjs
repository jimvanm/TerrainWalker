// Rogers Centre, Toronto (roof open): simple solid model built to measured dimensions.
// Builds from profile.json. Writes model.json via:  node tools/bake_landmark.mjs rogers
//
// Body: outer wall and seating bowl as rings of rays from the middle, a few layers high.
// Roof: the open stack over the north end (fixed quarter dome, barrel panels on top) as arch sections.
// Reference frame: x east, z south. Height and width use separate scales (see scale_note in the profile).
import fs from 'node:fs';
import { Mesh } from '../../tools/landmarks/shared.mjs';
import { triangulate } from '../../src/earclip.js';

const RC = JSON.parse(fs.readFileSync(new URL('./profile.json', import.meta.url), 'utf8'));
// Model top: 86 m above the field plus the 7.5 m lift = 93.5 m (landmark.json height).

// Quads between two matching rows of 3D points.
function strip(m, A, B, c) {
  const a = A.map((p) => m.v(p[0], p[1], p[2], c)), b = B.map((p) => m.v(p[0], p[1], p[2], c));
  for (let k = 0; k + 1 < a.length; k++) m.idx.push(a[k], a[k + 1], b[k + 1], a[k], b[k + 1], b[k]);
}
// Loft between closed 3D rings with the same point count.
function loftRings(m, rings, c) {
  const n = rings[0].length;
  for (let i = 1; i < rings.length; i++) {
    const a = rings[i - 1].map((p) => m.v(p[0], p[1], p[2], c)), b = rings[i].map((p) => m.v(p[0], p[1], p[2], c));
    for (let k = 0; k < n; k++) { const k2 = (k + 1) % n; m.idx.push(a[k], a[k2], b[k2], a[k], b[k2], b[k]); }
  }
}
// Flat polygon (any shape) at height y.
function flat(m, pts, y, c) {
  const { src, tris } = triangulate([pts.flat()]);
  const ids = pts.map((p) => m.v(p[0], y, p[1], c));
  for (const t of tris) m.idx.push(ids[src[t]]);
}

export function build() {
  const m = new Mesh();
  const SH = RC.scale_h, SV = RC.scale_v, LIFT = RC.lift, G0 = RC.ground, [CX, CZ] = RC.centre, N = RC.rays;
  const X = (x) => (x - CX) * SH, Z = (z) => (z - CZ) * SH, Y = (y) => LIFT + (y - G0) * SV;
  const WALL = [204, 202, 196], WALL_DK = [168, 166, 160], RIM = [186, 186, 182], SEATS = [72, 98, 140];
  const ROOF = [216, 220, 226], ROOF_END = [176, 180, 186], FIELD = [64, 128, 66], DIRT = [170, 118, 76];
  const ring = (rs) => rs.map((r, k) => { const a = RC.angles[k]; return [r * Math.cos(a) * SH, r * Math.sin(a) * SH]; });
  const B = RC.body, top = B[B.length - 1];

  // outer wall: straight-up bands with a flat step between them; the first band reaches down to the
  // model base (under the ground) and is darker
  const W = RC.walls;
  W.forEach((w, i) => {
    const pts = ring(w.r), c = i === 0 ? WALL_DK : WALL;
    m.loftPts([{ y: i === 0 ? 0 : Y(w.y0), pts, c }, { y: Y(w.y1), pts, c }]);
    if (i > 0) {
      const a = ring(W[i - 1].r), yy = Y(w.y0);
      strip(m, [...a, a[0]].map((p) => [p[0], yy, p[1]]), [...pts, pts[0]].map((p) => [p[0], yy, p[1]]), WALL);
    }
  });
  // seating bowl, from the field to the rim
  const inner = B.map((L, i) => ({ y: i === 0 ? LIFT : Y(L.y), pts: ring(L.inner), c: SEATS }));
  m.loftPts(inner);
  // flat rim between wall and bowl
  const yr = Y(top.y), o = ring(W[W.length - 1].r), n = ring(top.inner);
  strip(m, [...o, o[0]].map((p) => [p[0], yr, p[1]]), [...n, n[0]].map((p) => [p[0], yr, p[1]]), RIM);

  // field and diamond (flat, slightly raised so they do not flicker)
  m._cap(inner[0], FIELD);
  const F = RC.field, P = (p) => [X(p[0]), Z(p[1])];
  const h = P(F.home), s2 = P(F.second), mid = [(h[0] + s2[0]) / 2, (h[1] + s2[1]) / 2];
  const half = [(s2[0] - h[0]) / 2, (s2[1] - h[1]) / 2], perp = [-half[1], half[0]];
  const diamond = (k) => [[mid[0] - half[0] * k, mid[1] - half[1] * k], [mid[0] + perp[0] * k, mid[1] + perp[1] * k],
    [mid[0] + half[0] * k, mid[1] + half[1] * k], [mid[0] - perp[0] * k, mid[1] - perp[1] * k]];
  flat(m, diamond(1.12), LIFT + 0.3, DIRT);
  flat(m, diamond(0.82), LIFT + 0.6, FIELD);

  // east and west walls that rise above the rim, under the ends of the barrel panels
  for (const p of RC.parapets) {
    const pts = p.poly.map(P), y1 = Y(p.top);
    m.loftPts([{ y: yr - 1, pts, c: RIM }, { y: y1, pts, c: RIM }]);
    flat(m, pts, y1, RIM);
  }

  // open roof stack: each section is an arch (outer curve, then the underside back)
  const secs = RC.stack.map((S) => [
    ...S.x.map((x, k) => [X(x), Y(S.out[k]), Z(S.z)]),
    ...S.x.map((x, k) => [X(x), Y(S.in[k]), Z(S.z)]).reverse(),
  ]);
  loftRings(m, secs, ROOF);
  const M = RC.stack[0].x.length;
  for (const sec of [secs[0], secs[secs.length - 1]]) strip(m, sec.slice(0, M), sec.slice(M).reverse(), ROOF_END);
  return m;
}
