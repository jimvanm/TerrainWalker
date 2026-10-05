// N: picking up a piece of ground and laying it down elsewhere.
import assert from 'node:assert/strict';

const geo = await import('../src/geo.js');
const T = await import('../src/transplant.js');
const { screenDir, aimPoint } = await import('../src/dropper.js');
const { Landmarks } = await import('../src/landmarks.js');

// ---- geometry ----
{
  const sq = [[-10, -10], [10, -10], [10, 10], [-10, 10]];
  assert.ok(T.inside(sq, 0, 0) && !T.inside(sq, 11, 0), 'inside / outside a square');
  assert.equal(T.area(sq), 400);
  assert.equal(T.median([3, null, 1, 2]), 2);
  const [e, n] = T.turnEN(0, 100, 90);
  assert.ok(Math.abs(e - 100) < 1e-9 && Math.abs(n) < 1e-9, 'a quarter turn clockwise takes north to east');
  console.log('ok  outline geometry');
}

// ---- the piece ----
{
  // A cone 3,000 m above a plain at 1,000 m, outlined by a 10 km square.
  const cone = (e, n) => 1000 + Math.max(0, 3000 - Math.hypot(e, n) * 0.6);
  const sq = [[-5000, -5000], [5000, -5000], [5000, 5000], [-5000, 5000]];
  const rise = T.buildPiece(cone, sq, 'rise');
  assert.equal(rise.edge, 1000, 'the edge height is the plain');
  assert.ok(Math.abs(rise.rise - 3000) < 60, `rise mode: the cone rises about 3,000 m above its edge (${rise.rise.toFixed(0)})`);
  const sea = T.buildPiece(cone, sq, 'sea');
  assert.ok(Math.abs(sea.rise - 4000) < 60, `sea mode: the top stands about 4,000 m above sea level (${sea.rise.toFixed(0)})`);
  let walls = 0, below = 0;
  for (let i = 1; i < rise.pos.length; i += 3) { if (rise.pos[i] < -1) walls++; if (rise.pos[i] < 0 && rise.pos[i] > -1) below++; }
  assert.ok(walls > 0 && below === 0, 'only the edge wall goes below the base; the ground never does');
  assert.ok(rise.idx.length / 3 > 200000 && rise.idx.length / 3 < 300000, 'about 360 x 360 cells: ' + rise.idx.length / 3 + ' triangles');
  for (const i of rise.idx) if (i >= rise.pos.length / 3) throw new Error('index out of range');
  // A triangle outline takes about half the square's cells.
  const tri = T.buildPiece(cone, [[-5000, -5000], [5000, -5000], [-5000, 5000]], 'rise');
  assert.ok(tri.idx.length < rise.idx.length * 0.62, 'cells outside the outline are left out');
  console.log('ok  a piece rises above its edge (or stands above sea level), with a wall around it');
}

// ---- reading the source ----
{
  assert.equal(T.chooseZoom(15000, 28), 12, 'a 15 km piece near Everest reads zoom 12');
  assert.ok(T.chooseZoom(4000, 43.6) >= 13, 'a 4 km piece of Toronto reads zoom 13 or finer');
  assert.ok(T.chooseZoom(200000, 45) <= 9, 'a 200 km piece stays within the tile budget');
  // One tile whose height is its pixel column: the sampler interpolates.
  const z = 10, h = new Float32Array(256 * 256);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) h[y * 256 + x] = x;
  const at = T.sampler(new Map([['300/400', h]]), z);
  const s = geo.tileSizeMerc(z);
  const mx = -geo.HALF + (300 + 100.5 / 256) * s, my = geo.HALF - (400 + 50.5 / 256) * s;
  assert.ok(Math.abs(at(mx, my) - 100) < 1e-6, 'the sampler reads the right pixel');
  assert.equal(at(mx + s * 5, my), null, 'and nothing where no tile was fetched');
  console.log('ok  the source zoom and the height sampler');
}

// ---- the overlay: toScreen is screenDir backwards ----
{
  const cam = { mercX: geo.lonToMercX(-79.38), mercY: geo.latToMercY(43.64), alt: 600, yaw: 0.7, pitch: -0.3 };
  const flat = () => 80;
  for (const [px, py] of [[400, 300], [100, 500], [700, 420]]) {
    const hit = aimPoint(cam, flat, screenDir(cam, px, py, 800, 600, 68));
    const p = T.toScreen(cam, hit.mx, hit.my, 80, 800, 600, 68);
    assert.ok(Math.abs(p.x - px) < 0.5 && Math.abs(p.y - py) < 0.5, `ground point under (${px}, ${py}) draws back at (${p.x.toFixed(1)}, ${p.y.toFixed(1)})`);
  }
  console.log('ok  outline corners are drawn where they were clicked');
}

// ---- the tool, start to finish ----
{
  const mesh = { buffers: () => ({ vao: {}, count: 0 }), freeBuffers() {} };
  const L = new Landmarks(null, mesh, []);
  await L.ready;
  // Source: the cone, around a point near Everest; destination: flat ground at 75 m.
  const src = { lat: 27.99, lon: 86.92 };
  const sx = geo.lonToMercX(src.lon), sy = geo.latToMercY(src.lat), sk = geo.mercScale(src.lat);
  const coneM = (mx, my) => 1000 + Math.max(0, 3000 - Math.hypot((mx - sx) * sk, (my - sy) * sk) * 0.6);
  const fetchTile = async (z, x, y) => {
    const s = geo.tileSizeMerc(z), h = new Float32Array(256 * 256);
    for (let j = 0; j < 256; j++) for (let i = 0; i < 256; i++) {
      h[j * 256 + i] = coneM(-geo.HALF + (x + (i + 0.5) / 256) * s, geo.HALF - (y + (j + 0.5) / 256) * s);
    }
    return h;
  };
  const tp = new T.Transplant(L, fetchTile);
  const ground = (mx, my) => (Math.abs(mx) < 1e9 ? 75 : null);
  tp.toggle();
  assert.equal(tp.state, 'drawing');
  for (const [de, dn] of [[-5000, -5000], [5000, -5000], [5000, 5000], [-5000, 5000]]) {
    tp.aim = { mx: sx + de / sk, my: sy + dn / sk };
    tp.click(() => 1000);
  }
  tp.undo(); assert.equal(tp.corners.length, 3, 'Backspace takes back a corner');
  tp.aim = { mx: sx - 5000 / sk, my: sy + 5000 / sk }; tp.click(() => 1000);
  await tp.close();
  assert.equal(tp.state, 'carrying', 'Enter picks it up');
  assert.ok(Math.abs(tp.piece.rise - 3000) < 80, 'the piece rises about 3,000 m: ' + tp.piece.rise.toFixed(0));
  // Destination: Lake Ontario, looking down at it.
  const cam = { mercX: geo.lonToMercX(-77.7), mercY: geo.latToMercY(43.6), alt: 20000, yaw: 0, pitch: -Math.PI / 3 };
  tp.update(cam, ground, null);
  const p = tp.preview;
  assert.ok(!p.hidden && p.base === 75, 'it stands on the destination\'s ground at its edge: base ' + p.base);
  tp.turn(1); assert.equal(p.yawDeg, 15, ', and . turn it');
  tp.toggleHeight(); tp.update(cam, ground, null);
  assert.ok(tp.preview.base === 0 && Math.abs(tp.piece.rise - 4000) < 80, 'U: height above sea level instead');
  tp.toggleHeight(); tp.update(cam, ground, null);
  tp.click(ground);
  const laid = L.items.filter((it) => it.piece);
  assert.equal(laid.length, 1, 'click lays it down');
  assert.ok(laid[0].base === 75 && laid[0].yawDeg === 15, 'where and how it stood');
  L.update({ mercX: cam.mercX, mercY: cam.mercY, k: geo.mercScale(43.6), agl: 20000 }, () => 500);
  assert.equal(laid[0].base, 75, 'and the ground under its middle does not move it');
  assert.equal(tp.state, 'carrying', 'still in hand, for another');
  // U over a laid piece, nothing in hand: changes it where it lies.
  tp.toggle();
  assert.ok(tp.toggleAt(tp.aim, ground), 'U over a laid piece');
  const sea = L.items.find((it) => it.piece);
  assert.ok(sea.piece.mode === 'sea' && sea.base === 0 && Math.abs(sea.piece.rise - 4000) < 80 && sea.yawDeg === 15, 'it now stands at its height above sea level, where it lay, turned as it was');
  assert.ok(tp.toggleAt(tp.aim, ground) && L.items.find((it) => it.piece).base === 75, 'and back');
  laid[0] = L.items.find((it) => it.piece);
  // Put it away, then pick the laid one up again by clicking it.
  assert.equal(tp.state, 'off');
  assert.ok(tp.pickUpAt(tp.aim) && tp.state === 'carrying' && !L.items.includes(laid[0]), 'a click with nothing in hand picks up a laid piece');
  assert.ok(tp.yawDeg === 15 && tp.mode === 'rise', 'turned as it lay');
  tp.update(cam, ground, null); tp.park();
  assert.ok(tp.state === 'carrying' && tp.preview.hidden, 'out of Tools mode it is hidden but still in hand');
  tp.update(cam, ground, null);
  assert.ok(!tp.preview.hidden, 'and back in Tools it is there again');
  tp.update(cam, ground, null); tp.toggleHeight();
  assert.ok(Math.abs(tp.piece.rise - 4000) < 80, 'and U still works on it');
  tp.toggleHeight(); tp.update(cam, ground, null);
  tp.click(ground);
  const again = L.items.find((it) => it.piece);
  // Pointed at from the side, level, 20 km away: the line meets the
  // mountain's flank, while the ground behind it is far outside its outline.
  const kk = geo.mercScale(geo.mercYToLat(again.my));
  const side = { mercX: again.mx, mercY: again.my - 20000 / kk, alt: 75 + 1500, yaw: 0, pitch: 0 };
  assert.equal(tp.pointedAt(side, ground, null), again, 'pointing at its side finds it');
  assert.equal(tp.pointedAt({ ...side, alt: 75 + 3500 }, ground, null), null, 'pointing over its top does not');
  assert.equal(tp.pointedAt({ ...side, yaw: 0.5 }, ground, null), null, 'nor pointing off to the side of it');
  assert.ok(again && tp.removeAt(tp.aim) === again && !L.items.includes(again), 'Delete removes the laid piece pointed at');
  tp.toggle();
  assert.ok(tp.state === 'off' && !L.items.some((it) => it.preview), 'N again puts it away');
  console.log('ok  draw, take back, pick up, carry, turn, change height, lay down, remove, put away');
}
// ---- the saved pieces list ----
{
  const mem = new Map();
  globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)) };
  const P = await import('../src/pieces.js');
  const list = P.loadPieces();
  assert.deepEqual(list, [], 'none at first');
  const a = P.addPiece(list, { corners: [[1, 1], [1, 2], [2, 2]], mode: 'rise' });
  const b = P.addPiece(list, { corners: [[1, 1], [1, 2], [2, 2]], mode: 'sea' });
  assert.ok(a.name === 'Piece 1' && b.name === 'Piece 2' && list[0] === b, 'named in turn, newest first');
  P.savePieces(list);
  assert.equal(P.loadPieces().length, 2, 'kept in the browser');
  mem.set('tw.pieces', 'not json');
  assert.deepEqual(P.loadPieces(), [], 'a broken store is ignored, not fatal');

  // Picking up an outline saves it; taking it from the list puts it in hand again.
  const mesh = { buffers: () => ({ vao: {}, count: 0 }), freeBuffers() {} };
  const L = new Landmarks(null, mesh, []);
  await L.ready;
  const fetchTile = async () => { const h = new Float32Array(256 * 256); for (let i = 0; i < h.length; i++) h[i] = 500 + (i % 256); return h; };
  const tp = new T.Transplant(L, fetchTile);
  const saved = [];
  tp.onPicked = (v) => { saved.push(v); return 'Piece 9'; };
  const c0 = { lat: 49.3, lon: -123.0 }, k0 = geo.mercScale(c0.lat), x0 = geo.lonToMercX(c0.lon), y0 = geo.latToMercY(c0.lat);
  tp.toggle();
  for (const [de, dn] of [[-1000, -1000], [1000, -1000], [0, 1000]]) { tp.aim = { mx: x0 + de / k0, my: y0 + dn / k0 }; tp.click(() => 0); }
  await tp.close();
  assert.ok(saved.length === 1 && saved[0].corners.length === 3 && tp.piece.name === 'Piece 9', 'an outline picked up is saved, by its corners, and named');
  assert.ok(Math.abs(saved[0].corners[2][0] - geo.mercYToLat(y0 + 1000 / k0)) < 1e-5, 'corners as latitude and longitude');
  tp.cancel();
  await tp.take({ name: 'Grouse', corners: saved[0].corners, mode: 'sea' });
  assert.ok(tp.state === 'carrying' && tp.piece.name === 'Grouse' && tp.mode === 'sea', 'taken from the list: in hand, with its name and height setting');
  assert.equal(saved.length, 1, 'and not saved a second time');
  console.log('ok  the saved pieces list');
}
console.log('transplant ok');
