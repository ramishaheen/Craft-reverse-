// The driving simulator: a differential-drive car in a 3 × 3 m arena, an HC-SR04 that ray-casts against the
// obstacles, and the obstacle-avoiding routine of the step 9 sketch, driven by the same commands the real
// ESP32 firmware accepts. Units: cm, seconds, radians. Heading 0 faces +x; positive heading turns left (−z).

import { SKETCHES, constant } from '../code/index.js';

export const ARENA_HALF = 150;
const WALL = 2, WALL_H = 12;
export const DIRS = ['forward', 'backward', 'left', 'right', 'stop'];
export const MODES = ['manual', 'auto', 'stop'];

export const DEFAULT_OBSTACLES = [
  { id: 'box1', kind: 'box', style: 'cardboard', x: 58, z: 8, w: 24, d: 30, h: 16, rot: 0.1 },
  { id: 'box2', kind: 'box', style: 'wood', x: 88, z: -72, w: 34, d: 16, h: 12, rot: 0.6 },
  { id: 'box3', kind: 'box', style: 'cardboard', x: -70, z: -55, w: 26, d: 22, h: 18, rot: -0.4 },
  { id: 'box4', kind: 'box', style: 'wood', x: -10, z: -108, w: 70, d: 5, h: 10, rot: 0.15 },
  { id: 'box5', kind: 'box', style: 'cardboard', x: 10, z: 96, w: 22, d: 28, h: 15, rot: 0.8 },
  { id: 'box6', kind: 'box', style: 'wood', x: 112, z: 40, w: 16, d: 44, h: 10, rot: -0.2 },
  { id: 'cyl1', kind: 'cyl', style: 'can', x: -48, z: 50, r: 8, h: 16 },
  { id: 'cyl2', kind: 'cyl', style: 'pot', x: 92, z: 102, r: 13, h: 14 },
  { id: 'cyl3', kind: 'cyl', style: 'can', x: -112, z: 98, r: 8, h: 18 },
  { id: 'cyl4', kind: 'cyl', style: 'pot', x: -106, z: -4, r: 11, h: 14 },
];

export const LIMITS = { side: [4, 120], radius: [3, 45], height: [6, 40] };

export const WALLS = [
  { kind: 'box', style: 'wall', x: ARENA_HALF + WALL / 2, z: 0, w: WALL, d: ARENA_HALF * 2 + WALL * 2, h: WALL_H, rot: 0 },
  { kind: 'box', style: 'wall', x: -ARENA_HALF - WALL / 2, z: 0, w: WALL, d: ARENA_HALF * 2 + WALL * 2, h: WALL_H, rot: 0 },
  { kind: 'box', style: 'wall', x: 0, z: ARENA_HALF + WALL / 2, w: ARENA_HALF * 2, d: WALL, h: WALL_H, rot: 0 },
  { kind: 'box', style: 'wall', x: 0, z: -ARENA_HALF - WALL / 2, w: ARENA_HALF * 2, d: WALL, h: WALL_H, rot: 0 },
];

// The car's footprint as two circles along its length, and where its sensor is.
export const BODY = [{ x: 5, r: 7.6 }, { x: -4.4, r: 7.6 }];
const SONAR = { pivot: 9.75, face: 2.9, height: 7.7, half: (7.5 * Math.PI) / 180 };
const PHYS = { maxSpeed: 60, track: 13.6, slip: 0.45, spin: 0.8, tau: 0.12, servoRate: 260 };

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
function gauss() { let u = 0, v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

/** Motor targets (−100…100 %) for a direction at a speed. */
export function wheelsFor(dir, speed) {
  const s = clamp(speed, 0, 100), t = s * PHYS.spin;
  switch (dir) {
    case 'forward': return { l: s, r: s };
    case 'backward': return { l: -s, r: -s };
    case 'left': return { l: -t, r: t };
    case 'right': return { l: t, r: -t };
    default: return { l: 0, r: 0 };
  }
}
function bodyVel(l, r) {
  const vl = (l / 100) * PHYS.maxSpeed, vr = (r / 100) * PHYS.maxSpeed;
  return { v: (vl + vr) / 2, w: ((vr - vl) / PHYS.track) * PHYS.slip };
}

// ---- geometry ---------------------------------------------------------------------------------------

function toLocal(o, x, z) {
  const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
  const dx = x - o.x, dz = z - o.z;
  return [dx * c - dz * s, dx * s + dz * c];
}
/** Signed distance from a point to an obstacle's outline (negative inside). */
export function sdf(o, x, z) {
  if (o.kind === 'cyl') return Math.hypot(x - o.x, z - o.z) - o.r;
  const [lx, lz] = toLocal(o, x, z);
  const qx = Math.abs(lx) - o.w / 2, qz = Math.abs(lz) - o.d / 2;
  return Math.hypot(Math.max(qx, 0), Math.max(qz, 0)) + Math.min(Math.max(qx, qz), 0);
}
function sdfGrad(o, x, z) {
  const e = 0.05;
  const gx = sdf(o, x + e, z) - sdf(o, x - e, z), gz = sdf(o, x, z + e) - sdf(o, x, z - e);
  const n = Math.hypot(gx, gz) || 1;
  return [gx / n, gz / n];
}
/** Distance along a ray to an obstacle, or Infinity. */
function rayHit(o, ox, oz, dx, dz) {
  if (o.kind === 'cyl') {
    const fx = ox - o.x, fz = oz - o.z;
    const b = fx * dx + fz * dz, c = fx * fx + fz * fz - o.r * o.r, disc = b * b - c;
    if (disc < 0) return Infinity;
    const sq = Math.sqrt(disc), t0 = -b - sq, t1 = -b + sq;
    return t0 > 0 ? t0 : t1 > 0 ? 0 : Infinity;
  }
  const [lx, lz] = toLocal(o, ox, oz);
  const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
  const ldx = dx * c - dz * s, ldz = dx * s + dz * c;
  let tmin = -Infinity, tmax = Infinity;
  for (const [p, d, h] of [[lx, ldx, o.w / 2], [lz, ldz, o.d / 2]]) {
    if (Math.abs(d) < 1e-9) { if (p < -h || p > h) return Infinity; continue; }
    let a = (-h - p) / d, b = (h - p) / d;
    if (a > b) [a, b] = [b, a];
    tmin = Math.max(tmin, a); tmax = Math.min(tmax, b);
  }
  if (tmin > tmax || tmax < 0) return Infinity;
  return Math.max(0, tmin);
}

/** Validate and clamp an obstacle list (from storage or the editor). Returns null when unusable. */
export function cleanObstacles(list) {
  if (!Array.isArray(list)) return null;
  const out = [];
  for (const [i, o] of list.entries()) {
    if (!o || (o.kind !== 'box' && o.kind !== 'cyl')) return null;
    const num = (v, d) => (Number.isFinite(+v) ? +v : d);
    const base = { id: String(o.id || `${o.kind}${i + 1}`), kind: o.kind, x: clamp(num(o.x, 0), -ARENA_HALF, ARENA_HALF), z: clamp(num(o.z, 0), -ARENA_HALF, ARENA_HALF), h: clamp(num(o.h, 12), ...LIMITS.height) };
    if (o.kind === 'box') out.push({ ...base, style: o.style === 'wood' ? 'wood' : 'cardboard', w: clamp(num(o.w, 20), ...LIMITS.side), d: clamp(num(o.d, 20), ...LIMITS.side), rot: num(o.rot, 0) });
    else out.push({ ...base, style: o.style === 'pot' ? 'pot' : 'can', r: clamp(num(o.r, 8), ...LIMITS.radius) });
  }
  return out;
}

/** Does an obstacle overlap the car's start spot? */
export function blocksStart(o) {
  return BODY.some(c => sdf(o, c.x, 0) < c.r + 3);
}

// ---- the simulator ----------------------------------------------------------------------------------

export class RoverSim {
  constructor({ board = 'uno', obstacles = DEFAULT_OBSTACLES, onLog = () => {} } = {}) {
    this.board = board;
    this.onLog = onLog;
    this.setObstacles(obstacles);
    this.reset();
  }

  /** Routine constants, read out of the sketch the page shows for this board. */
  config() {
    const src = SKETCHES[this.board];
    const uno = this.board === 'uno';
    return {
      clear: constant(src, 'CLEAR_CM', 25), boxed: constant(src, 'BOXED_CM', 18),
      lookR: constant(src, 'LOOK_RIGHT', 30), lookL: constant(src, 'LOOK_LEFT', 150),
      stuck: constant(src, 'STUCK_MS', 1500) / 1000, repeat: constant(src, 'REPEAT_MS', 2500) / 1000,
      tHalt: uno ? 0.08 : 0.25, tR: uno ? 0.5 : 0.6, tL: uno ? 0.5 : 0.8, tC: 0.35, tBack: 0.6, beep: 0.08,
    };
  }

  setBoard(board) { this.board = board; this.cfg = this.config(); }

  setObstacles(list) {
    this.obstacles = (cleanObstacles(list) || DEFAULT_OBSTACLES).map(o => ({ ...o }));
    this.all = [...this.obstacles, ...WALLS];
  }

  reset() {
    this.cfg = this.config();
    this.t = 0;
    this.pose = { x: 0, z: 0, h: 0 };
    this.motors = { l: 0, r: 0 };
    this.travel = { l: 0, r: 0 };
    this.speed = 70;
    this.mode = 'manual';
    this.drive = 'stop';
    this.lastDrive = -Infinity;
    this.led = false;
    this.buzzer = false;
    this.manualBuzzer = false;
    this.servo = 90;
    this.servoTarget = 90;
    this.bumped = false;
    this.lastBumpLog = -Infinity;
    this.pending = new Map();
    this.reportAcc = 0;
    this.auto = this.freshAuto();
    this.measure(true);
  }

  log(text) { this.onLog(text); }
  later(key, text, delay = 0.35) { this.pending.set(key, { text, at: this.t + delay }); }

  boot() {
    this.log('RamiLabs rover · simulated');
    if (this.board === 'esp32') { this.log('ESP32-WROOM-32 · 240 MHz'); this.log('Wi-Fi access point "RamiLabs-Rover" · ws://192.168.4.1:81/'); }
    else { this.log('Arduino UNO · ATmega328P · 16 MHz'); this.log('Serial monitor · 115200 baud'); }
    this.log('HC-SR04 ok · servo at 90° · L9110S ok');
    this.log(`Distance: ${this.distance.toFixed(1)} cm`);
    this.log(`Speed: ${this.speed} %`);
  }

  /** Commands, as JSON objects: {cmd:'drive', dir} {cmd:'mode', value} {cmd:'speed', value} … */
  send(c) {
    if (!c || typeof c !== 'object') return;
    switch (c.cmd) {
      case 'drive': {
        const dir = DIRS.includes(c.dir) ? c.dir : 'stop';
        if (this.mode === 'stop') { if (dir !== 'stop') this.later('ignored', 'Ignored: motors are stopped (mode STOP)', 0); return; }
        if (this.mode === 'auto') this.setMode('manual');
        this.lastDrive = this.t;
        if (dir !== this.drive) { this.drive = dir; this.log(`Drive: ${dir.toUpperCase()}`); }
        break;
      }
      case 'speed': {
        const v = Math.round(clamp(Number(c.value) || 0, 0, 100));
        if (v !== this.speed) { this.speed = v; this.later('speed', `Speed: ${v} %`); }
        break;
      }
      case 'mode': if (MODES.includes(c.value)) this.setMode(c.value); break;
      case 'led': this.setLed(!!c.value); break;
      case 'buzzer': {
        const on = !!c.value;
        this.manualBuzzer = on;
        if (on !== this.buzzer) { this.buzzer = on; this.log(`Buzzer: ${on ? 'ON' : 'OFF'}`); }
        break;
      }
      case 'servo': {
        if (this.mode === 'auto') return;
        const v = Math.round(clamp(Number(c.value) || 0, 0, 180));
        if (v !== this.servoTarget) { this.servoTarget = v; this.later('servo', `Servo: ${v}°`); }
        break;
      }
      default: break;
    }
  }

  setMode(m) {
    if (m === this.mode) return;
    if (m === 'auto' || this.mode === 'auto') {
      this.auto = this.freshAuto();
      this.servoTarget = 90;
      this.setLed(false);
      this.buzzer = this.manualBuzzer = false;
    }
    this.mode = m;
    this.drive = 'stop';
    this.log(`Mode: ${m.toUpperCase()}`);
    if (m === 'auto' && this.speed < 25) this.log('Note: below 25 % speed the car barely moves in Auto');
    if (m === 'stop') this.log('Motors off');
  }

  setLed(on) { if (on !== this.led) { this.led = on; this.log(`LED: ${on ? 'ON' : 'OFF'}`); } }

  freshAuto() {
    this.autoRuns = (this.autoRuns || 0) + 1;
    return { state: 'cruise', t: 0, ref: this.distance ?? 400, refAt: this.t ?? 0, left: 0, right: 0, turn: 'left', turnTime: 0, lastTurn: null, lastTurnAt: 0, why: null, again: false, beep: 0, path: ['measure', 'clear', 'driveOn'], node: 'driveOn', decisions: [] };
  }

  // ---- physics ------------------------------------------------------------------------------

  collides(p) {
    const c = Math.cos(p.h), s = Math.sin(p.h);
    for (const b of BODY) {
      const x = p.x + b.x * c, z = p.z - b.x * s;
      for (const o of this.all) if (sdf(o, x, z) < b.r) return true;
    }
    return false;
  }

  /** Push the car out of anything it overlaps (after an arena edit). */
  unstick() {
    for (let k = 0; k < 12; k++) {
      let worst = null;
      const c = Math.cos(this.pose.h), s = Math.sin(this.pose.h);
      for (const b of BODY) {
        const x = this.pose.x + b.x * c, z = this.pose.z - b.x * s;
        for (const o of this.all) {
          const d = sdf(o, x, z) - b.r;
          if (d < 0 && (!worst || d < worst.d)) worst = { d, n: sdfGrad(o, x, z) };
        }
      }
      if (!worst) return;
      this.pose.x += worst.n[0] * (-worst.d + 0.2);
      this.pose.z += worst.n[1] * (-worst.d + 0.2);
    }
  }

  tick(dt) {
    dt = Math.min(dt, 0.1);
    this.t += dt;
    const ds = this.servoTarget - this.servo;
    this.servo += Math.sign(ds) * Math.min(Math.abs(ds), PHYS.servoRate * dt);

    let want = { l: 0, r: 0 };
    if (this.mode === 'manual') {
      if (this.drive !== 'stop' && this.t - this.lastDrive > 0.7) { this.drive = 'stop'; this.log('Drive: STOP (no command for 0.7 s)'); }
      want = wheelsFor(this.drive, this.speed);
    } else if (this.mode === 'auto') {
      want = wheelsFor(this.autoStep(dt), this.speed);
    } else this.drive = 'stop';

    const k = 1 - Math.exp(-dt / PHYS.tau);
    this.motors.l += (want.l - this.motors.l) * k;
    this.motors.r += (want.r - this.motors.r) * k;
    if (Math.abs(this.motors.l) < 0.05) this.motors.l = 0;
    if (Math.abs(this.motors.r) < 0.05) this.motors.r = 0;

    const { v, w } = bodyVel(this.motors.l, this.motors.r);
    const mid = this.pose.h + (w * dt) / 2;
    const next = { x: this.pose.x + v * Math.cos(mid) * dt, z: this.pose.z - v * Math.sin(mid) * dt, h: this.pose.h + w * dt };
    this.bumped = false;
    let moved = true;
    if (!this.collides(next)) this.pose = next;
    else {
      const turnOnly = { ...this.pose, h: next.h };
      const slideX = { ...next, z: this.pose.z }, slideZ = { ...next, x: this.pose.x };
      if (Math.abs(v) > 1) {
        if (!this.collides(slideX)) this.pose = slideX;
        else if (!this.collides(slideZ)) this.pose = slideZ;
        else if (!this.collides(turnOnly)) this.pose = turnOnly;
        else moved = false;
        this.bumped = true;
        if (this.t - this.lastBumpLog > 1.5) { this.lastBumpLog = this.t; this.log('Bump! The wheels are pushing against something'); }
      } else if (!this.collides(turnOnly)) this.pose = turnOnly;
      else moved = false;
    }
    // wheel travel for the 3D wheels (slips when blocked)
    const f = moved ? 1 : 0.6;
    this.travel.l += (this.motors.l / 100) * PHYS.maxSpeed * dt * f;
    this.travel.r += (this.motors.r / 100) * PHYS.maxSpeed * dt * f;

    this.measure();
    for (const [key, p] of this.pending) if (this.t >= p.at) { this.log(p.text); this.pending.delete(key); }
    this.reportAcc += dt;
    if (this.reportAcc >= 3) { this.reportAcc = 0; this.log(`Distance: ${this.distance.toFixed(1)} cm`); }
  }

  sonarRay() {
    const { x, z, h } = this.pose;
    const px = x + SONAR.pivot * Math.cos(h), pz = z - SONAR.pivot * Math.sin(h);
    const b = h + ((this.servo - 90) * Math.PI) / 180;
    return { x: px + SONAR.face * Math.cos(b), z: pz - SONAR.face * Math.sin(b), bearing: b };
  }

  measure(clean = false) {
    const r = this.sonarRay();
    let best = Infinity;
    for (const k of [-1, -0.5, 0, 0.5, 1]) {
      const a = r.bearing + k * SONAR.half;
      const dx = Math.cos(a), dz = -Math.sin(a);
      for (const o of this.all) {
        if (o.h < SONAR.height - 2) continue;
        const d = rayHit(o, r.x, r.z, dx, dz);
        if (d < best) best = d;
      }
    }
    this.rawDistance = best;
    this.distance = clamp(best + (clean ? 0 : gauss() * 0.15), 2, 400);
  }

  // ---- the avoiding routine (mirrors the sketch) ------------------------------------------------

  autoStep(dt) {
    const a = this.auto, c = this.cfg;
    a.t += dt;
    const go = (state, node, path) => { a.state = state; a.t = 0; if (node) a.node = node; if (path) a.path = path; };
    if (a.beep > 0) { a.beep -= dt; if (a.beep <= 0 && !this.manualBuzzer) this.buzzer = false; }
    const d = this.distance;
    switch (a.state) {
      case 'cruise': {
        if (Math.abs(d - a.ref) > 2 || d >= 400) { a.ref = d; a.refAt = this.t; }
        const stuck = this.t - a.refAt > c.stuck;
        const blocked = d < c.clear && Math.abs(this.servo - 90) < 3 && a.t > 0.1;
        if (blocked || stuck) {
          this.log(blocked ? `Obstacle at ${d.toFixed(1)} cm · stop and look` : 'Stuck: the reading has not changed · backing off');
          a.why = blocked ? 'blocked' : 'stuck';
          a.stoppedAt = d;
          this.setLed(true);
          this.buzzer = true;
          a.beep = c.beep;
          if (blocked) go('halt', 'halt', ['measure', 'clear', 'halt']);
          else go('reverse', 'backOff', ['measure', 'clear', 'halt', 'stuck', 'backOff']);
          return 'stop';
        }
        return 'forward';
      }
      case 'halt':
        if (a.t > c.tHalt) { this.servoTarget = c.lookR; go('lookRight', 'look', [...a.path.filter(n => n !== 'look'), 'stuck', 'look']); }
        return 'stop';
      case 'lookRight':
        if (a.t > c.tR) { a.right = d; this.servoTarget = c.lookL; go('lookLeft'); }
        return 'stop';
      case 'lookLeft':
        if (a.t > c.tL) {
          a.left = d;
          this.servoTarget = 90;
          this.log(`Left ${a.left.toFixed(0)} cm, right ${a.right.toFixed(0)} cm`);
          go('centre');
        }
        return 'stop';
      case 'centre':
        if (a.t > c.tC) {
          if (a.left < c.boxed && a.right < c.boxed) {
            this.log('Boxed in · backing up to look again');
            a.why = 'boxed';
            go('reverse', 'backUp', ['look', 'room', 'backUp']);
            return 'backward';
          }
          a.turn = a.left >= a.right ? 'left' : 'right';
          a.again = a.lastTurn != null && this.t - a.lastTurnAt < c.repeat;
          if (a.again) a.turn = a.lastTurn;
          const wv = wheelsFor(a.turn, this.speed);
          const w = Math.abs(bodyVel(wv.l, wv.r).w);
          a.turnTime = w > 0.05 ? Math.min(3, Math.PI / 2 / w) : 3;
          this.log(`Turning ${a.turn.toUpperCase()}${a.again ? ' again (just turned)' : ''}`);
          a.decisions.unshift({ t: this.t, left: a.left, right: a.right, turn: a.turn, again: a.again });
          a.decisions.length = Math.min(a.decisions.length, 6);
          go('turn', 'turn', ['look', 'room', 'again', a.again ? 'same' : 'side', 'turn']);
          return a.turn;
        }
        return 'stop';
      case 'reverse':
        if (a.t > c.tBack) { go('halt', 'halt'); a.path = [...a.path, 'look']; }
        return 'backward';
      case 'turn':
        if (a.t > a.turnTime) {
          this.setLed(false);
          a.lastTurn = a.turn;
          a.lastTurnAt = this.t;
          a.ref = d; a.refAt = this.t;
          go('cruise', 'driveOn', ['turn', 'measure', 'clear', 'driveOn']);
          return 'forward';
        }
        return a.turn;
      default:
        go('cruise', 'driveOn');
        return 'stop';
    }
  }

  autoDir() {
    const { l, r } = this.motors;
    if (Math.abs(l) < 2 && Math.abs(r) < 2) return 'stop';
    if (l > 0 && r > 0) return 'forward';
    if (l < 0 && r < 0) return 'backward';
    return r > l ? 'left' : 'right';
  }

  snapshot() {
    return {
      distance: Math.round(this.distance * 10) / 10, speed: this.speed, servo: Math.round(this.servo), led: this.led, buzzer: this.buzzer,
      mode: this.mode, drive: this.mode === 'auto' ? this.autoDir() : this.drive,
      motorL: Math.round(this.motors.l), motorR: Math.round(this.motors.r), board: this.board,
    };
  }
}
