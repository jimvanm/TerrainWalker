// Landmark models: sane data, right sizes, and a correct vertex buffer.
import assert from 'node:assert/strict';
const { MODELS } = await import('../src/landmark_models.js');
// landmarks.js pulls in gl.js and nearfield.js, which look for a page.
globalThis.document = { getElementById: () => ({ style: {} }) };
const { LANDMARKS, buildVertices } = await import('../src/landmarks.js');

const height = { cn: 553.3, eiffel: 330, canton: 602 };
for (const L of LANDMARKS) {
  const m = MODELS[L.id];
  assert.ok(m, L.id + ' has a model');
  assert.equal(m.pos.length % 3, 0);
  assert.equal(m.col.length, m.pos.length);
  assert.equal(m.idx.length % 3, 0);
  const nv = m.pos.length / 3;
  assert.ok(m.idx.every((i) => Number.isInteger(i) && i >= 0 && i < nv), L.id + ' indices in range');
  const ys = m.pos.filter((_, i) => i % 3 === 1);
  assert.ok(Math.abs(Math.max(...ys) - height[L.id]) < 0.5, L.id + ' top is ' + height[L.id] + ' m');
  assert.ok(Math.min(...ys) >= 0, L.id + ' sits on the ground');
  assert.ok(Math.abs(L.lat) < 85 && Math.abs(L.lon) <= 180, L.id + ' coordinates are on the map');
  const { vertices, indices } = buildVertices(m, 0);
  assert.equal(vertices.byteLength, nv * 16);
  assert.equal(indices.length, m.idx.length);
  const f = new Float32Array(vertices), b = new Uint8Array(vertices);
  assert.ok(Math.abs(f[1] - m.pos[1]) < 1e-3);
  assert.equal(b[15], 255);
  // A quarter turn swaps the footprint's width and depth.
  const q = new Float32Array(buildVertices(m, 90).vertices);
  const w = (a, o) => { let lo = 1e9, hi = -1e9; for (let i = o; i < a.length; i += 4) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); } return hi - lo; };
  assert.ok(Math.abs(w(q, 0) - w(f, 2)) < 0.05 && Math.abs(w(q, 2) - w(f, 0)) < 0.05, L.id + ' yaw turns the model');
}

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
globalThis.document = { getElementById: () => ({ style: {} }) };
const gl = new Proxy({}, { get: (_, p) => {
  if (p === 'getAttribLocation') return () => 0;
  if (['getShaderParameter', 'getProgramParameter'].includes(p)) return () => true;
  return () => ({});
} });
const { Landmarks } = await import('../src/landmarks.js');
const lm = new Landmarks(gl);
for (const it of lm.items) {
  assert.ok(it.footprint.length >= 3, it.id + ' has a footprint');
  if (!it.fold) { assert.ok(O.dominantBearing(O.edgesOf(it.footprint), 4).strength < 0.1, it.id + ' is round'); continue; }
  for (const turn of [0, 37, -52, 71]) {
    const outline = { id: it.id, area: 1000, edges: O.edgesOf(O.turnPoints(it.footprint, turn)) };
    const r = lm.orientation([outline]).find((x) => x.name === it.name);
    const expect = O.wrapTo(turn, 360 / it.fold);
    assert.ok(r.suggestedYawDeg !== null && near(r.suggestedYawDeg, expect, 0.5), it.id + ': outline turned ' + turn + ' gives yaw ' + expect + ' (got ' + r.suggestedYawDeg + ')');
  }
  assert.equal(lm.orientation([]).find((x) => x.name === it.name).suggestedYawDeg, null, it.id + ': no outline, no guess');
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
