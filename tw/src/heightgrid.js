// Elevation decoding and the exact terrain-mesh height function.
//
// Shared by the tile worker (which builds the terrain mesh) and the near-field
// worker (which drapes roads and buildings on it). One copy, so the two can
// never disagree about where the ground is.

export const PX = 256;      // terrarium tile size in pixels
export const GRID = 128;    // quads per edge of the finest terrain mesh level
export const COARSE = 32;   // quads per edge of each terrain tile's small height copy

// Ground metres covered by one pixel of the elevation tile (z, y).
export function pxMetersFor(z, y) {
  const n = Math.pow(2, z);
  const lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / n)));
  return (40075016.68 / n) * Math.cos(lat) / PX;
}

// pxMeters (optional) turns on spike removal; see despike().
export function decodeTerrarium(rgba, pxMeters) {
  const h = new Float32Array(PX * PX);
  for (let i = 0, p = 0; i < h.length; i++, p += 4) {
    h[i] = rgba[p] * 256 + rgba[p + 1] + rgba[p + 2] / 256 - 32768;
  }
  if (pxMeters) despike(h, pxMeters);
  return h;
}

// The elevation data has stray single points thousands of metres wrong, mostly
// near coasts. A real summit is broad: its neighbours climb toward it. A spike
// is narrow: its neighbours sit flat and it alone is far off.
//
// A pixel is replaced by its 5x5 median only when BOTH hold:
//   - it is off that median by more than the steepest sensible rise over a few
//     pixels (never less than 120 m, and growing with pixel size so coarse
//     tiles leave mountains alone), and
//   - it is off by more than 3x the spread of its neighbourhood. A steep real
//     slope or a cliff has a wide spread, so it is protected.
// Returns how many pixels were fixed.
export function despike(h, pxMeters) {
  const T = Math.max(120, 4 * pxMeters);
  const win = new Float32Array(25);
  const at = (x, y) => h[Math.max(0, Math.min(PX - 1, y)) * PX + Math.max(0, Math.min(PX - 1, x))];
  let fixed = 0;
  for (let y = 0; y < PX; y++) {
    for (let x = 0; x < PX; x++) {
      const v = h[y * PX + x];
      const avg4 = (at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1)) / 4;
      if (Math.abs(v - avg4) < T) continue;           // the cheap common case
      let k = 0;
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) win[k++] = at(x + dx, y + dy);
      win.sort();
      const med = win[12], iqr = win[18] - win[6], off = Math.abs(v - med);
      if (off > T && off > 3 * iqr) { h[y * PX + x] = med; fixed++; }
    }
  }
  return fixed;
}

// Bilinear sample of the 256x256 grid at fractional pixel coordinates.
export function sample(h, fx, fy) {
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

// Heights at the (N+1)x(N+1) mesh nodes, exactly as buildMesh places them.
export function meshNodes(heights, N = GRID) {
  const V = N + 1;
  const out = new Float32Array(V * V);
  for (let j = 0; j < V; j++) {
    for (let i = 0; i < V; i++) {
      out[j * V + i] = sample(heights, (i / N) * (PX - 1), (j / N) * (PX - 1));
    }
  }
  return out;
}

// Height of the rendered terrain surface at tile-fractional (u, v), both 0..1,
// v running south. The mesh splits every cell into triangles (a,c,b) and
// (b,c,d), so the diagonal runs b-c and a point has to be interpolated on the
// triangle it actually falls in. Plain bilinear would float or bury anything
// draped on a slope by up to a metre or two.
export function nodeHeightAt(nodes, u, v, N = GRID) {
  const V = N + 1;
  const fu = Math.max(0, Math.min(N, u * N));
  const fv = Math.max(0, Math.min(N, v * N));
  const i = Math.min(N - 1, Math.floor(fu));
  const j = Math.min(N - 1, Math.floor(fv));
  const tx = fu - i, ty = fv - j;
  const a = nodes[j * V + i], b = nodes[j * V + i + 1];
  const c = nodes[(j + 1) * V + i], d = nodes[(j + 1) * V + i + 1];
  if (tx + ty <= 1) return a + (b - a) * tx + (c - a) * ty;
  return d + (c - d) * (1 - tx) + (b - d) * (1 - ty);
}
