// K: a report on building heights (how much of the data is real and how much
// is a guess) for both building layers, plus where you are. Copied to the
// clipboard, logged, and left on window.twReport.

import { lookLabel } from '../look.js';
import { mercScale } from '../geo.js';

export function heightReport(cam, near, sky, landmarks) {
  const rep = {
    at: { lat: +cam.lat.toFixed(5), lon: +cam.lon.toFixed(5), alt: Math.round(cam.alt) },
    colours: lookLabel(),
    near: near.report(cam.mercX, cam.mercY), sky: sky.report(cam.mercX, cam.mercY),
    skyStatus: sky.status, nearStatus: near.status,
    landmarks: landmarks.report(cam.mercX, cam.mercY, mercScale(cam.lat)),
    landmarkOrientation: landmarks.orientation([near, sky].flatMap((nf) =>
      [...nf.tiles.values()].flatMap((t) => (t.stats && t.stats.outlines) || []))),
  };
  window.twReport = rep;
  const text = JSON.stringify(rep, null, 1);
  console.log(text);
  if (navigator.clipboard) navigator.clipboard.writeText(text).catch(() => {});
}
