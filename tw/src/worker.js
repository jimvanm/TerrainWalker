// Runs off the main thread. Fetches a terrarium PNG, decodes elevation,
// builds a tile mesh with skirts, and transfers the buffers back.
//
// Vertex layout is vec4:
//   x = local mercator east  from tile centre (metres, unscaled)
//   y = elevation in metres above the ellipsoid
//   z = local mercator north from tile centre, already negated so +z is south
//   w = skirt flag, 0 for surface and 1 for skirt
//
// Positions are stored unscaled and camera-independent, so a moving camera only
// ever changes uniforms. Vertex buffers are built once and never touched again.

import { tileSizeMerc, tileCentreMerc, tileToMerc, mercYToLat } from './geo.js';
import { decodeMVT } from './mvt.js';
import { rasterOverlays, MASK } from './overlayraster.js';
import { decodeTerrarium, pxMetersFor, sample, meshNodes, PX, COARSE } from './heightgrid.js';
import { cachedFetch } from './cache.js';

export { decodeTerrarium };

export function buildMesh(heights, z, grid) {
  const N = grid;
  const V = N + 1;
  const size = tileSizeMerc(z);          // tile width in mercator metres
  const half = size / 2;
  const step = size / N;

  const surfCount = V * V;
  const skirtCount = 4 * V;
  const positions = new Float32Array((surfCount + skirtCount) * 4);

  // Surface grid, row-major from the north-west corner.
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      const k = (j * V + i) * 4;
      // Map grid node to a source pixel. Nodes span the full tile, so the
      // outermost nodes land on pixel 0 and pixel 255.
      const el = sample(heights, (i / N) * (PX - 1), (j / N) * (PX - 1));
      positions[k] = -half + i * step;    // east
      positions[k + 1] = el;
      positions[k + 2] = -half + j * step; // south (already negated north)
      positions[k + 3] = 0;
    }
  }

  // Skirt vertices: one copy of each edge node, flagged so the shader drops it.
  // Order: north edge, south edge, west edge, east edge.
  let s = surfCount;
  const edgeIndex = [];
  for (const edge of ['n', 's', 'w', 'e']) {
    const start = s;
    for (let t = 0; t < V; t++) {
      let src;
      if (edge === 'n') src = t;
      else if (edge === 's') src = (V - 1) * V + t;
      else if (edge === 'w') src = t * V;
      else src = t * V + (V - 1);
      const a = src * 4, b = s * 4;
      positions[b] = positions[a];
      positions[b + 1] = positions[a + 1];
      positions[b + 2] = positions[a + 2];
      positions[b + 3] = 1;
      s++;
    }
    edgeIndex.push({ edge, start });
  }

  const triCount = 2 * N * N + 4 * 2 * N;
  const indices = new Uint16Array(triCount * 3);
  let o = 0;
  for (let j = 0; j < N; j++) {
    for (let i = 0; i < N; i++) {
      const a = j * V + i, b = a + 1, c = a + V, d = c + 1;
      indices[o++] = a; indices[o++] = c; indices[o++] = b;
      indices[o++] = b; indices[o++] = c; indices[o++] = d;
    }
  }
  // Skirt quads. Back-face culling is off, so winding does not matter here.
  for (const { edge, start } of edgeIndex) {
    for (let t = 0; t < N; t++) {
      let s0, s1;
      if (edge === 'n') { s0 = t; s1 = t + 1; }
      else if (edge === 's') { s0 = (V - 1) * V + t; s1 = s0 + 1; }
      else if (edge === 'w') { s0 = t * V; s1 = s0 + V; }
      else { s0 = t * V + (V - 1); s1 = s0 + V; }
      const k0 = start + t, k1 = start + t + 1;
      indices[o++] = s0; indices[o++] = k0; indices[o++] = s1;
      indices[o++] = s1; indices[o++] = k0; indices[o++] = k1;
    }
  }

  return { positions, indices };
}


async function loadVector(url, mPerPx, sub) {
  const res = await cachedFetch(url, { mode: 'cors' });
  if (res.status === 404 || res.status === 204) return null;   // no data here
  if (!res.ok) throw new Error('vector HTTP ' + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length === 0) return null;
  // Full properties for transportation only, to tell main railways from sidings and tunnels.
  return rasterOverlays(decodeMVT(buf,
    ['water', 'waterway', 'landcover', 'landuse', 'transportation', 'aeroway'], 'class', ['transportation']), mPerPx, sub);
}

async function loadTile(url, z, y) {
  const res = await cachedFetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const cv = new OffscreenCanvas(PX, PX);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, PX, PX);
  bmp.close();
  return decodeTerrarium(ctx.getImageData(0, 0, PX, PX).data, pxMetersFor(z, y));
}

// Guarded so this module can also be imported by the test harness, where
// there is no worker global scope.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
self.onmessage = async (ev) => {
  const { id, url, vurl, vsub, z, x, y, grid, keepHeights } = ev.data;
  // Metres per map pixel, at the map tile's own zoom (see rasterOverlays).
  const vz = vsub ? vsub.vz : z;
  const mPerPx = tileSizeMerc(vz) * Math.cos(mercYToLat(tileCentreMerc(x, y, z).y) * Math.PI / 180) / MASK;
  try {
    // Water is optional: a failure here must never cost us the terrain.
    const [heights, ov] = await Promise.all([
      loadTile(url, z, y),
      vurl ? loadVector(vurl, mPerPx, vsub).catch(() => null) : Promise.resolve(null),
    ]);
    const { positions, indices } = buildMesh(heights, z, grid);
    const centre = tileCentreMerc(x, y, z);
    const nw = tileToMerc(x, y, z);
    const transfer = [positions.buffer, indices.buffer];
    if (ov) transfer.push(ov.mask.buffer, ov.cover.buffer);
    let hcopy = null;
    // A small copy of every tile's heights (33 x 33 points), so the ground can
    // be looked up anywhere something is drawn, not only near the camera.
    const coarse = meshNodes(heights, COARSE);
    transfer.push(coarse.buffer);
    if (keepHeights) { hcopy = heights; transfer.push(hcopy.buffer); }
    self.postMessage(
      { id, ok: true, positions, indices, centre, nw, size: tileSizeMerc(z),
        heights: hcopy, coarse, mask: ov && ov.mask, cover: ov && ov.cover },
      transfer
    );
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message || e) });
  }
};
}
