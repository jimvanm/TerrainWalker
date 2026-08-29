import * as G from './gl.js';
import { Loader } from './tiles.js';
import { Terrain } from './terrain.js';
import { Controls } from './controls.js';
import {
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
                 'uCurv', 'uSkirt', 'uFogColor', 'uFogDensity', 'uSunDir']) {
  U[n] = gl.getUniformLocation(prog, n);
}

// Back-face culling stays off. Skirt winding is then irrelevant, and the
// derivative-based normals in the fragment shader do not care either.
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
controls.onReset = () => {
  const s = readHash();
  cam.mercX = lonToMercX(s.lon); cam.mercY = latToMercY(s.lat);
  cam.yaw = s.yaw * Math.PI / 180; cam.pitch = s.pitch * Math.PI / 180;
  altSettled = false;
};

// ---- directional gyro ----------------------------------------------------
// Card is built once. Aviation convention: labels are degrees/10, cardinals
// spelled out, card rotates so the current heading sits under the lubber line.
const card = document.getElementById('card');
{
  const NS = 'http://www.w3.org/2000/svg';
  let out = '';
  for (let d = 0; d < 360; d += 5) {
    const maj = d % 30 === 0;
    const r0 = maj ? 34 : 39, r1 = 45;
    const a = d * Math.PI / 180;
    const sn = Math.sin(a), cs = Math.cos(a);
    out += `<line class="${maj ? 'tickmaj' : 'tick'}" x1="${(sn * r0).toFixed(2)}" ` +
           `y1="${(-cs * r0).toFixed(2)}" x2="${(sn * r1).toFixed(2)}" y2="${(-cs * r1).toFixed(2)}"/>`;
  }
  const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let d = 0; d < 360; d += 30) {
    const a = d * Math.PI / 180, r = 24;
    const x = Math.sin(a) * r, y = -Math.cos(a) * r + 4.5;
    const txt = cardinal[d] || String(d / 10);
    out += `<text class="${cardinal[d] ? 'card' : 'lab'}" x="${x.toFixed(2)}" y="${y.toFixed(2)}">${txt}</text>`;
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
      else if (act === 'faster') controls.flySpeed = Math.min(2e4, controls.flySpeed * 1.6);
      else if (act === 'slower') controls.flySpeed = Math.max(2, controls.flySpeed / 1.6);
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
let fogOn = false;
addEventListener('keydown', (e) => { if (e.code === 'KeyF') fogOn = !fogOn; });
let frames = 0, fpsTime = 0, fps = 0, hashTime = 0;
const hud = document.getElementById('hud');
const loading = document.getElementById('loading');

function frame(now) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now;
  resize();

  const ground = terrain.heightAt(cam.mercX, cam.mercY);
  if (!altSettled && ground !== null) { cam.alt = ground + EYE_HEIGHT; altSettled = true; }
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
  let drawLevels = 2;
  while (drawLevels < activeLevels &&
         tileSizeMerc(LEVELS[drawLevels - 1].z) * k * 2 < viewDist * 1.6) drawLevels++;
  // Curvature drops terrain below the horizon at sqrt(2*R*h); with fog off that
  // edge is the only thing limiting the view, so never load short of it.
  if (!fogOn) {
    const hz = Math.sqrt(2 * R_MEAN * hAgl);
    while (drawLevels < activeLevels &&
           tileSizeMerc(LEVELS[drawLevels - 1].z) * k * 2 < hz) drawLevels++;
  }

  terrain.update(cam.mercX, cam.mercY, drawLevels);

  const outer = tileSizeMerc(LEVELS[drawLevels - 1].z) * k * 2;
  const far = outer * 1.6;

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

  const aspect = canvas.width / canvas.height;
  const fov = FOV * Math.PI / 180;

  // Two depth passes: a single 0.5 m to 600 km range has nowhere near enough
  // depth precision and distant ridges z-fight into mush.
  //
  // The split has to follow the geometry, not a constant. Levels 0 and 1 fill a
  // square block whose half-extent is two tiles of level 1, so the near pass
  // must reach its DIAGONAL, and the far pass must start inside its EDGE or a
  // gap ring opens up where level 2 begins.
  const l1 = 2 * tileSizeMerc(LEVELS[Math.min(1, drawLevels - 1)].z) * k;
  const nearFar = l1 * 1.55;   // covers the block diagonal (sqrt2 = 1.414)
  const farNear = l1 * 0.85;   // starts before level 2 does

  gl.uniformMatrix4fv(U.uProj, false, G.perspective(proj, fov, aspect, farNear, far));
  const farDrawn = terrain.draw(U, cam.mercX, cam.mercY, k, 2, drawLevels - 1);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  gl.uniformMatrix4fv(U.uProj, false, G.perspective(proj, fov, aspect, NEAR, nearFar));
  const nearDrawn = terrain.draw(U, cam.mercX, cam.mercY, k, 0, 1);

  frames++; fpsTime += dt;
  if (fpsTime > 0.4) { fps = frames / fpsTime; frames = 0; fpsTime = 0; }

  const agl = ground === null ? null : cam.alt - ground;
  hud.textContent =
    `${cam.lat.toFixed(5)}, ${cam.lon.toFixed(5)}  |  ` +
    `${cam.alt.toFixed(0)} m` + (agl === null ? '' : ` (${agl.toFixed(0)} agl)`) +
    `  |  ${controls.speed < 1 ? '0' : controls.speed.toFixed(0)} m/s  |  ` +
    `${cam.fly ? 'FLY ' + controls.flySpeed.toFixed(0) : 'WALK'}${fogOn ? ' +fog' : ''}  |  ` +
    `${nearDrawn + farDrawn} tiles  |  view ${(viewDist / 1000).toFixed(0)} km  |  ${fps.toFixed(0)} fps  |  v${BUILD} (${LEVELS.length}L)` +
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
  btnEls.up.classList.toggle('on', controls.btn.up || controls.keys.has('KeyE') || controls.keys.has('Space'));
  btnEls.down.classList.toggle('on', controls.btn.down || controls.keys.has('KeyQ') || controls.keys.has('ShiftLeft'));
  btnEls.boost.classList.toggle('on', controls.btn.boost || controls.keys.has('ControlLeft'));
  btnEls.grab.classList.toggle('on', controls.kbLocked);
  btnEls.grab.textContent = controls.kbLocked ? 'KEYS LOCKED' : 'CAPTURE';

  hashTime += dt;
  if (hashTime > 1) { hashTime = 0; writeHash(cam); }

  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
