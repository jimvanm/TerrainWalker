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

// Rasterise the OpenMapTiles water polygons and waterway lines into a
// single-channel mask. Vectors travel over the wire; pixels are materialised
// here, at load time, and never stored or transmitted.
function rasterWater(layers) {
  const cv = new OffscreenCanvas(MASK, MASK);
  const cx = cv.getContext('2d', { willReadFrequently: true });
  cx.fillStyle = '#000';
  cx.fillRect(0, 0, MASK, MASK);
  cx.fillStyle = '#fff';
  cx.strokeStyle = '#fff';
  cx.lineCap = 'round';
  cx.lineJoin = 'round';

  const w = layers.water;
  if (w) {
    const k = MASK / w.extent;
    // Nonzero fill plus MVT winding (exterior clockwise, holes anticlockwise)
    // gives island and lake-in-island holes for free.
    cx.beginPath();
    for (const f of w.features) {
      if (f.type !== POLYGON) continue;
      for (const ring of f.parts) {
        cx.moveTo(ring[0] * k, ring[1] * k);
        for (let i = 2; i < ring.length; i += 2) cx.lineTo(ring[i] * k, ring[i + 1] * k);
        cx.closePath();
      }
    }
    cx.fill('nonzero');
  }

  const ww = layers.waterway;
  if (ww) {
    const k = MASK / ww.extent;
    // Rivers are narrower than a 30 m DEM cell, so they cannot be carved into
    // the terrain. Drawing them is what a sectional chart does anyway.
    for (const f of ww.features) {
      if (f.type !== LINESTRING) continue;
      cx.lineWidth = f.cls === 'river' ? 1.8 : 0.9;
      cx.beginPath();
      for (const ln of f.parts) {
        cx.moveTo(ln[0] * k, ln[1] * k);
        for (let i = 2; i < ln.length; i += 2) cx.lineTo(ln[i] * k, ln[i + 1] * k);
      }
      cx.stroke();
    }
  }

  const src = cx.getImageData(0, 0, MASK, MASK).data;
  const out = new Uint8Array(MASK * MASK);
  for (let i = 0, p = 0; i < out.length; i++, p += 4) out[i] = src[p];
  return out;
}

async function loadVector(url) {
  const res = await fetch(url, { mode: 'cors' });
  if (res.status === 404 || res.status === 204) return null;   // no data here
  if (!res.ok) throw new Error('vector HTTP ' + res.status);
  const buf = new Uint8Array(await res.arrayBuffer());
  if (buf.length === 0) return null;
  return rasterWater(decodeMVT(buf, ['water', 'waterway']));
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
    const [heights, water] = await Promise.all([
      loadTile(url),
      vurl ? loadVector(vurl).catch(() => null) : Promise.resolve(null),
    ]);
    const { positions, indices } = buildMesh(heights, z, grid);
    const centre = tileCentreMerc(x, y, z);
    const nw = tileToMerc(x, y, z);
    const transfer = [positions.buffer, indices.buffer];
    if (water) transfer.push(water.buffer);
    let hcopy = null;
    if (keepHeights) { hcopy = heights; transfer.push(hcopy.buffer); }
    self.postMessage(
      { id, ok: true, positions, indices, centre, nw, size: tileSizeMerc(z),
        heights: hcopy, water },
      transfer
    );
  } catch (e) {
    self.postMessage({ id, ok: false, error: String(e && e.message || e) });
  }
};
}
