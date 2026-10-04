// Cache behaviour with a fake Cache API and a fake network.
const store = new Map();
globalThis.caches = { open: async () => ({
  match: async (u) => store.get(u)?.clone(),
  put: async (u, r) => { store.set(u, r); },
  keys: async () => [...store.keys()].map((url) => ({ url })),
  delete: async (k) => store.delete(k.url || k),
}), delete: async () => true };
let net = 0, down = false;
globalThis.fetch = async (u) => { net++; if (down) throw new Error('offline');
  return new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { 'content-type': 'image/png' } }); };
const { cachedFetch } = await import('../src/cache.js');
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };

let r = await cachedFetch('u1'); await r.arrayBuffer(); await new Promise((s) => setTimeout(s, 20));
ok(net === 1 && store.has('u1'), 'first visit downloads and saves');
r = await cachedFetch('u1'); const b = new Uint8Array(await r.arrayBuffer());
ok(net === 1 && b.length === 3 && b[2] === 3, 'second visit comes from the cache, bytes intact');
// age it past 30 days: fetched again; offline: old copy still served
const old = store.get('u1'); const h = new Headers(old.headers); h.set('x-tw-time', String(Date.now() - 40 * 864e5));
store.set('u1', new Response(new Uint8Array([9, 9, 9]), { headers: h }));
down = true;
r = await cachedFetch('u1');
ok(new Uint8Array(await r.arrayBuffer())[0] === 9, 'stale copy is used when the network is down');
down = false;
r = await cachedFetch('u1'); await r.arrayBuffer(); await new Promise((s) => setTimeout(s, 20));
ok(net === 3 && Date.now() - Number(store.get('u1').headers.get('x-tw-time')) < 5000, 'stale copy is refreshed when the network is up');
// failures are never cached
globalThis.fetch = async () => new Response('x', { status: 404 });
await cachedFetch('missing'); await new Promise((s) => setTimeout(s, 20));
ok(!store.has('missing'), '404s are not saved');
console.log('cache ok');
