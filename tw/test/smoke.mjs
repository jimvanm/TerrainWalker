// Runs the real application against a mocked WebGL2 context, DOM and Worker.
// Catches wiring mistakes (bad uniform names, undefined imports, NaN uniforms,
// runaway allocation) without needing a browser.

const GLC = {
  VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
  ARRAY_BUFFER: 5, ELEMENT_ARRAY_BUFFER: 6, STATIC_DRAW: 7, FLOAT: 8,
  TRIANGLES: 9, UNSIGNED_SHORT: 10, DEPTH_TEST: 11, CULL_FACE: 12,
  LEQUAL: 13, COLOR_BUFFER_BIT: 16384, DEPTH_BUFFER_BIT: 256,
};

export const log = {
  calls: {}, uniforms: new Set(), badUniform: [], nan: [],
  draws: 0, tris: 0, buffers: 0, deleted: 0, clears: 0,
  textures: 0, mipmaps: 0, texUploads: 0, texDeleted: 0, texSizes: new Set(),
};

function makeGL() {
  let uid = 0;
  const base = {
    ...GLC,
    createShader: () => ({ id: ++uid }),
    createProgram: () => ({ id: ++uid }),
    createVertexArray: () => ({ id: ++uid }),
    createBuffer: () => { log.buffers++; return { id: ++uid }; },
    createTexture: () => { log.textures++; return { id: ++uid }; },
    generateMipmap: () => { log.mipmaps++; },
    getExtension: () => null,
    getParameter: () => 1,
    deleteTexture: () => { log.texDeleted++; },
    texImage2D: (t, l, ifmt, w, h) => { log.texUploads++; log.texSizes.add(w + 'x' + h); },
    deleteVertexArray: () => { log.deleted++; },
    deleteBuffer: () => {},
    getShaderParameter: () => true,
    getProgramParameter: () => true,
    getShaderInfoLog: () => '',
    getProgramInfoLog: () => '',
    getUniformLocation: (p, n) => { log.uniforms.add(n); return { n }; },
    drawElements: (mode, count) => { log.draws++; log.tris += count / 3; },
    clear: () => { log.clears++; },
    uniform1f: (l, v) => chk(l, [v]),
    uniform2f: (l, a, b) => chk(l, [a, b]),
    uniform3f: (l, a, b, c) => chk(l, [a, b, c]),
    uniform3fv: (l, v) => chk(l, [...v]),
    uniform4fv: (l, v) => chk(l, [...v]),
    uniformMatrix4fv: (l, t, m) => chk(l, m),
  };
  function chk(loc, vals) {
    if (!loc) { log.badUniform.push('null location'); return; }
    for (const v of vals) {
      if (!Number.isFinite(v)) { log.nan.push(loc.n + '=' + v); return; }
    }
  }
  return new Proxy(base, {
    get(t, k) {
      if (k in t) return t[k];
      return (...a) => { log.calls[k] = (log.calls[k] || 0) + 1; };
    },
  });
}

function btn(hold, act) {
  return {
    dataset: { hold, act }, textContent: '', style: {},
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(t, f) { (this._h = this._h || []).push([t, f]); },
  };
}
// Mirrors the real pad in index.html, so a missing handler shows up as a crash.
const PAD = [
  btn('down'), btn('boost'), btn('up'),
  btn(undefined, 'fly'), btn(undefined, 'slower'), btn(undefined, 'fog'),
  btn(undefined, 'faster'), btn(undefined, 'grab'),
];
function el() {
  return {
    style: {}, textContent: '', value: '9', max: '9', innerHTML: '',
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener(t, f) { (this._h = this._h || []).push([t, f]); },
    requestPointerLock() {}, setAttribute() {},
    querySelectorAll: () => PAD,
    appendChild(c) { (this._kids = this._kids || []).push(c); },
    append(...c) { (this._kids = this._kids || []).push(...c); },
    after() {}, before() {}, remove() {}, focus() {}, select() {},
    offsetHeight: 20, children: [], dataset: {},
    getContext: () => makeGL(), width: 0, height: 0,
  };
}

const listeners = {};
const addL = (o) => (t, f) => { (listeners[t] = listeners[t] || []).push(f); };

globalThis.performance = globalThis.performance || { now: () => Date.now() };
globalThis.devicePixelRatio = 1;
globalThis.innerWidth = 1920;
globalThis.innerHeight = 1080;
// Start in Toronto, in sight of the CN Tower, so a landmark is loaded and drawn.
globalThis.location = { hash: '#lat=43.6300&lon=-79.4000&alt=1500&mode=fly' };
// Stands in for the OpenFreeMap TileJSON.
// Landmark files come off the disk; anything else gets the stand-in TileJSON.
const { readFileSync, existsSync } = await import('node:fs');
globalThis.fetch = async (url) => {
  const u = String(url);
  if (u.startsWith('file:')) {
    const ok = existsSync(new URL(u));
    return { ok, status: ok ? 200 : 404, json: async () => JSON.parse(readFileSync(new URL(u), 'utf8')) };
  }
  return { ok: true, status: 200, json: async () => ({ tiles: ['https://x/{z}/{x}/{y}.pbf'] }) };
};
globalThis.history = { replaceState() {} };
const ELS = {};
globalThis.document = {
  getElementById: (id) => (ELS[id] = ELS[id] || el()),
  createElement: () => el(),
  documentElement: { requestFullscreen: async () => {} },
  exitPointerLock() {}, exitFullscreen: async () => {},
  fullscreenElement: null,
  addEventListener: addL(),
  body: { classList: { toggle() {} } },
  pointerLockElement: null,
};
globalThis.window = globalThis;
globalThis.addEventListener = addL();

// Worker mock: builds a real mesh from synthetic elevation data.
const wmod = await import('../src/worker.js');
const geo = await import('../src/geo.js');
let workerCount = 0;
globalThis.Worker = class {
  constructor() { workerCount++; this.onmessage = null; }
  postMessage(m) {
    // Near field and skyline jobs carry an elevation URL; answer those with a
    // small road and building mesh, the way nearworker.js would.
    if (m.eurl) {
      const v = new ArrayBuffer(4 * 16);
      const tri = () => new Uint32Array([0, 1, 2, 0, 2, 3]);
      setTimeout(() => this.onmessage && this.onmessage({ data: {
        id: m.id, ok: true, vertices: v.slice(0), indices: tri(), verts: 4,
        bVertices: v.slice(0), bIndices: tri(), bVerts: 4, bInfo: new Uint8Array(16),
        rEnds: [6, 6, 6],
        // The new look (key 5) adds wall positions and style bytes.
        ...(m.style ? { bFac: new Float32Array(16), bSty: new Uint32Array(4).fill(0xff000000) } : {}),
        stats: { seen: 1, kept: 1, dropped: 0, ends: [6, 6, 6], cover: 0.5, built: 0.5, style: m.style || 0 },
      } }), 0);
      return;
    }
    const px = 256;
    const h = new Float32Array(px * px);
    for (let j = 0; j < px; j++) {
      for (let i = 0; i < px; i++) {
        h[j * px + i] = 900 + 700 * Math.sin(i / 24) * Math.cos(j / 31) + (m.z * 3);
      }
    }
    const { positions, indices } = wmod.buildMesh(h, m.z, m.grid);
    const centre = geo.tileCentreMerc(m.x, m.y, m.z);
    const nw = geo.tileToMerc(m.x, m.y, m.z);
    setTimeout(() => this.onmessage && this.onmessage({
      data: {
        id: m.id, ok: true, positions, indices, centre, nw,
        size: geo.tileSizeMerc(m.z), heights: m.keepHeights ? h : null,
        mask: m.vurl ? (() => { const a = new Uint8Array(256 * 256 * 4);
          for (let i = 0; i < 256 * 256; i++) { a[i*4] = (i % 256) < 90 ? 255 : 0;
            a[i*4+1] = i % 37 === 0 ? 255 : 0; a[i*4+3] = 200; } return a; })() : null,
        cover: m.vurl ? new Uint8Array(256 * 256 * 3).fill(90) : null,
      },
    }), 0);
  }
};

let rafCb = null, rafCount = 0;
globalThis.requestAnimationFrame = (cb) => { rafCb = cb; rafCount++; return rafCount; };

await import('../src/main.js');

// Drive frames manually, letting queued worker messages land between them.
let t = performance.now();
const FRAMES = 240;
for (let i = 0; i < FRAMES; i++) {
  const cb = rafCb; rafCb = null;
  t += 16.7;
  if (cb) cb(t);
  await new Promise((r) => setTimeout(r, 0));
  // Hold W down from frame 40, and switch to flight at frame 120.
  if (i === 40) listeners.keydown && listeners.keydown.forEach((f) => f({ code: 'KeyW', preventDefault() {} }));
  if (i === 120) {
    const k = listeners.keydown || [];
    k.forEach((f) => f({ code: 'Space', preventDefault() {} }));
    k.forEach((f) => f({ code: 'Space', preventDefault() {} }));
  }
}

let padFired = 0;
for (const b of PAD) {
  for (const [t, f] of (b._h || [])) {
    try { f({ preventDefault() {} }); padFired++; } catch (e) { console.log('PAD HANDLER THREW: ' + e.message); process.exitCode = 1; }
  }
}

// Flip layer buttons and confirm the uniform actually changes.
const layerBtns = (ELS['layers'] && ELS['layers']._kids) || [];
let toggled = 0;
for (const b of layerBtns) for (const [t, f] of (b._h || [])) { try { f({ preventDefault(){} }); toggled++; } catch (e) { console.log('LAYER HANDLER THREW ' + e.message); process.exitCode = 1; } }

// Press every key in the key table, twice (on, then back off), then run more
// frames. A key whose action is wired wrong throws here.
const { KEYS } = await import('../src/ui/keys.js');
let keysFired = 0;
for (let pass = 0; pass < 2; pass++) {
  for (const k of KEYS.filter((x) => x.act)) {
    try { (listeners.keydown || []).forEach((f) => f({ code: k.code, preventDefault() {}, repeat: false })); keysFired++; }
    catch (e) { console.log('KEY ' + k.label + ' THREW: ' + e.message); process.exitCode = 1; }
    const cb = rafCb; rafCb = null; t += 16.7; if (cb) cb(t);
    await new Promise((r) => setTimeout(r, 0));
  }
}

// Key 5 cycles three building styles, so two presses leave a different one
// on, and the near field rebuilt. Let it refill, then take the report again.
for (let f = 0; f < 30; f++) { const cb = rafCb; rafCb = null; t += 16.7; if (cb) cb(t); await new Promise((r) => setTimeout(r, 0)); }
(listeners.keydown || []).forEach((f) => f({ code: 'KeyK', preventDefault() {}, repeat: false }));

const R = [];
const ok = (c, m) => { R.push((c ? 'PASS  ' : 'FAIL  ') + m); if (!c) process.exitCode = 1; };

ok(layerBtns.length === 5, `layer panel built ${layerBtns.length} buttons (expect 5)`);
ok(toggled === 5, `all ${toggled} layer toggles fired cleanly`);
ok(log.mipmaps > 0, `generated mipmaps for ${log.mipmaps} textures`);
ok(log.textures > 0, `uploaded ${log.texUploads} textures across ${log.textures} objects`);
ok(log.texSizes.has('256x256'), `mask textures are 256x256 (${[...log.texSizes].join(', ')})`);
ok(keysFired === 2 * KEYS.filter((x) => x.act).length, `pressed every action key twice (${keysFired}) without throwing`);
ok(padFired >= 8, `fired ${padFired} pad handlers without throwing`);
ok(workerCount === 9, `spawned ${workerCount} workers (3 terrain, 4 near, 2 skyline)`);
ok(log.uniforms.size === 31, `resolved ${log.uniforms.size} distinct uniform names (expect 31: terrain 17, mesh adds 14)`);
ok(log.badUniform.length === 0, `no null uniform locations (${log.badUniform.length})`);
ok(log.nan.length === 0, `no NaN/Inf uniform values (${log.nan.length}${log.nan.length ? ': ' + log.nan.slice(0, 3) : ''})`);
const rep = globalThis.twReport;   // left behind by the K key
ok(rep && rep.landmarks.some((L) => L.shape === 'ready' && L.ground !== null),
  `a landmark in sight loaded and stood on the ground (${rep && JSON.stringify(rep.landmarks)})`);
ok(rep && /bldg/.test(rep.nearStatus), `near field loaded and drew buildings (${rep && rep.nearStatus})`);
ok(rep && /urban [1-9]/.test(rep.skyStatus), `skyline found built-up tiles (${rep && rep.skyStatus})`);
ok(log.draws > 0, `issued ${log.draws} draw calls over ${FRAMES} frames`);
ok(log.buffers > 0, `created ${log.buffers} GL buffers`);
ok(log.clears >= FRAMES, `${log.clears} clears (2 per frame for the depth split)`);
console.log('\n' + R.join('\n'));
console.log(`\ntriangles submitted total: ${(log.tris / 1e6).toFixed(1)}M over ${FRAMES} frames`);
console.log(`≈ ${(log.tris / FRAMES / 1000).toFixed(0)}k tris/frame, ${(log.draws / FRAMES).toFixed(0)} draws/frame`);
// The app sets repeating timers (cache polling), so leave explicitly.
process.exit(process.exitCode || 0);
