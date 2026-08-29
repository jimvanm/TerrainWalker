// All tunables live here.

export const BUILD = '0.3.0';

export const TILE_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

// Clipmap levels, finest first. Each level is a 4x4 block of tiles snapped to
// even tile coordinates, so a finer block always covers exactly 2x2 tiles of
// the level below it. That exact nesting is what lets us cull without gaps.
// `grid` is the number of quads per tile edge.
export const LEVELS = [
  { z: 12, grid: 128 },
  { z: 11, grid: 64 },
  { z: 10, grid: 32 },
  { z: 9, grid: 32 },
  { z: 8, grid: 32 },
  { z: 7, grid: 32 },
  // Coarse horizon rings. Only loaded when altitude needs them, but without
  // them the world runs out before the curve hides it and you see a hard edge.
  // Worst case is high latitude: at 76N a Mercator tile covers cos(76) = 0.24
  // of the ground it does at the equator, so the rings must reach much further.
  { z: 6, grid: 32 },
  { z: 5, grid: 32 },
  { z: 4, grid: 32 },
];

export const SKIRT = 150;            // metres each tile edge drops, hides LOD cracks
export const EYE_HEIGHT = 1.7;
export const WALK_SPEED = 5.6;
export const FLY_SPEED = 60;         // base, adjustable with the wheel
export const FLY_BOOST = 8;
export const GROUND_SMOOTH = 12;     // higher = snappier ground following
export const DOUBLE_TAP_MS = 450;
export const MOUSE_SENS = 0.0022;

export const WORKERS = 3;
export const MAX_INFLIGHT = 6;       // be polite to a free public endpoint
export const CACHE_TILES = 512;

export const FOV = 68;
export const NEAR = 0.5;

const SPAWN = { lat: 46.5590, lon: 7.9310, alt: null, yaw: 155, pitch: -6, fly: 0 };

export function readHash() {
  const c = { ...SPAWN, levels: LEVELS.length };
  const h = new URLSearchParams(location.hash.slice(1));
  const num = (k, lo, hi) => {
    if (!h.has(k)) return null;
    const v = parseFloat(h.get(k));
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null;
  };
  const lat = num('lat', -85, 85); if (lat !== null) c.lat = lat;
  const lon = num('lon', -180, 180); if (lon !== null) c.lon = lon;
  const alt = num('alt', -500, 80000); if (alt !== null) c.alt = alt;
  const yaw = num('yaw', -3600, 3600); if (yaw !== null) c.yaw = yaw;
  const pit = num('pitch', -89, 89); if (pit !== null) c.pitch = pit;
  // Deliberately NOT read from the hash: a saved link would otherwise pin an
  // old, smaller level count and silently cap the horizon forever.
  if (h.get('mode') === 'fly') c.fly = 1;
  return c;
}

export function writeHash(cam) {
  const p = new URLSearchParams();
  p.set('lat', cam.lat.toFixed(5));
  p.set('lon', cam.lon.toFixed(5));
  p.set('alt', cam.alt.toFixed(0));
  p.set('yaw', ((cam.yaw * 180 / Math.PI) % 360).toFixed(1));
  p.set('pitch', (cam.pitch * 180 / Math.PI).toFixed(1));

  if (cam.fly) p.set('mode', 'fly');
  history.replaceState(null, '', '#' + p.toString());
}
