// A real MVT polygon, encoded the way a map server does, through decode -> build.
import { decodeMVT, POLYGON } from '../src/mvt.js';
import { buildBuildings } from '../src/buildings.js';
import { MeshBuilder } from '../src/meshbuilder.js';
import { GRID } from '../src/heightgrid.js';
const vi = (x) => { const b = []; while (x >= 128) { b.push((x % 128) | 128); x = Math.floor(x / 128); } b.push(x); return b; };
const key = (f, w) => vi(f * 8 + w);
const ld = (f, bytes) => [...key(f, 2), ...vi(bytes.length), ...bytes];
const str = (s) => [...new TextEncoder().encode(s)];
const zz = (v) => (v << 1) ^ (v >> 31);
const f32 = (v) => [...new Uint8Array(new Float32Array([v]).buffer)];

function ringCmds(pts, st) {
  const g = []; let [px, py] = st;
  pts.forEach(([x, y], i) => {
    if (i === 0) g.push(...vi((1 << 3) | 1));
    if (i === 1) g.push(...vi(((pts.length - 1) << 3) | 2));
    g.push(...vi(zz(x - px)), ...vi(zz(y - py))); px = x; py = y;
  });
  g.push(...vi((1 << 3) | 7));
  return { g, last: [px, py] };
}
// outer ring clockwise on screen, inner counter-clockwise
const outer = [[1000, 1000], [1600, 1000], [1600, 1600], [1000, 1600]];
const inner = [[1200, 1200], [1200, 1400], [1400, 1400], [1400, 1200]];
let a = ringCmds(outer, [0, 0]); let b = ringCmds(inner, a.last);
const keys = ['render_height', 'hide_3d'], vals = [ld(0, []), []];
const valBytes = [[...key(2, 5), ...f32(42.5)], [...key(7, 0), 0]];
const feat = [...key(3, 0), 3, ...ld(2, [0, 0, 1, 1]), ...ld(4, [...a.g, ...b.g])];
const layer = [...ld(1, str('building')), ...ld(2, feat),
  ...keys.flatMap((k) => ld(3, str(k))), ...valBytes.flatMap((v) => ld(4, v)), ...key(5, 0), ...vi(4096)];
const tile = new Uint8Array(ld(3, layer));

const out = decodeMVT(tile, ['building'], 'class', ['building']);
const f = out.building.features[0];
console.log('decoded', f.type === POLYGON ? 'polygon' : f.type, 'rings', f.parts.length, 'props', JSON.stringify(f.props));
if (f.type !== POLYGON || f.parts.length !== 2 || f.props.render_height !== 42.5 || f.props.hide_3d !== false) { console.error('FAIL decode'); process.exit(1); }

const V = GRID + 1, size14 = 2446, size12 = size14 * 4;
const g = { size14, size12, bx: size12 / 2, by: size12 / 2, cosLat: 0.72, nodes: new Float32Array(V * V).fill(80) };
const mb = new MeshBuilder(); const st = buildBuildings(out.building, g, mb);
const r = mb.finish(); const fl = new Float32Array(r.vertices); let top = -1e9;
for (let i = 0; i < r.verts; i++) top = Math.max(top, fl[4 * i + 1]);
console.log('kept', st.kept, 'verts', r.verts, 'tris', r.indices.length / 3, 'roof', top);
if (st.kept !== 1 || Math.abs(top - 122.5) > 1e-3 || r.verts !== 8 * 2 + 8) { console.error('FAIL build'); process.exit(1); }
console.log('ok  a courtyard building survives the wire format: 42.5 m, outer and inner walls, open roof');
