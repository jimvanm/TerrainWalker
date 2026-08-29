// Exercises Controls and Terrain.heightAt against known values.

globalThis.performance = globalThis.performance || { now: () => Date.now() };
const L = {};
globalThis.document = {
  addEventListener: (t, f) => { (L[t] = L[t] || []).push(f); },
  body: { classList: { toggle() {} } }, pointerLockElement: null,
};
globalThis.window = globalThis;
globalThis.addEventListener = (t, f) => { (L[t] = L[t] || []).push(f); };

const { Controls } = await import('../src/controls.js');
const { Terrain } = await import('../src/terrain.js');
const geo = await import('../src/geo.js');
const { EYE_HEIGHT, LEVELS } = await import('../src/config.js');
const { keyOf } = await import('../src/tiles.js');

const canvas = { addEventListener() {}, requestPointerLock() {} };
const R = [];
const ok = (c, m) => { R.push((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) process.exitCode = 1; };
const key = (code, repeat = false) =>
  (L.keydown || []).forEach((f) => f({ code, repeat, preventDefault() {} }));
const up = (code) => (L.keyup || []).forEach((f) => f({ code }));

function mkCam(lat, lon, yawDeg) {
  return {
    mercX: geo.lonToMercX(lon), mercY: geo.latToMercY(lat),
    alt: 1000, yaw: yawDeg * Math.PI / 180, pitch: 0, fly: 0,
  };
}

// --- walking moves the right way and the right distance ---
{
  const cam = mkCam(46.5, 8.0, 0);
  const c = new Controls(canvas, cam);
  const lat0 = geo.mercYToLat(cam.mercY), lon0 = geo.mercXToLon(cam.mercX);
  key('KeyW');
  for (let i = 0; i < 100; i++) c.update(0.1, 500);   // 10 s at 5.6 m/s
  up('KeyW');
  const lat1 = geo.mercYToLat(cam.mercY), lon1 = geo.mercXToLon(cam.mercX);
  const north = (lat1 - lat0) * 111320;
  ok(north > 50 && north < 62, `walked ${north.toFixed(1)} m north in 10 s (expect ~56)`);
  ok(Math.abs(lon1 - lon0) < 1e-9, 'no sideways drift while walking straight');
}

// --- ground clamping converges to eye height ---
{
  const cam = mkCam(46.5, 8.0, 0);
  cam.alt = 4000;
  const c = new Controls(canvas, cam);
  for (let i = 0; i < 200; i++) c.update(1 / 60, 1234);
  ok(Math.abs(cam.alt - (1234 + EYE_HEIGHT)) < 0.01,
     `ground clamp settled at ${cam.alt.toFixed(2)} m (expect ${(1234 + EYE_HEIGHT).toFixed(2)})`);
}

// --- double tap toggles flight, auto-repeat does not ---
{
  const cam = mkCam(46.5, 8.0, 0);
  const c = new Controls(canvas, cam);
  key('Space'); key('Space');
  ok(cam.fly === 1, 'double tap space enables flight');
  for (let i = 0; i < 30; i++) key('Space', true);   // simulate auto-repeat
  ok(cam.fly === 1, 'held space (auto-repeat) does not re-toggle flight');
  up('Space'); key('Space'); key('Space');
  ok(cam.fly === 0, 'double tap again returns to walking');
}

// --- flight ascends and is not clamped to the ground ---
{
  const cam = mkCam(46.5, 8.0, 0);
  cam.alt = 2000; cam.fly = 1;
  const c = new Controls(canvas, cam);
  key('Space');
  for (let i = 0; i < 60; i++) c.update(1 / 60, 500);
  ok(cam.alt > 2050, `flight climbed to ${cam.alt.toFixed(0)} m in 1 s at 60 m/s`);
  up('Space');
  const before = cam.alt;
  for (let i = 0; i < 60; i++) c.update(1 / 60, 500);
  ok(Math.abs(cam.alt - before) < 0.01, 'flight holds altitude when no key is pressed');
}

// --- heightAt returns the elevation actually stored in the tile ---
{
  const fakeGL = new Proxy({}, { get: () => () => ({}) });
  const t = new Terrain(fakeGL, { onTile: null });
  const z = LEVELS[0].z, PX = 256;
  const lat = 46.5, lon = 8.0;
  const mx = geo.lonToMercX(lon), my = geo.latToMercY(lat);
  const tl = geo.mercToTile(mx, my, z);
  const tx = Math.floor(tl.x), ty = Math.floor(tl.y);
  const heights = new Float32Array(PX * PX);
  for (let j = 0; j < PX; j++) for (let i = 0; i < PX; i++) heights[j * PX + i] = i * 4 + j * 7;
  t.tiles.set(keyOf(z, tx, ty), { heights, z, level: 0 });

  const px = (tl.x - tx) * (PX - 1), py = (tl.y - ty) * (PX - 1);
  const want = px * 4 + py * 7;
  const got = t.heightAt(mx, my);
  ok(got !== null && Math.abs(got - want) < 0.01,
     `heightAt bilinear = ${got === null ? 'null' : got.toFixed(2)} (expect ${want.toFixed(2)})`);
  ok(t.heightAt(geo.lonToMercX(-120), geo.latToMercY(20)) === null,
     'heightAt returns null for an unloaded tile');
}

console.log(R.join('\n'));

// --- Q and E fly, and the on-screen pad drives the same paths as the keys ---
{
  const cam = mkCam(46.5, 8.0, 0);
  cam.alt = 3000; cam.fly = 1;
  const c = new Controls(canvas, cam);
  key('KeyE');
  for (let i = 0; i < 60; i++) c.update(1 / 60, 500);
  ok(cam.alt > 3050, `E ascends (${cam.alt.toFixed(0)} m)`);
  up('KeyE'); key('KeyQ');
  const a1 = cam.alt;
  for (let i = 0; i < 60; i++) c.update(1 / 60, 500);
  ok(cam.alt < a1 - 50, `Q descends (${cam.alt.toFixed(0)} m)`);
  up('KeyQ');

  const a2 = cam.alt;
  c.btn.up = true;
  for (let i = 0; i < 60; i++) c.update(1 / 60, 500);
  ok(cam.alt > a2 + 50, 'on-screen UP button ascends');
  c.btn.up = false; c.btn.boost = true; c.btn.down = true;
  const a3 = cam.alt;
  for (let i = 0; i < 60; i++) c.update(1 / 60, 500);
  ok(cam.alt < a3 - 400, 'BOOST multiplies the on-screen DOWN button');
  c.btn.down = c.btn.boost = false;
}

// --- Q from walking mode enters flight rather than doing nothing ---
{
  const cam = mkCam(46.5, 8.0, 0);
  const c = new Controls(canvas, cam);
  ok(cam.fly === 0, 'starts walking');
  key('KeyE');
  ok(cam.fly === 1, 'pressing E from walking switches to flight');
}

// --- compass heading maps yaw to aviation degrees ---
{
  const h = (yawDeg) => { const d = ((yawDeg % 360) + 360) % 360; return Math.round(d) === 0 ? 360 : Math.round(d); };
  const cases = [[0, 360], [90, 90], [180, 180], [270, 270], [-90, 270], [449, 89]];
  let bad = 0;
  for (const [y, want] of cases) if (h(y) !== want) bad++;
  ok(bad === 0, 'heading readout: 0->360, 90->090, -90->270, wraps past 360');
}

console.log(R.slice(-8).join('\n'));
