# Landmark tools

Builds the simplified models the app draws. The method is in **PLAYBOOK.md**.
Read that first. The landmarks themselves, one folder each, are in
`landmarks/` (see `landmarks/README.md` for adding and removing one).

## Here
- `shared.mjs`: helpers every builder uses: the mesh builder (`mesh.mjs`),
  colours, legs, masts, profile lookup.
- `mesh.mjs`: small mesh builder (metres, flat colour per part).
- `../bake_landmark.mjs <id|all>`: runs `landmarks/<id>/build.mjs` and writes
  `landmarks/<id>/model.json`.
- `oval_slices.py`: oval size, stretch and long-axis angle per height; tilted
  rim high point. For any landmark.
- `drafts.mjs`: seven rough towers from published heights only (Berlin,
  Tallinn, Ostankino, Tokyo, Space Needle, Skylon, Oriental Pearl) and the first
  Canton draft. Not measured, not used. `export.mjs` writes them to
  `drafts.json` for a look.

## In each landmark's folder
`build.mjs`, `profile.json`, its measuring and shadow-test scripts, and notes.
Run the scripts from inside the folder; they read `profile.json` and
`model.json` there.

## Lessons from the first experiment
- Measuring by mesh corner points gave a false straight CN Tower shaft. Always cut
  through the triangles.
- The Eiffel reference was about 15% too wide for its height. Check scale against
  two published numbers.
- Guessed widths were badly wrong (the CN pod is about 49 m wide, not 72 m).
- The sandbox cannot reach Wikidata, OpenStreetMap's data service, Wikimedia Commons
  or model shops. Wikipedia works through the web fetch tool.
