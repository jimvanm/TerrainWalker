// Near-field worker. For one fine map tile it fetches the vector data and the
// elevation tile that contains it, and builds draped road geometry.
//
// Heights come from the SAME terrain mesh function the main terrain uses
// (heightgrid.js), so geometry sits on the rendered surface rather than on the
// finer raw data, which would float or bury it on slopes.

import { decodeMVT } from './mvt.js';
import { tileSizeMerc, tileToMerc, tileCentreMerc, mercYToLat } from './geo.js';
import { decodeTerrarium, meshNodes, PX } from './heightgrid.js';
import { buildRoads } from './roads.js';
import { MeshBuilder } from './meshbuilder.js';
import { cachedFetch } from './cache.js';

const Z = 14;      // near-field map tile zoom
const EZ = 12;     // elevation tile that the finest terrain level uses

const cache = new Map();   // elevation url -> Promise<Float32Array nodes>

function elevationNodes(url) {
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
      return meshNodes(decodeTerrarium(ctx.getImageData(0, 0, PX, PX).data));
    })();
    cache.set(url, p);
    p.catch(() => cache.delete(url));
    if (cache.size > 6) cache.delete(cache.keys().next().value);
  }
  return p;
}

async function vectorLayers(url) {
  const res = await cachedFetch(url, { mode: 'cors' });
  if (res.status === 404 || res.status === 204) return {};
  if (!res.ok) throw new Error('vector HTTP ' + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (!buf.length) return {};
  return decodeMVT(buf, ['transportation'], 'class', ['transportation']);
}

export async function buildNearTile({ x, y, vurl, eurl }) {
  const [layers, nodes] = await Promise.all([vectorLayers(vurl), elevationNodes(eurl)]);
  const nw12 = tileToMerc(x >> (Z - EZ), y >> (Z - EZ), EZ);
  const c14 = tileCentreMerc(x, y, Z);
  const g = {
    size14: tileSizeMerc(Z),
    size12: tileSizeMerc(EZ),
    bx: c14.x - nw12.x,
    by: nw12.y - c14.y,
    cosLat: Math.cos(mercYToLat(c14.y) * Math.PI / 180),
    nodes,
  };
  const mb = new MeshBuilder();
  buildRoads(layers.transportation, g, mb);
  return mb.finish();
}

if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
  self.onmessage = async (ev) => {
    const { id } = ev.data;
    try {
      const r = await buildNearTile(ev.data);
      self.postMessage({ id, ok: true, vertices: r.vertices, indices: r.indices, verts: r.verts },
        [r.vertices, r.indices.buffer]);
    } catch (e) {
      self.postMessage({ id, ok: false, error: String(e && e.message || e) });
    }
  };
}
