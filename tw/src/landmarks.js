// Landmarks: a few famous towers, drawn as small solid models at true size.
// They are drawn like the near field (camera-relative, same curve drop, same
// shading) but are never fetched and never culled by distance: the Earth's
// curve hides them when they are over the horizon, which is the right rule.
import * as G from './gl.js';
import { FS } from './nearfield.js';
import { lonToMercX, latToMercY, mercScale } from './geo.js';
import { MODELS } from './landmark_models.js';
import { SITES } from './landmark_sites.js';

// Same as the near field's vertex shader, except the model is scaled by its OWN
// latitude (uModelK), not the camera's, so a tower seen from far away keeps its shape.
const VS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec4 aCol;
uniform mat4  uProj;
uniform mat4  uView;
uniform vec2  uTileOffset;
uniform float uModelK;
uniform float uCamAlt;
uniform float uCurv;
out vec3 vPos;
out vec3 vCol;
void main() {
  float x = aPos.x + uTileOffset.x;
  float z = aPos.z + uTileOffset.y;
  float y = aPos.y - uCamAlt;
  vPos = vec3(x, y, z);
  vCol = aCol.rgb;
  float drop = (x * x + z * z) * uCurv;
  gl_Position = uProj * uView * vec4(x, y - drop, z, 1.0);
}`;

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
    f[i * 4] = x * c + z * s;
    f[i * 4 + 1] = y;
    f[i * 4 + 2] = -x * s + z * c;
    b[i * 16 + 12] = model.col[i * 3];
    b[i * 16 + 13] = model.col[i * 3 + 1];
    b[i * 16 + 14] = model.col[i * 3 + 2];
    b[i * 16 + 15] = 255;
  }
  return { vertices: buf, indices: new Uint32Array(model.idx) };
}

export class Landmarks {
  constructor(gl) {
    this.gl = gl;
    this.prog = G.program(gl, VS, FS);
    this.u = {};
    for (const n of ['uProj', 'uView', 'uTileOffset', 'uModelK', 'uCamAlt', 'uCurv', 'uSunDir']) {
      this.u[n] = gl.getUniformLocation(this.prog, n);
    }
    const aPos = gl.getAttribLocation(this.prog, 'aPos');
    const aCol = gl.getAttribLocation(this.prog, 'aCol');
    this.items = LANDMARKS.map((L) => {
      const model = MODELS[L.id];
      const { vertices, indices } = buildVertices(model, L.yawDeg);
      const vao = gl.createVertexArray(), vbo = gl.createBuffer(), ibo = gl.createBuffer();
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
      gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 3, gl.FLOAT, false, 16, 0);
      gl.enableVertexAttribArray(aCol);
      gl.vertexAttribPointer(aCol, 4, gl.UNSIGNED_BYTE, true, 16, 12);
      gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
      gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
      gl.bindVertexArray(null);
      return {
        ...L, vao, count: indices.length, height: model.height,
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

  // Draws every tower whose ground is known. `restore` is the program to hand back.
  draw(restore, proj, view, camAlt, camMercX, camMercY, curv, k) {
    const gl = this.gl, u = this.u;
    gl.useProgram(this.prog);
    gl.uniformMatrix4fv(u.uProj, false, proj);
    gl.uniformMatrix4fv(u.uView, false, view);
    gl.uniform1f(u.uCurv, curv);
    gl.uniform3f(u.uSunDir, 0.40, 0.82, 0.41);
    for (const it of this.items) {
      if (it.base === null) continue;
      gl.uniform1f(u.uModelK, it.k);
      // Height is relative to the tower's own base: shift the camera, not the model.
      gl.uniform1f(u.uCamAlt, camAlt - it.base);
      // Offset uses the camera's scale, exactly like tile offsets do.
      gl.uniform2f(u.uTileOffset, (it.mx - camMercX) * k, (camMercY - it.my) * k);
      gl.bindVertexArray(it.vao);
      gl.drawElements(gl.TRIANGLES, it.count, gl.UNSIGNED_INT, 0);
    }
    gl.useProgram(restore);
  }

  report(camMercX, camMercY, k) {
    return this.items.map((it) => ({
      name: it.name, ground: it.base === null ? null : Math.round(it.base + SINK),
      km: +(Math.hypot((it.mx - camMercX) * k, (it.my - camMercY) * k) / 1000).toFixed(1),
    }));
  }
}
