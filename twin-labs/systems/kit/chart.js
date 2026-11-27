// Rolling time-series chart (one sample per simulated second, last `window` samples).
// lines: [{ key, label, color: token key from stage colours, e.g. 'wire' }], bars: { key, label, color }.

import { h } from '../../js/core/dom.js';
import { readColors, FONT, alpha } from './stage.js';

export function createChart(host, { lines = [], bars = null, window: win = 60, format = v => fmtNum(v), height = 150, title = 'last 60 s', yMin = 0, yMax } = {}) {
  const legend = h('div.chart-legend',
    lines.map(l => h('span', h('i', { style: { background: `var(${tokenFor(l.color)})` } }), l.label)),
    bars && h('span', h('i', { style: { background: `var(${tokenFor(bars.color || 'bad')})` } }), bars.label));
  const canvas = h('canvas.chart-canvas');
  const box = h('div.chart', legend, canvas);
  host.append(box);
  const ctx = canvas.getContext('2d');
  let data = [];
  let colors = readColors();
  const onTheme = () => { colors = readColors(); draw(); };
  window.addEventListener('themechange', onTheme);
  const ro = new ResizeObserver(draw);
  ro.observe(box);

  function draw() {
    const dpr = Math.min(2, devicePixelRatio || 1);
    const w = Math.max(200, box.clientWidth - 2), hh = height;
    if (canvas.width !== Math.round(w * dpr)) { canvas.width = Math.round(w * dpr); canvas.height = Math.round(hh * dpr); canvas.style.width = w + 'px'; canvas.style.height = hh + 'px'; }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, hh);
    const pad = { l: 8, r: 8, t: 18, b: 8 };
    const iw = w - pad.l - pad.r, ih = hh - pad.t - pad.b;
    let max = yMax ?? 0;
    if (yMax == null) for (const d of data) for (const l of lines) if (d[l.key] != null && isFinite(d[l.key])) max = Math.max(max, d[l.key]);
    max = max > 0 ? max * 1.15 : 1;
    let bmax = 0;
    if (bars) for (const d of data) bmax = Math.max(bmax, d[bars.key] || 0);
    // grid
    ctx.strokeStyle = colors.line; ctx.lineWidth = 1;
    for (let i = 0; i <= 3; i++) { const y = pad.t + (ih * i) / 3 + 0.5; ctx.beginPath(); ctx.moveTo(pad.l, y); ctx.lineTo(w - pad.r, y); ctx.stroke(); }
    ctx.font = `500 10.5px ${FONT}`; ctx.fillStyle = colors.muted; ctx.textBaseline = 'top';
    ctx.textAlign = 'left'; ctx.fillText(format(max), pad.l, 3);
    ctx.textAlign = 'right'; ctx.fillText(title, w - pad.r, 3);
    const xAt = i => pad.l + iw * (i + (win - data.length)) / (win - 1 || 1);
    if (bars && bmax > 0) {
      ctx.fillStyle = alpha(colors[bars.color || 'bad'], 0.75);
      const bw = Math.max(2, iw / win - 2);
      data.forEach((d, i) => { const v = d[bars.key] || 0; if (v > 0) { const bh = (v / bmax) * ih * 0.45; ctx.fillRect(xAt(i) - bw / 2, pad.t + ih - bh, bw, bh); } });
    }
    for (const l of lines) {
      ctx.strokeStyle = colors[l.color] || l.color; ctx.lineWidth = 2; ctx.lineJoin = 'round';
      ctx.beginPath();
      let started = false;
      data.forEach((d, i) => {
        const v = d[l.key];
        if (v == null || !isFinite(v)) { started = false; return; }
        const y = pad.t + ih - ((Math.max(yMin, v) - yMin) / (max - yMin)) * ih;
        if (!started) { ctx.moveTo(xAt(i), y); started = true; } else ctx.lineTo(xAt(i), y);
      });
      ctx.stroke();
    }
  }

  return {
    el: box,
    push(sample) { data.push(sample); if (data.length > win) data.shift(); draw(); },
    reset() { data = []; draw(); },
    redraw: draw,
    destroy() { ro.disconnect(); window.removeEventListener('themechange', onTheme); box.remove(); },
  };
}

function tokenFor(c) {
  return { wire: '--accent-2', signal: '--amber', amber: '--amber', bad: '--red', ok: '--green', good: '--green', teal: '--teal', violet: '--violet', ink: '--text', muted: '--text-3', orange: '--orange', pink: '--pink', accent: '--accent' }[c] || '--accent-2';
}

export function fmtNum(v) {
  if (v == null || !isFinite(v)) return '–';
  const a = Math.abs(v);
  if (a >= 1e9) return (v / 1e9).toFixed(1) + 'B';
  if (a >= 1e6) return (v / 1e6).toFixed(1) + 'M';
  if (a >= 1e4) return Math.round(v / 1e3) + 'k';
  if (a >= 1e3) return (v / 1e3).toFixed(1) + 'k';
  if (a >= 100) return String(Math.round(v));
  if (a >= 10) return v.toFixed(0);
  return (Math.round(v * 10) / 10).toString();
}
