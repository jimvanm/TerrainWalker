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

import { tileSizeMerc, tileCentreMerc, tileToMerc } from './geo.js';
import { decodeMVT, POLYGON, LINESTRING } from './mvt.js';

const PX = 256;
const MASK = 256;   // water mask resolution, independent of mesh density

export function decodeTerrarium(rgba) {
  const h = new Float32Array(PX * PX);
  for (let i = 0, p = 0; i < h.length; i++, p += 4) {
    h[i] = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768;
  }
  return h;
}

// Bilinear sample of the 256x256 grid at fractional pixel coordinates.
function sample(h, fx, fy) {
  const x = Math.max(0, Math.min(PX - 1.001, fx));
  const y = Math.max(0, Math.min(PX - 1.001, fy));
  const x0 = x | 0, y0 = y | 0;
  const x1 = x0 + 1 < PX ? x0 + 1 : x0;
  const y1 = y0 + 1 < PX ? y0 + 1 : y0;
  const tx = x - x0, ty = y - y0;
  const a = h[y0 * PX + x0], b = h[y0 * PX + x1];
  const c = h[y1 * PX + x0], d = h[y1 * PX + x1];
  return (a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty;
}

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

// Land cover colours. Baked into RGB rather than stored as a class index,
// because the texture is sampled with LINEAR filtering and interpolating
// between two index values would invent a third class that is not there.
// Interpolating between two colours is exactly what we want instead.
const COVER = {
  wood:      [ 51,  86,  46],
  forest:    [ 51,  86,  46],
  grass:     [107, 140,  71],
  grassland: [107, 140,  71],
  meadow:    [107, 140,  71],
  farmland:  [148, 148,  87],
  rock:      [115, 110, 102],
  bare_rock: [115, 110, 102],
  sand:      [204, 189, 140],
  beach:     [204, 189, 140],
  ice:       [235, 240, 245],
  glacier:   [235, 240, 245],
  snow:      [235, 240, 245],
  wetland:   [ 89, 115,  89],
  swamp:     [ 89, 115,  89],
};

const BUILT = ['residential', 'industrial', 'commercial', 'retail',
               'suburb', 'quarter', 'neighbourhood'];

function path(cx, parts, k, close) {
  for (const g of parts) {
    cx.moveTo(g[0] * k, g[1] * k);
    for (let i = 2; i < g.length; i += 2) cx.lineTo(g[i] * k, g[i + 1] * k);
    if (close) cx.closePath();
  }
}

// Two draped images per tile:
//   mask  RGBA - R water, G roads, B built-up, A land-cover coverage
//   cover RGB  - land-cover colour
// Channels rather than one composited image, so a layer can be switched off
// with a uniform instead of a refetch and a re-rasterise.
function rasterOverlays(layers) {
  const maskCv = new OffscreenCanvas(MASK, MASK);
  const mx = maskCv.getContext('2d', { willReadFrequently: true });
  mx.fillStyle = '#000';
  mx.fillRect(0, 0, MASK, MASK);
  // Additive, so each layer lands in its own channel without erasing the others.
  mx.globalCompositeOperation = 'lighter';
  mx.lineCap = 'round';
  mx.lineJoin = 'round';

  const w = layers.water;
  if (w) {
    const k = MASK / w.extent;
    mx.fillStyle = '#f00';
    mx.beginPath();
    for (const f of w.features) if (f.type === POLYGON) path(mx, f.parts, k, true);
    // Nonzero winding plus MVT ring order gives island holes for free.
    mx.fill('nonzero');
  }
  const ww = layers.waterway;
  if (ww) {
    const k = MASK / ww.extent;
    mx.strokeStyle = '#f00';
    for (const f of ww.features) {
      if (f.type !== LINESTRING) continue;
      mx.lineWidth = f.cls === 'river' ? 1.8 : 0.9;
      mx.beginPath(); path(mx, f.parts, k, false); mx.stroke();
    }
  }
  const tr = layers.transportation;
  if (tr) {
    const k = MASK / tr.extent;
    mx.strokeStyle = '#0f0';
    for (const f of tr.features) {
      if (f.type !== LINESTRING) continue;
      const major = f.cls === 'motorway' || f.cls === 'trunk' || f.cls === 'primary';
      if (!major && f.cls !== 'secondary' && f.cls !== 'tertiary') continue;
      mx.lineWidth = major ? 1.4 : 0.7;
      mx.beginPath(); path(mx, f.parts, k, false); mx.stroke();
    }
  }
  const lu = layers.landuse;
  if (lu) {
    const k = MASK / lu.extent;
    mx.fillStyle = '#00f';
    mx.beginPath();
    for (const f of lu.features) {
      if (f.type === POLYGON && BUILT.includes(f.cls)) path(mx, f.parts, k, true);
    }
    mx.fill('nonzero');
  }

  const coverCv = new OffscreenCanvas(MASK, MASK);
  const cxx = coverCv.getContext('2d', { willReadFrequently: true });
  const lc = layers.landcover;
  if (lc) {
    const k = MASK / lc.extent;
    for (const f of lc.features) {
      if (f.type !== POLYGON) continue;
      const c = COVER[f.cls];
      if (!c) continue;
      cxx.fillStyle = `rgb(${c[0]},${c[1]},${c[2]})`;
      cxx.beginPath(); path(cxx, f.parts, k, true); cxx.fill('nonzero');
    }
  }

  const md = mx.getImageData(0, 0, MASK, MASK).data;
  const cd = cxx.getImageData(0, 0, MASK, MASK).data;
  const mask = new Uint8Array(MASK * MASK * 4);
  const cover = new Uint8Array(MASK * MASK * 3);
  let any = false;
  for (let i = 0, p = 0, q = 0; i < MASK * MASK; i++, p += 4, q += 3) {
    mask[p] = md[p]; mask[p + 1] = md[p + 1]; mask[p + 2] = md[p + 2];
    mask[p + 3] = cd[p + 3];
    cover[q] = cd[p]; cover[q + 1] = cd[p + 1]; cover[q + 2] = cd[p + 2];
    if (!any && (md[p] || md[p + 1] || md[p + 2] || cd[p + 3])) any = true;
  }
  return any ? { mask, cover } : null;
}

async function loadVector(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (res.status === 404 || res.status === 204) return null;   // no data here
  if (!res.ok) throw new Error('vector HTTP ' + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length === 0) return null;
  return rasterOverlays(decodeMVT(buf,
    ['water', 'waterway', 'landcover', 'landuse', 'transportation']));
}

async function loadTile(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob);
  const cv = new OffscreenCanvas(PX, PX);
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.drawImage(bmp, 0, 0, PX, PX);
  bmp.close();
  return decodeTerrarium(ctx.getImageData(0, 0, PX, PX).data);
}

// Guarded so this module can also be imported by the test harness, where
// there is no worker global scope.
if (typeof self !== 'undefined' && typeof self.postMessage === 'function') {
self.onmessage = async (ev) => {
  const { id, url, vurl, z, x, y, grid, keepHeights } = ev.data;
  try {
    // Water is optional: a failure here must never cost us the terrain.
    const [heights, ov] = await Promise.all([
      loadTile(url),
      vurl ? loadVector(vurl).catch(() => null) : Promise.resolve(null),
    ]);
    const { positions, indices } = buildMesh(heights, z, grid);
    const centre = tileCentreMerc(x, y, z);
    const nw = tileToMerc(x, y, z);
    const transfer = [positions.buffer, indices.buffer];
    if (ov) transfer.push(ov.mask.buffer, ov.cover.buffer);
    let hcopy = null;
    if (keepHeights) { hcopy = heights; transfer.push(hcopy.buffer); }
    self.postMessage(
      { id, ok: true, positions, indices, centre, nw, size: tileSizeMerc(z),
        heights: hcopy, mask: ov && ov.mask, cover: ov && ov.cover },
      transfer
    );
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message || e) });
  }
};
}
