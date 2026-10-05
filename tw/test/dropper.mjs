// M: dropping a landmark where the crosshair meets the ground.
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const geo = await import('../src/geo.js');
const { Landmarks } = await import('../src/landmarks.js');
const { Dropper, aimPoint } = await import('../src/dropper.js');

const lat = 40.8213, lon = 14.4261;       // Vesuvius
const cam = { mercX: geo.lonToMercX(lon), mercY: geo.latToMercY(lat), alt: 1100, yaw: 0, pitch: -Math.PI / 4 };
const k = geo.mercScale(lat);

// ---- the crosshair point ----
{
  const flat = () => 1000;               // flat ground 100 m below the eye
  const a = aimPoint(cam, flat);
  const north = (a.my - cam.mercY) * k, east = (a.mx - cam.mercX) * k;
  assert.ok(Math.abs(north - 100) < 0.5 && Math.abs(east) < 0.01, `looking north 45 deg down from 100 m up meets the ground 100 m north (got ${north.toFixed(2)} m)`);
  const eastCam = { ...cam, yaw: Math.PI / 2 };
  const b = aimPoint(eastCam, flat);
  assert.ok(Math.abs((b.mx - cam.mercX) * k - 100) < 0.5, 'and 100 m east when facing east');
  assert.equal(aimPoint({ ...cam, pitch: 0.1 }, flat), null, 'looking up meets nothing');
  assert.equal(aimPoint(cam, () => null), null, 'nor where no ground has loaded');
  // A hill in the way is hit first.
  const hill = (mx, my) => ((my - cam.mercY) * k > 40 && (my - cam.mercY) * k < 60 ? 1060 : 1000);
  const h = aimPoint(cam, hill);
  assert.ok(Math.abs((h.my - cam.mercY) * k - 40) < 0.5, 'a hill in the way is hit first');
  console.log('ok  the crosshair point is where the line of sight meets the ground');
}

// ---- the pointer's direction (Tools mode) ----
{
  const { screenDir, forward } = await import('../src/dropper.js');
  const f = forward(cam), mid = screenDir(cam, 400, 300, 800, 600, 68);
  assert.ok(Math.abs(mid.e - f.e) < 1e-9 && Math.abs(mid.n - f.n) < 1e-9 && Math.abs(mid.u - f.u) < 1e-9, 'the middle of the screen is straight ahead');
  const level = { ...cam, pitch: 0 };
  const right = screenDir(level, 800, 300, 800, 600, 68), top = screenDir(level, 400, 0, 800, 600, 68);
  const deg = (r) => r * 180 / Math.PI;
  assert.ok(Math.abs(deg(Math.atan2(right.e, right.n)) - deg(Math.atan(Math.tan(34 * Math.PI / 180) * 800 / 600))) < 0.01, 'the right edge is half the width of view to the right (east, facing north)');
  assert.ok(Math.abs(deg(Math.asin(top.u)) - 34) < 0.01, 'the top edge is half the height of view up');
  const flat = () => 1000;
  const lower = aimPoint(cam, flat, screenDir(cam, 400, 450, 800, 600, 68));
  assert.ok((lower.my - cam.mercY) * k < 100, 'pointing lower on the screen meets the ground nearer');
  console.log('ok  the pointer aims where it points');
}

// ---- arm, cycle, turn, drop, remove, keep ----
const mesh = { buffers: () => ({ vao: {}, count: 0 }), freeBuffers() {} };
const list = [
  { id: 'cn', name: 'CN Tower', lat: 43.6426, lon: -79.3871, height: 553, maskR: 40 },
  { id: 'rogers', name: 'Rogers Centre', lat: 43.6414, lon: -79.3892, height: 93.5, maskR: 95 },
];
const L = new Landmarks(null, mesh, list);
const d = new Dropper(L);
await L.ready; await Promise.resolve();
const flat = () => 1000;
{
  assert.ok(!d.armed);
  d.cycle(); assert.equal(L.kinds[d.choice].id, 'cn', 'M arms the first landmark');
  d.update(cam, flat);
  assert.match(d.message, /CN Tower/);
  const p = d.preview;
  assert.ok(Math.abs((p.my - cam.mercY) * k - 100) < 0.5 && !p.hidden, 'the preview stands at the crosshair');
  d.turn(1); d.turn(1);
  assert.equal(p.yawDeg, 30, ', and . turn it 15 degrees a press');
  const it = d.drop();
  assert.ok(it && it.dropped && it.yawDeg === 30 && Math.abs(it.lat - p.lat) < 1e-9, 'click drops a copy where the preview stands');
  d.cycle(); assert.equal(L.kinds[d.choice].id, 'rogers', 'M again: the next landmark');
  d.cycle(); assert.ok(!d.armed && !L.items.some((q) => q.preview), 'and after the last, off, with no preview left');
  d.noteUntil = 0; d.update(cam, flat);
  assert.equal(d.message, '', 'and the message goes (once the last note has shown)');
}
{
  assert.equal(L.items.filter((q) => q.dropped).length, 1, 'one dropped');
  assert.ok(d.removeAimed(cam, flat), 'Delete removes the dropped one under the crosshair');
  assert.equal(L.items.filter((q) => q.dropped).length, 0);
  mem.set('tw.drops', '[{"model":"cn","lat":1,"lon":1}]');      // left by an earlier version
  const L2 = new Landmarks(null, mesh, list), d2 = new Dropper(L2);
  await L2.ready; await Promise.resolve();
  assert.equal(L2.items.filter((q) => q.dropped).length, 0, 'a reload starts with none');
  assert.ok(!mem.has('tw.drops'), 'and forgets any kept by an earlier version');
  const far = { ...cam, yaw: Math.PI };
  d2.drop(); // not armed: nothing
  assert.equal(L2.items.filter((q) => q.dropped).length, 0, 'a click while not armed drops nothing');
  assert.equal(d2.removeAimed(far, flat), null, 'Delete aimed elsewhere removes nothing');
  // Aiming at the tower itself, 2 km away and level, not at its foot.
  const t = d2._add({ model: 'cn', lat: geo.mercYToLat(cam.mercY + 2000 / k), lon, yawDeg: 0 });
  t.base = 1000;
  const level = { ...cam, alt: 1300, pitch: 0 };
  assert.equal(d2.aimedAt({ ...level, yaw: 0.2 }, flat), null, 'aiming well to the side of the tower: not it');
  assert.equal(d2.removeAimed(level, flat), t, 'aiming at the tower\'s shaft from 2 km removes it');
  assert.match(d2.message || (d2.update(cam, flat), d2.message), /Removed CN Tower/, 'and says so');
  console.log('ok  arm, next, turn, drop, remove (aiming at the tower, not its foot); a reload clears them');
}
console.log('dropper ok');
