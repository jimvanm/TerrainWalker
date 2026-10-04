import math, numpy as np
from PIL import Image, ImageDraw
import render as R
T = np.load('cn_tower_tris.npy'); S = 553.3 / 1870.3
N = np.load('cn_tower_names.npy'); kp = ~(np.isin(N, ['Ground','Box001','Box002','Catwalk','Inner Bottom Railing','Shape001']) | np.array([str(n).startswith(('Edgewalk','Bottom Safety')) for n in N]))
T = T[kp]
v = T.reshape(-1, 3).copy()
v[:, 0] -= 1.5; v[:, 2] -= 0.2; v[:, 1] += 1.9; v *= S
ref_idx = np.arange(len(v)).reshape(-1, 3); ref_col = np.tile(np.array([176, 174, 168.0]), (len(v), 1))
A = R.mesh_arrays('cn')
def view(mesh, az, W, H, look_y, span, dist=6000):
    a = math.radians(az)
    cam = (dist * math.sin(a), look_y, dist * math.cos(a))
    fov = 2 * math.degrees(math.atan(span / dist))
    return R.render([mesh], cam, (0, look_y, 0), W, H, fov=fov, ss=2, light=(-0.45, 0.78, 0.42))
f = R.font(15, True)
for az in (0, 90):
    # whole tower
    W, H = 300, 760
    sh = Image.new('RGB', (W * 2 + 10, H + 40), (248, 248, 246)); d = ImageDraw.Draw(sh)
    for i, (t, m) in enumerate([('Reference model', (v, ref_col, ref_idx)), ('Simple version', A)]):
        d.text((i * (W + 10) + 4, 10), t, fill=(20, 20, 20), font=f)
        sh.paste(view(m, az, W, H, 285, 292), (i * (W + 10), 36))
    sh.save('side_shaded_whole_%d.png' % az)
    # deck close-up
    W, H = 520, 520
    sh = Image.new('RGB', (W * 2 + 10, H + 40), (248, 248, 246)); d = ImageDraw.Draw(sh)
    for i, (t, m) in enumerate([('Reference model', (v, ref_col, ref_idx)), ('Simple version', A)]):
        d.text((i * (W + 10) + 4, 10), t, fill=(20, 20, 20), font=f)
        sh.paste(view(m, az, W, H, 345, 75), (i * (W + 10), 36))
    sh.save('side_shaded_deck_%d.png' % az)
print('ok')
