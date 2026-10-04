// Fakes shared by the near field and skyline tests: just enough of a page, a
// helper (Worker) and a WebGL2 context for the layers to run in Node.
//
// Importing this file installs the fake page and Worker on the global object.

export const posted = [];          // every message any fake helper was sent
globalThis.document = globalThis.document || { getElementById: () => ({ style: {} }) };
globalThis.Worker = class {
  postMessage(m) { posted.push(m); }
  terminate() {}
};

// A WebGL2 context that accepts anything. drawElements counts go into `draws`.
export function fakeGL(draws = []) {
  return new Proxy({}, { get: (_, p) => {
    if (p === 'getAttribLocation') return (_, n) => (n === 'aPos' ? 0 : n === 'aCol' ? 1 : 2);
    if (['getShaderParameter', 'getProgramParameter'].includes(p)) return () => true;
    if (p === 'getParameter') return () => 8;
    if (p === 'getExtension') return () => null;
    if (p === 'drawElements') return (mode, n) => draws.push(n);
    return () => ({});
  } });
}

export const TEMPLATE = () => 'https://v/{z}/{x}/{y}.pbf';

// The parts of a detail.js view the near field and skyline read.
export function view(mx, my, o = {}) {
  return {
    mercX: mx, mercY: my, k: 0.7,
    nearOn: o.on ?? true, nearFetchOk: o.fetchOk ?? true, nearR: o.R ?? 2,
    lead: o.lead ? { use: true, x: o.lead[0], y: o.lead[1] } : { use: false, x: mx, y: my },
  };
}

// The camera for one draw pass.
const M = new Float32Array(16);
export const pass = (mx, my, k = 0.7) => ({ proj: M, view: M, k, alt: 0, mercX: mx, mercY: my, curv: 0 });

// Answer every running job of a layer with `reply` (a helper's success message).
export function finishAll(layer, reply) {
  for (const [id] of [...layer.pool.inflight]) layer.pool._done(layer.pool.helpers[0], { id, ok: true, ...reply });
}

// Answer one running job, chosen by tile key.
export function finish(layer, key, reply) {
  const id = [...layer.pool.inflight].find(([, s]) => s.key === key)[0];
  layer.pool._done(layer.pool.helpers[0], { id, ok: true, ...reply });
}
