// Far skyline, two stages: marker tiles say how built-up a tile is; only built-up
// ones get their zoom-14 children fetched and built.
import assert from 'node:assert/strict';
import { posted, fakeGL, TEMPLATE, view, finish } from './_fakes.mjs';
const gl = fakeGL();
const { MeshProgram } = await import('../src/meshprogram.js');
const { NearLayer } = await import('../src/near.js');
const { SkylineLayer } = await import('../src/skyline.js');
const { Handover } = await import('../src/handover.js');
const mesh = new MeshProgram(gl);
const { mercToTile } = await import('../src/geo.js');
const mx = -8847000, my = 5440000;
const t14 = mercToTile(mx, my, 14), cx = Math.floor(t14.x), cy = Math.floor(t14.y);
const near = new NearLayer(gl, mesh, TEMPLATE);
const far = new SkylineLayer(gl, mesh, TEMPLATE, { workers: 2 });
new Handover(near, far);
near.update(view(mx, my, { R: 3 }));
const R = 7;
far.update(view(mx, my), R, near.block, true);
const markers = far.want.filter((w) => w.marker);
assert.ok(markers.length > 100 && markers.every((w) => w.z === 13), 'stage 1 wants zoom-13 marker tiles: ' + markers.length);
assert.equal(far.want.filter((w) => !w.marker).length, 0, 'no zoom-14 tiles wanted until a marker says built-up');

const reply = (spec, stats) => finish(far, spec.key, {
  vertices: new ArrayBuffer(0), indices: new Uint32Array(0), verts: 0, bVertices: new ArrayBuffer(0), bIndices: new Uint32Array(0), bVerts: 0, rEnds: [0, 0, 0], stats });
const bare = { seen: 40, kept: 0, dropped: 0, ends: [0, 0, 0] };
// the nearest marker is built-up, the next is countryside
const order = [];
for (let i = 0; i < 2; i++) { far.update(view(mx, my), R, near.block, true); const m = posted.at(-1); order.push(m); }
far.update(view(mx, my), R, near.block, true);
const sent = posted.filter((m) => m.marker);
assert.ok(sent.length >= 2 && sent.every((m) => m.skyline && m.z === 13), 'markers go to the worker flagged marker/skyline at z13');
assert.ok(sent.every((m) => m.ez === 12 && m.eurl.includes('/12/')), 'skyline jobs still drape on zoom-12 ground');
const dense = [...far.pool.inflight.values()][0], rural = [...far.pool.inflight.values()][1];
reply(dense, { ...bare, cover: 0.4, built: 0.6 });
reply(rural, { ...bare, cover: 0.01, built: 0.05 });
assert.equal(far.tiles.get(dense.key).urban, true, 'a 40% built tile is built-up');
assert.equal(far.tiles.get(rural.key).urban, false, 'a 1% built tile is not');
far.update(view(mx, my), R, near.block, true);
const kids = far.want.filter((w) => !w.marker);
assert.equal(kids.length, 4, 'stage 2 wants exactly the four zoom-14 children of the built-up marker');
assert.ok(kids.every((k) => k.z === 14 && (k.rawX >> 1) === dense.rawX && (k.y >> 1) === dense.y), 'and they are the right children');
assert.equal(far.owns(dense.rawX, dense.y), false, 'while the children are missing the near layer keeps drawing that ground');
assert.equal(far.owns(rural.rawX, rural.y), true, 'a countryside marker is enough for the far layer to own it');
for (const k of kids) far._upload({ key: k.key, rawX: k.rawX, y: k.y, z: 14 }, { vertices: new ArrayBuffer(48), indices: new Uint32Array(30), verts: 3, rEnds: [0, 0, 0],
  bVertices: new ArrayBuffer(48), bIndices: new Uint32Array(30), bVerts: 3, stats: { kept: 1, dropped: 0, ends: [30, 30, 30] } });
assert.equal(far.owns(dense.rawX, dense.y), true, 'once all four children are in, the far layer owns it');
// a block that shrinks in on the far tiles keeps no overlap
far.update(view(mx, my), R, near.block, true);
assert.ok(far.status.includes('urban 1'), 'status reports the built-up count: ' + far.status);
// fetch gating
const n0 = posted.length; far.pool.clearQueue();
far.update(view(mx + 1, my), R, near.block, false);
assert.equal(posted.length, n0, 'nothing is requested while the near field is still busy');
// complete: green only when everything wanted is in and nothing is pending
{
  const nf = new SkylineLayer(gl, mesh, TEMPLATE, { workers: 1 });
  const nr = new NearLayer(gl, mesh, TEMPLATE); nr.update(view(mx, my, { R: 2 }));
  nf.update(view(mx, my), 4, nr.block, true);
  assert.equal(nf.complete, false, 'not complete while tiles are missing');
  for (const w of nf.want) nf._upload({ key: w.key, rawX: w.rawX, y: w.y, z: 13, marker: true },
    { vertices: new ArrayBuffer(0), indices: new Uint32Array(0), verts: 0, bVertices: new ArrayBuffer(0), bIndices: new Uint32Array(0), bVerts: 0, rEnds: [0, 0, 0], stats: { cover: 0, built: 0, seen: 3, kept: 0, dropped: 0, ends: [0, 0, 0] } });
  nf.pool.clearQueue(); nf.pool.inflight.clear();
  nf.update(view(mx, my), 4, nr.block, true);
  assert.equal(nf.complete, true, 'complete once every wanted tile is in');
  nf.update(view(mx, my), 4, nr.block, false);
  assert.equal(nf.complete, false, 'not complete while waiting on the near field');
}
console.log('far ok');
