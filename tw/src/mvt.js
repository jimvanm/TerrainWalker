// Minimal MVT (Mapbox Vector Tile 2.1) reader. No dependencies.
// Only what is needed: layer names, feature geometry, and one string tag.
//
// Wire format reference:
//   Tile    { repeated Layer layers = 3 }
//   Layer   { name=1(str) features=2(msg) keys=3(str) values=4(msg)
//             extent=5(varint) version=15(varint) }
//   Feature { id=1 tags=2(packed) type=3(varint) geometry=4(packed) }
//   Value   { string=1 float=2 double=3 int64=4 uint64=5 sint64=6 bool=7 }

export const POINT = 1, LINESTRING = 2, POLYGON = 3;

class Pbf {
  constructor(buf) { this.buf = buf; this.pos = 0; this.len = buf.length; }

  // Multiplication rather than shifting: `<<` is 32-bit in JS and silently
  // corrupts varints past 2^31, which real tiles do contain.
  varint() {
    let result = 0, shift = 1, b;
    do {
      b = this.buf[this.pos++];
      result += (b & 0x7f) * shift;
      shift *= 128;
    } while (b >= 0x80 && this.pos < this.len);
    return result;
  }

  string(end) {
    const s = new TextDecoder().decode(this.buf.subarray(this.pos, end));
    this.pos = end;
    return s;
  }

  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else if (wire === 1) this.pos += 8;
    else throw new Error('bad wire type ' + wire);
  }

  // Reads a length-delimited submessage, calling fn(fieldNumber, endOfField).
  message(fn) {
    const end = this.varint() + this.pos;
    while (this.pos < end) {
      const key = this.varint();
      const field = key >> 3, wire = key & 7;
      const before = this.pos;
      if (!fn(field, wire, this)) { this.pos = before; this.skip(wire); }
    }
    this.pos = end;
  }
}

const zigzag = (n) => (n >> 1) ^ -(n & 1);

// Decodes MVT command geometry into arrays of rings/lines in tile units.
function geometry(pbf) {
  const end = pbf.varint() + pbf.pos;
  const parts = [];
  let cur = null, x = 0, y = 0;
  while (pbf.pos < end) {
    const cmdInt = pbf.varint();
    const cmd = cmdInt & 0x7, count = cmdInt >> 3;
    if (cmd === 1) {                       // MoveTo
      for (let i = 0; i < count; i++) {
        x += zigzag(pbf.varint());
        y += zigzag(pbf.varint());
        cur = [x, y];
        parts.push(cur);
      }
    } else if (cmd === 2) {                // LineTo
      for (let i = 0; i < count; i++) {
        x += zigzag(pbf.varint());
        y += zigzag(pbf.varint());
        if (cur) cur.push(x, y);
      }
    } else if (cmd === 7) {                // ClosePath
      if (cur && cur.length >= 2) cur.push(cur[0], cur[1]);
    }
  }
  return parts;
}

// Returns { extent, features: [{ type, parts, cls }] } for the named layers.
// `fullProps` names layers whose features should carry every property in
// `props`, not just the one tag. Off by default: most layers do not need it.
export function decodeMVT(bytes, wantLayers, tagKey = 'class', fullProps = null) {
  const pbf = new Pbf(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const out = {};
  while (pbf.pos < pbf.len) {
    const key = pbf.varint();
    const field = key >> 3, wire = key & 7;
    if (field !== 3 || wire !== 2) { pbf.skip(wire); continue; }

    let name = '', extent = 4096;
    const feats = [], keys = [], values = [], raw = [];
    pbf.message((f, w, p) => {
      if (f === 1 && w === 2) { name = p.string(p.varint() + p.pos); return true; }
      if (f === 5 && w === 0) { extent = p.varint(); return true; }
      if (f === 3 && w === 2) { keys.push(p.string(p.varint() + p.pos)); return true; }
      if (f === 4 && w === 2) {
        let v = null;
        p.message((vf, vw, vp) => {
          if (vf === 1 && vw === 2) { v = vp.string(vp.varint() + vp.pos); return true; }
          if (vf === 2 && vw === 5) {
            v = new DataView(vp.buf.buffer, vp.buf.byteOffset + vp.pos, 4).getFloat32(0, true);
            vp.pos += 4; return true;
          }
          if (vf === 3 && vw === 1) {
            v = new DataView(vp.buf.buffer, vp.buf.byteOffset + vp.pos, 8).getFloat64(0, true);
            vp.pos += 8; return true;
          }
          if ((vf === 4 || vf === 5) && vw === 0) { v = vp.varint(); return true; }
          if (vf === 6 && vw === 0) { const n = vp.varint(); v = n % 2 ? -(n + 1) / 2 : n / 2; return true; }
          if (vf === 7 && vw === 0) { v = vp.varint() !== 0; return true; }
          return false;
        });
        values.push(v);
        return true;
      }
      if (f === 2 && w === 2) {
        let type = 0, parts = null, tags = null;
        p.message((ff, fw, fp) => {
          if (ff === 3 && fw === 0) { type = fp.varint(); return true; }
          if (ff === 4 && fw === 2) { parts = geometry(fp); return true; }
          if (ff === 2 && fw === 2) {
            const e = fp.varint() + fp.pos;
            tags = [];
            while (fp.pos < e) tags.push(fp.varint());
            return true;
          }
          return false;
        });
        raw.push({ type, parts, tags });
        return true;
      }
      return false;
    });

    if (!wantLayers.includes(name)) continue;
    // Tags are index pairs into the layer keys/values tables, so they can only
    // be resolved once the whole layer has been read.
    const full = !!(fullProps && fullProps.includes(name));
    for (const r of raw) {
      let cls = null, props = null;
      if (full) props = {};
      if (r.tags) {
        for (let i = 0; i + 1 < r.tags.length; i += 2) {
          const k = keys[r.tags[i]], val = values[r.tags[i + 1]];
          if (k === tagKey) cls = val;
          if (full) props[k] = val;
          else if (cls !== null) break;
        }
      }
      if (r.parts) feats.push({ type: r.type, parts: r.parts, cls, props });
    }
    out[name] = { extent, features: feats };
  }
  return out;
}
