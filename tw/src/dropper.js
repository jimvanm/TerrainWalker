// Dropping a landmark where the crosshair meets the ground: the CN Tower beside
// Vesuvius, say.
//
//   M        arm, then the next landmark each press, then off again
//   click    drop it (while the mouse is captured)
//   , and .  turn it 15 degrees left or right
//   Delete   remove the dropped landmark under the crosshair
//
// While armed, the chosen landmark stands where the crosshair meets the ground,
// so you see what you will get. Dropped landmarks last until the page is
// reloaded: they are quick to drop again, and nothing is left to forget about.

import { mercScale, mercYToLat, wrapMercDx, R_MEAN } from './geo.js';

const TURN = 15;            // degrees per press
const REACH = 100000;       // metres: the farthest ground the crosshair can pick


// The direction you look in: { e, n, u } (east, north, up), length 1.
export function forward(cam) {
  const cp = Math.cos(cam.pitch);
  return { e: Math.sin(cam.yaw) * cp, n: Math.cos(cam.yaw) * cp, u: Math.sin(cam.pitch) };
}

// The direction through a point on the screen: sx, sy in pixels from the top
// left of a w x h view, fovDeg the view's height in degrees. The middle of the
// screen gives forward(cam). For the pointer in Tools mode.
export function screenDir(cam, sx, sy, w, h, fovDeg) {
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const cy = Math.cos(cam.yaw), syaw = Math.sin(cam.yaw);
  const f = { e: syaw * cp, n: cy * cp, u: sp };
  const r = { e: cy, n: -syaw, u: 0 };                 // right
  const up = { e: -sp * syaw, n: -sp * cy, u: cp };    // up, on the screen
  const t = Math.tan(fovDeg * Math.PI / 360);
  const x = (2 * sx / w - 1) * t * (w / h), y = (1 - 2 * sy / h) * t;
  const d = { e: f.e + x * r.e + y * up.e, n: f.n + x * r.n + y * up.n, u: f.u + x * r.u + y * up.u };
  const L = Math.hypot(d.e, d.n, d.u);
  return { e: d.e / L, n: d.n / L, u: d.u / L };
}

// Where a line from the eye along dir (default: where you look) first meets
// the ground, as it is drawn: the ground drops away with the Earth's curve.
// groundAt(mercX, mercY) gives the height or null where nothing has loaded.
// Returns { mx, my, d } (d = metres along the ground) or null if the line
// meets no loaded ground.
export function aimPoint(cam, groundAt, dir = forward(cam)) {
  const k = mercScale(mercYToLat(cam.mercY));
  const { e: east, n: north, u: up } = dir;
  const flat = Math.hypot(east, north);
  const curv = 1 / (2 * R_MEAN);
  // Above ground (> 0) or below it (< 0) at t metres along the line; null where unknown.
  const above = (t) => {
    const mx = cam.mercX + east * t / k, my = cam.mercY + north * t / k;
    const g = groundAt(mx, my);
    if (g === null || g === undefined) return null;
    const d = t * flat;
    return cam.alt + up * t - (g - curv * d * d);
  };
  let t0 = 0, t = 1;
  while (t < REACH) {
    const a = above(t);
    if (a !== null && a <= 0) {
      for (let i = 0; i < 30; i++) {        // narrow it down between the last two steps
        const m = (t0 + t) / 2, am = above(m);
        if (am !== null && am <= 0) t = m; else t0 = m;
      }
      return { mx: cam.mercX + east * t / k, my: cam.mercY + north * t / k, d: t * flat };
    }
    t0 = t;
    t = t * 1.03 + 1;
  }
  return null;
}

export class Dropper {
  constructor(landmarks) {
    this.L = landmarks;
    this.choice = -1;          // index into landmarks.kinds; -1 is off
    this.yawDeg = 0;
    this.preview = null;       // the placement that follows the crosshair
    this.aim = null;
    this.message = '';
    this.count = 0;
    // Earlier versions kept drops in the browser; forget any left from then.
    try { globalThis.localStorage && globalThis.localStorage.removeItem('tw.drops'); } catch (e) { /* none */ }
  }

  get armed() { return this.choice >= 0; }

  // M: off -> first landmark -> next ... -> off.
  cycle() {
    const kinds = this.L.kinds;
    if (!kinds.length) { this.message = 'No landmarks to drop'; return; }
    this.choice = this.choice + 1 >= kinds.length ? -1 : this.choice + 1;
    if (this.preview) { this.L.remove(this.preview); this.preview = null; }
    if (this.armed) {
      const kd = kinds[this.choice];
      this.preview = this.L.add({ ...kd, model: kd.id, id: 'preview', yawDeg: this.yawDeg, preview: true });
      this.preview.hidden = true;
    }
  }

  // Leaving Tools mode: put the armed landmark away.
  off() {
    if (this.preview) { this.L.remove(this.preview); this.preview = null; }
    this.choice = -1;
  }

  turn(sign) {
    if (!this.armed) return;
    this.yawDeg = ((this.yawDeg + sign * TURN) % 360 + 360) % 360;
    this.L.turnTo(this.preview, this.yawDeg);
  }

  // Every frame, before landmarks.update(): stand the preview where you aim:
  // dir is the pointer's direction in Tools mode, or left out for the crosshair.
  update(cam, groundAt, dir) {
    this.dir = dir;
    const note = this.note && Date.now() < this.noteUntil ? this.note : '';
    if (!this.armed) { this.aim = null; this.message = note; return; }
    this.aim = aimPoint(cam, groundAt, dir || forward(cam));
    const kd = this.L.kinds[this.choice];
    if (this.aim) {
      this.L.moveTo(this.preview, this.aim.mx, this.aim.my);
      this.preview.hidden = false;
    } else {
      this.preview.hidden = true;
    }
    const where = this.aim ? `${(this.aim.d / 1000).toFixed(1)} km away` : 'aim at the ground';
    this.message = note || `Drop: ${kd.name} (${where})  ·  click drop  ·  , . turn  ·  M next/off`;
  }

  // A click with nothing in hand: pick up the dropped landmark pointed at,
  // turned as it stood. Returns true if there was one.
  pickUp(cam, groundAt) {
    if (this.armed) return false;
    const it = this.aimedAt(cam, groundAt, this.dir);
    if (!it) return false;
    const i = this.L.kinds.findIndex((q) => q.id === it.model);
    if (i < 0) return false;
    this.L.remove(it);
    this.yawDeg = it.yawDeg;
    this.choice = i - 1;
    this.cycle();                 // arms kinds[i], with the preview
    this._say(`Picked up ${it.name}`);
    return true;
  }

  // Click: a copy of the preview stays where it is.
  drop() {
    if (!this.armed || !this.aim) return null;
    const p = this.preview;
    const it = this._add({ model: p.model, lat: p.lat, lon: p.lon, yawDeg: this.yawDeg });
    if (it) this._say(`Dropped ${it.name}`);
    return it;
  }

  // Delete: the dropped landmark the crosshair is on. You aim at the tower
  // itself, not at its foot, so this tests the line of sight against each
  // dropped landmark as an upright column, nearest first. Failing that, the
  // ground point under the crosshair, within the landmark's mask radius.
  removeAimed(cam, groundAt) {
    const best = this.aimedAt(cam, groundAt, this.dir);
    if (best) { this.L.remove(best); this._say(`Removed ${best.name}`); }
    else this._say('No dropped landmark under the crosshair');
    return best;
  }

  aimedAt(cam, groundAt, dir) {
    dir = dir || forward(cam);
    const k = mercScale(mercYToLat(cam.mercY));
    const { e, n, u: sp } = dir;
    const curv = 1 / (2 * R_MEAN);
    let best = null, bestT = Infinity;
    for (const it of this.L.items) {
      if (!it.dropped || it.piece || it.base === null) continue;   // pieces of ground: transplant.js
      const dx = wrapMercDx(it.mx - cam.mercX) * k, dn = (it.my - cam.mercY) * k;
      const hh = e * e + n * n;
      if (hh < 1e-6) continue;                       // looking straight down: the ground test below
      const t = (dx * e + dn * n) / hh;              // along the line, where it passes the column closest
      if (t <= 0) continue;
      const miss = Math.hypot(dx - e * t, dn - n * t);
      const d = Math.hypot(dx, dn);
      const foot = it.base - curv * d * d, top = foot + it.height;   // as drawn, with the Earth's curve
      const r = Math.max(25, it.maskR || 0);
      const y = cam.alt + sp * t;
      if (miss <= r && y >= foot - r && y <= top + r && t < bestT) { best = it; bestT = t; }
    }
    if (best) return best;
    const aim = aimPoint(cam, groundAt, dir);
    if (!aim) return null;
    let bestD = Infinity;
    for (const it of this.L.items) {
      if (!it.dropped || it.piece) continue;
      const d = Math.hypot(wrapMercDx(it.mx - aim.mx), it.my - aim.my) * mercScale(mercYToLat(aim.my));
      if (d <= Math.max(60, it.maskR || 0) && d < bestD) { best = it; bestD = d; }
    }
    return best;
  }

  // A short note in the drop line, for a couple of seconds.
  _say(text) { this.note = text; this.noteUntil = Date.now() + 2500; }

  _add(d) {
    const kd = this.L.kinds.find((q) => q.id === d.model);
    if (!kd) return null;
    return this.L.add({ ...kd, model: kd.id, id: 'drop:' + (this.count++), lat: d.lat, lon: d.lon,
      yawDeg: d.yawDeg || 0, dropped: true });
  }

  list() {
    return this.L.items.filter((it) => it.dropped)
      .map((it) => ({ model: it.model, lat: +it.lat.toFixed(6), lon: +it.lon.toFixed(6), yawDeg: it.yawDeg }));
  }
}
