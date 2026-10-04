// Far skyline, two stages: marker tiles say how built-up a tile is; only built-up
// ones get their zoom-14 children fetched and built.
import assert from 'node:assert/strict';
globalThis.document = { getElementById: () => ({ style: {} }) };
const posted = [];
globalThis.Worker = class { postMessage(m) { posted.push(m); } };
const gl = new Proxy({}, { get: (_, p) => {
  if (p === 'getAttribLocation') return (_, n) => (n === 'aPos' ? 0 : 1);
  if (['getShaderParameter', 'getProgramParameter'].includes(p)) return () => true;
  if (p === 'getParameter') return () => 8;
  if (p === 'getExtension') return () => null;
  return () => ({});
}});
const { NearField } = await import('../src/nearfield.js');
const { mercToTile } = await import('../src/geo.js');
const mx = -8847000, my = 5440000;
const t14 = mercToTile(mx, my, 14), cx = Math.floor(t14.x), cy = Math.floor(t14.y);
const tpl = () => 'https://v/{z}/{x}/{y}.pbf';
const near = new NearField(gl, tpl);
const far = new NearField(gl, tpl, { zoom: 13, skyline: true, workers: 2 });
near.partner = far; far.partner = near;
near.update(mx, my, true, true, 3);
const R = 7;
far.updateFar(mx, my, true, true, R, near.block);
const markers = far.want.filter((w) => w.marker);
assert.ok(markers.length > 100 && markers.every((w) => w.z === 13), 'stage 1 wants zoom-13 marker tiles: ' + markers.length);
assert.equal(far.want.filter((w) => !w.marker).length, 0, 'no zoom-14 tiles wanted until a marker says built-up');

const reply = (spec, stats) => far._done(far.workers[0], { id: [...far.inflight].find(([, s]) => s.key === spec.key)[0], ok: true,
  vertices: new ArrayBuffer(0), indices: new Uint32Array(0), verts: 0, bVertices: new ArrayBuffer(0), bIndices: new Uint32Array(0), bVerts: 0, rEnds: [0, 0, 0], stats });
const bare = { seen: 40, kept: 0, dropped: 0, ends: [0, 0, 0] };
// the nearest marker is built-up, the next is countryside
const order = [];
for (let i = 0; i < 2; i++) { far.updateFar(mx, my, true, true, R, near.block); const m = posted.at(-1); order.push(m); }
far.updateFar(mx, my, true, true, R, near.block);
const sent = posted.filter((m) => m.marker);
assert.ok(sent.length >= 2 && sent.every((m) => m.skyline && m.z === 13), 'markers go to the worker flagged marker/skyline at z13');
const dense = [...far.inflight.values()][0], rural = [...far.inflight.values()][1];
reply(dense, { ...bare, cover: 0.4, built: 0.6 });
reply(rural, { ...bare, cover: 0.01, built: 0.05 });
assert.equal(far.tiles.get(dense.key).urban, true, 'a 40% built tile is built-up');
assert.equal(far.tiles.get(rural.key).urban, false, 'a 1% built tile is not');
far.updateFar(mx, my, true, true, R, near.block);
const kids = far.want.filter((w) => !w.marker);
assert.equal(kids.length, 4, 'stage 2 wants exactly the four zoom-14 children of the built-up marker');
assert.ok(kids.every((k) => k.z === 14 && (k.rawX >> 1) === dense.rawX && (k.y >> 1) === dense.y), 'and they are the right children');
assert.equal(far.owns(dense.rawX, dense.y), false, 'while the children are missing the near layer keeps drawing that ground');
assert.equal(far.owns(rural.rawX, rural.y), true, 'a countryside marker is enough for the far layer to own it');
for (const k of kids) far._upload({ key: k.key, rawX: k.rawX, y: k.y, z: 14 }, { vertices: new ArrayBuffer(48), indices: new Uint32Array(30), verts: 3, rEnds: [0, 0, 0],
  bVertices: new ArrayBuffer(48), bIndices: new Uint32Array(30), bVerts: 3, stats: { kept: 1, dropped: 0, ends: [30, 30, 30] } });
assert.equal(far.owns(dense.rawX, dense.y), true, 'once all four children are in, the far layer owns it');
// a block that shrinks in on the far tiles keeps no overlap
far.updateFar(mx, my, true, true, R, near.block);
assert.ok(far.status.includes('urban 1'), 'status reports the built-up count: ' + far.status);
// fetch gating
const n0 = posted.length; far.queue.clear(); far.pending.clear();
far.updateFar(mx + 1, my, true, false, R, near.block);
assert.equal(posted.length, n0, 'nothing is requested while the near field is still busy');
// complete: green only when everything wanted is in and nothing is pending
{
  const nf = new NearField(gl, tpl, { zoom: 13, skyline: true, workers: 1 });
  const nr = new NearField(gl, tpl); nr.update(mx, my, true, true, 2);
  nf.updateFar(mx, my, true, true, 4, nr.block);
  assert.equal(nf.complete, false, 'not complete while tiles are missing');
  for (const w of nf.want) nf._upload({ key: w.key, rawX: w.rawX, y: w.y, z: 13, marker: true },
    { vertices: new ArrayBuffer(0), indices: new Uint32Array(0), verts: 0, bVertices: new ArrayBuffer(0), bIndices: new Uint32Array(0), bVerts: 0, rEnds: [0, 0, 0], stats: { cover: 0, built: 0, seen: 3, kept: 0, dropped: 0, ends: [0, 0, 0] } });
  nf.queue.clear(); nf.pending.clear(); nf.inflight.clear();
  nf.updateFar(mx, my, true, true, 4, nr.block);
  assert.equal(nf.complete, true, 'complete once every wanted tile is in');
  nf.updateFar(mx, my, true, false, 4, nr.block);
  assert.equal(nf.complete, false, 'not complete while waiting on the near field');
}
console.log('far ok');
