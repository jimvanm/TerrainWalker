// Windows drawn by the shader: no pictures, nothing to download.
//
// Every wall corner carries where it sits on its wall (buildings.js,
// opt.faces): metres along the face, the face's length, metres above the
// building's base, and the wall's height; and a style: the building's guessed
// age, whether it is a pitched-roof house, and whether this wall is one of its
// ends. From those the shader works out floors, window bays, and the window
// for each pixel, in real sizes. The region the building stands in picks its
// colours (REGIONS below); its age and its own number pick the window style,
// so a street is varied and the same building looks the same every time.
//
// Used by buildinglab.html for now. If it looks right, the app's building
// shader takes the same code.

// The settings the lab's sliders change.
export const FACADE = {
  floor: 3.5,        // floor height, everything but houses (m)
  houseFloor: 2.9,   // floor height, houses (m)
  ground: 4.5,       // ground floor height, not houses (m)
  gap: 1.4,          // wall between windows (m)
  size: 1.0,         // window size, times the usual
  tower: 0.88,       // towers: glass width, part of a bay (glass walls)
  shine: 0.6,        // how much the sky shows in the glass
};

// Toggles, as bits of uMode.
export const MODE = { windows: 1, ledges: 2, contact: 4, retro: 8, fog: 16, age: 32 };

// Regional looks. Wall colours come in five groups of four: old houses, new
// houses, old other buildings, new other buildings, towers. Roofs: four for
// old pitched roofs, four for new. Frames: old, new. extra: stone courses on
// the walls, iron balconies (Paris), chance of arched windows, top floor in
// zinc (Paris mansards).
export const REGIONS = {
  north_america: {
    walls: [
      [[150, 84, 64], [128, 74, 58], [168, 120, 90], [190, 180, 160]],
      [[196, 190, 176], [176, 170, 160], [160, 150, 136], [150, 104, 80]],
      [[146, 86, 66], [170, 150, 120], [132, 120, 108], [160, 104, 80]],
      [[176, 172, 164], [156, 156, 152], [190, 180, 160], [140, 134, 128]],
      [[88, 100, 112], [96, 110, 108], [70, 82, 96], [150, 148, 142]]],
    roofs: [[70, 70, 72], [86, 80, 76], [60, 58, 58], [96, 84, 74], [92, 90, 90], [70, 66, 64], [110, 100, 90], [80, 82, 86]],
    frames: [[226, 222, 212], [60, 60, 62]],
    extra: { stone: 0, balconies: 0, arch: 0.1, zinc: 0 },
  },
  // Toronto and Montréal: old houses are nearly all brick, reds and browns.
  brick: {
    walls: [
      [[146, 78, 58], [120, 66, 52], [160, 98, 74], [134, 92, 70]],
      [[176, 140, 110], [196, 190, 176], [150, 104, 80], [168, 160, 150]],
      [[140, 80, 62], [170, 150, 120], [124, 74, 58], [150, 140, 128]],
      [[176, 172, 164], [156, 156, 152], [190, 180, 160], [140, 134, 128]],
      [[88, 100, 112], [96, 110, 108], [70, 82, 96], [150, 148, 142]]],
    roofs: [[66, 66, 70], [84, 76, 72], [58, 56, 58], [100, 86, 76], [92, 90, 90], [70, 66, 64], [110, 100, 90], [80, 82, 86]],
    frames: [[230, 226, 216], [56, 56, 58]],
    extra: { stone: 0, balconies: 0, arch: 0.25, zinc: 0 },
  },
  // Paris: cream limestone nearly everywhere, zinc roofs, iron balconies.
  paris: {
    walls: [
      [[214, 200, 172], [204, 190, 162], [222, 210, 184], [196, 182, 156]],
      [[214, 208, 196], [204, 196, 180], [196, 188, 172], [220, 214, 200]],
      [[216, 202, 174], [206, 192, 164], [224, 212, 186], [198, 184, 158]],
      [[204, 198, 186], [190, 186, 178], [214, 206, 190], [172, 172, 170]],
      [[96, 108, 118], [110, 120, 126], [80, 92, 104], [170, 168, 162]]],
    roofs: [[120, 128, 136], [110, 118, 128], [132, 138, 144], [150, 96, 76], [120, 128, 136], [100, 104, 110], [150, 96, 76], [130, 134, 138]],
    frames: [[232, 228, 218], [90, 92, 96]],
    extra: { stone: 1, balconies: 1, arch: 0.15, zinc: 1 },
  },
  uk: {
    walls: [
      [[150, 100, 70], [170, 130, 90], [136, 84, 62], [184, 160, 126]],
      [[176, 130, 96], [196, 186, 166], [150, 110, 80], [214, 208, 196]],
      [[140, 92, 66], [200, 192, 172], [168, 128, 92], [128, 80, 60]],
      [[184, 178, 166], [160, 158, 152], [200, 192, 176], [140, 136, 130]],
      [[88, 100, 112], [96, 110, 108], [70, 82, 96], [160, 156, 148]]],
    roofs: [[74, 76, 82], [86, 88, 94], [66, 68, 74], [130, 80, 60], [96, 90, 86], [74, 76, 82], [130, 80, 60], [86, 88, 94]],
    frames: [[236, 234, 228], [70, 70, 72]],
    extra: { stone: 0, balconies: 0, arch: 0.15, zinc: 0 },
  },
  // The rest of Europe: painted render, terracotta roofs.
  europe: {
    walls: [
      [[210, 196, 170], [196, 184, 164], [214, 200, 180], [190, 170, 150]],
      [[214, 210, 200], [200, 196, 188], [186, 176, 160], [204, 186, 160]],
      [[206, 192, 166], [190, 180, 164], [210, 194, 170], [178, 164, 150]],
      [[200, 196, 188], [180, 178, 174], [210, 204, 192], [160, 158, 156]],
      [[88, 100, 112], [96, 110, 108], [70, 82, 96], [160, 156, 148]]],
    roofs: [[150, 84, 60], [140, 76, 56], [120, 70, 54], [160, 96, 70], [96, 90, 88], [140, 76, 56], [110, 104, 100], [150, 84, 60]],
    frames: [[226, 222, 212], [80, 80, 82]],
    extra: { stone: 0, balconies: 0, arch: 0.25, zinc: 0 },
  },
};

const near = (lat, lon, lat0, lon0, km) => {
  const dy = (lat - lat0) * 111.2, dx = (lon - lon0) * 111.2 * Math.cos(lat0 * Math.PI / 180);
  return dx * dx + dy * dy <= km * km;
};

// Which look a place gets. A few cities by name, then broad areas.
export function regionAt(lat, lon) {
  if (near(lat, lon, 48.8566, 2.3522, 20)) return 'paris';
  if (near(lat, lon, 43.70, -79.40, 45) || near(lat, lon, 45.51, -73.60, 30)) return 'brick';
  if (lat > 49.9 && lat < 58.7 && lon > -8.2 && lon < 1.8) return 'uk';
  if (lat > 35 && lat < 71 && lon > -10 && lon < 40) return 'europe';
  return 'north_america';
}

// A region's colours as flat 0..1 arrays, ready for the shader's uniforms.
export function regionUniforms(name) {
  const r = REGIONS[name] || REGIONS.north_america;
  const f = (cs) => new Float32Array(cs.flat(2).map((v) => v / 255));
  const e = r.extra;
  return { wall: f(r.walls), roof: f(r.roofs), frame: f(r.frames), extra: [e.stone, e.balconies, e.arch, e.zinc] };
}

export const LAB_VS = `#version 300 es
precision highp float;
in vec3 aPos;
in vec4 aCol;
in vec4 aInfo;     // building facts (meshbuilder.js); all zero = use aCol (roads)
in vec4 aFac;      // along, length, up, wall height (buildings.js opt.faces)
in vec4 aSty;      // age 0..1, flags/255 (1 end wall, 2 pitched house)
uniform mat4 uProj;
uniform mat4 uView;
uniform vec3 uOff;      // tile centre minus camera, true metres (east, -camera height, south)
uniform float uScale;   // mercator metres to true metres
uniform vec3 uAutoRoof[32];
uniform vec3 uAutoWall[32];
uniform int uToday;     // 1: the app's colours as they are today
uniform vec3 uWall[20];
uniform vec3 uRoofC[8];
out vec3 vPos;
out vec3 vCol;
out vec4 vFac;
flat out ivec4 vInf;    // flags, building number, size group, type
flat out ivec2 vSty;    // old (1) or new (0), style flags
flat out float vAge;
flat out vec4 vMap;     // the map's own colour, where a mapper gave one (a = 1)
void main() {
  vPos = vec3(aPos.x * uScale + uOff.x, aPos.y + uOff.y, aPos.z * uScale + uOff.z);
  int fl = int(aInfo.a * 255.0 + 0.5), num = int(aInfo.g * 255.0 + 0.5), tg = int(aInfo.r * 255.0 + 0.5);
  int size = tg / 16, type = tg % 16;
  int sf = int(aSty.y * 255.0 + 0.5);
  // Old or new: the age guess is a chance, so a mixed street stays mixed.
  bool old = fract(float(num) * 0.6180 + 0.13) < aSty.x;
  vInf = ivec4(fl, num, size, type);
  vSty = ivec2(old ? 1 : 0, sf);
  vAge = aSty.x;
  float vary = 0.92 + 0.16 * fract(float(num) * 0.37);
  if (fl == 0) vCol = aCol.rgb;
  else if (uToday == 1) vCol = ((fl & 4) != 0 ? uAutoRoof[size * 8 + (num / 8) % 8] : uAutoWall[size * 8 + num % 8] * aInfo.b);
  else if ((fl & 4) != 0) {
    if ((sf & 2) != 0) vCol = uRoofC[(old ? 0 : 4) + (num / 4) % 4] * vary;
    else vCol = uAutoRoof[size * 8 + (num / 8) % 8];
  } else {
    int cls = size == 3 ? 4 : size == 0 ? (old ? 0 : 1) : (old ? 2 : 3);
    vCol = uWall[cls * 4 + num % 4] * vary * aInfo.b;
  }
  // A colour from the map wins: Scotia Plaza stays red, Royal Bank Plaza gold.
  // Softened a little toward grey, as the app does, since mappers often give
  // pure web colours.
  vMap = vec4(0.0);
  if (uToday == 0 && fl != 0 && (fl & 2) != 0) {
    vec3 m = aCol.rgb;
    float l = dot(m, vec3(0.299, 0.587, 0.114));
    vec3 mc = clamp(mix(vec3(l), m, 0.75), 0.0, 1.0) * 0.8 + 0.1;
    vMap = vec4(mc, 1.0);
    vCol = (fl & 4) != 0 ? mc * 0.8 : mc * aInfo.b;
  }
  vFac = aFac;
  gl_Position = uProj * uView * vec4(vPos, 1.0);
}`;

export const LAB_FS = `#version 300 es
precision highp float;
in vec3 vPos;
in vec3 vCol;
in vec4 vFac;
flat in ivec4 vInf;
flat in ivec2 vSty;
flat in float vAge;
flat in vec4 vMap;
uniform vec3 uSunDir;
uniform vec3 uSky;
uniform int uMode;
uniform vec4 uF1;      // floor, house floor, ground floor, gap
uniform vec4 uF2;      // window size, tower glass width, shine, -
uniform vec3 uFrame[2];
uniform vec4 uReg;     // stone courses, balconies, arched chance, zinc top floor
out vec4 frag;

float hash(vec3 p) { return fract(sin(dot(p, vec3(12.9898, 78.233, 37.719))) * 43758.5453); }

// 1 between a and b, 0 outside, with soft edges w wide, so distant edges do
// not flicker.
float band(float x, float a, float b, float w) {
  return clamp((x - a) / w + 0.5, 0.0, 1.0) - clamp((x - b) / w + 0.5, 0.0, 1.0);
}
// Inside a w by h opening with its bottom-middle at the origin; arched top
// if arch. px: soft edge width.
float opening(float x, float y, float w, float h, bool arch, float px) {
  float m = band(x, -w * 0.5, w * 0.5, px) * band(y, 0.0, h, px);
  if (arch && y > h - w * 0.5) {
    float r = w * 0.5, d = length(vec2(x, y - (h - r)));
    m = min(m, clamp((r - d) / px + 0.5, 0.0, 1.0));
  }
  return m;
}
// Thin bars at n even places across a span s (0..s): 1 on a bar.
float bars(float x, float s, float n, float bw, float px) {
  if (n < 1.0) return 0.0;
  float t = x / s * (n + 1.0);
  float f = abs(fract(t + 0.5) - 0.5) * s / (n + 1.0);   // metres to nearest bar line
  float inside = step(0.5, t) * step(t, n + 0.5);
  return inside * (1.0 - smoothstep(bw * 0.5 - px * 0.5, bw * 0.5 + px * 0.5, f));
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
    bool old = vSty.x == 1, endWall = (vSty.y & 1) != 0, pitched = (vSty.y & 2) != 0;
    float hb = float(num);
    float h1 = hash(vec3(hb, 1.0, 7.0)), h2 = hash(vec3(hb, 3.0, 2.0)), h3 = hash(vec3(hb, 5.0, 9.0));
    bool house = size == 0, tower = size == 3;
    bool industry = size == 1 && (type == 3 || (type == 0 && H < 9.0));
    bool shop = !house && !industry && (type == 2 || (size >= 1 && h3 < 0.5));
    float px = max(max(fwidth(u), fwidth(v)), 1e-4);    // metres per pixel here
    float far = smoothstep(0.12, 0.4, px);              // finer than a pixel: show the average

    // Floors.
    float fh = (house ? uF1.y : uF1.x) * (0.95 + 0.1 * h1);
    float gh = house ? fh : max(uF1.z, fh);
    float fi, fb, span;
    if (v < gh) { fi = 0.0; fb = 0.0; span = gh; }
    else { fi = 1.0 + floor((v - gh) / fh); fb = gh + (fi - 1.0) * fh; span = fh; }
    float y = v - fb;                                   // metres up from this floor

    // This building's window: size in metres, bars, arch.
    float S = uF2.x;
    float ww, wh, nv = 0.0, nh = 0.0;
    bool arch = false;
    if (tower) { ww = 0.0; wh = 0.0; }
    else if (old) {
      ww = (0.85 + 0.3 * h1) * S; wh = (house ? 1.5 : 1.9) * (0.9 + 0.2 * h2) * S;
      nv = h3 < 0.6 ? 1.0 : 0.0; nh = 1.0;
      arch = !house && h2 < uReg.z;
    } else {
      float k = fract(h1 * 3.0);
      if (k < 0.35) { ww = 1.8 * S; wh = 1.3 * S; nv = 1.0; }          // wide, two panes
      else if (k < 0.65) { ww = 1.2 * S; wh = 1.3 * S; }               // square
      else if (k < 0.85) { ww = 1.9 * S; wh = 1.5 * S; nv = 1.0; }     // paired
      else { ww = 2.4 * S; wh = 1.2 * S; nv = 2.0; }                   // long and low
    }
    wh = min(wh, span - 0.9);
    float sill = old ? min(0.9, (span - wh) * 0.6) : (span - wh) * 0.55;
    float gap = uF1.w * (old ? 1.0 + 0.4 * h2 : 0.8 + 0.4 * h2);
    float margin = house ? 0.7 : 0.6;

    // Ground floor: shop fronts, or a door at each end of a house.
    bool front = fi == 0.0 && shop;
    if (front) { gap = 0.5; ww = 3.2; wh = gh - 1.2; sill = 0.45; nv = 0.0; nh = 0.0; arch = false; }

    // Bays: as many windows as fit with a gap between, spread evenly.
    float bay = ww + gap;
    float nb = floor((L - 2.0 * margin + gap) / bay);
    if (nb < 1.0 && L > ww + 1.2) nb = 1.0;
    if (tower) { bay = 3.0 * (0.8 + 0.4 * h2); nb = max(1.0, floor((L - 1.0) / bay)); margin = 0.5; }
    float bw = nb > 0.0 ? (L - 2.0 * margin) / nb : 1.0;
    float uu = (u - margin) / bw, bi = floor(uu);
    float x = (fract(uu) - 0.5) * bw;                   // metres from the middle of this bay
    if (front) ww = max(1.0, bw - 0.6);
    if (tower) { ww = bw * uF2.y; wh = span * 0.8; sill = span * 0.1; nv = 0.0; nh = 0.0; }

    bool zinc = uReg.w > 0.5 && old && !house && size == 2 && v > H - fh && H > 12.0;
    if (zinc) c = vec3(0.47, 0.50, 0.54) * lit;          // Paris mansard: the top floor in zinc

    // Stone courses: faint lines between blocks, stronger on the ground floor.
    if (uReg.x > 0.5 && !tower && !zinc) {
      float cs = fi == 0.0 ? 0.45 : 0.55;
      float t = abs(fract(v / cs) - 0.5) * cs;
      float line = 1.0 - smoothstep(0.015, 0.015 + px, 0.5 * cs - t);
      c *= 1.0 - (fi == 0.0 ? 0.16 : 0.07) * (1.0 - line) * (1.0 - far);
    }

    bool any = nb > 0.0 && uu >= 0.0 && uu < nb && fb + sill + wh < H - 0.3;
    if (industry) { any = any && fi == 0.0; sill = span - 1.4; wh = 0.8; }
    // A door: the first bay of each end wall of a house.
    bool door = house && pitched && endWall && fi == 0.0 && bi == 0.0;

    if ((uMode & 1) != 0 && any) {
      float fw = 0.08;
      vec3 frameC = uFrame[old ? 0 : 1];
      if (door) {
        float dw = 0.95, dh = min(2.1, span - 0.3);
        float m = opening(x, y - 0.15, dw, dh, false, px);
        float fr = opening(x, y - 0.15 + fw, dw + 2.0 * fw, dh + 2.0 * fw, false, px);
        vec3 dc = h2 < 0.3 ? vec3(0.32, 0.12, 0.10) : h2 < 0.55 ? vec3(0.14, 0.22, 0.16) : h2 < 0.8 ? vec3(0.10, 0.10, 0.11) : vec3(0.42, 0.30, 0.20);
        c = mix(c, frameC * lit, fr * (1.0 - far));
        c = mix(c, dc * lit, m);
      } else {
        float yy = y - sill;
        float m = opening(x, yy, ww, wh, arch, px);
        float fr = opening(x, yy + fw, ww + 2.0 * fw, wh + 2.0 * fw, arch, px);
        float hw = hash(vec3(bi, fi, hb));
        vec3 view = normalize(-vPos);
        float fres = pow(1.0 - abs(dot(n, view)), 3.0);
        vec3 dark = vec3(0.09, 0.11, 0.14);
        vec3 glass = mix(dark, uSky * 0.9, clamp(uF2.z * (0.25 + 0.75 * fres) * (0.6 + 0.8 * hw), 0.0, 1.0));
        if (vMap.a > 0.5) glass = mix(glass, vMap.rgb * 0.75, tower ? 0.45 : 0.15);   // tinted glass
        if (!tower && hw > 0.84) glass = mix(glass, vec3(0.56, 0.51, 0.43), 0.55);   // blinds drawn
        glass *= mix(0.65, 1.0, smoothstep(0.0, 0.18, wh - yy));                      // shade under the top
        // Glazing bars.
        float bar = max(bars(x + ww * 0.5, ww, nv, 0.06, px), bars(yy, wh, nh, 0.06, px)) * (1.0 - far);
        glass = mix(glass, frameC * lit, bar);
        // A sill under old windows, and a lintel over them on brick and render.
        if (old && !front && !tower) {
          float sl = band(x, -ww * 0.5 - 0.1, ww * 0.5 + 0.1, px) * band(yy, -0.12, -fw, px);
          c = mix(c, mix(c, vec3(0.80, 0.77, 0.70) * lit, 0.6), sl * (1.0 - far));
          if (uReg.x < 0.5 && !arch) {
            float li = band(x, -ww * 0.5 - 0.12, ww * 0.5 + 0.12, px) * band(yy, wh + fw, wh + fw + 0.2, px);
            c = mix(c, c * 1.18, li * (1.0 - far));
          }
        }
        float cover = clamp(ww * wh / max(bw * span, 0.01), 0.0, 1.0);
        c = mix(c, frameC * lit, fr * (1.0 - far));
        c = mix(c, glass, mix(m, cover, far));
      }
    }
    // Paris: an iron railing along the 2nd and 5th floors.
    if ((uMode & 1) != 0 && uReg.y > 0.5 && old && !house && !tower && (fi == 2.0 || fi == 5.0) && fb + 1.2 < H) {
      float rail = band(y, 0.05, 1.0, px) * band(u, margin, L - margin, px);
      float iron = mix(0.35 + 0.65 * (1.0 - smoothstep(0.012, 0.012 + px, abs(fract(u / 0.12) - 0.5) * 0.12)), 0.55, far);
      iron = max(iron, band(y, 0.9, 1.0, px));
      c = mix(c, vec3(0.08, 0.08, 0.09), rail * iron);
      c = mix(c, c * 1.15, band(y, -0.12, 0.05, px));    // the stone slab under it
    }
    if ((uMode & 2) != 0 && !house) {
      // A ledge at every floor, and a cap along the top of the wall.
      float ledge = v > 0.5 && !zinc ? band(y, -0.12, 0.12, px) : 0.0;
      c *= 1.0 - 0.16 * ledge * (1.0 - far);
      c *= 1.0 + 0.10 * band(v, H - 0.5, H + 1.0, px);
    }
    if ((uMode & 4) != 0) c *= mix(0.62, 1.0, smoothstep(-0.5, 2.5, v));   // darker where the wall meets the ground
  }

  // The age guess shown plainly: blue new, red old.
  if ((uMode & 32) != 0 && (vInf.x & 1) != 0) c = mix(vec3(0.20, 0.35, 0.80), vec3(0.85, 0.22, 0.15), vAge) * lit;
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
