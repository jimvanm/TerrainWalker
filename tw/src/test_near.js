import assert from 'node:assert/strict';
import { decodeMVT, LINESTRING } from './mvt.js';
import { nodeHeightAt, GRID } from './heightgrid.js';
import { buildRoads } from './roads.js';
import { MeshBuilder } from './meshbuilder.js';
import { tileSizeMerc } from './geo.js';
import { buildMesh } from './worker.js';
import { PX } from './heightgrid.js';

let n = 0;
const ok = (name) => { n++; console.log('ok  ' + name); };

// ---- minimal MVT encoder ---------------------------------------------------
const vi = (x) => { const b = []; while (x >= 128) { b.push((x % 128) | 128); x = Math.floor(x / 128); } b.push(x); return b; };
const key = (f, w) => vi(f * 8 + w);
const ld = (f, bytes) => [...key(f, 2), ...vi(bytes.length), ...bytes];
const str = (s) => [...new TextEncoder().encode(s)];
const zz = (v) => (v << 1) ^ (v >> 31);
const f32 = (v) => [...new Uint8Array(new Float32Array([v]).buffer)];

function tile(layerName, extent, props, line) {
  const keys = Object.keys(props);
  const vals = Object.values(props);
  const valBytes = vals.map((v) =>
    typeof v === 'string' ? ld(1, str(v))
    : typeof v === 'boolean' ? [...key(7, 0), v ? 1 : 0]
    : Number.isInteger(v) ? [...key(4, 0), ...vi(v)]
    : [...key(2, 5), ...f32(v)]);
  const tags = []; keys.forEach((_, i) => tags.push(i, i));
  let g = [], px = 0, py = 0;
  line.forEach(([x, y], i) => {
    if (i === 0) g.push(...vi((1 << 3) | 1)); else if (i === 1) g.push(...vi(((line.length - 1) << 3) | 2));
    g.push(...vi(zz(x - px)), ...vi(zz(y - py))); px = x; py = y;
  });
  const feat = [...key(3, 0), 2, ...ld(2, tags.flatMap((t) => vi(t))), ...ld(4, g)];
  const layer = [...ld(1, str(layerName)), ...ld(2, feat),
    ...keys.flatMap((k) => ld(3, str(k))), ...valBytes.flatMap((b) => ld(4, b)),
    ...key(5, 0), ...vi(extent)];
  return new Uint8Array(ld(3, layer));
}

// 1. decoder: strings, ints, floats, bools survive; plain mode stays plain
{
  const buf = tile('transportation', 4096,
    { class: 'primary', oneway: 1, render_height: 12.5, ramp: true }, [[100, 100], [900, 100]]);
  const full = decodeMVT(buf, ['transportation'], 'class', ['transportation']);
  const f = full.transportation.features[0];
  assert.equal(f.cls, 'primary');
  assert.equal(f.props.oneway, 1);
  assert.equal(f.props.render_height, 12.5);
  assert.equal(f.props.ramp, true);
  assert.equal(f.type, LINESTRING);
  assert.deepEqual(f.parts[0], [100, 100, 900, 100]);
  const plain = decodeMVT(buf, ['transportation']);
  assert.equal(plain.transportation.features[0].cls, 'primary');
  assert.equal(plain.transportation.features[0].props, null);
  ok('mvt decodes numeric/bool/string properties; plain mode unchanged');
}

// 2. draping agrees exactly with the real terrain mesh
{
  const heights = new Float32Array(PX * PX);
  for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++)
    heights[y * PX + x] = 100 + 40 * Math.sin(x / 13) + 25 * Math.cos(y / 9) + (x * y) / 800;
  const N = GRID, V = N + 1;
  const { positions } = buildMesh(heights, 12, N);
  const nodes = new Float32Array(V * V);
  for (let i = 0; i < V * V; i++) nodes[i] = positions[i * 4 + 1];
  // Brute-force: triangle plane through the mesh vertices, tested at random points.
  let worst = 0;
  for (let t = 0; t < 4000; t++) {
    const u = Math.random(), v = Math.random();
    const fu = u * N, fv = v * N;
    const i = Math.min(N - 1, Math.floor(fu)), j = Math.min(N - 1, Math.floor(fv));
    const tx = fu - i, ty = fv - j;
    const P = (ii, jj) => ({ x: ii, y: jj, h: positions[(jj * V + ii) * 4 + 1] });
    const [A, B, C] = tx + ty <= 1 ? [P(i, j), P(i + 1, j), P(i, j + 1)] : [P(i + 1, j), P(i, j + 1), P(i + 1, j + 1)];
    const px = i + tx, py = j + ty;
    const det = (B.y - C.y) * (A.x - C.x) + (C.x - B.x) * (A.y - C.y);
    const l1 = ((B.y - C.y) * (px - C.x) + (C.x - B.x) * (py - C.y)) / det;
    const l2 = ((C.y - A.y) * (px - C.x) + (A.x - C.x) * (py - C.y)) / det;
    const want = l1 * A.h + l2 * B.h + (1 - l1 - l2) * C.h;
    worst = Math.max(worst, Math.abs(want - nodeHeightAt(nodes, u, v)));
  }
  assert.ok(worst < 1e-3, 'worst ' + worst);
  ok('nodeHeightAt matches the rendered mesh triangles (worst ' + worst.toExponential(1) + ' m)');
}

// 3. ribbons: width, drape, tunnel skip
{
  const size12 = tileSizeMerc(12), size14 = tileSizeMerc(14);
  const N = GRID, V = N + 1;
  const nodes = new Float32Array(V * V);
  for (let j = 0; j < V; j++) for (let i = 0; i < V; i++) nodes[j * V + i] = 50 + i * 0.5; // slope east
  const cosLat = Math.cos(44 * Math.PI / 180);
  // Near tile sits in the middle of the elevation tile.
  const g = { size14, size12, bx: size12 / 2, by: size12 / 2, cosLat, nodes };
  const layer = { extent: 4096, features: [
    { type: LINESTRING, cls: 'primary', props: {}, parts: [[0, 2048, 4096, 2048]] },
    { type: LINESTRING, cls: 'primary', props: { brunnel: 'tunnel' }, parts: [[0, 1000, 4096, 1000]] },
    { type: LINESTRING, cls: 'rail', props: {}, parts: [[0, 500, 4096, 500]] },
    { type: LINESTRING, cls: 'path', props: {}, parts: [[2000, 0, 2000, 4096]] },
  ] };
  const mb = new MeshBuilder();
  buildRoads(layer, g, mb);
  const r = mb.finish();
  const f = new Float32Array(r.vertices);
  assert.ok(r.verts > 0 && r.indices.length > 0);
  assert.ok(r.indices.every((i) => i < r.verts));
  // First road is 2 verts per point; check width across the first pair.
  const dx = f[0] - f[4], dz = f[2] - f[6];
  const widthTrue = Math.hypot(dx, dz) * cosLat;
  assert.ok(Math.abs(widthTrue - 11) < 0.01, 'width ' + widthTrue);
  // Heights follow the slope: east edge higher than west by 0.5 m per node, plus lift.
  const nodeStep = size12 / N;
  for (let i = 0; i < r.verts; i += 7) {
    const e = f[4 * i], h = f[4 * i + 1];
    const u = (e + g.bx) / size12;
    const expect = 50 + u * N * 0.5;
    assert.ok(h - expect > 0.1 && h - expect < 0.45, 'lift ' + (h - expect));
  }
  // A tunnel adds nothing. A railway is drawn as two dark rails (0.12.0).
  const mb2 = new MeshBuilder();
  buildRoads({ extent: 4096, features: [layer.features[0], layer.features[1], layer.features[3]] }, g, mb2);
  const mb3 = new MeshBuilder();
  buildRoads({ extent: 4096, features: [layer.features[2]] }, g, mb3);
  assert.equal(mb2.verts + mb3.verts, r.verts, 'tunnel was drawn, or rail missing');
  const rr = mb3.finish(), rf = new Float32Array(rr.vertices), pts = rr.verts / 4;
  const across = (a, b) => Math.hypot(rf[4 * a] - rf[4 * b], rf[4 * a + 2] - rf[4 * b + 2]) * cosLat;
  // Strip 1 is the first 2*pts verts, strip 2 the rest. Each rail 1.3 m, outer edges 6 m apart.
  assert.ok(Math.abs(across(0, 1) - 1.3) < 0.01, 'rail width ' + across(0, 1));
  assert.ok(Math.abs(across(2 * pts + 1, 2 * pts) - 1.3) < 0.01, 'second rail width');
  assert.ok(Math.abs(across(0, 2 * pts + 1) - 6) < 0.01, 'track width ' + across(0, 2 * pts + 1));
  ok('ribbons: true width, drape follows slope, tunnels skipped, rail as two 1.3 m rails 6 m apart (' + r.verts + ' verts)');
}

// 4. bend keeps width (mitre) and does not spike on a hairpin
{
  const size12 = tileSizeMerc(12), size14 = tileSizeMerc(14);
  const nodes = new Float32Array((GRID + 1) ** 2).fill(10);
  const g = { size14, size12, bx: size12 / 2, by: size12 / 2, cosLat: 0.7, nodes };
  const layer = { extent: 4096, features: [
    { type: LINESTRING, cls: 'minor', props: {}, parts: [[500, 500, 1500, 500, 1500, 1500]] },
    { type: LINESTRING, cls: 'minor', props: {}, parts: [[500, 3000, 2500, 3000, 600, 3010]] },
  ] };
  const mb = new MeshBuilder(); buildRoads(layer, g, mb);
  const f = new Float32Array(mb.finish().vertices);
  const limit = (6 / 0.7) * 2.2;     // half-width * 2 (mitre clamp) with margin
  const hw = 6 / 0.7 / 2;
  for (let i = 0; i < mb.verts; i += 2) {
    const sep = Math.hypot(f[4 * i] - f[4 * (i + 1)], f[4 * i + 2] - f[4 * (i + 1) + 2]);
    assert.ok(sep <= hw * 2 * 2 + 1e-6, 'spike ' + sep + ' > ' + limit);
  }
  ok('mitre clamp holds on bends and hairpins');
}

console.log('\n' + n + ' tests passed');
