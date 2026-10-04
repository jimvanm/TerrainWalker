// 0.12.0: airport areas laid on the ground, and the facts stored per building
// for the colour keys (6 real, 7 type, 8 set, 9 brighter).
// Run: node src/test_look.mjs
import assert from 'node:assert/strict';
import { buildRoads } from '../src/roads.js';
import { buildBuildings, parseColour } from '../src/buildings.js';
import { MeshBuilder } from '../src/meshbuilder.js';
import { GRID, nodeHeightAt } from '../src/heightgrid.js';
import { tileSizeMerc } from '../src/geo.js';
import { POLYGON, LINESTRING } from '../src/mvt.js';
import { parseRef, numberFor, fitRect } from '../src/runways.js';

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
    worst = Math.max(worst, Math.abs(py - 0.32 - hAt(px, pz)));
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
  const r = mb.finish(), f = new Float32Array(r.vertices), u = new Uint32Array(r.vertices);
  // Pavement pieces of the first part (the runway): area = 45 m x length, and
  // every point on the bumpy ground (0.12.6: laid exactly, not edge-only).
  const k = size14 / 4096;
  let area = 0, worst = 0;
  for (let t = 0; t < ends[0]; t += 3) {
    const [a, b, c] = [r.indices[t], r.indices[t + 1], r.indices[t + 2]];
    if ((u[4 * a + 3] & 0xffffff) !== 0x635e5e) continue;      // pavement grey 94,94,99
    const ax = f[4 * a], az = f[4 * a + 2], bx = f[4 * b], bz = f[4 * b + 2], cx = f[4 * c], cz = f[4 * c + 2];
    area += Math.abs((bx - ax) * (cz - az) - (cx - ax) * (bz - az)) / 2;
    for (const i of [a, b, c]) worst = Math.max(worst, Math.abs(f[4 * i + 1] - 0.32 - hAt(f[4 * i], f[4 * i + 2])));
    let p = rnd(), q = rnd(); if (p + q > 1) { p = 1 - p; q = 1 - q; }
    const px = ax + (bx - ax) * p + (cx - ax) * q, pz = az + (bz - az) * p + (cz - az) * q;
    const py = f[4 * a + 1] + (f[4 * b + 1] - f[4 * a + 1]) * p + (f[4 * c + 1] - f[4 * a + 1]) * q;
    worst = Math.max(worst, Math.abs(py - 0.32 - hAt(px, pz)));
  }
  const want = 3600 * k * (45 / g.cosLat);
  assert.ok(Math.abs(area - want) / want < 1e-6, 'runway area ' + area + ' want ' + want);
  assert.ok(worst < 1e-4, 'runway off the ground by ' + worst);
  assert.ok(ends[0] > 0 && ends[1] > ends[0], 'runway first, taxiway in the middle part');
  ok(`runway line: 45 m wide, laid on bumpy ground (worst ${worst.toExponential(1)} m), drawn from farthest away; taxiway in the middle part`);
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
  assert.deepEqual([...flags].sort(), [1, 3, 5, 7], 'every vertex is a building (walls 1, roofs +4); one has a map colour (+2)');
  // The orange building's vertex colour is the map colour, unshaded.
  const u = new Uint32Array(out.vertices);
  const orange = [...out.info.keys()].filter((i) => (out.info[i] >>> 24) === 3).map((i) => u[4 * i + 3] & 0xffffff);
  assert.ok(orange.length && orange.every((c) => c === 0x0080ff), 'map colour stored');
  ok('map colour read and stored; types: homes, industry, tall, unknown');
}

// 4. Runway markings.
{
  assert.deepEqual(parseRef('06L/24R').map((p) => p.s + p.letter), ['06L', '24R']);
  assert.deepEqual(parseRef('9/27').map((p) => p.s), ['09', '27']);
  assert.equal(numberFor(parseRef('06L/24R'), 52).s, '06');     // magnetic vs true: still the closer one
  assert.equal(numberFor(parseRef('06L/24R'), 232).s, '24');
  assert.equal(numberFor(parseRef('18/36'), 355).s, '36');
  const r = fitRect([0, 0, 100, 0, 100, 10, 0, 10]);
  assert.ok(Math.abs(r.len - 100) < 1e-9 && Math.abs(r.w - 10) < 1e-9 && Math.abs(Math.abs(r.u[0]) - 1) < 1e-9);
  ok('runway numbers: parsed, and the right one picked for each end');

  // A 06/24 runway wholly inside the tile, as an area (with the number on a line).
  const k = size14 / 4096, ang = 60 * Math.PI / 180;            // bearing 060
  const ue = Math.sin(ang), us = -Math.cos(ang);                // east, south
  const len = 2000 / k / g.cosLat * 0.72, wid = 45 / k / g.cosLat * 0.72;
  const cx = 2048, cy = 2048;
  const corner = (t, n) => [cx + ue * t - us * n, cy + us * t + ue * n];
  const rect = (L) => [...corner(-L / 2, -wid / 2), ...corner(L / 2, -wid / 2), ...corner(L / 2, wid / 2), ...corner(-L / 2, wid / 2), ...corner(-L / 2, -wid / 2)];
  const run = (L, shift) => {
    const ring = rect(L).map((v, i) => (i % 2 === 0 ? v + shift : v));
    const aero = { extent: 4096, features: [
      { type: POLYGON, cls: 'runway', props: {}, parts: [ring] },
      { type: LINESTRING, cls: 'runway', props: { ref: '06/24' }, parts: [[cx + shift - ue * L / 2, cy - us * L / 2, cx + shift + ue * L / 2, cy + us * L / 2]] },
    ] };
    const mb = new MeshBuilder(), counts = {};
    buildRoads(null, g, mb, aero, counts);
    return { counts, out: mb.finish() };
  };
  const a = run(len, 0);
  assert.equal(a.counts.runways, 1, 'the line was folded into the area');
  assert.equal(a.counts.runwayNumbers, 2);
  // Every white vertex inside the tile and on the ground at the marking lift.
  const f = new Float32Array(a.out.vertices), u = new Uint32Array(a.out.vertices);
  const h = size14 / 2;
  let whites = 0, worst = 0, out = 0;
  for (let i = 0; i < a.out.verts; i++) {
    if ((u[4 * i + 3] & 0xffffff) !== 0xdee2e2) continue;
    whites++;
    if (Math.abs(f[4 * i]) > h + 1e-3 || Math.abs(f[4 * i + 2]) > h + 1e-3) out++;
    worst = Math.max(worst, Math.abs(f[4 * i + 1] - 0.35 - hAt(f[4 * i], f[4 * i + 2])));
  }
  assert.ok(whites > 0 && out === 0 && worst < 1e-4, `whites ${whites} outside ${out} worst ${worst}`);
  // Same runway pushed half off the west side of the tile: one true end left.
  const b = run(len, -2600);
  assert.equal(b.counts.runwayNumbers, 1, 'cut end got a number');
  ok(`runway 06/24: two numbers when whole, one when cut by the tile edge; ${whites} white points all on the ground and inside the tile`);
}


// 5. Real map data (K reports, 2026-10-04): Pearson and Billy Bishop. Every
// runway there is a centre line, often split into short pieces. Each true end
// must get exactly one number, and split points none.
{
  const { readFileSync } = await import('node:fs');
  const tiles = JSON.parse(readFileSync(new URL('./runway_data.json', import.meta.url)));
  const want = {
    '14/4569/5977': ['24R'], '14/4569/5978': ['24L'], '14/4568/5977': [], '14/4568/5978': ['06L', '33R'],
    '14/4568/5979': ['06R'], '14/4567/5977': [], '14/4567/5978': ['33L'],
    '14/4578/5980': ['24', '26'], '14/4578/5981': ['06', '08'],
    // JFK (0.12.10): two runways mapped as areas that include shoulders (83 and 105 m).
    '14/4835/6164': ['22L', '31R'], '14/4834/6164': [], '14/4834/6165': ['04R', '31L'],
    '14/4834/6163': ['22R'], '14/4833/6164': [], '14/4833/6165': ['04L'],
  };
  const widths = new Set();
  const got = {};
  for (const t of tiles) {
    const aero = { extent: 4096, features: t.raw.map((x) => ({ type: x.type === 'line' ? LINESTRING : POLYGON, cls: 'runway', props: { ref: x.ref }, parts: x.parts })) };
    const counts = {};
    buildRoads(null, g, new MeshBuilder(), aero, counts);
    got[t.tile] = counts.runwayDebug.drawn.flatMap((d) => d.numbers.map((n) => n.split(': ')[1])).sort();
    for (const d of counts.runwayDebug.drawn) widths.add(d.widthM);
  }
  assert.deepEqual(got, want);
  assert.deepEqual([...widths], [45], 'runway widths ' + [...widths]);
  ok('real Pearson, Billy Bishop and JFK data: one number per true runway end, none at split points, every runway 45 m wide');
}

// 6. Size groups for the auto colours (0.12.6).
{
  const flat = new Float32Array(V * V).fill(100);
  const gf = { ...g, nodes: flat };
  const sq = (x, y, side) => [x, y, x + side, y, x + side, y + side, x, y + side, x, y];
  const k = size14 / 4096;                                   // tile units -> mercator m
  const side = (m2) => Math.sqrt(m2) / g.cosLat / k;          // square of this many true m2
  const bld = { extent: 4096, features: [
    { type: POLYGON, cls: null, props: { render_height: 8 }, parts: [sq(300, 300, side(150))] },     // house
    { type: POLYGON, cls: null, props: { render_height: 10 }, parts: [sq(1000, 300, side(4000))] },  // big low
    { type: POLYGON, cls: null, props: { render_height: 30 }, parts: [sq(300, 2000, side(900))] },   // mid-rise
    { type: POLYGON, cls: null, props: { render_height: 140 }, parts: [sq(2500, 2500, side(900))] }, // tower
  ] };
  const mb = new MeshBuilder();
  const st = buildBuildings(bld, gf, mb, undefined, {});
  assert.deepEqual(st.sizes, [1, 1, 1, 1]);
  const groups = new Set([...mb.finish().info].map((x) => (x & 255) >> 4));
  assert.deepEqual([...groups].sort(), [0, 1, 2, 3]);
  ok('size groups: house, big low, mid-rise, tower each stored for the auto colours');
}

console.log('look ok');
