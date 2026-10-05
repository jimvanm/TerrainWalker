# Terrain Walker

Walk or fly across the real surface of the Earth, in a browser, with no install
and no account. Elevation is streamed from open data as you move.

No dependencies. No build step. No package manager. About 5,000 lines of
plain ES modules, run straight from the folder.

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

To see how good the height data is at a given place, open
<http://localhost:8080/terraincheck.html>. It compares every detail level at
famously difficult places (Niagara Falls, Yosemite, Thor Peak and others) with
published facts, and names the source of the data at each.

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
| `Q` / `E` | down / up (switches to flight) |
| `ctrl` | boost, 4x |
| wheel | flight speed |
| `R` | return to the spawn point |
| `V` `X` `B` `C` | toggle water, roads, built-up, land cover |
| `T` | toggle landmarks (the list is `landmarks/index.json`) |
| `F` | fog on/off (off by default) |
| `6` | building colours: real map colours on/off (where a mapper entered one) |
| `7` | building colours: by type on/off (homes, shops/offices, industry, schools/hospitals, tall, public, military) |
| `8` | building colours: next colour set (stone, brick, render, concrete, mixed) |
| `9` | building colours: warmer light on/off |
| `P` | pin this place to the saved places list |
| `K` | copy a building-height report to the clipboard |
| `L` | copy the performance log to the clipboard |
| `H` | hide the key menu and performance graph |
| `1` `2` `3` `4` | debugging: tile grid, freeze loading, flat shading, show the map buildings a landmark hides |

The building colour keys are also buttons under BUILDING COLOURS, lit when on.
Every key is defined in one table, `src/ui/keys.js`; the key menu is built
from it.

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
| Lake Ontario (default spawn) | `#lat=43.87172&lon=-77.68043` |
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
about 30 m worldwide. Some places have much better data: about 10 m in the US
and Norway, 8 m in New Zealand, 2 m in most of the UK. Zoom 12 matches the 30 m
and is used everywhere; two close-up levels, zoom 13 and 14, are added near you
while you are low enough to see roads and buildings. Where the data is good
they show cliffs and gorges zoom 12 smooths away (Niagara, the Grand Canyon);
elsewhere they are enlarged copies. `terraincheck.html` shows which is which.

**Clipmap.** Eleven levels, zoom 14 down to zoom 4. Each level is a 4x4 block of
tiles whose origin is snapped to an **even** tile coordinate. That one
constraint makes the nesting exact: a 4x4 block at zoom z+1 covers precisely 2x2
whole tiles at zoom z, aligned to the coarse grid, so the coarse level drops
exactly those and there is no gap and no overlap anywhere. Low down, 136 tiles
and about 1.6 million triangles when fully loaded; higher up, without the two
close-up levels, 112 tiles and about 839k. Levels that fog or the horizon would
hide are never requested.

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

### How the code fits together

Each frame, `src/detail.js` turns the camera into one "view": where you are,
and how much to load and draw from there. Every layer (terrain, near field,
skyline, landmarks) updates from that same view, then draws. All shader code
is in `src/shaders.js`, all keys in `src/ui/keys.js`. The full file map is in
[SPEC.md, section 12](SPEC.md#12-repository-layout).

## Overlay layers

Elevation cannot tell you what water is. Lake Superior sits at 183 m, Erie at
174 m, Ontario at 74 m, so a colour ramp renders one lake system as three
different greens, while the Caspian comes out correctly blue purely because it
happens to be 28 m below sea level. Water is a category, not a height.

The same is true of forests, farmland, ice and cities. So they all arrive as
vectors from one OpenStreetMap tile and are draped as textures.

Two images per tile, channel-packed so a layer can be switched off with a single
uniform — nothing is refetched and nothing is re-rasterised:

| Image | Channels |
| --- | --- |
| `mask` RGBA | R water, G roads, B built-up, A land-cover coverage |
| `cover` RGB | land-cover colour |

Land cover is baked as **colour**, not as a class index. The textures are
sampled with LINEAR filtering, and interpolating between two index values would
invent a third class that is not there. Interpolating between two colours is
exactly what is wanted.

The pipeline:

1. Fetch the OpenStreetMap vector tile alongside the elevation tile. The tile
   URL comes from OpenFreeMap's TileJSON at runtime, never hardcoded.
2. Decode it with a hand-written MVT reader in `src/mvt.js`, about 130 lines and
   no dependencies. Water polygons, waterway lines, and the `class` tag.
3. Rasterise to a 256x256 single-channel mask in the worker with Canvas 2D path
   fills. Nonzero winding gives island holes for free.
4. Upload per tile as an `R8` texture and sample it in the fragment shader.

Vectors travel over the wire; pixels are materialised at load time and never
stored or transmitted. All 76 tiles cost about 5 MB of GPU memory. UVs fall out
of the tile-local vertex positions, so there is no extra attribute, and skirt
vertices inherit their edge's UV so shorelines do not tear at LOD seams.

**Not flattened.** Rivers are not level — the St. Clair drops about a metre over
40 km — and OSM stores wide rivers as polygons, so a blanket flatten would level
them. NASADEM already flattened large lakes during processing anyway.

**This is the general overlay mechanism.** Roads, built-up areas, borders and
chart symbology are all the same path: rasterise vectors, drape on terrain. What
remains is drawing code, not architecture.

## Performance

Up to about 1.6 million triangles low down (839k higher up) across about 270
draw calls of static buffers, every level drawn in both depth passes. The close-
up levels roughly doubled the low-down count; if a GPU struggles, that is the
first place to look. Bandwidth is roughly 107 KB per
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
node test/run.mjs          # every test, with a pass/fail summary
node test/run.mjs near     # only tests whose file name contains "near"
node test/smoke.mjs        # or run any one test directly
```

Every test lives in `test/`. Each runs in its own process, because each fakes a
different part of the browser. `smoke.mjs` runs the whole app against a fake
WebGL2 context and fake page, and catches wiring mistakes.

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

## Data sources, attribution and courtesy

Everything this renders is streamed from two free public services. Neither
charges anything, neither asks for an API key, and both deserve to be treated
carefully rather than merely legally.

**Elevation** — [Mapzen / AWS Open Data Terrain
Tiles](https://registry.opendata.aws/terrain-tiles/), derived from NASADEM,
SRTM and USGS 3DEP. A funded AWS Open Data dataset serving tens of millions of
requests a day. No SLA, no rate limit.

**Water, land cover, roads and built-up areas** — OpenStreetMap via
[OpenFreeMap](https://openfreemap.org/), in the OpenMapTiles schema.
OpenFreeMap is one person's project, funded by donations, offering unlimited
free tile hosting with no registration. "No limits" is a generous policy, not
an invitation to test it. If this project is useful to you, [sponsor
OpenFreeMap](https://github.com/sponsors/hyperknot).

Attribution for both is displayed in the corner of the view and is required by
the licences. Please keep it there.

### What this client does to stay polite

- At most 10 requests in flight, and requests are only made when the visible
  tile set actually changes. Standing still costs nothing.
- Roughly 107 KB per kilometre travelled, across both hosts. Comparable to one
  person browsing a map site.
- Detail levels that cannot finish loading before they are superseded are not
  requested at all, so nothing is fetched and then discarded.
- Browser HTTP caching does the rest; flying back over ground you have already
  seen costs no requests.

### What would not be polite

- **Automated flythroughs.** A script, or leaving this running unattended at
  100 km/s, turns one person browsing into a crawler. Don't.
- **Bulk downloading through the tile endpoints.** Both projects publish full
  planet dumps for exactly this purpose: OpenFreeMap ships weekly planet
  downloads, and the terrain tiles are a public S3 bucket you can sync.
- **Pointing significant traffic at them from a popular deployment.** If this
  ever got real traffic, the right move is to self-host tiles rather than let
  someone else's donation-funded server absorb it.

## About this project

This started as a thought while driving: the topography of the Earth is
essentially mapped, most of it is freely available, and so is the knowledge of
how to build 3D worlds. How hard would it be to join the two and go for a walk
anywhere?

It turns out: not very. That is the interesting result. A walkable, flyable
planet built from open data is about a thousand lines and no dependencies.

I am genuinely pleased with how it turned out — considerably better than I dared
hope when I started. But I have no big plans for it. It was an experiment in
whether the idea worked, and it does. It is unmaintained, not intended to be
depended on, and the [outstanding work](TODO.md) is longer than the finished
work. Fork it freely.

### Built with an AI

This was written collaboratively with Claude (Anthropic) in a single working
session. I set the direction, made the design calls, and did all the testing;
the AI wrote the code, did the maths, and researched the data sources.

That division mattered more than it might sound, because **every significant bug
was found by a human looking at the screen.** The AI could not see the output.
Several were invisible to a passing test suite:

- A depth-precision bug that made distant terrain flicker survived six versions
  because the tests checked that geometry fell *inside* the clip range and never
  asked whether the depth buffer could *resolve* anything out there. It was found
  by noticing that the view-distance slider changed the effect.
- A loader deadlock that pinned the whole view to coarse tiles was found by
  reading a tile count in the HUD that did not match the expected number.
- Flickering tiles were narrowed down by toggling layers off one at a time, which
  separated three independent causes that had been assumed to be one.
- A Windows-specific MIME type quirk stopped every line of code from running,
  and was invisible to a test suite that imports modules directly.

The [TODO](TODO.md) opens with the patterns behind the worst of them, because
they are more useful than the fixes.

Repository: <https://github.com/jimvanm/TerrainWalker>

## Licence

Code is MIT. See `LICENSE`. Map data licences belong to the sources above:
OpenStreetMap data is ODbL, and the terrain tiles carry the licences of their
underlying public-domain sources.
