# Outstanding work

Kept in the repo deliberately. Nothing here is abandoned; items sit until they
are explicitly killed. This list is longer than the finished work, which is the
honest state of an experiment.

---

## Patterns worth knowing before you change anything

Three of the nastiest bugs here were the same mistake in different clothes:
**conflating two questions that look like one.**

**Fetch, draw and hold are three separate decisions.**

- **Fetch** — which levels to request. Bounded by what can finish loading before
  it is superseded. A tile replaced before it arrives never converges; it
  thrashes between stand-in and detail forever.
- **Draw** — which levels to render. Every level down to the finest already in
  memory. Speed is never a reason to discard detail we already hold.
- **Hold** — when to release a coarse tile. Only once its replacements have
  actually arrived, so nothing is destroyed without a stand-in.

Conflating fetch and hold deadlocked the loader: suppressed tiles were dropped
from the list that also drives fetching, so they were never requested, never
loaded, and the coarse stand-in was kept forever. Conflating fetch and draw threw
away cached detail whenever the camera moved.

**Coverage is recursive.** A tile's ground is covered if the tile is loaded OR
all four of its children are covered. Checking only whether the immediate
children were loaded is wrong: a child may be legitimately absent precisely
because its own children cover it.

**Test the property, not the happy path.** Several bugs survived multiple
rewrites because the tests only ran the fully-loaded, on-the-ground,
mid-latitude case. Depth *coverage* passed for six versions while depth
*resolution* was catastrophic. Clipmap tiling was proven exact three times,
always with everything loaded.

---

## Decisions taken

- **Sphere (ECEF): agreed, not started.** Pole holes accepted. Prerequisite for
  the hemisphere view.
- **Water is vector, draped as a texture.** Not raster, not flatness detection,
  not a floating decal, and not flattened.
- **Land cover baked as colour, not a class index.** LINEAR filtering would
  interpolate indices into classes that do not exist.
- **Flight speed proportional to altitude, no realism bend.** Real aircraft
  cruise is a boring experience however impressive the number.
- **Labels must be toggleable**, never always-on.
- **Overlay direction is VFR sectional symbology**, not place labels. Detail
  level and altitude behaviour both undecided; explicitly a thing to play with
  rather than specify up front. Needs a spike, not a spec.

---

## Bugs and rough edges

- [ ] **Roads look bad, and are close to useless on foot.** They render as flat
      uniform stripes: no casing, no width hierarchy beyond major/minor, and
      aliasing at mask resolution. At walking height the problem stops being
      cosmetic — a road rasterised into a 26 m texel is a smear, and the thing
      you are standing on has no edge.

      **A raster mask physically cannot draw a road at zoom 12.** One texel is
      27.7 m of ground and a road is about 10 m wide, so it is 2.8x too wide
      before any filtering. Correct road width from a raster needs zoom 14,
      which is 16x the tiles. No amount of tuning fixes this.

      **Suggestion: draw roads as vector geometry in the near field.** The MVT
      linestrings are already decoded and then thrown away after rasterising.
      Keep them for the finest level or two, extrude them into ribbons, and let
      the raster mask carry the middle and far distance where a texture is the
      right tool. Same data, two renderers, chosen by distance.

      Costs, roughly:

      - **Bandwidth: zero.** The geometry is already downloaded and decoded.
      - **Geometry:** a ribbon segment is 4 vertices and 2 triangles. ~1,500
        segments per tile (motorway to tertiary) is about 50k triangles across
        the finest level; ~6,000 segments (adding residential and service, dense
        urban) is about 200k. Against 839k already drawn, even the generous case
        is roughly 20%.
      - **Draping is free.** The worker already holds the 256x256 height grid,
        so terrain height can be sampled per road vertex and the ribbon follows
        the ground exactly.
      - **CPU:** one-time ribbon generation per tile, in the worker.

      **The trap is depth, and this project has hit it twice already.** Do not
      offset the ribbon by a fixed height. Use `gl.polygonOffset`, which scales
      the bias with depth slope; a fixed offset that works underfoot z-fights at
      a kilometre.

      **Width scaling matters more than it sounds.** Constant world width is
      physically right but distant roads shrink below a pixel and shimmer out.
      Constant screen width is what charts do, stays legible, and looks wrong up
      close. The standard answer is world width with a minimum screen width of
      about one pixel: correct near you, still visible to the horizon. This is
      most of why vector roads read well at every distance, and it is also the
      natural path toward sectional-style symbology.

- [ ] **Residual white squares.** Much reduced across 0.6.x and 0.7.x but not
      confirmed gone. Best remaining theory: OpenMapTiles carries little or no
      `landcover` at low zooms, so a coarse substitute tile falls back to the
      bare elevation ramp, which is **sand-coloured below 40 m** and reads pale
      against forested neighbours. Two independent fixes if confirmed: fewer
      substitutions, and a greener low band when no land cover is present.
- [ ] **The outermost level has no fallback.** Levels 0-7 can substitute from
      their parent; level 8 has nothing coarser. When that block shifts there is
      briefly nothing to draw. Rare, since those tiles span thousands of
      kilometres, but it is the one hole remaining by construction. Fix: seed the
      coarsest two or three levels at startup and never evict them, giving a
      permanent floor under the pyramid.
- [ ] **Permanent tile blacklist.** `tiles.js` sets a retry time of `now + 1e12`
      after the second failure, so one transient network blip kills that tile for
      the rest of the session. Should be exponential backoff with a cap.
- [ ] **Level pop-in is visible with fog off.** Fog used to hide ring
      transitions. Needs a short cross-fade or per-level alpha.
- [ ] **Texture upload happens on the main thread.** `texImage2D` plus
      `generateMipmap` for every arriving tile runs inside the frame. Several
      landing at once is a hitch. Cap it at one or two uploads per frame.
- [ ] **No gravity.** Walking rides up cliffs. By design for now; a character
      controller is its own project.
- [ ] **Keyboard Lock unverified in the wild.** Chrome and Edge only. Firefox
      silently falls back and Ctrl+W still closes the window there. The pad reads
      KEYS LOCKED when it is genuinely active — trust that, not the code.

## Untested, in rough order of risk

- [ ] **Antimeridian crossing.** `rawX` wrapping in `rings.js` is unexercised.
      At coarse levels a block near the date line may generate duplicate tile
      keys with different offsets, drawing one and leaving a gap.
- [ ] **High latitude and poles.** `computeBlocks` skips out-of-range `y`, but
      behaviour above 80 degrees has never been looked at. There is a hole at
      each pole by construction, since Web Mercator stops at 85 degrees.
- [ ] **LRU eviction.** `CACHE_TILES` is 512 and tests never reach it, so the GL
      deletion path has effectively never run under test. A leak here would only
      show after a long session.
- [ ] **The real worker path.** Tests mock `Worker` entirely. The actual fetch,
      decode and rasterise path is only covered manually by `diag.html`.
- [ ] **Shader compilation.** Mocked in tests. `diag.html` compiles equivalent
      GLSL but not the real shaders.

---

## The big one

### Sphere (ECEF)

The `y -= d²/2R` curvature term is a parabola around the camera. It is a decent
approximation to maybe 10 degrees of arc and nonsense beyond, which is why the
world reads as a tilting plane rather than a closing limb from high altitude.

Visible cap half-angle at altitude h is `acos(R / (R + h))`:

| Altitude | Visible cap | Ground radius seen |
| --- | --- | --- |
| 80 km | 9 degrees | 1,010 km |
| 2,000 km | 40 degrees | 4,500 km |
| 35,786 km (geostationary) | 81 degrees | 9,040 km |

Roughly 150-250 lines in three places: tile mesh generation (lat/lon per grid
node into ECEF), the per-tile transform (a `mat4` instead of a `vec2`, still
computed in float64 on the CPU), and the controls (the same yaw/pitch maths in a
local ENU frame rebuilt each frame).

`rings.js`, the loader, the worker fetch path, the palette and the LOD selection
are all unaffected — the clipmap works in tile space, independent of rendering.

**It deletes more than it adds:** the parabola, the `cos(lat)` scale factor, the
coarse z6/z5/z4 horizon rings, and the square world edge all go.

**It does not fix the data.** Still Web Mercator, still nothing above 85 degrees,
still a hole at each pole. That needs a different tiling scheme and is a much
larger job.

**Bring an ocean shell.** At hemisphere scale, ocean rendered per-tile leaves
holes wherever tiles have not loaded.

---

## Features discussed, not started

- [ ] **Artificial horizon.** The heading indicator shipped; the pitch half did
      not. Belongs with the sphere, where "level" becomes a computed quantity
      rather than `pitch == 0`. The real disorientation while testing was
      vertical, not lateral.
- [ ] **VFR sectional symbology.** Prominent buildings, roads, built-up areas,
      airfields. Sectionals solve the altitude question with declutter tiers,
      which maps onto the LOD levels almost directly.
- [ ] **Lake versus river colouring.** The `class` tag is already decoded and
      currently unused.
- [ ] **Extruded OSM building footprints.** The `building` layer starts at zoom
      13 and the finest level here is zoom 12, so this needs a finer level first.
- [ ] **Procedural, position-seeded near-field detail inside 300 m.** Source data
      is sampled every 30 m and your eye is 1.7 m up, so everything within
      walking distance is smooth interpolation. Must be deterministic from
      position, or the rock moves when you turn around.
- [ ] **FABDEM or Copernicus GLO-30 as an alternate source.** Bare earth, so
      forest edges stop appearing as 20 m cliffs.
- [ ] **Optional atmospheric fog** as realism rather than as a distance limiter.
- [ ] **Prefetch along the velocity vector**, so tiles arrive before they are
      needed rather than as they become needed.
- [ ] **Service worker**, so a region can be cached and flown offline.
- [ ] **Native port to Rust and wgpu.** Every line of tile, clipmap and shader
      logic ports across unchanged.
