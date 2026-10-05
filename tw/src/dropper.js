// Dropping a landmark where the crosshair meets the ground: the CN Tower beside
// Vesuvius, say.
//
//   M        arm, then the next landmark each press, then off again
//   click    drop it (while the mouse is captured)
//   , and .  turn it 15 degrees left or right
//   Delete   remove the dropped landmark under the crosshair
//
// While armed, the chosen landmark stands where the crosshair meets the ground,
// so you see what you will get. Dropped landmarks are kept in this browser
// (localStorage), like the saved places, and come back after a reload.

import { mercScale, mercYToLat, wrapMercDx, R_MEAN } from './geo.js';

const KEY = 'tw.drops';
const TURN = 15;            // degrees per press
const REACH = 100000;       // metres: the farthest ground the crosshair can pick

const store = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };

// Where a line from the eye along (yaw, pitch) first meets the ground, as it is
// drawn: the ground drops away with the Earth's curve. groundAt(mercX, mercY)
// gives the height or null where nothing has loaded. Returns { mx, my, d }
// (d = metres along the ground) or null if the line meets no loaded ground.
export function aimPoint(cam, groundAt) {
  const k = mercScale(mercYToLat(cam.mercY));
  const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
  const east = Math.sin(cam.yaw) * cp, north = Math.cos(cam.yaw) * cp;
  const curv = 1 / (2 * R_MEAN);
  // Above ground (> 0) or below it (< 0) at t metres along the line; null where unknown.
  const above = (t) => {
    const mx = cam.mercX + east * t / k, my = cam.mercY + north * t / k;
    const g = groundAt(mx, my);
    if (g === null || g === undefined) return null;
    const d = t * cp;
    return cam.alt + sp * t - (g - curv * d * d);
  };
  let t0 = 0, t = 1;
  while (t < REACH) {
    const a = above(t);
    if (a !== null && a <= 0) {
      for (let i = 0; i < 30; i++) {        // narrow it down between the last two steps
        const m = (t0 + t) / 2, am = above(m);
        if (am !== null && am <= 0) t = m; else t0 = m;
      }
      return { mx: cam.mercX + east * t / k, my: cam.mercY + north * t / k, d: t * cp };
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
    landmarks.ready.then(() => this._restore());
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

  turn(sign) {
    if (!this.armed) return;
    this.yawDeg = ((this.yawDeg + sign * TURN) % 360 + 360) % 360;
    this.L.turnTo(this.preview, this.yawDeg);
  }

  // Every frame, before landmarks.update(): stand the preview at the crosshair.
  update(cam, groundAt) {
    const note = this.note && Date.now() < this.noteUntil ? this.note : '';
    if (!this.armed) { this.aim = null; this.message = note; return; }
    this.aim = aimPoint(cam, groundAt);
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

  // Click: a copy of the preview stays where it is.
  drop() {
    if (!this.armed || !this.aim) return null;
    const p = this.preview;
    const it = this._add({ model: p.model, lat: p.lat, lon: p.lon, yawDeg: this.yawDeg });
    this._save();
    if (it) this._say(`Dropped ${it.name}`);
    return it;
  }

  // Delete: the dropped landmark the crosshair is on. You aim at the tower
  // itself, not at its foot, so this tests the line of sight against each
  // dropped landmark as an upright column, nearest first. Failing that, the
  // ground point under the crosshair, within the landmark's mask radius.
  removeAimed(cam, groundAt) {
    const best = this.aimedAt(cam, groundAt);
    if (best) { this.L.remove(best); this._save(); this._say(`Removed ${best.name}`); }
    else this._say('No dropped landmark under the crosshair');
    return best;
  }

  aimedAt(cam, groundAt) {
    const k = mercScale(mercYToLat(cam.mercY));
    const cp = Math.cos(cam.pitch), sp = Math.sin(cam.pitch);
    const e = Math.sin(cam.yaw) * cp, n = Math.cos(cam.yaw) * cp;
    const curv = 1 / (2 * R_MEAN);
    let best = null, bestT = Infinity;
    for (const it of this.L.items) {
      if (!it.dropped || it.base === null) continue;
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
    const aim = aimPoint(cam, groundAt);
    if (!aim) return null;
    let bestD = Infinity;
    for (const it of this.L.items) {
      if (!it.dropped) continue;
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

  _save() {
    const s = store();
    if (s) try { s.setItem(KEY, JSON.stringify(this.list())); } catch (e) { /* storage is a bonus */ }
  }

  _restore() {
    const s = store();
    if (!s) return;
    let saved = [];
    try { saved = JSON.parse(s.getItem(KEY) || '[]'); } catch (e) { return; }
    for (const d of Array.isArray(saved) ? saved : []) {
      if (Number.isFinite(d.lat) && Number.isFinite(d.lon)) this._add(d);
    }
  }
}
