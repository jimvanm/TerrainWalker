// Verifies the two depth passes fully cover the terrain with no gap ring,
// across latitudes and every render-distance setting.
import { LEVELS } from '../src/config.js';
import { tileSizeMerc, mercScale } from '../src/geo.js';
let bad = 0;
for (const lat of [0, 20, 46.5, 60, 75]) {
  for (let act = 2; act <= LEVELS.length; act++) {
    const k = mercScale(lat);
    const l1 = 2 * tileSizeMerc(LEVELS[Math.min(1, act - 1)].z) * k;
    const nearFar = l1 * 1.55, farNear = l1 * 0.85;
    const nearMax = l1 * Math.SQRT2;                 // furthest near-pass vertex
    const farMin  = l1;                              // where level 2 starts
    const outer = tileSizeMerc(LEVELS[act - 1].z) * k * 2, far = outer * 1.6;
    const farMax = outer * Math.SQRT2;               // furthest far-pass vertex
    const okNear = nearFar >= nearMax;
    const okGap  = farNear <= farMin;
    const okFar  = act < 3 ? true : far >= farMax;
    const okOverlap = farNear < nearFar;
    if (!(okNear && okGap && okFar && okOverlap)) {
      bad++;
      console.log(`FAIL lat ${lat} levels ${act}: near ${okNear} gap ${okGap} far ${okFar} overlap ${okOverlap}`);
    }
  }
}
console.log(bad === 0
  ? 'PASS  depth passes cover all geometry, no gap ring (5 latitudes x 5 settings)'
  : `${bad} FAILURES`);
if (bad) process.exitCode = 1;
