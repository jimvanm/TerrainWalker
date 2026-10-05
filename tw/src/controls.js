import {
  EYE_HEIGHT, WALK_SPEED, FLY_K, FLY_FLOOR, FLY_BOOST, FLY_MULT_MIN,
  FLY_MULT_MAX, WALK_MULT_MIN, WALK_MULT_MAX, GROUND_SMOOTH, DOUBLE_TAP_MS, MOUSE_SENS,
} from './config.js';
import { mercScale, mercYToLat } from './geo.js';

const HALF_PI = Math.PI / 2 - 0.001;

export class Controls {
  constructor(canvas, cam) {
    this.cam = cam;              // { mercX, mercY, alt, yaw, pitch, fly }
    this.keys = new Set();
    // A multiplier, not an absolute speed. As an absolute it stayed at whatever
    // you last set at altitude, so descending left you at ludicrous speed.
    this.flyMult = 1;
    this.walkMult = 1;           // same idea, for walking / driving on the ground
    this.cruise = 0;
    this.locked = false;
    // -Infinity, not 0: performance.now() is small just after page load, so a
    // zero sentinel makes the very first space press look like a double tap.
    this.lastSpace = -Infinity;
    this.speed = 0;
    this.vx = 0; this.vz = 0; this.hspeed = 0;   // horizontal velocity, true m/s (east, south)
    this.grounded = false;
    this.btn = { up: false, down: false, boost: false };

    // One gesture takes fullscreen, the keyboard and the pointer together.
    // Keyboard Lock is the only thing that stops Ctrl+W and Ctrl+Q reaching the
    // browser; preventDefault() cannot touch them.
    this.grab = async () => {
      try {
        if (!document.fullscreenElement) await document.documentElement.requestFullscreen();
      } catch (e) { /* fullscreen refused, carry on without it */ }
      try {
        if (navigator.keyboard && navigator.keyboard.lock) {
          await navigator.keyboard.lock();
          this.kbLocked = true;
        }
      } catch (e) { this.kbLocked = false; }
      canvas.requestPointerLock();
    };
    this.release = () => {
      if (navigator.keyboard && navigator.keyboard.unlock) navigator.keyboard.unlock();
      this.kbLocked = false;
      if (document.pointerLockElement) document.exitPointerLock();
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    };
    this.kbLocked = false;
    // Tools mode frees the mouse: you point at things instead of steering.
    // Only the pointer capture is let go; full screen and the keyboard lock
    // stay, so Ctrl+W is still caught and nothing jumps out of full screen.
    this.freeMouse = false;
    this.pointer = null;         // { x, y } in CSS pixels on the canvas, when the mouse is free
    this.canvas = canvas;
    canvas.addEventListener('click', () => { if (!this.freeMouse) this.grab(); });
    // Right-drag looks around while the mouse is free; no menu on right-click.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // Hiding the cursor is state that must be undone by more than one route.
    // pointerlockchange alone is not enough: if the window loses focus or the
    // tab is hidden, the lock can end without that event arriving, and the
    // cursor stays invisible across the whole browser. Belt and braces.
    const sync = () => {
      this.locked = document.pointerLockElement === canvas;
      document.body.classList.toggle('locked', this.locked);
    };
    const release = () => {
      this.locked = false;
      document.body.classList.remove('locked');
      this.keys.clear();
      if (document.pointerLockElement) document.exitPointerLock();
    };
    document.addEventListener('pointerlockchange', sync);
    document.addEventListener('pointerlockerror', release);
    document.addEventListener('visibilitychange', () => { if (document.hidden) release(); });
    window.addEventListener('blur', release);
    window.addEventListener('pagehide', release);

    document.addEventListener('mousemove', (e) => {
      if (this.freeMouse && !this.locked) {
        const r = canvas.getBoundingClientRect ? canvas.getBoundingClientRect() : { left: 0, top: 0 };
        this.pointer = { x: e.clientX - r.left, y: e.clientY - r.top };
        if (!(e.buttons & 2)) return;            // looking only while the right button is held
      } else if (!this.locked) return;
      this.cam.yaw += e.movementX * MOUSE_SENS;
      this.cam.pitch -= e.movementY * MOUSE_SENS;
      this.cam.pitch = Math.max(-HALF_PI, Math.min(HALF_PI, this.cam.pitch));
    });

    window.addEventListener('keydown', (e) => {
      // Auto-repeat fires every ~30 ms, well inside the double-tap window, so
      // holding space would otherwise toggle flight over and over.
      if (e.code === 'Space' && !e.repeat) {
        e.preventDefault();
        const now = performance.now();
        if (now - this.lastSpace < DOUBLE_TAP_MS) {
          this.cam.fly = this.cam.fly ? 0 : 1;
          this.lastSpace = -Infinity;
        } else {
          this.lastSpace = now;
        }
      }
      // G (in ui/keys.js) is an unambiguous alternative to the double tap.
      // Q and E exist so the hand never goes looking for Ctrl+Q.
      if (e.code === 'KeyQ' || e.code === 'KeyE') {
        if (!this.cam.fly) this.cam.fly = 1;
        e.preventDefault();
      }
      this.keys.add(e.code);
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));


    window.addEventListener('wheel', (e) => {
      this.bump(Math.exp(-e.deltaY * 0.0012));
    }, { passive: true });
  }

  // Tools mode on (free mouse) or off (captured again). Capturing needs a key
  // press or click to have just happened; Tab is one. If the browser refuses,
  // the next click captures as usual.
  setFreeMouse(on) {
    this.freeMouse = on;
    if (on) {
      if (document.pointerLockElement) document.exitPointerLock();
    } else {
      this.pointer = null;
      if (document.fullscreenElement && !document.pointerLockElement) {
        try { const p = this.canvas.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } catch (e) { /* next click */ }
      }
    }
  }

  // Scale the speed of whichever mode is active. Used by the wheel and the pad.
  bump(factor) {
    if (this.cam.fly) {
      this.flyMult = Math.max(FLY_MULT_MIN, Math.min(FLY_MULT_MAX, this.flyMult * factor));
    } else {
      this.walkMult = Math.max(WALK_MULT_MIN, Math.min(WALK_MULT_MAX, this.walkMult * factor));
    }
  }

  get walkCruise() { return WALK_SPEED * this.walkMult; }

  update(dt, ground, groundAt) {
    const c = this.cam;
    const k = this.keys;
    const agl = ground === null ? c.alt : c.alt - ground;
    this.cruise = FLY_K * Math.max(agl, FLY_FLOOR) * this.flyMult;
    const boost = (k.has('ControlLeft') || k.has('ControlRight') || this.btn.boost) ? FLY_BOOST : 1;
    const base = c.fly ? this.cruise * boost : WALK_SPEED * this.walkMult * (k.has('ShiftLeft') ? 2 : 1);

    // Horizontal movement is relative to yaw only, so looking up does not slow
    // you down. Standard first-person behaviour and it matters more than it sounds.
    let fx = 0, fz = 0;
    if (k.has('KeyW')) fz -= 1;
    if (k.has('KeyS')) fz += 1;
    if (k.has('KeyA')) fx -= 1;
    if (k.has('KeyD')) fx += 1;
    const len = Math.hypot(fx, fz);
    let dx = 0, dz = 0;
    if (len > 0) {
      fx /= len; fz /= len;
      const sy = Math.sin(c.yaw), cy = Math.cos(c.yaw);
      // forward = (sin yaw, -cos yaw), right = (cos yaw, sin yaw)
      dx = (fx * cy - fz * sy) * base * dt;
      dz = (fx * sy + fz * cy) * base * dt;
    }

    let dy = 0;
    if (c.fly) {
      if (k.has('Space') || k.has('KeyE') || this.btn.up) dy += base * dt;
      if (k.has('ShiftLeft') || k.has('ShiftRight') || k.has('KeyQ') || this.btn.down) dy -= base * dt;
    }

    // Convert true ground metres back into mercator metres for the position.
    const scale = mercScale(mercYToLat(c.mercY));
    c.mercX += dx / scale;
    c.mercY -= dz / scale;

    if (c.fly) {
      c.alt += dy;
      this.grounded = false;
      // Judge the floor at the NEW position too. The ground height passed in was
      // measured before this frame's move, and a fast, low flight can cover
      // several metres of hillside in one frame.
      let gnd = ground;
      if (groundAt) { const g2 = groundAt(c.mercX, c.mercY); if (g2 !== null && (gnd === null || g2 > gnd)) gnd = g2; }
      if (gnd !== null && c.alt < gnd + 1.5) { c.alt = gnd + 1.5; }
    } else if (ground !== null) {
      // Ground clamping with a time-constant smoothing so stepping between
      // height samples does not jolt the camera. No gravity: walk at a cliff
      // and you will ride up it.
      const target = ground + EYE_HEIGHT;
      const a = 1 - Math.exp(-GROUND_SMOOTH * dt);
      c.alt += (target - c.alt) * a;
      this.grounded = true;
    }

    this.speed = Math.hypot(dx, dz, dy) / Math.max(dt, 1e-4);
    this.vx = dx / Math.max(dt, 1e-4);
    this.vz = dz / Math.max(dt, 1e-4);
    this.hspeed = Math.hypot(this.vx, this.vz);
  }
}
