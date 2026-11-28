// Small drawing and timing helpers shared by the batch-C simulations (edge + DevOps topics).
// Everything draws through the kit's stage, so theme colours and HiDPI scaling come for free.

import { alpha } from '../kit/stage.js';

export { alpha };

/** Fixed-step integrator: call run(dt, fn) every frame; fn(step) runs in 50 ms slices. */
export function fixedStep(step = 0.05) {
  let acc = 0;
  return {
    run(dt, fn) {
      acc += dt;
      let guard = 0;
      while (acc >= step && guard++ < 600) { fn(step); acc -= step; }
      if (guard >= 600) acc = 0; // never spiral after a long tab sleep
    },
    reset() { acc = 0; },
  };
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pct = v => `${Math.round(v * 100)}%`;

/** Shorten a string with an ellipsis until it fits maxWidth at the current ctx font. */
export function fit(ctx, s, maxWidth) {
  s = String(s);
  if (maxWidth <= 0) return '';
  if (ctx.measureText(s).width <= maxWidth) return s;
  while (s.length > 1 && ctx.measureText(s + '…').width > maxWidth) s = s.slice(0, -1);
  return s + '…';
}

/** Text that is shortened to fit (sets the font first). */
export function fitText(stage, str, x, y, maxWidth, o = {}) {
  const { ctx } = stage;
  ctx.font = `${o.weight || 500} ${o.size || 12}px ${o.mono ? 'ui-monospace, monospace' : stage.font}`;
  stage.text(fit(ctx, str, maxWidth), x, y, o);
}

/** A labelled box given by its centre (x, y). */
export function box(stage, b, title, sub, o = {}) {
  stage.node(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, { title, sub, stroke: o.stroke, width: o.width, subColor: o.subColor, dashed: o.dashed, size: o.size, bg: o.bg });
}

/** Point at fraction t along a polyline of {x,y} points. */
export function along(pts, t) {
  let total = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); segs.push(l); total += l; }
  let d = clamp(t, 0, 1) * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const k = segs[i] ? clamp(d / segs[i], 0, 1) : 1;
      return { x: pts[i].x + (pts[i + 1].x - pts[i].x) * k, y: pts[i].y + (pts[i + 1].y - pts[i].y) * k };
    }
    d -= segs[i];
  }
  return pts[pts.length - 1];
}

/** A dot with a soft halo (an in-flight message). */
export function glow(stage, p, r, color, a = 1) {
  stage.dot(p.x, p.y, r * 2.3, color, a * 0.2);
  stage.dot(p.x, p.y, r, color, a);
}

/** Expanding ring, k in 0..1 (a write landing, a heartbeat). */
export function burst(stage, p, k, color, r0 = 5) {
  const { ctx } = stage;
  ctx.save();
  ctx.globalAlpha = clamp(1 - k, 0, 1) * 0.9;
  ctx.strokeStyle = color; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(p.x, p.y, r0 + k * 14, 0, Math.PI * 2); ctx.stroke();
  ctx.restore();
}

/** Ring with an X through it, fading with k in 0..1 (a request that failed). */
export function failMark(stage, p, k, color) {
  const { ctx } = stage;
  ctx.save();
  ctx.globalAlpha = clamp(1 - k, 0, 1);
  ctx.strokeStyle = color; ctx.lineWidth = 1.6;
  ctx.beginPath(); ctx.arc(p.x, p.y, 4 + k * 10, 0, Math.PI * 2); ctx.stroke();
  const s = 2.5 + k * 2;
  ctx.beginPath(); ctx.moveTo(p.x - s, p.y - s); ctx.lineTo(p.x + s, p.y + s); ctx.moveTo(p.x + s, p.y - s); ctx.lineTo(p.x - s, p.y + s); ctx.stroke();
  ctx.restore();
}

/** Filled rounded rectangle with optional alpha and stroke. */
export function tile(stage, x, y, w, h, { fill, fillAlpha = 1, stroke, width = 1, dash, r = 4 } = {}) {
  const { ctx } = stage;
  if (w <= 0 || h <= 0) return;
  ctx.save();
  stage.roundRect(x, y, w, h, r);
  if (fill) { ctx.globalAlpha = fillAlpha; ctx.fillStyle = fill; ctx.fill(); ctx.globalAlpha = 1; }
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = width; if (dash) ctx.setLineDash(dash); ctx.stroke(); }
  ctx.restore();
}

/** Throttle for log lines: ok(key, gapSeconds, now) is true at most once per gap for each key. */
export function throttle() {
  const last = new Map();
  return {
    ok(key, gap, now) { const t = last.get(key); if (t != null && now - t < gap && now >= t) return false; last.set(key, now); return true; },
    clear() { last.clear(); },
  };
}

/** Resume the global clock if the person paused it (used by guided runs). */
export function unpause() {
  import('../kit/clock.js').then(m => { if (m.isPaused?.()) m.setPaused(false); }).catch(() => {});
}
