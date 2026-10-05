// Builds a landmark's shape and writes landmarks/<id>/model.json.
//   node tools/bake_landmark.mjs rogers     one landmark
//   node tools/bake_landmark.mjs all        every landmark in landmarks/index.json
// The builder is landmarks/<id>/build.mjs; it exports build(), returning a Mesh
// (tools/landmarks/mesh.mjs). Metres, y up, x east, z south, origin at the
// middle of the base.
import fs from 'node:fs';

const root = new URL('../landmarks/', import.meta.url);
const arg = process.argv[2];
if (!arg) { console.log('usage: node tools/bake_landmark.mjs <id> | all'); process.exit(1); }
const ids = arg === 'all' ? JSON.parse(fs.readFileSync(new URL('index.json', root), 'utf8')) : [arg];

for (const id of ids) {
  const dir = new URL(id + '/', root);
  const { build } = await import(new URL('build.mjs', dir));
  const m = build();
  const model = {
    tris: m.tris,
    pos: Array.from(m.pos, (v) => Math.round(v * 100) / 100),
    col: Array.from(m.col),
    idx: Array.from(m.idx),
  };
  const text = JSON.stringify(model) + '\n';
  fs.writeFileSync(new URL('model.json', dir), text);
  const top = Math.max(...model.pos.filter((_, i) => i % 3 === 1));
  console.log(`${id.padEnd(10)} ${String(m.tris).padStart(5)} triangles, top ${top.toFixed(1)} m, ${(text.length / 1024).toFixed(0)} KB`);
}
