// Start-up and the frame loop. This file wires the parts together and owns no
// logic of its own:
//   detail.js    how much to load and draw (the per-frame "view")
//   settings.js  what is switched on
//   ui/          keys, buttons, status bar, compass
//   terrain.js, near.js, skyline.js, landmarks.js   the layers
//   handover.js  which of near field and skyline draws which ground

import * as G from './gl.js';
import { Loader } from './tiles.js';
import { Terrain } from './terrain.js';
import { Controls } from './controls.js';
import { Perf, probe } from './perf.js';
import { startCache, cacheUsage } from './cache.js';
import { initFavourites } from './favourites.js';
import { NearLayer } from './near.js';
import { SkylineLayer } from './skyline.js';
import { Handover } from './handover.js';
import { MeshProgram } from './meshprogram.js';
import { Landmarks } from './landmarks.js';
import { Detail } from './detail.js';
import { LOOK, SETS } from './look.js';
import { settings, LAYERS, layerOn, toggleLayer } from './settings.js';
import { helpHtml, bindKeys } from './ui/keys.js';
import { initPanels } from './ui/panels.js';
import { initCompass } from './ui/compass.js';
import { Hud, fatal } from './ui/hud.js';
import { heightReport } from './ui/report.js';
import { VECTOR_TILEJSON, FOV, NEAR, EYE_HEIGHT, readHash, writeHash } from './config.js';
import { lonToMercX, latToMercY, mercXToLon, mercYToLat } from './geo.js';

// ---- graphics ---------------------------------------------------------------
const canvas = document.getElementById('c');
const gl = canvas.getContext('webgl2', {
  antialias: true, depth: true, powerPreference: 'high-performance',
});
if (!gl) G.fail('This browser has no WebGL2. Try a current Firefox, Chrome or Edge.');

// Back-face culling stays off. Skirt winding is then irrelevant, and the
// derivative-based normals in the fragment shaders do not care either.
gl.disable(gl.CULL_FACE);
gl.enable(gl.DEPTH_TEST);
gl.depthFunc(gl.LEQUAL);

// ---- camera -------------------------------------------------------------------
const start = readHash();
settings.levels = start.levels;
const cam = {
  mercX: lonToMercX(start.lon),
  mercY: latToMercY(start.lat),
  alt: start.alt === null ? 3000 : start.alt,
  yaw: start.yaw * Math.PI / 180,
  pitch: start.pitch * Math.PI / 180,
  fly: start.fly,
  lat: start.lat, lon: start.lon,
};
// Until ground height is known, the camera waits to be placed on it.
let altSettled = start.alt !== null;
let pendingAgl = start.agl === null || start.agl === undefined ? null : start.agl;

function jumpTo(s) {
  cam.mercX = lonToMercX(s.lon); cam.mercY = latToMercY(s.lat);
  cam.yaw = (s.yaw || 0) * Math.PI / 180; cam.pitch = (s.pitch || 0) * Math.PI / 180;
  cam.fly = s.fly ? 1 : 0;
  if (s.agl !== null && s.agl !== undefined) { pendingAgl = s.agl; altSettled = false; }
  else if (s.alt !== null && s.alt !== undefined) { cam.alt = s.alt; altSettled = true; pendingAgl = null; }
  else { pendingAgl = null; altSettled = false; }
}

window.addEventListener('unhandledrejection', (e) => {
  fatal('Unhandled error: ' + (e.reason && e.reason.message || e.reason));
});

// ---- layers -------------------------------------------------------------------
const loader = new Loader(() => {}, fatal);
const terrain = new Terrain(gl, loader);
const controls = new Controls(canvas, cam);
const mesh = new MeshProgram(gl);
const vectorTemplate = () => loader.vectorTemplate;
const nearField = new NearLayer(gl, mesh, vectorTemplate);
const farField = new SkylineLayer(gl, mesh, vectorTemplate);
const handover = new Handover(nearField, farField);
const landmarks = new Landmarks(gl, mesh);
const detail = new Detail();

// Resolve the vector tile template from the service's TileJSON. Terrain still
// loads if this fails; water is an enhancement, never a dependency.
let vectorReady = false;
fetch(VECTOR_TILEJSON, { mode: 'cors' })
  .then((r) => r.json())
  .then((j) => { if (j && j.tiles && j.tiles[0]) loader.vectorTemplate = j.tiles[0]; })
  .catch(() => { /* no water this session */ })
  .finally(() => { vectorReady = true; });

startCache();
let cacheMb = null;
const pollCache = () => cacheUsage().then((u) => { if (u) cacheMb = u; });
pollCache(); setInterval(pollCache, 15000);

// ---- page -------------------------------------------------------------------
const perfEl = document.getElementById('perf');
const perf = new Perf(perfEl);
const favourites = initFavourites({
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

// Every key and button runs one of these. ui/keys.js says which key runs which.
const actions = {
  toggleFly: () => { cam.fly = cam.fly ? 0 : 1; },
  toggleFog: () => { settings.fog = !settings.fog; },
  layer: (id) => toggleLayer(id),
  lookSet: () => { LOOK.set = (LOOK.set + 1) % SETS.length; },
  lookReal: () => { LOOK.real = !LOOK.real; },
  lookType: () => { LOOK.type = !LOOK.type; },
  lookWarm: () => { LOOK.warm = !LOOK.warm; },
  debugGrid: () => { settings.debug = settings.debug === 1 ? 0 : 1; },
  debugFlat: () => { settings.debug = settings.debug === 2 ? 0 : 2; },
  freeze: () => { settings.frozen = !settings.frozen; },
  grab: () => controls.grab(),
  faster: () => controls.bump(1.5),
  slower: () => controls.bump(1 / 1.5),
  pin: () => favourites.pinHere(),
  strainLog: () => perf.copyLog(),
  heightReport: () => heightReport(cam, nearField, farField, landmarks),
  toggleHelp: () => {
    document.getElementById('help').classList.toggle('hide');
    perfEl.classList.toggle('hide');
  },
  // R: back to the start point, and normal speed.
  reset: () => {
    const s = readHash();
    cam.mercX = lonToMercX(s.lon); cam.mercY = latToMercY(s.lat);
    cam.yaw = s.yaw * Math.PI / 180; cam.pitch = s.pitch * Math.PI / 180;
    altSettled = false; pendingAgl = null;
    controls.flyMult = 1;
    controls.walkMult = 1;
  },
};
bindKeys(actions);
document.getElementById('help').innerHTML = helpHtml();
const syncPanels = initPanels(actions, controls, cam);
const setHeading = initCompass();
const hud = new Hud();
// Typing a new address (or pasting a link into the same tab) moves you there.
// The app's own once-a-second address updates do not fire this event.
addEventListener('hashchange', () => jumpTo(readHash()));

// ---- frame --------------------------------------------------------------------
const proj = new Float32Array(16);
const view = new Float32Array(16);
const FOG = [0.62, 0.70, 0.80];

function resize() {
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const w = Math.round(innerWidth * dpr), h = Math.round(innerHeight * dpr);
  if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
}

let last = performance.now();
const startTime = last;
let hashTime = 0;
let prev = { nearR: detail.nearR, minLevel: detail.minLevel, drawLevels: detail.drawLevels };

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
  controls.update(dt, ground, (x, y) => terrain.heightAt(x, y));
  cam.lat = mercYToLat(cam.mercY);
  cam.lon = mercXToLon(cam.mercX);

  const v = detail.update(dt, cam, ground, controls, settings);

  // Freeze pins the tile set: no requests, no substitution, no changes to what
  // is drawn. Wait for the TileJSON before the first fetch, otherwise the
  // opening tiles arrive without water and would need refetching.
  if (!settings.frozen && (vectorReady || now - startTime > 4000)) {
    terrain.update(v);
    handover.update(v);
  }
  landmarks.update(v, (x, y) => terrain.heightAt(x, y));

  const roadsOn = layerOn('roads'), bldOn = layerOn('built'), landOn = layerOn('land');
  const shading = {
    fogColor: FOG,
    fogDensity: settings.fog ? 2.4 / v.viewDist : 0,
    debug: settings.debug,
    layers: LAYERS.slice(0, 4).map((L) => (L.on ? 1 : 0)),
    nearRect: nearField.rectUniform(v.mercX, v.mercY, v.k, roadsOn),
  };
  // Everything is drawn twice per frame, once per depth range (see below).
  const drawScene = (pass) => {
    terrain.draw(pass, shading);
    mesh.use(pass);
    handover.draw(pass, roadsOn, bldOn);
    if (landOn) landmarks.draw(pass);   // last: it changes uScale and uCamAlt
  };

  gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(FOG[0], FOG[1], FOG[2], 1);
  gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
  G.viewRot(view, cam.yaw, cam.pitch);

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
  // everything. A triangle spanning the split is drawn in both, and since the
  // depth buffer is cleared between them the near pass simply wins inside its
  // range. No seam, and no coupling to the LOD scheme at all.
  const near = Math.max(NEAR, Math.min(v.agl * 0.01, 2000));
  const TARGET = 20;                              // metres of depth resolution
  const splitFar = Math.sqrt(near * 16777216 * TARGET);
  const splitNear = splitFar * 0.75;              // overlap, so nothing falls between
  // A true 3D distance. Flying high, the far corner of the outermost ring is
  // dominated by altitude, not by the ring's horizontal reach.
  const far = Math.hypot(v.outer * Math.SQRT2, v.agl) * 1.15;
  const aspect = canvas.width / canvas.height;
  const fov = FOV * Math.PI / 180;
  // The camera for one pass. Positions are camera-relative, so this is all a
  // shader needs to place a vertex.
  const pass = { proj, view, k: v.k, alt: cam.alt, mercX: cam.mercX, mercY: cam.mercY, curv: v.curv };

  G.perspective(proj, fov, aspect, Math.min(splitNear, far * 0.5), far);
  drawScene(pass);
  gl.clear(gl.DEPTH_BUFFER_BIT);
  // The near pass reaches out to splitFar, which is where a 20 km skyline lives.
  G.perspective(proj, fov, aspect, near, Math.max(splitFar, near * 1000));
  drawScene(pass);

  // ---- page ----
  hud.update(dt, now, {
    view: v, controls, terrain, loader, near: nearField, sky: farField, landmarks, settings, cacheMb,
  });
  setHeading(((cam.yaw * 180 / Math.PI) % 360 + 360) % 360);
  syncPanels();

  hashTime += dt;
  if (hashTime > 1) { hashTime = 0; writeHash(cam); }

  let switched = '';
  if (v.nearR !== prev.nearR) switched = 'near block ' + (2 * v.nearR + 1) + 'x' + (2 * v.nearR + 1);
  else if (v.minLevel !== prev.minLevel || v.drawLevels !== prev.drawLevels) {
    switched = 'detail levels L' + v.minLevel + '-' + (v.drawLevels - 1);
  }
  prev = { nearR: v.nearR, minLevel: v.minLevel, drawLevels: v.drawLevels };
  perf.frame(now, rawMs, performance.now() - t0, {
    holes: terrain.holes, queued: loader.queued, alt: cam.alt,
    agl: ground === null ? null : cam.alt - ground,
    speed: controls.speed, near: nearField.status,
    upMs: probe.uploadMs, nearTiles: probe.nearTiles, terrTiles: probe.terrainTiles, switched,
  });
  probe.uploadMs = 0; probe.nearTiles = 0; probe.terrainTiles = 0;
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
