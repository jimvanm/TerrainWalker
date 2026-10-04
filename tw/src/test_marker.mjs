// The marker path: a tile in, "how built-up is it" out, no geometry.
import assert from 'node:assert/strict';
const vi = (x) => { const b = []; while (x >= 128) { b.push((x % 128) | 128); x = Math.floor(x / 128); } b.push(x); return b; };
const key = (f, w) => vi(f * 8 + w);
const ld = (f, bytes) => [...key(f, 2), ...vi(bytes.length), ...bytes];
const str = (s) => [...new TextEncoder().encode(s)];
const zz = (v) => (v << 1) ^ (v >> 31);
function rect(x0, y0, x1, y1) {                          // clockwise on screen
  const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
  const g = []; let px = 0, py = 0;
  pts.forEach(([x, y], i) => {
    if (i === 0) g.push(...vi((1 << 3) | 1)); if (i === 1) g.push(...vi((3 << 3) | 2));
    g.push(...vi(zz(x - px)), ...vi(zz(y - py))); px = x; py = y;
  });
  g.push(...vi((1 << 3) | 7));
  return g;
}
function layer(name, geom, cls) {
  const feat = [...key(3, 0), 3, ...(cls ? ld(2, [0, 0]) : []), ...ld(4, geom)];
  return ld(3, [...ld(1, str(name)), ...ld(2, feat),
    ...(cls ? [...ld(3, str('class')), ...ld(4, ld(1, str(cls)))] : []), ...key(5, 0), ...vi(4096)]);
}
const tile = new Uint8Array([...layer('building', rect(0, 0, 4096, 2048)), ...layer('landuse', rect(0, 0, 2048, 4096), 'residential')]);
globalThis.fetch = async () => new Response(tile, { status: 200 });
const { buildNearTile } = await import('./nearworker.js');
const r = await buildNearTile({ marker: true, vurl: 'https://v/13/1/1.pbf', skyline: true });
assert.ok(Math.abs(r.stats.cover - 0.5) < 1e-9, 'half-covered by buildings: ' + r.stats.cover);
assert.ok(Math.abs(r.stats.built - 0.5) < 1e-9, 'half residential land use: ' + r.stats.built);
assert.equal(r.stats.seen, 1);
assert.equal(r.indices.length + r.bIndices.length, 0, 'a marker carries no geometry');
globalThis.fetch = async () => new Response('', { status: 404 });
const e = await buildNearTile({ marker: true, vurl: 'https://v/13/1/2.pbf' });
assert.equal(e.stats.cover, 0, 'an empty tile is not built-up');
console.log('marker ok');
