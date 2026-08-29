// Web Mercator / tile coordinate maths.
// All "merc" values are EPSG:3857 metres. Multiply by cos(latitude) for true ground metres.

export const R_MAJOR = 6378137;                 // Web Mercator sphere radius
export const R_MEAN = 6371000;                  // used for horizon curvature
export const EQUATOR = 2 * Math.PI * R_MAJOR;   // 40075016.6856
export const HALF = EQUATOR / 2;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

export function lonToMercX(lon) {
  return R_MAJOR * lon * D2R;
}

export function latToMercY(lat) {
  const phi = Math.max(-85.05112878, Math.min(85.05112878, lat)) * D2R;
  return R_MAJOR * Math.log(Math.tan(Math.PI / 4 + phi / 2));
}

export function mercXToLon(x) {
  return (x / R_MAJOR) * R2D;
}

export function mercYToLat(y) {
  return (2 * Math.atan(Math.exp(y / R_MAJOR)) - Math.PI / 2) * R2D;
}

// Width of one tile at this zoom, in mercator metres (square).
export function tileSizeMerc(z) {
  return EQUATOR / Math.pow(2, z);
}

// Fractional tile coordinates. Origin is the north-west corner of the world.
export function mercToTile(mx, my, z) {
  const s = tileSizeMerc(z);
  return { x: (mx + HALF) / s, y: (HALF - my) / s };
}

// North-west corner of tile (tx, ty) in mercator metres.
export function tileToMerc(tx, ty, z) {
  const s = tileSizeMerc(z);
  return { x: tx * s - HALF, y: HALF - ty * s };
}

// Centre of tile (tx, ty) in mercator metres.
export function tileCentreMerc(tx, ty, z) {
  const s = tileSizeMerc(z);
  return { x: (tx + 0.5) * s - HALF, y: HALF - (ty + 0.5) * s };
}

// Mercator-to-true-ground-metre scale factor at a given latitude.
export function mercScale(lat) {
  return Math.cos(lat * D2R);
}
