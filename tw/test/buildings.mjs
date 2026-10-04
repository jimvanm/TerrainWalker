import { buildBuildings } from '../src/buildings.js';
import { MeshBuilder } from '../src/meshbuilder.js';
import { POLYGON } from '../src/mvt.js';
import { GRID } from '../src/heightgrid.js';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };

const V = GRID + 1;
const nodes = new Float32Array(V * V).fill(100);                 // flat ground at 100 m
const size14 = 2446, size12 = size14 * 4;
const g = { size14, size12, bx: size12 / 2 - size14 / 2 * 0, by: size12 / 2, cosLat: 0.7224, nodes };
const E = 4096;
// ring in tile units, closed, clockwise on screen (positive area in y-down)
const sq = (x, y, w, h) => [x, y, x + w, y, x + w, y + h, x, y + h, x, y];
const poly = (rings, props = {}) => ({ type: POLYGON, parts: rings, props });
const run = (feats, max) => { const mb = new MeshBuilder(); const st = buildBuildings({ extent: E, features: feats }, g, mb, max); return { mb, st, out: mb.finish() }; };
const ys = (out) => { const f = new Float32Array(out.vertices); const a = []; for (let i = 0; i < out.verts; i++) a.push(f[4 * i + 1]); return a; };

// 1. a known 30 m building: roof at ground + 30, walls start just under the ground
let r = run([poly([sq(1000, 1000, 300, 300)], { render_height: 30 })]);
let y = ys(r.out);
ok(r.st.kept === 1 && Math.max(...y) === 130 && Math.min(...y) === 99.5, 'a 30 m building: roof at 130 m, wall base half a metre under the ground');
ok(r.out.verts === 4 * 2 + 4 && r.out.indices.length === (8 + 2) * 3, 'a box is 12 points and 10 triangles (8 wall + 2 roof)');

// 2. unknown height gets a guess of 6 to 9 m
r = run([poly([sq(1000, 1000, 300, 300)], {})]); y = ys(r.out);
ok(Math.max(...y) - 100 >= 6 && Math.max(...y) - 100 <= 9, 'unknown height is guessed at 6 to 9 m (' + (Math.max(...y) - 100) + ')');
r = run([poly([sq(1000, 1000, 300, 300)], { render_height: 3 })]); y = ys(r.out);
ok(Math.max(...y) - 100 >= 6, 'the data default of 3 m counts as unknown');

// 3. courtyard: the hole gets walls too, and the roof leaves it open
r = run([poly([sq(1000, 1000, 600, 600), sq(1200, 1200, 200, 200).reverse().reduce((a, v, i, arr) => i % 2 ? a : [...a, arr[i + 1], arr[i]], [])], { render_height: 20 })]);
ok(r.st.kept === 1 && r.out.verts === 8 * 2 + 8, 'a building with a courtyard has outer and inner walls');

// 4. a building crossing the tile edge is cut at the edge
r = run([poly([sq(3900, 1000, 600, 300)], { render_height: 20 })]);
const f = new Float32Array(r.out.vertices); let maxE = -1e9; for (let i = 0; i < r.out.verts; i++) maxE = Math.max(maxE, f[4 * i]);
ok(Math.abs(maxE - size14 / 2) < 1e-6, 'a building crossing the tile edge stops exactly at the edge');
// and one entirely outside is dropped
r = run([poly([sq(4200, 1000, 100, 100)], { render_height: 20 })]);
ok(r.st.kept === 0, 'a building wholly in the neighbour tile is not drawn here');

// 5. outlines hidden for 3D parts, and sheds, are skipped; tall small ones are not
r = run([poly([sq(1000, 1000, 300, 300)], { render_height: 20, hide_3d: true }), poly([sq(1000, 2000, 5, 5)], {}), poly([sq(2000, 2000, 5, 5)], { render_height: 50 })]);
ok(r.st.kept === 1, 'hide_3d outlines and tiny sheds skipped; a tiny 50 m tower kept');

// 6. budget: the big tall building survives, small ones are dropped
const feats = [];
for (let i = 0; i < 200; i++) feats.push(poly([sq(100 + (i % 20) * 150, 100 + Math.floor(i / 20) * 150, 40, 40)], { render_height: 8 }));
feats.push(poly([sq(2000, 3000, 400, 400)], { render_height: 200 }));
r = run(feats, 600);
const top = Math.max(...ys(r.out));
ok(r.st.dropped > 100 && top === 300, 'over budget, the tall one stays and small ones go (' + r.st.kept + ' kept, ' + r.st.dropped + ' dropped)');

// 7. min height: a part floating above the ground
r = run([poly([sq(1000, 1000, 300, 300)], { render_height: 60, render_min_height: 40 })]); y = ys(r.out);
ok(Math.min(...y) === 140 && Math.max(...y) === 160, 'a floating part runs from 40 m to 60 m up');
// 8. skyline mode: only buildings KNOWN to be tall enough, with deeper walls
{
  const mb = new MeshBuilder();
  const st = buildBuildings({ extent: E, features: [
    poly([sq(1000, 1000, 300, 300)], { render_height: 120 }),
    poly([sq(2000, 1000, 300, 300)], { render_height: 30 }),
    poly([sq(3000, 1000, 300, 300)], {}),               // unknown height: a guess, never skyline
  ] }, g, mb, undefined, { minHeight: 50, sunk: 6 });
  const o = mb.finish(); const yy = ys(o);
  ok(st.kept === 1 && Math.max(...yy) === 220 && Math.min(...yy) === 94, 'skyline mode keeps only the known 120 m tower, walls sunk 6 m');
}
// 9. the height report counts every building by how the data labels it
{
  const mb = new MeshBuilder();
  const st = buildBuildings({ extent: E, features: [
    poly([sq(100, 100, 300, 300)], {}), poly([sq(600, 100, 300, 300)], { render_height: 4 }),
    poly([sq(1100, 100, 300, 300)], { render_height: 9 }), poly([sq(1600, 100, 300, 300)], { render_height: 40 }),
    poly([sq(2100, 100, 300, 300)], { render_height: 90 }), poly([sq(2600, 100, 300, 300)], { render_height: 300 }),
  ] }, g, mb);
  ok(st.seen === 6 && JSON.stringify(st.hist) === JSON.stringify([1, 1, 1, 0, 1, 1, 1]), 'height bands counted: ' + st.hist.join(','));
}
console.log('buildings ok');
