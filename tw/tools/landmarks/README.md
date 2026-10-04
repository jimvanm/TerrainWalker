# Landmark towers experiment

Toy-resolution models of famous towers, for Terrain Walker. Nothing here is in the app yet.

## What is finished
- **Eiffel Tower** and **CN Tower**: shapes measured from detailed reference models Jim supplied, then rebuilt as
  simple solid models (about 750 triangles each). Sizes anchored to published heights.
  - `eiffel_profile.json`, `cn_profile.json` hold the measured numbers.
  - Picture checks: `compare_eiffel.png`, `compare_legs.png`, `compare_cn.png`.

## What is only a rough draft
- The other eight towers (Berlin, Tallinn, Ostankino, Tokyo, Space Needle, Skylon, Oriental Pearl, Canton).
  Heights are from published sources. Widths and shapes are estimates, so proportions are probably off.
  See `out_lineup.png` and the `out_*.png` cards.

## Files
- `mesh.mjs` small mesh builder (units: metres, flat colour per part)
- `towers.mjs` the ten tower builders. `export.mjs` writes `models.json`.
- `render.py` picture maker used for the previews (a simple software renderer, not the app's look)
- `glb.py`, `cn_slices.py`, `fit_eiffel_legs.py`, `compare_*.py`, `sections_eiffel.py` measuring and checking scripts

## How a tower was made from a reference model
1. Load the model, work out units and which way is up.
2. Cut through the triangles at many heights (not just the mesh corner points; long triangles hide in between).
3. Read off outline, leg or wing size, platform levels, pod and mast sizes.
4. Anchor sizes to published heights and widths where the model disagrees with them.
5. Rebuild from a few solid shapes. Draw it next to the reference and check.

## Lessons
- Slicing by mesh corner points gave a false straight CN Tower shaft. Always cut through the triangles.
- The Eiffel reference model was about 15% wider than the real tower for its height.
- Guessed widths were badly wrong (the CN pod is about 49 m wide, not 72 m).
- The sandbox cannot reach Wikidata, OpenStreetMap's data service, Wikimedia Commons or model shops.
  skyscraperpage.com pages were readable (its diagram pages are blocked by robots rules).

## Not started
The Wikidata landmark list script, the "how far can you see it" rules, and drawing landmarks in the app.

## Credits
- CN Tower measurements: Sketchfab model "CN Tower" by zayshaa, CC-BY-4.0
  (https://sketchfab.com/3d-models/cn-tower-532b6478637c4f6894d9070719a45aaa). Only measurements were used.
- Eiffel Tower measurements: STL file supplied by Jim (source not recorded).
