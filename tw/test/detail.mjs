// detail.js: how much to load and draw. These used to be loose variables in
// main.js and could only be checked by flying around. Now they are one class.
import assert from 'node:assert/strict';
import { Detail } from '../src/detail.js';
import { LEVELS, NF_MAX_AGL, NF_MAX_SPEED } from '../src/config.js';
import { lonToMercX, latToMercY } from '../src/geo.js';

const lat = 43.65, lon = -79.38;
const cam = (alt) => ({ mercX: lonToMercX(lon), mercY: latToMercY(lat), lat, lon, alt, yaw: 0, pitch: 0, fly: 1 });
const still = { speed: 0, hspeed: 0, vx: 0, vz: 0 };
const opts = { fog: false, levels: LEVELS.length };
// Run long enough for the smoothed view distance to settle.
const settle = (d, alt, motion = still, o = opts, frames = 400) => {
  let v;
  for (let i = 0; i < frames; i++) v = d.update(1 / 60, cam(alt), 0, motion, o);
  return v;
};

// ---- view grows with height ----
{
  const low = settle(new Detail(), 2), high = settle(new Detail(), 5000);
  assert.ok(high.viewDist > low.viewDist * 5, `view distance grows with height: ${low.viewDist.toFixed(0)} m -> ${high.viewDist.toFixed(0)} m`);
  assert.ok(high.drawLevels > low.drawLevels, `more levels drawn up high: ${low.drawLevels} -> ${high.drawLevels}`);
  assert.ok(high.drawLevels <= LEVELS.length);
  const capped = settle(new Detail(), 5000, still, { fog: false, levels: 4 });
  assert.ok(capped.drawLevels <= 4, 'the view slider caps the levels drawn');
  console.log('ok  view distance and levels drawn grow with height, capped by the slider');
}

// ---- no flicker at a threshold ----
// With fog on, the level count follows the (smoothed) view distance. Find a
// height where the count changes, then drift slowly up and down across it, as
// the ground under a moving camera does. The count may change once, not over
// and over.
{
  const fog = { fog: true, levels: LEVELS.length };
  let edge = null, prev = settle(new Detail(), 200, still, fog).drawLevels;
  for (let alt = 200; alt < 20000 && edge === null; alt *= 1.03) {
    const n = settle(new Detail(), alt, still, fog).drawLevels;
    if (n !== prev) edge = alt;
    prev = n;
  }
  assert.ok(edge, 'found a height where the level count changes');
  const d = new Detail();
  settle(d, edge, still, fog);
  let changes = 0, last = d.drawLevels;
  for (let i = 0; i < 1800; i++) {
    const n = d.update(1 / 60, cam(edge * (1 + 0.15 * Math.sin(i / 60))), 0, still, fog).drawLevels;
    if (n !== last) changes++;
    last = n;
  }
  assert.ok(changes <= 1, `level count is steady when drifting around ${edge.toFixed(0)} m (${changes} changes)`);
  console.log('ok  drifting across a level threshold does not flicker');
}

// ---- near field: drawn by height, fetched by speed ----
{
  const d = new Detail();
  assert.equal(settle(d, 100).nearOn, true, 'near field on low down');
  assert.equal(settle(d, NF_MAX_AGL * 1.05).nearOn, true, 'stays on just above the limit (dead band)');
  assert.equal(settle(d, NF_MAX_AGL * 1.2).nearOn, false, 'off well above it');
  assert.equal(settle(d, NF_MAX_AGL * 1.05).nearOn, false, 'stays off just above the limit on the way down');
  assert.equal(settle(d, NF_MAX_AGL * 0.9).nearOn, true, 'on again below it');
  const fast = { speed: NF_MAX_SPEED * 2, hspeed: NF_MAX_SPEED * 2, vx: NF_MAX_SPEED * 2, vz: 0 };
  const v = settle(new Detail(), 100, fast);
  assert.equal(v.nearOn, true, 'speed never switches drawing off');
  assert.equal(v.nearFetchOk, false, 'but it does stop fetching');
  const r = (alt) => settle(new Detail(), alt).nearR;
  assert.deepEqual([r(100), r(1000), r(3000)], [2, 3, 4], 'block grows with height: 5x5, 7x7, 9x9');
  console.log('ok  near field drawn by height, fetched by speed, block grows with height');
}

// ---- fetch only what can arrive in time ----
{
  const slow = settle(new Detail(), 3000);
  const fast = settle(new Detail(), 3000, { speed: 3000, hspeed: 3000, vx: 3000, vz: 0 });
  assert.equal(slow.minLevel, 0, 'standing still, the finest level is fetched');
  assert.ok(fast.minLevel > 0, `at 3 km/s the finest levels are skipped (from L${fast.minLevel})`);
  assert.ok(fast.minLevel < fast.drawLevels, 'something is always fetched');
  console.log('ok  finest levels are not fetched when they could not arrive in time');
}

// ---- look-ahead points where you are going ----
{
  const east = settle(new Detail(), 500, { speed: 500, hspeed: 500, vx: 500, vz: 0 });
  assert.ok(east.lead.use && east.lead.x > east.mercX && Math.abs(east.lead.y - east.mercY) < 1, 'moving east, look ahead to the east');
  const north = settle(new Detail(), 500, { speed: 500, hspeed: 500, vx: 0, vz: -500 });
  assert.ok(north.lead.use && north.lead.y > north.mercY, 'moving north, look ahead to the north');
  assert.equal(settle(new Detail(), 500).lead.use, false, 'standing still, no look-ahead');
  console.log('ok  look-ahead points the way you are moving');
}
// ---- close-up levels only while the near field is on ----
{
  const low = settle(new Detail(), 300), high = settle(new Detail(), 8000);
  assert.equal(LEVELS[low.minLevel].z, 14, 'low and slow: the finest close-up level (zoom 14) is fetched');
  assert.equal(LEVELS[high.minLevel].z, 12, 'high up (no near field): zoom 12 is the finest fetched');
  const d = new Detail();
  settle(d, 300); const back = settle(d, 8000);
  assert.equal(LEVELS[back.minLevel].z, 12, 'climbing out of near-field height stops fetching the close-up levels');
  assert.equal(LEVELS[settle(d, 300).minLevel].z, 14, 'and coming back down starts again');
  console.log('ok  zoom 13 and 14 are fetched only while low enough for the near field');
}
console.log('detail ok');
