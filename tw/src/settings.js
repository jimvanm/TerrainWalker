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
};

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
