// Overture's buildings, read as tiles (building lab).
//
// Overture publishes every building it has in one big tile file per monthly
// release (pmtiles.js reads it). Its tiles carry far more than our usual map
// tiles: what a building is (church, house, school), its floors, its roof
// shape and height, and wall and roof materials and colours. Here they are
// turned into the property names buildings.js already reads, plus the new
// ones (roof shape and so on) that the lab's builder uses.

export const OVERTURE_RELEASE = '2026-09-23.1';
export const overtureUrl = (release) =>
  `https://overturemaps-extras-us-west-2.s3.us-west-2.amazonaws.com/tiles/${release}/buildings.pmtiles`;
export const OVERTURE_ZOOM = 13;     // the zoom whose tiles keep every detail

// Colours for materials, where no colour is given.
export const FACADE_COLOURS = {
  brick: [150, 82, 62], stone: [200, 190, 168], concrete: [168, 168, 162], glass: [92, 110, 126],
  wood: [150, 112, 80], plaster: [212, 202, 182], metal: [160, 164, 170], cement_block: [176, 174, 168],
  timber_framing: [190, 176, 150], sandstone: [204, 180, 140], marble: [228, 224, 216], clay: [170, 110, 80],
  mirror: [110, 128, 142], plastic: [200, 200, 196], steel: [150, 156, 162],
};
export const ROOF_COLOURS = {
  copper: [96, 150, 128], lead: [116, 120, 124], slate: [72, 74, 80], roof_tiles: [150, 84, 60],
  tile: [150, 84, 60], metal: [128, 132, 138], concrete: [150, 150, 146], asphalt: [76, 74, 72],
  tar_paper: [60, 60, 62], eternit: [120, 120, 118], glass: [120, 140, 156], stone: [170, 162, 148],
  thatch: [150, 128, 84], gravel: [140, 136, 128], wood: [120, 92, 66], grass: [96, 120, 72],
  zinc: [120, 128, 136], plastic: [180, 180, 176],
};

// Buildings that should look like monuments, not offices.
const MONUMENT_SUBTYPES = new Set(['religious', 'civic']);
const MONUMENT_CLASSES = new Set(['church', 'cathedral', 'chapel', 'mosque', 'synagogue', 'temple', 'shrine',
  'monastery', 'basilica', 'government', 'public', 'museum', 'palace', 'castle', 'courthouse', 'town_hall']);
// Overture's kinds of building as the lab's building types (look.js TYPE_NAMES).
const SUBTYPE_TYPE = { residential: 1, commercial: 2, industrial: 3, education: 4, medical: 4,
  entertainment: 6, transportation: 6, civic: 6, religious: 6, military: 7 };

export const isMonument = (p) => MONUMENT_SUBTYPES.has(p.subtype) || MONUMENT_CLASSES.has(p.class);

const hex = (c) => '#' + c.map((v) => v.toString(16).padStart(2, '0')).join('');
const num = (v) => { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : 0; };

// One feature's properties in the names buildings.js reads.
export function mapProps(p, isPart) {
  const o = { ...p };
  let h = num(p.height);
  const floors = num(p.num_floors);
  if (!h && floors) h = floors * 3.2 + (p.roof_height ? num(p.roof_height) : 0);
  if (h) o.render_height = h;
  let minh = num(p.min_height);
  if (!minh && num(p.min_floor)) minh = num(p.min_floor) * 3.2;
  if (minh) o.render_min_height = minh;
  const fc = p.facade_color || (FACADE_COLOURS[p.facade_material] && hex(FACADE_COLOURS[p.facade_material]));
  if (fc) o.colour = fc;
  const rc = p.roof_color || (ROOF_COLOURS[p.roof_material] && hex(ROOF_COLOURS[p.roof_material]));
  if (rc) o.roof_colour = rc;
  // An outline whose parts are drawn separately is hidden, as hide_3d does.
  if (!isPart && (p.has_parts === true || p.has_parts === 'true')) o.hide_3d = true;
  if (p.is_underground === true || p.is_underground === 'true') o.hide_3d = true;
  o.monument = isMonument(p);
  const t = SUBTYPE_TYPE[p.subtype];
  if (t) o.lab_type = t;
  return o;
}

// Every layer of a decoded tile with "building" in its name, as one layer
// buildings.js can read.
export function overtureBuildings(layers) {
  let extent = 4096;
  const features = [];
  for (const [name, L] of Object.entries(layers)) {
    if (!/build/.test(name)) continue;
    extent = L.extent;
    const part = /part/.test(name);
    for (const f of L.features) features.push({ ...f, props: mapProps(f.props || {}, part) });
  }
  return { extent, features };
}

// What came in: how many buildings and parts, and how many carry each detail.
export function overtureCounts(layers) {
  const c = { layers: {}, keys: {}, roof: {}, subtype: {}, facade: {}, roofMat: {} };
  for (const [name, L] of Object.entries(layers)) {
    c.layers[name] = L.features.length;
    for (const f of L.features) {
      const p = f.props || {};
      for (const k of Object.keys(p)) c.keys[k] = (c.keys[k] || 0) + 1;
      if (p.roof_shape) c.roof[p.roof_shape] = (c.roof[p.roof_shape] || 0) + 1;
      if (p.subtype) c.subtype[p.subtype] = (c.subtype[p.subtype] || 0) + 1;
      if (p.facade_material) c.facade[p.facade_material] = (c.facade[p.facade_material] || 0) + 1;
      if (p.roof_material) c.roofMat[p.roof_material] = (c.roofMat[p.roof_material] || 0) + 1;
    }
  }
  return c;
}

export function addCounts(into, c) {
  for (const k of Object.keys(c)) for (const [a, n] of Object.entries(c[k])) into[k][a] = (into[k][a] || 0) + n;
  return into;
}
