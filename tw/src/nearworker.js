// Near-field worker. For one fine map tile it fetches the vector data and the
// elevation tile that contains it, and builds draped road, railway and
// airport geometry, and buildings.
//
// Heights come from the SAME terrain mesh function the main terrain uses
// (heightgrid.js), so geometry sits on the rendered surface rather than on the
// finer raw data, which would float or bury it on slopes.

import { decodeMVT } from './mvt.js';
import { tileSizeMerc, tileToMerc, tileCentreMerc, mercYToLat } from './geo.js';
import { decodeTerrarium, meshNodes, pxMetersFor, PX } from './heightgrid.js';
import { buildRoads } from './roads.js';
import { buildBuildings } from './buildings.js';
import { SITES } from './landmark_sites.js';
import { lonToMercX, latToMercY, wrapMercDx } from './geo.js';
import { signedArea } from './earclip.js';
import { POLYGON } from './mvt.js';
import { MeshBuilder } from './meshbuilder.js';
import { cachedFetch } from './cache.js';

const SKY_SUNK = 6;   // far terrain is coarse, so skyline walls start deeper
const EZ = 12;     // elevation tile that the finest terrain level uses

const cache = new Map();   // elevation url -> Promise<Float32Array nodes>

function elevationNodes(url, y) {
  let p = cache.get(url);
  if (!p) {
    p = (async () => {
      const res = await cachedFetch(url, { mode: 'cors' });
      if (!res.ok) throw new Error('elevation HTTP ' + res.status);
      const bmp = await createImageBitmap(await res.blob());
      const cv = new OffscreenCanvas(PX, PX);
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.drawImage(bmp, 0, 0, PX, PX);
      bmp.close();
      return meshNodes(decodeTerrarium(ctx.getImageData(0, 0, PX, PX).data, pxMetersFor(EZ, y)));
    })();
    cache.set(url, p);
    p.catch(() => cache.delete(url));
    if (cache.size > 6) cache.delete(cache.keys().next().value);
  }
  return p;
}

async function vectorLayers(url, want) {
  const res = await cachedFetch(url, { mode: 'cors' });
  if (res.status === 404 || res.status === 204) return {};
  if (!res.ok) throw new Error('vector HTTP ' + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length) return {};
  return decodeMVT(buf, want, 'class', want);
}

// z is the map tile zoom (14 for the near field, 13 for the far skyline).
// skyline: buildings only, and only ones known to be at least skyMin metres tall.
// Fraction of a tile covered by the polygons of a layer (optionally only some classes).
function coverOf(layer, classes) {
  if (!layer) return 0;
  const E = layer.extent;
  let total = 0;
  for (const f of layer.features) {
    if (f.type !== POLYGON || (classes && !classes.includes(f.cls))) continue;
    let sign = 0, net = 0;
    for (const raw of f.parts) {
      const r = raw.slice(0, raw.length - 2);
      if (r.length < 6) continue;
      const a = signedArea(r);
      if (!sign) sign = Math.sign(a) || 1;
      net += a * sign;
    }
    total += net;
  }
  return Math.min(1, Math.max(0, total / (E * E)));
}
const BUILT_CLASSES = ['residential', 'commercial', 'retail', 'suburb', 'quarter', 'neighbourhood'];

// marker: do not build anything. Just report how built-up the tile is, so the
// caller can decide whether the finer tiles under it are worth fetching.
async function markTile({ vurl }) {
  const res = await cachedFetch(vurl, { mode: 'cors' });
  const none = { vertices: new ArrayBuffer(0), indices: new Uint32Array(0), verts: 0, info: new Uint32Array(0),
                 bVertices: new ArrayBuffer(0), bIndices: new Uint32Array(0), bVerts: 0, bInfo: new Uint32Array(0),
                 rEnds: [0, 0, 0] };
  if (res.status === 404 || res.status === 204) return { ...none, stats: { cover: 0, built: 0, seen: 0, kept: 0, dropped: 0, ends: [0, 0, 0] } };
  if (!res.ok) throw new Error('vector HTTP ' + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  const L = buf.length ? decodeMVT(buf, ['building', 'landuse']) : {};
  return { ...none, stats: {
    cover: coverOf(L.building), built: coverOf(L.landuse, BUILT_CLASSES),
    seen: L.building ? L.building.features.length : 0, kept: 0, dropped: 0, ends: [0, 0, 0],
  } };
}

export async function buildNearTile(spec) {
  if (spec.marker) return markTile(spec);
  const { x, y, z = 14, vurl, eurl, skyline = false, skyMin = 50 } = spec;
  const d = z - EZ;
  const [layers, nodes] = await Promise.all([
    vectorLayers(vurl, skyline ? ['building', 'landuse'] : ['transportation', 'aeroway', 'building', 'landuse']),
    elevationNodes(eurl, y >> d),
  ]);
  const nw12 = tileToMerc(x >> d, y >> d, EZ);
  const c = tileCentreMerc(x, y, z);
  const g = {
    size14: tileSizeMerc(z),          // this tile's size (the name dates from when it was always z14)
    size12: tileSizeMerc(EZ),
    bx: c.x - nw12.x,
    by: nw12.y - c.y,
    cosLat: Math.cos(mercYToLat(c.y) * Math.PI / 180),
    nodes,
  };
  const mb = new MeshBuilder();
  const counts = {};
  const rEnds = skyline ? [0, 0, 0] : buildRoads(layers.transportation, g, mb, layers.aeroway, counts);
  const bb = new MeshBuilder();
  // Landmark sites in this tile's local units, so the plain building outline under
  // a landmark is left out. Only sites that can reach into this tile are passed.
  const half = g.size14 / 2;
  const mask = [];
  for (const L of SITES) {
    const r = L.maskR / g.cosLat;
    const mx = wrapMercDx(lonToMercX(L.lon) - c.x), my = c.y - latToMercY(L.lat);
    if (Math.abs(mx) < half + r && Math.abs(my) < half + r) mask.push({ id: L.id, x: mx, y: my, r });
  }
  const stats = buildBuildings(layers.building, g, bb, undefined,
    { ...(skyline ? { minHeight: skyMin, sunk: SKY_SUNK } : {}), mask, landuse: layers.landuse });
  Object.assign(stats, counts);
  const r = mb.finish(), b = bb.finish();
  return { vertices: r.vertices, indices: r.indices, verts: r.verts, info: r.info,
           bVertices: b.vertices, bIndices: b.indices, bVerts: b.verts, bInfo: b.info, stats, rEnds };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = async (ev) => {
    const { id } = ev.data;
    try {
      const r = await buildNearTile(ev.data);
      self.postMessage({ id, ok: true, vertices: r.vertices, indices: r.indices, verts: r.verts, info: r.info,
        bVertices: r.bVertices, bIndices: r.bIndices, bVerts: r.bVerts, bInfo: r.bInfo, stats: r.stats, rEnds: r.rEnds },
        [r.vertices, r.indices.buffer, r.info.buffer, r.bVertices, r.bIndices.buffer, r.bInfo.buffer]);
    } catch (e) {
      self.postMessage({ id, ok: false, error: String(e && e.message || e) });
    }
  };
}
