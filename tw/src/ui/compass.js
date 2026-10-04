// Aviation directional gyro. The card is built once; each frame only rotates it.
// Labels are degrees/10, cardinals spelled out, and the card turns so the
// current heading sits under the lubber line at the top.

export function initCompass() {
  const card = document.getElementById('card');
  const hdgEl = document.getElementById('hdg');
  let out = '';
  for (let d = 0; d < 360; d += 5) {
    const maj = d % 30 === 0;
    const r0 = maj ? 42 : 48, r1 = 57;
    const a = d * Math.PI / 180;
    const sn = Math.sin(a), cs = Math.cos(a);
    out += `<line class="${maj ? 'tickmaj' : 'tick'}" x1="${(sn * r0).toFixed(2)}" ` +
           `y1="${(-cs * r0).toFixed(2)}" x2="${(sn * r1).toFixed(2)}" y2="${(-cs * r1).toFixed(2)}"/>`;
  }
  const cardinal = { 0: 'N', 90: 'E', 180: 'S', 270: 'W' };
  for (let d = 0; d < 360; d += 30) {
    const a = d * Math.PI / 180, r = 30;
    const x = Math.sin(a) * r, y = -Math.cos(a) * r;
    const txt = cardinal[d] || String(d / 10);
    // Each label is rotated by its own bearing, so once the card turns by -hdg
    // the label under the lubber line lands at zero rotation and reads upright.
    // dy is applied in the label's own rotated frame, which centres it after
    // the rotation rather than before.
    out += `<text class="${cardinal[d] ? 'card' : 'lab'}" x="${x.toFixed(2)}" ` +
           `y="${y.toFixed(2)}" dy="0.35em" ` +
           `transform="rotate(${d} ${x.toFixed(2)} ${y.toFixed(2)})">${txt}</text>`;
  }
  card.innerHTML = out;

  // Heading in degrees, 0 = north. On the flat plane yaw IS the compass
  // heading, since -z is north.
  return function setHeading(hdg) {
    card.setAttribute('transform', `rotate(${(-hdg).toFixed(2)})`);
    hdgEl.textContent = String(Math.round(hdg) === 0 ? 360 : Math.round(hdg)).padStart(3, '0');
  };
}
