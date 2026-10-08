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
import { loadList, loadFootprint, turnFootprint } from './landmark_list.js';
import { lonToMercX, latToMercY, wrapMercDx } from './geo.js';
import { signedArea } from './earclip.js';
import { POLYGON } from './mvt.js';
import { MeshBuilder } from './meshbuilder.js';
import { cachedFetch } from './cache.js';
import { tileFrame, buildCityTile, samplePaint } from './citykit.js';
import { rasterOverlays, MASK } from './overlayraster.js';
import { PMTiles } from './pmtiles.js';
import { overtureBuildings, overtureCounts } from './overture.js';

// Overture's building file, one reader per release (each keeps its directory).
const archives = new Map();
const anyLayer = { includes: () => true };    // decode every layer in a tile

// Overture's buildings for one tile, in the names buildings.js reads, with a
// few counts for the K report. Overture's finest zoom is 14, the near field's.
async function overtureLayer(url, z, x, y) {
  let pm = archives.get(url);
  if (!pm) { pm = new PMTiles(url); archives.set(url, pm); }
  const bytes = await pm.tile(z, x, y);
  if (!bytes) return { layer: null, counts: { buildings: 0 } };      // Overture has nothing here
  const L = decodeMVT(bytes, anyLayer, 'class', anyLayer);
  const c = overtureCounts(L);
  const n = (k) => c.keys[k] || 0;
  return { layer: overtureBuildings(L), counts: {
    buildings: Object.entries(c.layers).filter(([k]) => !/part/.test(k)).reduce((a, [, v]) => a + v, 0),
    parts: Object.entries(c.layers).filter(([k]) => /part/.test(k)).reduce((a, [, v]) => a + v, 0),
    withHeight: n('height'), withFloors: n('num_floors'), withType: n('subtype'),
    withRoofShape: n('roof_shape'), withWallMaterial: n('facade_material'), roofShapes: c.roof,
  } };
}

const SKY_SUNK = 6;
const FOOTPRINT_REACH = 600;   // metres: landmarks closer than this to a tile may reach into it   // far terrain is coarse, so skyline walls start deeper
// Which elevation zoom to drape on comes with each job (spec.ez): the finest
// terrain level for the near field, zoom 12 for the distant skyline.
const EZ_DEFAULT = 12;

const cache = new Map();   // elevation url -> Promise<Float32Array nodes>

function elevationNodes(url, ez, y) {
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
      return meshNodes(decodeTerrarium(ctx.getImageData(0, 0, PX, PX).data, pxMetersFor(ez, y)));
    })();
    cache.set(url, p);
    p.catch(() => cache.delete(url));
    if (cache.size > 12) cache.delete(cache.keys().next().value);
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

// Landmark masks in a tile's local units: the landmark's own footprint, turned
// to its facing, and its circle (maskR). Any map building touching either is
// the landmark's stand-in on the map, so it is hidden. Only landmarks that can
// reach into the tile are passed on. g: the tile's frame, c: its middle.
export async function landmarkMask(sites, g, c) {
  const half = g.size14 / 2;
  const mask = [];
  for (const L of sites) {
    const r = L.maskR / g.cosLat;
    const mx = wrapMercDx(lonToMercX(L.lon) - c.x), my = c.y - latToMercY(L.lat);
    const reach = Math.max(r, FOOTPRINT_REACH / g.cosLat);
    if (Math.abs(mx) >= half + reach || Math.abs(my) >= half + reach) continue;
    let poly = null;
    const fp = await loadFootprint(L.id).catch(() => null);
    if (fp && fp.length >= 3) {
      poly = new Float64Array(fp.length * 2);
      turnFootprint(fp, L.yawDeg || 0).forEach(([e, n], i) => {     // metres east/north -> tile units (y is south)
        poly[2 * i] = mx + e / g.cosLat; poly[2 * i + 1] = my - n / g.cosLat;
      });
    }
    mask.push({ id: L.id, x: mx, y: my, r, poly });
  }
  return mask;
}

export async function buildNearTile(spec) {
  if (spec.marker) return markTile(spec);
  const { x, y, z = 14, vurl, eurl, skyline = false, skyMin = 50 } = spec;
  const EZ = spec.ez || EZ_DEFAULT, d = z - EZ;
  const [layers, nodes, sites] = await Promise.all([
    vectorLayers(vurl, skyline ? ['building', 'landuse'] : ['transportation', 'aeroway', 'building', 'landuse']),
    elevationNodes(eurl, EZ, y >> d),
    loadList(),
  ]);
  const nw12 = tileToMerc(x >> d, y >> d, EZ);
  const c = tileCentreMerc(x, y, z);
  const g = {
    size14: tileSizeMerc(z),          // this tile's size (the name dates from when it was always z14)
    size12: tileSizeMerc(EZ),         // the elevation tile's size (named from when it was always zoom 12)
    bx: c.x - nw12.x,
    by: nw12.y - c.y,
    cosLat: Math.cos(mercYToLat(c.y) * Math.PI / 180),
    nodes,
    cx: c.x, cy: c.y,                 // tile centre, so runway dashes line up across tiles
  };
  const mb = new MeshBuilder();
  const counts = {};
  const rEnds = skyline ? [0, 0, 0] : buildRoads(layers.transportation, g, mb, layers.aeroway, counts);
  const bb = new MeshBuilder();
  const mask = await landmarkMask(sites, g, c);
  // Building style (settings.buildings): 0 today's, 1 the new look, 2 the new
  // look on Overture's buildings. Falls back to our map's if Overture fails.
  const style = spec.style || 0;
  let bLayer = layers.building, ovt = null;
  if (style === 2 && spec.ovtUrl && !skyline) {
    try { const o = await overtureLayer(spec.ovtUrl, z, x, y); bLayer = o.layer; ovt = o.counts; }
    catch (e) { ovt = { error: String(e && e.message || e) }; }
  }
  const stats = buildBuildings(bLayer, g, bb, undefined,
    { ...(skyline ? { minHeight: skyMin, sunk: SKY_SUNK } : {}), mask, landuse: layers.landuse, faces: style >= 1 && !skyline });
  stats.style = style;
  if (ovt) stats.overture = ovt;
  Object.assign(stats, counts);
  // For the K report: which landmark masks reached this tile, and whether the
  // landmark's outline loaded (without it only the circle masks).
  if (mask.length) stats.maskInfo = mask.map((m) => ({ id: m.id, footprint: !!m.poly }));
  const r = mb.finish(), b = bb.finish();
  return { vertices: r.vertices, indices: r.indices, verts: r.verts, info: r.info,
           bVertices: b.vertices, bIndices: b.indices, bVerts: b.verts, bInfo: b.info, bFac: b.fac || null, bSty: b.sty || null, stats, rEnds };
}


// A moved piece of ground (city.js): one map tile's roads and buildings on the
// piece's own ground, and the map's paint under its grid nodes, in the piece's
// frame. spec: { vurl, tile: { x, y, z }, slab, maskModels } (see citykit.js).
const CITY_LAYERS = ['water', 'waterway', 'landcover', 'landuse', 'transportation', 'aeroway', 'building'];
export async function buildCityJob(spec) {
  const { vurl, slab, tile } = spec;
  const layers = await vectorLayers(vurl, CITY_LAYERS);
  const fr = tileFrame(slab, tile);
  const sites = spec.maskModels && spec.maskModels.length ? (await loadList()).filter((L) => spec.maskModels.includes(L.id)) : [];
  const mask = await landmarkMask(sites, fr.g, fr.c);
  const built = buildCityTile(layers, { slab, tile, mask });
  let paint = null;
  if (layers.water || layers.landcover || layers.landuse) {
    try {
      const mPerPx = fr.size * fr.g.cosLat / MASK;
      paint = samplePaint(rasterOverlays(layers, mPerPx), slab, tile);
    } catch (e) { /* no canvas here: the ground just goes unpainted */ }
  }
  return { ...built, paint };
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = async (ev) => {
    const { id } = ev.data;
    try {
      if (ev.data.city) {
        const r = await buildCityJob(ev.data);
        const out = { id, ok: true, city: true, stats: r.stats, paint: r.paint,
          rVertices: r.roads.vertices, rIndices: r.roads.indices, rVerts: r.roads.verts,
          bVertices: r.bld.vertices, bIndices: r.bld.indices, bInfo: r.bld.info, bVerts: r.bld.verts };
        const transfer = [r.roads.vertices, r.roads.indices.buffer, r.bld.vertices, r.bld.indices.buffer, r.bld.info.buffer];
        if (r.paint) transfer.push(r.paint.idx.buffer, r.paint.water.buffer, r.paint.built.buffer, r.paint.cov.buffer, r.paint.cover.buffer);
        self.postMessage(out, transfer);
        return;
      }
      const r = await buildNearTile(ev.data);
      const transfer = [r.vertices, r.indices.buffer, r.info.buffer, r.bVertices, r.bIndices.buffer, r.bInfo.buffer];
      if (r.bFac) transfer.push(r.bFac.buffer, r.bSty.buffer);
      self.postMessage({ id, ok: true, vertices: r.vertices, indices: r.indices, verts: r.verts, info: r.info,
        bVertices: r.bVertices, bIndices: r.bIndices, bVerts: r.bVerts, bInfo: r.bInfo, bFac: r.bFac, bSty: r.bSty,
        stats: r.stats, rEnds: r.rEnds }, transfer);
    } catch (e) {
      self.postMessage({ id, ok: false, error: String(e && e.message || e) });
    }
  };
}
