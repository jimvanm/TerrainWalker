// Building colours that can be changed while the app runs.
//
// The worker does not bake a final colour into each building. It stores the
// facts instead (map colour if any, type, a per-building number, wall or roof,
// shade), and the shader picks the colour from the choices below. So a key
// press costs a few uniforms. Nothing is rebuilt or refetched.
//
//   6  real colours from the map, where a mapper entered one (softened)
//   7  colour by building type (from the land use under the building)
//   8  next colour set
//   9  warmer light
//
// 0.12.1: every colour was made darker and less saturated. Real walls are
// darker than people picture them: brick is a deep red-brown, concrete is
// mid-grey, towers are dark glass. Roofs got their own, mostly dark, colours.

export const LOOK = { real: false, type: false, set: 0, warm: false };

// "auto" (the default): colours that suit the building's size group. Each
// building falls in one of four groups, worked out in the worker from its
// height (real, or the usual guess) and its footprint:
//   0 houses    under 15 m, footprint under 500 m2
//   1 big low   under 15 m, footprint 500 m2 or more: warehouses, malls, plants
//   2 mid-rise  15 to 50 m
//   3 towers    50 m and up
// Eight walls and eight roofs per group; the building's number picks one.
export const SIZE_NAMES = ['houses', 'big low', 'mid-rise', 'towers'];
export const SIZE_LIMITS = { low: 15, tall: 50, bigArea: 500 };
export const AUTO_WALLS = [
  [[138, 78, 60], [120, 72, 58], [156, 110, 84], [182, 170, 148],      // houses: brick, siding
   [160, 162, 160], [196, 190, 178], [170, 140, 108], [128, 118, 108]],
  [[184, 184, 180], [200, 196, 186], [176, 168, 150], [160, 162, 164],  // big low: metal, block
   [190, 186, 176], [150, 150, 146], [170, 176, 180], [194, 184, 164]],
  [[160, 154, 144], [176, 160, 128], [190, 180, 160], [134, 82, 64],    // mid-rise: concrete, brick
   [146, 140, 132], [168, 150, 124], [120, 112, 104], [150, 100, 78]],
  [[88, 100, 112], [96, 110, 108], [70, 82, 96], [168, 166, 160],       // towers: glass, concrete, stone
   [150, 148, 142], [188, 178, 158], [120, 126, 132], [104, 116, 128]],
];
export const AUTO_ROOFS = [
  [[70, 70, 72], [86, 80, 76], [60, 58, 58], [96, 84, 74],              // houses: shingles
   [78, 72, 68], [104, 98, 92], [66, 62, 60], [90, 90, 92]],
  [[176, 176, 172], [196, 196, 192], [160, 160, 156], [184, 182, 176],  // big low: pale membranes
   [150, 150, 148], [200, 200, 196], [170, 168, 164], [140, 140, 138]],
];   // mid-rise and towers use ROOFS below

// Eight wall colours per set. A building's number picks one, so a street is mixed.
// The auto set has no list of its own here: the shader uses AUTO_WALLS for it.
export const SETS = [
  { name: 'auto', c: AUTO_WALLS[2] },
  { name: 'stone', c: [
    [176, 168, 152], [150, 146, 140], [160, 150, 134], [128, 124, 120],
    [170, 162, 150], [140, 136, 130], [186, 180, 168], [118, 108, 98]] },
  { name: 'brick', c: [
    [142, 78, 60], [122, 66, 52], [156, 96, 72], [110, 62, 50],
    [150, 108, 84], [132, 84, 66], [166, 120, 96], [100, 60, 48]] },
  { name: 'render', c: [   // painted plaster, as in much of Europe
    [196, 182, 160], [176, 184, 170], [186, 170, 160], [170, 176, 180],
    [200, 186, 158], [180, 170, 170], [204, 190, 172], [172, 182, 174]] },
  { name: 'concrete', c: [
    [150, 150, 146], [132, 134, 136], [164, 162, 158], [120, 122, 126],
    [156, 152, 146], [140, 142, 144], [172, 170, 166], [110, 112, 116]] },
  { name: 'mixed', c: [
    [176, 168, 152], [142, 78, 60], [132, 134, 136], [184, 170, 140],
    [96, 104, 112], [156, 96, 72], [196, 190, 180], [80, 92, 104]] },
];

// Roof colours: tar, membrane, gravel, a few tiles. Picked by the building's
// number too, but a different part of it, so roof and wall vary separately.
export const ROOFS = [
  [78, 78, 80], [96, 94, 92], [66, 66, 68], [118, 114, 106],
  [112, 74, 60], [88, 84, 80], [134, 130, 122], [74, 70, 66]];

// Building types. The index is what the worker stores. 0 = unknown, which
// falls back to the colour set.
export const TYPE_NAMES = ['unknown', 'homes', 'shops/offices', 'industry', 'schools/hospitals', 'tall', 'public', 'military'];
export const TYPE_COLOURS = [
  [0, 0, 0],          // unused
  [158, 120, 96],     // homes: brick tan
  [150, 154, 160],    // shops and offices: light grey
  [120, 124, 128],    // industry: dark grey
  [176, 156, 120],    // schools, hospitals: sandstone
  [92, 112, 130],     // tall (50 m and up): dark glass
  [140, 150, 136],    // stadiums, zoos, stations: grey-green
  [110, 112, 90],     // military: olive
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
  return (LOOK.real ? 1 : 0) | (LOOK.type ? 2 : 0) | (LOOK.warm ? 4 : 0) | (isAuto() ? 8 : 0);
}

export function lookLabel() {
  return SETS[LOOK.set].name + (LOOK.real ? ' +real' : '') + (LOOK.type ? ' +type' : '') + (LOOK.warm ? ' +warm' : '');
}

// Flat Float32Arrays (0..1) ready for uniform3fv.
const f32 = (cs) => new Float32Array(cs.flat().map((v) => v / 255));
const SET_UNIFORMS = SETS.map((s) => f32(s.c));
export function setUniform() { return SET_UNIFORMS[LOOK.set]; }
export const TYPE_UNIFORM = f32(TYPE_COLOURS);
export const ROOF_UNIFORM = f32(ROOFS);
export const AUTO_WALL_UNIFORM = f32(AUTO_WALLS.flat());
// Towers never have tile roofs, so theirs swaps the tile red for a grey.
const TOWER_ROOFS = ROOFS.map((c, i) => (i === 4 ? [100, 100, 102] : c));
export const AUTO_ROOF_UNIFORM = f32([...AUTO_ROOFS.flat(), ...ROOFS, ...TOWER_ROOFS]);
export const isAuto = () => SETS[LOOK.set].name === 'auto';
