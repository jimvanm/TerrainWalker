// Strain meter. A scrolling picture of how smooth the last few seconds were,
// built to be glanced at rather than read.
//
// No fixed limits. Every frame is judged against this machine's own recent
// normal (the median of the last couple of seconds), so a 60 Hz laptop and a
// 144 Hz desktop both flag the moments that are odd FOR THEM.
//
//   top graph : one bar per frame, how long since the previous frame.
//               Turns red when it is far above normal. The dashed line is the
//               current "too slow" level, which moves with the baseline.
//   cyan line : how long our own code took inside the frame. If a bar is red
//               and this stays low, the browser or graphics card stalled and
//               it was not our JavaScript.
//   bottom    : holes (ground that should be drawn but is not loaded yet).
//   border    : flashes red on any strain, then fades.
//   ticks     : a mark where each event happened, scrolling with the graph.
//
// Every event is kept (height, speed, holes, queue) in window.twLog. Press L
// to copy the log to the clipboard.

// Shared counters. terrain.js and nearfield.js add to these while they upload;
// main.js hands them to the meter once a frame and zeroes them.
export const probe = { uploadMs: 0, nearTiles: 0, terrainTiles: 0, switched: '' };

const MARKS = {                     // what each coloured square on the top row means
  terrain: '#ffd479',               // ground tiles landed on the graphics card
  near: '#b388ff',                  // road tiles landed
  switch: '#ff6ec7',                // near block size or detail levels changed
};

const N = 240;              // frames kept
const WARM_MS = 4000;       // ignore start-up loading

function median(arr, count) {
  const a = Array.from(arr.subarray(0, count)).sort((x, y) => x - y);
  return a.length ? a[a.length >> 1] : 0;
}

export class Perf {
  constructor(canvas) {
    this.cv = canvas;
    this.ctx = canvas.getContext('2d');
    this.dt = new Float32Array(N);      // frame interval, ms
    this.work = new Float32Array(N);    // our own time in the frame, ms
    this.holes = new Float32Array(N);
    this.flag = new Uint8Array(N);      // 1 = strain on this frame
    this.n = 0;                         // frames recorded so far
    this.head = 0;
    this.baseDt = 16.7; this.baseWork = 4; this.baseHoles = 0;
    this.flash = 0;
    this.started = performance.now();
    this.log = [];
    this.lastEvent = -1e9;
    this.total = 0;                     // frames ever recorded
    this.marks = [];                    // { n, t, kind }
    window.twLog = this.log;
    addEventListener('keydown', (e) => {
      if (e.code === 'KeyL' && navigator.clipboard) {
        navigator.clipboard.writeText(JSON.stringify(this.log, null, 1)).catch(() => {});
      }
    });
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.dpr = dpr;
    this.W = 260; this.H = 82;
    canvas.width = this.W * dpr; canvas.height = this.H * dpr;
    canvas.style.width = this.W + 'px'; canvas.style.height = this.H + 'px';
  }

  // dt: ms since previous frame. work: ms spent in our code this frame.
  // info: { holes, queued, alt, agl, speed, near }
  frame(now, dt, work, info) {
    if (dt > 1000) return;              // tab was in the background
    const i = this.head;
    this.dt[i] = dt; this.work[i] = work; this.holes[i] = info.holes || 0;
    this.n = Math.min(N, this.n + 1);
    this.total++;
    if (info.terrTiles) this.marks.push({ n: this.total, t: now, kind: 'terrain' });
    if (info.nearTiles) this.marks.push({ n: this.total, t: now, kind: 'near' });
    if (info.switched) this.marks.push({ n: this.total, t: now, kind: 'switch', what: info.switched });
    while (this.marks.length && this.total - this.marks[0].n >= N) this.marks.shift();
    this.head = (i + 1) % N;

    // Baseline: refreshed a few times a second, from the last ~2 s of frames.
    if ((this.head & 7) === 0 && this.n >= 40) {
      const k = Math.min(this.n, 120);
      const d = new Float32Array(k), w = new Float32Array(k), h = new Float32Array(k);
      for (let j = 0; j < k; j++) {
        const idx = (this.head - 1 - j + N) % N;
        d[j] = this.dt[idx]; w[j] = this.work[idx]; h[j] = this.holes[idx];
      }
      this.baseDt = median(d, k); this.baseWork = median(w, k); this.baseHoles = median(h, k);
    }

    const warm = now - this.started > WARM_MS && this.n >= 40;
    const slowAt = this.slowLevel();
    const workAt = Math.max(this.baseWork * 3, this.baseWork + 8);
    const holeAt = this.baseHoles + Math.max(3, this.baseHoles);
    const slow = dt > slowAt, heavy = work > workAt, holey = info.holes > holeAt;
    const strain = warm && (slow || heavy || holey);
    this.flag[i] = strain ? 1 : 0;

    if (strain) {
      this.flash = 1;
      if (now - this.lastEvent > 400) {      // one event per burst
        this.lastEvent = now;
        this.log.push({
          t: +((now - this.started) / 1000).toFixed(1),
          why: [slow && 'slow frame', heavy && 'our code', holey && 'holes'].filter(Boolean).join('+'),
          frameMs: +dt.toFixed(1), codeMs: +work.toFixed(1),
          normalMs: +this.baseDt.toFixed(1),
          holes: info.holes, queued: info.queued,
          alt: Math.round(info.alt), agl: info.agl === null ? null : Math.round(info.agl),
          speed: Math.round(info.speed), near: info.near,
          uploadMs: +(info.upMs || 0).toFixed(1),
          justBefore: this.marks.filter((m) => now - m.t < 600).map((m) => m.what || m.kind),
        });
        if (this.log.length > 60) this.log.shift();
      }
    }
    this.draw();
  }

  slowLevel() { return Math.max(this.baseDt * 2, this.baseDt + 10); }

  draw() {
    const c = this.ctx, d = this.dpr, W = this.W, H = this.H;
    c.setTransform(d, 0, 0, d, 0, 0);
    c.clearRect(0, 0, W, H);
    c.fillStyle = 'rgba(12,16,22,.72)'; c.fillRect(0, 0, W, H);

    const top = 12, gh = 46, hy = top + gh + 6, hh = 14;
    const scale = Math.max(this.baseDt * 4, 40);        // full height, ms
    const bw = (W - 8) / N;
    const slowAt = this.slowLevel();

    for (let j = 0; j < this.n; j++) {
      const idx = (this.head - this.n + j + N) % N;
      const x = 4 + (N - this.n + j) * bw;
      const h = Math.min(gh, (this.dt[idx] / scale) * gh);
      c.fillStyle = this.flag[idx] ? '#ff3b30' : '#3ddc84';
      c.fillRect(x, top + gh - h, Math.max(1, bw - 0.4), h);
      // holes strip
      const hv = this.holes[idx];
      if (hv > 0) {
        c.fillStyle = hv > this.baseHoles + Math.max(3, this.baseHoles) ? '#ff3b30' : '#ffb340';
        c.fillRect(x, hy + hh - Math.min(hh, 1 + hv), Math.max(1, bw - 0.4), Math.min(hh, 1 + hv));
      }
      if (this.flag[idx] && (j === 0 || !this.flag[(idx - 1 + N) % N])) {
        c.fillStyle = '#fff';
        c.fillRect(x, top, 1, gh + hh + 6);     // event tick
      }
    }
    // what the engine was doing, as coloured squares along the top
    for (const m of this.marks) {
      const x = 4 + (N - (this.total - m.n) - 1) * bw;
      c.fillStyle = MARKS[m.kind]; c.fillRect(x, 3, Math.max(2, bw), 6);
    }
    // our own code's time
    c.strokeStyle = '#4fd1ff'; c.lineWidth = 1; c.beginPath();
    for (let j = 0; j < this.n; j++) {
      const idx = (this.head - this.n + j + N) % N;
      const x = 4 + (N - this.n + j) * bw;
      const y = top + gh - Math.min(gh, (this.work[idx] / scale) * gh);
      if (j === 0) c.moveTo(x, y); else c.lineTo(x, y);
    }
    c.stroke();
    // the moving "too slow" line
    const ly = top + gh - Math.min(gh, (slowAt / scale) * gh);
    c.strokeStyle = 'rgba(255,255,255,.55)'; c.setLineDash([3, 3]);
    c.beginPath(); c.moveTo(4, ly); c.lineTo(W - 4, ly); c.stroke(); c.setLineDash([]);

    // fading red border
    if (this.flash > 0.02) {
      c.strokeStyle = `rgba(255,59,48,${this.flash.toFixed(2)})`; c.lineWidth = 4;
      c.strokeRect(2, 2, W - 4, H - 4);
      this.flash *= 0.96;
    }
  }
}
