// Shared helpers for batch B simulations (database-transactions, capacity, networking, queues, kafka,
// realtime, realtime-analytics, api-gateway, rate-limiting, resilience).
// Adds the few page pieces the kit has no helper for: a step-by-step lesson card above the stage,
// extra cards under the stage (working, tables, config), a colour legend under the canvas, and a
// fixed-step integrator so every model advances in 50 ms steps whatever the frame rate.

import { h } from '../../js/core/dom.js';

export const STEP = 0.05;

/** Wrap a model step fn(dt) so it always runs in fixed 50 ms slices. */
export function fixedStep(fn) {
  let acc = 0;
  return dt => {
    acc += dt;
    let guard = 0;
    while (acc >= STEP && guard++ < 400) { fn(STEP); acc -= STEP; }
    if (guard >= 400) acc = 0;
  };
}

const stageCard = kit => kit.stageEl.parentElement;

/** A card placed under the stage (below any card added before it). Returns { el, body, title }. */
export function addCard(kit, title, { after } = {}) {
  const body = h('div');
  const head = h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', justifyContent: 'space-between' } }, h('h3', { style: { margin: '0 0 10px' } }, title));
  const el = h('section.card.b-card', { style: { padding: '18px 20px' } }, head, body);
  const anchor = after || kit._bLastCard || stageCard(kit);
  anchor.after(el);
  kit._bLastCard = el;
  kit.onCleanup(() => el.remove());
  return { el, body, head };
}

/** A colour legend row inside the stage card, right under the canvas. items: [[colorToken or css colour, label, shape?]] */
export function addLegend(kit, items) {
  const row = h('div.chart-legend', { style: { padding: '8px 16px 4px', margin: 0, fontSize: '12.5px' } });
  const paint = list => {
    row.replaceChildren(...list.map(([col, label, shape]) => h('span', h('i', {
      style: {
        background: col.startsWith('var(') || col.startsWith('#') || col.startsWith('hsl') ? col : `var(${TOKEN[col] || '--accent-2'})`,
        ...(shape === 'dot' ? { width: '9px', height: '9px', borderRadius: '50%' } : shape === 'box' ? { width: '10px', height: '10px', borderRadius: '2px' } : {}),
      },
    }), label)));
  };
  paint(items);
  kit.stageEl.after(row);
  kit.onCleanup(() => row.remove());
  return { el: row, set: paint };
}

export const TOKEN = {
  wire: '--accent-2', signal: '--amber', amber: '--amber', bad: '--red', ok: '--green', good: '--green', teal: '--teal',
  violet: '--violet', ink: '--text', muted: '--text-3', orange: '--orange', pink: '--pink', accent: '--accent', line: '--line-2',
};

/**
 * Step-by-step lesson card above the stage. steps: [{ t, b, d, set, focus }].
 * apply(step, index) is called when a step opens (set the controls silently there).
 * focus(step) may return an element to highlight until the person touches it.
 */
export function addLesson(kit, steps, { apply, focus } = {}) {
  const n = h('span', { style: { fontSize: '12px', fontWeight: 700, letterSpacing: '.04em', textTransform: 'uppercase', color: 'var(--text-3)' } });
  const dots = h('div', { style: { display: 'flex', gap: '6px', flexWrap: 'wrap' }, role: 'group', 'aria-label': 'Lesson steps' });
  const title = h('h3', { style: { margin: '6px 0 6px' } });
  const body = h('p', { style: { margin: '0 0 8px', color: 'var(--text-2)', lineHeight: 1.55 } });
  const todo = h('p', { style: { margin: '0 0 12px', color: 'var(--accent-2)', fontWeight: 600 } });
  const back = h('button.btn.ghost.sm', { type: 'button' }, 'Back');
  const next = h('button.btn.sm', { type: 'button' }, 'Next');
  const el = h('section.card.b-lesson', { style: { padding: '16px 20px' } },
    h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' } }, n, dots),
    title, body, todo, h('div', { style: { display: 'flex', gap: '8px' } }, back, next));
  stageCard(kit).before(el);
  kit.onCleanup(() => el.remove());
  let i = 0, lit = null;
  const unlight = () => { if (lit) { lit.style.boxShadow = ''; lit.style.borderRadius = ''; lit = null; } };
  function go(k) {
    i = Math.max(0, Math.min(steps.length - 1, k));
    const s = steps[i];
    n.textContent = `Step ${i + 1} of ${steps.length}`;
    title.textContent = s.t;
    body.innerHTML = s.b;
    todo.innerHTML = '→ ' + s.d;
    back.disabled = i === 0;
    next.textContent = i === steps.length - 1 ? 'Start again' : 'Next';
    dots.replaceChildren(...steps.map((_, j) => h('button', {
      type: 'button', 'aria-label': `Go to step ${j + 1}`, 'aria-current': j === i ? 'step' : null,
      style: { width: '11px', height: '11px', padding: 0, borderRadius: '50%', cursor: 'pointer', border: '1px solid var(--line-2)', background: j === i ? 'var(--accent)' : j < i ? 'var(--accent-soft, var(--surface-3))' : 'transparent' },
      onclick: () => go(j),
    })));
    unlight();
    try { apply?.(s, i); } catch (e) { console.error(e); }
    const f = focus?.(s);
    if (f) {
      lit = f;
      f.style.boxShadow = '0 0 0 2px var(--amber)';
      f.style.borderRadius = '8px';
      const off = () => { if (lit === f) unlight(); f.removeEventListener('input', off); f.removeEventListener('click', off); };
      f.addEventListener('input', off); f.addEventListener('click', off);
    }
  }
  back.onclick = () => go(i - 1);
  next.onclick = () => go(i === steps.length - 1 ? 0 : i + 1);
  return { el, go, get index() { return i; } };
}

// ---------- formatting ----------
export const pct = v => `${Math.round(v * 100)}%`;
export function fmtMs(v) {
  if (v == null || !isFinite(v)) return '–';
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)} s` : `${Math.round(v)} ms`;
}
export function p95(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; }
export const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const ease = t => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);
export function clock(t) { t = Math.max(0, Math.floor(t)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; }

const UNITS = ['B', 'KB', 'MB', 'GB', 'TB', 'PB', 'EB'];
/** Decimal byte sizes: 1.5 KB, 120 TB. */
export function bytes(v) {
  let i = 0;
  while (v >= 1000 && i < UNITS.length - 1) { v /= 1000; i++; }
  return `${v >= 100 || i === 0 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)} ${UNITS[i]}`;
}
/** Compact counts: 950, 1.2k, 34M, 1.16B. */
export function count(v) {
  if (!isFinite(v)) return '–';
  if (v < 1000) return v >= 10 || v === Math.round(v) ? String(Math.round(v)) : v.toFixed(1);
  const u = ['k', 'M', 'B', 'T'];
  let i = -1;
  while (v >= 1000 && i < u.length - 1) { v /= 1000; i++; }
  return `${v >= 100 ? Math.round(v) : v.toFixed(v >= 10 ? 1 : 2)}${u[i]}`;
}

/** 32-bit FNV-1a with a final mix, for stable key → partition / IP → server choices. */
export function hashStr(s) {
  let x = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { x ^= s.charCodeAt(i); x = Math.imul(x, 0x01000193); }
  x ^= x >>> 13; x = Math.imul(x, 0xc2b2ae35); x ^= x >>> 16;
  return x >>> 0;
}

/** Point at fraction t of a polyline given as [{x,y}] or [[x,y]]. */
export function along(pts, t) {
  const P = pts.map(p => (Array.isArray(p) ? { x: p[0], y: p[1] } : p));
  let total = 0;
  const seg = [];
  for (let i = 1; i < P.length; i++) { const l = Math.hypot(P[i].x - P[i - 1].x, P[i].y - P[i - 1].y); seg.push(l); total += l; }
  let d = clamp(t, 0, 1) * total;
  for (let i = 0; i < seg.length; i++) {
    if (d <= seg[i] || i === seg.length - 1) { const k = seg[i] ? clamp(d / seg[i], 0, 1) : 1; return { x: P[i].x + (P[i + 1].x - P[i].x) * k, y: P[i].y + (P[i + 1].y - P[i].y) * k }; }
    d -= seg[i];
  }
  return P[P.length - 1];
}

/** Points of a quadratic curve from a to b bowed sideways by `bend` (fraction of the length). */
export function curve(a, b, bend = 0, n = 20) {
  if (!bend) return [a, b];
  const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy) || 1;
  const cx = (a.x + b.x) / 2 - (dy / len) * bend * len, cy = (a.y + b.y) / 2 + (dx / len) * bend * len;
  const out = [];
  for (let i = 0; i <= n; i++) { const t = i / n, u = 1 - t; out.push({ x: u * u * a.x + 2 * u * t * cx + t * t * b.x, y: u * u * a.y + 2 * u * t * cy + t * t * b.y }); }
  return out;
}

/** Box centred at (x,y) — most originals lay nodes out by their centre. */
export function cnode(stage, b, title, sub, o = {}) { stage.node(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, { title, sub, ...o }); }

/** Ensure the shared clock is running when a guided run starts. */
export function unpause() { import('../kit/clock.js').then(m => { if (m.isPaused()) m.setPaused(false); }).catch(() => {}); }

/**
 * The page appends its "3D view" button after setup and relies on the `hidden` attribute, which the
 * `.btn` display rule overrides. Sims without a 3D view call this so the dead button never shows.
 */
export function no3d(kit) {
  setTimeout(() => {
    const host = kit.panel.el.parentElement;
    const b = host && [...host.children].find(x => x.tagName === 'BUTTON' && x.hasAttribute('hidden'));
    if (b) b.style.display = 'none';
  }, 0);
}
