# Outstanding work

Kept in the repo deliberately. Nothing here is abandoned; items sit until they
are explicitly killed. Anything marked **DECISION** is waiting on Jim, not on
implementation.

---

## The one that blocks everything else

### DECISION 1 — Move to a sphere (ECEF)

Requested: "zoom out far enough that almost an entire hemisphere is visible."

That is not reachable with the current flat plane. The visible cap half-angle at
altitude h is `acos(R / (R + h))`:

| Altitude | Visible cap | Ground radius seen |
| --- | --- | --- |
| 80 km (current max useful) | 9 degrees | 1,010 km |
| 2,000 km | 40 degrees | 4,500 km |
| 6,371 km (one Earth radius) | 60 degrees | 6,670 km |
| 35,786 km (geostationary) | 81 degrees | 9,040 km |

Roughly geostationary distance for "almost a hemisphere". Three things break
before you get near it:

1. The `y -= d²/2R` curvature term is a parabola around the camera, not a
   sphere. It is a good approximation to maybe 10 degrees of arc and nonsense
   past that. It bends the world toward you instead of closing it into a limb.
2. Square Mercator rings cannot tile a hemisphere. Coverage would need to reach
   ~20,000 km, where Mercator distortion is unbounded.
3. Ocean is currently per-tile geometry. At hemisphere scale you need a base
   sphere shell at sea level, or the planet has holes.

Estimated 150-250 lines, concentrated in three files. `rings.js`, the loader,
the worker fetch path, the palette and the LOD selection are all unaffected —
the clipmap works in tile space, which is independent of how it is rendered.

**Deletes more than it adds**: the parabola, the `cos(lat)` scale factor, the
coarse z6/z5/z4 horizon rings, and the square world edge all disappear.

**Does not fix:** the data is still Web Mercator. No coverage above 85 degrees.
There will be a hole at each pole. Fixing that is a different tiling scheme and
a much larger job.

---

## Decisions taken

- **Sphere (ECEF): GO.** Pole holes accepted for now. This is the next build.
- **Controls: DONE in 0.3.0.** Keyboard Lock plus fullscreen, Q/E bound, and an
  on-screen pad. Note the pad is only clickable when the pointer is free; while
  pointer lock is held it acts as a state readout instead.
- **Water: DONE in 0.4.0.** Vector, draped as a texture. No flattening.
- **Compass: DONE in 0.3.0.** Aviation directional gyro — rotating card, fixed
  lubber line, labels in degrees/10.
- **Labels: must be toggleable.** Not always-on.
- **Overlay direction changed.** Not Natural Earth place labels. Wanted instead:
  VFR sectional-chart style symbology — prominent buildings, roads, built-up
  areas. Level of detail and altitude behaviour both undecided; explicitly a
  thing to play with rather than specify up front. Needs a spike, not a spec.

## Bugs and rough edges

- [ ] **Keyboard Lock needs verifying in the wild.** Implemented in 0.3.0 but
      untestable headless. Chrome and Edge only; Firefox silently falls back to
      unprotected keys and Ctrl+W still closes the window there. The pad shows
      KEYS LOCKED when it is genuinely active — trust that, not the code.
- [ ] **Level pop-in is visible with fog off.** Fog used to hide ring
      transitions. Needs either a short cross-fade or per-level alpha.
- [ ] **Permanent tile blacklist.** `tiles.js` sets a retry time of `now + 1e12`
      after the second failure, so one transient network blip kills that tile
      for the rest of the session. Should be exponential backoff with a cap.
- [ ] **Square world edge** above the altitude where rings run out. Resolved by
      the sphere, not worth patching separately.
- [ ] **No gravity.** Walking rides up cliffs. By design for now.

## Fixed this session, listed so they are not re-litigated

- [x] Movement rotation sign errors (W walked sideways)
- [x] `lastSpace = 0` sentinel made the first Space press a false double-tap
- [x] Space auto-repeat strobed the flight toggle
- [x] Fixed depth-split plane opened a 9 km gap ring on the horizon
- [x] Windows MIME bug blocking ES modules (`serve.py`)
- [x] Pointer lock and held keys surviving focus loss
- [x] Stale `levels` in the URL silently capping the horizon
- [x] Build stamp in the HUD so version confusion is diagnosable

## Untested, in rough order of risk

- [ ] **Antimeridian crossing.** `rawX` wrapping in `rings.js` is unexercised.
      At z4 a 4x4 block near the date line may generate duplicate tile keys with
      different offsets, drawing one and leaving a gap.
- [ ] **High latitude and poles.** `computeBlocks` skips out-of-range `y`, but
      behaviour above 80 degrees has never been looked at.
- [ ] **LRU eviction.** `CACHE_TILES` is 512 and tests never reach it, so the
      GL buffer deletion path has never run. A leak here would only show after a
      long session.
- [ ] **Real worker path.** Tests mock `Worker` entirely. The actual
      fetch/decode path is only covered manually by `diag.html`.
- [ ] **Shader compilation.** Mocked in tests. `diag.html` compiles equivalent
      GLSL but not the real shaders.

- [ ] **Artificial horizon.** The heading indicator shipped; the pitch/level
      part did not. Worth adding after the sphere, where level becomes a real
      computed quantity. The disorientation this session was vertical.
- [ ] ~~**Compass**~~ done in 0.3.0. Original note kept for the reasoning: `cam.yaw` is already the heading, so
      the readout is trivial. Worth building after the sphere, where "north"
      becomes the local meridian rather than a fixed world axis, and "level"
      becomes a computed quantity. A pitch/horizon indicator matters more than
      heading here: the real disorientation this session was vertical, not
      lateral. **DECISION 5: compass strip, corner rose, or combined
      heading-plus-horizon?**

- [x] ~~**Water as a vector layer.**~~ Shipped in 0.4.0. See README. Left open:
      lake/river colour differentiation using the `class` tag (decoded but
      unused), and whether `waterway` line widths should scale with zoom.

## Features discussed, not started

- [ ] **Natural Earth overlay** — coastlines, borders, city labels. A few MB of
      GeoJSON for the whole world, no tiling. Directly fixes "I could not tell
      where I was", which happened twice this session. **DECISION 3.**
- [ ] Human layer proper: extruded OSM building footprints
- [ ] Procedural, position-seeded near-field detail inside 300 m
- [ ] FABDEM or Copernicus GLO-30 as an alternate source (bare earth, no canopy)
- [ ] ESA WorldCover land classes driving the palette
- [ ] Optional atmospheric fog as realism rather than a distance limiter
- [ ] Native port to Rust and wgpu
