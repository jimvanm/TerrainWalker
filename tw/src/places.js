// Saved places ("favourites"). Storage only, no page code, so config.js can ask
// for the start point and tests can run without a browser.
//
// Kept in localStorage: tiny, instant, survives restarts. Private windows and
// "clear site data" wipe it, same as the tile cache.

const KEY = 'tw.places';
const SEEDED = 'tw.places.seeded';

// Preloaded the first time only. All of them can be renamed or deleted.
// agl = height above ground in metres, so they are right whatever the terrain.
export const SEED = [
  { name: 'Lake Ontario (start)', lat: 43.871722, lon: -77.680430, alt: 2500, agl: null, yaw: 0, pitch: -8, fly: 1, start: true },
  { name: 'Shinjuku, Tokyo', lat: 35.6896, lon: 139.7006, alt: null, agl: 200, yaw: 0, pitch: -12, fly: 1 },
  { name: 'Downtown Toronto', lat: 43.6487, lon: -79.3817, alt: null, agl: 250, yaw: 0, pitch: -12, fly: 1 },
  { name: 'Midtown Manhattan', lat: 40.7549, lon: -73.9840, alt: null, agl: 250, yaw: 0, pitch: -12, fly: 1 },
];

const store = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };
const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

export function loadPlaces() {
  const s = store();
  if (!s) return SEED.map((p) => ({ ...p, id: newId() }));
  try {
    if (!s.getItem(SEEDED)) {
      s.setItem(KEY, JSON.stringify(SEED.map((p) => ({ ...p, id: newId() }))));
      s.setItem(SEEDED, '1');
    }
    const list = JSON.parse(s.getItem(KEY) || '[]');
    return Array.isArray(list) ? list.filter((p) => p && Number.isFinite(p.lat) && Number.isFinite(p.lon)) : [];
  } catch (e) { return []; }
}

export function savePlaces(list) {
  const s = store();
  if (!s) return false;
  try { s.setItem(KEY, JSON.stringify(list)); return true; } catch (e) { return false; }
}

export const startPlace = () => loadPlaces().find((p) => p.start) || null;

// view: { lat, lon, alt, agl, yaw, pitch, fly } with angles in degrees.
export function makePlace(view, name) {
  return {
    id: newId(), name,
    lat: +view.lat.toFixed(5), lon: +view.lon.toFixed(5),
    alt: Math.round(view.alt), agl: view.agl === null ? null : Math.round(view.agl),
    yaw: +view.yaw.toFixed(1), pitch: +view.pitch.toFixed(1), fly: view.fly ? 1 : 0,
  };
}

// Only one place can be the start point.
export function setStart(list, id) {
  const on = list.find((p) => p.id === id);
  const was = !!(on && on.start);
  for (const p of list) delete p.start;
  if (on && !was) on.start = true;
  return list;
}
