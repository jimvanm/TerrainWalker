// Finding a mountain by name and tracing its outline.
import assert from 'node:assert/strict';

const M = await import('../src/mountains.js');
const T = await import('../src/transplant.js');
const geo = await import('../src/geo.js');

// ---- tracing on a grid ----
{
  // On a plain at 1,000 m: ours (3,000 m) at (40, 50); a higher peak (4,000 m)
  // at (70, 50), joined to ours by a ridge at 1,800 m; and a lower peak
  // (2,500 m) at (40, 15) across the plain.
  const N = 100, h = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const a = 3000 - 120 * Math.hypot(i - 40, j - 50), b = 4000 - 120 * Math.hypot(i - 70, j - 50);
    const c = 2500 - 120 * Math.hypot(i - 40, j - 15);
    const ridge = Math.abs(j - 50) < 2 && i > 40 && i < 70 ? 1800 : 0;
    h[j * N + i] = Math.max(1000, a, b, c, ridge);
  }
  const STRICT = { reach: 100, join: 2, trim: 0 };          // each peak alone, no trimming
  const t = M.traceGrid(h, N, 41, 51, 100, STRICT);
  assert.ok(t.ti === 40 && t.tj === 50 && t.top === 3000, 'the summit is found near the given point');
  assert.ok(t.inside[50 * N + 40] && t.inside[50 * N + 50], 'our peak is in');
  assert.ok(!t.inside[50 * N + 70] && !t.inside[50 * N + 64], 'the higher peak is left out: you would climb to reach it');
  assert.ok(!t.inside[15 * N + 40] && !t.inside[25 * N + 40], 'and so is the lower one across the plain');
  assert.equal(t.col, 1000, 'sliced at the plain round it');
  // One peak alone, wider than the reach: sliced at the low ground round the circle.
  const one = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) one[j * N + i] = 3000 - 20 * Math.hypot(i - 50, j - 50);
  const u = M.traceGrid(one, N, 50, 50, 100, STRICT);
  assert.ok(u.cut && u.col < 3000 - 20 * 46 && u.col > 3000 - 20 * 50, 'alone and wide, sliced at the reach: ' + u.col.toFixed(0));
  // A giant with a high ridge running out past the reach: sliced at the
  // valley floors, not where the ridge crosses the reach.
  const g = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const cone = 8000 - 120 * Math.hypot(i - 50, j - 50);
    const ridge = Math.abs(j - 50) < 3 && i > 50 ? 7000 - 10 * (i - 50) : 0;
    g[j * N + i] = Math.max(3000, cone, ridge);
  }
  const v = M.traceGrid(g, N, 50, 50, 100, STRICT);
  assert.ok(v.cut && v.col === 3000, 'a giant is sliced at the valley floor, not up its ridge: ' + v.col);
  // Small bumps on the way down do not stop it.
  const bumpy = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) bumpy[j * N + i] = Math.max(1000, 3000 - 50 * Math.hypot(i - 50, j - 50)) + ((i * 7 + j * 13) % 5) * 10;
  const w = M.traceGrid(bumpy, N, 50, 50, 100, STRICT);
  assert.ok(w.inside[50 * N + 85] && w.inside[20 * N + 50], 'bumps of 40 m on the way down do not cut it short');
  console.log('ok  the mountain is the ground whose way up leads to its summit, sliced at the valleys round it');

  // Lhotse and Everest: a close neighbour joined by a high saddle joins;
  // a far one behind a low saddle does not.
  const E = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const ev = 8800 - 400 * Math.hypot(i - 50, j - 50), lh = 8500 - 400 * Math.hypot(i - 58, j - 50);
    const far = 7000 - 300 * Math.hypot(i - 50, j - 88);
    const col = Math.abs(j - 50) < 2 && i > 50 && i < 58 ? 7900 : 0;
    const low = Math.abs(i - 50) < 2 && j > 50 && j < 88 ? 5500 : 0;
    E[j * N + i] = Math.max(5000, ev, lh, far, col, low);
  }
  const alone = M.traceGrid(E, N, 50, 50, 100, { reach: 100, join: 2, trim: 0 });
  const both = M.traceGrid(E, N, 50, 50, 100, { reach: 100, join: 0.6, joinKm: 5, trim: 0 });
  assert.ok(!alone.inside[50 * N + 58] && both.inside[50 * N + 58], 'a close peak behind a high saddle joins (Lhotse)');
  assert.ok(!both.inside[88 * N + 50] && both.joined.length === 1, 'a far one behind a low saddle does not');
  const nearOnly = M.traceGrid(E, N, 50, 50, 100, { reach: 100, join: 0.6, joinKm: 0.5, trim: 0 });
  assert.ok(!nearOnly.inside[50 * N + 58], 'nor a high-saddle one further than joinKm');
  // Trimming: low ground far out goes, the summit's own slopes stay.
  const spur = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const cone = 4000 - 100 * Math.hypot(i - 50, j - 50);
    const arm = Math.abs(j - 50) < 2 && i > 50 ? 1600 - 5 * (i - 50) : 0;      // a long low spur east
    spur[j * N + i] = Math.max(1000, cone, arm);
  }
  const untrimmed = M.traceGrid(spur, N, 50, 50, 100, { reach: 100, join: 2, trim: 0 });
  const trimmed = M.traceGrid(spur, N, 50, 50, 100, { reach: 100, join: 2, trim: 0.25 });
  assert.ok(untrimmed.inside[50 * N + 90] && !trimmed.inside[50 * N + 90], 'trimming takes the far end of a low spur');
  assert.ok(trimmed.inside[50 * N + 60] && trimmed.inside[50 * N + 40], 'and keeps the mountain itself');
  console.log('ok  neighbours join by saddle height and distance; low spurs far out are trimmed');
  // Thin arms: a ridge 3 cells wide off a broad cone goes; the cone stays.
  const arm = new Float32Array(N * N);
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const cone = 4000 - 150 * Math.hypot(i - 50, j - 50);
    const ridge = Math.abs(j - 50) <= 1 && i > 50 ? 3500 - 10 * (i - 50) : 0;
    arm[j * N + i] = Math.max(1000, cone, ridge);
  }
  const fat = M.traceGrid(arm, N, 50, 50, 100, { reach: 100, join: 2, trim: 0 });
  const slim = M.traceGrid(arm, N, 50, 50, 100, { reach: 100, join: 2, trim: 0, neck: 600 });
  assert.ok(fat.inside[50 * N + 85] && !slim.inside[50 * N + 85], 'an arm 300 m wide goes when narrower than 600 m is cut');
  assert.ok(slim.inside[50 * N + 60] && slim.inside[50 * N + 40] && slim.inside[40 * N + 50], 'the cone itself stays');
  assert.ok(slim.area > fat.area * 0.8, 'and keeps most of its size: ' + slim.area.toFixed(1) + ' of ' + fat.area.toFixed(1));
  console.log('ok  arms narrower than the neck setting are cut off');
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
    if (u.includes('list=search')) return { query: { search: [{ title: 'Q1' }, { title: 'Q2' }, { title: 'Q4' }] } };
    return { entities: {
      Q1: { labels: { en: { value: 'Mount Robson' } }, descriptions: { en: { value: 'highest mountain in the Canadian Rockies' } },
        claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 53.11, longitude: -119.156 } } } }], P2044: [{ mainsnak: { datavalue: { value: { amount: '+3954' } } } }] } },
      Q2: { labels: { en: { value: 'Robson (band)' } }, claims: {} },
      Q4: { labels: { mul: { value: 'Denali' } }, descriptions: { en: { value: 'highest mountain in North America' } },
        claims: { P625: [{ mainsnak: { datavalue: { value: { latitude: 63.069, longitude: -151.007 } } } }] } },
    } };
  };
  const r = await M.searchMountains('Robson', fetchJson);
  assert.equal(r.length, 2, 'only things with a summit position');
  assert.equal(r[1].name, 'Denali', 'a name kept only for all languages is used (not Q4)');
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
  const t = await M.traceMountain(lat + 0.002, lon, { reach: 15, trim: 0 }, fetchTile);     // a slightly wrong summit position
  assert.ok(Math.abs(t.top - 2500) < 80, 'summit about 2,500 m (a sharp top, sampled every ~90 m): ' + t.top);
  assert.ok(Math.abs(t.col - 500) < 30, 'sliced at the plain round it, 500 m: ' + t.col);
  assert.ok(Math.abs(t.prominence - 2000) < 90, 'rises about 2,000 m above it: ' + t.prominence);
  const far = Math.max(...t.corners.map(([la, lo]) => Math.hypot((geo.lonToMercX(lo) - sx) * k, (geo.latToMercY(la) - sy) * k)));
  assert.ok(far > 2000 && far < 9000, 'the outline is the cone above the saddle, not the hill beyond: ' + far.toFixed(0) + ' m out');
  const cut = await M.traceMountain(lat, lon, { reach: 1.5, trim: 0 }, fetchTile);
  assert.ok(cut.cut && cut.prominence < 1100, 'a short reach cuts it: rises ' + cut.prominence);
  console.log('ok  a summit gives its outline and prominence from the height tiles');
}
console.log('mountains ok');
