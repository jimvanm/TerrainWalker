// What the person has switched on or off. One object, so every part of the app
// reads the same answer and nothing keeps its own copy.
//
// Building colour choices live in look.js (LOOK), because the near-field shader
// reads them directly.

export const settings = {
  fog: false,
  debug: 0,          // 0 normal, 1 tile grid + level tint, 2 flat (no textures)
  frozen: false,     // stop all tile updates; anything that survives is not loading-related
  showMasked: false, // draw the map buildings a landmark hides (key 4), to check the mask
  levels: 9,         // view slider: how many terrain levels may be drawn
  mode: 'nav',       // 'nav' (moving about) or 'tools' (changing things); Tab swaps (ui/keys.js MODES)
  buildings: 0,      // building style, key 5: an index into BUILDING_STYLES
  flatWater: true,   // key 0: water close by as a flat surface (watersurface.js), or painted on the ground
};

// Building styles (key 5). The near field is rebuilt when this changes.
//   today     plain boxes, coloured by look.js
//   new       windows, house roofs, regional colours (facade.js), on our map's buildings
//   overture  the same, on Overture's buildings: heights, roof shapes, materials
export const BUILDING_STYLES = [
  { id: 'today', label: 'TODAY' },
  { id: 'new', label: 'NEW LOOK' },
  { id: 'overture', label: 'OVERTURE' },
];
export const buildingStyle = () => BUILDING_STYLES[settings.buildings].id;

// Map layers. The first four are channels in the terrain shader (uLayers.xyzw,
// in this order); landmarks are separate geometry.
export const LAYERS = [
  { id: 'water', label: 'WATER', on: true },
  { id: 'roads', label: 'ROADS', on: true },
  { id: 'built', label: 'BUILT', on: true },
  { id: 'cover', label: 'COVER', on: true },
  { id: 'land', label: 'LANDMARKS', on: true },
];

export const layerOn = (id) => LAYERS.find((L) => L.id === id).on;
export const toggleLayer = (id) => { const L = LAYERS.find((x) => x.id === id); L.on = !L.on; };
