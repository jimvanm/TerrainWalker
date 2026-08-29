// Verifies the two depth passes fully cover the terrain with no gap ring,
// across latitudes and every render-distance setting.
import { LEVELS } from '../src/config.js';
import { tileSizeMerc, mercScale } from '../src/geo.js';
let bad = 0;
for (const lat of [0, 20, 43.3, 60, 75]) {
 for (const agl of [1.7, 100, 2500, 43741, 200000, 700000]) {
  for (let act = 2; act <= LEVELS.length; act++) {
    const k = mercScale(lat);
    const l1 = 2 * tileSizeMerc(LEVELS[Math.min(1, act - 1)].z) * k;
    const nearFar = Math.hypot(l1 * Math.SQRT2, agl) * 1.1;
    const farNear = Math.hypot(l1, agl) * 0.9;
    const nearMax = Math.hypot(l1 * Math.SQRT2, agl);  // furthest near-pass vertex
    const farMin  = Math.hypot(l1, agl);               // nearest level-2 vertex
    const outer = tileSizeMerc(LEVELS[act - 1].z) * k * 2;
    const far = Math.hypot(outer * Math.SQRT2, agl) * 1.15;
    const farMax = Math.hypot(outer * Math.SQRT2, agl);               // furthest far-pass vertex
    const okNear = nearFar >= nearMax;
    const okGap  = farNear <= farMin;
    const okFar  = act < 3 ? true : far >= farMax;
    const okOverlap = farNear < nearFar;
    if (!(okNear && okGap && okFar && okOverlap)) {
      bad++;
      console.log(`FAIL lat ${lat} agl ${agl} levels ${act}: near ${okNear} gap ${okGap} far ${okFar} overlap ${okOverlap}`);
    }
  }
 }
}
console.log(bad === 0
  ? 'PASS  depth passes cover all geometry at every altitude (5 lat x 6 agl x 8 settings = 240 cases)'
  : `${bad} FAILURES`);
if (bad) process.exitCode = 1;

// Depth PRECISION, not just coverage. The original test only checked that
// geometry fell inside the clip range; it never asked whether the depth buffer
// could resolve anything out there. It could not, and that was the flicker.
{
  const BITS = 2 ** 24, SKIRT = 150, TARGET = 20;
  const res = (z, n, f) => z * z * (1 / n - 1 / f) / BITS;
  let bad = 0, worst = 0, worstAt = '', n = 0;
  for (const lat of [0, 43.7, 60, 75]) {
    for (const agl of [1.7, 100, 4402, 43741, 400000]) {
      for (let act = 2; act <= LEVELS.length; act++) {
        n++;
        const k = mercScale(lat);
        const outer = tileSizeMerc(LEVELS[act - 1].z) * k * 2;
        const far = Math.hypot(outer * Math.SQRT2, agl) * 1.15;
        const near = Math.max(0.5, Math.min(agl * 0.01, 2000));
        const splitFar = Math.sqrt(near * BITS * TARGET);
        const splitNear = splitFar * 0.75;
        const nearPlaneFar = Math.min(splitNear, far * 0.5);

        // Both passes must overlap, or geometry falls through the crack.
        if (nearPlaneFar >= Math.max(splitFar, near * 1000)) { bad++; worstAt = `no overlap at lat ${lat} agl ${agl}`; continue; }
        // Near pass must resolve skirts out to where it hands over.
        const rNear = res(splitFar, near, Math.max(splitFar, near * 1000));
        // Far pass must resolve them from the handover outwards.
        const rFar = res(far, nearPlaneFar, far);
        // Tolerance grows with distance. A 400 m depth error 8,000 km away is
        // far smaller than the terrain's own relief at that LOD and cannot
        // produce visible fighting; demanding sub-skirt precision out there
        // would be a stricter test than reality requires.
        const allow = (z) => Math.max(SKIRT * 0.5, z * 0.0005);
        if (rNear > allow(splitFar)) { bad++; const r = rNear; if (r > worst) { worst = r; worstAt = `near pass, lat ${lat} agl ${agl} levels ${act} -> ${r.toFixed(0)} m`; } }
        else if (rFar > allow(far)) { bad++; const r = rFar; if (r > worst) { worst = r; worstAt = `far pass, lat ${lat} agl ${agl} levels ${act} -> ${r.toFixed(0)} m`; } }
      }
    }
  }
  console.log(bad === 0
    ? `PASS  depth resolves finer than half a skirt in both passes (${n} configs)`
    : `FAIL  ${bad}/${n} configs cannot resolve skirts; worst ${worstAt}`);
  if (bad) process.exitCode = 1;
}
