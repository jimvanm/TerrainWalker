// All the GLSL in one place.
//
// Two programs:
//   TERRAIN  the ground: height-coloured tiles with painted water, roads, land cover
//   MESH     everything standing on it: road ribbons, buildings, skyline, landmarks
//
// Both place vertices the same way (CAMERA below): positions arrive relative to
// the camera in true metres, and the earth's curve drops distant points below
// the horizon.

import { FACADE_VS, FACADE_FS } from './facade.js';

export const CAMERA = `
uniform mat4  uProj;
uniform mat4  uView;
uniform float uCamAlt;       // camera height above sea level
uniform float uCurv;         // 1 / (2 * earth radius); 0 makes the earth flat
// p: east, up, south in true metres, relative to the camera.
vec4 toClip(vec3 p) {
  // Drop distant points below the horizon. Without this you can see hundreds
  // of kilometres of ground that should be over the curve.
  float drop = dot(p.xz, p.xz) * uCurv;
  return uProj * uView * vec4(p.x, p.y - drop, p.z, 1.0);
}`;

export const TERRAIN_VS = `#version 300 es
precision highp float;

// x = local mercator east from tile centre, unscaled metres
// y = elevation above the ellipsoid, metres
// z = local mercator south from tile centre, unscaled metres
// w = 1 for skirt vertices, 0 for the surface
in vec4 aPos;

${CAMERA}
uniform vec2  uTileOffset;   // (tileCentre - camera) in true metres
uniform float uScale;        // cos(camera latitude)
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

  gl_Position = toClip(vPos);
}`;

export const TERRAIN_FS = `#version 300 es
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
uniform vec4  uNearRect;    // camera-relative minX, minZ, maxX, maxZ where real road geometry is drawn

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
  // Where real road geometry is drawn the painted road must not also show: it
  // is a fat halo around the true ribbon. Decided per area, not by distance.
  vec2 rp = vPos.xz;
  float inRect = step(uNearRect.x, rp.x) * step(rp.x, uNearRect.z) *
                 step(uNearRect.y, rp.y) * step(rp.y, uNearRect.w);
  road *= 1.0 - inRect;
  // Asphalt grey, close to the real ribbons, so the handover is not a colour jump.
  c = mix(c, vec3(0.37, 0.37, 0.39) * lit, smoothstep(0.25, 0.7, road) * 0.9);

  // Elevation alone can never know this: Lake Superior is at 183 m and would
  // otherwise read as a hillside.
  float wet = m.r * uLayers.x;
  vec3 deep = mix(vec3(0.16, 0.34, 0.52), vec3(0.09, 0.20, 0.33),
                  clamp(vHeight / 400.0, 0.0, 1.0));
  // Calm water is lit evenly. The ground under it is rough in the height data
  // (radar does badly on water), and relief shading showed every bump.
  vec3 water = deep * 0.92;
  // Water on steep ground is falling: a waterfall or rapids. Paint it white, as
  // it looks. Steep means over about 25 degrees, fully white past 40 (n.y is the
  // cosine of the slope). Only well inside the water, so the soft edge of the
  // water texture on a steep bank does not turn white.
  float falling = (1.0 - smoothstep(0.766, 0.906, n.y)) * smoothstep(0.6, 0.9, wet);
  water = mix(water, vec3(0.90, 0.93, 0.95) * (0.72 + 0.28 * lit), falling);
  c = mix(c, water, smoothstep(0.35, 0.65, wet));

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

// Roads, buildings and landmarks. Buildings carry facts (aInfo), not colours;
// the colour is chosen here from look.js, so changing colours rebuilds nothing.
export const MESH_VS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec4 aCol;
in vec4 aInfo;          // building facts, see meshbuilder.js; all zero = use aCol
${CAMERA}
uniform vec2  uTileOffset;
uniform float uScale;    // mercator metres to true metres; 1 for landmarks, which are already true
uniform vec3  uPal[8];   // current colour set (look.js)
uniform vec3  uType[8];  // colour per building type
uniform vec3  uRoof[8];  // roof colours
uniform vec3  uAutoWall[32];   // auto set: 8 walls per size group
uniform vec3  uAutoRoof[32];   // auto set: 8 roofs per size group
uniform int   uLook;     // 1 real colours, 2 by type, 4 warmer, 8 auto set, 16 show buildings under landmarks
out vec3 vPos;
out vec3 vCol;
// The new look (facade.js): windows, roofs and regional colours, for
// buildings built in faces mode. Everything else ignores it.
${FACADE_VS}
vec3 buildingColour() {
  int fl = int(aInfo.a * 255.0 + 0.5);
  int num = int(aInfo.g * 255.0 + 0.5);
  int tg = int(aInfo.r * 255.0 + 0.5);
  int type = tg % 16, size = tg / 16;
  bool useAuto = (uLook & 8) != 0;
  vec3 c;
  if ((fl & 4) != 0) c = useAuto ? uAutoRoof[size * 8 + (num / 8) % 8] : uRoof[(num / 8) % 8];
  else {
    c = useAuto ? uAutoWall[size * 8 + num % 8] : uPal[num % 8];
    if ((uLook & 2) != 0 && type > 0) c = uType[type] * (0.94 + 0.12 * fract(float(num) * 0.618));
    if ((uLook & 1) != 0 && (fl & 2) != 0) {
      // A mapper's colour is often a pure web colour (yellow, green, black).
      // Soften it toward grey and keep it out of the very dark and very light.
      vec3 m = aCol.rgb;
      float l = dot(m, vec3(0.299, 0.587, 0.114));
      c = clamp(mix(vec3(l), m, 0.55), 0.0, 1.0) * 0.6 + 0.18;
    }
  }
  if ((uLook & 4) != 0) c *= vec3(1.06, 1.0, 0.90);   // warmer light
  return c * aInfo.b;
}
void main() {
  float x = aPos.x * uScale + uTileOffset.x;
  float z = aPos.z * uScale + uTileOffset.y;
  float y = aPos.y - uCamAlt;
  vPos = vec3(x, y, z);
  vec3 nl = newLook();
  vCol = vNew == 1 ? nl : aInfo.a > 0.0 ? buildingColour() : aCol.rgb;
  gl_Position = toClip(vPos);
  // A map building under a landmark: put every corner outside the view, so
  // the whole triangle is dropped, unless the mask is switched off (key 4).
  if ((int(aInfo.a * 255.0 + 0.5) & 8) != 0 && (uLook & 16) == 0) gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
}`;

export const MESH_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vCol;
uniform vec3 uSunDir;
out vec4 frag;
${FACADE_FS}
void main() {
  vec3 n = cross(dFdx(vPos), dFdy(vPos));
  float len = length(n);
  n = len > 1e-9 ? n / len : vec3(0.0, 1.0, 0.0);
  if (dot(n, vPos) > 0.0) n = -n;     // always the side facing the camera (walls have n.y ~ 0)
  float lit = 0.55 + 0.45 * max(dot(n, uSunDir), 0.0);
  vec3 c;
  if (vNew == 1) c = facadeShade(vCol * lit, n, lit);  // the new look keeps its full colours
  else c = floor(vCol * lit * 31.0 + 0.5) / 31.0;     // same 5-bit look as terrain
  frag = vec4(c, 1.0);
}`;
