# Terrain Walker

Walk or fly across the real surface of the Earth, in a browser, with no install
and no account. Elevation is streamed from open data as you move.

No dependencies. No build step. No package manager. Roughly 1,000 lines of
plain ES modules and one WebGL2 shader pair.

## Run it

```
python serve.py
```

Then open <http://localhost:8080/>.

**Use `serve.py`, not `python -m http.server`.** On Windows, Python's built-in
server reads MIME types from the registry, where `.js` is frequently registered
as `text/plain`. Browsers refuse to execute ES modules served with a
non-JavaScript MIME type, so the page loads, the spinner sits there, and not one
line of the code ever runs. `serve.py` sets the types explicitly. It also
disables caching so reloads pick up edits.

Any correctly configured static server works too (`npx serve`, nginx, GitHub
Pages). It does have to be HTTP — `file://` blocks both ES modules and workers.

### If it does not work

Open <http://localhost:8080/diag.html>. It tests each layer separately — MIME
types, module execution, module workers, WebGL2 and shader compilation, tile
fetch and CORS, OffscreenCanvas — and names the cause. It deliberately uses no
modules itself, so it still runs when module loading is the broken part.

To publish, push the repo and turn on GitHub Pages from the root. That is the
whole deployment.

## Controls

| Input | Action |
| --- | --- |
| click | capture the mouse, `esc` releases |
| `W` `A` `S` `D` | move |
| `shift` | run (walking) |
| `G` or `space` `space` | toggle flight |
| `space` / `shift` | up / down (flying) |
| `ctrl` | boost, 8x |
| wheel | flight speed |
| `R` | return to the spawn point |
| `F` | fog on/off (off by default) |
| `H` | hide the help panel |

The view slider sets render distance, from about 27 km to about 600 km.

## Going somewhere specific

The URL carries the camera, so a location is shareable by copying the address
bar:

```
index.html#lat=27.9881&lon=86.9250&alt=9000&mode=fly
```

A few to start with:

| Place | Hash |
| --- | --- |
| Lauterbrunnen, Switzerland | `#lat=46.5590&lon=7.9310` |
| Everest, from the south | `#lat=27.9500&lon=86.9250&alt=6000&mode=fly` |
| Grand Canyon | `#lat=36.0600&lon=-112.1100&alt=2200&mode=fly` |
| Milford Sound, New Zealand | `#lat=-44.6700&lon=167.9200` |
| Atacama | `#lat=-23.1000&lon=-67.7500&alt=5000&mode=fly` |
| Faroe Islands | `#lat=62.1000&lon=-7.0000&alt=900&mode=fly` |

## How it works

**Data.** One endpoint, no API key:
`s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png`. Elevation is
packed into RGB with a 32,768 m offset. Underneath it is NASADEM and SRTM at
about 30 m worldwide, which is why the finest level is zoom 12: past that the
data is only interpolation.

**Clipmap.** Six levels, zoom 12 down to zoom 7. Each level is a 4x4 block of
tiles whose origin is snapped to an **even** tile coordinate. That one
constraint makes the nesting exact: a 4x4 block at zoom z+1 covers precisely 2x2
whole tiles at zoom z, aligned to the coarse grid, so the coarse level drops
exactly those and there is no gap and no overlap anywhere. About 76 tiles and
690k triangles on screen at any time, regardless of where you are or how fast
you are going.

**Camera-relative rendering.** Vertex positions are stored in tile-local
mercator metres and never change. The camera offset is folded into a per-tile
uniform computed in float64 on the CPU. Float32 vertex data therefore stays
accurate everywhere on Earth, and there is no origin-rebasing machinery.

**Meshing off the main thread.** Fetch, PNG decode and mesh generation all
happen in workers. Buffers come back as transferables. Doing this on the main
thread produces a visible hitch on every single tile load.

**Skirts.** Each tile drops a 150 m vertical wall from its border, which hides
the cracks between levels. Back-face culling is off, so the winding does not
matter.

**Two depth passes.** A single 0.5 m to 600 km depth range has nowhere near
enough precision and distant ridges z-fight into mush. Far levels are drawn
first, the depth buffer is cleared, then the near levels are drawn over the top.
The split planes are derived from the actual block extents; a fixed constant
opens a visible gap ring on the horizon.

**No normals, no textures, no colour attributes.** The only vertex attribute is
a `vec4`. Flat shading comes from screen-space derivatives and the colour ramp
is computed from elevation in the fragment shader, then quantised to 5 bits per
channel.

## Performance

About 690k triangles across 72 draw calls of static buffers, which any GPU from
the last decade handles without noticing. Bandwidth is roughly 107 KB per
kilometre travelled: about 0.6 KB/s walking, about 56 KB/s at full boost. The
initial load is around 6 MB, requested coarsest-first so the whole scene appears
immediately and then sharpens.

Requests are capped at six in flight. This endpoint is a free public good and
does not deserve to be hammered. Please do not point automated flythroughs at
it.

## Outstanding work

See [TODO.md](TODO.md). Bugs, untested areas, and decisions waiting on a
human are all tracked there rather than in anyone memory.

## Tests

```
node test/behaviour.mjs   # movement, ground clamping, flight, height sampling
node test/coverage.mjs    # depth pass coverage across latitudes and settings
node test/smoke.mjs       # whole app against a mocked WebGL2 context
```

No test framework, no dependencies. There is also a proof that the clipmap tiles
exactly, checked against 150,000 sampled points.

## What is wrong with it

Stated plainly, because you will notice all of these within a minute:

- **The ground under your feet is invented.** Source data is sampled every 30 m
  and your eye is 1.7 m up. Large landforms are real and recognisable. Anything
  within walking distance is smooth interpolation.
- **Forest canopy is baked into the terrain.** This is a surface model, not a
  bare-earth model, so forest edges appear as cliffs.
- **You cannot fall.** Walking clamps you to the ground surface, so walking at a
  cliff means riding up it like an escalator. Gravity is a character controller,
  which is its own project.
- **Lakes are not flat and rivers do not always run downhill.** Nothing in a raw
  elevation model enforces hydrology.
- **The ocean is a flat plane at 0 m.** No bathymetry.
- **Heights are ellipsoidal, not orthometric.** Expect a vertical offset from
  published map elevations, up to about 100 m in some regions.
- **High latitudes distort.** Mercator tiles are square in projection, not on
  the ground. Past about 75 degrees it gets silly, and the poles have no data.

## Ideas, roughly in order of value per unit effort

1. Quadtree LOD instead of fixed levels, so detail follows terrain roughness
2. A service worker, so a region can be cached and flown offline
3. FABDEM or Copernicus GLO-30 as an alternate source, to get rid of the canopy
4. Deterministic, position-seeded fractal detail inside 300 m, so the near field
   stops being smooth putty
5. ESA WorldCover land classes driving the palette instead of elevation bands
6. Extruded OpenStreetMap building footprints
7. A native port to Rust and wgpu. Every line of tile, clipmap and shader logic
   ports across unchanged.

## Attribution and licence

Elevation data: Mapzen / AWS Open Data Terrain Tiles, derived from NASADEM,
SRTM and USGS 3DEP. Attribution is required by the data licence and is shown
in the corner of the view. Please keep it there.

Code is MIT. See `LICENSE`.
