// Places of interest: areas with their own, more detailed terrain tiles, built
// from laser-survey data by tools/places/build_place.py (see places/README.md).
// Not to be confused with places.js, which is the saved places (favourites).
//
// At start the app reads places/index.json and each place's place.json, which
// lists the tiles it has. From then on elevationUrl() gives the place's tile
// wherever there is one, and the usual tile everywhere else. The terrain
// levels finer than zoom 15 (`place: true` in LEVELS) are fetched only where a
// place has tiles.

import { TILE_URL } from './config.js';

const tiles = new Map();     // 'z/x/y' -> url of the place's tile
const names = [];

// Reads the place lists. Never fails: a missing or broken place is left out,
// with a warning naming it, and the app carries on with the usual tiles.
export async function loadPlaceTiles(base = (typeof document !== 'undefined' ? document.baseURI : '')) {
  const get = async (path) => {
    const r = await fetch(new URL(path, base), { cache: 'no-cache' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  };
  let ids = [];
  try { ids = await get('places/index.json'); } catch (e) { return 0; }
  await Promise.all(ids.map(async (id) => {
    try {
      const p = await get(`places/${id}/place.json`);
      addPlace(id, p, base);
    } catch (e) {
      console.warn(`place "${id}" left out: no usable places/${id}/place.json (build it with tools/places/build_place.py)`);
    }
  }));
  return names.length;
}

// One place's tile list into the lookup. Separate so the tests can use it.
export function addPlace(id, place, base) {
  for (const [z, list] of Object.entries(place.tiles || {})) {
    for (const xy of list) {
      tiles.set(z + '/' + xy, new URL(`places/${id}/tiles/${z}/${xy}.png`, base).href);
    }
  }
  names.push(place.name || id);
}

export function clearPlaceTiles() { tiles.clear(); names.length = 0; }

export const hasPlaceTile = (z, x, y) => tiles.has(z + '/' + x + '/' + y);

// The elevation tile to fetch for z/x/y: the place's own, or the usual one.
export function elevationUrl(z, x, y) {
  return tiles.get(z + '/' + x + '/' + y) ||
    TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);
}

export const placeNames = () => names.slice();
