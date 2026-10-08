// Canada's map grid (for HRDEM), against the standard projection library.
import { toCanadaAtlas } from '../src/lcc.js';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };
for (const [lon, lat, x, y, name] of [[-77.7765, 44.3716, 1383908.449, -331049.85, 'Healey Falls'],
  [-79.38, 43.65, 1277733.692, -443862.289, 'Toronto'], [-123.1, 49.28, -1976587.156, 474973.888, 'Vancouver']]) {
  const [px, py] = toCanadaAtlas(lon, lat);
  ok(Math.hypot(px - x, py - y) < 2, `${name}: within 2 m (${(Math.hypot(px - x, py - y)).toFixed(2)} m)`);
}
console.log('lcc ok');
