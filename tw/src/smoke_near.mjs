import assert from 'node:assert/strict';
globalThis.document = { getElementById: () => ({ style: {} }) };
const posted = [];
globalThis.Worker = class { postMessage(m) { posted.push(m); } };
const gl = new Proxy({}, { get: (_, p) => {
  if (p === 'getAttribLocation') return (_, n) => (n === 'aPos' ? 0 : 1);
  if (['getShaderParameter', 'getProgramParameter'].includes(p)) return () => true;
  if (p === 'getParameter') return () => 8;
  if (p === 'getExtension') return () => null;
  return () => ({});
}});
const { NearField } = await import('./nearfield.js');
const { Terrain } = await import('./terrain.js');
const { mercToTile, tileToMerc } = await import('./geo.js');

const nf = new NearField(gl, () => 'https://v/{z}/{x}/{y}.pbf');
const mx = -8847000, my = 5440000;
const tick = (fetchOk, R) => {
  for (const [id] of [...nf.inflight]) nf._done(nf.workers[0], { id, ok: true, vertices: new ArrayBuffer(48), indices: new Uint32Array([0,1,2]), verts: 3 });
  nf.update(mx, my, true, fetchOk, R);
};
nf.update(mx, my, true, true, 2);
assert.equal(nf.want.length, 25);
assert.equal(nf.rect, null, 'no cover before anything loaded');
for (let i = 0; i < 40; i++) tick(true, 2);
assert.ok(nf.rect && nf.ready, 'cover after load');
const t = mercToTile(mx, my, 14), cx = Math.floor(t.x), cy = Math.floor(t.y);
const ex = tileToMerc(cx - 2, cy - 2, 14), ey = tileToMerc(cx + 3, cy + 3, 14);
assert.ok(Math.abs(nf.rect.w - ex.x) < 1e-6 && Math.abs(nf.rect.e - ey.x) < 1e-6, 'rect spans 5x5');
console.log('ok  5x5 loads and covered block spans all 25 tiles');

// fetch gating: fast flight asks for nothing new but keeps drawing what it has
const posted0 = posted.length;
nf.update(mx + 20000, my, true, false, 2);          // moved ~10 tiles, fetch not allowed
assert.equal(posted.length, posted0, 'no fetch when too fast');
assert.equal(nf.queue.size, 0);
assert.equal(nf.draw({}, new Float32Array(16), new Float32Array(16), 0.7, 0, mx + 20000, my, 0, true), 0);
nf.update(mx, my, true, false, 2);
assert.ok(nf.draw({}, new Float32Array(16), new Float32Array(16), 0.7, 0, mx, my, 0, true) > 0, 'cached tiles still draw at speed');
console.log('ok  fast flight fetches nothing but still draws cached tiles');

// cover block never claims a tile that is not loaded
nf.tiles.delete((cx + 1) + '/' + cy);                // knock out a tile east of centre
nf.update(mx, my, true, false, 2);
const r = nf.rect;
assert.ok(r.e <= tileToMerc(cx + 1, cy, 14).x + 1e-6, 'rect stops at the hole');
console.log('ok  covered block stops at a missing tile (painted road stays there)');

// uniform: empty when roads off or inactive, camera-relative otherwise
assert.deepEqual(nf.rectUniform(mx, my, 0.7, false), [1, 1, -1, -1]);
const ru = nf.rectUniform(mx, my, 0.7, true);
assert.ok(ru[0] < 0 && ru[2] > ru[0] && ru[1] < ru[3], JSON.stringify(ru));
nf.update(mx, my, false, true, 1);
assert.deepEqual(nf.rectUniform(mx, my, 0.7, true), [1, 1, -1, -1]);
console.log('ok  rect uniform is empty when off and camera-relative when on');

// terrain look-ahead: lead tiles join the fetch list, behind current ones
const wants = [];
const loader = { want: (s) => wants.push(s), keepOnly() {}, pump() {}, onTile: null };
const terr = new Terrain(gl, loader);
terr.update(mx, my, 0, 5);
const base = new Set(wants.map((w) => w.key)); wants.length = 0;
terr.update(mx, my, 0, 5, mx + 40000, my, true);
const withLead = new Set(wants.map((w) => w.key));
assert.ok(withLead.size > base.size, 'lead adds tiles');
const leadOnly = wants.filter((w) => !base.has(w.key));
const cur = wants.filter((w) => base.has(w.key));
assert.ok(leadOnly.length > 0);
for (const l of leadOnly) {                          // same level: current tile first
  const peer = cur.filter((c) => c.level === l.level);
  if (peer.length) assert.ok(l.priority > Math.min(...peer.map((c) => c.priority)));
}
console.log('ok  look-ahead adds ' + (withLead.size - base.size) + ' tiles, queued behind current ones');
console.log('\nsmoke ok');

// ---- 0.8.2: lead tiles and wheel scaling ----
{
  const nf2 = new NearField(gl, () => 'https://v/{z}/{x}/{y}.pbf');
  nf2.update(mx, my, true, true, 1, mx + 20000, my, true);
  assert.ok(nf2.want.length > 9, 'lead tiles added: ' + nf2.want.length);
  nf2.update(mx, my, true, false, 1, mx + 20000, my, true);
  assert.match(nf2.status, /too fast/);
  console.log('ok  near field also wants tiles ahead; says so when too fast to fetch');

  const { Controls } = await import('./controls.js');
  const fake = { cam: { fly: 1 }, flyMult: 1, walkMult: 1 };
  Controls.prototype.bump.call(fake, 1.5);
  assert.equal(fake.flyMult, 1.5); assert.equal(fake.walkMult, 1);
  fake.cam.fly = 0;
  Controls.prototype.bump.call(fake, 2);
  assert.equal(fake.walkMult, 2); assert.equal(fake.flyMult, 1.5);
  for (let i = 0; i < 40; i++) Controls.prototype.bump.call(fake, 2);
  assert.equal(fake.walkMult, 100);
  fake.cam.fly = 1;
  for (let i = 0; i < 40; i++) Controls.prototype.bump.call(fake, 2);
  assert.equal(fake.flyMult, 50);
  console.log('ok  wheel scales fly and walk speed separately, with limits (walk x100, fly x50)');
}
