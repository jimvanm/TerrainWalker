// Builds the draft towers (drafts.mjs) and writes drafts.json, for looking at
// them with the measuring scripts. Measured landmarks are baked with
// tools/bake_landmark.mjs into their own folder instead.
//   node tools/landmarks/export.mjs
import fs from 'node:fs';
import { DRAFTS, CANTON_INFO } from './drafts.mjs';

const out = {};
for (const t of DRAFTS) {
  const m = t.build();
  const b = m.bounds;
  out[t.id] = { name: t.name, city: t.city, height: t.height, pos: m.pos, col: m.col, idx: m.idx, tris: m.tris, bounds: b };
  console.log(t.id.padEnd(13), 'tris', String(m.tris).padStart(4), 'verts', String(m.pos.length / 3).padStart(5),
    'top', b.max[1].toFixed(1), 'width', (b.max[0] - b.min[0]).toFixed(0), 'x', (b.max[2] - b.min[2]).toFixed(0));
}
console.log('Canton draft waist', CANTON_INFO);
fs.writeFileSync(new URL('./drafts.json', import.meta.url), JSON.stringify(out));
