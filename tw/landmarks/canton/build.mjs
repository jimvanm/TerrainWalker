// Builds this landmark's shape. Writes model.json via:  node tools/bake_landmark.mjs <id>
import fs from 'node:fs';
import { Mesh, ringPts, interp } from '../../tools/landmarks/shared.mjs';

// ---------- Canton Tower (602 m), measured (profile.json) ----------
// Body: a round hyperboloid. Its top ring is tilted, as in the reference. Mast: tapered tubes with collars.
const CT = JSON.parse(fs.readFileSync(new URL('./profile.json', import.meta.url), 'utf8'));
export function build() {
  const m = new Mesh();
  const S = CT.scale, N = 36;
  const BODY = [212, 216, 222], MAST = [236, 236, 232], COLLAR = [168, 170, 176];
  const rAt = (z) => interp(CT.body, z, 1) * S;
  // Oval rings: same area as the round ring, stretched along a long axis that turns with height.
  // Angles are in the file frame (ccw from +x, y north); the model's z is mirrored.
  const OV = CT.oval.rows;
  const ovalRing = (r, z) => {
    const k = interp(OV, z, 1), psi = (interp(OV, z, 2) * Math.PI) / 180;
    const a = r * Math.sqrt(k), b = r / Math.sqrt(k), c = Math.cos(psi), s = Math.sin(psi);
    return Array.from({ length: N }, (_, i) => {
      const t = (2 * Math.PI * i) / N, u = a * Math.cos(t), w = b * Math.sin(t);
      return [u * c - w * s, -(u * s + w * c)];
    });
  };
  // straight-sided hyperboloid from the ground to just under the top ring
  const flat = CT.body.filter(([z]) => z <= 216).map(([z, r]) => ({ y: z * S, pts: ovalRing(r * S, z), c: BODY }));
  m.loftPts(flat, { capBottom: true });
  // top ring: every point at its own height (a plane tilted about 13 degrees)
  const T = CT.top, last = flat[flat.length - 1];
  const topPts = [], hs = [];
  for (let k = 0; k < N; k++) {
    const q0 = ovalRing(rAt(T.base), T.base)[k], th = Math.atan2(-q0[1], q0[0]);   // true azimuth of this point
    const h = T.base + T.amp * Math.cos(th - (T.phase_deg * Math.PI) / 180);
    topPts.push(ovalRing(rAt(h), h)[k]); hs.push(h * S);
  }
  const A = last.pts.map((p) => m.v(p[0], last.y, p[1], BODY));
  const B = topPts.map((p, k) => m.v(p[0], hs[k], p[1], BODY));
  for (let k = 0; k < N; k++) { const k2 = (k + 1) % N; m.idx.push(A[k], A[k2], B[k2], A[k], B[k2], B[k]); }
  const mid = hs.reduce((u, v) => u + v, 0) / N;
  const o = m.v(0, mid, 0, BODY), C = topPts.map((p, k) => m.v(p[0], hs[k], p[1], BODY));
  for (let k = 0; k < N; k++) m.idx.push(o, C[k], C[(k + 1) % N]);
  // mast, starting inside the body
  const M = CT.mast;
  const isCollar = (z) => [[21.3, 22.9], [33, 34.4], [44.5, 46], [61.9, 63.4], [73.5, 75]].some(([a, b]) => z >= a - 0.01 && z <= b + 0.01);
  const rings = M.rings.map(([z, r], i) => {
    const zz = (M.base + z) * S;
    const prev = M.rings[i - 1];
    const c = prev && isCollar(z) && isCollar(prev[0]) ? COLLAR : MAST;
    return { y: zz, pts: ringPts(0, 0, r * S, r * S, 16), c };
  });
  m.loftPts(rings, { capTop: true });
  return m;
}
