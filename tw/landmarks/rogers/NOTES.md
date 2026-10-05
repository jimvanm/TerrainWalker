# Rogers Centre (stadium, roof open)

## Files (all in this folder)
- `landmark.json`: name, where it stands, which way it faces, height.
- `model.json`: the shape (generated, about 2,400 triangles).
- `build.mjs`: builds the shape from the profile. Run `node tools/bake_landmark.mjs rogers`.
- `profile.json`: measured numbers.
- `rogers_slices.py REF.stl profile.json`: takes the measurements from a 3D file.
- `shadow_rogers.py REF.stl model.json OUTDIR`: shadow test.

Listed in `landmarks/index.json`; nothing else to wire.

## Scale
- Height: 86 m from the field to the top of the open stack (The Weather Network).
- Width: 205.6 m east-west (Structurae; PBS gives 674 ft).
- One scale does not fit both: the measured shape is about 1.39 times too tall for its width, so height
  and width have separate scales. The north-south length (240 m) follows the width scale and is not checked.
- Field 7.5 m above the model base. The app sinks every landmark 6 m, so the field sits 1.5 m above
  the ground sample.

## Method for stadiums (concave, not a tower)
- **Outer wall = vertical bands.** Slice every 0.25 units, cast rays from the middle, and group the
  layers while the outline stays within 1.5 units. Each group becomes one straight-up wall, with a flat
  step to the next. (Lofting at a slant between different outlines twisted the faces.) Small facade
  notches are filled before the rays are cast.
- **Seating bowl = a loft** of the bowl edge per height (5 layers are enough).
- **Rays through the corners.** Add a ray at each end of a straight wall, so the wall stays straight
  to its corner. The map-outline direction check reads those edges.
- **A roof that runs sideways** (east-west arches stacked north-south): ray height maps of the top and
  the underside, then a few arch sections, lofted along north-south.
- **Shadow test:** cut both models 1 m above the field. Also compare vertical cuts through the middle,
  because the bowl does not show in an outline.

Results: outline overlap 99.4% (from the south), 99.4% (from the east), 97.9% (from above); roof 98.9% and 99.4%.

## Direction
`yawDeg` 0 puts the fixed roof panel and the open stack at the north end (Wikipedia). The CN Tower in
the same file sits 57 degrees east of north from the stadium; in reality it is 53 degrees. So the file's
frame (x east, z south) is right. Footprint edges are weak (strength 0.37, `fold: 4`). No K report yet.

## Known gaps
- Roof built open, as in the model.
- Field and diamond about 20% smaller than real (the measured stands are thick).
- The terrain is a surface model: if it has a bump at the stadium, the ground sample can be high, and
  the bump can show through the open field.
- Colours chosen by eye.
