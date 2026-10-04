import fs from 'node:fs';
import { Mesh, ringPts } from './mesh.mjs';

// Colours (RGB 0-255)
const CONCRETE = [196, 194, 188];
const CONCRETE_DK = [160, 158, 152];
const GLASS = [34, 40, 50];
const WHITE = [240, 240, 236];
const SILVER = [208, 212, 218];
const RED = [200, 40, 36];
const ORANGE = [236, 84, 24];

const R = (y, r, c) => ({ y, r, c });
const lerp = (a, b, t) => a + (b - a) * t;
function interp(profile, y, k) { // profile rows: [y, v1, v2...]; returns value at index k
  if (y <= profile[0][0]) return profile[0][k];
  for (let i = 1; i < profile.length; i++) {
    if (y <= profile[i][0]) { const t = (y - profile[i - 1][0]) / (profile[i][0] - profile[i - 1][0]); return lerp(profile[i - 1][k], profile[i][k], t); }
  }
  return profile[profile.length - 1][k];
}
const sq = (cx, cz, w) => [[cx - w / 2, cz - w / 2], [cx + w / 2, cz - w / 2], [cx + w / 2, cz + w / 2], [cx - w / 2, cz + w / 2]];

// Four-legged tower legs: profile rows [y, centreOffset, legWidth, colour]
function fourLegs(m, profile) {
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const layers = profile.map((p) => ({ y: p[0], pts: sq(sx * p[1], sz * p[1], p[2]), c: p[3] }));
    m.loftPts(layers, { capBottom: true });
  }
}
// Bands of alternating colours along a straight mast
function bandedMast(m, y0, y1, r0, r1, bandLen, cols, n = 6) {
  const total = y1 - y0;
  const nb = Math.max(1, Math.round(total / bandLen));
  for (let i = 0; i < nb; i++) {
    const ya = y0 + (total * i) / nb, yb = y0 + (total * (i + 1)) / nb;
    const ra = lerp(r0, r1, i / nb), rb = lerp(r0, r1, (i + 1) / nb);
    m.tube([0, ya, 0], [0, yb, 0], ra, rb, cols[i % cols.length], n);
  }
}

// ---------- 1. CN Tower, Toronto (553.3 m) ----------
// Pod, upper shaft, SkyPod and mast are measured from a reference model (cn_profile.json).
// That model has a straight lower shaft, so 'flared' adds a smooth flare that is only an ESTIMATE.
const CP = JSON.parse(fs.readFileSync(new URL('./cn_profile.json', import.meta.url), 'utf8'));
function cnBuild() {
  const m = new Mesh();
  const col = { c: CONCRETE, d: CONCRETE_DK, g: GLASS, w: WHITE, s: SILVER, r: RED };
  // round-ish core (hexagonal) up to the pod
  m.loft([R(0, CP.core_r, CONCRETE_DK), R(3, CP.core_r, CONCRETE), R(326, CP.core_r, CONCRETE)], 6, { capBottom: true });
  // three tapering wings (the Y-shaped legs), long at the ground and merging into the core
  const W = CP.wing;
  for (const deg of W.angles_deg) {
    const phi = (deg * Math.PI) / 180, dx = Math.cos(phi), dz = Math.sin(phi), px = -dz, pz = dx, t = W.thick;
    const fin = (L) => [[-t / 2 * px, -t / 2 * pz], [L * dx - t / 2 * px, L * dz - t / 2 * pz], [L * dx + t / 2 * px, L * dz + t / 2 * pz], [t / 2 * px, t / 2 * pz]];
    m.loftPts(W.tips.map(([y, L], i) => ({ y: y + (i === 0 ? 0 : 0), pts: fin(L), c: i < 2 ? CONCRETE_DK : CONCRETE })), { capTop: true, capBottom: true });
  }
  // pod
  m.loft(CP.pod.map(([y, r, c]) => R(y, r, col[c])), 28);
  // upper shaft
  m.loft(CP.upper_shaft.map(([y, r]) => R(y, r, CONCRETE)), 6);
  // SkyPod
  m.loft(CP.skypod.map(([y, r, c]) => R(y, r, col[c])), 12);
  // mast
  m.loft(CP.spire.map(([y, r]) => R(y, r, WHITE)), 6);
  return m;
}
const cn = () => cnBuild();

// ---------- 2. Berliner Fernsehturm (368 m) ----------
function berlin() {
  const m = new Mesh();
  // low flared foot, then slim shaft
  m.loft([R(0, 22, CONCRETE_DK), R(7, 11, CONCRETE_DK), R(190, 4.6, CONCRETE)], 16, { capBottom: true });
  // the sphere (faceted like the real one)
  m.sphere(0, 205, 0, 16, SILVER, 16, 10);
  // neck above the sphere
  m.loft([R(214, 4.4, CONCRETE), R(250, 2.8, CONCRETE)], 8);
  // red and white mast
  bandedMast(m, 250, 368, 2.8, 0.35, 17, [WHITE, RED]);
  return m;
}

// ---------- 3. Tallinn TV Tower (314 m) ----------
function tallinn() {
  const m = new Mesh();
  m.loft([R(0, 7.6, CONCRETE), R(170, 4.5, CONCRETE), R(190, 4.1, CONCRETE)], 12, { capBottom: true });
  // platform drum (38 m wide, around 150-182 m)
  m.loft([
    R(150, 4.7, CONCRETE), R(156, 19, CONCRETE_DK), R(158, 19, CONCRETE), R(167, 19, GLASS),
    R(169, 19, CONCRETE), R(177, 10, CONCRETE), R(183, 4.2, CONCRETE),
  ], 16);
  // steel antenna section (190-314 m)
  m.loft([R(190, 3.8, SILVER), R(228, 3.4, SILVER), R(236, 1.6, SILVER), R(314, 0.7, SILVER)], 8);
  return m;
}

// ---------- 4. Ostankino Tower, Moscow (540 m) ----------
function ostankino() {
  const m = new Mesh();
  // ten legs
  for (let k = 0; k < 10; k++) {
    const a = (2 * Math.PI * k) / 10;
    m.tube([34 * Math.cos(a), 0, 34 * Math.sin(a)], [8 * Math.cos(a), 66, 8 * Math.sin(a)], 5.2, 3.4, CONCRETE_DK, 4);
  }
  // shaft
  m.loft([R(55, 10, CONCRETE), R(322, 5.2, CONCRETE)], 12);
  // observation bulge (deck at 337 m)
  m.loft([
    R(322, 5.4, CONCRETE), R(334, 15, CONCRETE_DK), R(336, 17, CONCRETE), R(346, 17, GLASS),
    R(348, 16.5, CONCRETE), R(368, 14, CONCRETE), R(376, 8, CONCRETE), R(386, 3.6, CONCRETE),
  ], 14);
  // antenna mast, red and white near the top
  m.loft([R(386, 3.4, WHITE), R(440, 2.4, WHITE), R(480, 1.6, WHITE)], 8);
  bandedMast(m, 480, 540.1, 1.6, 0.3, 15, [RED, WHITE], 6);
  return m;
}

// ---------- 5. Eiffel Tower, Paris (330 m with antenna) ----------
// Shape measured from a detailed reference model (see eiffel_profile.json), sizes anchored to published numbers.
const EP = JSON.parse(fs.readFileSync(new URL('./eiffel_profile.json', import.meta.url), 'utf8'));
function eiffel() {
  const m = new Mesh();
  const B1 = [112, 88, 62], B2 = [130, 105, 76], B3 = [152, 126, 92];
  const shade = (z) => (z < 60 ? B1 : z < 160 ? B2 : B3);
  // four curved legs: [z, centre offset, width]
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const layers = EP.legs.map(([z, c, w]) => ({ y: z, pts: sq(sx * c, sz * c, w), c: shade(z) }));
    m.loftPts(layers, { capBottom: true });
    // stepped foot plinth under each leg
    const F = EP.foot;
    m.box(sx * F.centre, F.h1 / 2, sz * F.centre, F.w1, F.h1, F.w1, B1);
    m.box(sx * F.centre, F.h1 + F.h2 / 2, sz * F.centre, F.w2, F.h2, F.w2, B1);
  }
  // one solid tapering column above the second platform (the four legs merge there)
  m.loftPts(EP.shaft.map(([z, h]) => ({ y: z, pts: sq(0, 0, 2 * h), c: shade(z) })));
  // light belt under the first platform
  m.box(0, (EP.belt.z0 + EP.belt.z1) / 2, 0, 2 * EP.belt.half, EP.belt.z1 - EP.belt.z0, 2 * EP.belt.half, B1);
  // platforms
  for (const p of EP.slabs) m.box(0, (p.z0 + p.z1) / 2, 0, 2 * p.half, p.z1 - p.z0, 2 * p.half, shade(p.z0));
  // lantern and antenna
  m.loftPts(EP.lantern.map(([z, h]) => ({ y: z, pts: sq(0, 0, 2 * h), c: B3 })));
  const sp = EP.spire;
  m.tube([0, sp[0], 0], [0, sp[1], 0], sp[2] / 2, sp[3] / 2, B3, 4);
  // the four base arches (half-ellipse ribbons)
  const { a, b, zc, thick, depth, ycentre } = EP.arch;
  const NSEG = 12;
  const I = [], O = [];
  for (let i = 0; i <= NSEG; i++) {
    const t = (Math.PI * i) / NSEG;
    I.push([a * Math.cos(t), zc + b * Math.sin(t)]);
    O.push([(a + thick) * Math.cos(t), zc + (b + thick) * Math.sin(t)]);
  }
  for (let sd = 0; sd < 4; sd++) {
    const ang = (Math.PI / 2) * sd, ca = Math.cos(ang), sa = Math.sin(ang);
    const W = (u, z, yy) => { const x = u, zz = interp(EP.legs, z, 1) + yy; return [x * ca - zz * sa, z, x * sa + zz * ca]; };
    for (let i = 0; i < NSEG; i++) {
      const pts = (arr, yy) => [W(arr[i][0], arr[i][1], yy), W(arr[i + 1][0], arr[i + 1][1], yy)];
      const [i0f, i1f] = pts(I, depth / 2), [o0f, o1f] = pts(O, depth / 2);
      const [i0b, i1b] = pts(I, -depth / 2), [o0b, o1b] = pts(O, -depth / 2);
      const q = (p, qq, r, s2) => { const ids = [p, qq, r, s2].map((v) => m.v(v[0], v[1], v[2], B1)); m.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]); };
      q(i0f, i1f, o1f, o0f);   // front face
      q(i0b, i1b, o1b, o0b);   // back face
      q(i0f, i1f, i1b, i0b);   // underside
      q(o0f, o1f, o1b, o0b);   // top side
    }
  }
  return m;
}

// ---------- 6. Tokyo Tower (333 m) ----------
function tokyo() {
  const m = new Mesh();
  const O = ORANGE, W = WHITE;
  const prof = [
    [0, 36, 9, O], [30, 29, 8, O], [60, 22, 6.5, W], [90, 16.5, 5, O],
    [120, 12.5, 4, W], [146, 10.5, 3.6, O], [200, 6.5, 2.8, W], [244, 3.8, 2.4, O],
  ];
  fourLegs(m, prof);
  // main deck (octagon) at ~150 m
  m.loft([R(138, 11, O), R(144, 19, O), R(147, 20, O), R(152, 20, GLASS), R(156, 18, O), R(160, 9, O)], 8);
  // top deck at ~250 m
  m.loft([R(243, 4, O), R(246, 8, W), R(250, 8, GLASS), R(254, 7, W), R(258, 2.4, W)], 8);
  // antenna with stripes
  bandedMast(m, 258, 333, 2.0, 0.3, 19, [W, O, W, O], 4);
  return m;
}

// ---------- 7. Space Needle, Seattle (184 m) ----------
function spaceNeedle() {
  const m = new Mesh();
  const prof = [[0, 18, 5.2], [35, 11, 4.4], [70, 7, 3.8], [105, 8.5, 4.0], [138, 10, 4.6]];
  for (let k = 0; k < 3; k++) {
    const phi = Math.PI / 2 + (k * 2 * Math.PI) / 3, dx = Math.cos(phi), dz = Math.sin(phi);
    // finer path so the hourglass curve shows
    const ys = [0, 20, 40, 60, 80, 100, 120, 138];
    const layers = ys.map((y) => {
      const off = interp(prof, y, 1), w = interp(prof, y, 2);
      return { y, pts: sq(off * dx, off * dz, w), c: WHITE };
    });
    m.loftPts(layers, { capBottom: true });
  }
  m.loft([R(0, 3.2, WHITE), R(140, 3.2, WHITE)], 6);
  const GOLD = [214, 150, 60];
  m.loft([
    R(137, 7.5, WHITE), R(146, 18, WHITE), R(148, 21, WHITE), R(150, 21, GLASS),
    R(158, 21, GLASS), R(160, 20, WHITE), R(162, 17, GOLD), R(168, 6, GOLD),
  ], 16);
  m.loft([R(168, 1.8, WHITE), R(184.4, 0.5, WHITE)], 4);
  return m;
}

// ---------- 8. Skylon Tower, Niagara Falls ON (160 m) ----------
function skylon() {
  const m = new Mesh();
  const COPPER = [178, 112, 78], YELLOW = [240, 200, 30];
  m.loft([R(0, 9.5, CONCRETE_DK), R(12, 6.2, CONCRETE), R(116, 4.3, CONCRETE)], 12, { capBottom: true });
  m.loft([
    R(116, 5, CONCRETE), R(120, 15, CONCRETE_DK), R(121, 16.5, CONCRETE), R(127, 16.5, GLASS),
    R(129, 16.5, CONCRETE), R(131, 16.5, CONCRETE), R(141, 16.5, GLASS), R(143, 16.5, CONCRETE),
    R(149, 4, COPPER),
  ], 16);
  m.tube([0, 149, 0], [0, 160, 0], 0.9, 0.3, WHITE, 4);
  // the three outside lifts (yellow)
  for (let k = 0; k < 3; k++) {
    const a = (2 * Math.PI * k) / 3 + 0.5;
    const rr = interp([[12, 6.2], [116, 4.3]], 40 + k * 28, 1) + 1.6;
    m.box(rr * Math.cos(a), 40 + k * 28, rr * Math.sin(a), 2.6, 5.5, 2.6, YELLOW);
  }
  return m;
}

// ---------- 9. Oriental Pearl Tower, Shanghai (468 m) ----------
function pearl() {
  const m = new Mesh();
  const PINK = [214, 72, 108], GREY = [190, 190, 196];
  // tripod legs and their foot spheres
  for (let k = 0; k < 3; k++) {
    const a = (2 * Math.PI * k) / 3 + Math.PI / 6, c = Math.cos(a), s = Math.sin(a);
    m.tube([46 * c, 4, 46 * s], [11 * c, 74, 11 * s], 4.5, 4.5, GREY, 6);
    m.sphere(46 * c, 7, 46 * s, 7, PINK, 8, 5);
  }
  // lower big sphere (50 m)
  m.sphere(0, 93, 0, 25, PINK, 14, 8);
  // three 9 m columns between the two big spheres
  for (let k = 0; k < 3; k++) {
    const a = (2 * Math.PI * k) / 3, c = Math.cos(a), s = Math.sin(a);
    m.tube([12 * c, 112, 12 * s], [12 * c, 245, 12 * s], 4.5, 4.5, GREY, 6);
  }
  // five small spheres between the big ones
  for (let k = 0; k < 5; k++) {
    const a = (2 * Math.PI * k) / 5 + 0.3;
    m.sphere(16 * Math.cos(a), 178, 16 * Math.sin(a), 7, PINK, 8, 5);
  }
  // upper big sphere (45 m)
  m.sphere(0, 263, 0, 22.5, PINK, 14, 8);
  // shaft and top sphere (14 m)
  m.tube([0, 284, 0], [0, 344, 0], 3.6, 3.0, GREY, 8);
  m.sphere(0, 351, 0, 7, PINK, 8, 5);
  // spire
  m.loft([R(357, 2.0, SILVER), R(468, 0.3, SILVER)], 6);
  return m;
}

// ---------- 10. Canton Tower, Guangzhou (600 m) ----------
export const CANTON_INFO = {};
function cantonDraft() {
  const m = new Mesh();
  const TOP = 462, NR = 16;
  const a0 = 40, b0 = 30, a1 = 21, b1 = 15, ALPHA = (110 * Math.PI) / 180;
  const P = (th) => [a0 * Math.cos(th), b0 * Math.sin(th)];
  const Q = (th) => [a1 * Math.cos(th + ALPHA), b1 * Math.sin(th + ALPHA)];
  const at = (k, t) => {
    const th = (2 * Math.PI * k) / NR, p = P(th), q = Q(th);
    return [lerp(p[0], q[0], t), TOP * t, lerp(p[1], q[1], t)];
  };
  // straight columns (they make the hourglass by themselves)
  const ROD = [196, 202, 212], RING = [236, 238, 242];
  for (let k = 0; k < NR; k++) m.tube(at(k, 0), at(k, 1), 1.1, 0.8, ROD, 3);
  // rings
  for (const t of [0.0, 0.2, 0.4, 0.6, 0.8, 0.97]) {
    const mk = (tt) => ({ y: TOP * tt, pts: Array.from({ length: NR }, (_, k) => { const p = at(k, tt); return [p[0], p[2]]; }), c: RING });
    m.loftPts([mk(Math.max(0, t - 0.004)), mk(Math.min(1, t + 0.004 + 0.006))]);
  }
  // roof and mast
  m.loft([R(TOP, 20, RING), R(TOP + 6, 12, RING), R(TOP + 12, 5, RING)], 10, { rot: 0 });
  m.loft([R(TOP + 12, 4, SILVER), R(540, 2.2, SILVER), R(602, 0.4, SILVER)], 8);
  // report the waist
  let best = 1e9, by = 0;
  for (let i = 0; i <= 100; i++) {
    const t = i / 100; let mean = 0;
    for (let k = 0; k < NR; k++) { const p = at(k, t); mean += Math.hypot(p[0], p[2]); }
    mean /= NR; if (mean < best) { best = mean; by = TOP * t; }
  }
  CANTON_INFO.waistHeight = by; CANTON_INFO.waistRadius = best;
  return m;
}


// ---------- Canton Tower (602 m), measured from a simplified reference model (canton_profile.json) ----------
// Body: a round hyperboloid. Its top ring is tilted, as in the reference. Mast: tapered tubes with collars.
const CT = JSON.parse(fs.readFileSync(new URL('./canton_profile.json', import.meta.url), 'utf8'));
function canton() {
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

export const TOWERS = [
  { id: 'cn', name: 'CN Tower', city: 'Toronto', height: 553.3, build: cn },
  { id: 'berlin', name: 'Berliner Fernsehturm', city: 'Berlin', height: 368, build: berlin },
  { id: 'tallinn', name: 'Tallinna Teletorn', city: 'Tallinn', height: 314, build: tallinn },
  { id: 'ostankino', name: 'Ostankino Tower', city: 'Moscow', height: 540.1, build: ostankino },
  { id: 'eiffel', name: 'Eiffel Tower', city: 'Paris', height: 330, build: eiffel },
  { id: 'tokyo', name: 'Tokyo Tower', city: 'Tokyo', height: 333, build: tokyo },
  { id: 'needle', name: 'Space Needle', city: 'Seattle', height: 184.4, build: spaceNeedle },
  { id: 'skylon', name: 'Skylon Tower', city: 'Niagara Falls', height: 160, build: skylon },
  { id: 'pearl', name: 'Oriental Pearl Tower', city: 'Shanghai', height: 468, build: pearl },
  { id: 'canton', name: 'Canton Tower', city: 'Guangzhou', height: 602, build: canton },
];
