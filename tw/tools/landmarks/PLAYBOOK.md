# How to model a landmark (the method that worked)

Three towers (CN, Eiffel, Canton) went from "nasty, guessed" to "flawless" once
this method was in place. The Canton Tower took minutes. Follow it in order.

## The idea in one line
Measure a real 3D model, rebuild it from a few solid shapes, then cast a shadow
of both and compare. Never build from published numbers alone: the proportions
come out wrong.

## What you need first
- A detailed reference 3D model (STL, GLB, OBJ) from the user. The sandbox cannot
  download one. A 3D-printing model is fine. Simpler is better.
- Two published numbers for scale: total height and one more (roof, deck, base).
  Wikipedia is reachable with the web fetch tool, not from the shell.
- A licence check. Only measurements are used, but credit CC-BY sources in the README.

## Steps
1. **Load it and learn the units.** Find the up-axis, the size, the lean. Check
   that the base is at the middle of the footprint. Print bounds per part.
2. **Fix the scale from two published numbers.** Total height and, say, roof height.
   If both agree with one scale, the model is trustworthy. If not, ask.
3. **Split off the clutter.** List part names (GLB) or connected pieces (STL).
   Leave out walkways, railings, fences, cables, podiums, loose print parts.
   They fool every measurement.
4. **Slice, do not sample vertices.** Cut each triangle at a height and read the
   crossing points. Long thin triangles hide between vertices, so vertex-only
   measuring reported a straight 22 m shaft on the CN Tower.
   - Never slice at a height that is exactly a ring height of your own model.
     Add 0.013 or the cut finds nothing.
5. **Turn slices into a profile** (a small JSON file per tower):
   - round towers: outer radius per height;
   - square legs: centre and width per height;
   - twisted or oval sections: fit an ellipse to the slice's outline (area
     moments of the convex hull give axes and angle);
   - anything tilted: store per-point heights (Canton's top ring is a tilted plane).
6. **Rebuild from solid shapes** in `towers.mjs` with `mesh.mjs`:
   straight-sided segments everywhere; curves only where the real thing is curved
   (the CN toroid, the Canton hourglass). Solid, not lattice. Duplicate a ring
   height to get a hard step or colour change.
7. **Shadow test.** Project both models onto a white screen from two sides, straight
   rays, black on white (`shadow_cn.py`, `shadow_eiffel.py`, `shadow_canton.py`).
   Do whole tower and 5x close-ups of every interesting part.
8. **Read the shadows, fix, repeat.** What the shadow test found:
   - a funnel that was really a square collar (CN);
   - arches standing upright when they lean with the legs (Eiffel);
   - a needle that was really a stepped cone (CN, Eiffel);
   - skywalk wire confusing the deck outline (CN).
   Overlap scores near 95-98% are good for a solid model of a solid structure.
   A lattice tower can never reach 100% against its own open lattice (Eiffel ~80%).
9. **Compare shaded renders too** (same camera, same light) for colour and form.
   Flat black outlines alone were not enough for the user.
10. **Bake and wire** (below).

## Wiring checklist
- `tools/bake_landmarks.mjs`: add the id to `KEEP`; run `node tools/bake_landmarks.mjs`.
- `src/landmark_sites.js`: id, name, lat, lon, `yawDeg`, `maskR` (metres). The mask
  hides ordinary map buildings under the tower. Use about the model's footprint radius.
- `src/test_landmarks.mjs`: add the height. Run it, plus the other `src/test_*.mjs`.
- README controls row, version in `src/config.js`.
- Render check: a bare page with a fake flat ground is enough for shape and size.

## When one reference is not enough
A simplified file can lose a real feature. The Canton parts file is round; the real
tower, and the fuller first file, are oval. Use both:
- **Take shape from the fuller file, size from the checked one.** The Canton oval's
  stretch (about 1.32 : 1 at the base, up to 1.42 higher up) and its twist (the long
  axis turns about 40 degrees from bottom to top) come from file 1. The radii stay
  from file 2, so the shadow match already done still holds. Ovals keep the round
  ring's area.
- **Line the two files up by a feature both have.** Files rarely share a frame.
  Canton: the high point of the tilted top rim (file 1 at 89.7 degrees, file 2 at
  -10), so file-1 angles minus 99.7 give file-2 angles.
- **Say which link is weak.** That line-up rests on one feature. Write it down in
  the profile JSON (`oval.note`) and in Known gaps.
- Tool: `oval_slices.py MODEL.stl --step 20 --top H --out rows.json` measures
  stretch, long-axis angle and centre per height. `--rim LO HI` finds a tilted
  rim's high point.

## Orientation (which way the model faces)
No 3D model, Wikidata or OSM field says which way a landmark faces (searched).
The map's own building outline does. `src/orient.js` compares the model's ground
footprint with the outline. The method depends on the footprint's shape:

| Footprint | Site settings | What is compared |
|---|---|---|
| square | `fold: 4` | main direction of straight edges |
| triangle | `fold: 3` | same |
| rectangle | `fold: 2` | same |
| oval | `fold: 2, oval: true` | long axis, from the outline's area (`ovalAxis`) |
| round | `fold: 0` | nothing: needs an outside cue |

1. Set the shape in `src/landmark_sites.js`. The model's footprint must really
   have that shape. A round model of an oval tower gives no direction.
2. Fly to the tower, wait until `near` in the HUD is complete, press `K`.
3. Read `landmarkOrientation`. `suggestedYawDeg` goes into `yawDeg`. Several
   outlines agreeing is the check. `note` says why there is no suggestion.
4. Bump the version and zip as usual.

Results so far:
- Eiffel Tower: 4 outlines gave 43.7 to 44.4 degrees. `yawDeg` 44.2. Confirmed by eye.
- CN Tower: `yawDeg` 0 looked right to the user. No K report taken.
- Canton Tower: oval matches the map and looks right. The top-ring lean follows the
  file line-up above and is not confirmed.

A feature that is not in the footprint (a lean, a tilted top) is only as good as the
model's own frame. Confirm it against a photo taken from a known direction before
calling it measured.

## Pitfall: the camera's longitude wraps
Flying east keeps counting past 180 (the HUD showed 362.29 in Paris). Anything placed
at a fixed longitude must use `wrapMercDx` from `src/geo.js` for its east-west
distance, in the drawing code and in the map-tile worker. Terrain already wraps.
The towers vanished in 0.11.4 for this reason.

## Delivering
- Name the zip by a NEW version. Never reuse one.
- Zip paths are relative to the project's `tw` folder (`src/...`, `tools/...`),
  with no wrapper folder. Include everything changed since the version the user has.
- Say what to restart (stop and start `serve.py`) and to hard-reload (Ctrl+Shift+R).
- Give a test URL with lat, lon, alt, yaw, pitch.

## Known gaps
- Canton Tower: the direction of the top-ring lean is not confirmed (see above).
- CN Tower: no K report; direction judged by eye only.
- Colours are chosen by eye, not from data.
- The shadow scripts and `oval_slices.py` need the reference models, which are not
  in the repo. The shadow scripts also have sandbox paths written in.
