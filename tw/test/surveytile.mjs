// The survey's piece-keeping reader (surveytile.js): it returns exactly the
// bytes asked for, fetches whole pieces, and never fetches a piece twice.
import { CachedRangeClient, CHUNK, parseSurveyUrl } from '../src/surveytile.js';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };

const FILE = new Uint8Array(5 * CHUNK + 1234);
for (let i = 0; i < FILE.length; i++) FILE[i] = (i * 7 + (i >> 9)) & 255;
const asked = [];
const fakeFetch = async (url, init) => {
  const [, a, b] = /bytes=(\d+)-(\d+)/.exec(init.headers.Range);
  const s = Number(a), e = Math.min(Number(b), FILE.length - 1);
  asked.push([s, e]);
  return { status: 206, headers: { get: (n) => (n === 'content-range' ? `bytes ${s}-${e}/${FILE.length}` : null) },
    arrayBuffer: async () => FILE.slice(s, e + 1).buffer };
};
// A stand-in for the browser's storage, shared by two readers as by two helpers.
const kept = new Map();
const store = Promise.resolve({
  match: async (k) => (kept.has(k) ? { arrayBuffer: async () => kept.get(k).body.buffer, headers: { get: (n) => kept.get(k).h.get(n) } } : undefined),
  put: async (k, res) => { kept.set(k, { body: new Uint8Array(await res.arrayBuffer()), h: res.headers }); },
});
const same = (got, a, b) => { const g = new Uint8Array(got); if (g.length !== b - a + 1) return false; for (let i = 0; i < g.length; i++) if (g[i] !== FILE[a + i]) return false; return true; };

const one = new CachedRangeClient('https://x/f.tif', { fetch: fakeFetch, store });
let r = await one.request({ headers: { Range: `bytes=${CHUNK - 10}-${CHUNK + 20}` } });
ok(same(await r.getData(), CHUNK - 10, CHUNK + 20), 'a range across two pieces comes back exactly');
ok(asked.length === 1 && asked[0][0] === 0 && asked[0][1] === 2 * CHUNK - 1, 'the two whole pieces were fetched in one request');
ok(r.getHeader('content-range') === `bytes ${CHUNK - 10}-${CHUNK + 20}/${FILE.length}`, 'the reply says which bytes and the file size');
await new Promise((res) => setTimeout(res, 0));

const two = new CachedRangeClient('https://x/f.tif', { fetch: fakeFetch, store });   // another helper
r = await two.request({ headers: { Range: `bytes=100-${2 * CHUNK - 1}` } });
ok(same(await r.getData(), 100, 2 * CHUNK - 1) && asked.length === 1, 'another helper gets the same pieces from storage, with nothing fetched');
r = await two.request({ headers: { Range: `bytes=${FILE.length - 50}-${FILE.length + 500}` } });
ok(same(await r.getData(), FILE.length - 50, FILE.length - 1), 'a range past the end of the file is cut at the end');
ok(asked.length === 2 && asked[1][0] === 5 * CHUNK, 'only the last piece was fetched');
const p = parseSurveyUrl('hrdem:16/18821/23557');
ok(p.z === 16 && p.x === 18821 && p.y === 23557, 'survey tile addresses read back');
console.log('surveytile ok');
