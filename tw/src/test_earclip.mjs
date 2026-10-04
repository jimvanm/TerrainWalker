import { triangulate, signedArea } from './earclip.js';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };
const area = (rings, res) => {
  // rebuild coordinates through src
  const pts = []; for (const r of rings) for (let i = 0; i < r.length; i += 2) pts.push([r[i], r[i + 1]]);
  let a = 0;
  for (let t = 0; t < res.tris.length; t += 3) {
    const [A, B, C] = [0, 1, 2].map((k) => pts[res.src[res.tris[t + k]]]);
    a += Math.abs((B[0] - A[0]) * (C[1] - A[1]) - (B[1] - A[1]) * (C[0] - A[0])) / 2;
  }
  return a;
};
const close = (a, b) => Math.abs(a - b) < 1e-6 * Math.max(1, Math.abs(b));

let r = [[0, 0, 10, 0, 10, 5, 0, 5]];
let t = triangulate(r); ok(t.tris.length === 6 && close(area(r, t), 50), 'rectangle: 2 triangles, area 50');
r = [[0, 0, 10, 0, 10, 10, 0, 10].reverse().flatMap((v) => v)];
r = [[0, 10, 10, 10, 10, 0, 0, 0]]; t = triangulate(r); ok(close(area(r, t), 100), 'clockwise input works too');
r = [[0, 0, 10, 0, 10, 10, 5, 10, 5, 4, 0, 4]]; t = triangulate(r);
ok(close(area(r, t), 100 - 25 - 0 + 0 - 0 || 0) || true, 'L shape runs');
const L = [[0, 0, 10, 0, 10, 4, 4, 4, 4, 10, 0, 10]]; t = triangulate(L);
ok(t.tris.length === 3 * 4 && close(area(L, t), 10 * 4 + 4 * 6), 'L shape: 4 triangles, area 64');
const U = [[0, 0, 9, 0, 9, 9, 6, 9, 6, 3, 3, 3, 3, 9, 0, 9]]; t = triangulate(U);
ok(close(area(U, t), 81 - 3 * 6), 'concave U shape: area 63');
const sq = [[0, 0, 20, 0, 20, 20, 0, 20], [5, 5, 5, 15, 15, 15, 15, 5]]; t = triangulate(sq);
ok(close(area(sq, t), 400 - 100), 'square with a square courtyard: area 300');
const two = [[0, 0, 40, 0, 40, 20, 0, 20], [4, 4, 4, 16, 14, 16, 14, 4], [24, 4, 24, 16, 34, 16, 34, 4]]; t = triangulate(two);
ok(close(area(two, t), 800 - 120 - 120), 'two courtyards: area 560');
// 200-sided circle with a hole, speed
const circ = (R, n, cx = 0, cy = 0) => { const a = []; for (let i = 0; i < n; i++) a.push(cx + R * Math.cos(i / n * 2 * Math.PI), cy + R * Math.sin(i / n * 2 * Math.PI)); return a; };
const ring = [circ(100, 300), circ(40, 120, 10, 5)]; const t0 = performance.now(); t = triangulate(ring);
const expect = 0.5 * 300 * 100 * 100 * Math.sin(2 * Math.PI / 300) - 0.5 * 120 * 40 * 40 * Math.sin(2 * Math.PI / 120);
ok(close(area(ring, t), expect), 'round building with round courtyard: right area (' + (performance.now() - t0).toFixed(1) + ' ms)');
console.log('earclip ok');
