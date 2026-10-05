# Terrain Walker — Technical Specification v0.2

Status: implemented, all sections below reflect the shipped build.

## Changes from v0.1

Four decisions changed during implementation. Each is marked in place.

- **Finest level is zoom 12, not 13.** Global source data is 30 m, so zoom 13
  is interpolation everywhere outside the US. Dropping a level cuts requests
  four-fold for no loss of real information.
- **Origin rebasing removed (was section 5.1).** Replaced by camera-relative
  rendering: vertex positions are camera-independent and the offset lives in a
  per-tile uniform computed in float64. Strictly better and less code.
- **Speed-driven LOD removed (was section 6.3).** A clipmap draws a constant
  number of tiles regardless of speed, so there was nothing to modulate.
  Measured bandwidth is ~107 KB/km at any velocity.
- **Two-pass depth split added (section 8.6).** Not anticipated in v0.1 and
  strictly necessary.
- **Triangle budget raised** from 500k to 750k. The original figure was
  cautious; 72 draw calls of static buffers is not a real load.
Target: single-developer weekend build, published to GitHub Pages

---

## 1. Purpose

A minimal, dependency-light 3D viewer that streams real-world elevation data over HTTP and lets a user walk or fly across any point on Earth's land surface.

The project succeeds if a person can open a URL, click, and be standing on a recognisable mountain within five seconds, with no install step and no account.

## 2. Non-goals

Explicitly out of scope for v0.1. Each of these has killed a hobby project of this shape before:

- Buildings, roads, or any OpenStreetMap vector data
- Satellite or aerial imagery
- Vegetation, water surfaces, or weather
- Rigid-body physics, jumping, or gravity
- Multiplayer, persistence, or saved state
- Mobile touch controls
- Geoid (EGM2008) correction — ellipsoid heights are accepted as-is
- Bathymetry below sea level

## 3. Constraints

| Constraint | Value |
|---|---|
| Runtime | Any browser with WebGL2 (Chrome/Edge/Firefox 2021+) |
| Dev platforms tested | Windows 11, Linux |
| Build step | None. ES modules + importmap. |
| Package manager | None. Three.js vendored into the repo. |
| Server requirement for dev | Any static file server |
| Deployment | GitHub Pages, from repo root |
| Total repo size | Under 2 MB including vendored Three.js |

## 4. Data

### 4.1 Source

```
https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png
```

AWS Open Data. No authentication, CORS-open, standard Web Mercator XYZ, 256x256 PNG.

Underlying data is NASADEM/SRTM at ~30 m globally, USGS 3DEP at ~10 m over the United States. **Effective global resolution ceiling is zoom 12.** Requesting deeper zooms returns interpolated data outside the US and is a waste of requests.

The data is a Digital Surface Model in forested areas: tree canopy is baked into the terrain. This is a known and accepted artefact for v0.1.

### 4.2 Decode

Elevation is packed into RGB with a 32,768 m offset, 16 bits integer plus 8 bits fraction:

```js
elevation_metres = (r * 256 + g + b / 256) - 32768;
```

### 4.3 Attribution

The license requires attribution for display or analysis. A persistent, non-dismissable footer element must read:

> Elevation data: Mapzen / AWS Open Data Terrain Tiles

### 4.4 Politeness

The endpoint is a free public good. Requests must be capped (see §7.3) and every response cached. Do not implement automated flythroughs or crawlers.

## 5. Coordinate systems

Three spaces, converted in this order.

**Geographic** — WGS84 latitude/longitude degrees. User-facing only (URL params, HUD readout).

**Web Mercator (EPSG:3857) metres** — the native space of the tiles. Tiles are square here, which makes meshing trivial.

```
R = 6378137
mercX = R * lon_rad
mercY = R * ln(tan(PI/4 + lat_rad/2))
```

**World** — local render space, metres, Y-up, right-handed. Derived from Mercator by subtracting a rebasable origin and applying a single scale factor:

```
k = cos(lat_origin)              // Mercator-to-true-metre scale
world.x =  (mercX - mercX0) * k
world.z = -(mercY - mercY0) * k
world.y =  elevation
```

Distortion grows with distance from origin, which is why the origin is rebasable.

### 5.1 Camera-relative rendering (replaces origin rebasing)

The eye sits at the origin. Vertex positions are stored in tile-local mercator
metres, unscaled and camera-independent, so vertex buffers are built once and
never touched. The camera offset is folded into a per-tile `vec2` uniform
computed in float64 on the CPU:

```
uTileOffset = ((tileCentre.x - cam.x) * k, (cam.y - tileCentre.y) * k)
```

Float32 vertex data therefore stays accurate anywhere on Earth with no rebasing
machinery at all.

### 5.2 Tile addressing

```
x = floor((lon + 180) / 360 * 2^z)
y = floor((1 - ln(tan(lat) + sec(lat)) / PI) / 2 * 2^z)
```

Tile ground width at zoom z, latitude phi:

```
width_metres = 40075016.686 * cos(phi) / 2^z
```

## 6. Level of detail

### 6.1 Ring scheme

Four concentric, camera-centred rings. Not a quadtree — the quadtree is a v0.2 upgrade once the ring behaviour is understood.

| Ring | Zoom | Tiles | Mesh grid | Ground coverage (44°N) |
|---|---|---|---|---|
| 0 | 12 | 4x4 | 128 | ~27 km |
| 1 | 11 | 4x4 less centre 2x2 | 64 | ~54 km |
| 2 | 10 | 4x4 less centre 2x2 | 32 | ~108 km |
| 3 | 9 | 4x4 less centre 2x2 | 32 | ~215 km |
| 4 | 8 | 4x4 less centre 2x2 | 32 | ~430 km |
| 5 | 7 | 4x4 less centre 2x2 | 32 | ~860 km |

Block origins snap to EVEN tile coordinates. That single constraint makes the
nesting exact: a 4x4 block at zoom z+1 covers precisely 2x2 whole tiles at zoom
z, aligned to the coarse grid. Verified against 150,000 sampled points: zero
gaps, zero overlaps.

Measured: 76 tiles, 756k triangles, 76 draw calls.

### 6.2 Skirts

Adjacent rings do not share edge vertices, producing visible cracks. Every tile mesh must extend its border vertices **100 m vertically downward**, forming a closed skirt. Skirt faces use the same material.

### 6.3 Speed-driven LOD (dropped)

Anticipated in v0.1, found unnecessary. A clipmap draws a constant tile count
regardless of velocity, so there is nothing to modulate. Measured churn is
~107 KB/km at every speed: 0.6 KB/s walking, 56 KB/s at full boost.

Requests are ordered coarsest level first, then nearest tile within a level, so
the whole scene appears immediately and then sharpens.

## 7. Tile pipeline

### 7.1 Stages

```
request queue -> fetch -> ImageBitmap -> decode to Float32Array
             -> generate mesh geometry -> transfer to main thread -> add to scene
```

### 7.2 Threading

Fetch, decode, and mesh generation run in a **Web Worker** using `createImageBitmap` and `OffscreenCanvas`. Geometry is returned as transferable `Float32Array` buffers.

Main-thread meshing produces frame hitches on every tile load and is not acceptable. If `OffscreenCanvas` is unavailable, fall back to main-thread decode and log a warning.

### 7.3 Queue and caching

- Maximum **6** concurrent in-flight requests
- Priority queue ordered by ring index, then distance from camera
- Requests for tiles that have left the active set are cancelled before dispatch
- In-memory LRU cache of decoded height arrays, capacity **512** tiles
- Cache key: `z/x/y`
- Browser HTTP cache handles disk persistence; no service worker in v0.1

### 7.4 Failure handling

A failed or 404 tile renders as a flat plane at sea level and is retried once after 2 s. Failures must never block the render loop or produce a hole in the mesh.

## 8. Rendering

### 8.1 Material

Flat-shaded, vertex-coloured, no textures. `MeshLambertMaterial` with `flatShading: true`, or equivalent custom shader.

### 8.2 Palette

Colour is computed per-vertex from elevation and slope only — zero additional bandwidth.

Hypsometric bands quantized to 16 steps: deep blue below 0 m, sand 0–50 m, greens to 800 m, browns to 2000 m, grey rock to 3000 m, white above. Bands blend across a 10% transition zone to avoid contour banding.

Slope darkens the result: `colour *= (0.55 + 0.45 * dot(normal, up))`.

### 8.3 Curvature

Earth curvature must be applied or the far rings show terrain that should be below the horizon. At 100 km the error is ~785 m.

Applied in the vertex shader as a downward offset proportional to squared horizontal distance from the camera:

```
y -= (d * d) / (2 * 6371000)
```

### 8.4 Atmosphere

- Exponential-squared fog, density tuned so the far ring boundary is fully occluded
- Sky clear-colour **exactly** matches fog colour
- Far plane and fog density both scale with `speedFactor`
- Single directional light plus hemisphere ambient. No shadows.

### 8.6 Depth split (added in v0.2)

A single 0.5 m to 600 km depth range has nowhere near enough precision; distant
ridges z-fight into mush. Levels 2 and above are drawn first, the depth buffer
is cleared, then levels 0 and 1 are drawn over the top.

Split planes must derive from the block extents, not a constant. Levels 0-1 fill
a square whose half-extent is two level-1 tiles, so the near pass must reach its
DIAGONAL (x1.55) and the far pass must begin inside its EDGE (x0.85). A fixed
constant opens a visible gap ring on the horizon.

### 8.5 Render distance control

User-adjustable slider mapping to ring count (1–4). Defaults to 4. Minecraft's honesty about render distance is the model.

## 9. Camera and controls

### 9.1 Modes

**Walk** (default). Camera clamped to `terrainHeight(x, z) + 1.7`. Terrain height sampled by bilinear interpolation of the ring-0 height array. No gravity, no jumping, no collision volumes.

**Fly**. Free movement in all axes.

### 9.2 Bindings

| Input | Action |
|---|---|
| Click canvas | Acquire pointer lock |
| Mouse | Look. Pitch clamped ±89°. |
| W/A/S/D | Horizontal movement |
| Double-tap Space | Toggle walk/fly |
| Space (fly) | Ascend |
| Shift (fly) | Descend |
| Ctrl (fly) | Boost, 8x |
| Mouse wheel | Adjust base speed, logarithmic |
| Esc | Release pointer lock |
| R | Reset to spawn |

Speeds: walk 5.6 m/s, fly base 50 m/s, fly boost 400 m/s.

Double-tap window: 300 ms.

### 9.3 HUD

Single line, bottom-left, monospace: latitude, longitude, altitude MSL, height above ground, speed, active tile count, mode.

## 10. Performance budgets

Testable acceptance criteria. Measured at 1920x1080 on integrated graphics (Intel Iris Xe class).

| Metric | Budget |
|---|---|
| Frame rate, walking, steady state | 60 fps |
| Frame rate, boosted flight | ≥ 45 fps |
| Frame time spike on tile load | < 4 ms |
| Triangles, default settings | < 800,000 (measured 756k) |
| Draw calls | < 120 |
| Initial load to first frame | < 3 s on 25 Mbit |
| Initial payload | < 6 MB |
| Steady-state bandwidth, walking | < 50 KB/s (measured 0.6) |
| Steady-state bandwidth, boosted flight | < 2 MB/s (measured 56 KB/s) |
| JS heap after 10 minutes | < 400 MB, non-growing |

The heap must be flat over time. Tile churn without eviction is the most likely leak.

## 11. Configuration

URL hash parameters, so a location is shareable by copying the address bar:

```
index.html#lat=46.5763&lon=7.9904&alt=3200&mode=fly&rings=4
```

All parameters optional. Defaults to a scenic spawn point. The hash updates on a 1 Hz throttle as the camera moves.

## 12. Repository layout

The original plan (Three.js, nine files) was replaced as the project grew.
This is the layout as built.

```
index.html          page, styles, panels (filled in by src/ui/)
diag.html           standalone fault finder; uses no modules on purpose
serve.py            dev server with correct MIME types

src/main.js         start-up and the frame loop; wires the parts, owns no logic
src/config.js       constants, URL hash
src/settings.js     what is switched on: fog, debug, freeze, map layers
src/detail.js       per frame: how much to load and draw -> one "view" object

  the layers, each with update(view) and draw(pass)
src/terrain.js      clipmap terrain: what to fetch, GPU tiles, drawing, heightAt
src/rings.js        which terrain tiles cover the ground (pure, tested)
src/near.js         real roads and buildings around a low camera (zoom 14)
src/skyline.js      tall buildings out to ~20 km (zoom 13 markers, zoom 14 detail)
src/tilelayer.js    what near and skyline share: GPU tiles, drawing, reports
src/handover.js     the only file that knows both near and skyline: who draws what
src/landmarks.js    landmarks: placements, and shapes loaded only within sight
src/landmark_list.js  reads landmarks/index.json and each landmark.json

  graphics
src/gl.js           WebGL helpers, matrices, shared camera uniforms
src/shaders.js      all GLSL: terrain and mesh programs, camera placement once
src/meshprogram.js  the one program for roads, buildings, skyline, landmarks

  background helpers (web workers)
src/pool.js         helper pool and job queue, used by every layer
src/tiles.js        terrain requests on top of the pool
src/worker.js       terrain helper: elevation + painted overlays -> mesh, textures
src/nearworker.js   near/skyline helper: map tile -> road and building meshes
src/mvt.js, heightgrid.js, roads.js, buildings.js, runways.js, drape.js,
earclip.js, meshbuilder.js   decoding and mesh building, used by the helpers
src/cache.js        persistent download cache (Cache API)

  page
src/ui/keys.js      every key in one table; the help panel is built from it
src/ui/panels.js    buttons: layers, building colours, movement pad, slider
src/ui/hud.js       status bar, loading message, error panel
src/ui/compass.js   heading gyro
src/ui/report.js    K: building-height report
src/controls.js     walking and flying
src/favourites.js, places.js   saved places
src/look.js         building colour sets
src/perf.js         performance graph and strain log

landmarks/          one folder per landmark; index.json is the list (see its README)
test/run.mjs        runs every test: node test/run.mjs
tools/              offline tools: bake_landmark.mjs, landmarks/ (modelling method)
```

Each frame: `detail.js` turns the camera into a view; each layer updates from
it; then the scene is drawn twice, once per depth range, through one
`drawScene(pass)` in `main.js`.

No file should exceed roughly 300 lines. If one does, the module boundary is wrong.

## 13. Milestones

Each milestone is independently demoable and has a pass condition.

| # | Deliverable | Pass condition |
|---|---|---|
| M0 | Tile fetch and decode | Console prints correct elevation for a known summit within ±20 m |
| M1 | Single tile rendered | One z13 tile visible with orbit camera |
| M2 | Ring LOD and streaming | Four rings, skirts closed, no visible cracks, tiles load on movement |
| M3 | Walk controller | Ground-clamped traversal, no clipping, HUD accurate |
| M4 | Flight | Mode toggle, speed-driven LOD, no stutter under boost |
| M5 | Presentation | Palette, fog, curvature, sky, render-distance slider |
| M6 | Ship | URL config, attribution, README, live on GitHub Pages |

## 14. Known limitations

To be stated plainly in the README rather than discovered by users:

- Forest canopy is baked into the terrain; forest edges appear as cliffs
- 30 m source resolution means everything within walking distance is smooth and approximate
- Lakes are not flattened and rivers do not necessarily run downhill
- Mercator distortion makes high-latitude tiles increasingly non-square in true metres
- Ocean is a flat plane at 0 m with no bathymetric detail
- Ellipsoid heights, not orthometric; up to ~100 m vertical offset from published map elevations in some regions

## 15. Roadmap beyond v0.1

Ordered by value-to-effort, not by ambition.

1. Quadtree LOD replacing fixed rings
2. Service worker for offline region caching
3. FABDEM or Copernicus GLO-30 as an alternate source (bare-earth, no canopy)
4. Procedural near-field detail: deterministic, position-seeded fractal displacement inside 300 m
5. ESA WorldCover land classes driving the palette instead of elevation bands
6. OSM building footprints, extruded
7. Native port to Rust + wgpu, reusing all tile and LOD logic unchanged
