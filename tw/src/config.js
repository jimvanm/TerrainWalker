// All tunables live here.

// The version in the status bar. Goes up by one with every change sent, so
// what you are running can be told apart at a glance.
export const BUILD = '0.13.25';

// Resolved at runtime to a {z}/{x}/{y} template. Never hardcode the tile URL:
// the style points at a TileJSON, and that indirection is how the service is
// allowed to move its tiles.
export const VECTOR_TILEJSON = 'https://tiles.openfreemap.org/planet';
export const VECTOR_MAXZOOM = 14;

export const TILE_URL =
  'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';

// Clipmap levels, finest first. Each level is a 4x4 block of tiles snapped to
// even tile coordinates, so a finer block always covers exactly 2x2 tiles of
// the level below it. That exact nesting is what lets us cull without gaps.
// `grid` is the number of quads per tile edge.
export const LEVELS = [
  // Close-up levels: fetched only while the real roads and buildings are on
  // (low down, see detail.js), because they drape on this ground. Where the
  // height data is better than 30 m (the US, Arctic, Norway, New Zealand...)
  // these show cliffs and gorges that zoom 12 smooths away. Elsewhere they are
  // enlarged copies of zoom 12 and cost a little bandwidth for nothing.
  //
  // The two finest are `place` levels: fetched only where a place of interest
  // has its own tiles (places/, src/placetiles.js). Elsewhere nothing is
  // fetched for them and zoom 14 is drawn in their stead.
  { z: 16, grid: 128, close: true, place: true },
  { z: 15, grid: 128, close: true, place: true },
  { z: 14, grid: 128, close: true },
  { z: 13, grid: 128, close: true },
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
// Flight speed follows altitude, which keeps ANGULAR rate roughly constant:
// the ground sweeps beneath you at the same degrees per second at 300 m and at
// 400 km. That is what the eye actually measures; nobody perceives m/s.
//
//   cruise = FLY_K * max(agl, FLY_FLOOR)
//
// Calibrated against two anchors that agree: ~270 km/h cruise and ~1080 km/h
// boosted at ground level, and a few hundred km/s in orbit. Aircraft altitude
// deliberately comes out far faster than a real aircraft — real cruise at 10 km
// is a boring experience however impressive the number.
//
// The floor matters as much as the ratio: pure proportionality would give
// 1.6 m/s at head height. Below a few hundred metres you stop looking at your
// feet and start looking at the middle distance, so speed stops shrinking.
export const FLY_K = 0.25;
export const FLY_FLOOR = 300;
export const FLY_BOOST = 4;
export const FLY_MULT_MIN = 0.1;
export const FLY_MULT_MAX = 50;
// Wheel also scales walking speed, which makes a 'driving' mode when glued to the ground.
export const WALK_MULT_MIN = 0.25;
export const WALK_MULT_MAX = 100;
export const GROUND_SMOOTH = 12;     // higher = snappier ground following
export const DOUBLE_TAP_MS = 450;
export const MOUSE_SENS = 0.0022;

// Near field: real road/building geometry for a 3x3 block of fine map tiles.
export const NF_Z = 14;              // map tile zoom (deepest the service serves)
export const NF_WORKERS = 4;
export const NF_MAX_AGL = 4000;      // real roads draw below this height above ground
export const NF_MAX_SPEED = 2000;    // ...but only FETCH new tiles below this horizontal speed (m/s)
// Terrain loading is centred this many seconds ahead along the direction of travel.
export const LEAD_SECONDS = 3;

// Far skyline: zoom-13 tiles out to this many tiles (about 3.5 km each) from the
// camera, buildings only, and only ones known to be at least this tall (metres).
export const SKY_RADIUS = 7;
export const SKY_MIN_HEIGHT = 50;
// A zoom-13 tile is "built-up" enough to be worth fetching the finer tiles under
// it when buildings cover this fraction of it (or, if the tile lists no
// buildings at all, when built-up land use covers SKY_URBAN_BUILT of it).
export const SKY_URBAN = 0.10;
export const SKY_URBAN_BUILT = 0.25;

export const WORKERS = 3;
// Each job now makes two fetches (elevation + vector) against two different
// hosts, so 6 jobs meant only 3 elevation requests in flight and load times
// roughly doubled. 10 keeps both services comfortable.
export const MAX_INFLIGHT = 10;
export const CACHE_TILES = 800;

// Saved raw downloads (see cache.js). Turn off to always fetch fresh.
export const CACHE_ON = true;
export const CACHE_MAX_ENTRIES = 20000;
export const CACHE_MAX_DAYS = 30;

export const FOV = 68;
export const NEAR = 0.5;

// Lake Ontario, facing north toward the Prince Edward County shore. Chosen to
// land you on water, since a lake at 74 m is exactly what an elevation ramp
// cannot render and the vector overlay can.
import { startPlace } from './places.js';
import { wrapLon } from './geo.js';

const SPAWN = { lat: 43.871722, lon: -77.680430, alt: 2500, yaw: 0, pitch: -8, fly: 1 };

export function readHash() {
  // Start point: the place you starred, else the built-in lake spawn.
  const sp = startPlace();
  const c = { ...SPAWN, agl: null, levels: LEVELS.length };
  if (sp) {
    c.lat = sp.lat; c.lon = sp.lon; c.yaw = sp.yaw; c.pitch = sp.pitch; c.fly = sp.fly ? 1 : 0;
    if (sp.agl !== null && sp.agl !== undefined) { c.agl = sp.agl; c.alt = null; }
    else if (sp.alt !== null && sp.alt !== undefined) c.alt = sp.alt;
  }
  const h = new URLSearchParams(location.hash.slice(1));
  const num = (k, lo, hi) => {
    if (!h.has(k)) return null;
    const v = parseFloat(h.get(k));
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : null;
  };
  const lat = num('lat', -85, 85); if (lat !== null) c.lat = lat;
  // Wrapped, not clamped: a link from before longitudes were wrapped can say
  // 244.4 for -115.6, and clamping that put you in the Pacific at 180.
  const lon = num('lon', -1e6, 1e6); if (lon !== null) c.lon = wrapLon(lon);
  const alt = num('alt', -500, 80000); if (alt !== null) { c.alt = alt; c.agl = null; }
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
