// The key table (src/ui/keys.js) is the one list of keys. Check that nothing
// else has drifted from it: no key used twice, the help panel shows every
// entry, and the README lists every key that does something.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYS, helpHtml, bindKeys } from '../src/ui/keys.js';

const acts = KEYS.filter((k) => k.act);
const codes = acts.map((k) => k.code);
assert.equal(new Set(codes).size, codes.length, 'no key code runs two actions');
for (const k of acts) assert.match(k.code, /^(Key[A-Z]|Digit\d)$/, 'action key has a real key code: ' + k.label);

const html = helpHtml();
for (const k of KEYS) assert.ok(html.includes(`<b>${k.label}</b>`), 'help panel shows ' + k.label);
console.log('ok  help panel shows all ' + KEYS.length + ' entries');

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const controls = readme.slice(readme.indexOf('| Input | Action |'), readme.indexOf('## Going somewhere'));
for (const k of acts) assert.ok(controls.includes('`' + k.label + '`'), 'README controls table lists `' + k.label + '`');
console.log('ok  README lists all ' + acts.length + ' action keys');

// Dispatch: the right action, once, and never on auto-repeat or with ctrl held.
const handlers = [];
const target = { addEventListener: (t, f) => handlers.push(f) };
const ran = [];
const actions = new Proxy({}, { get: (_, name) => (arg) => ran.push(arg ? name + ':' + arg : name) });
bindKeys(actions, target);
const press = (code, extra = {}) => handlers.forEach((f) => f({ code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, ...extra }));
for (const k of acts) press(k.code);
assert.deepEqual(ran, acts.map((k) => k.act), 'every key runs its own action');
ran.length = 0;
press('KeyV', { repeat: true }); press('KeyV', { ctrlKey: true }); press('KeyW');
assert.equal(ran.length, 0, 'auto-repeat, ctrl, and movement keys run nothing');
console.log('ok  keys dispatch to their actions; repeat and ctrl are ignored');
console.log('keys ok');
