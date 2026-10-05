// The clipmap must tile exactly even mid-load, when only some finer tiles have
// arrived. This is the case that produced blinking squares: the coarse tile was
// dropped the moment the block shifted, before its replacement existed.
import { computeBlocks } from '../src/rings.js';
import { LEVELS } from '../src/config.js';
import * as g from '../src/geo.js';

const rnd = (a, b) => a + Math.random() * (b - a);
const rects = (tiles) => tiles.map((t) => {
  const s = g.tileSizeMerc(t.z);
  const x0 = t.rawX * s - g.HALF, y1 = g.HALF - t.rawY * s;
  return { x0, x1: x0 + s, y0: y1 - s, y1 };
});

let gaps = 0, overlaps = 0, checked = 0;
for (let trial = 0; trial < 300; trial++) {
  const lat = rnd(-70, 70), lon = rnd(-179, 179);
  const mx = g.lonToMercX(lon), my = g.latToMercY(lat);
  // Random partial load: each tile independently present with probability p.
  const p = rnd(0, 1);
  const seen = new Map();
  const isLoaded = (z, x, y) => {
    const k = z + '/' + x + '/' + y;
    if (!seen.has(k)) seen.set(k, Math.random() < p);
    return seen.get(k);
  };
  const tiles = computeBlocks(mx, my, LEVELS, isLoaded);
  const R = rects(tiles);
  const L = LEVELS.length - 1;
  const cs = tiles.filter((t) => t.level === L);
  if (!cs.length) continue;
  const s = g.tileSizeMerc(LEVELS[L].z);
  const X0 = Math.min(...cs.map((t) => t.rawX)) * s - g.HALF;
  const X1 = (Math.max(...cs.map((t) => t.rawX)) + 1) * s - g.HALF;
  const Y1 = g.HALF - Math.min(...cs.map((t) => t.rawY)) * s;
  const Y0 = g.HALF - (Math.max(...cs.map((t) => t.rawY)) + 1) * s;

  for (let n = 0; n < 250; n++) {
    const px = rnd(X0, X1), py = rnd(Y0, Y1);
    const hit = R.filter((r) => px >= r.x0 && px < r.x1 && py >= r.y0 && py < r.y1);
    checked++;
    if (hit.length === 0) gaps++;
    if (hit.length > 1) overlaps++;
  }
}
const R = [];
const ok = (c, m) => { R.push((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) process.exitCode = 1; };
ok(gaps === 0, `no holes during partial load (${gaps} of ${checked} sample points uncovered)`);
ok(overlaps === 0, `no coarse/fine overlap during partial load (${overlaps} double-covered)`);

// Nothing loaded at all: only the coarsest level should render, and it must
// still cover the whole area rather than vanishing.
{
  const mx = g.lonToMercX(-77.68), my = g.latToMercY(43.87);
  const none = computeBlocks(mx, my, LEVELS, () => false);
  const all = computeBlocks(mx, my, LEVELS, () => true);
  ok(none.every((t) => t.level === LEVELS.length - 1),
     `with nothing loaded, only the coarsest level draws (${none.length} tiles)`);
  ok(all.length === 16 + 12 * (LEVELS.length - 1),
     `with everything loaded, the full pyramid draws (${all.length} tiles)`);
  ok(computeBlocks(mx, my, LEVELS).length === all.length,
     'omitting the callback behaves as fully loaded (backwards compatible)');
}
console.log(R.join('\n'));

// The deadlock: a suppressed tile must still be REQUESTED, or it never loads,
// so the coarse stand-in is never released and the view never sharpens.
{
  const mx = g.lonToMercX(-79.21), my = g.latToMercY(43.37);
  const loaded = new Set();
  const isLoaded = (z, x, y) => loaded.has(z + '/' + x + '/' + y);
  const full = 16 + 12 * (LEVELS.length - 1);
  let steps = 0;
  // Simulate the real loop: fetch everything computeBlocks asks for with no
  // substitution, draw what the substituted call returns, repeat.
  for (; steps < 40; steps++) {
    const want = computeBlocks(mx, my, LEVELS);            // what we fetch
    for (const t of want) loaded.add(t.z + '/' + t.x + '/' + t.y);
    const draw = computeBlocks(mx, my, LEVELS, isLoaded);  // what we render
    if (draw.length === full) break;
  }
  ok(steps < 40, `converges to the full pyramid in ${steps + 1} pass(es), no deadlock`);
  ok(computeBlocks(mx, my, LEVELS).length === full,
     `the fetch list is always the full pyramid (${full} tiles), never substituted`);
}
console.log(R.slice(-2).join('\n'));

// Sustainable-detail selection: a level whose tiles are replaced faster than
// they can load must be dropped, or it thrashes forever.
{
  const k = Math.cos(39.63 * Math.PI / 180), LOAD_S = 2.5;
  const pick = (speed) => {
    let w = 0;
    while (w < LEVELS.length - 1 && g.tileSizeMerc(LEVELS[w].z) * k / speed < LOAD_S) w++;
    return w;
  };
  // [speed m/s, finest zoom worth fetching]; zooms, not level numbers, so
  // adding levels does not change what this checks.
  const cases = [[70, 16], [300, 15], [4000, 11], [20000, 9], [100000, 6]].map(([v, z]) => [v, LEVELS.findIndex((L) => L.z === z)]);
  let bad = 0;
  for (const [v, want] of cases) if (pick(v) !== want) { bad++; console.log(`  ${v} m/s -> level ${pick(v)}, expected ${want}`); }
  ok(bad === 0, 'finest sustainable zoom tracks speed (70 m/s 16, 300 m/s 15, 4 km/s 11, 100 km/s 6)');
  // Every retained level must survive at least one load time.
  let unsafe = 0;
  for (const v of [70, 300, 1000, 4000, 20000, 100000, 400000]) {
    const m = pick(v);
    if (g.tileSizeMerc(LEVELS[m].z) * k / v < LOAD_S * 0.99) unsafe++;
  }
  ok(unsafe === 0, 'the finest retained level always outlives one fetch');
}
console.log(R.slice(-2).join('\n'));

// Speed must never discard detail already in memory. It may only stop us
// asking for more.
{
  const mx = g.lonToMercX(-75.11), my = g.latToMercY(39.63);
  const all = new Set(computeBlocks(mx, my, LEVELS).map((t) => `${t.z}/${t.x}/${t.y}`));
  const has = (z, x, y) => all.has(`${z}/${x}/${y}`);
  const full = 16 + 12 * (LEVELS.length - 1);
  let bad = 0;
  for (let minLevel = 0; minLevel < LEVELS.length - 1; minLevel++) {
    const draw = computeBlocks(mx, my, LEVELS, has);
    const fetch = computeBlocks(mx, my, LEVELS.slice(minLevel));
    if (draw.length !== full) bad++;
    if (Math.min(...draw.map((t) => t.level)) !== 0) bad++;
    if (minLevel > 0 && fetch.length >= full) bad++;   // fetch really is reduced
  }
  ok(bad === 0, 'cached detail is drawn at every speed; only the fetch list shrinks');
}
console.log(R.slice(-1).join('\n'));
