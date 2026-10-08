// The building lab's window settings and shader text.
import { FACADE, MODE, LAB_VS, LAB_FS, settingsLine } from '../src/facade.js';
const ok = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok  ' + m); };

const s = JSON.parse(settingsLine({ ...FACADE, floor: 3.456 }));
ok(Object.keys(s).join() === Object.keys(FACADE).join(), 'the settings line has every setting');
ok(s.floor === 3.46, 'settings are rounded to two places');
ok(new Set(Object.values(MODE)).size === 5 && Object.values(MODE).every((b) => (b & (b - 1)) === 0), 'each toggle is its own bit');
for (const u of ['uF1', 'uF2', 'uMode', 'uSky', 'uSunDir']) ok(LAB_FS.includes(u), 'the shader reads ' + u);
ok(LAB_VS.includes('in vec4 aFac'), 'the vertex shader takes the wall positions');
console.log('facade ok');
