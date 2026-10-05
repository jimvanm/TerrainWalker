// K: a report on building heights (how much of the data is real and how much
// is a guess) for both building layers, plus where you are. Copied to the
// clipboard, logged, and left on window.twReport.

import { lookLabel } from '../look.js';
import { placeNames, hasPlaceTile } from '../placetiles.js';

export function heightReport(cam, near, sky, landmarks, terrain) {
  const g = terrain && terrain.groundAt(cam.mercX, cam.mercY);
  const rep = {
    at: { lat: +cam.lat.toFixed(5), lon: +cam.lon.toFixed(5), alt: Math.round(cam.alt) },
    // The ground under you: its height, the zoom it came from, and whether
    // that tile is a place of interest's own.
    ground: g ? { h: +g.h.toFixed(1), z: g.z, place: hasPlaceTileAt(g.z, cam) } : null,
    places: placeNames(),
    colours: lookLabel(),
    near: near.report(cam.mercX, cam.mercY), sky: sky.report(cam.mercX, cam.mercY),
    skyStatus: sky.status, nearStatus: near.status,
    landmarks: landmarks.report(),
    landmarkOrientation: landmarks.orientation([near, sky].flatMap((nf) =>
      [...nf.tiles.values()].flatMap((t) => (t.stats && t.stats.outlines) || []))),
    landmarkMasks: maskReport([near, sky]),
  };
  window.twReport = rep;
  const text = JSON.stringify(rep, null, 1);
  console.log(text);
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
}

// Per landmark: how many map buildings its mask hid, how many tiles had its
// outline (footprint) and how many only its circle, and the map buildings
// within 300 m it did NOT hide, nearest first.
function maskReport(layers) {
  const out = {};
  const get = (id) => out[id] || (out[id] = { hidden: 0, tilesWithFootprint: 0, tilesCircleOnly: 0, notHidden: [] });
  for (const L of layers) for (const t of L.tiles.values()) {
    const st = t.stats;
    if (!st) continue;
    for (const m of st.maskInfo || []) { const r = get(m.id); if (m.footprint) r.tilesWithFootprint++; else r.tilesCircleOnly++; }
    for (const o of st.outlines || []) get(o.id).hidden++;
    for (const n of st.nearMisses || []) {
      const r = get(n.id), { id, ...rest } = n;
      if (!r.notHidden.some((q) => Math.abs(q.east - n.east) < 3 && Math.abs(q.north - n.north) < 3)) r.notHidden.push(rest);
    }
  }
  for (const r of Object.values(out)) {
    r.notHidden.sort((a, b) => Math.hypot(a.east, a.north) - Math.hypot(b.east, b.north));
    r.notHidden = r.notHidden.slice(0, 12).map((q) => ({ ...q, m: Math.round(Math.hypot(q.east, q.north)) }));
  }
  return out;
}

function hasPlaceTileAt(z, cam) {
  const n = 2 ** z, x = Math.floor((cam.lon + 180) / 360 * n);
  const r = cam.lat * Math.PI / 180;
  const y = Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * n);
  return hasPlaceTile(z, x, y);
}
