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

// Kept survey blocks: heights come from the right block and pixel.
import { SurveyBlocks, gridMapper } from '../src/hrdemsource.js';
{
  const img = { getTileWidth: () => 4, getTileHeight: () => 4 };
  const survey = { ox: 100, oy: 200, nodata: -9999, levels: [{ img, cell: 1, prx: 1, pry: -1, W: 8, H: 8 }] };
  const b = new SurveyBlocks(survey);
  for (let by = 0; by < 2; by++) for (let bx = 0; bx < 2; bx++) {
    const a = new Float32Array(16); a.tw = 4; a.th = 4;
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) a[j * 4 + i] = (bx * 4 + i) + 10 * (by * 4 + j);
    b.blocks.set(b._key(0, bx, by), a);
  }
  // pixel (i, j) covers X 100+i..101+i, Y 200-j..199-j; its middle reads exactly i + 10 j
  ok(b.at(0, 100 + 5.5, 200 - 6.5) === 5 + 60, 'a pixel middle in another block reads its own value');
  ok(Math.abs(b.at(0, 100 + 4, 200 - 4.5) - (3.5 + 40)) < 1e-9, 'between blocks, the four nearest pixels are blended');
  ok(Number.isNaN(b.at(0, 100 + 20, 200 - 1)), 'outside the kept blocks: no height');
  const map = gridMapper((x, z) => [x * 2 + z * 0.1, -z + x * x * 1e-6], 0, 0, 500), [X, Y] = map(123, -77);
  ok(Math.abs(X - (246 - 7.7)) < 1e-6 && Math.abs(Y - (77 + 123 * 123 * 1e-6)) < 2e-3, 'the lattice mapper follows a gently curving grid (to a millimetre)');
}
