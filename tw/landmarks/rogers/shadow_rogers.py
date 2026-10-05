# Shadow test for the Rogers Centre: reference STL (stadium piece) vs the rebuilt model.
# Usage (from this folder): python3 shadow_rogers.py REF.stl model.json OUTDIR
# The reference is put in the model's frame (two scales, lift) and both are cut at field level.
import sys, json, numpy as np, trimesh
from PIL import Image, ImageDraw
ref_path, models_path, out = sys.argv[1], sys.argv[2], sys.argv[3]
P = json.load(open(__file__.rsplit('/', 1)[0] + '/profile.json'))
SH, SV, L, G0, (CX, CZ) = P['scale_h'], P['scale_v'], P['lift'], P['ground'], P['centre']
s = trimesh.load(ref_path)
if len(s.split(only_watertight=False)) > 1:   # the full file: keep the stadium piece
    s = max(s.split(only_watertight=False), key=lambda p: len(p.faces))
CUT = G0 + 1.0 / SV                          # both cut 1 m above the field (leaves out field markings)
s = trimesh.intersections.slice_mesh_plane(s, [0, 1, 0], [0, CUT, 0])
R = s.triangles.copy(); R[:, :, 0] = (R[:, :, 0] - CX) * SH; R[:, :, 2] = (R[:, :, 2] - CZ) * SH; R[:, :, 1] = L + (R[:, :, 1] - G0) * SV
txt = open(models_path).read(); m = json.loads(txt[txt.index('{'):txt.rindex('}') + 1])
pos = np.array(m['pos']).reshape(-1, 3); M = pos[np.array(m['idx']).reshape(-1, 3)]
mm = trimesh.Trimesh(pos, np.array(m['idx']).reshape(-1, 3), process=False)
M = trimesh.intersections.slice_mesh_plane(mm, [0, 1, 0], [0, L + 1.0, 0]).triangles
def sil(T, a, b, box, W, H, flip=False):
    x0, x1, y0, y1 = box
    im = Image.new('L', (W, H), 0); d = ImageDraw.Draw(im)
    X = (T[:, :, a] - x0) / (x1 - x0) * W; Y = (T[:, :, b] - y0) / (y1 - y0) * H
    if not flip: Y = H - Y
    for i in range(len(T)): d.polygon([(X[i, k], Y[i, k]) for k in range(3)], fill=255)
    return np.array(im) > 0
def sheet(name, views):
    tiles, scores = [], []
    for (a, b, box, W, H, flip, label) in views:
        A = sil(R, a, b, box, W, H, flip); B = sil(M, a, b, box, W, H, flip)
        scores.append((label, round(float((A & B).sum() / max((A | B).sum(), 1)), 3)))
        diff = np.full((H, W, 3), 255, np.uint8); diff[A & B] = (30, 30, 30); diff[A & ~B] = (220, 40, 40); diff[~A & B] = (40, 90, 230)
        tiles += [np.where(A, 30, 255).astype(np.uint8), np.where(B, 30, 255).astype(np.uint8), diff]
    Wt = sum(t.shape[1] for t in tiles) + 10 * len(tiles); Ht = max(t.shape[0] for t in tiles)
    img = Image.new('RGB', (Wt, Ht), (120, 120, 120)); x = 0
    for t in tiles:
        img.paste(Image.fromarray(t).convert('RGB'), (x, 0)); x += t.shape[1] + 10
    img.save(f'{out}/{name}'); print(name, scores)
# views: from the south (x across), from the east (z across), from above (x, z; north up)
sheet('shadow_rogers_whole.png', [
    (0, 1, (-115, 115, 0, 100), 460, 200, False, 'from south'),
    (2, 1, (-125, 125, 0, 100), 500, 200, False, 'from east'),
    (0, 2, (-115, 115, -125, 125), 460, 500, True, 'from above')])
sheet('shadow_rogers_roof.png', [
    (0, 1, (-110, 110, 55, 100), 880, 180, False, 'roof from south'),
    (2, 1, (-125, -40, 55, 100), 680, 360, False, 'roof from east')])
