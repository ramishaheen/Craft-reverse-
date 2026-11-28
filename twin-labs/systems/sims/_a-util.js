// Small helpers shared by batch A's simulations (caching, pooling, eviction, sharding, replication,
// Raft, CAP, SQL vs NoSQL, query plans, search index, deadlock). Pure functions plus a few DOM
// builders that only use theme tokens, so they look right in both themes.

import { h } from '../../js/core/dom.js';

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const pct = v => `${Math.round(v * 100)}%`;
export const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export function p95(a) {
  if (!a.length) return null;
  const s = [...a].sort((x, y) => x - y);
  return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))];
}
export function fmtMs(v) {
  if (v == null || !isFinite(v)) return '–';
  if (v >= 1000) return `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s`;
  return `${Math.round(v)} ms`;
}
/** Smooth start and stop for 0..1. */
export const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

/**
 * 32-bit string hash: FNV-1a over UTF-16 code units, then a murmur-style finaliser so nearby
 * strings ("user:101", "user:108") land far apart. Returns an unsigned 32-bit integer.
 */
export function hash32(str) {
  let x = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { x ^= str.charCodeAt(i); x = Math.imul(x, 0x01000193); }
  x ^= x >>> 16; x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** Run fn(step) in fixed slices so results do not depend on the frame rate. */
export function fixedSteps(state, dt, fn, step = 0.05) {
  state.acc = (state.acc || 0) + dt;
  let guard = 0;
  while (state.acc >= step && guard++ < 400) { fn(step); state.acc -= step; }
}

/** Resume the global clock if the visitor paused it (used by guided runs). */
export function unpause() {
  import('../kit/clock.js').then(m => { if (m.isPaused?.()) m.setPaused(false); }).catch(() => {});
}

/**
 * The page appends a "3D view" button with the `hidden` attribute, but `.btn { display: inline-flex }`
 * wins over [hidden], so it shows even for sims without a 3D view. Hide it explicitly.
 */
export function hide3dButton(kit) {
  queueMicrotask(() => {
    const host = kit.panel.el.parentElement;
    const btn = host && [...host.children].find(el => el.matches('button.btn.block'));
    if (btn && btn.hidden) btn.style.display = 'none';
  });
}

/** A titled box appended to the control panel. Returns { el, body }. */
export function panelBox(panel, title) {
  const body = h('div');
  const el = h('div', { style: { borderTop: '1px solid var(--line)', paddingTop: '12px', marginTop: '4px' } },
    title && h('div', { style: { font: '600 13px var(--font)', color: 'var(--text)', marginBottom: '8px' } }, title), body);
  panel.custom(el);
  return { el, body };
}

/** Horizontal labelled bars as HTML. rows: [{ label, value (0..1), text, color }] */
export function barsHtml(rows) {
  return rows.map(r => `<div style="display:grid;grid-template-columns:62px 1fr 48px;gap:8px;align-items:center;margin:4px 0;font-size:12.5px">
    <span style="color:var(--text-2)">${r.label}</span>
    <span style="height:9px;border-radius:5px;background:var(--surface-3);overflow:hidden"><span style="display:block;height:100%;width:${(clamp(r.value, 0, 1) * 100).toFixed(1)}%;background:${r.color};border-radius:5px"></span></span>
    <b style="text-align:right;color:var(--text);font-weight:600">${r.text}</b></div>`).join('');
}

/** A short colour key drawn in the canvas: items [[colour, label], ...] laid out left to right. */
export function drawKey(stage, x, y, items, maxW) {
  const ctx = stage.ctx;
  let cx = x;
  ctx.font = `500 10.5px ${stage.font}`;
  for (const [col, label] of items) {
    const w = ctx.measureText(label).width + 22;
    if (maxW && cx + w > x + maxW) break;
    stage.dot(cx + 4, y, 4, col);
    stage.text(label, cx + 12, y, { size: 10.5, color: stage.colors.muted });
    cx += w;
  }
}
