// The list of landmarks: landmarks/index.json names the folders, and each
// folder's landmark.json says what and where. Used by the page (landmarks.js)
// and by the map-tile helpers (nearworker.js), which hide the ordinary map
// building under each landmark.
//
// The list is small (a few hundred bytes per landmark) and is read once. The
// shapes (model.json, 50-300 KB each) are read only when needed: loadModel().
//
// A landmark whose files are missing or broken is left out with a warning; it
// never stops the app.

const ROOT = new URL('../landmarks/', import.meta.url);

let listPromise = null;

export function loadList() {
  if (!listPromise) listPromise = readList().catch((e) => {
    console.warn('landmarks: could not read the list:', e.message);
    return [];
  });
  return listPromise;
}

async function readJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(url + ': HTTP ' + res.status);
  return res.json();
}

async function readList() {
  const ids = await readJson(new URL('index.json', ROOT));
  if (!Array.isArray(ids)) throw new Error('index.json must be a list of folder names');
  const all = await Promise.all(ids.map(async (id) => {
    try {
      return check(id, await readJson(new URL(id + '/landmark.json', ROOT)));
    } catch (e) {
      console.warn('landmarks: left out "' + id + '": ' + e.message);
      return null;
    }
  }));
  return all.filter(Boolean);
}

// The fields every landmark.json must have, so a typo is reported by name
// rather than showing up as a tower in the wrong place.
export function check(id, L) {
  const num = (k) => { if (typeof L[k] !== 'number' || !Number.isFinite(L[k])) throw new Error(k + ' must be a number'); };
  if (typeof L.name !== 'string' || !L.name) throw new Error('name is missing');
  ['lat', 'lon', 'height', 'maskR'].forEach(num);
  if (Math.abs(L.lat) > 85 || Math.abs(L.lon) > 180) throw new Error('lat/lon is off the map');
  return { id, yawDeg: 0, fold: 0, oval: false, ...L };
}

// A landmark's shape: { tris, pos, col, idx }. Metres, y up, x east, z south.
export function loadModel(id) {
  return readJson(new URL(id + '/model.json', ROOT));
}
