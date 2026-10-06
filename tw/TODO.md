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
- **Terrain: two close-up levels (zoom 13, 14), not hand-built places.** The
  terrain service mixes sources (10 m US, 5 m Arctic, 30 m radar elsewhere);
  `terraincheck.html` showed finer levels really sharpen Niagara, the Grand
  Canyon, Norway and New Zealand, and change nothing for Thor Peak or the
  30 m-only places. Hand-built ground patches (a modelled Niagara) do not scale.
  Flat water with hard edges was considered and not chosen.
- **Places of interest: survey tiles per area, not hand-built ground.** Where
  even zoom 14 is wrong (Niagara), a place gets its own tiles built from 1-2 m
  laser-survey data (`places/`, `tools/places/build_place.py`), with zoom 15
  and 16 there only. Open question: they are built ahead of time, not streamed
  from the public source (see Features).
- **Labels must be toggleable**, never always-on.
- **Overlay direction is VFR sectional symbology**, not place labels. Detail
  level and altitude behaviour both undecided; explicitly a thing to play with
  rather than specify up front. Needs a spike, not a spec.

---

## Bugs and rough edges

- [ ] **Niagara, US side, after the seam fix.** The Canadian survey made the
      Horseshoe Falls right. On the US side, white lines crossed the upper
      river where one survey's data ended; the builder now blends surveys over
      60 m. Rebuild and look. If the American Falls is still rough, the US
      survey itself smooths water (it does not measure it), and that needs its
      own fix.
- [ ] **Rogers Centre mask, small pieces.** The footprint mask hid the main
      map building; the smaller pieces around the rim were the open question.
      Confirm with key 4 (on and off) that nothing pokes through.
- [ ] **No buildings from airliner height.** At 9.4 km over Toronto,
      downtown 10 km away shows no buildings at all, only the landmarks.
      Cause: the near field and the skyline both switch off above
      `NF_MAX_AGL` (4,000 m above ground, `src/config.js`; the skyline follows
      `view.nearOn` in `src/skyline.js`). Above that, buildings are only the
      grey built-up paint. Real cities stay visible from cruise height, so the
      tall ones at least should: perhaps keep the skyline (tall buildings
      only) on to a much greater height, or make its reach grow with height.
- [ ] **A spike in Lake Erie.** A thin white column several kilometres tall
      stands in the lake near 42.88, -79.24 (off Port Colborne), seen from
      40 km up. Probably a bad value in the usual elevation tiles that the
      spike filter (despike) misses, drawn white as steep water. Find which
      tile and zoom it comes from, and why despike lets it through.

- [ ] **Painted roads, middle distance.** Close up, roads are now real ribbons
      draped on the ground (the near field, `src/near.js`, `src/roads.js`),
      and the painted roads hide where those are drawn. Beyond the near field
      roads are still painted into the map texture: flat stripes, no casing,
      and too wide for their texels at zoom 12. Worth a look if they bother
      you; not urgent.
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

- [ ] **Antimeridian crossing.** Flown once (Naples to Banff eastward) with no
      visible gap, and the saved longitude now wraps. Still untested: `rawX`
      wrapping in `rings.js` at coarse levels near the date line, which could
      give duplicate tile keys with different offsets.
- [ ] **High latitude and poles.** `computeBlocks` skips out-of-range `y`, but
      behaviour above 80 degrees has never been looked at. There is a hole at
      each pole by construction, since Web Mercator stops at 85 degrees.
- [ ] **LRU eviction.** `CACHE_TILES` is 800 and tests never reach it, so the GL
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

- [ ] **Place tiles break the premise.** The app is meant to take its data
      from public sources, live, streaming as you go. A place's tiles are
      instead made ahead of time on one computer (`tools/places/build_place.py`)
      and served from there, so only a computer that has run the builder sees
      them. Not a bug; something to think through. One way back to the
      premise: both survey sources publish their files in a form a browser can
      read a piece at a time (cloud-optimised GeoTIFF), so the app could read
      the survey data directly while you fly, if those servers allow it from a
      web page (CORS) and it is fast enough. Otherwise: host the built tiles
      publicly, or keep them in git (Niagara is about 15 MB).

- [ ] **Moving ground, next steps.** Tools mode, `N` (src/transplant.js):
      outline, pick up, carry, turn, lay down; rise above its edge or height
      above sea level (`U`). Drawn as a solid model with a wall around its
      edge; the ground under it is not changed. Saved outlines: the PIECES list
      (src/pieces.js). Mountain lookup by name in the PIECES list
      (src/mountains.js): Wikidata for the summit, outline traced at the col
      on the height tiles, within a chosen reach. Next, agreed: part 2, cities:
      move the buildings and roads inside the outline too, draped on the
      destination's ground (downtown Toronto on Saba, in front of Mount St
      Helens). Open: in rise mode a valley below the outline's edge comes out
      flat (nothing goes below the base); whether to hide the destination's
      ground under a piece; pieces carry no water or map colours, only a
      height colour (green, brown, rock, snow).

- [ ] **You can't stand on a moved mountain.** A laid piece has no ground
      under your feet: walking and the ground height (`groundAt`/`heightAt`)
      ignore pieces, so you fall through it to the ground beneath. The ground
      height should take the highest laid piece under you into account.


- [ ] **Dropping landmarks, next steps.** `M` drops one at the crosshair
      (src/dropper.js). Still to do: a search to pick from many landmarks
      rather than pressing `M` through them all, and masking: a dropped
      landmark does not hide the map buildings under it, as listed ones do
      (the near-field helper reads only landmarks/index.json).

- [ ] **Artificial horizon.** The heading indicator shipped; the pitch half did
      not. Belongs with the sphere, where "level" becomes a computed quantity
      rather than `pitch == 0`. The real disorientation while testing was
      vertical, not lateral.
- [ ] **VFR sectional symbology.** Prominent buildings, roads, built-up areas,
      airfields. Sectionals solve the altitude question with declutter tiers,
      which maps onto the LOD levels almost directly.
- [ ] **Lake versus river colouring.** The `class` tag is already decoded and
      currently unused.
- [ ] **Procedural, position-seeded near-field detail inside 300 m.** Source data
      is sampled every 30 m and your eye is 1.7 m up, so everything within
      walking distance is smooth interpolation. Must be deterministic from
      position, or the rock moves when you turn around.
- [ ] **FABDEM or Copernicus GLO-30 as an alternate source.** Bare earth, so
      forest edges stop appearing as 20 m cliffs.
- [ ] **Optional atmospheric fog** as realism rather than as a distance limiter.
- [ ] **Service worker**, so a region can be cached and flown offline.
- [ ] **Native port to Rust and wgpu.** Every line of tile, clipmap and shader
      logic ports across unchanged.
