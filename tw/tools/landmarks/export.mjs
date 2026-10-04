import { TOWERS, CANTON_INFO } from './towers.mjs';
import fs from 'node:fs';

const out = {};
for (const t of TOWERS) {
  const m = t.build();
  const b = m.bounds;
  out[t.id] = { name: t.name, city: t.city, height: t.height, pos: m.pos, col: m.col, idx: m.idx, tris: m.tris, bounds: b };
  console.log(t.id.padEnd(10), 'tris', String(m.tris).padStart(4), 'verts', String(m.pos.length / 3).padStart(5),
    'top', b.max[1].toFixed(1), 'width', (b.max[0] - b.min[0]).toFixed(0), 'x', (b.max[2] - b.min[2]).toFixed(0));
}
console.log('Canton waist', CANTON_INFO);
fs.writeFileSync(new URL('./models.json', import.meta.url), JSON.stringify(out));
