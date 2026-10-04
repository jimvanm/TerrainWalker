// Minimal WebGL2 helpers. No libraries.

export function fail(msg) {
  const el = document.getElementById('error');
  el.textContent = msg;
  el.style.display = 'block';
  throw new Error(msg);
}

function compile(gl, type, src, label) {
  const sh = gl.createShader(type);
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) {
    fail(label + ' shader failed:\n' + gl.getShaderInfoLog(sh));
  }
  return sh;
}

export function program(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs, 'vertex'));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs, 'fragment'));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    fail('link failed:\n' + gl.getProgramInfoLog(p));
  }
  return p;
}

// Column-major 4x4, the layout uniformMatrix4fv expects with transpose = false.
export function perspective(out, fovyRad, aspect, near, far) {
  const f = 1 / Math.tan(fovyRad / 2);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) / (near - far);
  out[11] = -1;
  out[14] = (2 * far * near) / (near - far);
  return out;
}

// View matrix for an eye fixed at the origin. Camera-relative rendering means
// the translation is folded into the per-tile offset uniform instead, in
// double precision on the CPU, which keeps float32 vertex data accurate.
export function viewRot(out, yaw, pitch) {
  const cp = Math.cos(pitch), sp = Math.sin(pitch);
  const fx = cp * Math.sin(yaw), fy = sp, fz = -cp * Math.cos(yaw);
  // right = normalize(cross(forward, (0,1,0))) = normalize((-fz, 0, fx))
  let sx = -fz, sz = fx;
  const sl = Math.hypot(sx, sz) || 1;
  sx /= sl; sz /= sl;
  const sy = 0;
  // up = cross(right, forward)
  const ux = sy * fz - sz * fy;
  const uy = sz * fx - sx * fz;
  const uz = sx * fy - sy * fx;
  out[0] = sx; out[1] = ux; out[2] = -fx; out[3] = 0;
  out[4] = sy; out[5] = uy; out[6] = -fy; out[7] = 0;
  out[8] = sz; out[9] = uz; out[10] = -fz; out[11] = 0;
  out[12] = 0; out[13] = 0; out[14] = 0; out[15] = 1;
  return out;
}

// The sun, shared by every shader so terrain and buildings are lit alike.
export const SUN_DIR = [0.40, 0.82, 0.41];

// Camera uniforms every program has (see CAMERA in shaders.js). pass is the
// per-pass camera built in main.js.
export function setCamera(gl, u, pass) {
  gl.uniformMatrix4fv(u.uProj, false, pass.proj);
  gl.uniformMatrix4fv(u.uView, false, pass.view);
  gl.uniform1f(u.uCamAlt, pass.alt);
  gl.uniform1f(u.uCurv, pass.curv);
  gl.uniform3f(u.uSunDir, SUN_DIR[0], SUN_DIR[1], SUN_DIR[2]);
}

// Uniform locations by name, for a list of names.
export function uniforms(gl, prog, names) {
  const u = {};
  for (const n of names) u[n] = gl.getUniformLocation(prog, n);
  return u;
}
