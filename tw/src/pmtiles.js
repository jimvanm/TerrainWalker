// Reads map tiles out of one big PMTiles file on a web server, a piece at a
// time, without downloading the whole file. This is how Overture publishes its
// buildings. No library: the format is small.
//
// The file starts with a 127-byte header, then a directory of where each
// tile's bytes are. Big files split the directory into a root and leaves.
// Tiles are numbered along a Hilbert curve, zoom by zoom. Directories and
// tiles are usually gzip-compressed.

const HEADER = 127;

function u64(dv, o) { return dv.getUint32(o, true) + dv.getUint32(o + 4, true) * 2 ** 32; }

export function parseHeader(buf) {
  const b = new Uint8Array(buf);
  const magic = String.fromCharCode(...b.slice(0, 7));
  if (magic !== 'PMTiles' || b[7] !== 3) throw new Error('not a PMTiles v3 file');
  const dv = new DataView(buf);
  return {
    rootOffset: u64(dv, 8), rootLength: u64(dv, 16),
    leafOffset: u64(dv, 40), leafLength: u64(dv, 48),
    dataOffset: u64(dv, 56), dataLength: u64(dv, 64),
    internalCompression: b[97], tileCompression: b[98], tileType: b[99],
    minZoom: b[100], maxZoom: b[101],
  };
}

// Tile number: all tiles of lower zooms first, then the place along a Hilbert
// curve through this zoom's grid.
export function tileId(z, x, y) {
  let acc = 0;
  for (let i = 0; i < z; i++) acc += 4 ** i;
  const n = 2 ** z;
  let d = 0;
  for (let s = n / 2; s >= 1; s /= 2) {
    const rx = (x & s) > 0 ? 1 : 0, ry = (y & s) > 0 ? 1 : 0;
    d += s * s * ((3 * rx) ^ ry);
    if (ry === 0) {
      if (rx === 1) { x = s - 1 - x; y = s - 1 - y; }
      const t = x; x = y; y = t;
    }
  }
  return acc + d;
}

function varint(b, p) {
  let v = 0, mul = 1, byte;
  do { byte = b[p.i++]; v += (byte & 0x7f) * mul; mul *= 128; } while (byte & 0x80);
  return v;
}

// A directory: tile numbers, run lengths, lengths and offsets, each a list of
// varints, the numbers stored as gaps from the one before.
export function parseDirectory(bytes) {
  const p = { i: 0 };
  const n = varint(bytes, p);
  const e = Array.from({ length: n }, () => ({ id: 0, run: 0, len: 0, off: 0 }));
  let last = 0;
  for (const x of e) { last += varint(bytes, p); x.id = last; }
  for (const x of e) x.run = varint(bytes, p);
  for (const x of e) x.len = varint(bytes, p);
  for (let k = 0; k < n; k++) {
    const v = varint(bytes, p);
    e[k].off = v === 0 && k > 0 ? e[k - 1].off + e[k - 1].len : v - 1;
  }
  return e;
}

// The entry covering tile id, or null.
export function findEntry(entries, id) {
  let lo = 0, hi = entries.length - 1, best = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (entries[m].id <= id) { best = m; lo = m + 1; } else hi = m - 1;
  }
  if (best < 0) return null;
  const e = entries[best];
  if (e.run === 0) return e;                       // a leaf directory: look inside
  return id < e.id + e.run ? e : null;
}

async function inflate(bytes, kind) {
  if (kind === 0 || kind === 1) return bytes;     // unknown or none
  if (kind !== 2) throw new Error('compression ' + kind + ' is not supported');
  const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
  return new Uint8Array(await new Response(s).arrayBuffer());
}

export class PMTiles {
  // fetchRange(offset, length) -> Promise<ArrayBuffer>. The default reads
  // part of url with an HTTP Range request.
  constructor(url, fetchRange = null) {
    this.url = url;
    this.fetchRange = fetchRange || (async (off, len) => {
      const r = await fetch(url, { headers: { Range: `bytes=${off}-${off + len - 1}` }, mode: 'cors' });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return r.arrayBuffer();
    });
    this.dirs = new Map();
    this.head = null;
  }

  async header() {
    if (!this.head) {
      this.head = (async () => {
        const buf = await this.fetchRange(0, 16384);   // header and, usually, the root directory
        const h = parseHeader(buf);
        if (h.rootOffset + h.rootLength <= buf.byteLength) {
          const raw = new Uint8Array(buf, h.rootOffset, h.rootLength);
          this.dirs.set('root', parseDirectory(await inflate(raw, h.internalCompression)));
        }
        return h;
      })();
    }
    return this.head;
  }

  async dir(key, off, len) {
    let d = this.dirs.get(key);
    if (!d) {
      const h = await this.header();
      d = (async () => parseDirectory(await inflate(new Uint8Array(await this.fetchRange(off, len)), h.internalCompression)))();
      this.dirs.set(key, d);
      d.catch(() => this.dirs.delete(key));
    }
    return d;
  }

  // The tile's bytes, uncompressed, or null if the file has no such tile.
  async tile(z, x, y) {
    const h = await this.header();
    const id = tileId(z, x, y);
    let entries = await this.dir('root', h.rootOffset, h.rootLength);
    for (let depth = 0; depth < 4; depth++) {
      const e = findEntry(entries, id);
      if (!e) return null;
      if (e.run > 0) {
        const raw = new Uint8Array(await this.fetchRange(h.dataOffset + e.off, e.len));
        return inflate(raw, h.tileCompression);
      }
      entries = await this.dir('leaf' + e.off, h.leafOffset + e.off, e.len);
    }
    return null;
  }
}
