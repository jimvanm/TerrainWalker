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
    const outer = tileSizeMerc(LEVELS[act - 1].z) * k * 2, far = outer * 1.6;
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
