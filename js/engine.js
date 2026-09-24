// Deterministic timeline: every entity position and the ball are pure functions of time,
// so play speed, scrubbing and stepping backwards are all trivial.

export const ease = u => (u <= 0 ? 0 : u >= 1 ? 1 : u * u * (3 - 2 * u));

export class Timeline {
  constructor() {
    this.tracks = new Map();
    this.jumps = new Map();
    this.ballSegs = [];
    this.phases = [];
    this.end = 0;
  }

  bump(t) { if (t > this.end) this.end = t; }

  place(id, p) {
    this.tracks.set(id, { init: [p[0], p[1]], segs: [] });
    this.jumps.set(id, []);
  }

  pos(id, t) {
    const tr = this.tracks.get(id);
    if (!tr) return [0, 0];
    let s = null;
    for (let i = tr.segs.length - 1; i >= 0; i--) if (tr.segs[i].t0 <= t) { s = tr.segs[i]; break; }
    if (!s) return tr.init;
    if (t >= s.t0 + s.dur) return s.to;
    const u = ease((t - s.t0) / s.dur);
    return [s.from[0] + (s.to[0] - s.from[0]) * u, s.from[1] + (s.to[1] - s.from[1]) * u];
  }

  // A new move overrides anything scheduled at or after t0 and starts from wherever the entity is.
  move(id, to, t0, dur) {
    const tr = this.tracks.get(id);
    dur = Math.max(0.05, dur);
    tr.segs = tr.segs.filter(s => s.t0 < t0);
    const from = this.pos(id, t0);
    tr.segs.push({ t0, dur, from: [from[0], from[1]], to: [to[0], to[1]] });
    this.bump(t0 + dur);
  }

  jump(id, t0, dur, h) { this.jumps.get(id).push({ t0, dur, h }); this.bump(t0 + dur); }

  jumpEnd(id) {
    let e = -Infinity;
    for (const j of this.jumps.get(id)) e = Math.max(e, j.t0 + j.dur);
    return e;
  }

  height(id, t) {
    let y = 0;
    for (const j of this.jumps.get(id)) {
      if (t > j.t0 && t < j.t0 + j.dur) y = Math.max(y, j.h * Math.sin(Math.PI * (t - j.t0) / j.dur));
    }
    return y;
  }

  // Ball flight: linear in x/z (constant horizontal speed), parabolic bump of height h on top of the straight line.
  ball(from, to, t0, dur, h = 0, kind = 'hit') {
    this.ballSegs.push({ from: [...from], to: [...to], t0, dur, h, kind });
    this.ballSegs.sort((a, b) => a.t0 - b.t0);
    this.bump(t0 + dur);
  }

  ballSegAt(t) {
    let s = null;
    for (const b of this.ballSegs) { if (b.t0 <= t) s = b; else break; }
    return s;
  }

  inFlight(t) {
    const s = this.ballSegAt(t);
    return s && t < s.t0 + s.dur ? s : null;
  }

  ballPos(t) {
    if (!this.ballSegs.length) return [0, -10, 0];
    const s = this.ballSegAt(t);
    if (!s) return this.ballSegs[0].from;
    if (t >= s.t0 + s.dur) return s.to;
    const u = (t - s.t0) / s.dur;
    return [
      s.from[0] + (s.to[0] - s.from[0]) * u,
      s.from[1] + (s.to[1] - s.from[1]) * u + 4 * s.h * u * (1 - u),
      s.from[2] + (s.to[2] - s.from[2]) * u,
    ];
  }

  phase(t, title, text, focus = []) {
    this.phases.push({ t: Math.max(0, t), title, text, focus });
    this.phases.sort((a, b) => a.t - b.t);
  }
}
