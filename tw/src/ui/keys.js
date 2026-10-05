// Every key the app answers to, in one table.
//
// The key menu (help panel) is built from this table, so it cannot fall out of step with
// what the keys actually do. test/keys.mjs also checks that the README lists
// every key here.
//
// Two kinds of entry:
//   act   a one-shot action, run on key press. The name is looked up in the
//         actions object given to bindKeys().
//   hold  held keys read every frame by controls.js (movement). Listed here
//         only so they appear in the help.
//
// group: which heading of the help menu the entry goes under (GROUPS, in order).

export const GROUPS = ['Mouse', 'Moving', 'Flying', 'Show / hide', 'Colours', 'Tools', 'Checking'];

export const KEYS = [
  { group: 'Mouse', label: 'click', help: 'capture mouse' },
  { group: 'Mouse', label: 'esc', help: 'release mouse' },

  { group: 'Moving', label: 'WASD', help: 'move', hold: ['KeyW', 'KeyA', 'KeyS', 'KeyD'] },
  { group: 'Moving', label: 'Q/E', help: 'down / up', hold: ['KeyQ', 'KeyE'] },
  { group: 'Moving', label: 'shift', help: 'run', hold: ['ShiftLeft'] },
  { group: 'Moving', label: 'ctrl', help: 'boost (lock keys first)', hold: ['ControlLeft'] },
  { group: 'Moving', label: 'R', help: 'back to start', code: 'KeyR', act: 'reset' },

  { group: 'Flying', label: 'G', help: 'or', code: 'KeyG', act: 'toggleFly' },
  { group: 'Flying', label: 'space space', help: 'walk / fly' },
  { group: 'Flying', label: 'space/shift', help: 'up / down', hold: ['Space', 'ShiftLeft'] },
  { group: 'Flying', label: 'wheel', help: 'flying speed' },

  { group: 'Show / hide', label: 'V', help: 'water', code: 'KeyV', act: 'layer:water' },
  { group: 'Show / hide', label: 'X', help: 'roads', code: 'KeyX', act: 'layer:roads' },
  { group: 'Show / hide', label: 'B', help: 'buildings', code: 'KeyB', act: 'layer:built' },
  { group: 'Show / hide', label: 'C', help: 'ground cover', code: 'KeyC', act: 'layer:cover' },
  { group: 'Show / hide', label: 'T', help: 'landmarks', code: 'KeyT', act: 'layer:land' },
  { group: 'Show / hide', label: 'F', help: 'fog', code: 'KeyF', act: 'toggleFog' },

  { group: 'Colours', label: '6', help: 'real', code: 'Digit6', act: 'lookReal' },
  { group: 'Colours', label: '7', help: 'by type', code: 'Digit7', act: 'lookType' },
  { group: 'Colours', label: '8', help: 'colour set', code: 'Digit8', act: 'lookSet' },
  { group: 'Colours', label: '9', help: 'warm', code: 'Digit9', act: 'lookWarm' },

  { group: 'Tools', label: 'P', help: 'pin this place', code: 'KeyP', act: 'pin' },
  { group: 'Tools', label: 'M', help: 'drop a landmark (again: next, then off)', code: 'KeyM', act: 'dropCycle' },
  { group: 'Tools', label: ',', help: 'or', code: 'Comma', act: 'dropLeft' },
  { group: 'Tools', label: '.', help: 'turn it', code: 'Period', act: 'dropRight' },
  { group: 'Tools', label: 'Delete', help: 'remove the dropped one aimed at', code: 'Delete', act: 'dropRemove' },
  { group: 'Tools', label: 'K', help: 'copy height report', code: 'KeyK', act: 'heightReport' },
  { group: 'Tools', label: 'L', help: 'copy strain log', code: 'KeyL', act: 'strainLog' },
  { group: 'Tools', label: 'H', help: 'hide this menu and the graph', code: 'KeyH', act: 'toggleHelp' },

  { group: 'Checking', label: '1', help: 'grid', code: 'Digit1', act: 'debugGrid' },
  { group: 'Checking', label: '2', help: 'freeze', code: 'Digit2', act: 'freeze' },
  { group: 'Checking', label: '3', help: 'flat ground', code: 'Digit3', act: 'debugFlat' },
  { group: 'Checking', label: '4', help: 'buildings under landmarks', code: 'Digit4', act: 'toggleMask' },
];

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// One heading per group, then one row per key: the key on the left, what it
// does on the right. An entry whose help is just "or" shares the next entry's
// row ("G or space space   walk / fly").
export function helpHtml() {
  return GROUPS.map((g) => {
    const ks = KEYS.filter((k) => k.group === g);
    let rows = '', keys = '';
    for (const k of ks) {
      keys += (keys ? ' or ' : '') + `<b>${esc(k.label)}</b>`;
      if (k.help === 'or') continue;
      rows += `<div class="row"><span class="k">${keys}</span><span>${esc(k.help)}</span></div>`;
      keys = '';
    }
    return `<div class="grp"><div class="gh">${esc(g)}</div>${rows}</div>`;
  }).join('');
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
