import { despike, decodeTerrarium, pxMetersFor, PX } from '../src/heightgrid.js';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };
const make = (f) => { const h = new Float32Array(PX * PX); for (let y = 0; y < PX; y++) for (let x = 0; x < PX; x++) h[y * PX + x] = f(x, y); return h; };
const px12 = pxMetersFor(12, 1788);
ok(px12 > 30 && px12 < 40, 'a z12 tile near Hong Kong is about 35 m per pixel (' + px12.toFixed(1) + ')');

// 1. a single wild pixel on flat ground goes away
let h = make(() => 5); h[100 * PX + 100] = 4000;
ok(despike(h, px12) === 1 && h[100 * PX + 100] === 5, 'a lone 4000 m spike is removed');
// 2. a lone pit
h = make(() => 50); h[30 * PX + 40] = -3000;
despike(h, px12); ok(h[30 * PX + 40] === 50, 'a lone deep pit is removed');
// 3. a 2x2 spike
h = make(() => 10); for (const [a, b] of [[60, 60], [61, 60], [60, 61], [61, 61]]) h[b * PX + a] = 3500;
despike(h, px12); ok(h[60 * PX + 60] === 10 && h[61 * PX + 61] === 10, 'a 2x2 spike is removed');
// 4. a steep real mountain (slope 1.2, 56 degrees) is untouched, summit included
const cone = (x, y) => Math.max(0, 900 - 1.2 * px12 * Math.hypot(x - 128, y - 128));
h = make(cone); const before = Float32Array.from(h);
ok(despike(h, px12) === 0 && h.every((v, i) => v === before[i]), 'a steep real peak keeps its summit');
// 5. a sheer 600 m cliff face is untouched
h = make((x) => x < 128 ? 0 : 600); const b2 = Float32Array.from(h);
ok(despike(h, px12) === 0 && h.every((v, i) => v === b2[i]), 'a 600 m cliff is untouched');
// 6. spike sitting on a real mountain slope is still caught
h = make(cone); h[128 * PX + 70] += 3000;
ok(despike(h, px12) >= 1 && h[128 * PX + 70] < 1000, 'a spike on a mountainside is still caught');
// 7. coarse tile (z6, ~2.4 km pixels): a Fuji-like summit is untouched
const px6 = pxMetersFor(6, 25);
h = make((x, y) => 1000 + (x === 100 && y === 100 ? 2800 : 0)); const b3 = Float32Array.from(h);
ok(despike(h, px6) === 0, 'at coarse zoom a 2800 m summit pixel is left alone');
// 8. decode path runs the filter
const rgba = new Uint8ClampedArray(PX * PX * 4);
for (let i = 0; i < PX * PX; i++) { const e = 32768 + 5; rgba[4 * i] = e >> 8; rgba[4 * i + 1] = e & 255; }
const sp = 100 * PX + 100, e2 = 32768 + 4000; rgba[4 * sp] = e2 >> 8; rgba[4 * sp + 1] = e2 & 255;
ok(decodeTerrarium(rgba, px12)[sp] === 5 && decodeTerrarium(rgba)[sp] === 4000, 'decode removes it when given a pixel size, and still works without one');
// speed
h = make((x, y) => 200 + 80 * Math.sin(x / 9) * Math.cos(y / 7)); const t = performance.now(); despike(h, px12);
console.log('    (rolling terrain, ' + (performance.now() - t).toFixed(1) + ' ms)');
console.log('despike ok');
