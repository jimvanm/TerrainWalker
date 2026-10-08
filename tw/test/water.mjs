// Water as a flat surface (watersurface.js).
import { waterLevel, buildWater, MAX_SPREAD } from '../src/watersurface.js';
import { MeshBuilder } from '../src/meshbuilder.js';
import { POLYGON } from '../src/mvt.js';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };

const pts = (hs) => hs.map((h, i) => [i * 30, 0, h]);
ok(Math.abs(waterLevel(pts([100, 100.2, 99.9, 100.1, 100.4]), []) - 100) < 0.2, 'level from the ground inside: its low part');
// A narrow river on coarse ground: the banks' slope reaches inside, but every
// patch still has water at 100 m. Not a waterfall.
const banks = [];
for (let y = 0; y < 1500; y += 30) for (let x = -90; x <= 90; x += 30) banks.push([x, y, 100 + Math.max(0, Math.abs(x) - 30) * 0.3]);
ok(Math.abs(waterLevel(banks, []) - 100) < 0.5, 'sloping banks inside the outline do not count as falling water');
ok(waterLevel(pts([100, 101]).slice(0, 2), [100, 103, 104, 99.5]) !== null, 'too few points inside: the shore decides');
const fall = []; for (let y = 0; y < 1500; y += 30) fall.push([0, y, 100 + y * 0.02]);
ok(waterLevel(fall, []) === null, 'heights spreading over ' + MAX_SPREAD + ' m: falling water, not flattened');
ok(waterLevel([], []) === null, 'nothing to go on: left as it was');

// A river across a tile: a valley floor at 100 m, banks rising either side.
const size = 2446, half = size / 2, E = 4096;
const g = { size14: size, size12: size, bx: half, by: half, cell: size / 64, cosLat: 0.72,
  hAt: (e) => 100 + Math.max(0, Math.abs(e) - 60) * 0.3 };
const sq = (x0, y0, x1, y1) => [x0, y0, x1, y0, x1, y1, x0, y1, x0, y0];
const layer = { extent: E, features: [{ type: POLYGON, parts: [sq(1900, -50, 2200, 4150)] }] };   // runs past the tile's ends
const mb = new MeshBuilder();
const st = buildWater(layer, g, mb);
const o = mb.finish(), f = new Float32Array(o.vertices);
const ys = []; for (let i = 0; i < o.verts; i++) ys.push(f[4 * i + 1]);
ok(st.areas === 1 && st.flat === 1, 'one water area, made flat');
ok(Math.abs(st.levels[0] - 100) < 0.5, 'at the valley floor: ' + st.levels[0] + ' m');
const xs = []; for (let i = 0; i < o.verts; i++) xs.push(f[4 * i]);
ok(Math.min(...xs) >= -half - 1e-6 && Math.max(...xs) <= half + 1e-6, 'cut to the tile');
const tops = ys.filter((y) => y > 100.5);
ok(tops.length > 0, 'banks rise from the water to the ground where the ground is higher');
ok(o.verts === 4 + 2 * 4, 'a surface of 4 corners and two banks (the shores), none where the tile cut the river');

// Falling water: laid on the ground, not flattened.
const steepG = { ...g, hAt: (e, s) => 100 + s * 0.08 };   // 8% slope down the river: 190 m over the tile
const mb2 = new MeshBuilder();
const st2 = buildWater(layer, steepG, mb2);
const o2 = mb2.finish(), f2 = new Float32Array(o2.vertices);
let follows = true;
for (let i = 0; i < o2.verts; i++) if (Math.abs(f2[4 * i + 1] - (100 + f2[4 * i + 2] * 0.08) - 0.05) > 0.2) follows = false;
ok(st2.left === 1 && st2.flat === 0 && o2.verts > 0 && follows, 'a falling river follows the ground instead');
console.log('water ok');
