// Far tiles draw only the start of the index buffer, so the buffer must really
// be ordered most-important-first and the recorded ends must be right.
import { buildBuildings } from './buildings.js';
import { buildRoads, ROAD_STYLE } from './roads.js';
import { MeshBuilder } from './meshbuilder.js';
import { POLYGON, LINESTRING } from './mvt.js';
import { GRID } from './heightgrid.js';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };
const V = GRID + 1, size14 = 2446, size12 = size14 * 4;
const g = { size14, size12, bx: size12 / 2, by: size12 / 2, cosLat: 0.72, nodes: new Float32Array(V * V).fill(100) };
const E = 4096;

// ---- buildings --------------------------------------------------------------
const sq = (x, y, w, h) => [x, y, x + w, y, x + w, y + h, x, y + h, x, y];
const feats = [
  { type: POLYGON, parts: [sq(300, 300, 60, 60)], props: { render_height: 8 } },      // small
  { type: POLYGON, parts: [sq(900, 900, 80, 80)], props: { render_height: 30 } },     // large/tall
  { type: POLYGON, parts: [sq(1500, 1500, 120, 120)], props: { render_height: 100 } },  // skyline
  { type: POLYGON, parts: [sq(2200, 2200, 60, 60)], props: { render_height: 10 } },   // small
];
const mb = new MeshBuilder();
const st = buildBuildings({ extent: E, features: feats }, g, mb);
const out = mb.finish(); const f = new Float32Array(out.vertices);
const tops = (n) => { const s = new Set(); for (let i = 0; i < n; i++) s.add(+f[4 * out.indices[i] + 1].toFixed(1)); return [...s].sort((a, b) => a - b); };
const [e0, e1, e2] = st.ends;
ok(e0 > 0 && e0 < e1 && e1 < e2 && e2 === out.indices.length, 'building tier ends climb and finish at the end (' + st.ends.join(', ') + ')');
ok(JSON.stringify(tops(e0)) === JSON.stringify([99.5, 200]), 'the first part of the buffer is only the 100 m tower');
ok(JSON.stringify(tops(e1)) === JSON.stringify([99.5, 130, 200]), 'the middle part adds the 30 m building and nothing smaller');
ok(tops(e2).length === 5, 'the whole buffer has the small ones too');

// ---- roads ------------------------------------------------------------------
const line = (cls, y) => ({ type: LINESTRING, cls, props: {}, parts: [[200, y, 3800, y]] });
const layer = { extent: E, features: [line('minor', 500), line('motorway', 1000), line('secondary', 1500), line('service', 2000), line('trunk', 2500), line('primary', 3000)] };
const rb = new MeshBuilder();
const ends = buildRoads(layer, g, rb);
const ro = rb.finish(); const u = new Uint32Array(ro.vertices);
const colourOf = (idx) => u[4 * idx + 3] & 0xffffff;
const classes = (n) => { const s = new Set(); for (let i = 0; i < n; i++) s.add(colourOf(ro.indices[i])); return s.size; };
ok(ends[0] > 0 && ends[0] < ends[1] && ends[1] < ends[2] && ends[2] === ro.indices.length, 'road tier ends climb (' + ends.join(', ') + ')');
ok(classes(ends[0]) === 2, 'first part: motorway and trunk only');
ok(classes(ends[1]) === 4, 'middle part adds primary and secondary');
ok(classes(ends[2]) === 6, 'whole buffer has minor and service roads too');
console.log('tiers ok');
