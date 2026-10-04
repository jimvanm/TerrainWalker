// Triangulates a polygon with holes (ear clipping). No dependencies.
//
// rings: [outer, hole, hole, ...], each a flat [x0, y0, x1, y1, ...] and NOT
// closed (no repeated first point).
// Returns { src, tris }. tris holds indices into src; src[i] is the global
// vertex number (outer first, then each hole in order) that point i stands for,
// so the caller can map a triangle corner back to its own vertex arrays. A
// hole is joined to the outside by a two-way bridge, which is why the same
// source vertex can appear twice.

const cross = (ax, ay, bx, by, cx, cy) => (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);

function signedArea(r) {
  let a = 0;
  for (let i = 0, n = r.length / 2; i < n; i++) {
    const j = (i + 1) % n;
    a += r[2 * i] * r[2 * j + 1] - r[2 * j] * r[2 * i + 1];
  }
  return a / 2;
}

export function triangulate(rings) {
  const X = [], Y = [], SRC = [], PREV = [], NEXT = [];
  const addRing = (r, offset, wantPositive) => {
    const n = r.length / 2;
    const order = [];
    for (let i = 0; i < n; i++) order.push(i);
    if ((signedArea(r) > 0) !== wantPositive) order.reverse();
    const first = X.length;
    for (let k = 0; k < n; k++) {
      const i = order[k];
      X.push(r[2 * i]); Y.push(r[2 * i + 1]); SRC.push(offset + i);
    }
    for (let k = 0; k < n; k++) {
      PREV[first + k] = first + (k + n - 1) % n;
      NEXT[first + k] = first + (k + 1) % n;
    }
    return first;
  };

  let offset = 0;
  const start = addRing(rings[0], 0, true);
  offset += rings[0].length / 2;
  const holes = [];
  for (let h = 1; h < rings.length; h++) {
    if (rings[h].length >= 6) {
      const first = addRing(rings[h], offset, false);
      let best = first;                       // its right-most point
      for (let k = NEXT[first]; k !== first; k = NEXT[k]) if (X[k] > X[best]) best = k;
      holes.push({ node: best, x: X[best] });
    }
    offset += rings[h].length / 2;
  }
  holes.sort((a, b) => b.x - a.x);

  // Segments that count as walls: every edge of the polygon as it stands.
  const crosses = (p, q, ax, ay, bx, by) => {
    const d1 = cross(X[p], Y[p], X[q], Y[q], ax, ay), d2 = cross(X[p], Y[p], X[q], Y[q], bx, by);
    const d3 = cross(ax, ay, bx, by, X[p], Y[p]), d4 = cross(ax, ay, bx, by, X[q], Y[q]);
    return d1 * d2 < 0 && d3 * d4 < 0;
  };
  const blocked = (p, h, ringStarts) => {
    for (const s of ringStarts) {
      let k = s;
      do {
        const m = NEXT[k];
        if (k !== p && m !== p && k !== h && m !== h && crosses(p, h, X[k], Y[k], X[m], Y[m])) return true;
        k = m;
      } while (k !== s);
    }
    return false;
  };

  const ringStarts = [start];
  for (const hole of holes) {
    const H = hole.node;
    // Nearest outline point the hole can see.
    const cand = [];
    for (let k = start, first = true; first || k !== start; k = NEXT[k], first = false) cand.push(k);
    cand.sort((a, b) => Math.hypot(X[a] - X[H], Y[a] - Y[H]) - Math.hypot(X[b] - X[H], Y[b] - Y[H]));
    let P = -1;
    const all = ringStarts.concat([H]);
    for (const c of cand) { if (!blocked(c, H, all)) { P = c; break; } }
    if (P < 0) continue;                      // cannot bridge: leave the hole filled
    const Hc = X.length; X.push(X[H]); Y.push(Y[H]); SRC.push(SRC[H]); PREV.push(0); NEXT.push(0);
    const Pc = X.length; X.push(X[P]); Y.push(Y[P]); SRC.push(SRC[P]); PREV.push(0); NEXT.push(0);
    const Pn = NEXT[P], Hp = PREV[H];
    NEXT[P] = H; PREV[H] = P;
    NEXT[Hp] = Hc; PREV[Hc] = Hp;
    NEXT[Hc] = Pc; PREV[Pc] = Hc;
    NEXT[Pc] = Pn; PREV[Pn] = Pc;
    ringStarts.push(H);
  }

  // ---- ear clipping ---------------------------------------------------------
  const tris = [];
  const inTri = (a, b, c, q) => {
    if ((X[q] === X[a] && Y[q] === Y[a]) || (X[q] === X[b] && Y[q] === Y[b]) ||
        (X[q] === X[c] && Y[q] === Y[c])) return false;
    return cross(X[a], Y[a], X[b], Y[b], X[q], Y[q]) >= 0 &&
           cross(X[b], Y[b], X[c], Y[c], X[q], Y[q]) >= 0 &&
           cross(X[c], Y[c], X[a], Y[a], X[q], Y[q]) >= 0;
  };
  const isEar = (a) => {
    const p = PREV[a], n = NEXT[a];
    if (cross(X[p], Y[p], X[a], Y[a], X[n], Y[n]) <= 0) return false;
    for (let q = NEXT[n]; q !== p; q = NEXT[q]) {
      if (cross(X[PREV[q]], Y[PREV[q]], X[q], Y[q], X[NEXT[q]], Y[NEXT[q]]) <= 0 && inTri(p, a, n, q)) return false;
    }
    return true;
  };

  let count = 0;
  for (let k = start, first = true; first || k !== start; k = NEXT[k], first = false) count++;
  for (const s of ringStarts.slice(1)) {      // plus each hole and its bridge copies
    // counted below by walking the merged loop instead
  }
  // Recount on the merged loop.
  count = 0;
  for (let k = start, first = true; first || k !== start; k = NEXT[k], first = false) count++;

  let ear = start, stop = start, guard = count * count + 50;
  while (count > 2 && guard-- > 0) {
    const p = PREV[ear], n = NEXT[ear];
    if (isEar(ear)) {
      tris.push(p, ear, n);
      NEXT[p] = n; PREV[n] = p;
      count--;
      ear = n; stop = n;
    } else {
      ear = n;
      if (ear === stop) {
        // No ear anywhere: bad outline (touching or crossing edges). Cut one
        // corner regardless so the loop always finishes.
        const pp = PREV[ear], nn = NEXT[ear];
        tris.push(pp, ear, nn);
        NEXT[pp] = nn; PREV[nn] = pp;
        count--;
        ear = nn; stop = nn;
      }
    }
  }
  return { src: Int32Array.from(SRC), tris: Int32Array.from(tris) };
}

export { signedArea };
