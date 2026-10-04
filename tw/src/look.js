// Building colours that can be changed while the app runs.
//
// The worker no longer bakes a final colour into each building. It stores the
// facts instead (map colour if any, type, a per-building number, wall shade),
// and the shader picks the colour from the choices below. So a key press costs
// a few uniforms. Nothing is rebuilt or refetched.
//
//   6  real colours from the map, where a mapper entered one
//   7  colour by building type (from the land use under the building)
//   8  next colour set
//   9  brighter version of whatever is showing

export const LOOK = { real: false, type: false, set: 0, bright: false };

// Eight colours per set. A building's number picks one, so a street is mixed.
export const SETS = [
  { name: 'stone', c: [
    [214, 208, 196], [204, 198, 190], [222, 216, 206], [196, 192, 188],
    [210, 200, 184], [190, 196, 200], [226, 222, 214], [200, 190, 178]] },
  { name: 'brick', c: [
    [168, 92, 72], [152, 84, 66], [182, 110, 86], [140, 78, 64],
    [176, 120, 96], [160, 100, 80], [190, 130, 104], [130, 74, 60]] },
  { name: 'pastel', c: [
    [232, 214, 190], [214, 226, 212], [226, 206, 214], [208, 220, 232],
    [236, 226, 196], [222, 210, 228], [240, 222, 206], [214, 232, 226]] },
  { name: 'concrete', c: [
    [176, 176, 174], [160, 162, 164], [190, 190, 188], [150, 152, 156],
    [184, 180, 174], [168, 170, 172], [198, 198, 196], [142, 144, 148]] },
  { name: 'mixed', c: [
    [214, 208, 196], [168, 92, 72], [190, 196, 200], [226, 206, 170],
    [150, 152, 156], [182, 110, 86], [236, 232, 224], [120, 130, 140]] },
];

// Building types. The index is what the worker stores. 0 = unknown, which
// falls back to the colour set.
export const TYPE_NAMES = ['unknown', 'homes', 'shops/offices', 'industry', 'schools/hospitals', 'tall', 'public', 'military'];
export const TYPE_COLOURS = [
  [0, 0, 0],          // unused
  [200, 156, 124],    // homes: warm tan
  [188, 196, 206],    // shops and offices: cool light grey
  [138, 146, 154],    // industry: dark blue-grey
  [216, 192, 140],    // schools, hospitals: sand
  [118, 148, 178],    // tall (50 m and up): glass blue
  [172, 190, 170],    // stadiums, zoos, stations: grey-green
  [132, 136, 102],    // military: olive
];

// Land use class -> type index.
export const LANDUSE_TYPE = {
  residential: 1, suburb: 1, quarter: 1, neighbourhood: 1, garages: 1,
  commercial: 2, retail: 2,
  industrial: 3, railway: 3, dam: 3,
  school: 4, university: 4, college: 4, kindergarten: 4, library: 4, hospital: 4,
  stadium: 6, theme_park: 6, zoo: 6, bus_station: 6,
  military: 7,
};
export const TALL = 50;   // metres: known height at or above this counts as "tall"

export function lookBits() {
  return (LOOK.real ? 1 : 0) | (LOOK.type ? 2 : 0) | (LOOK.bright ? 4 : 0);
}

// Short text for the HUD, e.g. "stone +real +type".
export function lookLabel() {
  return SETS[LOOK.set].name + (LOOK.real ? ' +real' : '') + (LOOK.type ? ' +type' : '') + (LOOK.bright ? ' +bright' : '');
}

// Flat Float32Arrays (0..1) ready for uniform3fv.
export function setUniform() {
  return new Float32Array(SETS[LOOK.set].c.flat().map((v) => v / 255));
}
export const TYPE_UNIFORM = new Float32Array(TYPE_COLOURS.flat().map((v) => v / 255));
