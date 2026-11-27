// Canvas stage for a simulation: HiDPI sizing, theme colours and drawing helpers.
// All coordinates are CSS pixels inside the stage (stage.w × stage.h). Sims lay out relative
// to stage.w/stage.h every frame, so resizing just works.

import { token } from '../../js/core/dom.js';

const COLOR_TOKENS = {
  bg: '--bg', bg2: '--bg-2', surface: '--surface', surface2: '--surface-2', surface3: '--surface-3',
  line: '--line', line2: '--line-2', ink: '--text', ink2: '--text-2', muted: '--text-3',
  accent: '--accent', wire: '--accent-2', signal: '--amber', amber: '--amber', teal: '--teal',
  ok: '--green', good: '--green', bad: '--red', warn: '--amber', orange: '--orange', violet: '--violet', pink: '--pink',
  grid: '--grid',
};

export const FONT = getComputedStyle(document.documentElement).getPropertyValue('--font').trim() || 'system-ui, sans-serif';

export function readColors() {
  const c = {};
  for (const [k, v] of Object.entries(COLOR_TOKENS)) c[k] = token(v) || '#888';
  return c;
}

/** Add alpha to a hex or rgb colour. */
export function alpha(col, a) {
  if (!col) return `rgba(128,128,128,${a})`;
  if (col.startsWith('#')) {
    let hex = col.slice(1);
    if (hex.length === 3) hex = [...hex].map(x => x + x).join('');
    const n = parseInt(hex.slice(0, 6), 16);
    return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
  }
  const m = col.match(/rgba?\(([^)]+)\)/);
  if (m) { const [r, g, b] = m[1].split(',').map(s => s.trim()); return `rgba(${r},${g},${b},${a})`; }
  return col;
}

export function createStage(host, { height = 420, minHeight = 260 } = {}) {
  const canvas = document.createElement('canvas');
  canvas.className = 'sim-canvas';
  host.append(canvas);
  const ctx = canvas.getContext('2d');
  const st = {
    canvas, ctx, w: 0, h: 0, dpr: 1, colors: readColors(), flows: [], height,
    font: FONT,
    resize, clear, grid, rect, roundRect, node, line, path, arrow, text, dot, pill, bar, ring, send, drawFlows, clearFlows,
    isoBox, isoProject, onPointer, hit,
  };
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  const onTheme = () => { st.colors = readColors(); };
  window.addEventListener('themechange', onTheme);
  st.destroy = () => { ro.disconnect(); window.removeEventListener('themechange', onTheme); canvas.remove(); };
  resize();
  return st;

  function resize() {
    const w = Math.max(200, host.clientWidth);
    const h = Math.max(minHeight, st.height === 'fill' ? host.clientHeight : Math.min(st.height, Math.max(minHeight, w * 0.75)));
    st.dpr = Math.min(2, window.devicePixelRatio || 1);
    if (w === st.w && h === st.h && canvas.width === Math.round(w * st.dpr)) return;
    st.w = w; st.h = h;
    canvas.width = Math.round(w * st.dpr);
    canvas.height = Math.round(h * st.dpr);
    canvas.style.width = w + 'px';
    canvas.style.height = h + 'px';
  }

  function clear(withGrid = true) {
    ctx.setTransform(st.dpr, 0, 0, st.dpr, 0, 0);
    ctx.clearRect(0, 0, st.w, st.h);
    if (withGrid) grid();
  }

  function grid(step = 24) {
    ctx.save();
    ctx.strokeStyle = st.colors.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0.5; x < st.w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, st.h); }
    for (let y = 0.5; y < st.h; y += step) { ctx.moveTo(0, y); ctx.lineTo(st.w, y); }
    ctx.stroke();
    ctx.restore();
  }

  function roundRect(x, y, w, h, r = 8) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  function rect(x, y, w, h, { fill, stroke, r = 8, width = 1.5, dash } = {}) {
    roundRect(x, y, w, h, r);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (stroke) { ctx.lineWidth = width; ctx.strokeStyle = stroke; if (dash) ctx.setLineDash(dash); ctx.stroke(); ctx.setLineDash([]); }
  }

  /**
   * A labelled box. opts: title, sub, fill (0..1 bar), fillColor, stroke, dashed, state ('ok'|'warn'|'bad'|'dead'|'idle'|'active'),
   * right (text on the right), rightColor, align ('center'|'left'), size (font px), r.
   */
  function node(x, y, w, h, o = {}) {
    const c = st.colors;
    const stateCol = { ok: c.ok, warn: c.warn, bad: c.bad, dead: c.bad, idle: c.muted, active: c.wire }[o.state] || o.stroke || c.wire;
    roundRect(x, y, w, h, o.r ?? 7);
    ctx.fillStyle = o.bg || c.surface;
    ctx.fill();
    if (o.fill != null && o.fill > 0) {
      ctx.save();
      roundRect(x, y, w, h, o.r ?? 7);
      ctx.clip();
      ctx.fillStyle = alpha(o.fillColor || (o.fill >= 1 ? c.bad : o.fill > 0.7 ? c.warn : c.ok), 0.28);
      ctx.fillRect(x, y, w * Math.min(1, o.fill), h);
      ctx.restore();
    }
    roundRect(x, y, w, h, o.r ?? 7);
    ctx.lineWidth = o.width || 1.5;
    ctx.strokeStyle = stateCol;
    if (o.dashed || o.state === 'idle') ctx.setLineDash([4, 3]);
    ctx.stroke();
    ctx.setLineDash([]);
    const size = o.size || 12.5;
    ctx.textBaseline = 'middle';
    if (o.align === 'left') {
      ctx.textAlign = 'left';
      ctx.font = `600 ${size}px ${FONT}`;
      ctx.fillStyle = o.state === 'dead' ? c.bad : c.ink;
      ctx.fillText(o.title || '', x + 10, y + h / 2 - (o.sub ? 7 : 0));
      if (o.sub) { ctx.font = `500 ${size - 2}px ${FONT}`; ctx.fillStyle = o.subColor || c.muted; ctx.fillText(o.sub, x + 10, y + h / 2 + 8); }
    } else {
      ctx.textAlign = 'center';
      ctx.font = `600 ${size}px ${FONT}`;
      ctx.fillStyle = o.state === 'dead' ? c.bad : c.ink;
      ctx.fillText(o.title || '', x + w / 2, y + h / 2 - (o.sub ? 7 : 0));
      if (o.sub) { ctx.font = `500 ${size - 2}px ${FONT}`; ctx.fillStyle = o.subColor || c.muted; ctx.fillText(o.sub, x + w / 2, y + h / 2 + 8); }
    }
    if (o.right) {
      ctx.textAlign = 'right';
      ctx.font = `600 ${size - 0.5}px ${FONT}`;
      ctx.fillStyle = o.rightColor || c.ink;
      ctx.fillText(o.right, x + w - 9, y + h / 2);
    }
    if (o.badge) pill(x + w - 4, y - 2, o.badge, { color: o.badgeColor || c.signal, anchor: 'right' });
  }

  function line(x1, y1, x2, y2, { color, width = 1.5, dash, alpha: a } = {}) {
    ctx.save();
    if (a != null) ctx.globalAlpha = a;
    ctx.strokeStyle = color || st.colors.line2;
    ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke();
    ctx.restore();
  }

  function path(pts, { color, width = 1.5, dash, close, fill } = {}) {
    if (pts.length < 2) return;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    if (close) ctx.closePath();
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    if (color !== null) {
      ctx.strokeStyle = color || st.colors.line2;
      ctx.lineWidth = width;
      if (dash) ctx.setLineDash(dash);
      ctx.stroke();
    }
    ctx.restore();
  }

  function arrow(x1, y1, x2, y2, o = {}) {
    line(x1, y1, x2, y2, o);
    const a = Math.atan2(y2 - y1, x2 - x1), s = o.head || 7;
    ctx.save();
    ctx.fillStyle = o.color || st.colors.line2;
    ctx.beginPath();
    ctx.moveTo(x2, y2);
    ctx.lineTo(x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45));
    ctx.lineTo(x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45));
    ctx.closePath(); ctx.fill();
    ctx.restore();
  }

  function text(str, x, y, { size = 12, weight = 500, color, align = 'left', baseline = 'middle', mono, maxWidth } = {}) {
    ctx.font = `${weight} ${size}px ${mono ? 'ui-monospace, monospace' : FONT}`;
    ctx.fillStyle = color || st.colors.ink;
    ctx.textAlign = align;
    ctx.textBaseline = baseline;
    ctx.fillText(String(str), x, y, maxWidth);
  }

  function dot(x, y, r = 4, color, a = 1) {
    ctx.save();
    ctx.globalAlpha = a;
    ctx.fillStyle = color || st.colors.ok;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }

  function ring(x, y, r, { color, width = 1.5, dash, fill } = {}) {
    ctx.save();
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2);
    if (fill) { ctx.fillStyle = fill; ctx.fill(); }
    ctx.strokeStyle = color || st.colors.line2; ctx.lineWidth = width;
    if (dash) ctx.setLineDash(dash);
    ctx.stroke();
    ctx.restore();
  }

  function pill(x, y, label, { color, anchor = 'center', size = 10.5, solid } = {}) {
    ctx.font = `700 ${size}px ${FONT}`;
    const w = ctx.measureText(label).width + 12, h = size + 7;
    const left = anchor === 'right' ? x - w : anchor === 'left' ? x : x - w / 2;
    const col = color || st.colors.wire;
    roundRect(left, y - h / 2, w, h, h / 2);
    ctx.fillStyle = solid ? col : alpha(col, 0.18); ctx.fill();
    ctx.strokeStyle = alpha(col, 0.7); ctx.lineWidth = 1; ctx.stroke();
    ctx.fillStyle = solid ? st.colors.bg : col;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(label, left + w / 2, y + 0.5);
    return w;
  }

  function bar(x, y, w, h, pct, color, bg) {
    rect(x, y, w, h, { fill: bg || st.colors.surface3, r: h / 2 });
    if (pct > 0) rect(x, y, Math.max(h, w * Math.min(1, pct)), h, { fill: color || st.colors.ok, r: h / 2 });
  }

  /**
   * Animate a dot along a polyline. pts: [[x,y],...] in stage coords, or a function returning them (follows layout).
   * opts: color, dur (sim seconds), r, onArrive, fail (fades out red near the end), trail.
   */
  function send(pts, o = {}) {
    st.flows.push({ pts, t: 0, dur: o.dur || 0.8, color: o.color, r: o.r || 3.6, onArrive: o.onArrive, fail: o.fail, stopAt: o.stopAt ?? 1 });
  }

  function clearFlows() { st.flows.length = 0; }

  function drawFlows(dt) {
    const c = st.colors;
    st.flows = st.flows.filter(f => {
      f.t += dt / f.dur;
      const pts = typeof f.pts === 'function' ? f.pts() : f.pts;
      if (!pts || pts.length < 2) return false;
      const k = Math.min(f.t, f.stopAt);
      const [x, y] = along(pts, k);
      if (f.fail && f.t > f.stopAt * 0.85) {
        const fade = Math.max(0, 1 - (f.t - f.stopAt * 0.85) / 0.35);
        dot(x, y, f.r + 1, f.color || c.bad, fade);
        if (fade <= 0) return false;
      } else {
        dot(x, y, f.r, f.color || c.ok);
      }
      if (f.t >= 1 && !f.fail) { f.onArrive?.(); return false; }
      if (f.fail && f.t >= f.stopAt + 0.35) { f.onArrive?.(); return false; }
      return true;
    });
  }

  // ---- simple isometric 3D (used by the "3D view" toggle) ----
  function isoProject(x, y, z, cam) {
    // x,y on the floor plane (-1..1), z up. cam: {yaw, pitch, cx, cy, scale}
    const cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
    const rx = x * cy - y * sy, ry = x * sy + y * cy;
    return [cam.cx + rx * cam.scale, cam.cy + ry * cam.scale * Math.sin(cam.pitch) - z * cam.scale * Math.cos(cam.pitch)];
  }

  /** Draw a box at floor position (x,y) with footprint w×d and height hgt. */
  function isoBox(cam, x, y, w, d, hgt, col, { label, sub } = {}) {
    const P = (a, b, z) => isoProject(a, b, z, cam);
    const x0 = x - w / 2, x1 = x + w / 2, y0 = y - d / 2, y1 = y + d / 2;
    const top = [P(x0, y0, hgt), P(x1, y0, hgt), P(x1, y1, hgt), P(x0, y1, hgt)];
    const faces = [
      [P(x0, y1, 0), P(x1, y1, 0), P(x1, y1, hgt), P(x0, y1, hgt)],
      [P(x1, y0, 0), P(x1, y1, 0), P(x1, y1, hgt), P(x1, y0, hgt)],
      [P(x0, y0, 0), P(x0, y1, 0), P(x0, y1, hgt), P(x0, y0, hgt)],
      [P(x0, y0, 0), P(x1, y0, 0), P(x1, y0, hgt), P(x0, y0, hgt)],
    ];
    const shade = [0.55, 0.4, 0.4, 0.55];
    faces.forEach((f, i) => path(f, { close: true, fill: alpha(col, shade[i]), color: alpha(col, 0.9), width: 1 }));
    path(top, { close: true, fill: alpha(col, 0.75), color: col, width: 1.2 });
    if (label) {
      const [lx, ly] = P(x, y, hgt);
      text(label, lx, ly - 12, { size: 11, weight: 700, align: 'center', color: st.colors.ink });
      if (sub) text(sub, lx, ly + 1, { size: 10, align: 'center', color: st.colors.muted });
    }
  }

  /** Pointer events in stage coordinates: fn(type, x, y, event). */
  function onPointer(fn) {
    const handler = e => {
      const r = canvas.getBoundingClientRect();
      fn(e.type, e.clientX - r.left, e.clientY - r.top, e);
    };
    for (const t of ['pointerdown', 'pointermove', 'pointerup', 'pointerleave']) canvas.addEventListener(t, handler);
  }

  function hit(x, y, bx, by, bw, bh) { return x >= bx && x <= bx + bw && y >= by && y <= by + bh; }
}

/** Point at fraction t along a polyline. */
export function along(pts, t) {
  let total = 0;
  const segs = [];
  for (let i = 1; i < pts.length; i++) {
    const l = Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
    segs.push(l); total += l;
  }
  let d = Math.max(0, Math.min(1, t)) * total;
  for (let i = 0; i < segs.length; i++) {
    if (d <= segs[i] || i === segs.length - 1) {
      const k = segs[i] ? d / segs[i] : 0;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * k, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * k];
    }
    d -= segs[i];
  }
  return pts[pts.length - 1];
}
