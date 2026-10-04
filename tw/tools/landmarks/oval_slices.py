"""Measure a tower's cross-section, slice by slice, from a reference model.

For each height it cuts the model (through triangles, not by vertices), takes the
outer outline (convex hull), and fits an oval from the outline's area. It prints
and saves, per height: centre, long and short half-widths, stretch (long / short)
and the long-axis angle. It can also find the high point of a tilted top rim,
which is a feature two reference files of the same tower can be lined up by.

Usage (from tools/landmarks/):
  python3 oval_slices.py MODEL.stl --step 20 --top 440 --out oval_rows.json
  python3 oval_slices.py MODEL.stl --rim 420 480 --rmin 12 --rmax 25

  MODEL.stl     binary or text STL, z up (most STL files are)
  --step/--top  slice every STEP model units from the bottom up to TOP
  --rim LO HI   also fit the top rim between heights LO and HI: reports the
                direction of its high point
  --rmin/--rmax only rim points this far from the centre count

Angles are in the file's own frame: degrees counter-clockwise from +x, with +y
taken as north. Nothing here knows the real compass direction; the map outline
supplies that later (see PLAYBOOK.md, Orientation).
Needs numpy and scipy.
"""
import argparse, json, struct
import numpy as np
from scipy.spatial import ConvexHull


def load_stl(path):
    data = open(path, 'rb').read()
    if len(data) >= 84:
        n = struct.unpack('<I', data[80:84])[0]
        if 84 + 50 * n == len(data):                       # binary
            rec = np.frombuffer(data[84:], dtype=np.dtype([('n', '<f4', 3), ('v', '<f4', (3, 3)), ('a', '<u2')]), count=n)
            return rec['v'].astype(float)
    pts = [list(map(float, l.split()[1:4])) for l in data.decode('latin-1').splitlines() if l.strip().startswith('vertex')]
    return np.array(pts).reshape(-1, 3, 3)


def slice_points(T, z):
    z += 0.013                                             # never cut exactly at a ring of vertices
    d = T[:, :, 2] - z
    s = np.sign(d)
    m = (s.min(1) < 0) & (s.max(1) > 0)
    pts = []
    for tri, dd in zip(T[m], d[m]):
        for a, b in ((0, 1), (1, 2), (2, 0)):
            if dd[a] * dd[b] < 0:
                t = dd[a] / (dd[a] - dd[b])
                pts.append(tri[a] + t * (tri[b] - tri[a]))
    return np.array(pts)[:, :2] if pts else np.zeros((0, 2))


def oval_fit(P):
    """Oval with the same area spread as the outline's convex hull."""
    V = P[ConvexHull(P).vertices]
    x, y = V[:, 0], V[:, 1]
    x2, y2 = np.roll(x, -1), np.roll(y, -1)
    c = x * y2 - x2 * y
    A = c.sum() / 2
    cx = ((x + x2) * c).sum() / (6 * A)
    cy = ((y + y2) * c).sum() / (6 * A)
    Ixx = ((y * y + y * y2 + y2 * y2) * c).sum() / 12 - A * cy * cy
    Iyy = ((x * x + x * x2 + x2 * x2) * c).sum() / 12 - A * cx * cx
    Ixy = ((x * y2 + 2 * x * y + 2 * x2 * y2 + x2 * y) * c).sum() / 24 - A * cx * cy
    w, v = np.linalg.eigh(np.array([[Iyy, Ixy], [Ixy, Ixx]]) / A)
    a, b = 2 * np.sqrt(w[1]), 2 * np.sqrt(w[0])
    ang = np.degrees(np.arctan2(v[1, 1], v[0, 1])) % 180
    return cx, cy, a, b, ang


def rim_peak(T, lo, hi, rmin, rmax, centre):
    P = T.reshape(-1, 3)
    r = np.hypot(P[:, 0] - centre[0], P[:, 1] - centre[1])
    az = np.degrees(np.arctan2(P[:, 1] - centre[1], P[:, 0] - centre[0])) % 360
    m = (r > rmin) & (r < rmax) & (P[:, 2] > lo) & (P[:, 2] < hi)
    bins = np.arange(0, 360, 10)
    h = [P[m & (az >= b) & (az < b + 10), 2].max() for b in bins]
    x = np.radians(bins + 5)
    A = np.c_[np.ones_like(x), np.cos(x), np.sin(x)]
    co = np.linalg.lstsq(A, np.array(h), rcond=None)[0]
    return {'mean': co[0], 'amp': float(np.hypot(co[1], co[2])),
            'peak_deg': float(np.degrees(np.arctan2(co[2], co[1])) % 360),
            'worst_misfit': float(np.abs(A @ co - h).max())}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('stl')
    ap.add_argument('--step', type=float, default=20)
    ap.add_argument('--top', type=float, default=None)
    ap.add_argument('--out', default=None)
    ap.add_argument('--rim', type=float, nargs=2, default=None)
    ap.add_argument('--rmin', type=float, default=0)
    ap.add_argument('--rmax', type=float, default=1e9)
    o = ap.parse_args()
    T = load_stl(o.stl)
    lo, hi = T[:, :, 2].min(), T[:, :, 2].max()
    print('model height range', round(lo, 2), round(hi, 2))
    top = o.top if o.top is not None else hi
    rows, last = [], None
    z = lo + 1
    while z <= top:
        P = slice_points(T, z)
        if len(P) >= 3:
            cx, cy, a, b, ang = oval_fit(P)
            last = (cx, cy)
            rows.append([round(z, 2), round(a / b, 3), round(ang, 1), round(a, 2), round(b, 2), round(cx, 2), round(cy, 2)])
            print(f'z {z:8.2f}  centre ({cx:8.2f},{cy:8.2f})  half-widths {a:7.2f} {b:7.2f}  stretch {a / b:.3f}  axis {ang:6.1f}')
        z += o.step
    if o.out:
        json.dump({'columns': ['z', 'stretch', 'axis_deg', 'long_half', 'short_half', 'cx', 'cy'], 'rows': rows}, open(o.out, 'w'))
        print('wrote', o.out)
    if o.rim and last:
        print('top rim', rim_peak(T, o.rim[0], o.rim[1], o.rmin, o.rmax, last))


if __name__ == '__main__':
    main()
