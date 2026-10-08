// Longitude and latitude to Canada's national map grid, "Canada Atlas
// Lambert" (EPSG:3979), in metres. Canada's high-resolution elevation (HRDEM)
// is published on this grid. A Lambert conic projection on the GRS80
// ellipsoid, standard parallels 49 and 77 degrees, centred on 95 degrees west.
// Checked against the standard projection library to within a metre (the
// difference between the two earth models involved is about that).

const A = 6378137, F = 1 / 298.257222101;
const E2 = F * (2 - F), E = Math.sqrt(E2);
const D = Math.PI / 180;
const LAT1 = 49 * D, LAT2 = 77 * D, LAT0 = 49 * D, LON0 = -95 * D;

const m = (p) => Math.cos(p) / Math.sqrt(1 - E2 * Math.sin(p) ** 2);
const t = (p) => Math.tan(Math.PI / 4 - p / 2) / ((1 - E * Math.sin(p)) / (1 + E * Math.sin(p))) ** (E / 2);
const N = (Math.log(m(LAT1)) - Math.log(m(LAT2))) / (Math.log(t(LAT1)) - Math.log(t(LAT2)));
const FF = m(LAT1) / (N * t(LAT1) ** N);
const RHO0 = A * FF * t(LAT0) ** N;

// [x, y] metres on the grid for a longitude and latitude in degrees.
export function toCanadaAtlas(lon, lat) {
  const rho = A * FF * t(lat * D) ** N;
  const th = N * (lon * D - LON0);
  return [rho * Math.sin(th), RHO0 - rho * Math.cos(th)];
}
