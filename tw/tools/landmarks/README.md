# Landmark tools

Builds the simplified tower models that the app draws. The method is in
**PLAYBOOK.md**. Read that first.

In the app now: CN Tower, Eiffel Tower, Canton Tower (toggle with `T`).

## Files
Building:
- `towers.mjs`: tower builders. `cn`, `eiffel` and `canton` are measured and used.
  The other seven (Berlin, Tallinn, Ostankino, Tokyo, Space Needle, Skylon,
  Oriental Pearl) are rough drafts from published heights only. Not used.
- `mesh.mjs`: small mesh builder (metres, flat colour per part).
- `cn_profile.json`, `eiffel_profile.json`, `canton_profile.json`: measured numbers.
- `../bake_landmarks.mjs`: writes `src/landmark_models.js` for the app.
- `export.mjs`: writes `models.json`, used by the shadow scripts.

Measuring and checking (need the reference models, which are not in the repo):
- `oval_slices.py`: oval size, stretch and long-axis angle per height; tilted rim high point.
- `cn_slices.py`, `side_cn.py`, `compare_cn_side.py`: CN Tower measuring.
- `shadow_cn.py`, `shadow_eiffel.py`, `shadow_canton.py`: the shadow test.
  These have sandbox paths written in.

In the app (`src/`): `landmark_sites.js` (where each tower stands and which way it
faces), `landmarks.js` (drawing and the K-report), `orient.js` (direction from map
outlines), `landmark_models.js` (generated), `test_landmarks.mjs`.

## Reference models (supplied by Jim, not in the repo)
- CN Tower: GLB, CC-BY-4.0 by zayshaa on Sketchfab (credited in the main README).
- Eiffel Tower: `EiffelTower_fixed.stl`.
- Canton Tower: `____CantonTower_______.zip` (parts: skeleton and main structure),
  the main source; `Canton_Tower_-_62cm.zip` (full tower), for the oval and twist.

## Lessons from the first experiment
- Measuring by mesh corner points gave a false straight CN Tower shaft. Always cut
  through the triangles.
- The Eiffel reference was about 15% too wide for its height. Check scale against
  two published numbers.
- Guessed widths were badly wrong (the CN pod is about 49 m wide, not 72 m).
- The sandbox cannot reach Wikidata, OpenStreetMap's data service, Wikimedia Commons
  or model shops. Wikipedia works through the web fetch tool.
