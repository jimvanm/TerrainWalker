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

// Returns a flat list of tiles to render, finest level first.
// `levels` is the LEVELS array from config, sliced to the active count.
export function computeBlocks(mercX, mercY, levels) {
  const origins = levels.map((L) => {
    const t = mercToTile(mercX, mercY, L.z);
    return { ox: blockOrigin(t.x), oy: blockOrigin(t.y) };
  });

  const out = [];
  for (let i = 0; i < levels.length; i++) {
    const { z, grid } = levels[i];
    const { ox, oy } = origins[i];
    // Tiles covered by the next finer level, in this level's coordinates.
    let hx = null, hy = null;
    if (i > 0) {
      hx = origins[i - 1].ox / 2;
      hy = origins[i - 1].oy / 2;
    }
    const n = Math.pow(2, z);
    for (let j = 0; j < BLOCK; j++) {
      for (let k = 0; k < BLOCK; k++) {
        const x = ox + k, y = oy + j;
        if (hx !== null && x >= hx && x < hx + 2 && y >= hy && y < hy + 2) continue;
        if (y < 0 || y >= n) continue;              // above the pole, no data
        out.push({ z, grid, level: i, x: ((x % n) + n) % n, y, rawX: x, rawY: y });
      }
    }
  }
  return out;
}
