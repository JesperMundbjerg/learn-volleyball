// Volleyball domain logic for the 5-1 system.
//
// Coordinates (metres), always in a team's own frame:
//   x = lateral, -4.5 (left sideline, as seen by the players facing the net) .. +4.5 (right)
//   z = distance from the net, 0 (net) .. 9 (end line)
// Our team plays on world z > 0. The opponent frame is mirrored (world = -x, -z).

import { Timeline } from './engine.js';

export const NET_H = 2.43;
export const TARGET = [1.0, 0.6];            // setter's target: right of centre, ~0.6 m off the net
const SERVE_SPOT = [2.6, 9.9];
const BENCH = [-5.7, 4.5];                   // libero replacement zone / bench side
const OPP_SZ = 1;                            // opponent plays "rotation 1" for context

export const ROT_ORDER = ['S', 'OH1', 'MB1', 'OPP', 'OH2', 'MB2']; // clockwise order starting with the setter
export const OUR_ROLES = ['S', 'OH1', 'OH2', 'MB1', 'MB2', 'OPP', 'L'];
export const ROLE_INFO = {
  S:   { name: 'Setter',           color: '#facc15' },
  OH1: { name: 'Outside hitter 1', color: '#22d3ee' },
  OH2: { name: 'Outside hitter 2', color: '#60a5fa' },
  MB1: { name: 'Middle blocker 1', color: '#4ade80' },
  MB2: { name: 'Middle blocker 2', color: '#a3e635' },
  OPP: { name: 'Opposite',         color: '#c084fc' },
  L:   { name: 'Libero',           color: '#fb923c' },
};
export const OPP_COLOR = '#ef4444';

export function lineup(sz) {
  const z = {};
  ROT_ORDER.forEach((r, i) => { z[r] = ((sz - 1 + i) % 6) + 1; });
  return z;
}
export const isFront = z => z >= 2 && z <= 4;

// Hand-built, overlap-legal serve-receive formations keyed by the setter's zone.
// Passers are always OH1, OH2 and the libero; the other three hide.
const RECEIVE = {
  1: { S: [4.0, 6.2], OH1: [2.6, 5.4], MB1: [0.2, 0.9], OPP: [-3.2, 0.8], OH2: [-2.9, 5.9], L: [0.0, 6.3] },
  6: { S: [1.0, 1.8], OH1: [2.8, 6.0], MB1: [3.3, 0.9], OPP: [0.4, 0.7], OH2: [-2.8, 4.8], L: [-0.3, 6.2] },
  5: { S: [-3.0, 1.7], OH1: [0.2, 6.2], L: [2.8, 6.0], OPP: [3.6, 0.8], OH2: [-2.4, 4.8], MB2: [-3.6, 0.7] },
  4: { S: [-0.6, 0.6], OH1: [-2.8, 6.0], L: [0.0, 6.3], OPP: [3.9, 7.3], OH2: [2.6, 4.8], MB2: [0.3, 1.0] },
  3: { OH1: [-2.8, 4.8], S: [0.4, 0.7], MB2: [2.9, 0.9], L: [-0.4, 6.2], OPP: [1.2, 7.9], OH2: [3.0, 6.0] },
  2: { MB1: [-3.6, 0.8], OH1: [-2.4, 4.8], S: [2.4, 0.6], OPP: [-3.8, 7.6], OH2: [0.1, 6.2], L: [2.9, 6.0] },
};

const ZONE_XY = { 1: [3, 6], 2: [3, 1.2], 3: [0, 1.2], 4: [-3, 1.2], 5: [-3, 6], 6: [0, 6.5] };
// Specialist ("switched") positions: LF/MF/RF front row, LB/MB/RB back row.
const BASE = { LF: [-3, 0.8], MF: [0, 0.8], RF: [3, 0.8], LB: [-3.2, 6], MB: [0, 7], RB: [3.2, 6] };

const ATTACKS = {
  OH:   { start: [-4.4, 3.6], hit: [-3.7, 0.6], set: { dur: 1.25, h: 2.3 } },
  MB:   { start: [0.3, 2.8],  hit: [0.2, 0.5],  set: { dur: 0.4,  h: 0.25 } },
  OPP:  { start: [4.4, 3.6],  hit: [3.8, 0.6],  set: { dur: 1.05, h: 1.9 } },
  D:    { start: [3.3, 7.0],  hit: [3.1, 3.3],  set: { dur: 1.05, h: 2.0 } },
  PIPE: { start: [0.0, 7.2],  hit: [0.3, 3.3],  set: { dur: 0.95, h: 1.7 } },
};
// Landing spots in the attacker's frame (negative z = other side of the net). First entry is the default.
const LANDINGS = {
  OH:   [[2.8, -6.5], [-3.9, -7.8], [1.2, -3.2]],
  MB:   [[-1.8, -4.0], [1.8, -4.5]],
  OPP:  [[-2.8, -6.5], [3.9, -7.8]],
  D:    [[-2.5, -7.5], [3.8, -8.3]],
  PIPE: [[0.5, -7.8], [-2.0, -6.8]],
};

// ---------- helpers ----------
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp2 = (a, b, u) => [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u];
const add = (a, b) => [a[0] + b[0], a[1] + b[1]];
const rand = (rnd, a, b) => a + rnd() * (b - a);
const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length)];
const jit = (rnd, p, a) => (rnd ? [p[0] + (rnd() - 0.5) * 2 * a, p[1] + (rnd() - 0.5) * 2 * a] : p);

export function mulberry32(seed) {
  return function () {
    seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Extra arc height needed for a ball flight (world coords) to clear the net.
function arcOverNet(a, b, minH = 0) {
  if (a[2] === b[2] || Math.sign(a[2]) === Math.sign(b[2])) return minH;
  const u = a[2] / (a[2] - b[2]);
  const yLin = a[1] + (b[1] - a[1]) * u;
  return Math.max(minH, (NET_H + 0.3 - yLin) / (4 * u * (1 - u)));
}

function defenseSlots(ax) {
  if (ax > 1.4) {
    const rf = Math.min(ax, 4.0) - 0.15;
    return { LF: [-2.6, 3.2], MF: [rf - 0.85, 0.35], RF: [rf, 0.35], LB: [-3.1, 5.9], MB: [0.9, 8.2], RB: [3.8, 5.8] };
  }
  if (ax < -1.4) {
    const lf = Math.max(ax, -4.0) + 0.15;
    return { LF: [lf, 0.35], MF: [lf + 0.85, 0.35], RF: [2.6, 3.2], LB: [-3.8, 5.8], MB: [-0.9, 8.2], RB: [3.1, 5.9] };
  }
  return { LF: [-2.7, 2.8], MF: [ax, 0.35], RF: [2.7, 2.8], LB: [-3.1, 6.0], MB: [0, 7.8], RB: [3.1, 6.0] };
}
const blockSlots = ax => (ax > 1.4 ? ['RF', 'MF'] : ax < -1.4 ? ['LF', 'MF'] : ['MF']);

// Coverage cup around a hitter: three close, two deep, oriented towards the middle of the court.
function coverageSlots([hx, hz]) {
  let dx = -hx * 0.55, dz = 4.6 - hz;
  const L = Math.hypot(dx, dz); dx /= L; dz /= L;
  const at = (a, r) => {
    const c = Math.cos(a), s = Math.sin(a);
    return [clamp(hx + (dx * c - dz * s) * r, -4.3, 4.3), clamp(hz + (dx * s + dz * c) * r, 0.9, 8.6)];
  };
  return [at(-1.0, 1.8), at(0, 2.0), at(1.0, 1.8), at(-0.35, 4.6), at(0.35, 4.6)];
}

// Brute-force minimum total distance assignment (at most 6 players).
function bestAssign(froms, slots) {
  let best = null, bestCost = Infinity;
  const used = new Array(slots.length).fill(false), cur = [];
  (function rec(i, cost) {
    if (cost >= bestCost) return;
    if (i === froms.length) { bestCost = cost; best = [...cur]; return; }
    for (let j = 0; j < slots.length; j++) {
      if (used[j]) continue;
      used[j] = true; cur.push(j);
      rec(i + 1, cost + dist(froms[i], slots[j]));
      used[j] = false; cur.pop();
    }
  })(0, 0);
  return best;
}

// ---------- team ----------
class Team {
  constructor(tl, { prefix, sz, sign, serving }) {
    Object.assign(this, { tl, prefix, sz, sign, serving });
    const zone = lineup(sz);
    this.rotZone = zone;
    const front = r => isFront(zone[r]);
    this.OH_F = front('OH1') ? 'OH1' : 'OH2';
    this.OH_B = this.OH_F === 'OH1' ? 'OH2' : 'OH1';
    this.MB_F = front('MB1') ? 'MB1' : 'MB2';
    this.MB_B = this.MB_F === 'MB1' ? 'MB2' : 'MB1';
    this.setterFront = front('S');
    this.server = serving ? ROT_ORDER.find(r => zone[r] === 1) : null;
    // The libero replaces the back-row middle, except when that middle is the one serving.
    this.liberoIn = !(serving && this.server === this.MB_B);
    this.bench = this.liberoIn ? this.MB_B : 'L';
    this.zoneOf = {};
    for (const r of ROT_ORDER) this.zoneOf[r === this.MB_B && this.liberoIn ? 'L' : r] = zone[r];
    this.onCourt = Object.keys(this.zoneOf);
    // H1 receive: the opposite starts in zone 4 and OH1 in zone 2, so they don't switch –
    // OH1 attacks from the right, the opposite from the left.
    this.noSwitch = !prefix && !serving && sz === 1;
    this.slots = {
      LF: this.noSwitch ? 'OPP' : this.OH_F, MF: this.MB_F,
      RF: this.noSwitch ? this.OH_F : this.setterFront ? 'S' : 'OPP',
      LB: this.liberoIn ? 'L' : this.MB_B, MB: this.OH_B, RB: this.setterFront ? 'OPP' : 'S',
    };
    this.slotOf = Object.fromEntries(Object.entries(this.slots).map(([s, r]) => [r, s]));
  }
  id(r) { return this.prefix + r; }
  w(p) { return [p[0] * this.sign, p[1] * this.sign]; }
  w3(p, y) { return [p[0] * this.sign, y, p[1] * this.sign]; }
  pos(r, t) { return this.w(this.tl.pos(this.id(r), t)); }
  place(r, p) { this.tl.place(this.id(r), this.w(p)); }
  move(r, p, t0, dur) { this.tl.move(this.id(r), this.w(p), t0, dur); }
  moveAuto(r, p, t0, speed = 4.5) {
    const dur = Math.max(0.35, dist(this.pos(r, t0), p) / speed + 0.2);
    this.move(r, p, t0, dur);
    return t0 + dur;
  }
  jump(r, t0, dur, h) { this.tl.jump(this.id(r), t0, dur, h); }
  jumpEnd(r) { return this.tl.jumpEnd(this.id(r)); }

  setupReceive() { const f = RECEIVE[this.sz]; for (const r of OUR_ROLES) this.place(r, f[r] || BENCH); }
  setupServe() {
    for (const r of OUR_ROLES) {
      if (r === this.server) this.place(r, SERVE_SPOT);
      else this.place(r, this.zoneOf[r] ? ZONE_XY[this.zoneOf[r]] : BENCH);
    }
  }
  setupBase() { for (const r of OUR_ROLES) this.place(r, this.slotOf[r] ? BASE[this.slotOf[r]] : BENCH); }

  receivers() { return ['OH1', 'OH2', 'L'].filter(r => this.onCourt.includes(r)); }
  hitterList() {
    return [[this.OH_F, 'OH'], [this.MB_F, 'MB'], ['OPP', this.setterFront ? 'D' : 'OPP'], [this.OH_B, 'PIPE']]
      .filter(([r]) => this.onCourt.includes(r));
  }
  hitterFor(type) { return { OH: this.OH_F, MB: this.MB_F, OPP: 'OPP', D: 'OPP', PIPE: this.OH_B }[type]; }
  // Which ATTACKS/LANDINGS geometry an attack type uses (outside and opposite trade sides when not switching).
  spot(type) { return this.noSwitch ? ({ OH: 'OPP', OPP: 'OH' }[type] || type) : type; }
  resolveType(t) {
    if (t === 'OPP' && this.setterFront) return 'D';
    if (t === 'D' && !this.setterFront) return 'OPP';
    return t;
  }
  tag(r) {
    if (this.prefix) return `<span class="tag opp" style="--c:${OPP_COLOR}">their ${r.replace(/\d/, '')}</span>`;
    return `<span class="tag" style="--c:${ROLE_INFO[r].color}">${r}</span>`;
  }
}

export function checkOverlap(T, t = 0) {
  const P = {};
  for (const r of T.onCourt) if (r !== T.server) P[T.zoneOf[r]] = T.pos(r, t);
  const issues = [];
  for (const [f, b] of [[4, 5], [3, 6], [2, 1]]) {
    if (P[f] && P[b] && !(P[f][1] < P[b][1])) issues.push(`zone ${f} must be closer to the net than zone ${b}`);
  }
  for (const [l, r] of [[4, 3], [3, 2], [5, 6], [6, 1]]) {
    if (P[l] && P[r] && !(P[l][0] < P[r][0])) issues.push(`zone ${l} must be left of zone ${r}`);
  }
  return issues;
}

// ---------- rally building blocks ----------
function serve(S, R, t, target) {
  const tl = S.tl, server = S.server;
  const hand = [SERVE_SPOT[0], SERVE_SPOT[1] - 0.35];
  tl.ball(S.w3([SERVE_SPOT[0], SERVE_SPOT[1] - 0.3], 1.2), S.w3(hand, 3.0), t - 0.9, 0.9, 1.1, 'toss');
  S.jump(server, t - 0.3, 0.6, 0.35);

  let receiver = null, best = Infinity;
  for (const r of R.receivers()) {
    const d = dist(R.pos(r, t), target);
    if (d < best) { best = d; receiver = r; }
  }
  const from = S.w3(hand, 3.0), to = R.w3(target, 0.8), dur = 1.4;
  tl.ball(from, to, t, dur, arcOverNet(from, to, 1.0), 'serve');
  R.move(receiver, target, t + 0.3, dur - 0.35);

  // Serving team: server runs in, everybody switches to their specialist spot.
  S.move(server, BASE[S.slotOf[server]], t + 0.35, 1.5);
  for (const r of S.onCourt) if (r !== server) S.move(r, BASE[S.slotOf[r]], t + 0.25, 1.3);
  return { receiver, tPass: t + dur, passPos: target };
}

function offense(A, D, o) {
  const tl = A.tl;
  let type = A.resolveType(o.type);
  if (A.hitterFor(type) === o.setter) type = 'OH';
  const atk = ATTACKS[A.spot(type)];
  const hitter = A.hitterFor(type);
  const busy = o.busy || {};
  const start = r => Math.max(o.prepFrom, busy[r] ?? -Infinity);
  const hitters = A.hitterList().filter(([r]) => r !== o.setter);

  // 1. Transition: everyone who can attack opens up to their approach spot.
  for (const [r, tp] of hitters) A.moveAuto(r, ATTACKS[A.spot(tp)].start, start(r), 5.0);

  // 2. Set.
  const ts = o.tSet, ta = ts + atk.set.dur;
  const setY = o.setY ?? 2.6;
  const hitY = type === 'PIPE' || type === 'D' ? 3.0 : 3.15;
  const hitPt = A.w3(atk.hit, hitY);
  tl.ball(A.w3(o.setPos, setY), hitPt, ts, atk.set.dur, atk.set.h + (setY < 2 ? 0.8 : 0), 'set');

  // 3. Hitter approach + jump (apex at contact).
  A.move(hitter, atk.hit, ta - 0.85, 0.8);
  A.jump(hitter, ta - 0.45, 0.9, 0.95);

  // 4. Decoys: the middle always fakes the quick, the pins run a partial approach.
  const free = {};
  for (const [r, tp] of hitters) {
    if (r === hitter) continue;
    const a = ATTACKS[A.spot(tp)];
    if (tp === 'MB') {
      const tj = ts - 0.05, t0 = Math.max(tj - 0.5, start(r) + 0.2);
      A.move(r, a.hit, t0, Math.max(0.3, tj - t0));
      A.jump(r, tj, 0.75, 0.8);
      free[r] = tj + 0.75;
    } else {
      A.move(r, lerp2(a.start, a.hit, 0.55), ta - 0.8, 0.6);
      free[r] = ta - 0.15;
    }
  }

  // 5. Coverage cup.
  const slots = coverageSlots(atk.hit);
  const cov = A.onCourt.filter(r => r !== hitter);
  const perm = bestAssign(cov.map(r => A.pos(r, ta - 0.4)), slots);
  const cover = {};
  const attackers = new Set(hitters.map(([r]) => r));
  cov.forEach((r, i) => {
    cover[r] = slots[perm[i]];
    if (!attackers.has(r) && r !== o.setter) {
      // Non-attackers (e.g. the libero after passing) head for their cover spot as soon as they're free.
      const st = start(r);
      A.move(r, cover[r], st, Math.max(0.5, dist(A.pos(r, st), cover[r]) / 4.5 + 0.25));
      return;
    }
    let st = ta - 0.45;
    if (r === o.setter) st = Math.max(st, ts + 0.12);
    if (free[r] != null) st = Math.max(st, free[r]);
    A.move(r, cover[r], st, 0.75);
  });

  // 6. Attack.
  let land = o.landingW;
  if (!land) {
    let p = o.rnd ? pick(o.rnd, LANDINGS[A.spot(type)]) : LANDINGS[A.spot(type)][0];
    p = jit(o.rnd, p, 0.6);
    land = A.w([clamp(p[0], -4.3, 4.3), clamp(p[1], -8.7, -1)]);
  }
  const info = { ts, ta, type, hitter, hitW: hitPt, landingW: land, setter: o.setter, cover };
  if (o.outcome === 'blocked') return info;

  const landY = o.outcome === 'dig' ? 0.7 : 0;
  const to = [land[0], landY, land[1]];
  const d = Math.hypot(to[0] - hitPt[0], to[2] - hitPt[2]);
  const dur = o.tip ? 0.95 : clamp(d / 16, 0.35, 0.8);
  tl.ball(hitPt, to, ta, dur, arcOverNet(hitPt, to, o.tip ? 0.9 : 0), 'attack');
  info.tLand = ta + dur;
  if (landY === 0) {
    const dx = (to[0] - hitPt[0]) / d, dz = (to[2] - hitPt[2]) / d;
    tl.ball(to, [to[0] + dx * 2.4, 0, to[2] + dz * 2.4], info.tLand, 0.7, 0.8, 'bounce');
  }
  return info;
}

function defend(D, A, info, o = {}) {
  const ax = D.sign * info.hitW[0];
  const pts = defenseSlots(ax), blk = blockSlots(ax);
  const t0 = info.ts + 0.12, md = Math.max(0.3, info.ta - 0.3 - t0);
  for (const [s, r] of Object.entries(D.slots)) D.move(r, pts[s], t0, md);
  for (const s of blk) D.jump(D.slots[s], info.ta - 0.2, 0.8, 0.75);
  const blockers = blk.map(s => D.slots[s]);
  if (o.blocked) return { blockers };

  const land = D.w(info.landingW);
  const cands = Object.keys(D.slots).filter(s => !blk.includes(s));
  let ds = cands[0];
  for (const s of cands) if (dist(pts[s], land) < dist(pts[ds], land)) ds = s;
  const digger = D.slots[ds];
  if (o.dig) {
    D.move(digger, land, info.ta + 0.02, Math.max(0.2, info.tLand - info.ta - 0.05));
    return { digger, tDig: info.tLand, digPos: land, blockers };
  }
  const d = dist(pts[ds], land);
  D.move(digger, lerp2(pts[ds], land, clamp(1 - 0.9 / Math.max(d, 0.9), 0, 1)), info.ta + 0.02, info.tLand - info.ta + 0.15);
  return { digger, blockers };
}

function digAndCounter(T, O, dg, o) {
  const tl = T.tl, { digger, tDig, digPos } = dg;
  let setter = 'S';
  if (digger === 'S') setter = T.onCourt.includes('L') ? 'L' : 'OPP';
  const lSet = setter !== 'S';
  const setPos = o.setPos || (lSet ? [0.6, 3.6] : [1.0, 1.2]);
  const setY = lSet ? 1.0 : 2.5;
  const dd = 1.5;
  tl.ball(T.w3(digPos, 0.7), T.w3(setPos, setY), tDig, dd, lSet ? 1.8 : 3.2, o.kind || 'dig');
  const st = Math.max(tDig - 0.25, T.jumpEnd(setter) + 0.02);
  T.move(setter, setPos, st, Math.max(0.45, tDig + dd - 0.1 - st));
  const info = offense(T, O, {
    tSet: tDig + dd, setter, setPos, setY, type: o.type, prepFrom: tDig + 0.12,
    busy: { [digger]: tDig + 0.15 }, landingW: o.landingW, outcome: o.outcome, rnd: o.rnd,
  });
  return { ...info, digger };
}

function sideOut(R, S, t0, o) {
  const tl = R.tl;
  const sv = serve(S, R, t0, o.serveTarget);
  const dS = dist(R.pos('S', t0), TARGET);
  R.move('S', TARGET, t0 + 0.1, clamp(dS / 4.5 + 0.3, 0.8, 2.4));
  const tSet = sv.tPass + 1.35;
  tl.ball(R.w3(sv.passPos, 0.8), R.w3(TARGET, 2.6), sv.tPass, 1.35, 2.4, 'pass');
  const off = offense(R, S, {
    tSet, setter: 'S', setPos: TARGET, type: o.type, prepFrom: t0 + 0.6,
    busy: { ...Object.fromEntries(R.receivers().map(r => [r, sv.tPass])), [sv.receiver]: sv.tPass + 0.1 }, landingW: o.landingW, outcome: o.outcome, tip: o.tip, rnd: o.rnd,
  });
  return { ...sv, ...off };
}

// ---------- captions ----------
const ATTACK_TEXT = {
  OH: (T, h) => T.noSwitch
    ? `High ball to the right side. In H1 receive ${T.tag(h)} stays in zone 2 (no switch with the opposite) and attacks from the right.`
    : `High ball to the outside. ${T.tag(h)} starts wide outside the sideline around the 3 m line and swings in to hit from zone 4.`,
  MB: (T, h) => `Quick (1st tempo) set. ${T.tag(h)} is already in the air as the setter touches the ball – the set goes straight into the hitting hand just in front of the setter.`,
  OPP: (T, h) => T.noSwitch
    ? `Front set to the left side. In H1 receive ${T.tag(h)} stays in zone 4 (no switch with the outside) and attacks from the left.`
    : `Back set to the right side. ${T.tag(h)} attacks from zone 2 (a left-hander is ideal here).`,
  D: (T, h) => `The setter is front row, so ${T.tag(h)} attacks from the back row ("D" ball) – take-off must be behind the 3 m line.`,
  PIPE: (T, h) => `Pipe: ${T.tag(h)} attacks from the back row through the middle, taking off behind the 3 m line.`,
};

const rotLine = T =>
  `<b>H${T.sz}</b> – setter in zone ${T.sz}, ${T.setterFront
    ? 'front row: only two front-row hitters (the opposite can hit from the back row).'
    : 'back row: three front-row hitters available.'}${T.noSwitch
    ? ' In receive the opposite (zone 4) and OH1 (zone 2) do <b>not</b> switch – each attacks from the side they start on.'
    : ''}`;

function switchText(T) {
  const s = T.slots, g = r => T.tag(r);
  return `After the serve contact everyone switches to their specialist spot. Front: ${g(s.LF)} left, ${g(s.MF)} middle, ${g(s.RF)} right. Back: ${g(s.LB)} left, ${g(s.MB)} middle, ${g(s.RB)} right.`;
}

function defenseText(D, ax, who) {
  const s = D.slots, g = r => D.tag(r);
  if (ax > 1.4) return `${g(s.RF)} + ${g(s.MF)} close a 2-person block on ${who}. ${g(s.LF)} pulls off the net for the sharp cross, ${g(s.LB)} digs cross-court, ${g(s.RB)} guards the line, ${g(s.MB)} covers deep.`;
  if (ax < -1.4) return `${g(s.LF)} + ${g(s.MF)} block ${who} on our left. ${g(s.RF)} pulls off the net, ${g(s.RB)} digs cross-court, ${g(s.LB)} guards the line, ${g(s.MB)} covers deep.`;
  return `${g(s.MF)} reads the quick and blocks ${who} alone. The pins ${g(s.LF)} and ${g(s.RF)} drop off for tips, the back row spreads out.`;
}

function digText(T, dg, setter) {
  const d = T.tag(dg.digger);
  if (setter === 'L') return `${d} made the dig, so the libero ${T.tag('L')} takes the second ball – as a bump set from behind the 3 m line (a libero finger-set in front of the line can't be attacked above the net).`;
  if (setter === 'OPP') return `${d} made the dig, so ${T.tag('OPP')} takes the second ball.`;
  return `${d} digs high to the middle. ${T.tag('S')} ${T.setterFront ? 'lands from the block and turns' : 'releases from right-back'} to set the counter-attack.`;
}

function serveTargetFor(R, rnd) {
  return rnd ? [rand(rnd, -3.8, 3.8), rand(rnd, 4.3, 8.2)] : add(R.pos('L', 0), [0.4, 0.3]);
}

function newRally(sz, weServe) {
  const tl = new Timeline();
  const us = new Team(tl, { prefix: '', sz, sign: 1, serving: weServe });
  const op = new Team(tl, { prefix: 'o', sz: OPP_SZ, sign: -1, serving: !weServe });
  if (weServe) { us.setupServe(); op.setupReceive(); } else { us.setupReceive(); op.setupServe(); }
  return { tl, us, op };
}

// serveT: time of the serve contact (overlap rule applies until then); null for mid-rally scenarios.
function finish(tl, us, op, serveT) {
  tl.bump(tl.end + 1.2);
  return { tl, us, op, serveT, benched: [us.id(us.bench), op.id(op.bench)], legal: serveT == null ? null : checkOverlap(us, 0) };
}

const ids = (T, rs) => rs.map(r => T.id(r));

// ---------- scenarios ----------
function scnSideOut(ctx, type) {
  const { tl, us, op } = newRally(ctx.sz, false);
  const rnd = ctx.rnd, t0 = 2.4;
  const so = sideOut(us, op, t0, { type, serveTarget: serveTargetFor(us, rnd), rnd, outcome: 'kill' });
  defend(op, us, so);

  const recv = us.receivers(), hidden = us.onCourt.filter(r => !recv.includes(r));
  tl.phase(0, 'Serve-receive formation',
    `${rotLine(us)} ${recv.map(r => us.tag(r)).join(', ')} form the passing line; ${hidden.map(r => us.tag(r)).join(', ')} hide out of the passing lanes – while still respecting the overlap rule.`,
    ids(us, recv));
  tl.phase(t0 - 1.0, 'Opponent serves', 'Passers low and still, weight forward. Everyone watches the server.');
  tl.phase(t0 + 0.05, 'Setter releases',
    `The moment the serve is hit, ${us.tag('S')} sprints to the target – right of centre, about 1 m off the net. Hitters start opening up to their approach spots.`,
    ids(us, ['S']));
  tl.phase(so.tPass, 'Pass', `${us.tag(so.receiver)} passes to the target. Hitters are loading their approaches.`, ids(us, [so.receiver]));
  tl.phase(so.ts, 'Set', ATTACK_TEXT[so.type](us, so.hitter), ids(us, [so.hitter]));
  tl.phase(Math.max(so.ts + 0.2, so.ta - 0.45), 'Attack & coverage',
    `While ${us.tag(so.hitter)} attacks, the other five form a coverage cup – three close around the hitter, two deeper – in case the ball is blocked back.`);
  tl.phase(so.tLand, 'Kill – side-out!', 'The receiving team wins the point, gets the serve and rotates one step clockwise.');
  return finish(tl, us, op, t0);
}

function scnServe(ctx, oppType, variant) {
  const { tl, us, op } = newRally(ctx.sz, true);
  const rnd = ctx.rnd, t0 = 2.4;
  const ax = op.w(ATTACKS[op.resolveType(oppType)].hit)[0]; // their hitter's x in our frame
  const pts = defenseSlots(ax);
  let land;
  if (variant === 'deep') land = jit(rnd, ax > 0 ? [-4.1, 8.5] : [4.1, 8.5], 0.3);
  else if (variant === 'tip') land = jit(rnd, ax > 0 ? [2.5, 2.3] : [-2.5, 2.3], 0.4);
  else if (rnd) land = jit(rnd, pts[pick(rnd, ['LB', 'RB', 'MB'])], 0.7);
  else land = ax > 1.4 ? [-3.0, 6.2] : ax < -1.4 ? [-3.8, 6.4] : [-2.3, 5.8];
  land = [clamp(land[0], -4.3, 4.3), clamp(land[1], 1.5, 8.7)];

  const so = sideOut(op, us, t0, {
    type: oppType, serveTarget: serveTargetFor(op, rnd), landingW: us.w(land), outcome: 'dig', tip: variant === 'tip', rnd,
  });
  const dg = defend(us, op, so, { dig: true });
  const ctType = rnd ? pick(rnd, ['OH', 'OPP', 'PIPE']) : 'OH';
  const ct = digAndCounter(us, op, dg, { type: ctType, setPos: variant === 'deep' ? [0.2, 3.0] : undefined, rnd, outcome: 'kill' });
  defend(op, us, ct);

  const libLine = us.liberoIn
    ? `The libero ${us.tag('L')} is in for the back-row middle ${us.tag(us.MB_B)}.`
    : `The libero is off: middle ${us.tag(us.MB_B)} is serving and plays left-back this rally.`;
  tl.phase(0, 'Serving formation',
    `${rotLine(us)} ${us.tag(us.server)} serves. Everyone else holds rotational order until the ball is struck. ${libLine}`,
    ids(us, [us.server]));
  tl.phase(t0 + 0.2, 'Switch to base', switchText(us));
  tl.phase(so.tPass, 'Opponent pass', 'Hold base and read: blockers watch the pass, then the setter\'s hands, then the hitter.');
  tl.phase(so.ts, 'Read & block', defenseText(us, ax, op.tag(so.hitter)), ids(us, dg.blockers));
  if (variant === 'deep') {
    tl.phase(so.ta, 'Deep corner!', `Hard cross deep into the zone 5 corner. ${us.tag(dg.digger)} must move back fast and play the ball high – height beats accuracy here.`, ids(us, [dg.digger]));
    tl.phase(dg.tDig, 'Out of system', `The dig lands off the net, so ${us.tag(ct.setter)} chases it and the hitters call for a high ball to the outside. ${digText(us, dg, ct.setter)}`, ids(us, [ct.setter]));
  } else if (variant === 'tip') {
    tl.phase(so.ta, 'Tip over the block!', `A soft shot behind the block. In perimeter defense the line defender ${us.tag(dg.digger)} is responsible for short balls behind the block.`, ids(us, [dg.digger]));
    tl.phase(dg.tDig, 'Dig', digText(us, dg, ct.setter), ids(us, [ct.setter]));
  } else {
    tl.phase(so.ta, 'Attack', `${op.tag(so.hitter)} attacks. Defenders are low and still as the ball is hit.`, ids(us, [dg.digger]));
    tl.phase(dg.tDig, 'Dig', digText(us, dg, ct.setter), ids(us, [ct.setter]));
  }
  tl.phase(ct.ts, 'Counter-attack', `Front-row players backed off the net to their approach spots – this is transition. ${ATTACK_TEXT[ct.type](us, ct.hitter)}`, ids(us, [ct.hitter]));
  tl.phase(ct.tLand, 'Point – break!', 'The serving team scores, so it keeps the serve and does not rotate.');
  return finish(tl, us, op, t0);
}

function scnBlocked(ctx) {
  const { tl, us, op } = newRally(ctx.sz, false);
  const rnd = ctx.rnd, t0 = 2.4;
  const so = sideOut(us, op, t0, { type: 'OH', serveTarget: serveTargetFor(us, rnd), outcome: 'blocked', rnd });
  defend(op, us, so, { blocked: true });

  const h = so.hitW;
  const blockPt = [h[0] + 0.15, 2.95, -0.12];
  const want = [h[0] + 1.0, h[2] + 1.7];
  let cov = null, best = Infinity;
  for (const [r, p] of Object.entries(so.cover)) {
    const d = dist(p, want);
    if (d < best) { best = d; cov = r; }
  }
  const rb = so.cover[cov];
  tl.ball(h, blockPt, so.ta, 0.1, 0, 'attack');
  tl.ball(blockPt, us.w3(rb, 0.55), so.ta + 0.1, 0.7, 0.7, 'block');
  const tCover = so.ta + 0.8;
  const ct = digAndCounter(us, op, { digger: cov, tDig: tCover, digPos: rb },
    { type: rnd ? pick(rnd, ['OH', 'OPP', 'PIPE']) : 'OH', rnd, outcome: 'kill', kind: 'cover' });
  defend(op, us, ct);

  tl.phase(0, 'Serve-receive formation', `${rotLine(us)} Watch the coverage – this attack is going to be blocked.`);
  tl.phase(t0 + 0.05, 'Serve & release', `${us.tag('S')} releases to the target as the serve is hit.`, ids(us, ['S']));
  tl.phase(so.tPass, 'Pass', `${us.tag(so.receiver)} passes.`, ids(us, [so.receiver]));
  tl.phase(so.ts, 'Set to the outside', `${ATTACK_TEXT.OH(us, so.hitter)} The others move into the coverage cup.`, ids(us, [so.hitter]));
  tl.phase(so.ta, 'Blocked!', `The block stuffs the ball straight back. Because the team was already in its coverage cup, ${us.tag(cov)} is right there to keep it alive.`, ids(us, [cov]));
  tl.phase(tCover, 'Cover & recover', `${us.tag(so.hitter)} lands and immediately backs off the net to approach again – this is "recovering". ${digText(us, { digger: cov }, ct.setter)}`, ids(us, [so.hitter, ct.setter]));
  tl.phase(ct.ts, 'Second attack', ATTACK_TEXT[ct.type](us, ct.hitter), ids(us, [ct.hitter]));
  tl.phase(ct.tLand, 'Point!', 'Good coverage turned a blocked ball into a point.');
  return finish(tl, us, op, t0);
}

function scnFree(ctx) {
  const tl = new Timeline(), rnd = ctx.rnd;
  const us = new Team(tl, { prefix: '', sz: ctx.sz, sign: 1, serving: false });
  const op = new Team(tl, { prefix: 'o', sz: OPP_SZ, sign: -1, serving: false });
  us.setupBase(); op.setupBase();
  const tF = 1.8, tPass = tF + 2.1;
  const passPos = jit(rnd, [-1.0, 5.6], 0.8);
  tl.ball(op.w3(BASE.MB, 0.9), us.w3(passPos, 0.8), tF, 2.1, 3.2, 'free');
  us.move('L', passPos, tF + 0.3, 1.4);
  const dS = dist(us.pos('S', tF), TARGET);
  us.move('S', TARGET, tF + 0.15, clamp(dS / 4.5 + 0.3, 0.8, 2.2));
  tl.ball(us.w3(passPos, 0.8), us.w3(TARGET, 2.6), tPass, 1.35, 2.4, 'pass');
  const type = rnd ? pick(rnd, ['MB', 'OH', 'OPP', 'PIPE']) : 'MB';
  const off = offense(us, op, {
    tSet: tPass + 1.35, setter: 'S', setPos: TARGET, type, prepFrom: tF + 0.2, busy: { L: tPass + 0.1 }, rnd, outcome: 'kill',
  });
  defend(op, us, off);

  tl.phase(0, 'Rally – base defense', `${rotLine(us)} Mid-rally, players are in their specialist base positions.`);
  tl.phase(tF - 0.1, 'Free ball!', `The opponent can only send an easy ball over. Call "FREE!": front row drops off the net to their approach spots, ${us.tag('S')} releases to the target, ${us.tag('L')} takes the pass.`, ids(us, ['S', 'L']));
  tl.phase(tPass, 'Pass', `A perfect pass – now every attack option is open.`, ids(us, ['L']));
  tl.phase(off.ts, 'Set', ATTACK_TEXT[off.type](us, off.hitter), ids(us, [off.hitter]));
  tl.phase(off.tLand, 'Point!', 'Free balls should be converted – the team had time to run its full offense.');
  return finish(tl, us, op, null);
}

export const SCENARIOS = [
  { id: 'sr-oh',   group: 'Serve receive', name: 'Pass → outside attack', build: c => scnSideOut(c, 'OH') },
  { id: 'sr-mb',   group: 'Serve receive', name: 'Pass → middle quick',  build: c => scnSideOut(c, 'MB') },
  { id: 'sr-opp',  group: 'Serve receive', name: 'Pass → opposite',      build: c => scnSideOut(c, 'OPP') },
  { id: 'sr-pipe', group: 'Serve receive', name: 'Pass → pipe (back row)', build: c => scnSideOut(c, 'PIPE') },
  { id: 'sv-oh',   group: 'Our serve & defense', name: 'Defend their outside', build: c => scnServe(c, 'OH') },
  { id: 'sv-opp',  group: 'Our serve & defense', name: 'Defend their right side', build: c => scnServe(c, 'OPP') },
  { id: 'sv-mb',   group: 'Our serve & defense', name: 'Defend their quick', build: c => scnServe(c, 'MB') },
  { id: 'sp-block', group: 'Special situations', name: 'Our attack gets blocked', build: scnBlocked },
  { id: 'sp-deep', group: 'Special situations', name: 'Deep corner attack', build: c => scnServe(c, 'OH', 'deep') },
  { id: 'sp-tip',  group: 'Special situations', name: 'Tip over our block', build: c => scnServe(c, 'OH', 'tip') },
  { id: 'sp-free', group: 'Special situations', name: 'Free ball → attack', build: scnFree },
];

export function buildScenario(id, sz, seed, random) {
  const sc = SCENARIOS.find(s => s.id === id) || SCENARIOS[0];
  return sc.build({ sz, rnd: random ? mulberry32(seed) : null });
}
