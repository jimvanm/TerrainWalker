import numpy as np
T = np.load('cn_tower_tris.npy'); N = np.load('cn_tower_names.npy')
S = 553.3 / 1870.3
keep = ~(np.isin(N, ['Ground', 'Box001', 'Box002', 'Catwalk', 'Inner Bottom Railing', 'Shape001']) | np.array([str(n).startswith(('Edgewalk', 'Bottom Safety')) for n in N]))
Tb = T[keep].copy(); Tb[:, :, 0] -= 1.5; Tb[:, :, 2] -= 0.2; Tb[:, :, 1] += 1.9; Tb *= S    # metres, base at y=0
ymin = Tb[:, :, 1].min(1); ymax = Tb[:, :, 1].max(1)
def slice_pts(h):
    m = (ymin < h) & (ymax > h)
    tri = Tb[m]
    pts = []
    for a, b in ((0, 1), (1, 2), (2, 0)):
        p, q = tri[:, a], tri[:, b]
        d = q[:, 1] - p[:, 1]
        ok = (np.sign(p[:, 1] - h) != np.sign(q[:, 1] - h)) & (np.abs(d) > 1e-9)
        t = (h - p[ok, 1]) / d[ok]
        pts.append(p[ok] + (q[ok] - p[ok]) * t[:, None])
    return np.concatenate(pts) if pts else np.zeros((0, 3))
if __name__ == '__main__':
    print('height(m)  points   max radius   x-extent   z-extent   (true cross-sections)')
    for h in [1, 3, 6, 10, 20, 40, 60, 80, 100, 150, 200, 250, 300, 320, 330]:
        P = slice_pts(h)
        if len(P) == 0: print('%6.0f  none' % h); continue
        r = np.hypot(P[:, 0], P[:, 2])
        print('%6.0f  %6d   %8.1f   %6.1f..%6.1f   %6.1f..%6.1f' % (h, len(P), r.max(), P[:,0].min(), P[:,0].max(), P[:,2].min(), P[:,2].max()))
