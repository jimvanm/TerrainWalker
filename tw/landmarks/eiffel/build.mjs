// Builds this landmark's shape. Writes model.json via:  node tools/bake_landmark.mjs <id>
import fs from 'node:fs';
import { Mesh, interp, sq } from '../../tools/landmarks/shared.mjs';

// ---------- 5. Eiffel Tower, Paris (330 m with antenna) ----------
// Shape measured (see profile.json), sizes anchored to published numbers.
const EP = JSON.parse(fs.readFileSync(new URL('./profile.json', import.meta.url), 'utf8'));
export function build() {
  const m = new Mesh();
  const B1 = [112, 88, 62], B2 = [130, 105, 76], B3 = [152, 126, 92];
  const shade = (z) => (z < 60 ? B1 : z < 160 ? B2 : B3);
  // four curved legs: [z, centre offset, width]
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    const layers = EP.legs.map(([z, c, w]) => ({ y: z, pts: sq(sx * c, sz * c, w), c: shade(z) }));
    m.loftPts(layers, { capBottom: true });
    // stepped foot plinth under each leg
    const F = EP.foot;
    m.box(sx * F.centre, F.h1 / 2, sz * F.centre, F.w1, F.h1, F.w1, B1);
    m.box(sx * F.centre, F.h1 + F.h2 / 2, sz * F.centre, F.w2, F.h2, F.w2, B1);
  }
  // one solid tapering column above the second platform (the four legs merge there)
  m.loftPts(EP.shaft.map(([z, h]) => ({ y: z, pts: sq(0, 0, 2 * h), c: shade(z) })));
  // light belt under the first platform
  m.box(0, (EP.belt.z0 + EP.belt.z1) / 2, 0, 2 * EP.belt.half, EP.belt.z1 - EP.belt.z0, 2 * EP.belt.half, B1);
  // platforms
  for (const p of EP.slabs) m.box(0, (p.z0 + p.z1) / 2, 0, 2 * p.half, p.z1 - p.z0, 2 * p.half, shade(p.z0));
  // lantern and antenna
  m.loftPts(EP.lantern.map(([z, h]) => ({ y: z, pts: sq(0, 0, 2 * h), c: B3 })));
  const sp = EP.spire;
  m.tube([0, sp[0], 0], [0, sp[1], 0], sp[2] / 2, sp[3] / 2, B3, 4);
  // the four base arches (half-ellipse ribbons)
  const { a, b, zc, thick, depth, ycentre } = EP.arch;
  const NSEG = 12;
  const I = [], O = [];
  for (let i = 0; i <= NSEG; i++) {
    const t = (Math.PI * i) / NSEG;
    I.push([a * Math.cos(t), zc + b * Math.sin(t)]);
    O.push([(a + thick) * Math.cos(t), zc + (b + thick) * Math.sin(t)]);
  }
  for (let sd = 0; sd < 4; sd++) {
    const ang = (Math.PI / 2) * sd, ca = Math.cos(ang), sa = Math.sin(ang);
    const W = (u, z, yy) => { const x = u, zz = interp(EP.legs, z, 1) + yy; return [x * ca - zz * sa, z, x * sa + zz * ca]; };
    for (let i = 0; i < NSEG; i++) {
      const pts = (arr, yy) => [W(arr[i][0], arr[i][1], yy), W(arr[i + 1][0], arr[i + 1][1], yy)];
      const [i0f, i1f] = pts(I, depth / 2), [o0f, o1f] = pts(O, depth / 2);
      const [i0b, i1b] = pts(I, -depth / 2), [o0b, o1b] = pts(O, -depth / 2);
      const q = (p, qq, r, s2) => { const ids = [p, qq, r, s2].map((v) => m.v(v[0], v[1], v[2], B1)); m.idx.push(ids[0], ids[1], ids[2], ids[0], ids[2], ids[3]); };
      q(i0f, i1f, o1f, o0f);   // front face
      q(i0b, i1b, o1b, o0b);   // back face
      q(i0f, i1f, i1b, i0b);   // underside
      q(o0f, o1f, o1b, o0b);   // top side
    }
  }
  return m;
}
