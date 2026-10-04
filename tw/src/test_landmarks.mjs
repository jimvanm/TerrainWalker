// Landmark models: sane data, right sizes, and a correct vertex buffer.
import assert from 'node:assert/strict';
const { MODELS } = await import('./landmark_models.js');
// landmarks.js pulls in gl.js and nearfield.js, which look for a page.
globalThis.document = { getElementById: () => ({ style: {} }) };
const { LANDMARKS, buildVertices } = await import('./landmarks.js');

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
const { touchesCircle, buildBuildings } = await import('./buildings.js');
const { MeshBuilder } = await import('./meshbuilder.js');
const { POLYGON } = await import('./mvt.js');
const { GRID } = await import('./heightgrid.js');
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
console.log('landmarks ok');
