// Clipmap block layout.
//
// Each level is a 4x4 block of tiles whose origin is snapped to an EVEN tile
// coordinate. That single constraint is what makes the scheme exact: a 4x4
// block at zoom z+1 covers precisely 2x2 whole tiles at zoom z, aligned to the
// coarse grid. So the coarse level can drop exactly those 2x2 tiles, leaving no
// gap and no overlap. Nothing else needs to line up.

import { mercToTile } from './geo.js';

export const BLOCK = 4;

// Even origin such that the camera always falls in the central 2x2 tiles.
export function blockOrigin(c) {
  return 2 * Math.round(c / 2) - 2;
}

// Returns a flat list of tiles to render, coarsest level first.
// `levels` is the LEVELS array from config, sliced to the active count.
//
// `isLoaded(z, x, y)` is optional. When supplied, a coarse tile is only culled
// once every finer tile that would replace it has actually arrived. Without it
// the clipmap drops the coarse tile the instant the block shifts, leaving a
// hole until the fetch lands — which reads as squares blinking out and back in
// as you move. Substitution is per coarse tile, so there is never both a coarse
// and a fine tile covering the same ground: no gap, and no overlap either.
export function computeBlocks(mercX, mercY, levels, isLoaded) {
  const origins = levels.map((L) => {
    const t = mercToTile(mercX, mercY, L.z);
    return { ox: blockOrigin(t.x), oy: blockOrigin(t.y) };
  });

  const wrap = (x, z) => { const n = Math.pow(2, z); return ((x % n) + n) % n; };
  const K = (z, x, y) => z + '/' + wrap(x, z) + '/' + y;
  const kids = (z, x, y) => [[0, 0], [1, 0], [0, 1], [1, 1]]
    .map(([dx, dy]) => [z + 1, 2 * x + dx, 2 * y + dy]);

  // "Covered" is recursive, and getting this wrong is what deadlocked the
  // loader. A tile's ground is covered if the tile itself is loaded OR all four
  // of its children are covered — a child may legitimately be absent because
  // ITS children cover it. Asking only whether the immediate children were
  // loaded held every coarse tile forever.
  //
  // Built finest-first over the block tiles only, so it stays cheap.
  const covered = [];
  for (let i = 0; i < levels.length; i++) {
    const { z } = levels[i];
    const { ox, oy } = origins[i];
    const set = new Set();
    for (let j = 0; j < BLOCK; j++) {
      for (let m = 0; m < BLOCK; m++) {
        const x = ox + m, y = oy + j;
        const key = K(z, x, y);
        if (isLoaded && isLoaded(z, wrap(x, z), y)) { set.add(key); continue; }
        if (!isLoaded) { set.add(key); continue; }
        if (i > 0 && kids(z, x, y).every(([cz, cx, cy]) => covered[i - 1].has(K(cz, cx, cy)))) {
          set.add(key);
        }
      }
    }
    covered.push(set);
  }

  const out = [];
  // Coarse to fine, carrying forward which finer tiles are already covered by a
  // coarser stand-in. Suppression has to cascade or a substituted tile would be
  // drawn over by its own grandchildren.
  let suppressed = new Set();
  for (let i = levels.length - 1; i >= 0; i--) {
    const { z, grid } = levels[i];
    const { ox, oy } = origins[i];
    const n = Math.pow(2, z);
    const next = new Set();
    let hx = null, hy = null;
    if (i > 0) { hx = origins[i - 1].ox / 2; hy = origins[i - 1].oy / 2; }

    for (let j = 0; j < BLOCK; j++) {
      for (let m = 0; m < BLOCK; m++) {
        const x = ox + m, y = oy + j;
        if (y < 0 || y >= n) continue;              // above the pole, no data
        const key = K(z, x, y);

        if (suppressed.has(key)) {
          if (i > 0) for (const c of kids(z, x, y)) next.add(K(c[0], c[1], c[2]));
          continue;
        }

        if (hx !== null && x >= hx && x < hx + 2 && y >= hy && y < hy + 2) {
          const ready = kids(z, x, y).every((c) => covered[i - 1].has(K(c[0], c[1], c[2])));
          if (ready) continue;                      // finer tiles will cover this
          for (const c of kids(z, x, y)) next.add(K(c[0], c[1], c[2]));
        }

        out.push({ z, grid, level: i, x: wrap(x, z), y, rawX: x, rawY: y });
      }
    }
    suppressed = next;
  }
  return out;
}
