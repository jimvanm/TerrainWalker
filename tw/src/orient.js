// Landmark direction from the map's own building outlines.
//
// A building outline on the map carries its heading in the direction of its edges.
// The model's footprint carries the same thing. The turn needed is the difference
// between the two. No searching and no overlap scoring.
//
// Conventions (compass style):
//   points are [east, north] in true metres, relative to the landmark's centre
//   a bearing is degrees clockwise from north
//   yaw is the clockwise turn applied to the model, as in landmarks.js

const D2R = Math.PI / 180, R2D = 180 / Math.PI;

// Wrap into (-half, half], where half is half a period.
export function wrapTo(deg, period) {
  const h = period / 2;
  let d = ((deg % period) + period) % period;     // 0..period
  if (d > h) d -= period;
  return d;
}

// Convex hull of [e, n] points (monotone chain). Returns the corners in order.
export function hull(points) {
  const p = points.map((q) => [q[0], q[1]]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  if (p.length < 3) return p;
  const cross = (o, a, b) => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo = [], up = [];
  for (const q of p) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = p.length - 1; i >= 0; i--) { const q = p[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  lo.pop(); up.pop();
  return lo.concat(up);
}

export function polygonArea(ring) {
  let a = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) a += ring[j][0] * ring[i][1] - ring[i][0] * ring[j][1];
  return Math.abs(a) / 2;
}

// Edges of a closed ring as flat [e1, n1, e2, n2, ...].
export function edgesOf(ring) {
  const out = [];
  for (let i = 0; i < ring.length; i++) { const a = ring[i], b = ring[(i + 1) % ring.length]; out.push(a[0], a[1], b[0], b[1]); }
  return out;
}

// The direction the edges mostly run, as a bearing, for a shape that repeats
// every 360/fold degrees (a square: fold 4; a triangle: fold 3; a rectangle: fold 2).
// Long edges count for more. strength is 0 for no preferred direction (a circle)
// up to 1 for all edges agreeing.
export function dominantBearing(edges, fold) {
  if (!fold) return { bearing: 0, strength: 0 };
  let sx = 0, sy = 0, w = 0;
  for (let i = 0; i < edges.length; i += 4) {
    const de = edges[i + 2] - edges[i], dn = edges[i + 3] - edges[i + 1];
    const len = Math.hypot(de, dn);
    if (len < 1e-9) continue;
    const th = Math.atan2(de, dn);                // bearing of the edge, radians
    sx += len * Math.cos(fold * th); sy += len * Math.sin(fold * th); w += len;
  }
  if (!w) return { bearing: 0, strength: 0 };
  return { bearing: wrapTo((Math.atan2(sy, sx) / fold) * R2D, 360 / fold), strength: Math.hypot(sx, sy) / w };
}

// Suggested yaw for one map outline: the turn that lines the model's edges up with its.
export function suggestYaw(modelEdges, mapEdges, fold) {
  const m = dominantBearing(modelEdges, fold), o = dominantBearing(mapEdges, fold);
  return { yaw: wrapTo(o.bearing - m.bearing, 360 / fold), modelStrength: m.strength, mapStrength: o.strength };
}

// Turn [e, n] points about the origin by a clockwise compass angle.
export function turnPoints(points, yawDeg) {
  const c = Math.cos(yawDeg * D2R), s = Math.sin(yawDeg * D2R);
  return points.map(([e, n]) => [e * c + n * s, -e * s + n * c]);
}

// The long axis of an oval shape (an ellipse-like outline), as a bearing from north
// repeating every 180 degrees, plus how stretched it is (1 = round). It uses the
// outline's area, so it does not care how many corners the outline has.
export function ovalAxis(points) {
  const h = hull(points);
  if (h.length < 3) return { bearing: 0, stretch: 1 };
  let A = 0, cx = 0, cy = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], c = a[0] * b[1] - b[0] * a[1];
    A += c; cx += (a[0] + b[0]) * c; cy += (a[1] + b[1]) * c;
  }
  A /= 2; cx /= 6 * A; cy /= 6 * A;
  let ixx = 0, iyy = 0, ixy = 0;
  for (let i = 0; i < h.length; i++) {
    const a = h[i], b = h[(i + 1) % h.length], c = a[0] * b[1] - b[0] * a[1];
    ixx += (a[1] * a[1] + a[1] * b[1] + b[1] * b[1]) * c;
    iyy += (a[0] * a[0] + a[0] * b[0] + b[0] * b[0]) * c;
    ixy += (a[0] * b[1] + 2 * a[0] * a[1] + 2 * b[0] * b[1] + b[0] * a[1]) * c;
  }
  const sxx = iyy / 12 / A - cx * cx, syy = ixx / 12 / A - cy * cy, sxy = ixy / 24 / A - cx * cy;   // spread east, north
  const th = 0.5 * Math.atan2(2 * sxy, sxx - syy);                                                    // long axis, ccw from east
  const mean = (sxx + syy) / 2, diff = Math.hypot((sxx - syy) / 2, sxy);
  return { bearing: wrapTo(90 - th * R2D, 180), stretch: Math.sqrt((mean + diff) / Math.max(mean - diff, 1e-12)) };
}
