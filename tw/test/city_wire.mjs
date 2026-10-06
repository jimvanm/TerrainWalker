// A city on a moved piece, through the tool: pick up with its landmarks, carry,
// lay, buttons, change height, remove. Map tiles are made up here.
import assert from 'node:assert/strict';
import { posted, fakeGL } from './_fakes.mjs';

const draws = [];
const gl = fakeGL(draws);
const geo = await import('../src/geo.js');
const T = await import('../src/transplant.js');
const { Landmarks, SINK } = await import('../src/landmarks.js');
const { MeshProgram } = await import('../src/meshprogram.js');
const { buildCityTile, samplePaint } = await import('../src/citykit.js');
const { workerRunner } = await import('../src/city.js');
const { slabHeightFn } = await import('../src/piecegrid.js');
const { LINESTRING, POLYGON } = await import('../src/mvt.js');
const { MASK } = await import('../src/overlayraster.js');

let n = 0;
const ok = (name) => { n++; console.log('ok  ' + name); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- made-up map tiles: a road across every tile, a tall house in its middle, water everywhere
const E = 4096;
const wet = { mask: (() => { const m = new Uint8Array(MASK * MASK * 4); for (let i = 0; i < MASK * MASK; i++) { m[4 * i] = 255; m[4 * i + 3] = 255; } return m; })(),
  cover: (() => { const c = new Uint8Array(MASK * MASK * 3); for (let i = 0; i < c.length; i += 3) { c[i] = 50; c[i + 1] = 90; c[i + 2] = 40; } return c; })() };
const runCity = async (spec) => {
  await sleep(1);
  const layers = {
    transportation: { extent: E, features: [{ type: LINESTRING, cls: 'primary', props: {}, parts: [[0, E / 2, E, E / 2]] }] },
    building: { extent: E, features: [{ type: POLYGON, cls: 'building', props: { render_height: 40 }, parts: [[E / 2 - 40, E / 2 - 40, E / 2 + 40, E / 2 - 40, E / 2 + 40, E / 2 + 40, E / 2 - 40, E / 2 + 40, E / 2 - 40, E / 2 - 40]] }] },
  };
  const out = buildCityTile(layers, { slab: spec.slab, tile: spec.tile });
  return { ...out, paint: samplePaint(wet, spec.slab, spec.tile) };
};

// ---- landmarks: one inside the outline, one far outside
const lat0 = 43.65, lon0 = -79.38;
const sx = geo.lonToMercX(lon0), sy = geo.latToMercY(lat0), sk = geo.mercScale(lat0);
const at = (de, dn) => ({ lat: geo.mercYToLat(sy + dn / sk), lon: geo.mercXToLon(sx + de / sk) });
const list = [
  { id: 'tower', name: 'Tower', height: 150, maskR: 30, yawDeg: 10, ...at(100, 100) },
  { id: 'far', name: 'Far one', height: 80, maskR: 30, yawDeg: 0, ...at(5000, 0) },
];
const model = { pos: new Float32Array([0, 0, 0, 10, 0, 0, 0, 50, 10]), col: new Uint8Array(9), idx: new Uint32Array([0, 1, 2]) };
const mesh = new MeshProgram(gl);
const L = new Landmarks(gl, mesh, list);
await L.ready;
L.addModel('tower', model); L.addModel('far', model);

// ---- the ground: a slope; the destination is flat at 180 m
const fetchTile = async (z, x, y) => {
  const s = geo.tileSizeMerc(z), h = new Float32Array(256 * 256);
  for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) h[j * 256 + i] = 100 + ((-geo.HALF + (x + (i + 0.5) / 256) * s) - sx) * sk * 0.04;
  return h;
};
const tp = new T.Transplant(L, fetchTile);
tp.mapUrl = (z, x, y) => `https://map/${z}/${x}/${y}`;
tp.runCity = runCity;
const ground = () => 180;

tp.toggle();
for (const [de, dn] of [[-600, -600], [600, -600], [600, 600], [-600, 600]]) { tp.aim = { mx: sx + de / sk, my: sy + dn / sk }; tp.click(() => 100); }
await tp.close();
assert.equal(tp.state, 'carrying');

// 1. what comes along
{
  assert.equal(tp.piece.carry.length, 1, 'the landmark inside the outline comes along, the one outside does not');
  const c = tp.piece.carry[0];
  assert.ok(c.model === 'tower' && Math.abs(c.e - 100) < 0.5 && Math.abs(c.n - 100) < 0.5, `with its place on the piece (${c.e.toFixed(1)}, ${c.n.toFixed(1)})`);
  assert.ok(L.items.some((it) => it.model === 'tower' && !it.carriedBy), 'and the original stays where it is');
  const ly = tp.piece.layers;
  assert.ok(ly && ly.total >= 1 && !ly.noMap, 'the map tiles are being fetched while it is carried: ' + ly.total);
  const cam0 = { mercX: geo.lonToMercX(-87.63), mercY: geo.latToMercY(41.88), alt: 3000, yaw: 0, pitch: -Math.PI / 3 };
  tp.update(cam0, ground, null);
  assert.match(tp.message, /map \d+\/\d+|click lays it down/, 'the message line shows the map filling in');
  ok('landmarks inside the outline come along as copies; the map starts loading in hand');
}

// 2. nothing of the city is drawn in hand; it arrives and is drawn once laid
await sleep(120);
const cam = { mercX: geo.lonToMercX(-87.63), mercY: geo.latToMercY(41.88), alt: 3000, yaw: 0, pitch: -Math.PI / 3 };
{
  const ly = tp.piece.layers;
  assert.equal(ly.settled, ly.total, 'every map tile has been built');
  assert.ok(ly.roads.length >= 1 && ly.built.length >= 1, 'with roads and buildings');
  tp.update(cam, ground, null);
  assert.ok(!tp.preview.hidden);
  const view = { mercX: tp.preview.mx, mercY: tp.preview.my, k: geo.mercScale(41.88), agl: 3000 };
  L.update(view, () => 180);
  assert.ok(!(tp.preview.xbufs || []).length, 'while carried only the shape is drawn');
  tp.click(ground);
  const piece = L.items.find((it) => it.piece);
  assert.ok(piece && piece.carried.length === 1, 'laid down, with its landmark');
  ok('while carried only the shape; laid, the city comes with it');
}

const piece = () => L.items.find((it) => it.piece);
const carried = () => L.items.filter((it) => it.carriedBy);
const pass = (it) => ({ alt: 500, mercX: it.mx, mercY: it.my, k: geo.mercScale(41.88) });
const update = () => { const it = piece(); L.update({ mercX: it.mx, mercY: it.my, k: geo.mercScale(41.88), agl: 500 }, () => 180); };

// 3. the landmark stands where it stood, on the piece's ground, turned with it
{
  const it = piece(), lm = carried()[0];
  const kk = geo.mercScale(geo.mercYToLat(it.my));
  assert.ok(Math.abs((lm.mx - it.mx) * kk - 100) < 0.5 && Math.abs((lm.my - it.my) * kk - 100) < 0.5, 'unturned: 100 m east and 100 m north of the middle');
  const H = slabHeightFn(it.piece.grid);
  assert.ok(Math.abs(lm.base - (it.base + H(100, -100) - SINK)) < 1e-6, 'on the piece\'s ground: ' + lm.base.toFixed(2));
  assert.equal(lm.yawDeg, 10, 'facing as before');
  // lay a second copy, turned a quarter
  tp.turn(1); for (let i = 0; i < 5; i++) tp.turn(1);       // 6 x 15 = 90 degrees
  tp.update(cam, ground, null); tp.click(ground);
  const pieces = L.items.filter((p) => p.piece);
  assert.equal(pieces.length, 2);
  const second = pieces[1], lm2 = second.carried[0];
  const k2 = geo.mercScale(geo.mercYToLat(second.my));
  assert.equal(second.yawDeg, 90);
  assert.ok(Math.abs((lm2.mx - second.mx) * k2 - 100) < 0.5 && Math.abs((lm2.my - second.my) * k2 + 100) < 0.5, 'turned a quarter: its landmark swings from north-east to south-east');
  assert.equal(lm2.yawDeg, 100, 'and faces 90 degrees further round');
  assert.equal(carried().length, 2, 'each copy has its own');
  ok('carried landmarks stand where they stood, on its ground, turned with it');
}

// 4. each button
{
  const first = piece();
  L.setLayers({ water: true, roads: true, built: true, cover: true, land: true });
  update();
  assert.ok(first.xbufs.length >= 2, 'the roads and buildings are uploaded: ' + first.xbufs.length);
  const count = (on) => { L.setLayers(on); draws.length = 0; L.draw(pass(first)); return draws.length; };
  const all = { water: true, roads: true, built: true, cover: true, land: true };
  const full = count(all);
  const all2 = L.items.flatMap((it) => it.xbufs || []);          // both laid copies are in range
  const roads = all2.filter((x) => x.kind === 'roads').length, built = all2.filter((x) => x.kind === 'built').length;
  assert.ok(roads >= 1 && built >= 1);
  assert.equal(full - count({ ...all, roads: false }), roads, 'ROADS off takes the roads away, nothing else');
  assert.equal(full - count({ ...all, built: false }), built, 'BUILT off takes the buildings away');
  const noLand = count({ ...all, land: false });
  assert.ok(full - noLand >= 1, 'LANDMARKS off takes the landmarks it carries away');
  // the preview of a landmark being dropped (M) follows LANDMARKS too
  const lp = L.add({ model: 'tower', name: 'Dropping', lat: first.lat, lon: first.lon, height: 150, maskR: 0, id: 'preview', preview: true });
  lp.fixedBase = true; lp.base = 100; update();
  assert.ok(lp.vao, 'its buffers exist');
  assert.equal(count(all) - count({ ...all, land: false }), full - noLand + 1, 'a landmark being dropped is hidden with the rest when LANDMARKS is off');
  L.remove(lp);
  const slabOnly = count({ water: true, roads: false, built: false, cover: true, land: false });
  assert.ok(slabOnly >= 1, 'but moved ground is always drawn');
  assert.equal(count(all), full, 'and everything comes back');
  ok('ROADS, BUILT and LANDMARKS each take their own part of a moved piece away; the ground stays');
}

// 5. the painted map follows WATER
{
  const first = piece(), m = L.models.get(first.piece.modelId);
  const col = m.model.col, col0 = m.col0;
  L.setLayers({ water: true, roads: true, built: true, cover: true, land: true }); update();
  const wetNodes = [...first.piece.nodeVert].filter((v) => v >= 0 && col[3 * v + 2] === 122).length;
  assert.ok(wetNodes > 1000, 'with WATER on the ground is painted water: ' + wetNodes + ' vertices');
  const blue = () => [...first.piece.nodeVert].filter((v) => v >= 0 && col[3 * v + 2] === 122).length;
  L.setLayers({ water: false, roads: true, built: true, cover: true, land: true }); update();
  assert.equal(blue(), 0, 'with WATER off there is no water on it');
  const v0 = [...first.piece.nodeVert].find((v) => v >= 0);
  assert.deepEqual([col[3 * v0], col[3 * v0 + 1], col[3 * v0 + 2]], [50, 90, 40], 'it shows the land cover instead');
  L.setLayers({ water: false, roads: true, built: true, cover: false, land: true }); update();
  assert.deepEqual([...col], [...col0], 'with COVER off too it is the plain ground again');
  L.setLayers({ water: true, roads: true, built: true, cover: true, land: true }); update();
  ok('the painted water follows its button');
}

// 6. change height where it lies: its city is rebuilt on the new ground, its landmark restood
{
  const first = piece();
  const aim = { mx: first.mx, my: first.my };
  const before = carried().length, oldLm = first.carried[0];
  assert.ok(tp.state !== 'carrying' || (tp.toggle(), true));
  assert.ok(tp.toggleAt(aim, ground), 'U over the laid piece');
  const nu = L.items.find((it) => it.piece && it.piece.mode === 'sea');
  assert.ok(nu, 'it now stands at its height above sea level');
  assert.equal(carried().length, before, 'still one landmark per copy: the old one went, a new one stands');
  assert.ok(!L.items.includes(oldLm) && nu.carried.length === 1, 'the new one is the new piece\'s');
  const H = slabHeightFn(nu.piece.grid);
  assert.ok(Math.abs(nu.carried[0].base - (nu.base + H(100, -100) - SINK)) < 1e-6, 'on the new ground');
  await sleep(120);
  const ly = nu.piece.layers;
  assert.ok(ly && ly !== first.piece.layers && ly.settled === ly.total && ly.roads.length >= 1, 'its roads and buildings are made again on the new ground');
  // a vertex of its road stands on the new (sea level) ground
  const f = new Float32Array(ly.roads[0].vertices), Hs = slabHeightFn(nu.piece.grid);
  let off = 0;
  for (let i = 0; i < f.length / 4; i += 3) off = Math.max(off, Math.abs(f[4 * i + 1] - Hs(f[4 * i], f[4 * i + 2]) - 0.3));
  assert.ok(off < 0.25, 'the new road lies on the new ground (within ' + off.toFixed(3) + ' m of it)');
  ok('changing height rebuilds the city on the new ground and re-stands its landmark');
}

// 7. take it away
{
  const total = L.items.length;
  const first = L.items.find((it) => it.piece && it.carried);
  const lms = first.carried.slice();
  assert.ok(tp.removeAt(first), 'Delete removes the piece');
  assert.ok(!L.items.includes(first) && lms.every((l) => !L.items.includes(l)), 'and its landmark with it');
  assert.equal(L.items.length, total - 1 - lms.length);
  assert.ok((first.xbufs || []).length === 0, 'and its roads and buildings are freed');
  ok('removing a piece removes what it carried');
}

// 8. the helpers are reached through a pool
{
  const run = workerRunner(1);
  const before = posted.length;
  run({ city: true, vurl: 'x', tile: { x: 1, y: 2, z: 14 }, slab: {}, maskModels: [] });
  assert.ok(posted.length === before + 1 && posted[before].city === true && typeof posted[before].id === 'number', 'the job goes to a helper, tagged as a city job');
  ok('city jobs reach the near-field helper');
}
console.log('city_wire ok (' + n + ')');
process.exit(0);
