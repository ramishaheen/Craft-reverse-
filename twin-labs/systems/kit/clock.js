// One simulation clock for the whole Systems Lab: pause and ½× / 1× / 2× speed apply to every sim.
// Sims never call requestAnimationFrame themselves; they register with kit.loop() (see page.js).

const listeners = new Set();
const state = { speed: 1, paused: false };
const subs = new Set(); // speed/pause UI subscribers

export function getSpeed() { return state.paused ? 0 : state.speed; }
export function isPaused() { return state.paused; }
export function setSpeed(s) { state.speed = s; state.paused = false; notify(); }
export function setPaused(p) { state.paused = p; notify(); }
export function togglePause() { setPaused(!state.paused); }
export function onClockChange(fn) { subs.add(fn); fn(state); return () => subs.delete(fn); }
function notify() { for (const f of subs) f(state); }

let raf = 0;
let last = 0;
function frame(now) {
  raf = requestAnimationFrame(frame);
  const real = Math.min(0.1, (now - (last || now)) / 1000);
  last = now;
  const dt = real * getSpeed();
  for (const fn of [...listeners]) {
    try { fn(dt, real); } catch (err) { console.error('sim tick failed', err); listeners.delete(fn); }
  }
}

/** Register a per-frame callback fn(simDt, realDt). simDt is 0 while paused. Returns an unsubscribe. */
export function addTicker(fn) {
  listeners.add(fn);
  if (!raf) { last = 0; raf = requestAnimationFrame(frame); }
  return () => {
    listeners.delete(fn);
    if (!listeners.size && raf) { cancelAnimationFrame(raf); raf = 0; }
  };
}
