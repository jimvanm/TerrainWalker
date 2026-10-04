// Where the landmarks stand. Shared by the drawing code (landmarks.js) and the
// map-tile workers, which use it to leave out the ordinary building outlines
// that sit under a landmark (they would poke through the model).
//   maskR  : metres around the middle; any map building that touches this circle is not drawn
//   yawDeg : turns the model about its vertical axis, clockwise seen from above
export const SITES = [
  { id: 'cn', name: 'CN Tower', lat: 43.642567, lon: -79.387057, yawDeg: 0, maskR: 40 },
  { id: 'eiffel', name: 'Eiffel Tower', lat: 48.858370, lon: 2.294481, yawDeg: 0, maskR: 75 },
  // Top ring tilts toward +x (east) in the model; the real compass direction is not checked.
  { id: 'canton', name: 'Canton Tower', lat: 23.10889, lon: 113.31889, yawDeg: 0, maskR: 50 },
];
