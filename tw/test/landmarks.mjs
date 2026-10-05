// Landmarks: every folder in landmarks/index.json is checked the same way, so a
// new landmark needs no test changes. Also the building masks, longitude
// wrap-around, heading from map outlines, and loading shapes only when in range.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

// The app reads landmark files with fetch(); here they come off the disk.
const fetches = [];
globalThis.fetch = async (url) => {
  fetches.push(String(url));
  const path = new URL(url);
  if (!existsSync(path)) return { ok: false, status: 404, json: async () => null };
  return { ok: true, status: 200, json: async () => JSON.parse(readFileSync(path, 'utf8')) };
};
globalThis.document = { getElementById: () => ({ style: {} }) };
const ROOT = new URL('../landmarks/', import.meta.url);
const read = (p) => JSON.parse(readFileSync(new URL(p, ROOT), 'utf8'));
const { buildVertices } = await import('../src/landmarks.js');
const { loadList, check } = await import('../src/landmark_list.js');

// ---- every listed landmark: complete, sane, and its shape matches its builder ----
const ids = read('index.json');
assert.ok(Array.isArray(ids) && ids.length > 0, 'index.json lists the landmarks');
assert.equal(new Set(ids).size, ids.length, 'no landmark listed twice');
const list = await loadList();
assert.equal(list.length, ids.length, 'every listed landmark loads: ' + list.map((L) => L.id).join(', '));
for (const id of ids) {
  const L = list.find((x) => x.id === id);
  const m = read(id + '/model.json');
  assert.equal(m.pos.length % 3, 0);
  assert.equal(m.col.length, m.pos.length);
  assert.equal(m.idx.length % 3, 0);
  assert.equal(m.tris, m.idx.length / 3, id + ': triangle count is right');
  const nv = m.pos.length / 3;
  assert.ok(m.idx.every((i) => Number.isInteger(i) && i >= 0 && i < nv), id + ' indices in range');
  const ys = m.pos.filter((_, i) => i % 3 === 1);
  assert.ok(Math.abs(Math.max(...ys) - L.height) < 0.5, id + ': top of the shape (' + Math.max(...ys) + ' m) matches landmark.json height ' + L.height);
  assert.ok(Math.min(...ys) >= 0, id + ' sits on the ground');
  assert.ok([0, 2, 3, 4].includes(L.fold), id + ': fold is 0, 2, 3 or 4');
  // model.json must be what build.mjs makes now, or a change was not baked.
  if (existsSync(new URL(id + '/build.mjs', ROOT))) {
    const { build } = await import(new URL(id + '/build.mjs', ROOT));
    const b = build();
    const same = b.idx.length === m.idx.length && Array.from(b.pos).every((v, i) => Math.abs(Math.round(v * 100) / 100 - m.pos[i]) < 1e-9);
    assert.ok(same, id + ': model.json is out of date; run  node tools/bake_landmark.mjs ' + id);
  }
  const { vertices, indices } = buildVertices(m, 0);
  assert.equal(vertices.byteLength, nv * 16);
  assert.equal(indices.length, m.idx.length);
  const f = new Float32Array(vertices), bb = new Uint8Array(vertices);
  assert.ok(Math.abs(f[1] - m.pos[1]) < 1e-3);
  assert.equal(bb[15], 255);
  // A quarter turn swaps the footprint's width and depth.
  const q = new Float32Array(buildVertices(m, 90).vertices);
  const w = (a, o) => { let lo = 1e9, hi = -1e9; for (let i = o; i < a.length; i += 4) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); } return hi - lo; };
  assert.ok(Math.abs(w(q, 0) - w(f, 2)) < 0.05 && Math.abs(w(q, 2) - w(f, 0)) < 0.05, id + ' yaw turns the model');
}
console.log('ok  ' + ids.length + ' landmarks complete, sane, and baked: ' + ids.join(', '));

// ---- a broken landmark.json is reported by name, not drawn in the wrong place ----
assert.throws(() => check('x', { name: 'X', lat: 43, lon: -79, height: 10 }), /maskR/);
assert.throws(() => check('x', { name: 'X', lat: '43', lon: -79, height: 10, maskR: 5 }), /lat/);
assert.throws(() => check('x', { name: 'X', lat: 95, lon: -79, height: 10, maskR: 5 }), /off the map/);
assert.equal(check('x', { name: 'X', lat: 43, lon: -79, height: 10, maskR: 5 }).fold, 0, 'fold defaults to round');
console.log('ok  a broken landmark.json is reported by field');

// ---- masking the ordinary building outlines under a landmark ----
const { touchesCircle, buildBuildings } = await import('../src/buildings.js');
const { MeshBuilder } = await import('../src/meshbuilder.js');
const { POLYGON } = await import('../src/mvt.js');
const { GRID } = await import('../src/heightgrid.js');
const sq = (x, y, w) => [x, y, x + w, y, x + w, y + w, x, y + w];
assert.ok(touchesCircle(sq(0, 0, 100), { x: 50, y: 50, r: 5 }), 'circle inside a building touches it');
assert.ok(touchesCircle(sq(0, 0, 100), { x: 105, y: 50, r: 10 }), 'circle poking over an edge touches it');
assert.ok(!touchesCircle(sq(0, 0, 100), { x: 150, y: 50, r: 10 }), 'a distant circle does not');
assert.ok(touchesCircle(sq(0, 0, 100), { x: 50, y: 50, r: 0.1 }), 'a tiny circle inside still counts');

const V = GRID + 1, nodes = new Float32Array(V * V).fill(100);
const size14 = 2446, g = { size14, size12: size14 * 4, bx: size14 * 2, by: size14 * 2, cosLat: 0.7224, nodes };
const E = 4096, per = size14 / E;                       // metres of tile per tile unit
const tileSq = (x, y, w) => [x, y, x + w, y, x + w, y + w, x, y + w, x, y];
const feat = (ring) => ({ type: POLYGON, parts: [ring], props: { render_height: 30 } });
const layer = { extent: E, features: [feat(tileSq(1000, 1000, 300)), feat(tileSq(3000, 3000, 300))] };
// a circle (tile-local merc metres) on the first building only
const at = (u) => (u / E - 0.5) * size14;
const mask = [{ x: at(1150), y: at(1150), r: 20 / g.cosLat }];
const plain = buildBuildings(layer, g, new MeshBuilder());
const masked = buildBuildings(layer, g, new MeshBuilder(), undefined, { mask });
assert.equal(plain.kept, 2, 'both buildings drawn without a mask');
assert.equal(masked.kept, 1, 'the building under the landmark is left out, the other stays');
assert.equal(masked.masked, 1);

// ---- the camera can run past longitude 180; towers must still be found ----
const { wrapMercDx, EQUATOR } = await import('../src/geo.js');
assert.ok(Math.abs(wrapMercDx(EQUATOR + 5) - 5) < 1e-6, 'one lap round the world is no distance');
assert.ok(Math.abs(wrapMercDx(-EQUATOR - 5) + 5) < 1e-6, 'and the other way round');
assert.equal(wrapMercDx(1234), 1234, 'a nearby place is untouched');
assert.ok(Math.abs(wrapMercDx(0.6 * EQUATOR) + 0.4 * EQUATOR) < 1e-6, 'past halfway, the short way round is used');

// ---- heading from map outlines (orient.js) ----
const O = await import('../src/orient.js');
const near = (a, b, tol = 0.05) => Math.abs(O.wrapTo(a - b, 360)) < tol;
assert.equal(O.wrapTo(100, 90), 10); assert.equal(O.wrapTo(-100, 90), -10); assert.equal(O.wrapTo(45, 90), 45);
const box = (w, h) => [[-w / 2, -h / 2], [w / 2, -h / 2], [w / 2, h / 2], [-w / 2, h / 2]];
for (const a of [0, 20, -35, 44]) {
  const d = O.dominantBearing(O.edgesOf(O.turnPoints(box(40, 40), a)), 4);
  assert.ok(near(d.bearing, a) && d.strength > 0.99, 'a square turned ' + a + ' reads ' + a);
}
const circle = Array.from({ length: 36 }, (_, i) => [30 * Math.cos(i / 36 * 2 * Math.PI), 30 * Math.sin(i / 36 * 2 * Math.PI)]);
assert.ok(O.dominantBearing(O.edgesOf(circle), 4).strength < 0.05, 'a round shape has no preferred direction');
// every real model: its own footprint, turned by a known angle, is read back
const gl = new Proxy({}, { get: (_, p) => {
  if (p === 'getAttribLocation') return () => 0;
  if (['getShaderParameter', 'getProgramParameter'].includes(p)) return () => true;
  return () => ({});
} });
const { Landmarks, sightRange } = await import('../src/landmarks.js');
const { MeshProgram } = await import('../src/meshprogram.js');
const settle = () => new Promise((r) => setTimeout(r, 0));
const viewAt = (mx, my, k, agl = 2) => ({ mercX: mx, mercY: my, k, agl });
const lm = new Landmarks(gl, new MeshProgram(gl));
await settle();
assert.equal(lm.items.length, ids.length, 'one placement per listed landmark');
for (const it of lm.items) {
  // Stand next to it, so its shape loads (the others, far away, are freed).
  lm.update(viewAt(it.mx, it.my, it.k), () => 100);
  await settle();
  lm.update(viewAt(it.mx, it.my, it.k), () => 100);
  const footprint = lm.models.get(it.model).footprint;
  assert.ok(footprint.length >= 3, it.id + ' has a footprint');
  if (!it.fold) { assert.ok(O.dominantBearing(O.edgesOf(footprint), 4).strength < 0.1, it.id + ' is round'); continue; }
  for (const turn of [0, 37, -52, 71]) {
    const outline = { id: it.id, area: 1000, edges: O.edgesOf(O.turnPoints(footprint, turn)) };
    const r = lm.orientation([outline]).find((x) => x.name === it.name);
    const expect = O.wrapTo(turn, 360 / it.fold);
    // A weak footprint (few straight edges) may give no suggestion; it must not give a wrong one.
    if (r.suggestedYawDeg === null) { assert.ok(r.modelEdgeStrength < 0.5, it.id + ': no suggestion, but its edges are clear'); continue; }
    assert.ok(near(r.suggestedYawDeg, expect, 0.5), it.id + ': outline turned ' + turn + ' gives yaw ' + expect + ' (got ' + r.suggestedYawDeg + ')');
  }
  assert.equal(lm.orientation([]).find((x) => x.name === it.name).suggestedYawDeg, null, it.id + ': no outline, no guess');
}

// ---- shapes load only within sight, and are freed when far away ----
{
  fetches.length = 0;
  const lm2 = new Landmarks(gl, new MeshProgram(gl));
  await settle();
  const cn = lm2.items.find((x) => x.id === 'cn'), eiffel = lm2.items.find((x) => x.id === 'eiffel');
  const toronto = viewAt(cn.mx, cn.my, cn.k, 2);
  lm2.update(toronto, () => 100); await settle(); lm2.update(toronto, () => 100);
  const shapes = () => fetches.filter((u) => u.endsWith('model.json')).map((u) => u.split('/').at(-2));
  assert.ok(shapes().includes('cn'), 'standing in Toronto, the CN Tower shape loads');
  assert.ok(!shapes().includes('eiffel') && !shapes().includes('canton'), 'but not the Eiffel or Canton shapes');
  assert.ok(cn.vao && cn.base !== null && cn.inRange, 'the CN Tower is ready to draw');
  assert.equal(lm2.resolved, lm2.inRange, 'everything in sight is ready (status bar goes green)');
  // Fly to Paris: the CN Tower is freed, the Eiffel Tower loads.
  const paris = viewAt(eiffel.mx, eiffel.my, eiffel.k, 2);
  lm2.update(paris, () => 30); await settle(); lm2.update(paris, () => 30);
  assert.ok(!lm2.models.has('cn') && !cn.vao, 'far from Toronto, the CN Tower shape is freed');
  assert.ok(eiffel.vao, 'the Eiffel Tower is ready');
  // The range follows height: a 553 m tower is seen from much farther than a 90 m one.
  assert.ok(sightRange(553, 2) > 80000 && sightRange(90, 2) < 40000, 'tall landmarks load from farther away');
  assert.ok(sightRange(90, 5000) > sightRange(90, 2), 'and from higher up you see farther');
  // The same shape can stand in a second place.
  const vesuvius = lm2.add({ model: 'cn', name: 'CN Tower at Vesuvius', lat: 40.8215, lon: 14.4260, height: 553.3, maskR: 0 });
  const nap = viewAt(vesuvius.mx, vesuvius.my, vesuvius.k, 2);
  lm2.update(nap, () => 1000); await settle(); lm2.update(nap, () => 1000);
  assert.ok(vesuvius.vao && vesuvius.base === 1000 - 6, 'a second placement of a shape draws where it was put');
  console.log('ok  shapes load within sight and are freed far away; one shape can stand in several places');
}
// the yaw turns the model clockwise: east becomes south
const one = buildVertices({ pos: [10, 0, 0, 0, 5, 0, 0, 0, 5], col: new Array(9).fill(0), idx: [0, 1, 2] }, 90);
const ff = new Float32Array(one.vertices);
assert.ok(Math.abs(ff[0]) < 1e-4 && Math.abs(ff[2] - 10) < 1e-4, 'yaw 90: a point east of the tower ends up south of it');

// outlines of masked buildings are kept, in metres east and north of the tower
{
  const g2 = { size14, size12: size14 * 4, bx: size14 * 2, by: size14 * 2, cosLat: 0.7224, nodes };
  const cc = { id: 'x', x: at(1150), y: at(1150), r: 20 / g2.cosLat };
  const st = buildBuildings(layer, g2, new MeshBuilder(), undefined, { mask: [cc] });
  assert.equal(st.outlines.length, 1, 'one masked building recorded');
  const o1 = st.outlines[0];
  assert.equal(o1.id, 'x');
  const side = 300 * per * g2.cosLat;                              // true metres
  assert.ok(Math.abs(o1.area - side * side) < 0.02 * side * side, 'outline area is in square metres');
  assert.equal(o1.edges.length, 16, 'a box has four edges');
  // north is up the screen: the box's top edge (smaller y) lies north of the centre
  const ns = []; for (let i = 1; i < o1.edges.length; i += 2) ns.push(o1.edges[i]);
  assert.ok(Math.max(...ns) > 0 && Math.min(...ns) < 0, 'the tower sits inside its outline');
}
{
  // a building cut by the tile edge: the cut edge is the tile's doing, so it is left out
  const g3 = { size14, size12: size14 * 4, bx: size14 * 2, by: size14 * 2, cosLat: 0.7224, nodes };
  const cut = { extent: E, features: [feat(tileSq(3900, 1000, 600))] };
  const cc2 = { id: 'y', x: at(4000), y: at(1300), r: 30 / g3.cosLat };
  const st2 = buildBuildings(cut, g3, new MeshBuilder(), undefined, { mask: [cc2] });
  assert.equal(st2.outlines.length, 1, 'the cut building is recorded');
  assert.equal(st2.outlines[0].edges.length, 12, 'three real edges kept, the edge along the tile boundary dropped');
}
console.log('landmarks ok');
