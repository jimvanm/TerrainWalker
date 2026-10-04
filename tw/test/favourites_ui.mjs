const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.has(k) ? mem.get(k) : null, setItem: (k, v) => mem.set(k, String(v)) };
const listeners = {};
globalThis.window = globalThis;
globalThis.addEventListener = (t, f) => { (listeners[t] ||= []).push(f); };
globalThis.document = { pointerLockElement: null, exitPointerLock() { this.exited = true; },
  createElement: (tag) => ({ tag, children: [], className: '', textContent: '', append(...c) { this.children.push(...c); },
    focus() {}, select() {} }) };
const root = document.createElement('div');
Object.defineProperty(root, 'textContent', { set(v) { this.children = []; }, get() { return ''; } });
const { initFavourites } = await import('../src/favourites.js');
let jumped = null;
const ui = initFavourites({ root, jump: (p) => { jumped = p; },
  getView: () => ({ lat: 1.23456, lon: 2.34567, alt: 500, agl: 120, yaw: 10, pitch: -5, fly: 1 }) });
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };
const find = (n, cls) => { const out = []; (function w(x) { if (x.className && x.className.split(' ').includes(cls)) out.push(x); (x.children || []).forEach(w); })(n); return out; };

find(root, 'ftitle')[0].onclick();
ok(find(root, 'frow').length === 4, 'opening the panel lists the four seeded places');
find(root, 'fgo')[1].onclick();
ok(jumped && jumped.name.startsWith('Shinjuku') && jumped.agl === 200, 'clicking a place jumps to it');
document.pointerLockElement = {}; ui.pinHere();
ok(document.exited && find(root, 'fname').length === 1, 'P pins, frees the mouse, and opens a name box');
const inp = find(root, 'fname')[0]; inp.value = 'Suzhou'; inp.onkeydown({ key: 'Enter' });
ok(JSON.parse(mem.get('tw.places')).at(-1).name === 'Suzhou', 'Enter saves the name');
const delBtn = () => find(root, 'fdel').at(-1);
delBtn().onclick();
ok(JSON.parse(mem.get('tw.places')).length === 5, 'first delete click only arms it');
delBtn().onclick();
ok(JSON.parse(mem.get('tw.places')).length === 4, 'second click deletes');
find(root, 'fstar')[2].onclick();
ok(JSON.parse(mem.get('tw.places'))[2].start === true && JSON.parse(mem.get('tw.places')).filter((p) => p.start).length === 1, 'starring moves the start point');
console.log('favourites ui ok'); process.exit(0);
