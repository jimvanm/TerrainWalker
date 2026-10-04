// Every key the app answers to, in one table.
//
// The help panel is built from this table, so it cannot fall out of step with
// what the keys actually do. test/keys.mjs also checks that the README lists
// every key here.
//
// Two kinds of entry:
//   act   a one-shot action, run on key press. The name is looked up in the
//         actions object given to bindKeys().
//   hold  held keys read every frame by controls.js (movement). Listed here
//         only so they appear in the help.
//
// line: which line of the help panel the entry goes on.

export const KEYS = [
  { line: 0, label: 'click', help: 'to capture mouse' },
  { line: 0, label: 'esc', help: 'to release' },

  { line: 1, label: 'WASD', help: 'move', hold: ['KeyW', 'KeyA', 'KeyS', 'KeyD'] },
  { line: 1, label: 'Q/E', help: 'down/up', hold: ['KeyQ', 'KeyE'] },
  { line: 1, label: 'shift', help: 'run', hold: ['ShiftLeft'] },

  { line: 2, label: 'G', help: 'or', code: 'KeyG', act: 'toggleFly' },
  { line: 2, label: 'space space', help: 'toggle fly' },
  { line: 2, label: 'space/shift', help: 'up/down', hold: ['Space', 'ShiftLeft'] },

  { line: 3, label: 'ctrl', help: 'boost (safe once keys are locked)', hold: ['ControlLeft'] },
  { line: 3, label: 'wheel', help: 'fly speed' },
  { line: 3, label: 'R', help: 'reset', code: 'KeyR', act: 'reset' },

  { line: 4, label: 'V', help: 'water', code: 'KeyV', act: 'layer:water' },
  { line: 4, label: 'X', help: 'roads', code: 'KeyX', act: 'layer:roads' },
  { line: 4, label: 'B', help: 'built', code: 'KeyB', act: 'layer:built' },
  { line: 4, label: 'C', help: 'cover', code: 'KeyC', act: 'layer:cover' },
  { line: 4, label: 'T', help: 'landmarks', code: 'KeyT', act: 'layer:land' },
  { line: 4, label: 'F', help: 'fog', code: 'KeyF', act: 'toggleFog' },

  { line: 5, label: '6', help: 'real colours', code: 'Digit6', act: 'lookReal' },
  { line: 5, label: '7', help: 'colour by type', code: 'Digit7', act: 'lookType' },
  { line: 5, label: '8', help: 'colour set', code: 'Digit8', act: 'lookSet' },
  { line: 5, label: '9', help: 'warm', code: 'Digit9', act: 'lookWarm' },

  { line: 6, label: 'P', help: 'pin place', code: 'KeyP', act: 'pin' },
  { line: 6, label: 'K', help: 'copy height report', code: 'KeyK', act: 'heightReport' },
  { line: 6, label: 'L', help: 'copy strain log', code: 'KeyL', act: 'strainLog' },
  { line: 6, label: 'H', help: 'hide this', code: 'KeyH', act: 'toggleHelp' },

  { line: 7, label: '1', help: 'grid', code: 'Digit1', act: 'debugGrid' },
  { line: 7, label: '2', help: 'freeze', code: 'Digit2', act: 'freeze' },
  { line: 7, label: '3', help: 'flat', code: 'Digit3', act: 'debugFlat' },
];

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

export function helpHtml() {
  const lines = [];
  for (const k of KEYS) {
    (lines[k.line] = lines[k.line] || []).push(k);
  }
  return lines.map((ks) => {
    // "G or space space toggle fly" reads as one phrase, so an entry whose help
    // is just "or" joins the next one without a separator.
    let out = '';
    ks.forEach((k, i) => {
      if (i > 0) out += ks[i - 1].help === 'or' ? ' ' : ' &middot; ';
      out += `<b>${esc(k.label)}</b> ${esc(k.help)}`;
    });
    return out;
  }).join('<br>');
}

// Runs table actions on key press. Auto-repeat and keys pressed with ctrl, alt
// or the command key are ignored, so holding a key toggles once, and ctrl
// shortcuts never flip a layer by accident.
export function bindKeys(actions, target = window) {
  const byCode = new Map(KEYS.filter((k) => k.act).map((k) => [k.code, k.act]));
  target.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const name = byCode.get(e.code);
    if (!name) return;
    const [head, arg] = name.split(':');
    const fn = actions[head];
    if (fn) fn(arg, e);
  });
}
