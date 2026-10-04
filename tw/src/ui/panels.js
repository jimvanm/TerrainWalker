// The on-screen buttons: map layers, building colours, the movement pad and
// the view slider. Buttons run the same named actions as the keys (keys.js), so
// a button and its key can never do different things.
//
// build once with initPanels(); call the returned sync() every frame to light
// the buttons that are on.

import { LAYERS, settings } from '../settings.js';
import { LOOK, SETS } from '../look.js';
import { KEYS } from './keys.js';
import { LEVELS } from '../config.js';

const keyFor = (act) => {
  const k = KEYS.find((x) => x.act === act);
  return k ? ' (' + k.label + ')' : '';
};

// Building colour buttons. Lit means on; SET shows the colour set in use.
const COLOUR_BTNS = [
  { act: 'lookSet', label: () => 'SET: ' + SETS[LOOK.set].name.toUpperCase(), on: () => false,
    wide: true, title: 'next colour set' },
  { act: 'lookReal', label: () => 'REAL', on: () => LOOK.real,
    title: 'colours a mapper entered, where there are any' },
  { act: 'lookType', label: () => 'TYPE', on: () => LOOK.type,
    title: 'colour by building type: homes, shops, industry, schools, tall...' },
  { act: 'lookWarm', label: () => 'WARM', on: () => LOOK.warm,
    wide: true, title: 'warmer light on buildings' },
];

// actions: the same object handed to bindKeys().
// controls: for the hold buttons (up, down, boost) and the CAPTURE label.
export function initPanels(actions, controls, cam) {
  const head = (text) => {
    const h = document.createElement('div');
    h.className = 'panelhead';
    h.textContent = text;
    return h;
  };

  // ---- map layers ----
  // Toggling costs one uniform. Nothing is refetched and nothing is
  // re-rasterised, which is the whole reason the channels are kept separate.
  const layerPanel = document.getElementById('layers');
  const layerEls = [];
  for (const L of LAYERS) {
    const b = document.createElement('button');
    b.textContent = L.label;
    b.title = L.label.toLowerCase() + keyFor('layer:' + L.id);
    b.addEventListener('click', () => actions.layer(L.id));
    layerEls.push([L, b]);
    layerPanel.appendChild(b);
  }

  // ---- building colours ----
  const colourPanel = document.createElement('div');
  colourPanel.id = 'looks';
  colourPanel.className = 'grid';
  const colourEls = [];
  for (const C of COLOUR_BTNS) {
    const b = document.createElement('button');
    b.title = C.title + keyFor(C.act);
    if (C.wide) b.className = 'wide';
    b.addEventListener('click', () => actions[C.act]());
    colourEls.push([C, b]);
    colourPanel.appendChild(b);
  }
  layerPanel.before(head('MAP LAYERS'));
  layerPanel.after(head('BUILDING COLOURS'), colourPanel);

  // ---- movement pad ----
  // data-hold buttons act while pressed; data-act buttons run an action.
  const PAD_ACTS = { fly: 'toggleFly', fog: 'toggleFog', grab: 'grab', faster: 'faster', slower: 'slower' };
  const pad = document.getElementById('pad');
  const btnEls = {};
  pad.querySelectorAll('button').forEach((b) => {
    const hold = b.dataset.hold, act = b.dataset.act;
    if (hold) {
      btnEls[hold] = b;
      const on = (v) => (e) => { e.preventDefault(); controls.btn[hold] = v; };
      b.addEventListener('pointerdown', on(true));
      b.addEventListener('pointerup', on(false));
      b.addEventListener('pointerleave', on(false));
    } else {
      btnEls[act] = b;
      b.addEventListener('click', () => actions[PAD_ACTS[act]]());
    }
  });

  // ---- view slider ----
  const slider = document.getElementById('levels');
  slider.max = String(LEVELS.length);
  slider.value = String(settings.levels);
  slider.addEventListener('input', () => { settings.levels = +slider.value; });

  return function sync() {
    const k = controls.keys;
    btnEls.fly.classList.toggle('on', !!cam.fly);
    btnEls.fog.classList.toggle('on', settings.fog);
    btnEls.up.classList.toggle('on', controls.btn.up || k.has('KeyE') || k.has('Space'));
    btnEls.down.classList.toggle('on', controls.btn.down || k.has('KeyQ') || k.has('ShiftLeft'));
    btnEls.boost.classList.toggle('on', controls.btn.boost || k.has('ControlLeft'));
    btnEls.grab.classList.toggle('on', controls.kbLocked);
    btnEls.grab.textContent = controls.kbLocked ? 'KEYS LOCKED' : 'CAPTURE';
    for (const [L, b] of layerEls) b.classList.toggle('on', L.on);
    for (const [C, b] of colourEls) {
      const t = C.label();
      if (b.textContent !== t) b.textContent = t;
      b.classList.toggle('on', C.on());
    }
  };
}
