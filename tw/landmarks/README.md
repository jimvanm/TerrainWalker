# Landmarks

Each landmark is one folder here. `index.json` is the list of the ones the app
shows. Nothing else in the project needs to change to add or remove one.

## Add a landmark

1. Put its folder here, for example `landmarks/rogers/`.
2. Add its folder name to `index.json`.
3. Run the tests: `node test/run.mjs landmarks` (from the `tw` folder). They
   check every listed landmark the same way, so there is nothing to add to them.

## Remove a landmark

Take its name out of `index.json`. The folder can stay, or be deleted.

## What is in a folder

| File | What it is |
|---|---|
| `landmark.json` | name, where it stands, which way it faces, height (below) |
| `model.json` | the shape. Generated: do not edit by hand |
| `build.mjs` | makes the shape from the measurements |
| `profile.json` | the measurements |
| `NOTES.md` | method and known gaps (optional) |
| `*.py` | measuring and shadow-test scripts (optional) |

After changing `build.mjs` or `profile.json`, remake the shape:

```
node tools/bake_landmark.mjs rogers     (one landmark)
node tools/bake_landmark.mjs all        (every listed landmark)
```

The test fails if `model.json` no longer matches what `build.mjs` makes, so a
forgotten bake is caught.

## landmark.json

```json
{
  "name": "Rogers Centre",
  "city": "Toronto",
  "lat": 43.641389,
  "lon": -79.389167,
  "height": 93.5,
  "yawDeg": 0,
  "fold": 4,
  "maskR": 95
}
```

- `lat`, `lon`: the middle of the base.
- `height`: metres, the top of the shape. The test checks the shape agrees.
- `yawDeg`: clockwise turn of the shape, seen from above. The `K` report
  suggests a value from the map's building outline (see
  `tools/landmarks/PLAYBOOK.md`, Orientation).
- `fold`: the footprint's shape, for that suggestion: 4 square, 3 triangle,
  2 rectangle (add `"oval": true` for an oval), 0 round.
- `maskR`: metres around the middle. Ordinary map buildings touching this
  circle are not drawn, so they do not poke through the model.
- `name`, `lat`, `lon`, `height` and `maskR` are required. A landmark with a
  missing or wrong field is left out, with a warning in the browser console
  naming the field.

## How the app uses them

At start the app reads `index.json` and every `landmark.json`: a few hundred
bytes each. A shape (`model.json`, 50 to 300 KB) is loaded only when the
landmark could be above your horizon, which depends on its height and yours.
It is freed again when you are well past that. So flying around Europe never
loads the North American shapes.

The shape model is `x` east, `y` up, `z` south, in metres, with the origin at
the middle of the base. The app sinks every landmark 6 m into the ground, so a
sloping site shows no gap.

To model a new one, see `tools/landmarks/PLAYBOOK.md`.
