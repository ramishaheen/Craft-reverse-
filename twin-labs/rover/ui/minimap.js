// The drive step's arena map. Its pencil button turns it into an editor: obstacles can be picked, dragged,
// turned and resized while the simulation waits; Save rebuilds the arena, Cancel leaves it as it was.

import { h, token } from '../../js/core/dom.js';
import { t } from '../i18n/index.js';
import { ARENA_HALF, LIMITS, DEFAULT_OBSTACLES, cleanObstacles, blocksStart, sdf } from '../sim/sim.js';

const STYLE_COLORS = { cardboard: '#c99a5b', wood: '#d9b07a', can: '#9aa6b2', pot: '#c7643b' };
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const R2D = 180 / Math.PI;

export function createMinimap({ getSim, onEditChange, onSave }) {
  const canvas = h('canvas', { width: '196', height: '196', role: 'img', 'aria-label': t('map.aria') });
  const ctx = canvas.getContext('2d');
  let editing = false;
  let draft = null;
  let selected = null;
  let undo = [], redo = [];
  let drag = null;

  const none = h('p.faint.rv-arena-none', t('map.none'));
  const fields = {};
  const field = (key, label, unit, step = 1) => {
    const input = h('input.input', { type: 'number', inputmode: 'decimal', step: String(step) });
    input.addEventListener('change', () => setField(key, +input.value));
    const lab = h('label.rv-afield', h('span', label), input, h('em', unit));
    fields[key] = { lab, input };
    return lab;
  };
  const selName = h('h4.rv-arena-name');
  const sel = h('div.rv-arena-sel', { hidden: true },
    selName,
    h('p.rv-arena-group', t('map.size')),
    field('w', t('map.length'), 'cm'), field('d', t('map.width'), 'cm'), field('dia', t('map.diameter'), 'cm'), field('h', t('map.height'), 'cm'), field('turn', t('map.turned'), '°', 5),
    h('p.rv-arena-group', { title: t('map.placeTip') }, t('map.place')),
    field('x', t('map.ahead'), 'cm'), field('z', t('map.right'), 'cm'),
    h('div.rv-arena-add',
      h('button.btn.sm', { type: 'button', onclick: () => remove() }, t('map.remove'))));
  const hint = h('p.rv-arena-hint', { 'aria-live': 'polite' });
  const side = h('aside.rv-arena-side', none, sel,
    h('div.rv-arena-add', h('button.btn.sm', { type: 'button', onclick: () => addObstacle('box') }, t('map.addBox')), h('button.btn.sm', { type: 'button', onclick: () => addObstacle('cyl') }, t('map.addCan'))),
    h('dl.rv-arena-keys', { html: t('map.keys') }));
  const editBtn = h('button.rv-icon-btn', { type: 'button', title: t('map.editTip'), 'aria-label': t('map.edit'), onclick: () => start(), html: '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/></svg>' });
  const btn = (label, title, fn, cls = 'btn.sm.ghost') => h(`button.${cls}`, { type: 'button', title, onclick: fn }, label);
  const el = h('section.rv-minimap', { 'aria-label': t('map.aria') },
    h('header.rv-arena-head', h('h3', t('map.edit')), h('span.rv-paused', h('i'), t('map.paused'))),
    canvas,
    side,
    h('footer.rv-minimap-foot', h('span.rv-mini-label', t('map.label')), editBtn),
    h('footer.rv-arena-foot', hint,
      btn(t('map.undo'), t('map.undoTip'), () => doUndo()),
      btn(t('map.reset'), t('map.resetTip'), () => { push(); draft = DEFAULT_OBSTACLES.map(o => ({ ...o })); selected = null; refresh(); }),
      btn(t('common.cancel'), t('map.cancelTip'), () => stop(false)),
      btn(t('common.save'), t('map.saveTip'), () => stop(true), 'btn.sm.amber')));

  // ---- geometry ------------------------------------------------------------------------------
  const view = () => {
    const w = canvas.width, pad = 8 * (w / 196);
    return { w, pad, s: (w - pad * 2) / (ARENA_HALF * 2), c: w / 2 };
  };
  const toCanvas = (x, z) => { const v = view(); return [v.c + z * v.s, v.c - x * v.s]; };
  const toWorld = (px, py) => { const v = view(); return [(v.c - py) / v.s, (px - v.c) / v.s]; };

  function obstacles() { return editing ? draft : getSim().obstacles; }

  function draw() {
    const sim = getSim();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = canvas.clientWidth || 196;
    if (canvas.width !== Math.round(cssW * dpr)) { canvas.width = canvas.height = Math.round(cssW * dpr); }
    const v = view();
    ctx.clearRect(0, 0, v.w, v.w);
    ctx.fillStyle = token('--bg-2');
    ctx.fillRect(v.pad, v.pad, v.w - v.pad * 2, v.w - v.pad * 2);
    ctx.strokeStyle = token('--line');
    ctx.lineWidth = 1;
    for (let i = 1; i < 6; i++) {
      const p = v.pad + i * 50 * v.s;
      ctx.beginPath(); ctx.moveTo(p, v.pad); ctx.lineTo(p, v.w - v.pad); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(v.pad, p); ctx.lineTo(v.w - v.pad, p); ctx.stroke();
    }
    ctx.strokeStyle = token('--line-2');
    ctx.lineWidth = 2 * (v.w / 196);
    ctx.strokeRect(v.pad, v.pad, v.w - v.pad * 2, v.w - v.pad * 2);
    for (const o of obstacles()) {
      ctx.fillStyle = STYLE_COLORS[o.style] || '#999';
      ctx.strokeStyle = o.id === selected ? token('--amber') : 'rgba(0,0,0,.25)';
      ctx.lineWidth = (o.id === selected ? 3 : 1) * (v.w / 196);
      ctx.beginPath();
      if (o.kind === 'cyl') { const [px, py] = toCanvas(o.x, o.z); ctx.arc(px, py, o.r * v.s, 0, Math.PI * 2); }
      else {
        const c = Math.cos(o.rot || 0), s = Math.sin(o.rot || 0);
        [[1, 1], [1, -1], [-1, -1], [-1, 1]].forEach(([a, b], i) => {
          const lx = (a * o.w) / 2, lz = (b * o.d) / 2;
          const [px, py] = toCanvas(o.x + lx * c + lz * s, o.z - lx * s + lz * c);
          i ? ctx.lineTo(px, py) : ctx.moveTo(px, py);
        });
        ctx.closePath();
      }
      ctx.fill();
      ctx.stroke();
      if (editing && blocksStart(o)) { ctx.strokeStyle = token('--red'); ctx.lineWidth = 2; ctx.stroke(); }
    }
    // start spot and car
    const [sx, sy] = toCanvas(0, 0);
    ctx.strokeStyle = token('--amber');
    ctx.setLineDash([3, 3]);
    ctx.strokeRect(sx - 10 * v.s, sy - 13 * v.s, 20 * v.s, 27 * v.s);
    ctx.setLineDash([]);
    if (!editing) {
      const p = sim.pose;
      const [cx, cy] = toCanvas(p.x, p.z);
      // beam
      const r = sim.sonarRay();
      const len = Math.min(sim.distance, 400);
      const [bx, by] = toCanvas(r.x + Math.cos(r.bearing) * len, r.z - Math.sin(r.bearing) * len);
      ctx.strokeStyle = sim.distance < sim.cfg.clear ? token('--red') : token('--amber');
      ctx.globalAlpha = 0.8;
      ctx.beginPath(); ctx.moveTo(...toCanvas(r.x, r.z)); ctx.lineTo(bx, by); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(-p.h);
      ctx.fillStyle = token('--accent');
      ctx.strokeStyle = token('--text');
      ctx.lineWidth = 1.2 * (v.w / 196);
      const L = 24 * v.s, Wd = 16 * v.s;
      ctx.beginPath();
      ctx.moveTo(0, -L * 0.6); ctx.lineTo(Wd / 2, L * 0.45); ctx.lineTo(-Wd / 2, L * 0.45); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.restore();
    }
  }

  // ---- editing -------------------------------------------------------------------------------
  function start() {
    editing = true;
    draft = getSim().obstacles.map(o => ({ ...o }));
    selected = null; undo = []; redo = [];
    el.classList.add('editing');
    onEditChange?.(true);
    refresh();
  }

  function stop(save) {
    if (save) {
      const clean = cleanObstacles(draft);
      if (!clean) { hint.textContent = t('map.invalid'); return; }
      if (clean.some(blocksStart)) { hint.textContent = t('map.blocked'); return; }
      onSave?.(clean);
    }
    editing = false;
    draft = null;
    el.classList.remove('editing');
    onEditChange?.(false);
    hint.textContent = '';
    requestAnimationFrame(draw);
  }

  const push = () => { undo.push(JSON.stringify(draft)); if (undo.length > 60) undo.shift(); redo = []; };
  function doUndo() { if (!undo.length) return; redo.push(JSON.stringify(draft)); draft = JSON.parse(undo.pop()); if (!draft.some(o => o.id === selected)) selected = null; refresh(); }
  function doRedo() { if (!redo.length) return; undo.push(JSON.stringify(draft)); draft = JSON.parse(redo.pop()); refresh(); }
  const cur = () => draft?.find(o => o.id === selected);

  function addObstacle(kind) {
    if (!editing) start();
    push();
    const n = draft.length + 1;
    const o = kind === 'box' ? { id: `box${Date.now() % 100000}`, kind, style: n % 2 ? 'cardboard' : 'wood', x: -60, z: 60, w: 22, d: 22, h: 14, rot: 0 }
      : { id: `cyl${Date.now() % 100000}`, kind, style: 'can', x: -60, z: -60, r: 8, h: 16 };
    draft.push(o);
    selected = o.id;
    refresh();
  }
  function remove() { if (!cur()) return; push(); draft = draft.filter(o => o.id !== selected); selected = null; refresh(); }

  function setField(key, val) {
    const o = cur();
    if (!o || !Number.isFinite(val)) return;
    push();
    if (key === 'w') o.w = clamp(val, ...LIMITS.side);
    if (key === 'd') o.d = clamp(val, ...LIMITS.side);
    if (key === 'dia') o.r = clamp(val / 2, ...LIMITS.radius);
    if (key === 'h') o.h = clamp(val, ...LIMITS.height);
    if (key === 'turn') o.rot = (val / R2D);
    if (key === 'x') o.x = clamp(val, -ARENA_HALF, ARENA_HALF);
    if (key === 'z') o.z = clamp(val, -ARENA_HALF, ARENA_HALF);
    refresh();
  }

  function refresh() {
    const o = cur();
    none.hidden = !!o;
    sel.hidden = !o;
    if (o) {
      selName.textContent = t(`map.style.${o.style}`);
      const isBox = o.kind === 'box';
      fields.w.lab.hidden = fields.d.lab.hidden = fields.turn.lab.hidden = !isBox;
      fields.dia.lab.hidden = isBox;
      const vals = { w: o.w, d: o.d, dia: (o.r || 0) * 2, h: o.h, turn: Math.round(((o.rot || 0) * R2D) % 360), x: Math.round(o.x), z: Math.round(o.z) };
      for (const [k, f] of Object.entries(fields)) if (document.activeElement !== f.input) f.input.value = Math.round(vals[k] * 10) / 10;
    }
    hint.textContent = draft?.some(blocksStart) ? t('map.blocked') : '';
    draw();
  }

  canvas.addEventListener('pointerdown', e => {
    if (!editing) { start(); return; }
    const r = canvas.getBoundingClientRect();
    const sc = canvas.width / r.width;
    const [x, z] = toWorld((e.clientX - r.left) * sc, (e.clientY - r.top) * sc);
    const hit = [...draft].reverse().find(o => sdf(o, x, z) < 1.5);
    selected = hit?.id || null;
    if (hit) { push(); drag = { dx: hit.x - x, dz: hit.z - z }; canvas.setPointerCapture(e.pointerId); }
    refresh();
  });
  canvas.addEventListener('pointermove', e => {
    if (!drag || !cur()) return;
    const r = canvas.getBoundingClientRect();
    const sc = canvas.width / r.width;
    const [x, z] = toWorld((e.clientX - r.left) * sc, (e.clientY - r.top) * sc);
    const step = e.shiftKey ? 5 : 1;
    const o = cur();
    o.x = clamp(Math.round((x + drag.dx) / step) * step, -ARENA_HALF, ARENA_HALF);
    o.z = clamp(Math.round((z + drag.dz) / step) * step, -ARENA_HALF, ARENA_HALF);
    refresh();
  });
  canvas.addEventListener('pointerup', () => { drag = null; });

  function onKey(e) {
    if (!editing) return false;
    if (e.target.closest?.('input')) return false;
    const o = cur();
    const step = e.shiftKey ? 5 : 1;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.shiftKey ? doRedo() : doUndo(); return true; }
    if (e.key === 'Escape') { stop(false); return true; }
    if (!o) return false;
    const moves = { ArrowUp: [step, 0], ArrowDown: [-step, 0], ArrowLeft: [0, -step], ArrowRight: [0, step] };
    if (moves[e.key]) { push(); o.x = clamp(o.x + moves[e.key][0], -ARENA_HALF, ARENA_HALF); o.z = clamp(o.z + moves[e.key][1], -ARENA_HALF, ARENA_HALF); refresh(); return true; }
    if (e.key.toLowerCase() === 'r' && o.kind === 'box') { push(); o.rot = (o.rot || 0) + (e.shiftKey ? 15 : 5) / R2D; refresh(); return true; }
    if (e.key === 'Delete' || e.key === 'Backspace') { remove(); return true; }
    return false;
  }

  return { el, draw, onKey, isEditing: () => editing, cancel: () => editing && stop(false) };
}
