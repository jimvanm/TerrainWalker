// Builds this landmark's shape. Writes model.json via:  node tools/bake_landmark.mjs <id>
import fs from 'node:fs';
import { Mesh, CONCRETE, CONCRETE_DK, GLASS, WHITE, SILVER, RED, R } from '../../tools/landmarks/shared.mjs';

// ---------- 1. CN Tower, Toronto (553.3 m) ----------
// Pod, upper shaft, SkyPod and mast are measured (profile.json).
// That model has a straight lower shaft, so 'flared' adds a smooth flare that is only an ESTIMATE.
const CP = JSON.parse(fs.readFileSync(new URL('./profile.json', import.meta.url), 'utf8'));
export function build() {
  const m = new Mesh();
  const col = { c: CONCRETE, d: CONCRETE_DK, g: GLASS, w: WHITE, s: SILVER, r: RED };
  // round-ish core (hexagonal) up to the pod
  m.loft([R(0, CP.core_r, CONCRETE_DK), R(3, CP.core_r, CONCRETE), R(326, CP.core_r, CONCRETE)], 6, { capBottom: true });
  // three tapering wings (the Y-shaped legs), long at the ground and merging into the core
  const W = CP.wing;
  for (const deg of W.angles_deg) {
    const phi = (deg * Math.PI) / 180, dx = Math.cos(phi), dz = Math.sin(phi), px = -dz, pz = dx, t = W.thick;
    const fin = (L) => [[-t / 2 * px, -t / 2 * pz], [L * dx - t / 2 * px, L * dz - t / 2 * pz], [L * dx + t / 2 * px, L * dz + t / 2 * pz], [t / 2 * px, t / 2 * pz]];
    m.loftPts(W.tips.map(([y, L], i) => ({ y: y + (i === 0 ? 0 : 0), pts: fin(L), c: i < 2 ? CONCRETE_DK : CONCRETE })), { capTop: true, capBottom: true });
  }
  // pod
  m.loft(CP.pod.map(([y, r, c]) => R(y, r, col[c])), 28);
  // upper shaft
  m.loft(CP.upper_shaft.map(([y, r]) => R(y, r, CONCRETE)), 6);
  // SkyPod
  m.loft(CP.skypod.map(([y, r, c]) => R(y, r, col[c])), 12);
  // mast
  m.loft(CP.spire.map(([y, r]) => R(y, r, WHITE)), 6);
  return m;
}
