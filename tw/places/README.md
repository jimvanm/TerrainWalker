# Places

A place is an area where the usual terrain is not good enough, so it gets its
own terrain tiles built from laser-survey data. Each place is one folder here.
`index.json` is the list.

## What is in a folder

| File | What it is |
|---|---|
| `spec.json` | the area: a line of `[lat, lon, metres]` points; the place reaches that far from the line |
| `place.json` | the list of built tiles. Made by the builder: do not edit by hand |
| `tiles/{z}/{x}/{y}.png` | the built tiles, same format as the usual ones |
| `preview.png` | a shaded picture of the survey data, to check it looks right |

## Build a place

From the `tw` folder, once:

```
pip install rasterio numpy pillow
```

Then:

```
python tools/places/build_place.py niagara --probe
python tools/places/build_place.py niagara
```

`--probe` only says what data it found. The second line reads just the parts
of the survey files it needs and writes the tiles. It keeps the usual tiles it
downloads in `places/<id>/.cache` (not saved in git), so a second run is quick.

Survey data comes from Natural Resources Canada (HRDEM) and the US Geological
Survey (3DEP 1 m). Elsewhere the builder finds nothing yet.
