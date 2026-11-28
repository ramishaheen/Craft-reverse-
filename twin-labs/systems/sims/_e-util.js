// Small drawing and number helpers shared by the batch-E design-interview simulations.
// Everything takes the kit's stage so colours follow the theme.

import { alpha } from '../kit/stage.js';

export { alpha };

/** A dot with a soft halo (a message or packet in flight). */
export function glow(stage, x, y, r, color, a = 1) {
  stage.dot(x, y, r * 2.4, color, a * 0.2);
  stage.dot(x, y, r, color, a);
}

/** An expanding ring with a cross: something was lost here. k goes 0 → 1 as it fades. */
export function lost(stage, x, y, k, color) {
  const { ctx } = stage;
  ctx.save();
  ctx.globalAlpha = clamp(1 - k, 0, 1);
  ctx.strokeStyle = color || stage.colors.bad;
  ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(x, y, 4 + k * 10, 0, Math.PI * 2); ctx.stroke();
  const s = 2.5 + k * 2;
  ctx.beginPath(); ctx.moveTo(x - s, y - s); ctx.lineTo(x + s, y + s); ctx.moveTo(x + s, y - s); ctx.lineTo(x - s, y + s); ctx.stroke();
  ctx.restore();
}

/** A ring that grows and fades (an arrival or a hit). k goes 0 → 1. */
export function pulse(stage, x, y, k, color, r0 = 5) {
  const { ctx } = stage;
  ctx.save();
  ctx.globalAlpha = clamp(1 - k, 0, 1) * 0.9;
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(x, y, r0 + k * 14, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** Run `fn(step)` in fixed steps of `h` simulated seconds for `dt` seconds of frame time. */
export function stepper(h = 0.05) {
  let acc = 0;
  return (dt, fn) => {
    acc += dt;
    let guard = 0;
    while (acc >= h && guard++ < 400) { fn(h); acc -= h; }
    if (guard >= 400) acc = 0;
  };
}

/** Point along a polyline of {x,y} or [x,y] points at fraction t. */
export function along(pts, t) {
  const P = pts.map(p => (Array.isArray(p) ? p : [p.x, p.y]));
  let total = 0;
  const seg = [];
  for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i][0] - P[i - 1][0], P[i][1] - P[i - 1][1]); seg.push(l); total += l; }
  let d = clamp(t, 0, 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) {
      const k = seg[i] ? clamp(d / seg[i], 0, 1) : 1;
      return [P[i][0] + (P[i + 1][0] - P[i][0]) * k, P[i][1] + (P[i + 1][1] - P[i][1]) * k];
    }
    d -= seg[i];
  }
  return P[P.length - 1];
}

/** Quadratic curve between two points, bent sideways by `bend` × length; returns [x,y] points. */
export function curve(a, b, bend = 0, n = 20) {
  if (!bend) return [[a[0], a[1]], [b[0], b[1]]];
  const dx = b[0] - a[0], dy = b[1] - a[1], L = Math.hypot(dx, dy) || 1;
  const cx = (a[0] + b[0]) / 2 + (-dy / L) * bend * L, cy = (a[1] + b[1]) / 2 + (dx / L) * bend * L;
  const out = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n, u = 1 - t;
    out.push([u * u * a[0] + 2 * u * t * cx + t * t * b[0], u * u * a[1] + 2 * u * t * cy + t * t * b[1]]);
  }
  return out;
}

/** Text clipped to a width with an ellipsis. */
export function fit(stage, str, maxW) {
  const { ctx } = stage;
  str = String(str);
  if (ctx.measureText(str).width <= maxW) return str;
  while (str.length > 1 && ctx.measureText(str + '…').width > maxW) str = str.slice(0, -1);
  return str + '…';
}

/** Deterministic pseudo-random generator (mulberry32). */
export function rng(seed = 1) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Un-pause the shared clock (guided runs should always move). */
export function unpause() {
  import('../kit/clock.js').then(m => { if (m.isPaused?.()) m.setPaused(false); }).catch(() => {});
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pct = v => `${Math.round(v * 100)}%`;
export const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);
export function p95(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; }
export function fmtMs(v) { if (v == null || !isFinite(v)) return '–'; return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s` : `${Math.round(v)} ms`; }
export function fmtSec(s) { if (s == null || !isFinite(s)) return '–'; s = Math.max(0, s); return s < 60 ? `${s < 10 ? s.toFixed(1) : Math.round(s)} s` : `${Math.floor(s / 60)}m ${String(Math.round(s % 60)).padStart(2, '0')}s`; }
export function fmtBytes(kb) { if (kb == null || !isFinite(kb)) return '–'; if (kb >= 1024 * 1024) return `${(kb / 1048576).toFixed(1)} GB`; if (kb >= 1024) return `${(kb / 1024).toFixed(kb >= 10240 ? 0 : 1)} MB`; return `${Math.round(kb)} KB`; }
/** Integer counter formatting: 1234 → 1.2k. */
export const n0 = v => (v >= 1000 ? (v / 1000).toFixed(v % 1000 && v < 10000 ? 1 : 0) + 'k' : String(Math.round(v)));
