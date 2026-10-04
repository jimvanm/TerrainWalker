// Where the landmarks stand. Shared by the drawing code (landmarks.js) and the
// map-tile workers, which use it to leave out the ordinary building outlines
// that sit under a landmark (they would poke through the model).
//   maskR  : metres around the middle; any map building that touches this circle is not drawn
//   yawDeg : clockwise turn of the model seen from above (compass style), measured by orient.js
//   fold   : how many times the model's footprint repeats in a full turn (square 4, triangle 3, round 0)
export const SITES = [
  { id: 'cn', name: 'CN Tower', lat: 43.642567, lon: -79.387057, yawDeg: 0, fold: 3, maskR: 40 },
  { id: 'eiffel', name: 'Eiffel Tower', lat: 48.858370, lon: 2.294481, yawDeg: 44.2, fold: 4, maskR: 75 },
  // Oval base (long axis about bearing 54 in the model). The map outline's long axis gives the turn;
  // the top ring's tilt is tied to that axis in the model, so it follows.
  { id: 'canton', name: 'Canton Tower', lat: 23.10889, lon: 113.31889, yawDeg: 0, fold: 2, oval: true, maskR: 60 },
];
