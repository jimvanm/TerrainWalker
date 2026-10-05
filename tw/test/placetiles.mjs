// Places of interest: their tiles are used where they exist, the place levels
// (zoom 15, 16) are fetched only there, and the usual tiles everywhere else.
import assert from 'node:assert/strict';

globalThis.performance = globalThis.performance || { now: () => Date.now() };
const { addPlace, clearPlaceTiles, elevationUrl, hasPlaceTile, placeNames } = await import('../src/placetiles.js');
const { Terrain } = await import('../src/terrain.js');
const { LEVELS, TILE_URL } = await import('../src/config.js');
const geo = await import('../src/geo.js');

const BASE = 'http://localhost:8080/';
// The Horseshoe Falls, and the tiles over it at each zoom.
const lat = 43.0786, lon = -79.0747;
const mx = geo.lonToMercX(lon), my = geo.latToMercY(lat);
const tileAt = (z) => { const t = geo.mercToTile(mx, my, z); return [Math.floor(t.x), Math.floor(t.y)]; };
const [x16, y16] = tileAt(16), [x14, y14] = tileAt(14);

// A place covering the zoom-14 tile under the camera, at every zoom down to 16
// (the builder lists a tile at each zoom wherever the place touches it).
const kids = (z, x, y, d) => { const o = []; for (let j = 0; j < 2 ** d; j++) for (let i = 0; i < 2 ** d; i++) o.push(`${(x << d) + i}/${(y << d) + j}`); return o; };
const listed = { 14: [`${x14}/${y14}`], 15: kids(14, x14, y14, 1), 16: kids(14, x14, y14, 2) };
clearPlaceTiles();
addPlace('niagara', { name: 'Niagara', tiles: listed }, BASE);

// ---- which file each tile comes from ----
assert.equal(elevationUrl(16, x16, y16), `${BASE}places/niagara/tiles/16/${x16}/${y16}.png`, 'a place tile comes from the place');
assert.equal(elevationUrl(14, x14, y14), `${BASE}places/niagara/tiles/14/${x14}/${y14}.png`, 'also at the usual zooms');
assert.equal(elevationUrl(14, x14 + 5, y14), TILE_URL.replace('{z}', 14).replace('{x}', x14 + 5).replace('{y}', y14), 'elsewhere, the usual tile');
assert.ok(hasPlaceTile(16, x16, y16) && !hasPlaceTile(15, x14 * 2 + 5, y14 * 2), 'only listed tiles count');
assert.deepEqual(placeNames(), ['Niagara']);
console.log('ok  place tiles are used where a place has them, the usual ones elsewhere');

// ---- what the terrain asks for ----
function plan(minLevel) {
  const asked = [];
  const t = Object.create(Terrain.prototype);
  t.tiles = new Map();
  t.loader = { want: (s) => asked.push(s), keepOnly() {}, pump() {} };
  t.plan(mx, my, minLevel, 6, mx, my, false);
  return asked;
}
{
  const asked = plan(0);
  const at = (z) => asked.filter((s) => s.z === z).map((s) => `${s.x}/${s.y}`);
  assert.ok(at(16).length > 0 && at(16).every((k) => listed[16].includes(k)), 'zoom 16: only the place\'s tiles are fetched');
  assert.ok(at(15).every((k) => listed[15].includes(k)), 'zoom 15: likewise');
  assert.equal(at(14).length, 15, 'zoom 14: the whole block, less the one tile the place covers finer');
  assert.ok(!at(14).includes(`${x14}/${y14}`), 'which is the one under the camera');
  const keep = asked.filter((s) => s.z >= 14);
  assert.ok(keep.every((s) => s.keepHeights), 'full heights kept down to zoom 14');
  assert.ok(asked.filter((s) => s.z === 13).every((s) => !s.keepHeights), 'but not for zoom 13');
  console.log('ok  the place levels fetch only place tiles; zoom 14 fills in everywhere else');
}
{
  clearPlaceTiles();
  const asked = plan(0);
  assert.equal(asked.filter((s) => LEVELS[s.level].place).length, 0, 'no places: nothing fetched for the place levels');
  const fine = asked.filter((s) => s.z === 14);
  assert.ok(fine.length === 16 && fine.every((s) => s.keepHeights), 'and zoom 14 keeps full heights, as the finest there is');
  console.log('ok  with no place here, nothing is fetched for zoom 15 and 16');
}
console.log('placetiles ok');
