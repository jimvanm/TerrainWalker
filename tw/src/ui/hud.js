// The status bar along the bottom, the loading message, and the error panel.

import { BUILD, LEVELS, FLY_MULT_MAX, WALK_MULT_MAX } from '../config.js';

export function fatal(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.style.display = 'block';
}

const NO_TILES = 'Could not load any terrain tiles.\n\n' +
  'Last error: %ERR%\n\n' +
  'Open /diag.html in this browser. It tests each layer separately and ' +
  'will name the cause.\n\n' +
  'The usual ones:\n' +
  '  - served with the wrong MIME type (run python serve.py, not ' +
  'python -m http.server)\n' +
  '  - an ad blocker or corporate proxy blocking s3.amazonaws.com\n' +
  '  - no network route to the tile server';

export class Hud {
  constructor() {
    this.el = document.getElementById('hud');
    this.loading = document.getElementById('loading');
    this.perfEl = document.getElementById('perf');
    this.started = performance.now();
    this.frames = 0; this.fpsTime = 0; this.fps = 0;
    this.holePeak = 0; this.holeTimer = 0;
    this.lastPerfBottom = 0;
  }

  // s: everything the bar reports on. See main.js for what goes in.
  update(dt, now, s) {
    const { view, controls, terrain, loader, near, sky, landmarks, settings, cacheMb } = s;

    // A hole is a tile the draw set says should cover ground but which has not
    // loaded. If this spikes when something flashes, the flashing IS holes.
    this.holePeak = Math.max(this.holePeak, terrain.holes);
    this.holeTimer += dt;
    if (this.holeTimer > 3) { this.holePeak = terrain.holes; this.holeTimer = 0; }

    this.frames++; this.fpsTime += dt;
    if (this.fpsTime > 0.4) { this.fps = this.frames / this.fpsTime; this.frames = 0; this.fpsTime = 0; }

    const agl = view.ground === null ? null : view.alt - view.ground;
    const mult = (m, max) => (Math.abs(m - 1) > 0.02 ? ' x' + m.toFixed(1) : '') + (m >= max - 0.01 ? ' MAX' : '');
    const flyText = view.fly
      ? 'FLY ' + (controls.cruise * 3.6 < 10000
          ? (controls.cruise * 3.6).toFixed(0) + ' km/h'
          : (controls.cruise / 1000).toFixed(1) + ' km/s') + mult(controls.flyMult, FLY_MULT_MAX)
      : 'WALK ' + (controls.walkCruise * 3.6).toFixed(0) + ' km/h' + mult(controls.walkMult, WALK_MULT_MAX);
    const fps = this.fps;

    // [text, done]: a part turns green when what it counts has finished
    // loading, so you know when a screenshot will show everything.
    // Version first: the bar is often wider than the window.
    const parts = [
      [`v${BUILD} (${LEVELS.length}L)`],
      [`${view.lat.toFixed(5)}, ${view.lon.toFixed(5)}`],
      [`${view.alt.toFixed(0)} m` + (agl === null ? '' : ` (${agl.toFixed(0)} agl)`)],
      [`${controls.speed < 1 ? '0' : controls.speed.toFixed(0)} m/s`],
      [flyText + (settings.fog ? ' +fog' : '') + (settings.debug ? ' +dbg' + settings.debug : '') +
        (settings.frozen ? ' FROZEN' : '') + (settings.showMasked ? ' +unmasked' : '')],
      [`${terrain.visible.length}/${terrain.loaded} tiles`, loader.queued === 0 && terrain.holes === 0 && terrain.loaded > 0],
      [`L${view.minLevel}-${view.drawLevels - 1}`],
      [`holes ${terrain.holes}/${this.holePeak}`, terrain.holes === 0],
      [`evict ${terrain.evicted}`],
      [`water ${terrain.waterCount}/${terrain.visible.length}`, terrain.waterCount === terrain.visible.length],
      [`near ${near.status}`, near.complete],
      [`sky ${sky.status}`, sky.complete],
      // Landmarks within sight: how many are ready to draw.
      [`land ${landmarks.resolved}/${landmarks.inRange}`, landmarks.resolved === landmarks.inRange],
      [`view ${(view.viewDist / 1000).toFixed(0)} km`],
      [`${fps.toFixed(0)} fps`, fps >= 50],
    ];
    if (cacheMb) parts.push([`cache ${cacheMb.mb.toFixed(0)} MB` + (cacheMb.persistent ? '' : '*')]);
    if (loader.queued) parts.push([`loading ${loader.queued}`]);
    if (loader.stats.failed) parts.push([`${loader.stats.failed} failed`]);
    // Each item is kept whole; the bar wraps between items (index.html #hud).
    this.el.innerHTML = parts.map(([t, ok]) => `<span class="it${ok ? ' ok' : ''}">${t}</span>`)
      .join('<span class="sep">|</span> ');

    // The performance graph sits just above the bar, however many lines it takes.
    const perfBottom = 34 + this.el.offsetHeight + 6;
    if (perfBottom !== this.lastPerfBottom) { this.perfEl.style.bottom = perfBottom + 'px'; this.lastPerfBottom = perfBottom; }

    if (terrain.loaded === 0) {
      this.loading.style.display = 'block';
      // Say something useful rather than spinning forever.
      if (loader.stats.failed >= 3) fatal(NO_TILES.replace('%ERR%', loader.lastError || 'unknown'));
      else if (now - this.started > 12000) {
        this.loading.textContent = 'still loading… ' + loader.stats.done + ' tiles in, ' +
          loader.queued + ' pending. If this does not clear, open /diag.html';
      }
    } else {
      this.loading.style.display = 'none';
    }
  }
}
