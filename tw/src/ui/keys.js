// Every key the app answers to, in one table.
//
// The key menus (one per mode) are built from this table, so it cannot fall out of step with
// what the keys actually do. test/keys.mjs also checks that the README lists
// every key here.
//
// Two kinds of entry:
//   act   a one-shot action, run on key press. The name is looked up in the
//         actions object given to bindKeys().
//   hold  held keys read every frame by controls.js (movement). Listed here
//         only so they appear in the help.
//
// group: which heading of the key menu the entry goes under (GROUPS, in order).
// mode:  the mode the key works in: 'nav' or 'tools' (MODES). Left out, the
//        key works in both, and shows in both menus.

// The modes. Each has its own key menu; Tab swaps them. The names are only
// here, so renaming a mode (Tools -> Workshop, say) is one word.
export const MODES = [
  { id: 'nav', name: 'Navigation' },
  { id: 'tools', name: 'Tools' },
];
export const modeName = (id) => MODES.find((m) => m.id === id).name;

export const GROUPS = ['Mode', 'Mouse', 'Moving', 'Flying', 'Show / hide', 'Colours', 'Landmarks', 'Move ground', 'In hand', 'Places', 'Reports', 'Checking'];

export const KEYS = [
  { group: 'Mode', label: 'Tab', help: 'switch to Tools', code: 'Tab', act: 'switchMode', mode: 'nav' },
  { group: 'Mode', label: 'Tab', help: 'switch to Navigation', code: 'Tab', act: 'switchMode', mode: 'tools' },

  { group: 'Mouse', label: 'click', help: 'capture mouse', mode: 'nav' },
  { group: 'Mouse', label: 'esc', help: 'release mouse', mode: 'nav' },
  { group: 'Mouse', label: 'point', help: 'aim (the mouse is free here)', mode: 'tools' },
  { group: 'Mouse', label: 'right-drag', help: 'look around', mode: 'tools' },

  { group: 'Moving', label: 'WASD', help: 'move', hold: ['KeyW', 'KeyA', 'KeyS', 'KeyD'] },
  { group: 'Moving', label: 'Q/E', help: 'down / up', hold: ['KeyQ', 'KeyE'] },
  { group: 'Moving', label: 'shift', help: 'run', hold: ['ShiftLeft'] },
  { group: 'Moving', label: 'ctrl', help: 'boost (lock keys first)', hold: ['ControlLeft'] },
  { group: 'Moving', label: 'R', help: 'back to start', code: 'KeyR', act: 'reset', mode: 'nav' },

  { group: 'Flying', label: 'G', help: 'or', code: 'KeyG', act: 'toggleFly' },
  { group: 'Flying', label: 'space space', help: 'walk / fly' },
  { group: 'Flying', label: 'space/shift', help: 'up / down', hold: ['Space', 'ShiftLeft'] },
  { group: 'Flying', label: 'wheel', help: 'flying speed' },

  { group: 'Show / hide', label: 'V', help: 'water', code: 'KeyV', act: 'layer:water', mode: 'nav' },
  { group: 'Show / hide', label: 'X', help: 'roads', code: 'KeyX', act: 'layer:roads', mode: 'nav' },
  { group: 'Show / hide', label: 'B', help: 'buildings', code: 'KeyB', act: 'layer:built', mode: 'nav' },
  { group: 'Show / hide', label: 'C', help: 'ground cover', code: 'KeyC', act: 'layer:cover', mode: 'nav' },
  { group: 'Show / hide', label: 'T', help: 'landmarks', code: 'KeyT', act: 'layer:land', mode: 'nav' },
  { group: 'Show / hide', label: 'F', help: 'fog', code: 'KeyF', act: 'toggleFog', mode: 'nav' },
  { group: 'Show / hide', label: '0', help: 'water close by: flat / painted', code: 'Digit0', act: 'toggleFlatWater', mode: 'nav' },
  { group: 'Show / hide', label: 'J', help: "close-up ground: Canada's survey / usual", code: 'KeyJ', act: 'toggleSurvey', mode: 'nav' },

  { group: 'Colours', label: '5', help: 'building style: today / new look / Overture', code: 'Digit5', act: 'buildStyle', mode: 'nav' },
  { group: 'Colours', label: '6', help: 'real', code: 'Digit6', act: 'lookReal', mode: 'nav' },
  { group: 'Colours', label: '7', help: 'by type', code: 'Digit7', act: 'lookType', mode: 'nav' },
  { group: 'Colours', label: '8', help: 'colour set', code: 'Digit8', act: 'lookSet', mode: 'nav' },
  { group: 'Colours', label: '9', help: 'warm', code: 'Digit9', act: 'lookWarm', mode: 'nav' },

  { group: 'Landmarks', label: 'M', help: 'pick up a landmark (again: next, then off)', code: 'KeyM', act: 'dropCycle', mode: 'tools' },

  { group: 'Move ground', label: 'N', help: 'draw an outline (again: put it away)', code: 'KeyN', act: 'outline', mode: 'tools' },
  { group: 'Move ground', label: 'Backspace', help: 'take back a corner', code: 'Backspace', act: 'outlineUndo', mode: 'tools' },
  { group: 'Move ground', label: 'Enter', help: 'pick up the ground inside', code: 'Enter', act: 'outlineClose', mode: 'tools' },
  { group: 'Move ground', label: 'U', help: 'rise above its edge / above sea level (in hand, or pointed at)', code: 'KeyU', act: 'pieceHeight', mode: 'tools' },

  { group: 'In hand', label: 'click', help: 'drop it, or add a corner', mode: 'tools' },
  { group: 'In hand', label: 'click', help: 'with nothing in hand: pick up the one pointed at', mode: 'tools' },
  { group: 'In hand', label: ',', help: 'or', code: 'Comma', act: 'toolLeft', mode: 'tools' },
  { group: 'In hand', label: '.', help: 'turn it', code: 'Period', act: 'toolRight', mode: 'tools' },
  { group: 'In hand', label: 'Delete', help: 'remove the dropped one pointed at', code: 'Delete', act: 'toolRemove', mode: 'tools' },
  { group: 'In hand', label: 'Esc', help: 'put it away', code: 'Escape', act: 'toolCancel', mode: 'tools' },

  { group: 'Places', label: 'P', help: 'pin this place', code: 'KeyP', act: 'pin', mode: 'nav' },

  { group: 'Reports', label: 'K', help: 'copy height report', code: 'KeyK', act: 'heightReport' },
  { group: 'Reports', label: 'L', help: 'copy strain log', code: 'KeyL', act: 'strainLog' },
  { group: 'Reports', label: 'H', help: 'hide the menus and the graph', code: 'KeyH', act: 'toggleHelp' },

  { group: 'Checking', label: '1', help: 'grid', code: 'Digit1', act: 'debugGrid', mode: 'nav' },
  { group: 'Checking', label: '2', help: 'freeze', code: 'Digit2', act: 'freeze', mode: 'nav' },
  { group: 'Checking', label: '3', help: 'flat ground', code: 'Digit3', act: 'debugFlat', mode: 'nav' },
  { group: 'Checking', label: '4', help: 'buildings under landmarks', code: 'Digit4', act: 'toggleMask', mode: 'nav' },
];

export const inMode = (k, mode) => !k.mode || k.mode === mode;

const esc = (s) => s.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]);

// One mode's key menu: one heading per group, then one row per key: the key on
// the left, what it does on the right. An entry whose help is just "or" shares
// the next entry's row ("G or space space   walk / fly").
export function helpHtml(mode = 'nav') {
  return GROUPS.map((g) => {
    const ks = KEYS.filter((k) => k.group === g && inMode(k, mode));
    if (!ks.length) return '';
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

// Runs table actions on key press, for the keys of the current mode
// (getMode() says which). Auto-repeat and keys pressed with ctrl, alt or the
// command key are ignored, so holding a key toggles once, and ctrl shortcuts
// never flip a layer by accident. Tab would otherwise move the page's focus.
export function bindKeys(actions, target = window, getMode = () => 'nav') {
  const acts = KEYS.filter((k) => k.act);
  target.addEventListener('keydown', (e) => {
    if (e.repeat || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = acts.find((q) => q.code === e.code && inMode(q, getMode()));
    if (!k) return;
    if (['Tab', 'Backspace', 'Enter'].includes(e.code) && e.preventDefault) e.preventDefault();
    const [head, arg] = k.act.split(':');
    const fn = actions[head];
    if (fn) fn(arg, e);
  });
}
