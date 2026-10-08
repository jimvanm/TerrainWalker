// Windows drawn by the shader: no pictures, nothing to download.
//
// Every wall corner carries where it sits on its wall (buildings.js,
// opt.faces): metres along the face, the face's length, metres above the
// building's base, and the building's height. From those the shader works out
// floors and window bays for each pixel. A building's size group (houses, big
// low, mid-rise, towers) and its own number pick the style, so a street is
// varied and the same building looks the same every time.
//
// Used by buildinglab.html for now. If it looks right, the app's building
// shader takes the same code.

// The settings the lab's sliders change. Lengths in metres, the rest fractions.
export const FACADE = {
  floor: 3.5,        // floor height, everything but houses
  houseFloor: 2.9,   // floor height, houses
  ground: 4.5,       // ground floor height (not houses)
  bay: 3.2,          // window spacing along a wall
  win: 0.55,         // window width, part of a bay
  winH: 0.55,        // window height, part of a floor
  tower: 0.88,       // towers: glass width, part of a bay (glass walls)
  shine: 0.6,        // how much the sky shows in the glass
};

// Toggles, as bits of uMode.
export const MODE = { windows: 1, ledges: 2, contact: 4, retro: 8, fog: 16 };

export const LAB_VS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec4 aCol;
in vec4 aInfo;     // building facts (meshbuilder.js); all zero = use aCol (roads)
in vec4 aFac;      // along, length, up, height (buildings.js opt.faces)
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uOff;      // tile centre minus camera, true metres (east, -camera height, south)
uniform float uScale;   // mercator metres to true metres
uniform vec3 uAutoWall[32];
uniform vec3 uAutoRoof[32];
out vec3 vPos;
out vec3 vCol;
out vec4 vFac;
flat out ivec4 vInf;    // flags, building number, size group, type
void main() {
  vPos = vec3(aPos.x * uScale + uOff.x, aPos.y + uOff.y, aPos.z * uScale + uOff.z);
  int fl = int(aInfo.a * 255.0 + 0.5), num = int(aInfo.g * 255.0 + 0.5), tg = int(aInfo.r * 255.0 + 0.5);
  int size = tg / 16, type = tg % 16;
  vInf = ivec4(fl, num, size, type);
  if (fl == 0) vCol = aCol.rgb;
  else if ((fl & 4) != 0) vCol = uAutoRoof[size * 8 + (num / 8) % 8];
  else vCol = uAutoWall[size * 8 + num % 8] * aInfo.b;
  vFac = aFac;
  gl_Position = uProj * uView * vec4(vPos, 1.0);
}`;

export const LAB_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vCol;
in vec4 vFac;
flat in ivec4 vInf;
uniform vec3 uSunDir;
uniform vec3 uSky;
uniform int uMode;
uniform vec4 uF1;   // floor, house floor, ground floor, bay
uniform vec4 uF2;   // window width, window height, tower glass width, shine
out vec4 frag;

float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

// 1 between a and b, 0 outside, with soft edges one pixel wide (w), so
// distant windows do not flicker.
float band(float x, float a, float b, float w) {
  return clamp((x - a) / w + 0.5, 0.0, 1.0) - clamp((x - b) / w + 0.5, 0.0, 1.0);
}

void main() {
  vec3 n = cross(dFdx(vPos), dFdy(vPos));
  float len = length(n);
  n = len > 1e-9 ? n / len : vec3(0.0, 1.0, 0.0);
  if (dot(n, vPos) > 0.0) n = -n;
  float lit = 0.55 + 0.45 * max(dot(n, uSunDir), 0.0);
  vec3 c = vCol * lit;

  bool wall = (vInf.x & 1) != 0 && (vInf.x & 4) == 0 && vFac.y > 0.0;
  if (wall) {
    float u = vFac.x, L = vFac.y, v = vFac.z, H = vFac.w;
    int num = vInf.y, size = vInf.z, type = vInf.w;
    float h1 = hash(vec3(float(num), 1.0, 7.0)), h2 = hash(vec3(float(num), 3.0, 2.0));
    bool house = size == 0, tower = size == 3, bigLow = size == 1;
    bool shop = !house && (size >= 2 || type == 2);

    float fh = (house ? uF1.y : uF1.x) * (0.94 + 0.12 * h1);
    float gh = house ? fh : max(uF1.z, fh);
    float bay = uF1.w * (house ? 1.15 : 1.0) * (0.85 + 0.3 * h2);
    float margin = house ? 0.9 : 0.6;
    float ww = tower ? uF2.z : uF2.x * (0.85 + 0.3 * h1);
    float wh = tower ? 0.8 : uF2.y;
    bool ribbon = size == 2 && (num % 4) == 0;   // some mid-rises have bands of glass
    if (ribbon) ww = 1.0;

    // Which floor, and where in it (0 at the floor, 1 at the ceiling).
    float fi, inF, span;
    if (v < gh) { fi = 0.0; inF = v / gh; span = gh; }
    else { fi = 1.0 + floor((v - gh) / fh); inF = fract((v - gh) / fh); span = fh; }
    float wv = fwidth(v) / span;

    // Which bay along the wall. Bays are stretched to fill the wall exactly,
    // so windows end neatly at the corners.
    float nb = floor((L - 2.0 * margin) / bay);
    if (nb < 1.0 && L > 2.2) nb = 1.0;
    float bw = nb > 0.0 ? (L - 2.0 * margin) / nb : 1.0;
    float uu = (u - margin) / bw;
    float bi = floor(uu), inB = fract(uu);
    float wu = fwidth(u) / bw;

    // Window shape for this floor.
    float sill = (1.0 - wh) * 0.55, wW = ww;
    bool any = nb > 0.0 && uu >= 0.0 && uu < nb && v > 0.0 && v < H - (house ? 0.4 : 1.0);
    if (fi == 0.0 && shop) { sill = 0.1; wh = 0.72; wW = 0.86; }           // shop fronts
    if (bigLow) { any = any && fi == 0.0; sill = 0.55; wh = 0.3; }         // warehouses: high, few
    float floorBase = fi == 0.0 ? 0.0 : gh + (fi - 1.0) * fh;
    if (floorBase + (sill + wh) * span > H - 0.3) any = false;   // no windows cut off by the roof

    if ((uMode & 1) != 0 && any) {
      float x0 = 0.5 - wW * 0.5, x1 = 0.5 + wW * 0.5;
      float m = band(inB, x0, x1, wu) * band(inF, sill, sill + wh, wv);
      // The frame: a slightly larger, darker rim round each window.
      float r = band(inB, x0 - 0.04, x1 + 0.04, wu) * band(inF, sill - 0.04, sill + wh + 0.04, wv);
      // Far away the pattern is finer than a pixel: show its average instead.
      float far = smoothstep(0.25, 0.6, max(wu, wv));
      m = mix(m, wW * wh, far);
      r = mix(r, 0.0, far);
      float hw = hash(vec3(bi, fi, float(num)));
      vec3 view = normalize(-vPos);
      float fres = pow(1.0 - abs(dot(n, view)), 3.0);
      vec3 dark = vec3(0.09, 0.11, 0.14);
      vec3 glass = mix(dark, uSky * 0.9, clamp(uF2.w * (0.25 + 0.75 * fres) * (0.6 + 0.8 * hw), 0.0, 1.0));
      if (!tower && hw > 0.82) glass = mix(glass, vec3(0.55, 0.50, 0.42), 0.55);   // blinds drawn
      c = mix(c, c * 0.72, r);
      c = mix(c, glass, m);
    }
    if ((uMode & 2) != 0 && !house) {
      // A ledge at every floor, and a cap along the top of the wall.
      float lw = 0.25 / span;
      float ledge = v > 0.5 ? band(inF, -lw, lw, wv) : 0.0;
      c *= 1.0 - 0.18 * ledge * (1.0 - smoothstep(0.25, 0.6, wv));
      c *= 1.0 + 0.10 * band(v, H - 0.5, H + 1.0, fwidth(v));
    }
    if ((uMode & 4) != 0) c *= mix(0.62, 1.0, smoothstep(-0.5, 2.5, v));   // darker where the wall meets the ground
  }

  if ((uMode & 16) != 0) c = mix(c, uSky, 1.0 - exp(-length(vPos) / 6000.0));
  if ((uMode & 8) != 0) c = floor(c * 31.0 + 0.5) / 31.0;   // the app's 5-bit look
  frag = vec4(c, 1.0);
}`;

// The settings line: what the app would use, to copy and send over.
export function settingsLine(f) {
  const o = {};
  for (const k of Object.keys(FACADE)) o[k] = Math.round(f[k] * 100) / 100;
  return JSON.stringify(o);
}
