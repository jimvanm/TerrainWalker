// 1. Draw size by distance from the camera tile: full, middle, top.
// 2. Near and far layers never draw the same ground twice, and leave no gap.
import assert from 'node:assert/strict';
import { fakeGL, TEMPLATE, view, pass } from './_fakes.mjs';
const draws = [];
const gl = fakeGL(draws);
const { MeshProgram } = await import('../src/meshprogram.js');
const { NearLayer } = await import('../src/near.js');
const { SkylineLayer } = await import('../src/skyline.js');
const { Handover } = await import('../src/handover.js');
// The fake replies carry no style; check with today's buildings (key 5).
(await import('../src/settings.js')).settings.buildings = 0;
const mesh = new MeshProgram(gl);
const { mercToTile } = await import('../src/geo.js');
const mx = -8847000, my = 5440000;
const t0 = mercToTile(mx, my, 14), cx = Math.floor(t0.x), cy = Math.floor(t0.y);
const road = (n) => ({ vertices: new ArrayBuffer(48), indices: new Uint32Array(n), verts: 3 });
const fakeTile = (nf, x, y, z) => nf._upload({ key: x + '/' + y, rawX: x, y }, {
  ...road(3000), rEnds: [300, 1200, 3000],
  bVertices: new ArrayBuffer(48), bIndices: new Uint32Array(600), bVerts: 3, stats: { kept: 10, dropped: 0, ends: [60, 240, 600] },
});

// ---- 1: ring sizes ----------------------------------------------------------
const nf = new NearLayer(gl, mesh, TEMPLATE);
nf.update(view(mx, my, { R: 4 }));
const one = (ring) => {
  for (const k of [...nf.tiles.keys()]) nf.tiles.delete(k);
  fakeTile(nf, cx + ring, cy);
  draws.length = 0;
  nf.draw(pass(mx, my), true, true);
  return draws.slice();
};
assert.deepEqual(one(0), [600, 3000], 'camera tile: all buildings, all roads');
assert.deepEqual(one(1), [600, 3000], 'next ring: full detail');
assert.deepEqual(one(2), [240, 1200], 'ring 2: large buildings, main roads');
assert.deepEqual(one(3), [60, 300], 'ring 3: skyline, motorways');
console.log('ok  draw size follows the ring: full, full, middle, top');

// ---- 2: near block is whole zoom-13 tiles; far wants exactly the rest ------------
const far = new SkylineLayer(gl, mesh, TEMPLATE, { workers: 1 });
new Handover(nf, far);
for (const R of [2, 3, 4]) {
  nf.update(view(mx, my, { R }));
  const b = nf.block;
  assert.ok(b.x0 % 2 === 0 && b.x1 % 2 === 1 && b.y0 % 2 === 0 && b.y1 % 2 === 1, 'R=' + R + ': block is whole zoom-13 tiles');
  assert.ok(b.x0 <= cx - R && b.x1 >= cx + R, 'block still covers the radius');
  far.update(view(mx, my), 7, b, true);
  for (const w of far.want) {
    const inside = 2 * w.rawX >= b.x0 && 2 * w.rawX + 1 <= b.x1 && 2 * w.y >= b.y0 && 2 * w.y + 1 <= b.y1;
    const touches = 2 * w.rawX + 1 >= b.x0 && 2 * w.rawX <= b.x1 && 2 * w.y + 1 >= b.y0 && 2 * w.y <= b.y1;
    assert.ok(!touches && !inside, 'far tile ' + w.key + ' does not overlap the block');
  }
}
console.log('ok  near block is aligned to zoom-13 tiles; far tiles never overlap it');

// ---- 3: while a far tile is loaded the near layer does not also draw that ground ----
nf.update(view(mx, my, { R: 2 }));
const b = nf.block, tx = b.x1 + 3, ty = cy;            // a near tile left outside the block
for (const k of [...nf.tiles.keys()]) nf.tiles.delete(k);
fakeTile(nf, tx, ty);
draws.length = 0; nf.draw(pass(mx, my), true, true);
assert.equal(draws.length, 2, 'outside the block with no far tile yet: near layer keeps drawing it (no flash)');
far._upload({ key: '13/' + (tx >> 1) + '/' + (ty >> 1), rawX: tx >> 1, y: ty >> 1, z: 13, marker: true },
  { ...road(0), bVertices: new ArrayBuffer(0), bIndices: new Uint32Array(0), bVerts: 0, rEnds: [0, 0, 0], stats: { cover: 0, built: 0, seen: 5, kept: 0, dropped: 0, ends: [0, 0, 0] } });
// a (non-built-up) marker means the far layer owns that square: nothing to draw, nothing missing

draws.length = 0; nf.draw(pass(mx, my), true, true);
assert.equal(draws.length, 0, 'once the far tile has arrived, the near layer stops drawing that ground');

console.log('ok  no flash on handover, no double drawing');
console.log('rings ok');
