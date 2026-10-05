// Rough draft towers from published heights only. Not measured, not used by
// the app. Kept as starting points. A measured landmark lives in its own folder
// under landmarks/ instead.
import { Mesh, CONCRETE, CONCRETE_DK, GLASS, WHITE, SILVER, RED, ORANGE, R, lerp, interp, sq, fourLegs, bandedMast } from './shared.mjs';

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

export const DRAFTS = [
  { id: 'berlin', name: 'Berliner Fernsehturm', city: 'Berlin', height: 368, build: berlin },
  { id: 'tallinn', name: 'Tallinna Teletorn', city: 'Tallinn', height: 314, build: tallinn },
  { id: 'ostankino', name: 'Ostankino Tower', city: 'Moscow', height: 540.1, build: ostankino },
  { id: 'tokyo', name: 'Tokyo Tower', city: 'Tokyo', height: 333, build: tokyo },
  { id: 'needle', name: 'Space Needle', city: 'Seattle', height: 184.4, build: spaceNeedle },
  { id: 'skylon', name: 'Skylon Tower', city: 'Niagara Falls', height: 160, build: skylon },
  { id: 'pearl', name: 'Oriental Pearl Tower', city: 'Shanghai', height: 468, build: pearl },
  { id: 'canton-draft', name: 'Canton Tower (first draft)', city: 'Guangzhou', height: 602, build: cantonDraft },
];
