// M: dropping a landmark where the crosshair meets the ground.
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };

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
  const saved = JSON.parse(mem.get('tw.drops'));
  assert.equal(saved.length, 1, 'the drop is kept in this browser');
  const L2 = new Landmarks(null, mesh, list), d2 = new Dropper(L2);
  await L2.ready; await Promise.resolve();
  assert.equal(L2.items.filter((q) => q.dropped).length, 1, 'and comes back after a reload');
  assert.ok(d2.removeAimed(cam, flat), 'Delete removes the dropped one under the crosshair');
  assert.equal(L2.items.filter((q) => q.dropped).length, 0);
  assert.equal(JSON.parse(mem.get('tw.drops')).length, 0, 'and forgets it');
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
  console.log('ok  arm, next, turn, drop, keep, remove (aiming at the tower, not its foot)');
}
console.log('dropper ok');
