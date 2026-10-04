// Landmarks: a few famous towers, drawn as small solid models at true size.
// They are drawn like the near field (camera-relative, same curve drop, same
// shading) but are never fetched and never culled by distance: the Earth's
// curve hides them when they are over the horizon, which is the right rule.
import { lonToMercX, latToMercY, mercScale, wrapMercDx } from './geo.js';
import { MODELS } from './landmark_models.js';
import { SITES } from './landmark_sites.js';
import { hull, polygonArea, edgesOf, dominantBearing, suggestYaw, ovalAxis, wrapTo } from './orient.js';

export const LANDMARKS = SITES;
const SINK = 6;   // metres below the ground sample, so a sloping site never shows a gap

// Interleaved 16-byte vertices (float32 xyz + RGBA8), same layout as the near field.
// x and z come out in TRUE metres, y is height above the base.
export function buildVertices(model, yawDeg = 0) {
  const n = model.pos.length / 3;
  const buf = new ArrayBuffer(n * 16);
  const f = new Float32Array(buf), b = new Uint8Array(buf);
  const c = Math.cos(yawDeg * Math.PI / 180), s = Math.sin(yawDeg * Math.PI / 180);
  for (let i = 0; i < n; i++) {
    const x = model.pos[i * 3], y = model.pos[i * 3 + 1], z = model.pos[i * 3 + 2];
    // x is east, z is south. A positive yaw turns the model clockwise seen from above.
    f[i * 4] = x * c - z * s;
    f[i * 4 + 1] = y;
    f[i * 4 + 2] = x * s + z * c;
    b[i * 16 + 12] = model.col[i * 3];
    b[i * 16 + 13] = model.col[i * 3 + 1];
    b[i * 16 + 14] = model.col[i * 3 + 2];
    b[i * 16 + 15] = 255;
  }
  return { vertices: buf, indices: new Uint32Array(model.idx) };
}

export class Landmarks {
  // mesh: the shared MeshProgram (meshprogram.js). Landmark vertices are
  // already in true metres, so they are drawn with uScale = 1.
  constructor(gl, mesh) {
    this.gl = gl;
    this.mesh = mesh;
    this.items = LANDMARKS.map((L) => {
      const model = MODELS[L.id];
      const { vertices, indices } = buildVertices(model, L.yawDeg);
      const { vao } = mesh.buffers(vertices, indices, null);
      // Ground footprint in [east, north] metres, before any yaw, for orient.js.
      const foot = [];
      for (let i = 0; i < model.pos.length; i += 3) if (model.pos[i + 1] < 4) foot.push([model.pos[i], -model.pos[i + 2]]);
      const fh = hull(foot);
      return {
        ...L, vao, count: indices.length, height: model.height, footprint: fh,
        mx: lonToMercX(L.lon), my: latToMercY(L.lat), k: mercScale(L.lat),
        base: null,   // ground height, filled in once that terrain has loaded
      };
    });
  }

  // Ground height is only known once the terrain under the tower has loaded.
  update(heightAt) {
    for (const it of this.items) {
      if (it.base === null) {
        const h = heightAt(it.mx, it.my);
        if (h !== null && h !== undefined) it.base = h - SINK;
      }
    }
  }

  get resolved() { return this.items.filter((it) => it.base !== null).length; }

  // Draws every tower whose ground is known. The mesh program must already be
  // in use for this pass; uScale and uCamAlt are changed here, so landmarks are
  // drawn last.
  draw(pass) {
    const gl = this.gl, u = this.mesh.u;
    gl.uniform1f(u.uScale, 1);
    for (const it of this.items) {
      if (it.base === null) continue;
      // Height is relative to the tower's own base: shift the camera, not the model.
      gl.uniform1f(u.uCamAlt, pass.alt - it.base);
      // Offset uses the camera's scale, exactly like tile offsets do.
      // The camera's longitude can have wrapped past 180, so take the nearest copy of the tower.
      gl.uniform2f(u.uTileOffset, wrapMercDx(it.mx - pass.mercX) * pass.k, (pass.mercY - it.my) * pass.k);
      gl.bindVertexArray(it.vao);
      gl.drawElements(gl.TRIANGLES, it.count, gl.UNSIGNED_INT, 0);
    }
  }

  // What the map's building outlines say about each tower's heading. `outlines` are
  // the { id, area, edges } records gathered from the loaded tiles. Prints a suggested
  // yaw per tower; the number is then copied into landmark_sites.js.
  orientation(outlines) {
    return this.items.map((it) => {
      const modelEdges = edgesOf(it.footprint), modelArea = Math.round(polygonArea(it.footprint));
      const own = dominantBearing(modelEdges, it.fold);
      const seen = [];
      for (const o of outlines.filter((q) => q.id === it.id && q.edges.length >= 12)) {
        if (seen.some((q) => Math.abs(q.area - o.area) <= 0.02 * Math.max(q.area, 1))) continue;   // same building in a second tile
        let sg;
        if (it.oval) {      // an oval has no straight edges: use the long axis, and how stretched the outline is
          const pts = []; for (let i = 0; i < o.edges.length; i += 4) pts.push([o.edges[i], o.edges[i + 1]]);
          const ax = ovalAxis(pts), mo = ovalAxis(it.footprint);
          sg = { yaw: wrapTo(ax.bearing - mo.bearing, 180), mapStrength: Math.min(1, (ax.stretch - 1) * 3) };
          seen.push({ area: o.area, strength: +sg.mapStrength.toFixed(2), yaw: +sg.yaw.toFixed(1), stretch: +ax.stretch.toFixed(2) });
          continue;
        }
        sg = suggestYaw(modelEdges, o.edges, it.fold);
        seen.push({ area: o.area, strength: +sg.mapStrength.toFixed(2), yaw: it.fold ? +sg.yaw.toFixed(1) : null });
      }
      seen.sort((a, b) => Math.abs(Math.log((a.area + 1) / (modelArea + 1))) - Math.abs(Math.log((b.area + 1) / (modelArea + 1))));
      const good = seen.find((c) => c.strength >= 0.3);
      return {
        name: it.name, storedYawDeg: it.yawDeg, fold: it.fold, modelFootprintM2: modelArea,
        modelEdgeStrength: +own.strength.toFixed(2),
        outlines: seen.slice(0, 4).map((c) => ({ m2: c.area, edgeStrength: c.strength, yawDeg: c.yaw, ...(c.stretch ? { stretch: c.stretch } : {}) })),
        suggestedYawDeg: good && it.fold ? good.yaw : null,
        note: !it.fold ? 'round footprint: the outline gives no direction, needs an outside cue'
          : !seen.length ? 'no map outline touched this tower (not loaded yet, or the map has none)'
          : !good ? 'outlines found but none has clear straight edges' : 'closest-sized outline with clear edges',
      };
    });
  }

  report(camMercX, camMercY, k) {
    return this.items.map((it) => ({
      name: it.name, ground: it.base === null ? null : Math.round(it.base + SINK),
      km: +(Math.hypot(wrapMercDx(it.mx - camMercX) * k, (it.my - camMercY) * k) / 1000).toFixed(1),
    }));
  }
}
