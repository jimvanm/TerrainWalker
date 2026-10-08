// The PMTiles reader: tile numbers, directories, and reading tiles from a small
// file made here, with its directory split into a root and a leaf.
// (It was also checked against the official reader on a 150,000-tile file.)
import { tileId, parseDirectory, findEntry, PMTiles } from '../src/pmtiles.js';
import { gzipSync } from 'node:zlib';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };

// Values from the official reader.
for (const [z, x, y, id] of [[0, 0, 0, 0], [1, 1, 0, 4], [5, 17, 9, 1213], [13, 2289, 2989, 31131469], [14, 4578, 5979, 124525878], [18, 74000, 96000, 31919921407]])
  ok(tileId(z, x, y) === id, `tile ${z}/${x}/${y} is number ${id}`);

const varint = (n) => { const o = []; while (n >= 0x80) { o.push((n % 128) | 0x80); n = Math.floor(n / 128); } o.push(n); return o; };
const dirBytes = (entries) => {
  const b = [...varint(entries.length)];
  let last = 0;
  for (const e of entries) { b.push(...varint(e.id - last)); last = e.id; }
  for (const e of entries) b.push(...varint(e.run));
  for (const e of entries) b.push(...varint(e.len));
  for (const e of entries) b.push(...varint(e.off + 1));
  return new Uint8Array(b);
};

// Directory round trip, and finding entries.
const d = parseDirectory(dirBytes([{ id: 5, run: 1, len: 10, off: 0 }, { id: 9, run: 3, len: 7, off: 10 }, { id: 20, run: 0, len: 50, off: 0 }]));
ok(d.length === 3 && d[1].id === 9 && d[1].run === 3 && d[1].off === 10, 'a directory reads back');
ok(findEntry(d, 10) === d[1] && findEntry(d, 12) === null && findEntry(d, 4) === null, 'a run covers its tiles, and only those');
ok(findEntry(d, 999) === d[2] && d[2].run === 0, 'past the last run, a leaf directory is found');

// A small file: two tiles in the root, one more behind a leaf directory.
const tiles = [[13, 2289, 2989, 'cathedral'], [13, 2290, 2989, 'houses'], [14, 9000, 9000, 'far away']];
const data = [], root = [], leaf = [];
let off = 0;
for (const [z, x, y, text] of tiles) {
  const g = gzipSync(Buffer.from(text));
  const e = { id: tileId(z, x, y), run: 1, len: g.length, off };
  (z === 14 ? leaf : root).push(e);
  data.push(g); off += g.length;
}
root.sort((a, b) => a.id - b.id);
const leafBytes = gzipSync(dirBytes(leaf));
root.push({ id: leaf[0].id, run: 0, len: leafBytes.length, off: 0 });
const rootBytes = gzipSync(dirBytes(root));
const H = 127, dataAll = Buffer.concat(data);
const head = Buffer.alloc(H);
head.write('PMTiles', 0); head[7] = 3;
const set = (o, v) => { head.writeUInt32LE(v % 2 ** 32, o); head.writeUInt32LE(Math.floor(v / 2 ** 32), o + 4); };
set(8, H); set(16, rootBytes.length);
set(40, H + rootBytes.length); set(48, leafBytes.length);
set(56, H + rootBytes.length + leafBytes.length); set(64, dataAll.length);
head[97] = 2; head[98] = 2; head[99] = 1; head[100] = 13; head[101] = 14;
const file = Buffer.concat([head, rootBytes, leafBytes, dataAll]);
let reads = 0;
const pm = new PMTiles('test', async (o, len) => { reads++; const b = file.subarray(o, o + len); return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength); });
const text = async (z, x, y) => { const t = await pm.tile(z, x, y); return t && new TextDecoder().decode(t); };
ok(await text(13, 2289, 2989) === 'cathedral' && await text(13, 2290, 2989) === 'houses', 'tiles in the root directory');
ok(await text(14, 9000, 9000) === 'far away', 'a tile behind a leaf directory');
ok(await text(13, 1, 1) === null, 'a tile the file does not have');
const before = reads; await text(14, 9000, 9000);
ok(reads === before + 1, 'directories are read once, then remembered');
console.log('pmtiles ok');
