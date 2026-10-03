import * as G from './gl.js';
import { Loader } from './tiles.js';
import { VECTOR_TILEJSON } from './config.js';
import { Terrain } from './terrain.js';
import { Controls } from './controls.js';
import { Perf, probe } from './perf.js';
import { startCache, cacheUsage } from './cache.js';
import { initFavourites } from './favourites.js';
import { NearField } from './nearfield.js';
import {
  NF_MAX_AGL, NF_MAX_SPEED, LEAD_SECONDS, FLY_MULT_MAX, WALK_MULT_MAX,
  LEVELS, SKIRT, FOV, NEAR, EYE_HEIGHT, BUILD, readHash, writeHash,
} from './config.js';
import {
  lonToMercX, latToMercY, mercXToLon, mercYToLat, mercScale,
  tileSizeMerc, R_MEAN,
} from './geo.js';

const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', {
  antialias: true, depth: true, powerPreference: 'high-performance',
});
if (!gl) G.fail('This browser has no WebGL2. Try a current Firefox, Chrome or Edge.');

const prog = G.program(gl, G.VS, G.FS);
gl.useProgram(prog);
const U = {};
for (const n of ['uProj', 'uView', 'uTileOffset', 'uScale', 'uCamAlt',
                 'uCurv', 'uSkirt', 'uFogColor', 'uFogDensity', 'uSunDir',
                 'uTileSize', 'uMask', 'uCover', 'uLayers', 'uDebug', 'uLevel', 'uNearRect']) {
  U[n] = gl.getUniformLocation(prog, n);
}

// Back-face culling stays off. Skirt winding is then irrelevant, and the
// derivative-based normals in the fragment shader do not care either.
gl.uniform1i(U.uMask, 0);
gl.uniform1i(U.uCover, 1);
gl.disable(gl.CULL_FACE);
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);

const cfg = readHash();
const cam = {
  mercX: lonToMercX(cfg.lon),
  mercY: latToMercY(cfg.lat),
  alt: cfg.alt === null ? 3000 : cfg.alt,
  yaw: cfg.yaw * Math.PI / 180,
  pitch: cfg.pitch * Math.PI / 180,
  fly: cfg.fly,
  lat: cfg.lat, lon: cfg.lon,
};
let activeLevels = cfg.levels;
let altSettled = cfg.alt !== null;
let pendingAgl = cfg.agl === null || cfg.agl === undefined ? null : cfg.agl;   // height above ground to settle at

function fatal(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.style.display = 'block';
}
window.addEventListener('unhandledrejection', (e) => {
  fatal('Unhandled error: ' + (e.reason && e.reason.message || e.reason));
});

const loader = new Loader(() => {}, fatal);
const terrain = new Terrain(gl, loader);
const controls = new Controls(canvas, cam);
const nearField = new NearField(gl, () => loader.vectorTemplate);

// Resolve the vector tile template from the service's TileJSON. Terrain still
// loads if this fails; water is an enhancement, never a dependency.
let vectorReady = false;
fetch(VECTOR_TILEJSON, { mode: 'cors' })
  .then((r) => r.json())
  .then((j) => {
    if (j && j.tiles && j.tiles[0]) loader.vectorTemplate = j.tiles[0];
  })
  .catch(() => { /* no water this session */ })
  .finally(() => { vectorReady = true; });
controls.onReset = () => {
  const s = readHash();
  cam.mercX = lonToMercX(s.lon); cam.mercY = latToMercY(s.lat);
  cam.yaw = s.yaw * Math.PI / 180; cam.pitch = s.pitch * Math.PI / 180;
  altSettled = false; pendingAgl = null;
  controls.flyMult = 1;      // R resets speed too, not just position
  controls.walkMult = 1;
};


// ---- jumping: saved places and editing the address bar ---------------------
function jumpTo(s) {
  cam.mercX = lonToMercX(s.lon); cam.mercY = latToMercY(s.lat);
  cam.yaw = (s.yaw || 0) * Math.PI / 180; cam.pitch = (s.pitch || 0) * Math.PI / 180;
  cam.fly = s.fly ? 1 : 0;
  if (s.agl !== null && s.agl !== undefined) { pendingAgl = s.agl; altSettled = false; }
  else if (s.alt !== null && s.alt !== undefined) { cam.alt = s.alt; altSettled = true; pendingAgl = null; }
  else { pendingAgl = null; altSettled = false; }
}
// Typing a new address (or pasting a link into the same tab) now moves you
// there. The app's own once-a-second address updates do not fire this event.
addEventListener('hashchange', () => jumpTo(readHash()));
initFavourites({
  root: document.getElementById('favs'),
  jump: jumpTo,
  getView: () => {
    const g = terrain.heightAt(cam.mercX, cam.mercY);
    return {
      lat: cam.lat, lon: cam.lon, alt: cam.alt, agl: g === null ? null : cam.alt - g,
      yaw: ((cam.yaw * 180 / Math.PI) % 360 + 360) % 360, pitch: cam.pitch * 180 / Math.PI,
      fly: cam.fly,
    };
  },
});
startCache();
let cacheMb = null;
const pollCache = () => cacheUsage().then((u) => { if (u) cacheMb = u; });
pollCache(); setInterval(pollCache, 15000);

// ---- directional gyro ----------------------------------------------------
// Card is built once. Aviation convention: labels are degrees/10, cardinals
// spelled out, card rotates so the current heading sits under the lubber line.
const card = document.getElementById('card');
{
  let out = '';
  for (let d = 0; d < 360; d += 5) {
    const maj = d % 30 === 0;
    const r0 = maj ? 42 : 48, r1 = 57;
    const a = d * Math.PI / 180;
    const sn = Math.sin(a), cs = Math.cos(a);
    out += `<line class="${maj ? 'tickmaj' : 'tick'}" x1="${(sn * r0).toFixed(2)}" ` +
           `y1="${(-cs * r0).toFixed(2)}" x2="${(sn * r1).toFixed(2)}" y2="${(-cs * r1).toFixed(2)}"/>`;
  }
  const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let d = 0; d < 360; d += 30) {
    const a = d * Math.PI / 180, r = 30;
    const x = Math.sin(a) * r, y = -Math.cos(a) * r;
    const txt = cardinal[d] || String(d / 10);
    // Each label is rotated by its own bearing, so once the card turns by -hdg
    // the label under the lubber line lands at zero rotation and reads upright.
    // dy is applied in the label's own rotated frame, which centres it after
    // the rotation rather than before.
    out += `<text class="${cardinal[d] ? 'card' : 'lab'}" x="${x.toFixed(2)}" ` +
           `y="${y.toFixed(2)}" dy="0.35em" ` +
           `transform="rotate(${d} ${x.toFixed(2)} ${y.toFixed(2)})">${txt}</text>`;
  }
  card.innerHTML = out;
}
const hdgEl = document.getElementById('hdg');

// ---- on-screen pad -------------------------------------------------------
const pad = document.getElementById('pad');
const btnEls = {};
pad.querySelectorAll('button').forEach((b) => {
  const hold = b.dataset.hold, act = b.dataset.act;
  if (hold) {
    btnEls[hold] = b;
    const on = (v) => (e) => { e.preventDefault(); controls.btn[hold] = v; };
    b.addEventListener('pointerdown', on(true));
    b.addEventListener('pointerup', on(false));
    b.addEventListener('pointerleave', on(false));
  } else {
    btnEls[act] = b;
    b.addEventListener('click', () => {
      if (act === 'fly') cam.fly = cam.fly ? 0 : 1;
      else if (act === 'fog') fogOn = !fogOn;

      else if (act === 'grab') controls.grab();
      else if (act === 'faster') controls.bump(1.5);
      else if (act === 'slower') controls.bump(1 / 1.5);
    });
  }
});

const slider = document.getElementById('levels');
slider.value = String(activeLevels);
slider.max = String(LEVELS.length);
slider.addEventListener('input', () => { activeLevels = +slider.value; });

const proj = new Float32Array(16);
const view = new Float32Array(16);
const FOG = [0.62, 0.70, 0.80];

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) {
    canvas.width = w; canvas.height = h;
  }
}

let last = performance.now();
const startTime = last;
let viewDist = 20000;
let drawLevels = 2;
let minLevel = 0;
let holePeak = 0, holeTimer = 0;
let fogOn = false;
let debugMode = 0;   // 0 normal, 1 tile grid + level tint, 2 flat (no textures)
let frozen = false;
let nearOn = false;
let nfR = 1;                 // near-field radius in tiles (1 = 3x3, 2 = 5x5)
let lvx = 0, lvz = 0;
let useLead = false, leadX = 0, leadY = 0;        // smoothed horizontal velocity for look-ahead loading
// Order matches uLayers.xyzw in the shader.
const LAYERS = [
  { id: 'water', key: 'KeyV', label: 'WATER', on: true },
  { id: 'roads', key: 'KeyX', label: 'ROADS', on: true },
  { id: 'built', key: 'KeyB', label: 'BUILT', on: true },
  { id: 'cover', key: 'KeyC', label: 'COVER', on: true },
];

// ---- layer panel ---------------------------------------------------------
// Toggling costs one uniform. Nothing is refetched and nothing is
// re-rasterised, which is the whole reason the channels are kept separate.
const layerPanel = document.getElementById('layers');
for (const L of LAYERS) {
  const b = document.createElement('button');
  b.textContent = L.label;
  b.title = L.label.toLowerCase() + '  (' + L.key.replace('Key', '') + ')';
  b.addEventListener('click', () => { L.on = !L.on; });
  L.el = b;
  layerPanel.appendChild(b);
}
addEventListener('keydown', (e) => { if (e.code === 'KeyF') fogOn = !fogOn;
  if (e.code === 'Digit1') debugMode = debugMode === 1 ? 0 : 1;
  if (e.code === 'Digit2') frozen = !frozen;      // stop all tile updates
  if (e.code === 'Digit3') debugMode = debugMode === 2 ? 0 : 2;
  for (const L of LAYERS) if (e.code === L.key) L.on = !L.on; });
let frames = 0, fpsTime = 0, fps = 0, hashTime = 0;
const hud = document.getElementById('hud');
const loading = document.getElementById('loading');

const perf = new Perf(document.getElementById('perf'));
let prevNfR = nfR, prevMin = minLevel, prevDraw = drawLevels;
function frame(now) {
  const t0 = performance.now();
  const rawMs = now - last;
  const dt = Math.min(rawMs / 1000, 0.1);
  last = now;
  resize();

  const ground = terrain.heightAt(cam.mercX, cam.mercY);
  if (!altSettled && ground !== null) {
    cam.alt = ground + (pendingAgl === null ? EYE_HEIGHT : pendingAgl);
    pendingAgl = null; altSettled = true;
  }
  controls.update(dt, ground);

  cam.lat = mercYToLat(cam.mercY);
  cam.lon = mercXToLon(cam.mercX);
  const k = mercScale(cam.lat);

  // View distance follows height above ground, using the real horizon formula
  // sqrt(2*R*h): 5 km at head height, 110 km at 1 km up, 350 km at 10 km up.
  // Smoothed so climbing opens the view rather than snapping it.
  const hAgl = Math.max(ground === null ? cam.alt : cam.alt - ground, 1);
  const maxView = tileSizeMerc(LEVELS[activeLevels - 1].z) * k * 2;
  const target = Math.min(Math.max(Math.sqrt(2 * R_MEAN * hAgl) * 1.2, 4000), maxView);
  viewDist += (target - viewDist) * (1 - Math.exp(-2 * dt));

  // Only draw levels that fog does not entirely swallow. A level is admitted
  // once its near edge falls inside 1.6x the fog distance, where fog is already
  // opaque, so new terrain fades in instead of popping in.
  // Hysteresis. drawLevels is a step function of a continuously varying
  // viewDist, and the ground height under you changes as you fly, so without a
  // dead band an entire outer ring can appear and vanish frame to frame near a
  // threshold. Grow at the threshold, shrink only 35% past it.
  while (drawLevels < activeLevels &&
         tileSizeMerc(LEVELS[drawLevels - 1].z) * k * 2 < viewDist * 1.6) drawLevels++;
  while (drawLevels > 2 &&
         tileSizeMerc(LEVELS[drawLevels - 2].z) * k * 2 > viewDist * 1.6 * 1.35) drawLevels--;
  drawLevels = Math.min(drawLevels, activeLevels);
  // Curvature drops terrain below the horizon at sqrt(2*R*h); with fog off that
  // edge is the only thing limiting the view, so never load short of it.
  if (!fogOn) {
    const hz = Math.sqrt(2 * R_MEAN * hAgl);
    while (drawLevels < activeLevels &&
           tileSizeMerc(LEVELS[drawLevels - 1].z) * k * 2 < hz) drawLevels++;
  }

  // Wait for the TileJSON before the first fetch, otherwise the opening tiles
  // arrive without water and would need refetching.
  // Freeze pins the tile set: no requests, no substitution, no changes to what
  // is drawn. If an artefact survives a freeze it is not loading-related.
  // Only ask for detail we can actually keep. A tile that is replaced before it
  // finishes loading never converges: it thrashes between coarse stand-in and
  // fine detail forever, which is what the flashing squares were. At 4 km/s a
  // 7 km tile is needed for under two seconds — less than one fetch.
  const speed = Math.max(controls.speed, 1);
  const LOAD_S = 2.5;
  let want = 0;
  while (want < drawLevels - 1 &&
         tileSizeMerc(LEVELS[want].z) * k / speed < LOAD_S) want++;
  // Hysteresis, or minLevel itself would flicker at the boundary.
  if (want > minLevel) minLevel = want;
  else if (want < minLevel &&
           tileSizeMerc(LEVELS[minLevel - 1].z) * k / speed > LOAD_S * 1.8) minLevel--;
  minLevel = Math.max(0, Math.min(minLevel, drawLevels - 1));

  if (!frozen && (vectorReady || now - startTime > 4000)) {
    // Look-ahead: also load around where we will be in LEAD_SECONDS. Flight sims
    // do exactly this; loading only around the present position means you are
    // always flying into tiles that have not arrived.
    const va = 1 - Math.exp(-3 * dt);
    lvx += (controls.vx - lvx) * va;
    lvz += (controls.vz - lvz) * va;
    const vmag = Math.hypot(lvx, lvz);
    const leadDist = Math.min(vmag * LEAD_SECONDS, 60000);
    useLead = leadDist > 200;
    leadX = useLead ? cam.mercX + (lvx / vmag) * leadDist / k : cam.mercX;
    leadY = useLead ? cam.mercY - (lvz / vmag) * leadDist / k : cam.mercY;
    terrain.update(cam.mercX, cam.mercY, minLevel, drawLevels, leadX, leadY, useLead);
  }

  // Near field. Three separate questions, same lesson as the terrain:
  //   DRAW  - whenever we are low enough to see it and it is cached. Height only;
  //           speed is no reason to throw away geometry we already hold.
  //   FETCH - only at a horizontal speed where a tile can finish loading.
  //   RADIUS- grows with height, because you can see further from up there.
  if (nearOn) { if (hAgl > NF_MAX_AGL * 1.15) nearOn = false; }
  else if (hAgl < NF_MAX_AGL) nearOn = true;
  if (nfR === 1 && hAgl > 900) nfR = 2;
  else if (nfR === 2 && hAgl < 600) nfR = 1;
  if (!frozen && (vectorReady || now - startTime > 4000)) {
    nearField.update(cam.mercX, cam.mercY, nearOn, controls.hspeed < NF_MAX_SPEED, nfR, leadX, leadY, useLead);
  }

  const outer = tileSizeMerc(LEVELS[drawLevels - 1].z) * k * 2;
  // Also a true 3D distance. Flying high, the far corner of the outermost ring
  // is dominated by altitude, not by the ring's horizontal reach.
  const far = Math.hypot(outer * Math.SQRT2, hAgl) * 1.15;

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);

  G.viewRot(view, cam.yaw, cam.pitch);
  gl.uniformMatrix4fv(U.uView, false, view);
  gl.uniform1f(U.uScale, k);
  gl.uniform1f(U.uCamAlt, cam.alt);
  gl.uniform1f(U.uCurv, 1 / (2 * R_MEAN));
  gl.uniform1f(U.uSkirt, SKIRT);
  gl.uniform3f(U.uFogColor, FOG[0], FOG[1], FOG[2]);
  // Density 0 disables fog exactly: 1 - exp(0) = 0, no branch needed.
  gl.uniform1f(U.uFogDensity, fogOn ? 2.4 / viewDist : 0);
  gl.uniform3f(U.uSunDir, 0.40, 0.82, 0.41);
  gl.uniform1f(U.uDebug, debugMode);
  gl.uniform4f(U.uLayers, ...LAYERS.map((L) => (L.on ? 1 : 0)));
  // Painted roads fade out inside the area the real geometry covers.
  const nr = nearField.rectUniform(cam.mercX, cam.mercY, k, LAYERS[1].on);
  gl.uniform4f(U.uNearRect, nr[0], nr[1], nr[2], nr[3]);


  // Depth split, chosen for PRECISION rather than for level boundaries.
  //
  // A 24-bit depth buffer resolves roughly z^2 / near / 2^24 at distance z, so
  // the usable range from a given near plane is bounded no matter how the
  // geometry is arranged. Tying the split to LOD levels meant that while
  // walking, the near pass needed a 0.5 m near plane AND had to reach 55 km,
  // which leaves 365 m of depth resolution out there — coarser than the 150 m
  // skirts, so adjacent tiles' coplanar skirt walls flicker against each other.
  //
  // Instead: split where resolution decays to TARGET, and let BOTH passes draw
  // every level. A triangle spanning the split is drawn in both, and since the
  // depth buffer is cleared between them the near pass simply wins inside its
  // range. No seam, and no coupling to the LOD scheme at all.
  const near = Math.max(NEAR, Math.min(hAgl * 0.01, 2000));
  const TARGET = 20;                              // metres of depth resolution
  const splitFar = Math.sqrt(near * 16777216 * TARGET);
  const splitNear = splitFar * 0.75;              // overlap, so nothing falls between

  const aspect = canvas.width / canvas.height;
  const fov = FOV * Math.PI / 180;
  const ALL = LEVELS.length - 1;

  gl.uniformMatrix4fv(U.uProj, false,
    G.perspective(proj, fov, aspect, Math.min(splitNear, far * 0.5), far));
  const farDrawn = terrain.draw(U, cam.mercX, cam.mercY, k, 0, ALL);
  nearField.draw(prog, proj, view, k, cam.alt, cam.mercX, cam.mercY, 1 / (2 * R_MEAN), LAYERS[1].on);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(U.uProj, false,
    G.perspective(proj, fov, aspect, near, Math.max(splitFar, near * 1000)));
  const nearDrawn = terrain.draw(U, cam.mercX, cam.mercY, k, 0, ALL);
  nearField.draw(prog, proj, view, k, cam.alt, cam.mercX, cam.mercY, 1 / (2 * R_MEAN), LAYERS[1].on);

  // A hole is a tile the draw set says should cover ground but which has not
  // loaded. If this spikes when something flashes, the flashing IS holes.
  holePeak = Math.max(holePeak, terrain.holes);
  holeTimer += dt;
  if (holeTimer > 3) { holePeak = terrain.holes; holeTimer = 0; }

  frames++; fpsTime += dt;
  if (fpsTime > 0.4) { fps = frames / fpsTime; frames = 0; fpsTime = 0; }

  const agl = ground === null ? null : cam.alt - ground;
  hud.textContent =
    `${cam.lat.toFixed(5)}, ${cam.lon.toFixed(5)}  |  ` +
    `${cam.alt.toFixed(0)} m` + (agl === null ? '' : ` (${agl.toFixed(0)} agl)`) +
    `  |  ${controls.speed < 1 ? '0' : controls.speed.toFixed(0)} m/s  |  ` +
    `${cam.fly
      ? 'FLY ' + (controls.cruise * 3.6 < 10000
          ? (controls.cruise * 3.6).toFixed(0) + ' km/h'
          : (controls.cruise / 1000).toFixed(1) + ' km/s') +
        (Math.abs(controls.flyMult - 1) > 0.02 ? ' x' + controls.flyMult.toFixed(1) : '') +
        (controls.flyMult >= FLY_MULT_MAX - 0.01 ? ' MAX' : '')
      : 'WALK ' + (controls.walkCruise * 3.6).toFixed(0) + ' km/h' +
        (Math.abs(controls.walkMult - 1) > 0.02 ? ' x' + controls.walkMult.toFixed(1) : '') +
        (controls.walkMult >= WALK_MULT_MAX - 0.01 ? ' MAX' : '')}${fogOn ? ' +fog' : ''}${debugMode ? ' +dbg' + debugMode : ''}${frozen ? ' FROZEN' : ''}  |  ` +
    `${terrain.visible.length}/${terrain.loaded} tiles  |  L${minLevel}-${drawLevels - 1}  |  holes ${terrain.holes}/${holePeak}  |  evict ${terrain.evicted}  |  water ${terrain.waterCount}/${terrain.visible.length}  |  near ${nearField.status}  |  view ${(viewDist / 1000).toFixed(0)} km  |  ${fps.toFixed(0)} fps  |  ${cacheMb ? 'cache ' + cacheMb.mb.toFixed(0) + ' MB' + (cacheMb.persistent ? '' : '*') + '  |  ' : ''}v${BUILD} (${LEVELS.length}L)` +
    (loader.queued ? `  |  loading ${loader.queued}` : '') +
    (loader.stats.failed ? `  |  ${loader.stats.failed} failed` : '');

  if (terrain.loaded === 0) {
    loading.style.display = 'block';
    // Say something useful rather than spinning forever.
    if (loader.stats.failed >= 3) {
      fatal('Could not load any terrain tiles.\n\n' +
        'Last error: ' + (loader.lastError || 'unknown') + '\n\n' +
        'Open /diag.html in this browser. It tests each layer separately and ' +
        'will name the cause.\n\n' +
        'The usual ones:\n' +
        '  - served with the wrong MIME type (run python serve.py, not ' +
        'python -m http.server)\n' +
        '  - an ad blocker or corporate proxy blocking s3.amazonaws.com\n' +
        '  - no network route to the tile server');
    } else if (now - startTime > 12000) {
      loading.textContent = 'still loading… ' + loader.stats.done + ' tiles in, ' +
        loader.queued + ' pending. If this does not clear, open /diag.html';
    }
  } else {
    loading.style.display = 'none';
  }

  // Heading. On the flat plane yaw IS the compass heading, since -z is north.
  // On a sphere this becomes yaw within the local ENU frame; the widget is
  // unchanged, only this line moves.
  const hdg = ((cam.yaw * 180 / Math.PI) % 360 + 360) % 360;
  card.setAttribute('transform', `rotate(${(-hdg).toFixed(2)})`);
  hdgEl.textContent = String(Math.round(hdg) === 0 ? 360 : Math.round(hdg)).padStart(3, '0');
  btnEls.fly.classList.toggle('on', !!cam.fly);
  btnEls.fog.classList.toggle('on', fogOn);
  for (const L of LAYERS) L.el.classList.toggle('on', L.on);

  btnEls.up.classList.toggle('on', controls.btn.up || controls.keys.has('KeyE') || controls.keys.has('Space'));
  btnEls.down.classList.toggle('on', controls.btn.down || controls.keys.has('KeyQ') || controls.keys.has('ShiftLeft'));
  btnEls.boost.classList.toggle('on', controls.btn.boost || controls.keys.has('ControlLeft'));
  btnEls.grab.classList.toggle('on', controls.kbLocked);
  btnEls.grab.textContent = controls.kbLocked ? 'KEYS LOCKED' : 'CAPTURE';

  hashTime += dt;
  if (hashTime > 1) { hashTime = 0; writeHash(cam); }

  let switched = '';
  if (nfR !== prevNfR) switched = 'near block ' + (nfR === 2 ? '5x5' : '3x3');
  else if (minLevel !== prevMin || drawLevels !== prevDraw) switched = 'detail levels L' + minLevel + '-' + (drawLevels - 1);
  prevNfR = nfR; prevMin = minLevel; prevDraw = drawLevels;
  perf.frame(now, rawMs, performance.now() - t0, {
    holes: terrain.holes, queued: loader.queued, alt: cam.alt, agl,
    speed: controls.speed, near: nearField.status,
    upMs: probe.uploadMs, nearTiles: probe.nearTiles, terrTiles: probe.terrainTiles, switched,
  });
  probe.uploadMs = 0; probe.nearTiles = 0; probe.terrainTiles = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
