// "How the program decides": the avoiding routine as a flow chart. A small card sits on the workbench in
// the code and drive steps; it opens into a large chart where each box shows its code. On the drive step
// the boxes light up as the simulated car runs through them.

import { h } from '../../js/core/dom.js';
import { FLOW_NODES, FLOW_EDGES, FLOW_INFO, SKETCHES, lineRange } from '../code/index.js';
import { STEPS, pick } from '../data/steps.js';
import { t } from '../i18n/index.js';
import { codeView } from './code-view.js';

const COL = 124, ROW = 92, PADX = 64, PADY = 52;
const SIZE = { start: [104, 40], do: [108, 44], ask: [104, 62] };
const W = PADX * 2 + COL * 8, H = PADY * 2 + ROW * 2 + 34;
const pos = n => [PADX + n.col * COL, PADY + n.row * ROW];
const byId = Object.fromEntries(FLOW_NODES.map(n => [n.id, n]));

const ROUTE = {
  'driveOn>measure': 'hv', 'backOff>look': 'hv', 'backUp>look': 'hv', 'same>turn': 'hv', 'again>same': 'vh', 'turn>measure': 'under',
};

function anchor(n, side) {
  const [x, y] = pos(n), [w, hh] = SIZE[n.kind];
  return { l: [x - w / 2, y], r: [x + w / 2, y], t: [x, y - hh / 2], b: [x, y + hh / 2] }[side];
}

function edgePath(a, b) {
  const A = byId[a], B = byId[b];
  const kind = ROUTE[`${a}>${b}`] || (A.row === B.row ? 'h' : 'v');
  const [ax, ay] = pos(A), [bx, by] = pos(B);
  let pts;
  if (kind === 'h') pts = [anchor(A, bx > ax ? 'r' : 'l'), anchor(B, bx > ax ? 'l' : 'r')];
  else if (kind === 'v') pts = [anchor(A, by > ay ? 'b' : 't'), anchor(B, by > ay ? 't' : 'b')];
  else if (kind === 'hv') {
    const s = anchor(A, bx > ax ? 'r' : 'l');
    const dx = a === 'backOff' ? -12 : a === 'backUp' ? 12 : 0;
    const e = anchor(B, by > ay ? 't' : 'b');
    pts = [s, [bx + dx, s[1]], [bx + dx, e[1]]];
  } else if (kind === 'vh') {
    const s = anchor(A, by > ay ? 'b' : 't');
    const e = anchor(B, bx > ax ? 'l' : 'r');
    pts = [s, [s[0], e[1]], e];
  } else {
    const s = anchor(A, 'b'), e = anchor(B, 'b');
    const yy = PADY + ROW * 2 + 30;
    pts = [s, [s[0], yy], [e[0], yy], e];
  }
  return pts;
}

function chartSvg({ small = false } = {}) {
  const ns = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(ns, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('class', 'rv-flow-svg' + (small ? ' small' : ''));
  svg.setAttribute('role', 'img');
  svg.setAttribute('aria-label', t('flow.title'));
  const mk = (tag, attrs, parent = svg) => { const e = document.createElementNS(ns, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); parent.append(e); return e; };
  const defs = mk('defs', {});
  const marker = mk('marker', { id: small ? 'rvArrS' : 'rvArr', viewBox: '0 0 10 10', refX: '9', refY: '5', markerWidth: '7', markerHeight: '7', orient: 'auto-start-reverse' }, defs);
  mk('path', { d: 'M0 0L10 5L0 10z', class: 'rv-flow-arrow' }, marker);
  const edges = {};
  for (const [a, b, ans] of FLOW_EDGES) {
    const pts = edgePath(a, b);
    const g = mk('g', { class: 'rv-flow-edge' });
    mk('polyline', { points: pts.map(p => p.join(',')).join(' '), 'marker-end': `url(#${small ? 'rvArrS' : 'rvArr'})` }, g);
    if (ans && !small) {
      const [x0, y0] = pts[0], [x1, y1] = pts[1];
      const tx = mk('text', { x: x0 + (x1 - x0) * 0.5 + (y0 === y1 ? 0 : 8), y: y0 + (y1 - y0) * 0.5 - (y0 === y1 ? 6 : 0), class: 'rv-flow-ans' }, g);
      tx.textContent = t(ans === 'yes' ? 'flow.yes' : 'flow.no');
    }
    edges[`${a}>${b}`] = g;
  }
  const nodes = {};
  for (const n of FLOW_NODES) {
    const [x, y] = pos(n), [w, hh] = SIZE[n.kind];
    const g = mk('g', { class: `rv-flow-node ${n.kind}`, 'data-id': n.id, tabindex: small ? '-1' : '0', role: small ? 'presentation' : 'button' });
    if (n.kind === 'ask') mk('polygon', { points: `${x},${y - hh / 2} ${x + w / 2},${y} ${x},${y + hh / 2} ${x - w / 2},${y}` }, g);
    else mk('rect', { x: x - w / 2, y: y - hh / 2, width: w, height: hh, rx: n.kind === 'start' ? hh / 2 : 9 }, g);
    if (!small) {
      const label = t(`flow.node.${n.id}`);
      const words = label.split(' ');
      const lines = [];
      let line = '';
      const max = n.kind === 'ask' ? 11 : 14;
      for (const wd of words) { if ((line + ' ' + wd).trim().length > max && line) { lines.push(line); line = wd; } else line = (line + ' ' + wd).trim(); }
      lines.push(line);
      lines.forEach((l, i) => { const tx = mk('text', { x, y: y + (i - (lines.length - 1) / 2) * 14 + 4 }, g); tx.textContent = l; });
    }
    nodes[n.id] = g;
  }
  return { svg, nodes, edges };
}

export function createFlow({ getBoard, onAuto, onOpenChange }) {
  let live = null;
  let selected = 'measure';
  let isOpen = false;

  // the small card on the bench
  const mini = chartSvg({ small: true });
  const sayWhat = h('b'), sayWhy = h('span');
  const say = h('p.rv-flow-say', sayWhat, sayWhy);
  const autoBtn = h('button.btn.sm.amber', { type: 'button', onclick: () => onAuto?.() }, '▶ ', t('flow.auto'));
  const badge = h('span.rv-live', h('i'), t('flow.live'));
  const expand = h('button.rv-icon-btn', { type: 'button', title: t('flow.open'), 'aria-label': t('flow.open'), onclick: () => open(), html: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M14 4h6v6M10 20H4v-6M20 4l-7 7M4 20l7-7"/></svg>' });
  const card = h('section.rv-flowcard', { 'aria-label': t('flow.title') },
    h('button.rv-flow-mini', { type: 'button', onclick: () => open(), 'aria-label': t('flow.open') }, mini.svg),
    say,
    h('footer', h('span.rv-mini-label', t('flow.label')), h('span', { style: { flex: 1 } }), badge, autoBtn, expand));

  // the big overlay
  const big = chartSvg();
  const kind = h('span.eyebrow'), title = h('h4'), text = h('p');
  const codeBox = h('div.rv-flow-code');
  const bigSayWhat = h('b'), bigSayWhy = h('span');
  const overlay = h('section.rv-flow', { hidden: true, role: 'dialog', 'aria-label': t('flow.title') },
    h('header',
      h('div', h('h3', t('flow.title')), h('span.faint.mono.rv-flow-file')),
      h('span.faint', t('flow.tip')),
      h('button.btn.ghost.icon', { type: 'button', 'aria-label': t('common.close'), title: t('common.close'), onclick: () => close() }, '✕')),
    h('div.rv-flow-chart', big.svg),
    h('p.rv-flow-say.big', bigSayWhat, bigSayWhy),
    h('div.rv-flow-detail', h('div.rv-flow-about', kind, title, text), codeBox));

  for (const [id, g] of Object.entries(big.nodes)) {
    g.addEventListener('click', () => select(id));
    g.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(id); } });
  }

  function sketchFor(board) {
    const step = STEPS.find(s => s.id === 'code');
    const sk = pick(step.sketches, board).find(x => x.key === board);
    return { ...sk, code: SKETCHES[board] };
  }

  function select(id) {
    selected = id;
    for (const [k, g] of Object.entries(big.nodes)) g.classList.toggle('sel', k === id);
    const n = byId[id], info = FLOW_INFO[id], board = getBoard();
    kind.textContent = t(`flow.kind.${n.kind}`);
    title.textContent = t(`flow.node.${id}`);
    text.textContent = info.text;
    const sk = sketchFor(board);
    overlay.querySelector('.rv-flow-file').textContent = sk.file;
    const [a, b] = info.code[board];
    const range = lineRange(sk.code, a, b);
    const cv = codeView([sk], { compact: true, maxHeight: '220px' });
    codeBox.replaceChildren(cv.el);
    if (range) requestAnimationFrame(() => cv.mark(range[0], range[1]));
  }

  function open() {
    isOpen = true;
    overlay.hidden = false;
    select(live?.node || selected);
    onOpenChange?.(true);
    overlay.querySelector('.rv-flow-node')?.focus?.();
  }
  function close() { isOpen = false; overlay.hidden = true; onOpenChange?.(false); }

  function paint(set, view) {
    const path = view?.path || [];
    for (const [id, g] of Object.entries(set.nodes)) {
      g.classList.toggle('lit', path.includes(id));
      g.classList.toggle('now', view?.node === id);
    }
    for (const [k, g] of Object.entries(set.edges)) {
      const [a, b] = k.split('>');
      const i = path.indexOf(a);
      g.classList.toggle('lit', i >= 0 && path[i + 1] === b);
    }
  }

  /** view: null when Auto is off; else { node, path, what, why } */
  function setLive(view, mode) {
    live = view;
    card.classList.toggle('drive', mode != null);
    badge.hidden = !view;
    autoBtn.hidden = !!view || mode == null;
    say.hidden = mode == null;
    const what = view ? view.what : t('flow.off');
    const why = view ? view.why : t('flow.offWhy');
    sayWhat.textContent = what; sayWhy.textContent = why;
    bigSayWhat.textContent = mode == null ? '' : what; bigSayWhy.textContent = mode == null ? '' : why;
    paint(mini, view);
    paint(big, view);
    if (view && isOpen && view.node !== selected) select(view.node);
  }

  setLive(null, null);
  return { card, overlay, open, close, setLive, isOpen: () => isOpen, refresh: () => isOpen && select(selected) };
}
