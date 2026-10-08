// Pitched house roofs, the age guess, and regional looks (building lab).
import { fitRect, pitchable, emitPitched, pitchFor } from '../src/houseroof.js';
import { buildBuildings, guessAges, STY_END, STY_PITCHED } from '../src/buildings.js';
import { MeshBuilder } from '../src/meshbuilder.js';
import { POLYGON } from '../src/mvt.js';
import { regionAt, regionUniforms, REGIONS } from '../src/facade.js';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };
const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;

// 1. the rectangle round a turned 6 x 15 box
{
  const t = 0.4, c = Math.cos(t), s = Math.sin(t);
  const pts = [[-3, -7.5], [3, -7.5], [3, 7.5], [-3, 7.5]].flatMap(([x, y]) => [x * c - y * s + 10, x * s + y * c + 20]);
  const r = fitRect(pts);
  ok(near(r.L, 7.5) && near(r.W, 3) && near(r.cx, 10) && near(r.cy, 20), 'fits a turned box: half sides 7.5 and 3, centre found');
  ok(near(Math.abs(r.ax * -s + r.ay * c), 1), 'the long side runs along the box');
  ok(pitchable(r, 90, 1), 'a 6 x 15 m house gets a pitched roof');
  ok(!pitchable(r, 50, 1), 'an outline filling little of its rectangle does not');
}

// 2. a gable roof: ridge in the middle, at the right height
{
  const r = fitRect([0, 0, 6, 0, 6, 15, 0, 15]);
  const pts = [], tris = [];
  const put = (x, y, z, roof, fac, end) => { pts.push({ x, y, z, roof, fac, end }); return pts.length - 1; };
  const pitch = pitchFor(1);
  emitPitched(r, { base: 0, gAt: () => 0, sunk: 0.5, eave: 6, k: 1, hip: false, pitch }, put, (a, b, c) => tris.push(a, b, c));
  const top = Math.max(...pts.map((p) => p.y));
  ok(near(top, 6 + 3 * Math.tan(pitch), 1e-9), 'ridge at eaves plus half the width times the slope');
  ok(pts.filter((p) => near(p.y, top)).every((p) => near(p.x, 3)), 'the ridge runs down the middle, along the long side');
  ok(pts.some((p) => p.end && !p.roof) && pts.some((p) => !p.end && !p.roof), 'end walls are marked, side walls are not');
  ok(Math.min(...pts.filter((p) => p.roof).map((p) => p.y)) < 6, 'the roof hangs a little past the walls');
}

// 3. the lab's buildings: houses pitched, flagged; the age guess
{
  const E = 4096, size14 = 2446, g = { size14, size12: size14, bx: size14 / 2, by: size14 / 2, cell: size14 / 8, cosLat: 0.72, hAt: () => 0 };
  const sq = (x, y, w, h) => [x, y, x + w, y, x + w, y + h, x, y + h, x, y];
  const feats = [];
  for (let i = 0; i < 40; i++) feats.push({ type: POLYGON, parts: [sq(200 + i * 17, 300, 14, 35)], props: { render_height: 9 } });   // old row
  for (let i = 0; i < 6; i++) feats.push({ type: POLYGON, parts: [sq(2500 + i * 140, 300, 42, 32)], props: { render_height: 7 } });  // spread out
  const mb = new MeshBuilder();
  const st = buildBuildings({ extent: E, features: feats }, g, mb, 1e7, { faces: true });
  const o = mb.finish();
  ok(st.kept === 46 && o.sty && o.sty.length === o.verts && o.fac.length === o.verts * 4, 'every corner has its wall numbers and style');
  const flags = new Set([...o.sty].map((v) => v >> 8));
  ok(flags.has(STY_PITCHED) && flags.has(STY_PITCHED | STY_END), 'houses are pitched, with their ends marked');

  // Four rows of 6 x 15 m houses, 7 m apart (a Toronto block), and big houses 60 m apart.
  const cand = [];
  for (let row = 0; row < 4; row++) for (let i = 0; i < 30; i++) cand.push({ area: 90, height: 9, mx: i * 7 / 0.72, my: row * 22 / 0.72 });
  for (let i = 0; i < 6; i++) cand.push({ area: 300, height: 7, mx: (2000 + i * 60) / 0.72, my: 0 });
  guessAges(cand, 0.72);
  ok(cand[45].age > 0.8 && cand[122].age < 0.2, `small houses close together read old (${cand[45].age.toFixed(2)}), big ones far apart new (${cand[122].age.toFixed(2)})`);
}

// 4. regions
ok(regionAt(48.87, 2.33) === 'paris' && regionAt(43.65, -79.38) === 'brick' && regionAt(45.52, -73.58) === 'brick', 'Paris, Toronto and Montréal get their own looks');
ok(regionAt(51.51, -0.09) === 'uk' && regionAt(52.37, 4.9) === 'europe' && regionAt(49.28, -123.13) === 'north_america', 'London, Amsterdam, Vancouver');
for (const name of Object.keys(REGIONS)) {
  const u = regionUniforms(name);
  ok(u.wall.length === 60 && u.roof.length === 24 && u.frame.length === 6 && u.extra.length === 4, name + ': colours complete');
}
console.log('houseroof ok');
