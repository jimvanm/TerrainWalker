// Canada's map grid (for HRDEM), against the standard projection library.
import { toCanadaAtlas } from '../src/lcc.js';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };
for (const [lon, lat, x, y, name] of [[-77.7765, 44.3716, 1383908.449, -331049.85, 'Healey Falls'],
  [-79.38, 43.65, 1277733.692, -443862.289, 'Toronto'], [-123.1, 49.28, -1976587.156, 474973.888, 'Vancouver']]) {
  const [px, py] = toCanadaAtlas(lon, lat);
  ok(Math.hypot(px - x, py - y) < 2, `${name}: within 2 m (${(Math.hypot(px - x, py - y)).toFixed(2)} m)`);
}
console.log('lcc ok');

// The ground labs place every point exactly (no straight-line shortcut).
import { localToGrid, localToLatLon } from '../src/hrdemsource.js';
{
  const lat = 45.42426, lon = -75.69571, fit = localToGrid(lat, lon);
  let worst = 0;
  for (const [x, z] of [[2000, 2000], [-2000, 2000], [4000, -4000], [-8000, 0]]) {
    const [la, lo] = localToLatLon(lat, lon, x, z), [X, Y] = toCanadaAtlas(lo, la), [fx, fy] = fit(x, z);
    worst = Math.max(worst, Math.hypot(X - fx, Y - fy));
  }
  ok(worst < 1e-6, 'local metres to the grid are exact, out to 8 km');
}
