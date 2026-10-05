// The key table (src/ui/keys.js) is the one list of keys. Check that nothing
// else has drifted from it: no key used twice, the help panel shows every
// entry, and the README lists every key that does something.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { KEYS, MODES, inMode, helpHtml, bindKeys } from '../src/ui/keys.js';

const acts = KEYS.filter((k) => k.act);
for (const m of MODES) {
  const codes = acts.filter((k) => inMode(k, m.id)).map((k) => k.code);
  assert.equal(new Set(codes).size, codes.length, 'no key code runs two actions in ' + m.name);
}
for (const k of acts) assert.match(k.code, /^(Key[A-Z]|Digit\d|Comma|Period|Delete|Tab)$/, 'action key has a real key code: ' + k.label);

for (const m of MODES) {
  const html = helpHtml(m.id);
  for (const k of KEYS.filter((q) => inMode(q, m.id))) assert.ok(html.includes(`<b>${k.label}</b>`), m.name + ' menu shows ' + k.label);
  for (const k of KEYS.filter((q) => !inMode(q, m.id) && !KEYS.some((o) => o !== q && o.label === q.label && inMode(o, m.id)))) {
    assert.ok(!html.includes(`<b>${k.label}</b>`), m.name + ' menu leaves out ' + k.label);
  }
}
assert.ok(helpHtml('tools').includes('<b>M</b>') && !helpHtml('nav').includes('<b>M</b>'), 'M is a Tools key');
console.log('ok  each mode\'s menu shows its keys and only those');

const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const controls = readme.slice(readme.indexOf('| Input | Action |'), readme.indexOf('## Going somewhere'));
for (const k of acts) assert.ok(controls.includes('`' + k.label + '`'), 'README controls table lists `' + k.label + '`');
console.log('ok  README lists all ' + acts.length + ' action keys');

// Dispatch: the right action, once, and never on auto-repeat or with ctrl held.
const handlers = [];
const target = { addEventListener: (t, f) => handlers.push(f) };
const ran = [];
const actions = new Proxy({}, { get: (_, name) => (arg) => ran.push(arg ? name + ':' + arg : name) });
let mode = 'nav';
bindKeys(actions, target, () => mode);
const press = (code, extra = {}) => handlers.forEach((f) => f({ code, repeat: false, ctrlKey: false, metaKey: false, altKey: false, preventDefault() {}, ...extra }));
for (const m of MODES) {
  mode = m.id; ran.length = 0;
  const mine = acts.filter((k) => inMode(k, m.id));
  for (const k of mine) press(k.code);
  assert.deepEqual(ran, mine.map((k) => k.act), m.name + ': every key runs its own action');
}
mode = 'nav'; ran.length = 0;
press('KeyM'); press('Delete');
assert.equal(ran.length, 0, 'Tools keys do nothing in Navigation');
mode = 'tools'; press('KeyV'); press('Digit1');
assert.equal(ran.length, 0, 'and Navigation-only keys do nothing in Tools');
press('Tab'); assert.deepEqual(ran, ['switchMode'], 'Tab switches mode from either');
ran.length = 0; mode = 'nav';
press('KeyV', { repeat: true }); press('KeyV', { ctrlKey: true }); press('KeyW');
assert.equal(ran.length, 0, 'auto-repeat, ctrl, and movement keys run nothing');
console.log('ok  keys dispatch to their actions in their own mode; repeat and ctrl are ignored');
console.log('keys ok');
