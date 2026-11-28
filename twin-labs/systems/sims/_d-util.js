// Shared helpers for the batch-D simulations (payments and design interviews).
// Boxes are described by their centre ({x, y, w, h}) so layouts read like the diagrams they draw.

import { along } from '../kit/stage.js';

export const inr = v => (v < 0 ? '−₹' : '₹') + Math.abs(Math.round(v)).toLocaleString('en-IN');
export const pct = v => `${Math.round(v * 100)}%`;
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0);

/** Run fn(step) on a fixed 50 ms simulated step, whatever the frame rate. */
export function fixedStep(fn, step = 0.05) {
  let acc = 0;
  return dt => {
    acc += dt;
    let guard = 0;
    while (acc >= step && guard++ < 400) { fn(step); acc -= step; }
    if (guard >= 400) acc = 0;
  };
}

/** A labelled node centred on b. */
export function box(stage, b, title, sub, o = {}) {
  stage.node(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, { title, sub, ...o });
}

/** Line through the centres of several boxes or points. */
export function link(stage, pts, o = {}) {
  stage.path(pts.map(p => [p.x, p.y]), o);
}

/** Point at fraction t along the centres of pts. */
export function at(pts, t) {
  const [x, y] = along(pts.map(p => [p.x, p.y]), clamp(t, 0, 1));
  return { x, y };
}

/** An expanding, fading ring on a box: k goes 0 → 1. */
export function burst(stage, b, k, color) {
  if (k < 0 || k > 1) return;
  stage.ctx.save();
  stage.ctx.globalAlpha = 1 - k;
  stage.ring(b.x, b.y, 6 + k * Math.max(18, (b.w || 30) * 0.45), { color, width: 2 });
  stage.ctx.restore();
}

/** Small rounded row with left and right text (lists under the diagram). */
export function row(stage, x, y, w, h, left, right, { leftColor, rightColor, fill, size = 10 } = {}) {
  const c = stage.colors;
  stage.rect(x, y, w, h, { fill: fill || c.surface, stroke: c.line, r: 4, width: 1 });
  stage.text(left, x + 6, y + h / 2, { size, color: leftColor || c.ink, maxWidth: w * 0.68 });
  if (right) stage.text(right, x + w - 6, y + h / 2, { size, color: rightColor || c.muted, align: 'right' });
}

/** The guided runs need the clock running. */
export function unpause() {
  import('../kit/clock.js').then(m => { if (m.isPaused?.()) m.setPaused(false); }).catch(() => {});
}

/**
 * The page always appends a "3D view" button; its `hidden` attribute loses to `.btn { display }`,
 * so sims without a 3D view would show a dead button. Hide it explicitly (after setup returns).
 */
export function hide3dButton(kit) {
  Promise.resolve().then(() => {
    const host = kit.panel?.el?.parentElement;
    const b = host && [...host.children].find(x => x.tagName === 'BUTTON' && x.hidden);
    if (b) b.style.display = 'none';
  });
}
