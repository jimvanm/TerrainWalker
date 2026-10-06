// Finding a mountain by name and tracing its outline at its col.
import assert from 'node:assert/strict';

const M = await import('../src/mountains.js');
const T = await import('../src/transplant.js');
const geo = await import('../src/geo.js');

// ---- tracing on a grid ----
{
  // Two peaks on a plain at 1,000 m: ours (3,000 m) at (40, 50), a higher one
  // (4,000 m) at (70, 50), joined by a ridge whose lowest point is 1,800 m.
  const N = 100, h = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = 3000 - 120 * Math.hypot(i - 40, j - 50), b = 4000 - 120 * Math.hypot(i - 70, j - 50);
    const ridge = Math.abs(j - 50) < 2 && i > 40 && i < 70 ? 1800 : 0;
    h[j * N + i] = Math.max(1000, a, b, ridge);
  }
  const t = M.traceGrid(h, N, 41, 51);
  assert.ok(t.ti === 40 && t.tj === 50 && t.top === 3000, 'the summit is found near the given point');
  assert.equal(t.col, 1800, 'the col is the ridge\'s lowest point, on the way to higher ground');
  assert.ok(t.inside[50 * N + 40] && !t.inside[50 * N + 70], 'the higher peak is left out');
  assert.ok(!t.inside[50 * N + 20] || h[50 * N + 20] > 1800, 'and nothing below the col is in');
  // One peak alone: no higher ground, so the edge of the square cuts it.
  const one = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) one[j * N + i] = 3000 - 20 * Math.hypot(i - 50, j - 50);
  const u = M.traceGrid(one, N, 50, 50);
  assert.ok(u.col < 3000 - 20 * 45 && u.col > 3000 - 20 * 52, 'alone, the col is where the ground first reaches the edge: ' + u.col.toFixed(0));
  console.log('ok  the col is the lowest point crossed to reach higher ground (or the reach)');
}

// ---- the outline of the cells ----
{
  const N = 10, inside = new Uint8Array(N * N);
  for (let j = 2; j < 6; j++) for (let i = 3; i < 8; i++) inside[j * N + i] = 1;      // 5 x 4 cells
  inside[6 * N + 3] = 1;                                                            // and a nub below
  const pts = M.outlineOf(inside, N);
  assert.equal(T.area(pts), 21, 'the outline encloses exactly the cells inside: ' + T.area(pts));
  assert.deepEqual(pts[0], [3, 2], 'starting at the top-left corner');
  const s = M.simplify(pts, 0.1);
  assert.ok(s.length < pts.length && T.area(s) === 21, 'simplified to its corners, same area');
  console.log('ok  the outline goes round the cells once');
}

// ---- the name, from Wikidata ----
{
  const asked = [];
  const fetchJson = async (u) => {
    asked.push(u);
    if (u.includes('list=search')) return { query: { search: [{ title: 'Q1' }, { title: 'Q2' }] } };
    return { entities: {
      Q1: { labels: { en: { value: 'Mount Robson' } }, descriptions: { en: { value: 'highest mountain in the Canadian Rockies' } },
        claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 53.11, longitude: -119.156 } } } }], P2044: [{ mainsnak: { datavalue: { value: { amount: '+3954' } } } }] } },
      Q2: { labels: { en: { value: 'Robson (band)' } }, claims: {} },
    } };
  };
  const r = await M.searchMountains('Robson', fetchJson);
  assert.equal(r.length, 1, 'only things with a summit position');
  assert.ok(r[0].name === 'Mount Robson' && r[0].height === 3954 && r[0].lat === 53.11, 'with name, height and position');
  assert.ok(asked.every((u) => u.includes('origin=*')), 'asked so a web page may read the answer');
  assert.ok(decodeURIComponent(asked[0].replace(/\+/g, ' ')).includes('haswbstatement:P2660|P31=Q8502'), 'only mountains are asked for');
  // When the mountain-only search finds nothing: a plain name search, kept to mountains by description.
  const fallback = async (u) => {
    if (u.includes('list=search')) return { query: { search: [] } };
    if (u.includes('wbsearchentities')) return { search: [{ id: 'Q1' }, { id: 'Q3' }] };
    return { entities: {
      Q1: { labels: { en: { value: 'Mount Logan' } }, descriptions: { en: { value: 'highest mountain in Canada' } }, claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 60.567, longitude: -140.405 } } } }] } },
      Q3: { labels: { en: { value: 'Logan' } }, descriptions: { en: { value: 'city in Utah' } }, claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 41.7, longitude: -111.8 } } } }] } },
    } };
  };
  const f = await M.searchMountains('Logan', fallback);
  assert.ok(f.length === 1 && f[0].name === 'Mount Logan', 'the fallback keeps the mountain, not the city');
  console.log('ok  a name gives summits from Wikidata, mountains only');
}

// ---- the whole trace, from tiles ----
{
  // A cone 2,000 m above a plain at 500 m, 6 km across at the plain, next to
  // a higher hill 9 km east joined by a saddle at 900 m.
  const lat = 53.11, lon = -119.156, sx = geo.lonToMercX(lon), sy = geo.latToMercY(lat), k = geo.mercScale(lat);
  const ground = (mx, my) => {
    const e = (mx - sx) * k, n = (my - sy) * k;
    const a = 2500 - Math.hypot(e, n) * 0.6667;
    const b = 3200 - Math.hypot(e - 9000, n) * 0.5;
    const saddle = Math.abs(n) < 300 && e > 0 && e < 9000 ? 900 : 0;
    return Math.max(500, a, b, saddle);
  };
  const fetchTile = async (z, x, y) => {
    const s = geo.tileSizeMerc(z), h = new Float32Array(256 * 256);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) h[j * 256 + i] = ground(-geo.HALF + (x + (i + 0.5) / 256) * s, geo.HALF - (y + (j + 0.5) / 256) * s);
    return h;
  };
  const t = await M.traceMountain(lat + 0.002, lon, 15000, fetchTile);     // a slightly wrong summit position
  assert.ok(Math.abs(t.top - 2500) < 80, 'summit about 2,500 m (a sharp top, sampled every ~90 m): ' + t.top);
  assert.ok(Math.abs(t.col - 900) < 30 && !t.cut, 'col at the saddle, about 900 m: ' + t.col);
  assert.ok(Math.abs(t.prominence - 1600) < 90, 'prominence about 1,600 m: ' + t.prominence);
  const far = Math.max(...t.corners.map(([la, lo]) => Math.hypot((geo.lonToMercX(lo) - sx) * k, (geo.latToMercY(la) - sy) * k)));
  assert.ok(far > 2000 && far < 9000, 'the outline is the cone above the saddle, not the hill beyond: ' + far.toFixed(0) + ' m out');
  const cut = await M.traceMountain(lat, lon, 1500, fetchTile);
  assert.ok(cut.cut && cut.prominence < 1100, 'a short reach cuts it: rises ' + cut.prominence);
  console.log('ok  a summit gives its outline and prominence from the height tiles');
}
console.log('mountains ok');
