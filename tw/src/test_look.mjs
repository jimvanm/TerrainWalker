// 0.12.0: airport areas laid on the ground, and the facts stored per building
// for the colour keys (6 real, 7 type, 8 set, 9 brighter).
// Run: node src/test_look.mjs
import assert from 'node:assert/strict';
import { buildRoads } from './roads.js';
import { buildBuildings, parseColour } from './buildings.js';
import { MeshBuilder } from './meshbuilder.js';
import { GRID, nodeHeightAt } from './heightgrid.js';
import { tileSizeMerc } from './geo.js';
import { POLYGON, LINESTRING } from './mvt.js';

const ok = (m) => console.log('ok  ' + m);
const size12 = tileSizeMerc(12), size14 = tileSizeMerc(14), V = GRID + 1;

// Bumpy ground, so anything that cuts across terrain triangles would show.
let seed = 7;
const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
const nodes = new Float32Array(V * V);
for (let i = 0; i < nodes.length; i++) nodes[i] = 100 + rnd() * 20;
const g = { size14, size12, bx: size12 / 2, by: size12 / 2, cosLat: 0.72, nodes };
const hAt = (e, s) => nodeHeightAt(nodes, (e + g.bx) / size12, (g.by + s) / size12);

// 1. An apron with a hole: covered area matches, and every point sits on the ground.
{
  const sq = (x0, y0, x1, y1, cw) => cw ? [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0] : [x0, y0, x0, y1, x1, y1, x1, y0, x0, y0];
  const aero = { extent: 4096, features: [
    { type: POLYGON, cls: 'apron', props: {}, parts: [sq(300, 400, 2900, 1700, true), sq(1000, 800, 1400, 1200, false)] },
    { type: POLYGON, cls: 'aerodrome', props: {}, parts: [sq(0, 0, 4096, 4096, true)] },   // the green outline: not drawn
  ] };
  const mb = new MeshBuilder();
  const counts = {};
  buildRoads(null, g, mb, aero, counts);
  const r = mb.finish(), f = new Float32Array(r.vertices);
  const k = size14 / 4096;
  const want = ((2600 * 1300) - (400 * 400)) * k * k;
  let area = 0, worst = 0;
  for (let t = 0; t < r.indices.length; t += 3) {
    const [a, b, c] = [r.indices[t], r.indices[t + 1], r.indices[t + 2]];
    const ax = f[4 * a], az = f[4 * a + 2], bx = f[4 * b], bz = f[4 * b + 2], cx = f[4 * c], cz = f[4 * c + 2];
    area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    // A random point inside the piece: its height from the piece vs the ground.
    let u = rnd(), v = rnd(); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const px = ax + (bx - ax) * u + (cx - ax) * v, pz = az + (bz - az) * u + (cz - az) * v;
    const py = f[4 * a + 1] + (f[4 * b + 1] - f[4 * a + 1]) * u + (f[4 * c + 1] - f[4 * a + 1]) * v;
    worst = Math.max(worst, Math.abs(py - 0.06 - hAt(px, pz)));
  }
  assert.ok(Math.abs(area - want) / want < 1e-6, 'area ' + area + ' want ' + want);
  assert.ok(worst < 1e-4, 'off the ground by ' + worst);   // stored as 32-bit floats: ~8e-6 m steps at 120 m
  assert.equal(counts.aeroAreas, 1);
  ok(`apron with a hole: area right to 1 part in a million, worst height error ${worst.toExponential(1)} m (${r.indices.length / 3} pieces)`);
}

// 2. A runway mapped only as a line gets 45 m; it is in the first (farthest) part.
{
  const aero = { extent: 4096, features: [
    { type: LINESTRING, cls: 'runway', props: {}, parts: [[200, 2000, 3800, 2000]] },
    { type: LINESTRING, cls: 'taxiway', props: {}, parts: [[200, 2600, 3800, 2600]] },
  ] };
  const mb = new MeshBuilder();
  const ends = buildRoads(null, g, mb, aero);
  const r = mb.finish(), f = new Float32Array(r.vertices);
  const w = Math.hypot(f[0] - f[4], f[2] - f[6]) * g.cosLat;
  assert.ok(Math.abs(w - 45) < 0.01, 'runway width ' + w);
  assert.ok(ends[0] > 0 && ends[1] > ends[0], 'runway first, taxiway in the middle part');
  ok('runway line 45 m wide and drawn from farthest away; taxiway in the middle part');
}

// 3. Building facts: map colour, type from land use, tall wins.
{
  assert.deepEqual(parseColour('#ff8000'), [255, 128, 0]);
  assert.deepEqual(parseColour('#abc'), [170, 187, 204]);
  assert.equal(parseColour('red'), null);
  const box = (x, y, s = 60) => [x, y, x + s, y, x + s, y + s, x, y + s, x, y];
  const flat = new Float32Array(V * V).fill(100);
  const gf = { ...g, nodes: flat };
  const bld = { extent: 4096, features: [
    { type: POLYGON, cls: null, props: { render_height: 10, colour: '#ff8000' }, parts: [box(500, 500)] },   // in homes area
    { type: POLYGON, cls: null, props: { render_height: 10 }, parts: [box(2500, 500)] },                    // in industry
    { type: POLYGON, cls: null, props: { render_height: 80 }, parts: [box(520, 900)] },                     // tall, in homes area
    { type: POLYGON, cls: null, props: { render_height: 10 }, parts: [box(3500, 3500)] },                   // no land use
  ] };
  const lu = { extent: 4096, features: [
    { type: POLYGON, cls: 'residential', parts: [box(300, 300, 1200)] },
    { type: POLYGON, cls: 'industrial', parts: [box(2300, 300, 800)] },
  ] };
  const mb = new MeshBuilder();
  const st = buildBuildings(bld, gf, mb, undefined, { landuse: lu });
  const out = mb.finish();
  assert.equal(st.kept, 4);
  assert.equal(st.real, 1);
  assert.deepEqual(st.types, [1, 1, 0, 1, 0, 1, 0, 0]);
  const types = new Set(), flags = new Set();
  for (const x of out.info) { types.add(x & 255); flags.add(x >>> 24); }
  assert.deepEqual([...flags].sort(), [1, 3], 'every vertex is a building; one has a map colour');
  // The orange building's vertex colour is the map colour, unshaded.
  const u = new Uint32Array(out.vertices);
  const orange = [...out.info.keys()].filter((i) => (out.info[i] >>> 24) === 3).map((i) => u[4 * i + 3] & 0xffffff);
  assert.ok(orange.length && orange.every((c) => c === 0x0080ff), 'map colour stored');
  ok('map colour read and stored; types: homes, industry, tall, unknown');
}

console.log('look ok');
