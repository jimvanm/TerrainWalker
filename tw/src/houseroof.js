// Pitched roofs for houses (building lab, faces mode only).
//
// Most house outlines are close to a rectangle. For those, the house is built
// on that rectangle: four walls up to the eaves, then a gable roof (two slopes,
// a triangle of wall at each end) or a hip roof (slopes on all four sides).
// The ridge runs along the long side, so a narrow, deep Toronto house shows
// its gable to the street, as most of them do.
//
// Anything not close to a rectangle keeps its own outline and a flat roof.

// The smallest rectangle round a ring (flat [x, y, ...], not closed), turned
// to fit: { cx, cy, ax, ay, bx, by, L, W, area } with (ax, ay) along the long
// side, (bx, by) across it, L and W half the long and short sides.
export function fitRect(ring) {
  const n = ring.length / 2;
  let best = null;
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    let ex = ring[2 * j] - ring[2 * i], ey = ring[2 * j + 1] - ring[2 * i + 1];
    const len = Math.hypot(ex, ey);
    if (len < 1e-6) continue;
    ex /= len; ey /= len;
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (let k = 0; k < n; k++) {
      const x = ring[2 * k], y = ring[2 * k + 1];
      const a = x * ex + y * ey, b = -x * ey + y * ex;
      if (a < a0) a0 = a; if (a > a1) a1 = a; if (b < b0) b0 = b; if (b > b1) b1 = b;
    }
    const area = (a1 - a0) * (b1 - b0);
    if (!best || area < best.area) best = { ex, ey, a0, a1, b0, b1, area };
  }
  if (!best) return null;
  const { ex, ey, a0, a1, b0, b1 } = best;
  const am = (a0 + a1) / 2, bm = (b0 + b1) / 2;
  const cx = am * ex - bm * ey, cy = am * ey + bm * ex;
  let ax = ex, ay = ey, bx = -ey, by = ex, L = (a1 - a0) / 2, W = (b1 - b0) / 2;
  if (W > L) { [L, W] = [W, L]; [ax, ay, bx, by] = [bx, by, -ax, -ay]; }
  return { cx, cy, ax, ay, bx, by, L, W, area: best.area };
}

// Should this house get a pitched roof? fill: the outline's area over the
// rectangle's (both in the same units). k: true metres per unit.
export function pitchable(rect, outlineArea, k) {
  if (!rect) return false;
  const w = rect.W * 2 * k, l = rect.L * 2 * k;
  return outlineArea / rect.area >= 0.8 && w >= 3 && w <= 16 && l <= 40;
}

// The roof's steepness: old houses steeper. age 0 (new) .. 1 (old).
export const pitchFor = (age) => (24 + 16 * age) * Math.PI / 180;

// Builds the house. put(x, y, z, roof, fac, end) adds a corner and returns its
// index: roof true for roof corners, fac the four wall numbers (along, length,
// up, height), end true on the gable or hip ends (the short walls).
// tri(a, b, c) adds a triangle. base: ground height at the highest corner;
// gAt(x, y) the ground under a point; sunk: how far walls start below it;
// eave: wall height above base; k: true metres per unit; hip: hip roof;
// minh: where a raised part starts above the base (0: on the ground).
export function emitPitched(rect, o, put, tri) {
  const { cx, cy, ax, ay, bx, by, L, W } = rect;
  const { base, gAt, sunk, eave, k, hip, pitch, minh = 0 } = o;
  const rise = W * k * Math.tan(pitch);           // ridge above the eaves, metres
  const top = base + eave, ridge = top + rise;
  const P = (s, t) => [cx + ax * s * L + bx * t * W, cy + ay * s * L + by * t * W];
  // corners going round: (-1,-1) (1,-1) (1,1) (-1,1)
  const C = [P(-1, -1), P(1, -1), P(1, 1), P(-1, 1)];
  const sideLen = [2 * L * k, 2 * W * k, 2 * L * k, 2 * W * k];

  // Walls up to the eaves.
  for (let i = 0; i < 4; i++) {
    const p = C[i], q = C[(i + 1) % 4], len = sideLen[i], end = i % 2 === 1;
    const fb = (pt) => (minh > 0 ? base + minh : gAt(pt[0], pt[1]) - sunk);
    const a = put(p[0], fb(p), p[1], false, [0, len, fb(p) - base, eave], end);
    put(p[0], top, p[1], false, [0, len, eave, eave], end);
    const c = put(q[0], fb(q), q[1], false, [len, len, fb(q) - base, eave], end);
    put(q[0], top, q[1], false, [len, len, eave, eave], end);
    tri(a, c, a + 1); tri(c, c + 1, a + 1);
  }

  // The roof reaches a little past the walls.
  const oh = 0.35 / k, drop = 0.35 * Math.tan(pitch);
  const Lo = L + (hip ? oh : 0.15 / k), Wo = W + oh;
  const R = (s, t) => [cx + ax * s * Lo + bx * t * Wo, cy + ay * s * Lo + by * t * Wo];
  const low = top - drop;
  const r = hip ? Math.max(0, L - W) : L;          // half the ridge length
  const E = (s) => [cx + ax * s * r, cy + ay * s * r];
  const roofPt = (pt, y) => put(pt[0], y, pt[1], true, [0, 0, y - base, eave], false);

  // The two long slopes.
  for (const t of [-1, 1]) {
    const a = roofPt(R(-1, t), low), b = roofPt(R(1, t), low);
    const c = roofPt(E(1), ridge), d = roofPt(E(-1), ridge);
    tri(a, b, c); tri(a, c, d);
  }
  for (const s of [-1, 1]) {
    if (hip) {
      // A sloped triangle at each end.
      const a = roofPt(R(s, -1), low), b = roofPt(R(s, 1), low), c = roofPt(E(s), ridge);
      tri(a, b, c);
    } else {
      // A triangle of wall under the ridge, then nothing else: the slopes cover it.
      const p = P(s, -1), q = P(s, 1), m = P(s, 0), len = 2 * W * k;
      const a = put(p[0], top, p[1], false, [0, len, eave, eave], true);
      const b = put(q[0], top, q[1], false, [len, len, eave, eave], true);
      const c = put(m[0], ridge, m[1], false, [len / 2, len, eave + rise, eave], true);
      tri(a, b, c);
    }
  }
  return { top: ridge };
}
