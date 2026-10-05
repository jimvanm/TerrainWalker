// How much to load and how much to draw, worked out once per frame.
//
// Detail.update() returns a "view": one object describing the camera and the
// decisions that follow from it. Every layer is handed the same view, so no
// layer works anything out for itself and they cannot disagree.
//
// Fetch, draw and hold are separate decisions (see TODO.md):
//   drawLevels  how many terrain levels to draw (what fog and horizon allow)
//   minLevel    the finest level worth fetching at this speed
//   nearOn      draw the real roads and buildings (height only, never speed)
//   nearFetchOk fetch new near tiles (speed)
//
// Every threshold has a dead band, so hovering at a boundary does not flicker.

import { LEVELS, NF_MAX_AGL, NF_MAX_SPEED, LEAD_SECONDS } from './config.js';

// The close-up levels at the start of LEVELS: fetched only while the near field is on.
const CLOSE = LEVELS.filter((L) => L.close).length;
import { mercScale, tileSizeMerc, R_MEAN } from './geo.js';

// How long a tile takes to arrive. Finer levels are not fetched if you would
// cross a tile in less than this, because a tile replaced before it finishes
// loading never converges: it thrashes between stand-in and detail forever.
const LOAD_S = 2.5;

export class Detail {
  constructor() {
    this.viewDist = 20000;   // smoothed, metres
    this.drawLevels = 2;
    this.minLevel = 0;
    this.nearOn = false;
    this.nearR = 2;          // near block radius in tiles (2 = 5x5, 3 = 7x7, 4 = 9x9)
    this.lvx = 0; this.lvz = 0;   // smoothed horizontal velocity, for look-ahead
  }

  // cam: { mercX, mercY, lat, lon, alt, yaw, pitch, fly }
  // ground: terrain height under the camera, or null before any has loaded
  // motion: { speed, hspeed, vx, vz } from controls
  // opts: { fog, levels } from settings
  update(dt, cam, ground, motion, opts) {
    const k = mercScale(cam.lat);
    const span = (level) => tileSizeMerc(LEVELS[level].z) * k * 2;   // a level's reach, metres
    const agl = Math.max(ground === null ? cam.alt : cam.alt - ground, 1);
    const active = opts.levels;

    // View distance follows height above ground, using the real horizon
    // formula sqrt(2*R*h): 5 km at head height, 110 km at 1 km up, 350 km at
    // 10 km up. Smoothed so climbing opens the view rather than snapping it.
    const horizon = Math.sqrt(2 * R_MEAN * agl);
    const target = Math.min(Math.max(horizon * 1.2, 4000), span(active - 1));
    this.viewDist += (target - this.viewDist) * (1 - Math.exp(-2 * dt));

    // Only draw levels fog does not entirely swallow. A level is admitted once
    // its near edge falls inside 1.6x the fog distance, where fog is already
    // opaque, so new terrain fades in rather than popping. Grow at the
    // threshold, shrink only 35% past it.
    let d = this.drawLevels;
    while (d < active && span(d - 1) < this.viewDist * 1.6) d++;
    while (d > 2 && span(d - 2) > this.viewDist * 1.6 * 1.35) d--;
    d = Math.min(d, active);
    // With fog off, curvature is the only limit on the view, so never load
    // short of the horizon.
    if (!opts.fog) while (d < active && span(d - 1) < horizon) d++;
    this.drawLevels = d;

    // The real roads and buildings: drawn whenever we are low enough to see
    // them (height only; speed never switches them off).
    if (this.nearOn) { if (agl > NF_MAX_AGL * 1.15) this.nearOn = false; }
    else if (agl < NF_MAX_AGL) this.nearOn = true;

    // Only ask for detail we can keep at this speed. The close-up levels only
    // while the near field is on: it drapes on them, and from higher up their
    // detail is too small to see.
    const speed = Math.max(motion.speed, 1);
    let want = this.nearOn ? 0 : Math.min(CLOSE, d - 1);
    while (want < d - 1 && tileSizeMerc(LEVELS[want].z) * k / speed < LOAD_S) want++;
    let m = this.minLevel;
    const floor = this.nearOn ? 0 : Math.min(CLOSE, d - 1);
    if (want > m) m = want;
    else if (want < m && m - 1 >= floor && tileSizeMerc(LEVELS[m - 1].z) * k / speed > LOAD_S * 1.8) m--;
    this.minLevel = Math.max(0, Math.min(m, d - 1));

    // Look-ahead: also load around where we will be in LEAD_SECONDS. Loading
    // only around the present position means always flying into tiles that
    // have not arrived.
    const va = 1 - Math.exp(-3 * dt);
    this.lvx += (motion.vx - this.lvx) * va;
    this.lvz += (motion.vz - this.lvz) * va;
    const vmag = Math.hypot(this.lvx, this.lvz);
    const leadDist = Math.min(vmag * LEAD_SECONDS, 60000);
    const useLead = leadDist > 200;
    const lead = {
      use: useLead,
      x: useLead ? cam.mercX + (this.lvx / vmag) * leadDist / k : cam.mercX,
      y: useLead ? cam.mercY - (this.lvz / vmag) * leadDist / k : cam.mercY,
    };

    // Near field block: radius grows with height.
    // 5x5 low down, 7x7 from about 500 m, 9x9 from about 1.5 km. Far rings
    // carry only major roads and tall buildings, so extra tiles cost little.
    if (this.nearR < 3 && agl > 550) this.nearR = 3;
    else if (this.nearR > 2 && agl < 450) this.nearR = 2;
    if (this.nearR < 4 && agl > 1700) this.nearR = 4;
    else if (this.nearR > 3 && agl < 1400) this.nearR = 3;

    return {
      mercX: cam.mercX, mercY: cam.mercY, lat: cam.lat, lon: cam.lon,
      alt: cam.alt, yaw: cam.yaw, pitch: cam.pitch, fly: cam.fly,
      k,                              // true metres per mercator metre here
      curv: 1 / (2 * R_MEAN),         // drop per metre squared, for curvature
      ground, agl,                    // agl is at least 1 m, even before ground loads
      viewDist: this.viewDist,
      drawLevels: this.drawLevels,
      minLevel: this.minLevel,
      outer: span(this.drawLevels - 1),   // reach of the outermost drawn level
      lead,
      nearOn: this.nearOn,
      nearR: this.nearR,
      nearFetchOk: motion.hspeed < NF_MAX_SPEED,
    };
  }
}
