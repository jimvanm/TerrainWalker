# Measure the Rogers Centre (stadium only) from the reference STL into rogers_profile.json.
# Usage (from this folder): python3 rogers_slices.py REF.stl profile.json
# Body: slices through triangles, rays from the middle. Roof stack: ray height maps, then arch sections.
# Reference units, y up, x east, z south (the CN Tower in the same file sits north-east, as in reality).
import trimesh, numpy as np, json
from shapely.geometry import Polygon, LineString, Point
from shapely.ops import unary_union

import sys
from shapely.geometry import box as sbox
from scipy.interpolate import RegularGridInterpolator
REF, OUT = sys.argv[1], sys.argv[2]
s = trimesh.load(REF)
if len(s.split(only_watertight=False)) > 1:   # the full file: keep the biggest piece (stadium and base plate)
    s = max(s.split(only_watertight=False), key=lambda p: len(p.faces))
GROUND, TOP = 7.0, float(s.bounds[1][1])

def loops(axis_pt, normal, h):
    sec = s.section(plane_origin=axis_pt, plane_normal=normal)
    return [] if sec is None else sec.discrete

# footprint centre (outline just above the plate)
L = loops([0, 7.3, 0], [0, 1, 0], 7.3)
big = max(L, key=lambda e: Polygon(e[:, [0, 2]]).area)
bx = big[:, 0]; bz = big[:, 2]
CX, CZ = (bx.min() + bx.max()) / 2, (bz.min() + bz.max()) / 2
print('centre', CX, CZ, 'size', bx.max() - bx.min(), bz.max() - bz.min())

N = 48
# Rays: evenly spread, plus one through each end of the straight east and west walls, so the walls
# stay straight to their corners (this is what the map-outline direction check reads).
gx, gz = big[:, 0], big[:, 2]
corners = []
for xs_ in (gx.min(), gx.max()):
    side = big[np.abs(gx - xs_) < 1.0]
    corners += [(xs_, side[:, 2].min()), (xs_, side[:, 2].max())]
CA = [np.arctan2(z - CZ, x - CX) % (2 * np.pi) for x, z in corners]
U = np.linspace(0, 2 * np.pi, N - 4, endpoint=False)
U = np.array([a for a in U if min(abs((a - c + np.pi) % (2 * np.pi) - np.pi) for c in CA) > 0.06] )
ANG = np.sort(np.concatenate([U, CA]))
N = len(ANG)
print('corners', np.round(corners, 2), 'rays', N)
def ray_hits(ring, a):
    far = (CX + 400 * np.cos(a), CZ + 400 * np.sin(a))
    inter = LineString([(CX, CZ), far]).intersection(ring)
    pts = []
    for g in getattr(inter, 'geoms', [inter]):
        if g.is_empty: continue
        if g.geom_type == 'Point': pts.append(g)
        else: pts += [Point(c) for c in g.coords]
    return sorted(np.hypot(p.x - CX, p.y - CZ) for p in pts)

def body_layer(y):
    ls = [Polygon(e[:, [0, 2]]) for e in loops([0, y, 0], [0, 1, 0], y)]
    ls = [p.buffer(0) for p in ls if p.area > 1]
    outer = max(ls, key=lambda p: p.area)
    holes = [p for p in ls if p is not outer and outer.contains(p.representative_point()) and p.contains(Point(CX, CZ))]
    hole = max(holes, key=lambda p: p.area) if holes else None
    outer = outer.buffer(3.0, join_style=2).buffer(-3.0, join_style=2)   # fill the small facade notches (pilasters)
    ro, ri = [], []
    for a in ANG:
        ro.append(ray_hits(outer.exterior, a)[-1])
        ri.append(ray_hits(hole.exterior, a)[0] if hole else 0.0)
    return np.array(ro), np.array(ri)

# body layers: dense, then keep only the ones that are needed
ys = np.round(np.concatenate([np.arange(7.05, 45.5, 0.25), [45.45]]), 3)
layers = [(y, *body_layer(y)) for y in ys]
def pick(layers, tol):
    keep = [0]
    i = 0
    while i < len(layers) - 1:
        j = i + 2
        while j < len(layers):
            ok = True
            for k in range(i + 1, j):
                t = (layers[k][0] - layers[i][0]) / (layers[j][0] - layers[i][0])
                for q in (2,):   # the bowl only; the outer wall is done as bands below
                    if np.max(np.abs(layers[i][q] + t * (layers[j][q] - layers[i][q]) - layers[k][q])) > tol: ok = False
            if not ok: break
            j += 1
        i = j - 1
        keep.append(i)
    return [layers[k] for k in keep]
body = pick(layers, 3.5)

# outer wall as vertical bands: group the dense layers while the outline stays within TOL of the
# group's mean; each band is one straight-up wall, with a flat step to the next band
TOL = 1.5
walls, grp = [], [layers[0]]
def close_band(g, y1):
    walls.append({'y0': float(g[0][0]) if not walls else walls[-1]['y1'], 'y1': float(y1),
                  'r': [round(float(v), 3) for v in np.median([q[1] for q in g], axis=0)]})
for q in layers[1:]:
    cand = grp + [q]; med = np.median([c[1] for c in cand], axis=0)
    if max(np.max(np.abs(c[1] - med)) for c in cand) > TOL:
        close_band(grp, (grp[-1][0] + q[0]) / 2); grp = [q]
    else: grp = cand
close_band(grp, layers[-1][0])
walls[0]['y0'] = float(GROUND)
merged = []
for w in walls:   # a band under 1 unit high is a sliver: fold it into the one below
    if merged and w['y1'] - w['y0'] < 1.0: merged[-1]['y1'] = w['y1']
    else: merged.append(w)
walls = merged
print('wall bands', [(round(w['y0'], 2), round(w['y1'], 2)) for w in walls])
print('body layers', len(body), [l[0] for l in body])

# side walls above the rim (east and west), cut at y = 47; the roof stack is cut away by the boxes
u = unary_union([Polygon(e[:, [0, 2]]).buffer(0) for e in loops([0, 47, 0], [0, 1, 0], 47)])
par = []
for side, (x0, x1) in (('west', (0, 21)), ('east', (108.4, 160))):
    q = u.intersection(sbox(x0, 20, x1, 200)); q = max(getattr(q, 'geoms', [q]), key=lambda g: g.area).simplify(4.0)
    par.append({'side': side, 'top': 48.34, 'poly': [[round(a, 3), round(b, 3)] for a, b in np.array(q.exterior.coords)[:-1]]})

# roof stack: height maps of the top surface and the underside (rays straight down)
xs = np.arange(8.0, 122.01, 0.5); zs = np.arange(11.0, 57.01, 0.25)
X, Z = np.meshgrid(xs, zs)
o = np.stack([X.ravel(), np.full(X.size, 100.0), Z.ravel()], 1)
it = s.ray
loc, ri, _ = it.intersects_location(o, np.tile([0, -1, 0], (len(o), 1)), multiple_hits=True)
top = np.full(len(o), np.nan);
for p, r in zip(loc, ri):
    if np.isnan(top[r]) or p[1] > top[r]: top[r] = p[1]
# every hit below the top, to find the shell underside: the highest hit that is a "bottom" surface
hits = {}
for p, r in zip(loc, ri): hits.setdefault(r, []).append(p[1])
under = np.full(len(o), np.nan)
for r, hs in hits.items():
    hs = sorted(hs, reverse=True)
    if len(hs) >= 2: under[r] = hs[1]    # second crossing going down = underside of the topmost solid
top = top.reshape(X.shape); under = under.reshape(X.shape)
RIM, PAR = 45.45, 48.34
M = 13
T = RegularGridInterpolator((zs, xs), np.nan_to_num(top, nan=0), bounds_error=False, fill_value=0)
U = RegularGridInterpolator((zs, xs), np.nan_to_num(under, nan=0), bounds_error=False, fill_value=0)
ends = []
for j, z in enumerate(zs):
    if z > 54.3: continue
    ok = top[j] > PAR + 0.3
    if ok.sum() < 3: continue
    i0, i1 = np.argmax(ok), len(ok) - 1 - np.argmax(ok[::-1])
    ends.append((z, xs[i0] - 0.25, xs[i1] + 0.25))
ends = np.array(ends)
dome = ends[ends[:, 0] < 30.1]; barrel = ends[ends[:, 0] > 30.4]
# smooth the dome's ends (the grid is 0.5 wide, the dome edge is a smooth curve)
# the dome's edge in plan is a circle arc: fit it (centre on the x middle line)
pts = np.concatenate([np.stack([dome[:, 1], dome[:, 0]], 1), np.stack([dome[:, 2], dome[:, 0]], 1)])
A = np.stack([2 * pts[:, 0], 2 * pts[:, 1], np.ones(len(pts))], 1); b = (pts ** 2).sum(1)
(cx_, cz_, c_), *_ = np.linalg.lstsq(A, b, rcond=None); R_ = np.sqrt(c_ + cx_ ** 2 + cz_ ** 2)
print('dome edge circle', cx_, cz_, R_)
def edge(z): h = np.sqrt(max(R_ ** 2 - (z - cz_) ** 2, 0)); return cx_ - h, cx_ + h
pl = pr = None
bl, br = barrel[:, 1].min(), barrel[:, 2].max()
print('dome z', dome[0, 0], dome[-1, 0], 'barrel x', bl, br, 'fit err', max(np.abs(edge(z)[0]-x0) for z,x0,_ in dome))
def section(z):
    if z <= 30.1: x0, x1 = edge(z)
    else: x0, x1 = bl, br
    xq = np.linspace(x0, x1, M)
    xs_ = xq.copy(); xs_[0] += 0.6; xs_[-1] -= 0.6
    P = np.stack([np.full(M, z), xs_], 1)
    o = T(P); i = U(P)
    bad = (i > o - 0.3) | (i < RIM); i[bad] = RIM
    o = np.maximum(o, i + 0.01)
    foot = RIM if z <= 30.1 else PAR
    o[0] = o[-1] = foot; i[0] = i[-1] = min(foot, RIM)   # the ends sit on the rim or the wall top
    return [float(z), xq, o, i]
zz = np.concatenate([[13.5, 15.0, 17.0, 20.0, 24.0], [30.0, 30.5, 30.75, 34.75, 35.0, 48.25, 48.5, 52.75, 53.0, 54.25]])
secs = [section(z) for z in zz]
def pick3(secs, tol):
    keep = [0]; i = 0
    while i < len(secs) - 1:
        j = i + 2
        while j < len(secs):
            good = True
            for k in range(i + 1, j):
                tt = (secs[k][0] - secs[i][0]) / (secs[j][0] - secs[i][0])
                for q in (1, 2, 3):
                    if np.max(np.abs(secs[i][q] + tt * (secs[j][q] - secs[i][q]) - secs[k][q])) > tol: good = False
            if not good: break
            j += 1
        i = j - 1; keep.append(i)
    return [secs[k] for k in keep]
# a few fixed sections: the dome's curve, then the barrel panels with their two raised ribs
KEEP_Z = [13.5, 15.0, 17.0, 20.0, 24.0, 30.0, 30.5, 30.75, 34.75, 35.0, 48.25, 48.5, 52.75, 53.0, 54.25]
st = [q for q in secs if any(abs(q[0] - k) < 1e-6 for k in KEEP_Z)]
print(len(secs), '->', len(st), [round(s[0], 2) for s in st])

prof = json.load(open(OUT)) if __import__('os').path.exists(OUT) else {}
prof.update({
    'ground': GROUND, 'top': round(TOP, 3), 'centre': [round(CX, 3), round(CZ, 3)], 'rays': N, 'angles': [round(float(a), 5) for a in ANG],
    'walls': walls,
    'body': [{'y': float(y), 'outer': [round(v, 3) for v in ro], 'inner': [round(v, 3) for v in ri]} for y, ro, ri in body],
    'parapets': par,
    'stack': [{'z': round(q[0], 3), 'x': [round(v, 3) for v in q[1]], 'out': [round(v, 3) for v in q[2]], 'in': [round(v, 3) for v in q[3]]} for q in st],
})
json.dump(prof, open(OUT, 'w'), separators=(',', ':'))
print('wrote', OUT)
