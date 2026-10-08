// The one shader program for everything standing on the ground: road ribbons,
// buildings, the skyline and landmarks. Compiled once and shared.
//
// Vertex layout (16 bytes, interleaved): float32 x, y, z, then RGBA8 colour.
// Buildings add a second buffer of RGBA8 facts (aInfo); see meshbuilder.js.

import * as G from './gl.js';
import { MESH_VS, MESH_FS } from './shaders.js';
import { settings } from './settings.js';
import { lookBits, setUniform, TYPE_UNIFORM, ROOF_UNIFORM, AUTO_WALL_UNIFORM, AUTO_ROOF_UNIFORM } from './look.js';
import { FACADE, MODE, regionUniforms } from './facade.js';

const SKY = [0.62, 0.74, 0.86];          // what the glass reflects
const DEFAULT_REGION = regionUniforms('north_america');

export class MeshProgram {
  constructor(gl) {
    this.gl = gl;
    this.prog = G.program(gl, MESH_VS, MESH_FS);
    this.u = G.uniforms(gl, this.prog, ['uProj', 'uView', 'uTileOffset', 'uScale', 'uCamAlt', 'uCurv',
      'uSunDir', 'uPal', 'uType', 'uRoof', 'uAutoWall', 'uAutoRoof', 'uLook',
      'uWall', 'uRoofC', 'uFrame', 'uReg', 'uSky', 'uMode', 'uF1', 'uF2']);
    this.aPos = gl.getAttribLocation(this.prog, 'aPos');
    this.aCol = gl.getAttribLocation(this.prog, 'aCol');
    this.aInfo = gl.getAttribLocation(this.prog, 'aInfo');
    this.aFac = gl.getAttribLocation(this.prog, 'aFac');   // new look only (facade.js)
    this.aSty = gl.getAttribLocation(this.prog, 'aSty');
    this.region = null;
  }

  // Make this the current program and set what is the same for every mesh this pass.
  use(pass) {
    const gl = this.gl, u = this.u;
    gl.useProgram(this.prog);
    G.setCamera(gl, u, pass);
    gl.uniform1f(u.uScale, pass.k);
    gl.uniform3fv(u.uPal, setUniform());
    gl.uniform3fv(u.uType, TYPE_UNIFORM);
    gl.uniform3fv(u.uRoof, ROOF_UNIFORM);
    gl.uniform3fv(u.uAutoWall, AUTO_WALL_UNIFORM);
    gl.uniform3fv(u.uAutoRoof, AUTO_ROOF_UNIFORM);
    gl.uniform1i(u.uLook, lookBits() | (settings.showMasked ? 16 : 0));
    // Meshes without a facts buffer read this constant: all zero = use aCol.
    if (this.aInfo >= 0) gl.vertexAttrib4f(this.aInfo, 0, 0, 0, 0);
    // The new look: meshes without its buffers read zeros, which turn it off.
    if (this.aFac >= 0) gl.vertexAttrib4f(this.aFac, 0, 0, 0, 0);
    if (this.aSty >= 0) gl.vertexAttrib4f(this.aSty, 0, 0, 0, 0);
    gl.uniform3f(u.uSky, SKY[0], SKY[1], SKY[2]);
    gl.uniform1i(u.uMode, MODE.windows | MODE.ledges | MODE.contact);
    gl.uniform4f(u.uF1, FACADE.floor, FACADE.houseFloor, FACADE.ground, FACADE.gap);
    gl.uniform4f(u.uF2, FACADE.size, FACADE.tower, FACADE.shine, 0);
    this.region = null;
    this.setRegion(DEFAULT_REGION);
  }

  // The regional colours for what is drawn next (facade.js regionUniforms).
  setRegion(r) {
    if (!r || r === this.region) return;
    const gl = this.gl, u = this.u;
    gl.uniform3fv(u.uWall, r.wall);
    gl.uniform3fv(u.uRoofC, r.roof);
    gl.uniform3fv(u.uFrame, r.frame);
    gl.uniform4fv(u.uReg, r.extra);
    this.region = r;
  }

  // GPU buffers for one mesh. info (optional) is the per-vertex facts buffer;
  // fac and sty (optional) the new look's wall positions and style bytes.
  buffers(vertices, indices, info, fac = null, sty = null) {
    const gl = this.gl;
    const b = { count: indices.length, vao: null, vbo: null, ibo: null, ivbo: null };
    if (!b.count) return b;
    b.vao = gl.createVertexArray();
    b.vbo = gl.createBuffer();
    b.ibo = gl.createBuffer();
    gl.bindVertexArray(b.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, b.vbo);
    gl.bufferData(gl.ARRAY_BUFFER, vertices, gl.STATIC_DRAW);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.aCol);
    gl.vertexAttribPointer(this.aCol, 4, gl.UNSIGNED_BYTE, true, 16, 12);
    if (this.aInfo >= 0) {
      if (info && info.length) {
        b.ivbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b.ivbo);
        gl.bufferData(gl.ARRAY_BUFFER, info, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.aInfo);
        gl.vertexAttribPointer(this.aInfo, 4, gl.UNSIGNED_BYTE, true, 4, 0);
      } else gl.disableVertexAttribArray(this.aInfo);   // reads the constant set in use(): zero
    }
    if (this.aFac >= 0) {
      if (fac && fac.length) {
        b.fvbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b.fvbo);
        gl.bufferData(gl.ARRAY_BUFFER, fac, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.aFac);
        gl.vertexAttribPointer(this.aFac, 4, gl.FLOAT, false, 16, 0);
      } else gl.disableVertexAttribArray(this.aFac);
    }
    if (this.aSty >= 0) {
      if (sty && sty.length) {
        b.svbo = gl.createBuffer();
        gl.bindBuffer(gl.ARRAY_BUFFER, b.svbo);
        gl.bufferData(gl.ARRAY_BUFFER, sty, gl.STATIC_DRAW);
        gl.enableVertexAttribArray(this.aSty);
        gl.vertexAttribPointer(this.aSty, 4, gl.UNSIGNED_BYTE, true, 4, 0);
      } else gl.disableVertexAttribArray(this.aSty);
    }
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, b.ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, indices, gl.STATIC_DRAW);
    gl.bindVertexArray(null);
    return b;
  }

  freeBuffers(b) {
    if (!b || !b.vao) return;
    const gl = this.gl;
    gl.deleteVertexArray(b.vao); gl.deleteBuffer(b.vbo); gl.deleteBuffer(b.ibo);
    if (b.ivbo) gl.deleteBuffer(b.ivbo);
    if (b.fvbo) gl.deleteBuffer(b.fvbo);
    if (b.svbo) gl.deleteBuffer(b.svbo);
  }
}
