// Paints a map tile's water, roads, built-up areas and land cover into two small
// images (see rasterOverlays). Shared by the tile worker, which paints each
// terrain tile, and by the city mover (city.js), which paints a moved piece.
// Needs OffscreenCanvas, so it runs in a helper or a browser page.

import { POLYGON, LINESTRING } from './mvt.js';

export const MASK = 256;   // water mask resolution, independent of mesh density

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
//   mask  RGBA - R water, G roads (also railways and airport pavement), B built-up, A land-cover coverage
//   cover RGB  - land-cover colour
// Channels rather than one composited image, so a layer can be switched off
// with a uniform instead of a refetch and a re-rasterise.
// mPerPx: true metres per mask pixel, so airport widths come out right.
// sub: paint only part of the map tile, enlarged: { s, ox, oy } is the part's
// size (1/s of the tile) and position (in parts). Used for tiles finer than
// the map service's deepest zoom. mPerPx is then the map tile's, since line
// widths are enlarged with everything else.
export function rasterOverlays(layers, mPerPx = 10, sub = null) {
  const maskCv = new OffscreenCanvas(MASK, MASK);
  const mx = maskCv.getContext('2d', { willReadFrequently: true });
  mx.fillStyle = '#000';
  mx.fillRect(0, 0, MASK, MASK);
  const zoomIn = (cx) => { if (sub) cx.setTransform(sub.s, 0, 0, sub.s, -sub.ox * MASK, -sub.oy * MASK); };
  zoomIn(mx);
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
    // 70% red, not full: the terrain shader cuts holes for flat water only
    // where water areas are (full red), never under these lines.
    mx.strokeStyle = '#b40000';
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
      if (f.props && f.props.brunnel === 'tunnel' && (f.cls === 'rail' || f.cls === 'transit')) continue;
      const major = f.cls === 'motorway' || f.cls === 'trunk' || f.cls === 'primary';
      // Railways count like secondary roads; sidings, yards and trams are left
      // to the near field, as minor roads are.
      const rail = f.cls === 'rail' && !(f.props && (f.props.service || (f.props.subclass && f.props.subclass !== 'rail')));
      if (!major && !rail && f.cls !== 'secondary' && f.cls !== 'tertiary') continue;
      mx.lineWidth = major ? 1.4 : 0.7;
      mx.beginPath(); path(mx, f.parts, k, false); mx.stroke();
    }
  }
  // Airport pavement goes in the road channel too, so runways show from afar.
  const ae = layers.aeroway;
  if (ae) {
    const k = MASK / ae.extent;
    mx.fillStyle = '#0f0';
    mx.beginPath();
    for (const f of ae.features) {
      if (f.type === POLYGON && (f.cls === 'runway' || f.cls === 'taxiway' || f.cls === 'apron' || f.cls === 'helipad')) path(mx, f.parts, k, true);
    }
    mx.fill('nonzero');
    for (const f of ae.features) {
      if (f.type !== LINESTRING || (f.cls !== 'runway' && f.cls !== 'taxiway')) continue;
      mx.lineWidth = Math.max(0.7, (f.cls === 'runway' ? 45 : 20) / mPerPx);
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
  zoomIn(cxx);
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
