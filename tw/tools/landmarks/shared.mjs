// Helpers shared by the landmark builders (landmarks/<id>/build.mjs) and the
// drafts. Metres, y up; x east, z south.
import { Mesh, ringPts } from './mesh.mjs';
export { Mesh, ringPts };

// Colours (RGB 0-255)
export const CONCRETE = [196, 194, 188];
export const CONCRETE_DK = [160, 158, 152];
export const GLASS = [34, 40, 50];
export const WHITE = [240, 240, 236];
export const SILVER = [208, 212, 218];
export const RED = [200, 40, 36];
export const ORANGE = [236, 84, 24];

export const R = (y, r, c) => ({ y, r, c });
export const lerp = (a, b, t) => a + (b - a) * t;
export function interp(profile, y, k) { // profile rows: [y, v1, v2...]; returns value at index k
  if (y <= profile[0][0]) return profile[0][k];
  for (let i = 1; i < profile.length; i++) {
    if (y <= profile[i][0]) { const t = (y - profile[i - 1][0]) / (profile[i][0] - profile[i - 1][0]); return lerp(profile[i - 1][k], profile[i][k], t); }
  }
  return profile[profile.length - 1][k];
}
export const sq = (cx, cz, w) => [[cx - w / 2, cz - w / 2], [cx + w / 2, cz - w / 2], [cx + w / 2, cz + w / 2], [cx - w / 2, cz + w / 2]];

// Four-legged tower legs: profile rows [y, centreOffset, legWidth, colour]
export function fourLegs(m, profile) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const layers = profile.map((p) => ({ y: p[0], pts: sq(sx * p[1], sz * p[1], p[2]), c: p[3] }));
    m.loftPts(layers, { capBottom: true });
  }
}
// Bands of alternating colours along a straight mast
export function bandedMast(m, y0, y1, r0, r1, bandLen, cols, n = 6) {
  const total = y1 - y0;
  const nb = Math.max(1, Math.round(total / bandLen));
  for (let i = 0; i < nb; i++) {
    const ya = y0 + (total * i) / nb, yb = y0 + (total * (i + 1)) / nb;
    const ra = lerp(r0, r1, i / nb), rb = lerp(r0, r1, (i + 1) / nb);
    m.tube([0, ya, 0], [0, yb, 0], ra, rb, cols[i % cols.length], n);
  }
}
