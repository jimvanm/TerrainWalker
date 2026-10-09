# Terrain Walker

Walk or fly across the real surface of the Earth, in a browser, with no install
and no account. Elevation is streamed from open data as you move.

No dependencies. No build step. No package manager. About 6,000 lines of
plain ES modules, run straight from the folder.

## Run it

The app is a folder of plain files, served by a local web server. Use
[Caddy](https://caddyserver.com/download): one program, nothing to install
alongside it. The `Caddyfile` here sets it up (port 8080, no caching, so a
reload picks up edits). From this folder:

```
caddy run
```

On Windows, `serve.bat` does the same: open it and set the line naming where
`caddy` is on your computer, then double-click it.

Then open <http://localhost:8080/>.

**Not Python's `http.server`.** On Windows it takes file types from the
registry, where `.js` is often registered as plain text. Browsers will not run
code served as plain text, so the page loads, the spinner sits there, and not
one line of the code runs. Any other correctly set-up web server works
(nginx, GitHub Pages). It does have to be a server: opening `index.html` as a
file blocks the code from loading.

### If it does not work

Open <http://localhost:8080/diag.html>. It tests each layer separately — MIME
types, module execution, module workers, WebGL2 and shader compilation, tile
fetch and CORS, OffscreenCanvas — and names the cause. It deliberately uses no
modules itself, so it still runs when module loading is the broken part.

To see how good the height data is at a given place, open
<http://localhost:8080/terraincheck.html>. It compares every detail level at
famously difficult places (Niagara Falls, Yosemite, Thor Peak and others) with
published facts, and names the source of the data at each.

To tune where a traced mountain ends, open
<http://localhost:8080/mountainlab.html>. It shows several mountains side by
side; the sliders change the rules, and the settings line at the bottom is
what the app would use. Each mountain's 3D button shows it as a solid you can
turn: drag to turn, wheel to zoom.

To publish, push the repo and turn on GitHub Pages from the root; the app is
then at `.../TerrainWalker/tw/`. Places of interest are the exception: their
tiles are built on your own computer and are not in the repo (see
`places/README.md`), so a published copy has none.

## Controls

| Input | Action |
| --- | --- |
| `Tab` | switch between the two modes, each with its own key menu: **Navigation** (moving about, what is shown) and **Tools** (changing things: dropping landmarks). Moving, flying and the reports work in both. In Tools the mouse is free: you aim with the pointer, and right-drag looks around. Full screen and the keyboard lock stay on. |
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
| `J` | close-up ground in Canada: Canada's 1 m laser survey (HRDEM, the default) or the usual height tiles. The four finest ground levels (zoom 13 to 16) are built from the survey where it exists; gaps are filled from the usual tiles. Each piece of the survey is downloaded once and kept. |
| `0` | water close by: a flat surface with a crisp shore and banks (default), or painted on the ground as before. Falling water (rapids, falls) is laid on the ground either way. |
| `5` | building style: today's boxes, the new look (windows, house roofs, regional colours) on our map's buildings, or the new look on Overture's buildings (heights, roof shapes, domes and spires, materials). Close up only; the far skyline keeps today's style. |
| `6` | building colours: real map colours on/off (where a mapper entered one) |
| `7` | building colours: by type on/off (homes, shops/offices, industry, schools/hospitals, tall, public, military) |
| `8` | building colours: next colour set (stone, brick, render, concrete, mixed) |
| `9` | building colours: warmer light on/off |
| `P` | pin this place to the saved places list |
| `M` | (Tools) drop a landmark where the crosshair meets the ground: press again for the next one, and after the last, off. It stands where you point; click to drop it; `,` / `.` turn it; `Delete` removes a dropped one you point at. A reload clears them all. |
| `N` | (Tools) move a piece of ground: click corners of an outline on the ground (`Backspace` takes one back), `Enter` picks the ground inside it up, fly anywhere, click to lay it down (again for another). `U` switches how high it stands: its rise above the outline's edge (default) or its height above sea level; pointed at a laid piece with nothing in hand, it changes that one where it lies. `,` / `.` turn it, `Delete` removes a laid piece you point at, `N` again or `Esc` puts it away. With nothing in hand, clicking a laid piece or dropped landmark picks it up again. A piece carries its city: the map's water, built-up areas and cover, its roads, railways, airports and buildings, and the landmarks inside the outline (each follows its own button: WATER, ROADS, BUILT, COVER, LANDMARKS). While you carry it only the shape shows, and the map tiles are fetched in the background (the message line counts them); the detail appears once it is laid. Whatever is in hand waits, hidden, while you are in Navigation. Every outline you pick up is saved in the PIECES list (where PLACES is, in Tools mode): click one to take it in hand again from anywhere, double-click to rename. Laid-down copies clear on a reload; the list stays. The list's search box finds a mountain by name (Wikidata, live) and traces its outline from the height tiles: the ground above the valleys round it, plus close neighbours joined by a high saddle (Lhotse with Everest), minus thin arms (narrower than 600 m), within the chosen reach. |
| `K` | copy a building-height report to the clipboard |
| `L` | copy the performance log to the clipboard |
| `H` | hide the key menus and performance graph |
| `1` `2` `3` `4` | debugging: tile grid, freeze loading, flat shading, show the map buildings a landmark hides |

The building colour keys are also buttons under BUILDING COLOURS, lit when on.
Every key is defined in one table, `src/ui/keys.js`, with the mode it works
in; both key menus are built from it.

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

**Places of interest.** Where even that is not good enough, a place can have
its own tiles, built from laser-survey data (1 to 2 m) by
`tools/places/build_place.py`; see `places/README.md`. The app uses a place's
tiles instead of the usual ones, and only there adds two finer levels, zoom 15
and 16. Niagara is the first.

**Clipmap.** Thirteen levels, zoom 16 down to zoom 4 (zoom 15 and 16 only in
a place of interest). Each level is a 4x4 block of tiles whose origin is
snapped to an **even** tile coordinate. That one
constraint makes the nesting exact: a 4x4 block at zoom z+1 covers precisely 2x2
whole tiles at zoom z, aligned to the coarse grid, so the coarse level drops
exactly those and there is no gap and no overlap anywhere. Low down (outside a
place of interest), 136 tiles and about 1.6 million triangles when fully loaded; higher up, without the two
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
enough precision and distant ridges z-fight into mush. The scene is drawn
twice: once for the far range, then, after clearing the depth buffer, once for
the near range. The split is placed where depth precision falls to about 20 m,
not at a detail level's edge, and the two ranges overlap so nothing falls
between them (`src/main.js` explains why).

**No normals and one vertex attribute.** Terrain vertices are a single `vec4`.
Flat shading comes from screen-space derivatives and the colour ramp is
computed from elevation in the fragment shader, then quantised to 5 bits per
channel. The map layers below are draped over that as textures.

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
2. Decode it with a hand-written map-tile reader in `src/mvt.js`, no
   dependencies: water, waterways, land cover, land use, roads and airports.
3. Draw them into the two 256x256 images above in the helper (a web worker),
   with Canvas 2D path fills. Nonzero winding gives island holes for free.
4. Upload them per tile as textures and sample them in the fragment shader.

Vectors travel over the wire; pixels are made at load time and never stored or
transmitted. About 600 KB of GPU memory per tile, mipmaps included. UVs fall out
of the tile-local vertex positions, so there is no extra attribute, and skirt
vertices inherit their edge's UV so shorelines do not tear at LOD seams.

**Not flattened.** Rivers are not level — the St. Clair drops about a metre over
40 km — and OSM stores wide rivers as polygons, so a blanket flatten would level
them. NASADEM already flattened large lakes during processing anyway.

**This is the general overlay mechanism.** Roads, built-up areas, borders and
chart symbology are all the same path: rasterise vectors, drape on terrain. What
remains is drawing code, not architecture.

Close up, roads and buildings are also real geometry: the near field
(`src/near.js`) builds road ribbons and extruded buildings from the same map
tiles for the area around you, and the skyline (`src/skyline.js`) adds tall
buildings out to about 20 km.

## Performance

Up to about 1.6 million triangles low down (839k higher up) across about 270
draw calls of static buffers, every level drawn in both depth passes. The close-
up levels roughly doubled the low-down count; if a GPU struggles, that is the
first place to look. Bandwidth is roughly 107 KB per
kilometre travelled: about 0.6 KB/s walking, about 56 KB/s at full boost. The
initial load is around 6 MB, requested coarsest-first so the whole scene appears
immediately and then sharpens.

Requests are capped at ten in flight. This endpoint is a free public good and
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

- **The ground under your feet is invented.** Over most of the world the source
  data is sampled every 30 m and your eye is 1.7 m up. Large landforms are real
  and recognisable. Anything within walking distance is smooth interpolation.
  (Better in the US, the UK and a few other countries, and in a place of
  interest.)
- **Forest canopy is baked into the terrain.** This is a surface model, not a
  bare-earth model, so forest edges appear as cliffs.
- **You cannot fall.** Walking clamps you to the ground surface, so walking at a
  cliff means riding up it like an escalator. Gravity is a character controller,
  which is its own project.
- **Lakes are not flat and rivers do not always run downhill.** Nothing in a raw
  elevation model enforces hydrology.
- **There is no sea surface.** Out at sea the height data is the sea floor,
  so you fly over the floor, painted as water, and the height shown is the
  floor's: thousands of metres below zero in the open ocean.
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
6. A native port to Rust and wgpu. Every line of tile, clipmap and shader logic
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
