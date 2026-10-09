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
- **Water is vector, draped as a texture** from afar. Not raster, not
  flatness detection, not a floating decal. **Close by, changed 8 October:
  flat.** For walking, painted water on coarse ground climbs the banks, so
  within the near field each water area is a flat surface at one level, with
  a bank up to the ground, and the terrain is cut away under it (key 0 swaps
  back to painted). Falling water stays laid on the ground (`watersurface.js`).
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
- **The ground gives way to the road, not the other way round** (agreed
  8 October, not started). For walking and driving: along a road the terrain
  is cut and filled to the road's own gentle slope; buildings stand on a
  levelled pad; water lies flat; bridges and tunnels (marked in the map data)
  leave the ground alone. All of it edits the one shared height function
  (`heightgrid.js`) that the terrain and everything on it already read, so
  ground, roads and buildings stay in agreement. Comes with physics.
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

## Buildings: the new look (key 5), open ends

Built in `buildinglab.html` on 8 October, then wired into the near field
(0.13.19). Key 5 cycles: today's boxes, the new look on our map's buildings,
the new look on Overture's buildings.

- [ ] **The Overture release name is fixed in the code**
      (`OVERTURE_RELEASE`, `src/overture.js`). Overture publishes monthly and
      may remove old releases; when tiles stop coming, the K report shows the
      error. Needs a way to find the newest release, or a setting.
- [ ] **The far skyline keeps today's boxes.** Only the near field has the
      new look; the skyline still reads our map at zoom 13.
- [ ] **Performance not measured** on real cities. Overture tiles in dense
      downtowns are big; watch frame rate and near-field loading first.
- [ ] **Overture tiles carry no land use**, so building types come only from
      Overture's own type where given, and from our map's land use otherwise.
- [ ] **Doors go on both ends of a house**: the data does not say which way
      it faces. A street nearby could tell.
- [ ] **Monuments are guessed** from type (religious, civic) and class
      (church, museum...). Hand-built landmarks still hide what is under them.
- [ ] **Walking**: the new buildings are not solid yet (see physics, next).

## Water close by: open ends (0.13.21)

- [ ] **One level per water area, per map tile.** A canal drawn as one area
      across several locks, or a river that falls a little within a tile,
      gets one level (or is laid on the ground when it falls too much). Fix:
      cut areas at **lock gates and weirs** (OpenStreetMap has them, e.g.
      Healey Falls locks, 44.3716, -77.7765; our map tiles do not carry them),
      and let a river's level follow its length.
- [ ] **Small steps where a river crosses a tile edge**: each tile works out
      its own level.
- [ ] **Rivers drawn as lines only** (streams) stay painted.
- [ ] **No water surface look** yet: flat colour, no reflection or movement.
- [ ] **Better heights**: Canada's HRDEM (1 m, much of southern Canada),
      read in pieces like the Niagara survey tiles; check its licence
      (Open Government Licence - Canada: attribution) and that its servers
      allow web pages to read it.

## Ground: Canada's survey in rings (findings, 8 October; not in the app yet)

Labs: `groundlab.html` (today's ground beside the survey) and
`groundrings.html` (detail in rings round you). Jim checked Ottawa's Rideau
Canal locks, Healey Falls, Campbellford, the Welland Canal: all much better
than today's ground, and water painted on the survey's ground lies right.
Niagara Falls: not good (and mostly not surveyed); it keeps its own place
tiles. Decided: leave it as is for now, come back with walking.

- **Source:** HRDEM, Natural Resources Canada, Open Government Licence -
  Canada (credit on screen). Catalogue `datacube.services.geo.ca/stac`,
  files on `canelevation-dem.s3.ca-central-1.amazonaws.com`, one cloud
  GeoTIFF per region (500,000 px square at 1 m, 11 levels, LZW, 512 px
  blocks, no-data -32767), on Canada Atlas Lambert (`src/lcc.js`). Browsers
  may read it. Bare ground (`dtm`) and surface with trees and buildings
  (`dsm`); surface minus ground gives tree heights, if ever wanted.
- **The rule that works:** rings at 1, 2, 4, 8 m round you (today's ground
  beyond), each reaching 256 cells each side; a ring is on while one of its
  cells covers at least 2 pixels on screen (off below 60% of that); rings
  move in steps of 64 cells; the finer ring's outer quarter blends to the
  coarser ring's heights; cut squares along the closer diagonal.
- **Cost:** a 512 px block is about 1 MB. Fetch each once and keep it
  (`SurveyBlocks`). A visit low down: 25-40 MB; a long low flight
  wandering across a town: about 180 MB (Campbellford). Ring builds take
  30-80 ms; the wait is for blocks, so in the app fetch in the background
  and show the coarser ring until the finer arrives.
- **Coverage:** gaps (Niagara Gorge 71%, Campbellford edges 30-55% at 2-8
  m reach) fall back to today's ground.
- [ ] **Water paint climbs canal walls** where the map's outline is wider
      than the channel: paint water only where the survey's ground is at
      the water's level.
- [x] **In the app since 0.13.28 (key J, on by default):** zoom 13 to 16
      ground in Canada comes from the survey (16, 8, 4, 2 m), gaps filled from
      the usual tiles (`surveytile.js`). Pieces are kept in the browser's
      storage ("tw-survey-v1"), shared by the helpers and between visits.
- [ ] **Roads and buildings drape on zoom 14** (8 m survey) while the ground
      is drawn at zoom 16 (2 m): small floats and sinks on steep ground. Same
      as at Niagara before. Drape on the finest level instead.
- [ ] **No 1 m level in the app yet** (would be a zoom 17 level). The rings
      lab showed the 1 m detail is worth having on foot.
- [ ] **The survey storage has no size limit yet.** Check what it grows to
      after long trips; add a cap.
- [ ] **The GeoTIFF reader comes from a public library site** (jsdelivr).
      If it cannot be reached, survey tiles fall back to the usual ones.
- [ ] Retire the flat-water patches (key 0) where the survey covers.
- [ ] Other countries' surveys (US 3DEP, much of Europe), later.

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
      on the height tiles, within a chosen reach.
      **Cities (0.13.13, built, not yet seen in a browser):** a piece also
      carries what stands on it: the map's water, built-up areas and cover
      painted on its ground, real roads, railways, airport pavement and
      buildings (the near-field code, pointed at the piece's ground), and the
      landmarks inside the outline (copies, turned with it). Each follows its
      own button. Only the shape is drawn while carried; the map is fetched in
      the background (message line: "map 3/9") and appears once laid. Files:
      `piecegrid.js` (the ground as numbers), `citykit.js` (one map tile's
      roads and buildings, and the paint), `city.js` (fetching, loader),
      `overlayraster.js` (map painting, shared with the tile helper), and a
      `city` job in `nearworker.js`. Open, in order of likely annoyance:
      - **The destination's own map still draws under and through a laid
        city** (its buildings, roads, water paint, and its ground where that
        is higher than the piece). Hiding them inside the outline needs a
        cut-out in the near field, the skyline and the terrain shader.
      - **Overlap is not handled.** Two pieces laid over each other will
        flicker where their surfaces cross; "last one laid wins" is the
        intention, not what happens.
      - Airport areas and buildings are kept or dropped whole by where their
        middle is, so one that crosses the outline hangs over the edge. Roads
        and railways are cut exactly.
      - A big outline gets a coarser map (never more than 256 map tiles: zoom
        14 for a city, 13 or 12 for a big mountain), so a mountain shows no
        buildings. Dense cities have no distance culling, so Manhattan is a lot
        of triangles. Not tested at that size.
      - The painted far roads are not carried, only the real ribbons. The
        slab's paint is one colour per grid node (about 360 across), so water
        edges are soft, not sharp.
      - Painting a big piece takes about 40 ms, on every WATER, BUILT or COVER
        press and (at most every 0.6 s) while tiles arrive.
      - Saved pieces keep the outline only; the map is fetched again when you
        take one in hand. If the map service's address is not known yet, the
        message line says "no map yet" (ground and landmarks still move).
      - A dropped landmark (`M`) inside an outline comes along, but its map
        building is not hidden (only listed landmarks mask the map).
      Also open: in rise mode a valley below the outline's edge comes out flat
      (nothing goes below the base); pieces carry no water or map colours into
      the *ground* shape beyond the paint above.

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
