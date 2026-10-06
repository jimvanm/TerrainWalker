// Roads and buildings can stand on a ground that is not a terrain tile:
// g.hAt gives the height, g.cell the grid's cell size. Without them nothing changes.
import assert from 'node:assert/strict';
import { buildRoads } from '../src/roads.js';
import { buildBuildings } from '../src/buildings.js';
import { MeshBuilder } from '../src/meshbuilder.js';
import { LINESTRING, POLYGON } from '../src/mvt.js';
import { GRID } from '../src/heightgrid.js';

const V = GRID + 1;
const size = 2445;                       // a zoom 14 tile, mercator metres
const base = { size14: size, size12: size, bx: 0, by: 0, cosLat: 0.7, nodes: new Float32Array(V * V) };
const road = { extent: 4096, features: [
  { type: LINESTRING, cls: 'primary', props: {}, parts: [[500, 2048, 3500, 2048]] }] };
const bld = { extent: 4096, features: [
  { type: POLYGON, cls: 'building', props: { render_height: 30 },
    parts: [[1000, 1000, 1400, 1000, 1400, 1400, 1000, 1400, 1000, 1000]] }] };

const run = (g) => {
  const a = new MeshBuilder(), b = new MeshBuilder();
  buildRoads(road, g, a);
  buildBuildings(bld, g, b);
  return { a: a.finish(), b: b.finish() };
};

// 1. A flat ground, said two ways, gives the same geometry.
{
  const plain = run(base);
  const viaFn = run({ ...base, hAt: () => 0 });
  assert.ok(plain.a.verts > 10 && plain.b.verts > 10, 'both a road and a building were made');
  assert.deepEqual(new Uint8Array(plain.a.vertices), new Uint8Array(viaFn.a.vertices), 'road: same vertices');
  assert.deepEqual(new Uint8Array(plain.b.vertices), new Uint8Array(viaFn.b.vertices), 'building: same vertices');
  console.log('ok  g.hAt on flat ground matches the terrain tile path');
}

// 2. A ground of its own is followed: raised 50 m, everything stands 50 m higher.
{
  const low = run({ ...base, hAt: () => 0 }), high = run({ ...base, hAt: () => 50 });
  const ys = (r) => { const f = new Float32Array(r.vertices); const o = []; for (let i = 0; i < r.verts; i++) o.push(f[4 * i + 1]); return o; };
  const ya = ys(low.a), yb = ys(high.a);
  assert.equal(ya.length, yb.length);
  for (let i = 0; i < ya.length; i++) assert.ok(Math.abs(yb[i] - ya[i] - 50) < 1e-3, 'road vertex ' + i + ' is 50 m higher');
  const za = ys(low.b), zb = ys(high.b);
  for (let i = 0; i < za.length; i++) assert.ok(Math.abs(zb[i] - za[i] - 50) < 1e-3, 'building vertex ' + i + ' is 50 m higher');
  console.log('ok  roads and buildings follow g.hAt');
}

// 3. g.cell sets the grid the paving is cut along: a finer grid, more pieces.
{
  const air = { extent: 4096, features: [
    { type: POLYGON, cls: 'apron', props: {}, parts: [[500, 500, 3000, 500, 3000, 3000, 500, 3000, 500, 500]] }] };
  const count = (g) => { const m = new MeshBuilder(); buildRoads(null, g, m, air); return m.idx.length; };
  const coarse = count({ ...base, hAt: () => 0 }), fine = count({ ...base, hAt: () => 0, cell: size / 400 });
  assert.ok(fine > coarse * 2, `a finer ground grid cuts the apron into more pieces (${coarse} -> ${fine})`);
  console.log('ok  g.cell sets the paving grid');
}
