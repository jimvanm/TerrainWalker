// The saved pieces of ground (Tools mode, N): every outline you pick up is
// kept here by its corners, so it can be taken in hand again after a reload,
// from anywhere, without going back to draw it. Kept in this browser
// (localStorage), like the saved places. The laid-down copies are not kept:
// a reload clears those.
//
// The panel sits where PLACES is, and shows in Tools mode instead of it.
// Click a name to take that piece in hand; double-click to rename; x deletes.

const KEY = 'tw.pieces';

const store = () => { try { return globalThis.localStorage || null; } catch (e) { return null; } };

export function loadPieces() {
  const s = store();
  if (!s) return [];
  try {
    const v = JSON.parse(s.getItem(KEY) || '[]');
    return Array.isArray(v) ? v.filter((p) => p && Array.isArray(p.corners) && p.corners.length >= 3) : [];
  } catch (e) { return []; }
}

export function savePieces(list) {
  const s = store();
  if (s) try { s.setItem(KEY, JSON.stringify(list)); } catch (e) { /* storage is a bonus */ }
}

// A new entry for an outline just picked up; returns it (with its name).
// cut: for a traced mountain, the height it is cut at.
export function addPiece(list, { corners, mode, name, cut }) {
  let n = list.length + 1;
  while (list.some((p) => p.name === 'Piece ' + n)) n++;
  const p = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: name || 'Piece ' + n, corners, mode };
  if (Number.isFinite(cut)) p.cut = cut;
  list.unshift(p);
  return p;
}

// The panel. take(piece) puts it in hand; draw() starts a new outline (N).
// search(text): Promise of mountains by that name (mountains.js); find(m, km)
// traces one within km of its summit and puts it in hand.
export function initPieces({ root, take, draw, search, find }) {
  let pieces = loadPieces();
  let open = true;
  let editing = null, armed = null, armTimer = 0;
  let query = '', results = [], status = '', reachKm = 15;
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };
  const commit = () => savePieces(pieces);

  function render() {
    root.textContent = '';
    const head = el('div', 'fhead');
    const title = el('button', 'ftitle', (open ? '▾' : '▸') + ' PIECES (' + pieces.length + ')');
    title.title = 'pieces of ground you have picked up';
    title.onclick = () => { open = !open; render(); };
    const add = el('button', 'fpin', '+ NEW');
    add.title = 'draw an outline to pick up (N)';
    add.onclick = () => draw();
    head.append(title, add);
    root.append(head);
    if (!open) return;

    // Find a mountain by name.
    if (search) {
      // The row is a 'field' (favourites.js): keys typed here, Tab included,
      // stay here. Tab goes box, reach, magnifying glass; Enter or Space on
      // the glass presses it.
      const row = el('div', 'frow fsearch');
      const inp = el('input', 'fname');
      inp.placeholder = 'Find a mountain...'; inp.value = query; inp.spellcheck = false; inp.maxLength = 60;
      const go = () => {
        if (!inp.value.trim()) return;
        query = inp.value.trim(); status = 'Looking up ' + query + '...'; results = []; render();
        search(query).then((r) => {
          results = r; status = r.length ? '' : 'Nothing by that name with a summit position.'; render();
        }).catch(() => { status = 'Could not reach Wikidata.'; render(); });
      };
      inp.onkeydown = (e) => {
        if (e.key === 'Escape') { inp.blur(); return; }
        if (e.key === 'Enter') go();
      };
      const reach = el('select', 'freach');
      for (const km of [5, 10, 15, 25, 50]) {
        const o = el('option', '', km + ' km'); o.value = String(km); if (km === reachKm) o.selected = true; reach.append(o);
      }
      reach.title = 'how far from the summit the outline may reach';
      reach.onchange = () => { reachKm = +reach.value; };
      const glass = el('button', 'fglass', '🔍');
      glass.title = 'find it';
      glass.onclick = go;
      // A mouse click does not leave the keys in the panel (W still flies).
      glass.onmousedown = (e) => e.preventDefault();
      row.append(inp, reach, glass);
      root.append(row);
      if (status) root.append(el('div', 'fempty', status));
      if (results.length) {
        const rl = el('div', 'flist');
        for (const m of results) {
          const b = el('button', 'fgo', m.name + (m.height ? '  ' + m.height + ' m' : ''));
          b.title = m.about || '';
          const about = el('div', 'fabout', m.about);
          b.onclick = () => {
            status = 'Tracing ' + m.name + ' (up to ' + reachKm + ' km)...'; results = []; render();
            find(m, reachKm).then((msg) => { status = msg || ''; render(); }).catch(() => { status = 'Could not trace it.'; render(); });
          };
          const wrap = el('div', 'fres'); wrap.append(b, about);
          rl.append(wrap);
        }
        root.append(rl);
      }
    }

    const list = el('div', 'flist');
    if (!pieces.length) list.append(el('div', 'fempty', 'None yet. Press N, click corners, Enter.'));
    for (const p of pieces) {
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
      go.title = 'take it in hand (double-click to rename)';
      go.onclick = () => take(p);
      go.ondblclick = () => { editing = p.id; render(); };
      const del = el('button', 'fdel' + (armed === p.id ? ' armed' : ''), armed === p.id ? 'sure?' : '×');
      del.title = 'delete';
      del.onclick = () => {
        if (armed === p.id) { pieces = pieces.filter((q) => q.id !== p.id); commit(); armed = null; render(); return; }
        armed = p.id; render();
        clearTimeout(armTimer);
        armTimer = setTimeout(() => { armed = null; render(); }, 2500);
      };
      row.append(go, del);
      list.append(row);
    }
    root.append(list);
  }

  render();
  // Called when a new outline is picked up: saved, and its name given back.
  const picked = (v) => { const p = addPiece(pieces, v); commit(); render(); return p.name; };
  // A found mountain: saved under its name; returns the entry, to take in hand.
  const added = (v) => { const p = addPiece(pieces, v); commit(); render(); return p; };
  return { render, picked, added };
}
