// The "places" panel: pin where you are, name it, jump to it, star one as the
// start point, delete it. All the storage is in places.js.
//
// Keys: P pins the current view and lets you type a name. Typing in the panel
// never moves the camera (see the capture guard below).

import { loadPlaces, savePlaces, makePlace, setStart } from './places.js';

const isField = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'SELECT' ||
  (t.closest && !!t.closest('.fsearch')));     // the mountain search row, its button too

export function initFavourites({ root, getView, jump }) {
  let places = loadPlaces();
  let open = false;
  let editing = null;        // id of the place whose name is being typed
  let armed = null;          // id waiting for a second click to delete
  let armTimer = 0;

  // Keystrokes aimed at a text box (here or in the PIECES panel) stop at the
  // document, on their way up: the box itself gets them first (Enter, Esc),
  // and the camera controls and the keys, which listen on the window above,
  // never do. (Stopping them on the way down, as this once did, kept them
  // from the box too: Enter did nothing.)
  for (const type of ['keydown', 'keyup']) {
    document.addEventListener(type, (e) => { if (isField(e.target)) e.stopPropagation(); });
  }

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const commit = () => savePlaces(places);

  function render() {
    root.textContent = '';
    const head = el('div', 'fhead');
    const title = el('button', 'ftitle', (open ? '▾' : '▸') + ' PLACES (' + places.length + ')');
    title.title = 'saved places (P pins this spot)';
    title.onclick = () => { open = !open; render(); };
    const pin = el('button', 'fpin', '+ PIN');
    pin.title = 'save the current view (P)';
    pin.onclick = () => pinHere();
    head.append(title, pin);
    root.append(head);
    if (!open) return;

    const list = el('div', 'flist');
    if (!places.length) list.append(el('div', 'fempty', 'Nothing saved. Press P to pin this spot.'));
    for (const p of places) {
      const row = el('div', 'frow');
      if (editing === p.id) {
        const inp = el('input', 'fname');
        inp.value = p.name; inp.maxLength = 40; inp.spellcheck = false;
        const done = (save) => {
          if (editing !== p.id) return;
          editing = null;
          if (save && inp.value.trim()) { p.name = inp.value.trim(); commit(); }
          render();
        };
        inp.onkeydown = (e) => { if (e.key === 'Enter') done(true); else if (e.key === 'Escape') done(false); };
        inp.onblur = () => done(true);
        row.append(inp);
        list.append(row);
        setTimeout(() => { inp.focus(); inp.select(); }, 0);
        continue;
      }
      const go = el('button', 'fgo', p.name);
      go.title = 'go here (double-click to rename)';
      go.onclick = () => jump(p);
      go.ondblclick = () => { editing = p.id; render(); };
      const star = el('button', 'fstar' + (p.start ? ' on' : ''), p.start ? '★' : '☆');
      star.title = p.start ? 'this is your start point (click to clear)' : 'make this the start point';
      star.onclick = () => { setStart(places, p.id); commit(); render(); };
      const del = el('button', 'fdel' + (armed === p.id ? ' armed' : ''), armed === p.id ? 'sure?' : '×');
      del.title = 'delete';
      del.onclick = () => {
        if (armed === p.id) {
          places = places.filter((q) => q.id !== p.id); commit(); armed = null; render();
        } else {
          armed = p.id; render();
          clearTimeout(armTimer);
          armTimer = setTimeout(() => { armed = null; render(); }, 2500);
        }
      };
      row.append(go, star, del);
      list.append(row);
    }
    root.append(list);
  }

  function pinHere() {
    const v = getView();
    if (!v) return;
    const p = makePlace(v, 'Place ' + (places.length + 1));
    places.push(p); commit();
    open = true; editing = p.id;
    if (document.pointerLockElement) document.exitPointerLock();   // so you can type
    render();
  }

  render();
  return { render, pinHere };
}
