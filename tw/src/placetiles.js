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
import { settings } from './settings.js';
import { tileCentreMerc, mercXToLon, mercYToLat } from './geo.js';

// Canada's laser survey (surveytile.js): with settings.survey on, tiles from
// zoom 13 to 16 inside Canada are built from it in the helpers, asked for as
// "hrdem:z/x/y". Where it has no data the helper uses the usual tile.
export const SURVEY_PREFIX = 'hrdem:';
export const SURVEY_MIN_Z = 13;
let surveyGen = 0;
// Goes up each time the survey is switched, so tiles built the old way can be
// recognised and dropped.
export const surveyGeneration = () => surveyGen;
export const bumpSurveyGeneration = () => ++surveyGen;

// Roughly southern Canada and the North: the survey's catalogue decides
// exactly, and a helper finding nothing falls back to the usual tile. West of
// Lake of the Woods the border is the 49th parallel.
export function inSurveyArea(z, x, y) {
  const c = tileCentreMerc(x, y, z), lat = mercYToLat(c.y), lon = mercXToLon(c.x);
  if (lat < 41.6 || lat > 84 || lon < -141.1 || lon > -52) return false;
  if (lon < -95.2 && lat < 48.95) return false;
  return true;
}
const surveyed = (z, x, y) => settings.survey && z >= SURVEY_MIN_Z && inSurveyArea(z, x, y);

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

// A tile for one of the finest levels (zoom 15 and 16): a place's own, or,
// with the survey on, anywhere in Canada.
export const hasPlaceTile = (z, x, y) => tiles.has(z + '/' + x + '/' + y) || surveyed(z, x, y);

// The elevation tile to fetch for z/x/y: the place's own, or the usual one.
export function elevationUrl(z, x, y) {
  return tiles.get(z + '/' + x + '/' + y) ||
    (surveyed(z, x, y) ? SURVEY_PREFIX + z + '/' + x + '/' + y : plainElevationUrl(z, x, y));
}

// The usual tile, never the survey (for code that reads tiles on the page).
export const plainElevationUrl = (z, x, y) => TILE_URL.replace('{z}', z).replace('{x}', x).replace('{y}', y);

export const placeNames = () => names.slice();
