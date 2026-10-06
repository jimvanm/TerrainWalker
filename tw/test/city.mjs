// A moved piece carries its city: the slab's ground as numbers, which map tiles
// it needs, roads and buildings built on it, the painted map, and the loader.
import assert from 'node:assert/strict';
import { pieceGrid, slabHeightFn, mapTiles, inside } from '../src/piecegrid.js';
import { buildPiece } from '../src/transplant.js';
import { tileFrame, clipLine, buildCityTile, samplePaint, paintSlab, WATER_RGB } from '../src/citykit.js';
import { City } from '../src/city.js';
import { MASK } from '../src/overlayraster.js';
import { LINESTRING, POLYGON } from '../src/mvt.js';
import { lonToMercX, latToMercY, mercScale, mercToTile, tileSizeMerc, tileCentreMerc } from '../src/geo.js';
import { nodeHeightAt, GRID } from '../src/heightgrid.js';

let n = 0;
const ok = (name) => { n++; console.log('ok  ' + name); };

const lat = 43.65, lon = -79.38;
const cx = lonToMercX(lon), cy = latToMercY(lat), k = mercScale(lat);
const sq = (r) => [[-r, -r], [r, -r], [r, r], [-r, r]];
const slope = (e, nn) => 100 + 0.05 * e + 10 * Math.sin(nn / 90);

// 1. the ground as numbers is the surface the slab is drawn with
{
  const built = buildPiece(slope, sq(300), 'rise');
  const grid = built.grid, H = slabHeightFn(grid);
  assert.ok(grid.W > 300 && grid.step > 0, 'a grid');
  // at the nodes: exactly the height the slab's vertices stand at
  let worst = 0;
  for (let j = 0; j < grid.H; j += 7) for (let i = 0; i < grid.W; i += 7) {
    const v = built.nodeVert[j * grid.W + i];
    if (v < 0) continue;
    worst = Math.max(worst, Math.abs(H(grid.e0 + i * grid.step, -grid.n1 + j * grid.step) - built.pos[3 * v + 1]));
  }
  assert.ok(worst < 1e-3, 'ground height at a node is the slab vertex height: ' + worst);
  // between nodes: on the triangle the slab really has there
  const tri = (i, j, tx, ty) => {
    const y = (a, b) => built.pos[3 * built.nodeVert[(j + b) * grid.W + i + a] + 1];
    return tx + ty <= 1 ? y(0, 0) + (y(1, 0) - y(0, 0)) * tx + (y(0, 1) - y(0, 0)) * ty
      : y(1, 1) + (y(0, 1) - y(1, 1)) * (1 - tx) + (y(1, 0) - y(1, 1)) * (1 - ty);
  };
  let rough = 0;
  for (let t = 0; t < 400; t++) {
    const i = 20 + (t * 37) % 250, j = 20 + (t * 91) % 250, tx = ((t * 7) % 10) / 10 + 0.03, ty = ((t * 13) % 10) / 10 + 0.03;
    if (built.nodeVert[j * grid.W + i] < 0 || built.nodeVert[(j + 1) * grid.W + i + 1] < 0) continue;
    rough = Math.max(rough, Math.abs(H(grid.e0 + (i + tx) * grid.step, -grid.n1 + (j + ty) * grid.step) - tri(i, j, tx, ty)));
  }
  assert.ok(rough < 1e-3, 'between nodes it follows the slab triangles: ' + rough);
  // never below the base
  const low = pieceGrid(() => 50, sq(100), 'rise', 80);
  assert.equal(slabHeightFn(low)(0, 0), 0, 'ground under the cut height stands at the base');
  ok('the slab ground function matches the slab surface exactly');
}

// 2. which map tiles a piece needs
{
  const small = mapTiles(sq(500), cx, cy, k);
  assert.equal(small.z, 14, 'a small piece uses the finest map');
  assert.ok(small.tiles.length >= 1 && small.tiles.length <= 4, 'a 1 km square touches a few tiles: ' + small.tiles.length);
  const big = mapTiles(sq(150000), cx, cy, k);
  assert.ok(big.z < 14 && big.tiles.length <= 256 && big.tiles.length > 4, `a 300 km piece gets a coarser map (z${big.z}, ${big.tiles.length} tiles)`);
  // a thin diagonal pays for what it touches, not its bounding box
  const diag = [[-20000, -20000], [-19000, -20000], [20000, 20000], [19000, 20000]];
  const dz = mapTiles(diag, cx, cy, k, 10000);
  const box = (dz.tiles.reduce((m, t) => Math.max(m, t.x), 0) - dz.tiles.reduce((m, t) => Math.min(m, t.x), 1e9) + 1) ** 2;
  assert.ok(dz.z === 14 && dz.tiles.length < box / 3, `a diagonal strip needs far fewer tiles than its box (${dz.tiles.length} of ${box})`);
  // each tile really does touch the outline: its middle is within a tile of it
  const s = tileSizeMerc(14);
  for (const t of small.tiles) {
    const mx = (t.rawX + 0.5) * s - 20037508.342789244;
    assert.ok(Math.abs(mx - cx) < 2 * s, 'tile near the piece');
  }
  ok('map tiles: the finest zoom that fits, only those the outline touches');
}

// 3. lines are cut exactly at the outline
{
  const box = [[0, 0], [100, 0], [100, 100], [0, 100]];
  const across = clipLine([-50, 50, 150, 50], box);
  assert.deepEqual(across, [[0, 50, 100, 50]], 'a line crossing a square keeps the part inside');
  assert.deepEqual(clipLine([200, 50, 300, 50], box), [], 'a line outside is dropped');
  assert.deepEqual(clipLine([10, 10, 90, 10, 90, 90], box), [[10, 10, 90, 10, 90, 90]], 'a line inside is kept whole, as one piece');
  const U = [[0, 0], [100, 0], [100, 100], [70, 100], [70, 30], [30, 30], [30, 100], [0, 100]];     // a U shape
  const through = clipLine([-10, 60, 110, 60], U);
  assert.equal(through.length, 2, 'a line through the arms of a U comes out as two pieces');
  const len = (p) => Math.hypot(p[2] - p[0], p[3] - p[1]);
  assert.ok(Math.abs(len(through[0]) - 30) < 1e-6 && Math.abs(len(through[1]) - 30) < 1e-6, 'each arm 30 long');
  ok('roads are cut exactly where the outline crosses them');
}

// 4. roads and buildings on the slab
const z14 = 14;
const t0 = mercToTile(cx, cy, z14), tile = { x: Math.floor(t0.x), y: Math.floor(t0.y), z: z14 };
// A piece centred on the middle of that tile (so the whole piece is in one tile), or on Toronto.
const tc = tileCentreMerc(tile.x, tile.y, z14);
const mkSlab = (r, mode = 'rise', mid = { x: cx, y: cy }) => {
  const built = buildPiece(slope, sq(r), mode);
  return { built, slab: { poly: sq(r), cx: mid.x, cy: mid.y, k, grid: built.grid } };
};
const E = 4096;
const roadLayer = (v) => ({ extent: E, features: [{ type: LINESTRING, cls: 'primary', props: {}, parts: [[0, v, E, v]] }] });
const house = (u, v, h) => ({ type: POLYGON, cls: 'building', props: { render_height: h }, parts: [[u, v, u + 60, v, u + 60, v + 60, u, v + 60, u, v]] });
{
  const { slab } = mkSlab(300, 'rise', tc);
  // a house at the tile's middle that is inside, and one 40% of a tile east that is not
  const layers = { transportation: roadLayer(E / 2), building: { extent: E, features: [house(E / 2 - 30, E / 2 - 30, 30), house(E * 0.9, E / 2, 30)] } };
  const out = buildCityTile(layers, { slab, tile });
  assert.equal(out.stats.kept, 1, 'only the house inside the outline is built: ' + out.stats.kept);
  const xyz = (r) => { const f = new Float32Array(r.vertices); const o = []; for (let i = 0; i < r.verts; i++) o.push([f[4 * i], f[4 * i + 1], f[4 * i + 2]]); return o; };
  const rv = xyz(out.roads), bv = xyz(out.bld);
  assert.ok(rv.length > 20, 'the road was built');
  // the road is cut at the outline (plus its own width)
  assert.ok(rv.every(([x, , z]) => Math.abs(x) <= 300 + 15 && Math.abs(z) <= 300 + 15), 'no road beyond the outline');
  assert.ok(Math.max(...rv.map((p) => p[0])) > 290, 'the road runs right up to the outline');
  // everything stands on the slab: a road vertex is the slab's height plus a hair
  const H = slabHeightFn(slab.grid);
  for (const [x, y, z] of rv.filter((_, i) => i % 5 === 0)) {
    const d = y - H(x, z);
    assert.ok(d > 0.05 && d < 0.5, `road lies on the slab (${d.toFixed(3)} m above it)`);
  }
  // the house: roof is its height above its highest ground corner
  const roof = Math.max(...bv.map((p) => p[1]));
  const groundHere = H(0, 0);
  assert.ok(roof > groundHere + 28 && roof < groundHere + 36, `house is about 30 m tall (${(roof - groundHere).toFixed(1)})`);
  assert.ok(bv.every(([x, , z]) => Math.abs(x) < 100 && Math.abs(z) < 100), 'the house stands where it stood');
  assert.ok(out.bld.info.some((v) => v !== 0), 'buildings carry the shader facts');
  ok('roads and buildings are built on the slab, cut to the outline, in its frame');
}

// 4b. flat paving lies on the slab's own triangles (cut along its grid), on a slope
{
  const { slab } = mkSlab(300, 'rise', tc);
  const apron = { type: POLYGON, cls: 'apron', props: {}, parts: [[E / 2 - 300, E / 2 - 300, E / 2 + 300, E / 2 - 300, E / 2 + 300, E / 2 + 300, E / 2 - 300, E / 2 + 300, E / 2 - 300, E / 2 - 300]] };
  const out = buildCityTile({ aeroway: { extent: E, features: [apron] } }, { slab, tile });
  const f = new Float32Array(out.roads.vertices), idx = out.roads.indices, H = slabHeightFn(slab.grid);
  assert.ok(idx.length > 600, 'the apron was cut along the grid: ' + idx.length / 3 + ' triangles');
  let worst = 0;
  for (let t3 = 0; t3 < idx.length; t3 += 3) {
    let x = 0, y = 0, z = 0;
    for (let q = 0; q < 3; q++) { const v = idx[t3 + q]; x += f[4 * v] / 3; y += f[4 * v + 1] / 3; z += f[4 * v + 2] / 3; }
    worst = Math.max(worst, Math.abs(y - H(x, z) - 0.32));
  }
  assert.ok(worst < 0.01, 'every paving triangle lies flat on the slab: off by ' + worst.toFixed(4) + ' m');
  ok('airport paving lies on the slab exactly, even across slopes');
}

// 5. the painted map under the slab's nodes
{
  const { slab } = mkSlab(1500);
  // tiles around: every tile that the outline touches
  const tiles = mapTiles(slab.poly, cx, cy, k).tiles.map((t) => ({ x: t.x, y: t.y, z: 14 }));
  const ov = (water) => ({ mask: (() => { const m = new Uint8Array(MASK * MASK * 4); for (let i = 0; i < MASK * MASK; i++) { m[4 * i] = water; m[4 * i + 3] = 255; } return m; })(),
    cover: (() => { const c = new Uint8Array(MASK * MASK * 3); for (let i = 0; i < c.length; i += 3) { c[i] = 50; c[i + 1] = 90; c[i + 2] = 40; } return c; })() });
  const seen = new Map();
  for (const t of tiles) {
    const p = samplePaint(ov(255), slab, t);
    for (const i of p.idx) seen.set(i, (seen.get(i) || 0) + 1);
    assert.ok(p.water.every((v) => v === 255), 'water strength read from the tile');
  }
  assert.ok([...seen.values()].every((c) => c === 1), 'every node belongs to exactly one tile');
  const g = slab.grid;
  let used = 0;
  for (let j = 0; j < g.H; j++) for (let i = 0; i < g.W; i++) {
    let u = false;
    for (let dj = -1; dj <= 0; dj++) for (let di = -1; di <= 0; di++) { const a = i + di, b = j + dj; if (a >= 0 && b >= 0 && a < g.W - 1 && b < g.H - 1 && g.cellIn[b * (g.W - 1) + a]) u = true; }
    if (u) used++;
  }
  assert.equal(seen.size, used, `every used node is painted by some tile (${seen.size} of ${used})`);
  assert.equal(samplePaint(null, slab, tiles[0]).idx.length, 0, 'no map image, no paint');
  // half a tile of water: only the nodes in that half are wet
  const half = ov(0); for (let y = 0; y < MASK; y++) for (let x = 0; x < MASK / 2; x++) half.mask[4 * (y * MASK + x)] = 255;
  const p = samplePaint(half, slab, tiles[0]);
  const wet = p.water.filter((v) => v > 0).length;
  assert.ok(wet > 0 && wet < p.idx.length, 'water only where the map has water');
  ok('the map paint is sampled once per grid node, from the tile it falls in');
}

// 6. painting the slab's colours
{
  const built = buildPiece(slope, sq(300), 'rise');
  const g = built.grid, col0 = built.col.slice(), col = built.col.slice();
  const idx = Uint32Array.from([Math.floor(g.H / 2) * g.W + Math.floor(g.W / 2)]);
  const paint = { idx, water: Uint8Array.from([255]), built: Uint8Array.from([0]), cov: Uint8Array.from([0]), cover: Uint8Array.from([0, 0, 0]) };
  const v = built.nodeVert[idx[0]];
  paintSlab(col, col0, built.nodeVert, [paint], { water: true, built: true, cover: true });
  assert.deepEqual([col[3 * v], col[3 * v + 1], col[3 * v + 2]], WATER_RGB, 'a wet node is water coloured');
  paintSlab(col, col0, built.nodeVert, [paint], { water: false, built: true, cover: true });
  assert.deepEqual([col[3 * v], col[3 * v + 1], col[3 * v + 2]], [col0[3 * v], col0[3 * v + 1], col0[3 * v + 2]], 'with WATER off it is the ground again');
  ok('water, built-up and cover colour the slab, and each button takes its own away');
}

// 7. the loader
{
  const { built } = mkSlab(500);
  const calls = [];
  let live = 0, peak = 0;
  const run = async (spec) => {
    live++; peak = Math.max(peak, live);
    calls.push(spec);
    await new Promise((r) => setTimeout(r, 5));
    live--;
    if (spec.tile.x % 2 === 1 && calls.length === 2) throw new Error('boom');
    return { roads: { vertices: new ArrayBuffer(16), indices: new Uint32Array([0, 0, 0]), verts: 1 },
      bld: { vertices: new ArrayBuffer(16), indices: new Uint32Array([0, 0, 0]), info: new Uint32Array(1), verts: 1 },
      paint: { idx: Uint32Array.from([1]), water: Uint8Array.from([9]), built: Uint8Array.from([0]), cov: Uint8Array.from([0]), cover: Uint8Array.from([0, 0, 0]) },
      stats: { kept: 2, dropped: 1, seen: 3 } };
  };
  const mapUrl = (z, x, y) => `https://m/${z}/${x}/${y}.pbf`;
  const city = new City({ poly: sq(1500), cx, cy, k, run, mapUrl, concurrency: 2 });
  const total = city.map.tiles.length;
  const ly = city.attach(built);
  assert.equal(ly.total, total);
  assert.equal(ly.settled, 0, 'nothing done at once');
  await new Promise((r) => setTimeout(r, 200));
  assert.equal(ly.settled, total, 'every tile settles');
  assert.ok(peak <= 2, 'no more helpers busy than allowed: ' + peak);
  assert.equal(ly.roads.length + ly.failed, total, 'a tile that failed is counted, the rest arrive');
  assert.ok(ly.version >= 1 && ly.paint.length === ly.roads.length, 'paint arrives with each tile');
  assert.equal(ly.stats.kept, 2 * ly.roads.length);
  // nearest first
  const d = (s) => Math.hypot(s.tile.x - Math.floor(t0.x), s.tile.y - Math.floor(t0.y));
  assert.ok(d(calls[0]) <= d(calls[calls.length - 1]), 'tiles nearest the middle go first');
  assert.ok(calls[0].vurl.startsWith('https://m/14/') && calls[0].city && calls[0].slab.grid.up instanceof Float32Array, 'job carries the address and the ground');
  assert.ok(!('hs' in calls[0].slab.grid), 'only the numbers a helper needs are sent');
  // no address yet: no jobs, and it says so
  const before = calls.length;
  const none = new City({ poly: sq(1500), cx, cy, k, run, mapUrl: () => null }).attach(built);
  assert.ok(none.noMap && none.total === 0 && calls.length === before, 'no map address, no jobs');
  // cancelling stops what has not started
  const city2 = new City({ poly: sq(1500), cx, cy, k, run, mapUrl, concurrency: 1 });
  const l2 = city2.attach(built);
  l2.cancel();
  await new Promise((r) => setTimeout(r, 100));
  assert.ok(l2.roads.length <= 1, 'a cancelled piece takes no more tiles: ' + l2.roads.length);
  ok('the loader fetches nearest first, a few at a time, counts failures, and can be cancelled');
}

console.log('city ok (' + n + ')');
