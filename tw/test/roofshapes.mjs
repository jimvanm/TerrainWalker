// Roof shapes from the map, and Overture's buildings in our names.
import { roofKind, emitProfiled, defaultRoofHeight } from '../src/roofshapes.js';
import { mapProps, overtureBuildings, isMonument } from '../src/overture.js';
import { buildBuildings, STY_MONUMENT } from '../src/buildings.js';
import { MeshBuilder } from '../src/meshbuilder.js';
import { POLYGON } from '../src/mvt.js';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };

ok(roofKind('dome') === 'dome' && roofKind('onion') === 'onion' && roofKind('pyramidal') === 'pyramid' && roofKind('gabled') === 'gabled', 'roof shape names');
ok(roofKind('flat') === 'flat' && roofKind('unknown_thing') === null && roofKind(undefined) === null, 'flat is kept, unknown is nothing');

// A dome over a square: rises by its height, ends in one point at the middle.
{
  const pts = [], tris = [];
  emitProfiled([0, 0, 10, 0, 10, 10, 0, 10], 'dome', 20, 5, (x, y, z) => { pts.push([x, y, z]); return pts.length - 1; }, (a, b, c) => tris.push(a, b, c));
  const top = pts.reduce((m, p) => (p[1] > m[1] ? p : m));
  ok(Math.abs(top[1] - 25) < 1e-9 && Math.abs(top[0] - 5) < 1e-9 && Math.abs(top[2] - 5) < 1e-9, 'the dome top is in the middle, at eaves plus its height');
  ok(pts.filter((p) => p[1] === 20).length === 4, 'it starts on the outline at the eaves');
  ok(tris.length > 0 && tris.every((i) => i < pts.length), 'triangles use its own corners');
}
ok(defaultRoofHeight('spire', 3) > defaultRoofHeight('dome', 3), 'a spire without a height is taller than a dome');

// Overture names into ours.
{
  const o = mapProps({ height: 40, min_height: 10, facade_material: 'brick', roof_material: 'copper', subtype: 'religious', class: 'church', has_parts: true }, false);
  ok(o.render_height === 40 && o.render_min_height === 10, 'height and where it starts');
  ok(o.colour === '#96523e' && o.roof_colour === '#609680', 'materials become colours');
  ok(o.hide_3d === true && o.monument === true && o.lab_type === 6, 'an outline with parts is hidden; a church is a monument');
  ok(mapProps({ num_floors: 5 }, true).render_height === 16, 'floors give a height when there is none');
  ok(mapProps({ facade_color: '#123456', facade_material: 'brick' }, true).colour === '#123456', 'a given colour beats the material');
  ok(!isMonument({ subtype: 'residential', class: 'house' }), 'a house is not a monument');
}

// A domed part, through the lab's builder: walls stop low, a dome on top.
{
  const E = 4096, size = 4892, g = { size14: size, size12: size, bx: size / 2, by: size / 2, cell: size / 8, cosLat: 0.72, hAt: () => 0 };
  const circle = Array.from({ length: 17 }, (_, i) => { const a = -i / 16 * 2 * Math.PI; return [2000 + 30 * Math.cos(a), 2000 + 30 * Math.sin(a)]; }).flat();
  const L = overtureBuildings({ building_part: { extent: E, features: [
    { type: POLYGON, parts: [circle], props: { min_height: 50, height: 80, roof_shape: 'dome', subtype: 'religious' } }] } });
  const mb = new MeshBuilder();
  buildBuildings(L, g, mb, 1e7, { faces: true });
  const o = mb.finish(), f = new Float32Array(o.vertices);
  const ys = []; for (let i = 0; i < o.verts; i++) ys.push(f[4 * i + 1]);
  ok(Math.max(...ys) === 80 && Math.min(...ys) === 50, 'a raised dome part spans 50 to 80 m');
  ok([...o.sty].every((s) => (s >> 8) & STY_MONUMENT), 'it is drawn as a monument');
}
console.log('roofshapes ok');

// Ridge direction, and single-slope roofs.
import { fitRect, turnRect, emitSkillion } from '../src/houseroof.js';
{
  const r = fitRect([0, 0, 20, 0, 20, 10, 0, 10]);          // long side east-west (units: x east, y south)
  ok(Math.abs(r.ax) > 0.99, 'fitted: long side runs east-west');
  ok(Math.abs(turnRect(r, 180, null).rect.ax) > 0.99, 'slopes facing south: ridge stays east-west');
  ok(Math.abs(turnRect(r, 90, null).rect.ay) > 0.99, 'slopes facing east: ridge turns north-south');
  ok(Math.abs(turnRect(r, null, 'across').rect.ay) > 0.99, '"across": ridge across the long side');
  const { rect, low } = turnRect(r, 180, null);
  const pts = [];
  emitSkillion(rect, { base: 0, gAt: () => 0, sunk: 0, eave: 5, k: 1, rise: 2, low, minh: 0 },
    (x, y, z, roof) => { pts.push({ x, y, z, roof }); return pts.length - 1; }, () => {});
  const roof = pts.filter((p) => p.roof);
  const south = roof.reduce((a, p) => (p.z > a.z ? p : a)), north = roof.reduce((a, p) => (p.z < a.z ? p : a));
  ok(south.y < north.y, 'a roof facing south is low on the south side');
}
console.log('roof directions ok');

// Points of interest: a fire station point inside a building makes it one.
import { poiKinds, markKinds, KIND } from '../src/buildings.js';
import { POINT } from '../src/mvt.js';
{
  const E = 4096, size = 2446;
  const pts = poiKinds({ extent: E, features: [
    { type: POINT, parts: [[1100, 1100]], props: { class: 'fire_station' } },
    { type: POINT, parts: [[2100, 1100]], props: { class: 'place_of_worship' } },
    { type: POINT, parts: [[3100, 1100]], props: { class: 'railway', subclass: 'level_crossing' } },
    { type: POINT, parts: [[1150, 1150]], props: { class: 'cafe' } },
  ] });
  ok(pts.length === 3 && pts[0].kind === KIND.fire && pts[1].monument && pts[2].kind === KIND.shop, 'points read: fire station, church, café (a level crossing is no station)');
  const box = (x, y, w) => { const m = (v) => (v / E - 0.5) * size; return [new Float64Array([m(x), m(y), m(x + w), m(y), m(x + w), m(y + w), m(x), m(y + w)])]; };
  const cand = [{ rings: box(1000, 1000, 300) }, { rings: box(2000, 1000, 300) }, { rings: box(3000, 3000, 300) }];
  markKinds(cand, pts, size);
  ok(cand[0].kind === KIND.fire, 'the café inside does not turn the fire station into a shop');
  ok(cand[1].monument === true && !cand[1].kind, 'a church point makes a monument');
  ok(!cand[2].kind && !cand[2].monument, 'a building with no point stays as it was');
}
console.log('points of interest ok');
