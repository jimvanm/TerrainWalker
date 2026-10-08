// Roof shapes from the map: domes, onions, spires, pyramids (building lab).
//
// Many famous buildings are mapped as stacked parts, each with its own height
// and roof shape: St Paul's is a drum, a dome and a lantern. Here a part's
// walls stop at the eaves and its roof is built by shrinking the outline
// toward its middle while rising, following a profile: a quarter circle for a
// dome, a bulge then a point for an onion, a straight line for a pyramid or a
// spire. Gable and hip roofs use houseroof.js.

// Map names (Overture and OpenStreetMap) to the shapes drawn here.
const SHAPES = {
  dome: 'dome', spherical: 'dome', onion: 'onion',
  pyramidal: 'pyramid', pyramid: 'pyramid', cone: 'spire', conical: 'spire', spire: 'spire',
  gabled: 'gabled', half_hipped: 'gabled', 'half-hipped': 'gabled', saltbox: 'gabled', gambrel: 'gabled', round: 'gabled',
  hipped: 'hipped', mansard: 'hipped', side_hipped: 'hipped',
  flat: 'flat', skillion: 'flat', butterfly: 'flat',   // said to be flat: no house roof added
};
export const roofKind = (shape) => SHAPES[String(shape || '').toLowerCase()] || null;

// [scale of the outline, part of the roof height], from the eaves to the top.
const DOME = Array.from({ length: 9 }, (_, i) => { const a = i / 8 * Math.PI / 2; return [Math.cos(a), Math.sin(a)]; });
const ONION = [[1, 0], [1.12, 0.1], [1.2, 0.22], [1.15, 0.36], [0.95, 0.5], [0.66, 0.64], [0.4, 0.76], [0.2, 0.87], [0.07, 0.95], [0, 1]];
const POINT = [[1, 0], [0, 1]];
export const PROFILES = { dome: DOME, onion: ONION, pyramid: POINT, spire: POINT };

// A roof height when the map gives none. r: the part's radius in metres (as
// if it were round).
export function defaultRoofHeight(kind, r) {
  if (kind === 'dome') return r;
  if (kind === 'onion') return 1.6 * r;
  if (kind === 'spire') return 3 * r;
  if (kind === 'pyramid') return 0.8 * r;
  return 0;
}

// Builds the roof over one outline (flat [x, y, ...], not closed) from the
// eaves at height top. put(x, y, z) adds a roof corner and returns its index;
// tri(a, b, c) adds a triangle.
export function emitProfiled(ring, kind, top, rise, put, tri) {
  const prof = PROFILES[kind];
  const n = ring.length / 2;
  let cx = 0, cy = 0;
  for (let i = 0; i < n; i++) { cx += ring[2 * i]; cy += ring[2 * i + 1]; }
  cx /= n; cy /= n;
  let prev = null;
  for (const [s, t] of prof) {
    const y = top + t * rise;
    let cur;
    if (s === 0) { const apex = put(cx, y, cy); cur = new Array(n).fill(apex); }
    else cur = Array.from({ length: n }, (_, i) => put(cx + (ring[2 * i] - cx) * s, y, cy + (ring[2 * i + 1] - cy) * s));
    if (prev) {
      for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        tri(prev[i], prev[j], cur[j]);
        if (cur[i] !== cur[j]) tri(prev[i], cur[j], cur[i]);
      }
    }
    prev = cur;
  }
}
