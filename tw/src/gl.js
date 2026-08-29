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

export const VS = `#version 300 es
precision highp float;

// x = local mercator east from tile centre, unscaled metres
// y = elevation above the ellipsoid, metres
// z = local mercator south from tile centre, unscaled metres
// w = 1 for skirt vertices, 0 for the surface
in vec4 aPos;

uniform mat4  uProj;
uniform mat4  uView;
uniform vec2  uTileOffset;   // (tileCentre - camera) in true metres
uniform float uScale;        // cos(camera latitude)
uniform float uCamAlt;
uniform float uCurv;         // 1 / (2 * earth radius), 0 disables
uniform float uSkirt;
uniform float uTileSize;    // tile width in unscaled mercator metres

out float vHeight;
out float vSkirt;
out vec3  vPos;
out vec2  vUV;

void main() {
  float x = aPos.x * uScale + uTileOffset.x;
  float z = aPos.z * uScale + uTileOffset.y;
  float y = aPos.y - uCamAlt - uSkirt * aPos.w;

  vHeight = aPos.y;
  vSkirt  = aPos.w;
  vPos    = vec3(x, y, z);
  // Positions are tile-local, so UV falls straight out of them. No extra
  // attribute, and skirt vertices inherit the UV of the edge they hang from.
  vUV     = aPos.xz / uTileSize + 0.5;

  // Drop distant terrain below the horizon. Without this you can see hundreds
  // of kilometres of ground that should be over the curve.
  float drop = (x * x + z * z) * uCurv;
  gl_Position = uProj * uView * vec4(x, y - drop, z, 1.0);
}`;

export const FS = `#version 300 es
precision highp float;

in float vHeight;
in float vSkirt;
in vec3  vPos;
in vec2  vUV;

uniform vec3  uFogColor;
uniform float uFogDensity;
uniform vec3  uSunDir;
uniform sampler2D uMask;    // R water, G roads, B built-up, A land-cover alpha
uniform sampler2D uCover;   // land-cover colour
uniform vec4  uLayers;      // on/off for water, roads, built-up, land cover
uniform float uDebug;       // 0 off, 1 tile grid + level tint
uniform float uLevel;

out vec4 frag;

vec3 hypso(float h) {
  if (h <= 0.5) return vec3(0.09, 0.20, 0.33);
  vec3 c;
  if      (h <   40.0) c = mix(vec3(0.79,0.74,0.55), vec3(0.42,0.55,0.30), h / 40.0);
  else if (h <  350.0) c = mix(vec3(0.42,0.55,0.30), vec3(0.31,0.46,0.24), (h -  40.0) / 310.0);
  else if (h <  900.0) c = mix(vec3(0.31,0.46,0.24), vec3(0.44,0.45,0.25), (h - 350.0) / 550.0);
  else if (h < 1600.0) c = mix(vec3(0.44,0.45,0.25), vec3(0.47,0.38,0.26), (h - 900.0) / 700.0);
  else if (h < 2400.0) c = mix(vec3(0.47,0.38,0.26), vec3(0.44,0.40,0.38), (h -1600.0) / 800.0);
  else if (h < 3000.0) c = mix(vec3(0.44,0.40,0.38), vec3(0.62,0.62,0.63), (h -2400.0) / 600.0);
  else                 c = mix(vec3(0.62,0.62,0.63), vec3(0.95,0.96,0.98),
                               clamp((h - 3000.0) / 900.0, 0.0, 1.0));
  return c;
}

void main() {
  // Flat shading straight from screen-space derivatives. No normal attribute,
  // no normal buffer, no smoothing decisions.
  vec3 dx = dFdx(vPos), dy = dFdy(vPos);
  vec3 n = cross(dx, dy);
  float len = length(n);
  n = len > 1e-9 ? n / len : vec3(0.0, 1.0, 0.0);
  if (n.y < 0.0) n = -n;

  float lit = 0.55 + 0.45 * max(dot(n, uSunDir), 0.0);
  // Derivatives are evaluated per 2x2 pixel quad, so a quad straddling the
  // surface-to-skirt seam sees a 150 m jump and produces a garbage normal —
  // a bright speckle that crawls along every tile edge as the camera moves.
  // fwidth() detects exactly those quads.
  lit = mix(lit, 0.72, max(vSkirt, step(0.001, fwidth(vSkirt))));

  vec3 c = hypso(vHeight) * lit;

  vec4 m = texture(uMask, vUV) * (1.0 - vSkirt);

  // Painted in cartographic order: ground cover, then what is built on it,
  // then water, which wins because it is the one thing that is never under
  // anything else.
  float cov = m.a * uLayers.w;
  c = mix(c, texture(uCover, vUV).rgb * lit, smoothstep(0.15, 0.55, cov));

  float built = m.b * uLayers.z;
  c = mix(c, vec3(0.46, 0.44, 0.42) * lit, smoothstep(0.2, 0.6, built) * 0.8);

  float road = m.g * uLayers.y;
  c = mix(c, vec3(0.80, 0.76, 0.68) * lit, smoothstep(0.25, 0.7, road) * 0.9);

  // Elevation alone can never know this: Lake Superior is at 183 m and would
  // otherwise read as a hillside.
  float wet = m.r * uLayers.x;
  vec3 deep = mix(vec3(0.16, 0.34, 0.52), vec3(0.09, 0.20, 0.33),
                  clamp(vHeight / 400.0, 0.0, 1.0));
  c = mix(c, deep * (0.82 + 0.18 * lit), smoothstep(0.35, 0.65, wet));

  float d = length(vPos);
  float f = clamp(1.0 - exp(-pow(d * uFogDensity, 2.0)), 0.0, 1.0);
  c = mix(c, uFogColor, f);

  // Quantise to 5 bits per channel. A deliberate look, and it hides the
  // banding that a smooth ramp would show anyway.
  c = floor(c * 31.0 + 0.5) / 31.0;
  if (uDebug > 1.5) {
    // Flat mode: no textures, no derivative lighting, one solid colour per
    // level. If squares still flash here, the cause is geometry or depth, not
    // anything sampled or shaded.
    vec3 t = 0.5 + 0.5 * cos(6.2831 * (uLevel / 9.0) + vec3(0.0, 2.1, 4.2));
    frag = vec4(t * (0.6 + 0.4 * vSkirt), 1.0);
    return;
  }
  if (uDebug > 0.5) {
    // Tile grid and per-level tint, so a screenshot shows whether an artefact
    // lines up with tile edges and which LOD level owns it.
    vec3 tint = 0.5 + 0.5 * cos(6.2831 * (uLevel / 9.0) + vec3(0.0, 2.1, 4.2));
    c = mix(c, tint, 0.30);
    vec2 g = min(vUV, 1.0 - vUV);
    float edge = 1.0 - smoothstep(0.0, max(fwidth(vUV.x), fwidth(vUV.y)) * 1.5,
                                  min(g.x, g.y));
    c = mix(c, vec3(1.0, 0.0, 1.0), edge * 0.9);
  }
  frag = vec4(c, 1.0);
}`;
