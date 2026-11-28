// Systems Lab workbench (#/systems/workbench): build a system from components, connect them,
// set traffic, schedule faults, run the model and read what happened.
// mount(el, rest) -> { destroy() }. The model lives in engine.js (run in worker.js when possible),
// templates and import/description readers in io.js.

import { h, esc, toast, modal } from '../../js/core/dom.js';
import { addTicker } from '../kit/clock.js';
import * as E from './engine.js';
import * as IO from './io.js';

const CSS_ID = 'workbench-css';
const STORE_KEY = 'twinlabs:workbench:v1';
const BASE_KEY = 'twinlabs:workbench:baseline:v1';
const NW = 176, NH = 60;
const GROUP_VAR = { Users: '--wb-users', Edge: '--wb-edge', Compute: '--wb-compute', Data: '--wb-data', Messaging: '--wb-msg', Other: '--wb-other' };
const SPEEDS = [[0.0005, '1/2000'], [0.001, '1/1000'], [0.002, '1/500'], [0.005, '1/200'], [0.01, '1/100'], [0.02, '1/50'], [0.05, '1/20'], [0.2, '1/5'], [1, '1×'], [10, '10×']];
const SOURCE_LABEL = { default: 'default', import: 'from import', template: 'template', user: 'set by you', description: 'from description', inferred: 'inferred', fitted: 'fitted', measured: 'measured' };
const CAL_FIELDS = [['rateRps', 'Requests/s offered'], ['completedRps', 'Completed/s'], ['p50Ms', 'p50 ms'], ['p95Ms', 'p95 ms'], ['errorPct', 'Errors %']];

// Own line icons on a 24×24 grid (stroke = currentColor).
const ICON = {
  traffic: '<circle cx="8.5" cy="8" r="3"/><path d="M3 19.5c.4-3.4 2.6-5.5 5.5-5.5s5.1 2.1 5.5 5.5"/><circle cx="16.5" cy="9" r="2.4"/><path d="M15.6 14.2c2.6.2 4.6 2 5 5.3"/>',
  cdn: '<circle cx="12" cy="12" r="8.6"/><path d="M3.6 9.5h16.8M3.6 14.5h16.8M12 3.4c-2.4 2.6-3.4 5.5-3.4 8.6s1 6 3.4 8.6M12 3.4c2.4 2.6 3.4 5.5 3.4 8.6s-1 6-3.4 8.6"/>',
  ratelimit: '<path d="M4.5 17.5a7.5 7.5 0 1 1 15 0"/><path d="M12 17.5l3.6-4.8"/><circle cx="12" cy="17.5" r="1.2"/><path d="M7 12.4l.9.7M12 10v1.2M17 12.4l-.9.7"/>',
  lb: '<circle cx="5" cy="12" r="2.1"/><path d="M7.1 12h3.4M10.5 12 18 5.5M10.5 12H18M10.5 12 18 18.5"/><rect x="18" y="4" width="3" height="3" rx=".8"/><rect x="18" y="10.5" width="3" height="3" rx=".8"/><rect x="18" y="17" width="3" height="3" rx=".8"/>',
  gateway: '<path d="M3.5 20.5V9.5L12 4l8.5 5.5v11"/><path d="M9 20.5V15a3 3 0 0 1 6 0v5.5"/><path d="M2 20.5h20"/>',
  app: '<rect x="3.5" y="4" width="17" height="6.5" rx="1.6"/><rect x="3.5" y="13.5" width="17" height="6.5" rx="1.6"/><circle cx="7.3" cy="7.25" r=".7"/><circle cx="7.3" cy="16.75" r=".7"/><path d="M10.5 7.25h6.5M10.5 16.75h6.5"/>',
  auth: '<path d="M12 3.2 19 6v5.4c0 4.4-3 8-7 9.4-4-1.4-7-5-7-9.4V6z"/><rect x="9" y="11" width="6" height="4.6" rx="1"/><path d="M10.3 11V9.6a1.7 1.7 0 0 1 3.4 0V11"/>',
  worker: '<circle cx="12" cy="12" r="3.1"/><path d="M12 3v2.4M12 18.6V21M3 12h2.4M18.6 12H21M5.6 5.6l1.7 1.7M16.7 16.7l1.7 1.7M5.6 18.4l1.7-1.7M16.7 7.3l1.7-1.7"/>',
  cache: '<rect x="3.5" y="5" width="17" height="14" rx="2.2"/><path d="M13.2 7.6 9 12.6h3.4l-1.4 3.8 4.2-5h-3.4z"/>',
  db: '<ellipse cx="12" cy="6" rx="7.2" ry="2.7"/><path d="M4.8 6v12c0 1.5 3.2 2.7 7.2 2.7s7.2-1.2 7.2-2.7V6"/><path d="M4.8 12c0 1.5 3.2 2.7 7.2 2.7s7.2-1.2 7.2-2.7"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.2"/><path d="m15.2 15.2 5.3 5.3M8 9h5M8 12h3.5"/>',
  storage: '<path d="M4.5 7h15l-1.5 12.2a1.6 1.6 0 0 1-1.6 1.4H7.6A1.6 1.6 0 0 1 6 19.2z"/><path d="M3.5 7c0-1.5 3.8-2.6 8.5-2.6S20.5 5.5 20.5 7"/><path d="M9 13h6"/>',
  queue: '<rect x="2.5" y="9" width="4.4" height="7.5" rx="1"/><rect x="9.8" y="9" width="4.4" height="7.5" rx="1"/><rect x="17.1" y="9" width="4.4" height="7.5" rx="1"/><path d="M5 5.5h14m0 0-1.8-1.6M19 5.5l-1.8 1.6"/>',
  external: '<path d="M7.2 18.5h10.3a3.8 3.8 0 0 0 .5-7.6 5.8 5.8 0 0 0-11.2 1.2 3.2 3.2 0 0 0 .4 6.4z"/><path d="M12 16.2v-4.6m0 0-1.9 1.9m1.9-1.9 1.9 1.9"/>',
};
const icon = (type, size = 20) => `<svg class="wb-ico" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON[type] || ICON.app}</svg>`;
const SVGNS = 'http://www.w3.org/2000/svg';
const svgEl = (tag, attrs = {}, parent) => { const e = document.createElementNS(SVGNS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); if (parent) parent.append(e); return e; };
const fmt = (v, d = 0) => (v == null || !Number.isFinite(+v) ? '–' : (+v).toLocaleString('en', { maximumFractionDigits: d, minimumFractionDigits: d }));
const fmtLoose = (v, d = 0) => (v == null || !Number.isFinite(+v) ? '–' : (+v).toLocaleString('en', { maximumFractionDigits: d }));
const pct = v => fmt(v * 100, 0) + '%';
const secs = ms => +(ms / 1000).toFixed(1);
const shorten = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const niceMax = v => { if (v <= 0) return 1; const p = 10 ** Math.floor(Math.log10(v)); return [1, 2, 2.5, 5, 10].map(x => x * p).find(x => x >= v); };
const readJSON = key => { try { return JSON.parse(localStorage.getItem(key) || 'null'); } catch { return null; } };
const writeJSON = (key, v) => { try { if (v === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(v)); return true; } catch { return false; } };

export function mount(root, rest = []) {
  void rest;
  if (!document.getElementById(CSS_ID)) document.head.append(h('link', { rel: 'stylesheet', href: new URL('./workbench.css', import.meta.url).href, id: CSS_ID }));
  const cleanups = [];
  let destroyed = false;

  // ---------------- state ----------------
  let doc = loadDoc() || IO.TEMPLATES[0].make();
  let sel = null;                 // { kind: 'node'|'edge', id }
  let result = null;              // last run (+ key, stale, summary) or { failed }
  let running = false, runNote = '', routeNote = '';
  let baseline = readJSON(BASE_KEY);
  if (baseline && !(baseline.doc && baseline.summary)) baseline = null;
  let challenge = null;           // { c, stage }
  let calState = null;
  const sweepState = { key: 'rate', from: '', to: '', steps: 6, busy: false, out: null, docKey: null };
  const view = { x: 0, y: 0, k: 1 };
  let replay = null;
  const history = makeHistory(100);

  // ---------------- DOM ----------------
  const titleIn = h('input.input.wb-title', { 'aria-label': 'Design name', maxlength: 80 });
  const btn = (label, attrs = {}) => h('button.btn.sm', { type: 'button', ...attrs }, label);
  const undoB = btn('Undo', { title: 'Undo (Ctrl+Z)' }), redoB = btn('Redo', { title: 'Redo (Ctrl+Shift+Z)' });
  const newB = btn('New'), importB = btn('Import'), exportB = btn('Export JSON'), keysB = btn('Shortcuts', { title: 'Keyboard shortcuts' });
  const fileIn = h('input', { type: 'file', accept: 'application/json,.json,.yaml,.yml,text/yaml', hidden: true });
  const top = h('header.wb-top',
    h('a.wb-brand', { href: '#/systems' }, '← Systems Lab', h('small', ' / Build your own system'), h('span.chip.accent', 'Beta')),
    titleIn, h('div.wb-actions', undoB, redoB, newB, importB, exportB, keysB, fileIn));

  const paletteScroll = h('div.wb-palette-scroll');
  const tplBox = h('div.wb-tpls');
  const guideB = h('button.btn.wb-guide', { type: 'button' }, 'Describe your system…');
  const descB = h('button.btn.wb-guide', { type: 'button' }, 'From a written description…');
  const palette = h('aside.wb-palette', { 'aria-label': 'Components' },
    h('h2', 'Build'),
    h('p.wb-hint', 'Tap a component to add it, or drag it onto the canvas. Drag from the dot on a component\'s right edge to another component to connect them. Calls run in the order you connect them.'),
    paletteScroll,
    h('div.wb-extra', guideB, descB),
    h('p.wb-hint', 'Answer a few questions about a system you run; anything you leave blank gets a default that is listed for you to check.'),
    h('h2', { style: { marginTop: '14px' } }, 'Templates'), tplBox);

  const svg = svgEl('svg', { class: 'wb-svg', role: 'application', 'aria-label': 'Design canvas. Drag components to move them, drag from a right-hand dot to connect.' });
  const defs = svgEl('defs', {}, svg);
  const mk = (id, cls) => { const m = svgEl('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 8, markerHeight: 8, orient: 'auto-start-reverse' }, defs); svgEl('path', { d: 'M0 0L10 5L0 10z', class: cls }, m); };
  const uid = Math.random().toString(36).slice(2, 8);
  mk(`wbA-${uid}`, 'wb-arrow'); mk(`wbAS-${uid}`, 'wb-arrow sel');
  const pat = svgEl('pattern', { id: `wbG-${uid}`, width: 20, height: 20, patternUnits: 'userSpaceOnUse' }, defs);
  svgEl('path', { d: 'M20 0H0V20', fill: 'none', class: 'wb-gridline' }, pat);
  const vp = svgEl('g', {}, svg);
  svgEl('rect', { x: -5000, y: -5000, width: 10000, height: 10000, fill: `url(#wbG-${uid})`, 'data-bg': '1' }, vp);
  const edgeLayer = svgEl('g', {}, vp), nodeLayer = svgEl('g', {}, vp), overLayer = svgEl('g', { 'pointer-events': 'none' }, vp);
  const tempPath = svgEl('path', { class: 'wb-temp', d: '', visibility: 'hidden' }, vp);
  const emptyMsg = h('p.wb-empty', 'Start from a template, or add Users and connect components to them.');
  const zoomBox = h('div.wb-zoom', btn('+', { title: 'Zoom in (+)', 'aria-label': 'Zoom in', onclick: () => zoomBy(1.2) }), btn('−', { title: 'Zoom out (−)', 'aria-label': 'Zoom out', onclick: () => zoomBy(1 / 1.2) }), btn('⤢', { title: 'Fit the design (0)', 'aria-label': 'Fit the design', onclick: () => fit() }));
  const statusPill = h('div.wb-status', '100%');
  const challengeBox = h('div.wb-challenge', { hidden: true });
  const rpPlay = btn('Pause'), rpSpeed = h('select.input', { 'aria-label': 'Replay speed' }), rpTime = h('input', { type: 'range', min: 0, max: 60000, step: 1, value: 0, 'aria-label': 'Replay time' });
  const rpLabel = h('span.wb-rp-label', '0.00 s'), rpClose = h('button.wb-x', { type: 'button', 'aria-label': 'Close the replay' }, '×');
  const rpLegend = h('div.wb-rp-legend');
  const replayBar = h('div.wb-replay', { hidden: true }, rpPlay, rpSpeed, rpTime, rpLabel, rpClose, rpLegend);
  const canvasWrap = h('section.wb-canvas-wrap', { 'aria-label': 'Design canvas' }, emptyMsg, zoomBox, statusPill, challengeBox, replayBar);
  canvasWrap.prepend(svg);

  const inspector = h('div');
  const workloadBox = h('div'), routesBox = h('div'), assumeBox = h('div'), sweepBox = h('div'), costBox = h('div'), calBox = h('div'), faultsBox = h('div');
  const issues = h('ul.wb-issues'), runB = h('button.btn.primary.wb-run', { type: 'button' }, 'Run');
  const runState = h('p.wb-runstate', { 'aria-live': 'polite', dataset: { state: 'idle' } }, 'Not run yet.');
  const resultsInner = h('div', { 'aria-live': 'polite' });
  const assumeWrap = h('div.wb-box', { hidden: true }, h('h2', 'Assumptions'), assumeBox);
  const resultsWrap = h('div.wb-box', { hidden: true }, h('h2', 'Results ', h('span.chip', 'modelled')), resultsInner);
  const side = h('aside.wb-side', { 'aria-label': 'Settings' },
    inspector,
    h('div.wb-box', h('h2', 'Traffic'), workloadBox),
    h('div.wb-box', h('h2', 'Requests'), h('p.wb-hint', 'Request types share the traffic, for example 90% reads and 10% writes. Untick a component that a type does not use.'), routesBox),
    assumeWrap,
    h('div.wb-box', h('h2', 'What if…'), h('p.wb-hint', 'Vary one setting across a range to see which settings matter and where the design slows down or fails.'), sweepBox),
    h('details.wb-box', h('summary', h('h2', 'Cost (optional)')), costBox),
    h('details.wb-box', h('summary', h('h2', 'Calibrate')), calBox),
    h('div.wb-box', h('h2', 'Break it'), h('p.wb-hint', 'Schedule faults, then run to see how the design copes.'), faultsBox),
    h('div.wb-box', h('h2', 'Check'), issues, runB, runState, h('p.wb-note', 'Results come from a model of your settings, not from measuring a real system.')),
    resultsWrap);

  const wbRoot = h('div.wb', top, h('main.wb-main', palette, canvasWrap, side));
  root.append(wbRoot);

  // dialogs
  const dlgs = buildDialogs();
  wbRoot.append(dlgs.importDlg, dlgs.guideDlg, dlgs.descDlg);

  // ---------------- engine runner (worker with inline fallback) ----------------
  const runner = makeRunner();
  cleanups.push(() => runner.dispose());

  // ---------------- palette & templates ----------------
  paletteScroll.innerHTML = E.GROUPS.map(g => `<div class="wb-pgroup"><h3>${esc(g)}</h3><div class="wb-pgrid">` +
    Object.keys(E.TYPES).filter(t => E.TYPES[t].group === g).map(t => `<button class="btn wb-add" type="button" data-type="${t}" title="${esc(E.TYPES[t].desc)}" style="--gc:var(${GROUP_VAR[g]})">${icon(t, 20)}<span>${esc(E.TYPES[t].label)}</span></button>`).join('') +
    '</div></div>').join('');
  tplBox.innerHTML = IO.TEMPLATES.map(t => `<button class="wb-tpl${t.challenge ? ' break' : ''}" type="button" data-tpl="${t.id}"><b>${esc(t.label)}</b><span>${esc(t.desc)}</span></button>`).join('');
  let paletteDrag = null, suppressClick = false;
  paletteScroll.addEventListener('pointerdown', e => {
    const b = e.target.closest('[data-type]');
    if (!b || e.button !== 0 || e.pointerType === 'touch') return;
    paletteDrag = { type: b.dataset.type, x: e.clientX, y: e.clientY, ghost: null };
  });
  const onDocMove = e => {
    if (!paletteDrag) return;
    if (!paletteDrag.ghost && Math.hypot(e.clientX - paletteDrag.x, e.clientY - paletteDrag.y) > 6) {
      paletteDrag.ghost = h('div', { style: { position: 'fixed', zIndex: 60, pointerEvents: 'none', padding: '8px 12px', borderRadius: '10px', background: 'var(--surface)', border: '1.5px solid var(--accent)', boxShadow: 'var(--shadow)', font: '600 13px var(--font)', color: 'var(--text)', display: 'flex', gap: '8px', alignItems: 'center' }, html: icon(paletteDrag.type, 18) + esc(E.TYPES[paletteDrag.type].label) });
      document.body.append(paletteDrag.ghost);
    }
    if (paletteDrag.ghost) { paletteDrag.ghost.style.left = e.clientX + 8 + 'px'; paletteDrag.ghost.style.top = e.clientY + 8 + 'px'; }
  };
  const onDocUp = e => {
    if (!paletteDrag) return;
    const d = paletteDrag;
    paletteDrag = null;
    if (!d.ghost) return;
    d.ghost.remove();
    suppressClick = true;
    setTimeout(() => { suppressClick = false; }, 0);
    const r = svg.getBoundingClientRect();
    if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom) return;
    const w = toWorld(e.clientX - r.left, e.clientY - r.top);
    addComponent(d.type, { x: Math.round(w.x - NW / 2), y: Math.round(w.y - NH / 2) });
  };
  document.addEventListener('pointermove', onDocMove);
  document.addEventListener('pointerup', onDocUp);
  cleanups.push(() => { document.removeEventListener('pointermove', onDocMove); document.removeEventListener('pointerup', onDocUp); paletteDrag?.ghost?.remove(); });
  paletteScroll.addEventListener('click', e => {
    const b = e.target.closest('[data-type]');
    if (!b || suppressClick) return;
    addComponent(b.dataset.type);
  });
  function addComponent(type, pos) {
    if (type === 'traffic' && doc.nodes.some(n => n.type === 'traffic')) {
      sel = { kind: 'node', id: doc.nodes.find(n => n.type === 'traffic').id };
      toast('A design has one Users component; it is now selected.');
      return commit();
    }
    if (doc.nodes.length >= E.LIMITS.nodes) return toast(`A design can have at most ${E.LIMITS.nodes} components.`);
    const slot = i => ({ x: 40 + (i % 5) * 200, y: 60 + Math.floor(i / 5) * 110 + (i % 2) * 40 });
    const free = q => doc.nodes.every(o => Math.abs(o.pos.x - q.x) > NW + 16 || Math.abs(o.pos.y - q.y) > NH + 16);
    let i = 0;
    while (!free(slot(i)) && i < 200) i++;
    const p = pos || slot(i);
    const node = E.addNode(doc, type, p);
    sel = { kind: 'node', id: node.id };
    commit({ structure: true });
    if (!pos) ensureVisible(node);
  }
  tplBox.addEventListener('click', e => {
    const b = e.target.closest('[data-tpl]');
    if (!b) return;
    const t = IO.TEMPLATES.find(x => x.id === b.dataset.tpl);
    replaceDoc(t.make());
    challenge = t.challenge ? { c: t.challenge, stage: 'before' } : null;
    paintChallenge();
  });
  function replaceDoc(d) {
    doc = d; sel = null; result = null; stopReplay();
    commit();
    fit();
  }

  // ---------------- header actions ----------------
  undoB.onclick = undo; redoB.onclick = redo;
  newB.onclick = () => { replaceDoc(E.newDoc()); challenge = null; paintChallenge(); };
  exportB.onclick = () => download((doc.title || 'design').replace(/[^\w-]+/g, '-').toLowerCase() + '.json', JSON.stringify(doc, null, 1) + '\n');
  importB.onclick = () => dlgs.openImport();
  keysB.onclick = showShortcuts;
  titleIn.addEventListener('change', () => { doc.title = titleIn.value.trim() || 'Untitled design'; history.record(JSON.stringify(doc)); saveDoc(); paintUndo(); });
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files[0];
    fileIn.value = '';
    if (!f) return;
    if (f.size > 1e6) return dlgs.showImportReview({ errors: ['The file is larger than 1 MB'], assumptions: [], ignored: [], warnings: [] });
    dlgs.importText.value = await f.text();
    dlgs.reviewImport();
  });

  // ---------------- commit, history, save ----------------
  function keyOf(d) { return JSON.stringify({ ...d, title: '', id: '', costs: null, calibration: null, assumptions: null, nodes: d.nodes.map(({ pos, ...n }) => n) }); }
  function markStale() {
    if (!result || result.failed) return;
    result.stale = keyOf(doc) !== result.key;
    if (result.stale) stopReplay();
  }
  function commit({ structure = false, redraw = true } = {}) {
    routeNote = '';
    markStale();
    if (structure) {
      const routes = E.deriveRoutes(doc);
      if (routes) doc.routes = routes;
      else routeNote = 'Users connect to more than one component in a row, so the request path is unclear and the previous request types were kept. Put one load balancer or gateway in front.';
      markStale();
    }
    if (redraw) drawCanvas();
    history.record(JSON.stringify(doc));
    renderPanels();
    saveDoc();
  }
  function restore(json) {
    if (json === null) return;
    doc = JSON.parse(json);
    if (sel && !(sel.kind === 'node' ? doc.nodes : doc.edges).some(x => x.id === sel.id)) sel = null;
    routeNote = '';
    markStale();
    drawCanvas(); renderPanels(); saveDoc();
  }
  function undo() { restore(history.undo()); }
  function redo() { restore(history.redo()); }
  function paintUndo() { undoB.disabled = !history.canUndo; redoB.disabled = !history.canRedo; }
  let saveTimer = 0;
  function saveDoc() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { try { localStorage.setItem(STORE_KEY, JSON.stringify(doc)); } catch { /* storage may be unavailable */ } }, 300); }
  function loadDoc() {
    try { const raw = localStorage.getItem(STORE_KEY); if (!raw) return null; const d = JSON.parse(raw); return E.validate(d).errors.some(x => /schema|Not a/.test(x)) ? null : d; } catch { return null; }
  }
  cleanups.push(() => { clearTimeout(saveTimer); try { localStorage.setItem(STORE_KEY, JSON.stringify(doc)); } catch { /* ignore */ } });

  // ---------------- canvas drawing ----------------
  const nodeById = id => doc.nodes.find(n => n.id === id);
  const label = id => nodeById(id)?.label || id;
  function subtitle(n) {
    const c = n.config, kind = E.kindOf(n.type);
    if (n.type === 'cache') return `${E.ENUM_LABEL[c.pattern]}, hit ${Math.round(c.hitP * 100)}%`;
    if (n.type === 'cdn') return `hit ${Math.round(c.hitP * 100)}%`;
    if (n.type === 'lb') return E.ENUM_LABEL[c.strategy] || c.strategy;
    if (n.type === 'ratelimit') return `${c.limitRps} req/s`;
    if (n.type === 'queue') return `holds ${c.capacity}`;
    if (kind === 'server') return c.instances ? `${c.instances} × ${c.concurrency} at once` : `${c.concurrency} at once`;
    return '';
  }
  function edgePath(e) {
    const a = nodeById(e.from), b = nodeById(e.to);
    if (!a || !b) return '';
    const x1 = a.pos.x + NW, y1 = a.pos.y + NH / 2, x2 = b.pos.x - 2, y2 = b.pos.y + NH / 2;
    const c = Math.max(40, Math.abs(x2 - x1) / 2);
    return `M${x1},${y1} C${x1 + c},${y1} ${x2 - c},${y2} ${x2},${y2}`;
  }
  function drawCanvas() {
    edgeLayer.replaceChildren(); nodeLayer.replaceChildren();
    const faulted = new Set((doc.faults || []).map(f => f.node));
    for (const e of doc.edges) {
      const isSel = sel?.kind === 'edge' && sel.id === e.id;
      const g = svgEl('g', { 'data-edge': e.id }, edgeLayer);
      const d = edgePath(e);
      svgEl('path', { d, class: 'wb-edge-hit' }, g);
      svgEl('path', { d, class: `wb-edge${e.kind === 'async' ? ' async' : ''}${isSel ? ' sel' : ''}`, 'marker-end': `url(#${isSel ? 'wbAS' : 'wbA'}-${uid})` }, g);
      const tag = [e.retry ? `retry ×${e.retry.max}` : '', e.breaker ? 'breaker' : ''].filter(Boolean).join(' + ');
      if (tag) {
        const a = nodeById(e.from), b = nodeById(e.to);
        const mx = (a.pos.x + NW + b.pos.x) / 2, my = (a.pos.y + b.pos.y) / 2 + NH / 2 - 14;
        const tg = svgEl('g', { class: 'wb-edge-tag', 'pointer-events': 'none' }, g);
        const w = tag.length * 6 + 12;
        svgEl('rect', { x: mx - w / 2, y: my - 9, width: w, height: 18, rx: 4 }, tg);
        svgEl('text', { x: mx, y: my + 4, 'text-anchor': 'middle' }, tg).textContent = tag;
      }
    }
    for (const n of doc.nodes) {
      const isSel = sel?.kind === 'node' && sel.id === n.id;
      const t = E.TYPES[n.type];
      const g = svgEl('g', { class: `wb-node${isSel ? ' sel' : ''}${faulted.has(n.id) ? ' fault' : ''}`, transform: `translate(${n.pos.x},${n.pos.y})`, 'data-node': n.id, tabindex: 0, role: 'button', 'aria-label': `${n.label}, ${t?.label || n.type}` }, nodeLayer);
      svgEl('rect', { class: 'body', width: NW, height: NH, rx: 10 }, g);
      const colVar = `var(${GROUP_VAR[t?.group] || '--accent-2'})`;
      svgEl('rect', { x: 0, y: 8, width: 4, height: NH - 16, rx: 2, style: `fill:${colVar}` }, g);
      const ig = svgEl('g', { class: 'ico', transform: `translate(12,${(NH - 30) / 2}) scale(1.25)`, style: `stroke:${colVar}` }, g);
      ig.innerHTML = ICON[n.type] || ICON.app;
      const sub = subtitle(n);
      svgEl('text', { class: 'lbl', x: 52, y: sub ? 25 : NH / 2 + 4.5 }, g).textContent = shorten(n.label, 16);
      if (sub) svgEl('text', { class: 'sub', x: 52, y: 42 }, g).textContent = shorten(sub, 20);
      if (n.type !== 'traffic') svgEl('circle', { class: 'wb-port in', cx: 0, cy: NH / 2, r: 7 }, g);
      svgEl('circle', { class: 'wb-port out', cx: NW, cy: NH / 2, r: 7, 'data-port': 'out' }, g);
      svgEl('circle', { cx: NW, cy: NH / 2, r: 15, fill: 'transparent', 'data-port': 'out', style: 'cursor:crosshair' }, g);
    }
    emptyMsg.hidden = doc.nodes.length > 0;
    replay?.draw();
  }
  function moveNodeVisual(n) {
    const g = nodeLayer.querySelector(`[data-node="${CSS.escape(n.id)}"]`);
    if (g) g.setAttribute('transform', `translate(${n.pos.x},${n.pos.y})`);
    for (const e of doc.edges) if (e.from === n.id || e.to === n.id) {
      const eg = edgeLayer.querySelector(`[data-edge="${CSS.escape(e.id)}"]`);
      if (!eg) continue;
      const d = edgePath(e);
      for (const p of eg.querySelectorAll('path')) p.setAttribute('d', d);
      const tg = eg.querySelector('.wb-edge-tag');
      if (tg) { tg.remove(); }
    }
    replay?.draw();
  }

  // ---------------- view: pan & zoom ----------------
  const applyView = () => { vp.setAttribute('transform', `translate(${view.x},${view.y}) scale(${view.k})`); statusPill.textContent = `${Math.round(view.k * 100)}%`; };
  const toWorld = (sx, sy) => ({ x: (sx - view.x) / view.k, y: (sy - view.y) / view.k });
  function zoomAt(sx, sy, f) {
    const k = Math.max(0.2, Math.min(2.5, view.k * f));
    const w = toWorld(sx, sy);
    view.k = k; view.x = sx - w.x * k; view.y = sy - w.y * k;
    applyView();
  }
  function zoomBy(f) { const r = svg.getBoundingClientRect(); zoomAt(r.width / 2, r.height / 2, f); }
  function fit() {
    const r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    if (!doc.nodes.length) { view.k = 1; view.x = 24; view.y = 24; return applyView(); }
    const xs = doc.nodes.map(n => n.pos.x), ys = doc.nodes.map(n => n.pos.y);
    const x0 = Math.min(...xs) - 24, y0 = Math.min(...ys) - 24, x1 = Math.max(...xs) + NW + 24, y1 = Math.max(...ys) + NH + 34;
    let k = Math.max(0.2, Math.min(1, r.width / (x1 - x0), r.height / (y1 - y0)));
    const narrow = r.width < 600 && k < 0.55;
    if (narrow) k = 0.55; // on phones keep labels readable; the start of the design is shown and the rest pans into view
    view.k = k; view.x = narrow ? -x0 * k : (r.width - (x1 - x0) * k) / 2 - x0 * k; view.y = (r.height - (y1 - y0) * k) / 2 - y0 * k;
    applyView();
  }
  function ensureVisible(n) {
    const r = svg.getBoundingClientRect();
    const sx = n.pos.x * view.k + view.x, sy = n.pos.y * view.k + view.y;
    if (sx < 0 || sy < 0 || sx + NW * view.k > r.width || sy + NH * view.k > r.height) fit();
  }
  let firstFit = true;
  const ro = new ResizeObserver(() => { if (firstFit && svg.getBoundingClientRect().width) { firstFit = false; fit(); } replay?.draw(); });
  ro.observe(canvasWrap);
  cleanups.push(() => ro.disconnect());

  // ---------------- canvas pointer interaction ----------------
  const pointers = new Map();
  let gesture = null;
  const local = e => { const r = svg.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
  svg.addEventListener('pointerdown', e => {
    if (e.button !== undefined && e.button > 0) return;
    pointers.set(e.pointerId, local(e));
    try { svg.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      gesture = { mode: 'pinch', dist: Math.hypot(a.x - b.x, a.y - b.y), k: view.k };
      tempPath.setAttribute('visibility', 'hidden');
      return;
    }
    const p = local(e);
    const port = e.target.closest('[data-port]');
    const nodeG = e.target.closest('[data-node]');
    const edgeG = e.target.closest('[data-edge]');
    if (port && nodeG) {
      gesture = { mode: 'connect', from: nodeG.dataset.node, start: p };
      updateTemp(p);
    } else if (nodeG) {
      const n = nodeById(nodeG.dataset.node);
      gesture = { mode: 'node', id: n.id, start: p, orig: { ...n.pos }, moved: false };
    } else if (edgeG) {
      gesture = { mode: 'edge', id: edgeG.dataset.edge, start: p };
    } else {
      gesture = { mode: 'pan', start: p, orig: { x: view.x, y: view.y }, moved: false };
    }
    e.preventDefault();
  });
  svg.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const p = local(e);
    pointers.set(e.pointerId, p);
    if (!gesture) return;
    if (gesture.mode === 'pinch' && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (gesture.dist > 0) zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, (gesture.k * d / gesture.dist) / view.k);
      return;
    }
    const dx = p.x - gesture.start.x, dy = p.y - gesture.start.y;
    if (gesture.mode === 'pan') {
      if (Math.hypot(dx, dy) > 3) { gesture.moved = true; svg.classList.add('panning'); }
      view.x = gesture.orig.x + dx; view.y = gesture.orig.y + dy; applyView();
    } else if (gesture.mode === 'node') {
      if (!gesture.moved && Math.hypot(dx, dy) < 4) return;
      gesture.moved = true;
      const n = nodeById(gesture.id);
      if (!n) return;
      n.pos = { x: Math.round((gesture.orig.x + dx / view.k) / 10) * 10, y: Math.round((gesture.orig.y + dy / view.k) / 10) * 10 };
      moveNodeVisual(n);
    } else if (gesture.mode === 'connect') {
      updateTemp(p);
      const tg = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-node]');
      for (const g of nodeLayer.querySelectorAll('.drop')) g.classList.remove('drop');
      if (tg && canConnect(gesture.from, tg.dataset.node)) tg.classList.add('drop');
    }
  });
  const endPointer = e => {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    const g = gesture;
    if (!g) return;
    if (g.mode === 'pinch') { if (pointers.size === 0) gesture = null; return; }
    gesture = null;
    svg.classList.remove('panning');
    if (e.type === 'pointercancel') { tempPath.setAttribute('visibility', 'hidden'); return; }
    if (g.mode === 'pan' && !g.moved && sel) { sel = null; commit({ redraw: true }); }
    else if (g.mode === 'node') {
      if (g.moved) { drawCanvas(); history.record(JSON.stringify(doc)); paintUndo(); saveDoc(); }
      else { sel = { kind: 'node', id: g.id }; commit(); }
    } else if (g.mode === 'edge') { sel = { kind: 'edge', id: g.id }; commit(); }
    else if (g.mode === 'connect') {
      tempPath.setAttribute('visibility', 'hidden');
      for (const x of nodeLayer.querySelectorAll('.drop')) x.classList.remove('drop');
      const tg = document.elementFromPoint(e.clientX, e.clientY)?.closest?.('[data-node]');
      if (tg) connect(g.from, tg.dataset.node);
    }
  };
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);
  svg.addEventListener('wheel', e => {
    if (!(e.ctrlKey || e.metaKey)) return;
    e.preventDefault();
    const p = local(e);
    zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });
  svg.addEventListener('keydown', e => {
    const g = e.target.closest?.('[data-node]');
    if (g && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); e.stopPropagation(); sel = { kind: 'node', id: g.dataset.node }; commit(); }
  });
  function updateTemp(p) {
    const n = nodeById(gesture.from);
    if (!n) return;
    const w = toWorld(p.x, p.y), x1 = n.pos.x + NW, y1 = n.pos.y + NH / 2, c = Math.max(30, Math.abs(w.x - x1) / 2);
    tempPath.setAttribute('d', `M${x1},${y1} C${x1 + c},${y1} ${w.x - c},${w.y} ${w.x},${w.y}`);
    tempPath.setAttribute('visibility', 'visible');
  }
  function canConnect(from, to) { return from !== to && nodeById(to)?.type !== 'traffic' && !doc.edges.some(e => e.from === from && e.to === to); }
  function connect(from, to) {
    if (from === to) return;
    if (nodeById(to)?.type === 'traffic') return toast('Nothing can send requests to Users.');
    if (doc.edges.length >= E.LIMITS.edges) return toast(`A design can have at most ${E.LIMITS.edges} connections.`);
    const e = E.addEdge(doc, from, to);
    if (!e) return toast('Those two are already connected.');
    sel = { kind: 'edge', id: e.id };
    commit({ structure: true });
  }

  // ---------------- keyboard ----------------
  const onKey = e => {
    if (destroyed || document.querySelector('dialog[open], .modal-back')) return;
    if (/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable) return;
    const mod = e.ctrlKey || e.metaKey, k = e.key.toLowerCase();
    if (mod && !e.altKey) {
      if (k === 'z' && !e.shiftKey) { e.preventDefault(); undo(); }
      else if ((k === 'z' && e.shiftKey) || k === 'y') { e.preventDefault(); redo(); }
      else if (k === 'enter') { e.preventDefault(); run(); }
      else if (k === 'd' && sel?.kind === 'node') { e.preventDefault(); duplicate(); }
      else if (k === 's') { e.preventDefault(); clearTimeout(saveTimer); try { localStorage.setItem(STORE_KEY, JSON.stringify(doc)); toast('Saved in this browser'); } catch { toast('This browser would not save the design'); } }
      return;
    }
    if (e.altKey) return;
    if ((e.key === 'Delete' || e.key === 'Backspace') && sel) { e.preventDefault(); deleteSelection(); }
    else if (e.key === 'Escape') { if (gesture?.mode === 'connect') { gesture = null; tempPath.setAttribute('visibility', 'hidden'); } else if (sel) { sel = null; commit(); } }
    else if (e.key === '+' || e.key === '=') { zoomBy(1.2); }
    else if (e.key === '-' || e.key === '_') { zoomBy(1 / 1.2); }
    else if (e.key === '0') { fit(); }
    else if (e.key.startsWith('Arrow') && sel?.kind === 'node') {
      e.preventDefault();
      const n = nodeById(sel.id), s = e.shiftKey ? 50 : 10;
      if (!n) return;
      n.pos = { x: n.pos.x + (e.key === 'ArrowLeft' ? -s : e.key === 'ArrowRight' ? s : 0), y: n.pos.y + (e.key === 'ArrowUp' ? -s : e.key === 'ArrowDown' ? s : 0) };
      moveNodeVisual(n); drawCanvas(); history.record(JSON.stringify(doc)); paintUndo(); saveDoc();
    }
  };
  document.addEventListener('keydown', onKey);
  cleanups.push(() => document.removeEventListener('keydown', onKey));
  function deleteSelection() {
    if (!sel) return;
    if (sel.kind === 'node') E.removeNode(doc, sel.id);
    else doc.edges = doc.edges.filter(e => e.id !== sel.id);
    sel = null;
    commit({ structure: true });
  }
  function duplicate() {
    const n = nodeById(sel.id);
    if (!n || n.type === 'traffic') return toast('Users cannot be duplicated: a design has one.');
    const c = E.addNode(doc, n.type, { x: n.pos.x + 30, y: n.pos.y + 80 });
    c.config = E.clone(n.config); c.label = n.label;
    sel = { kind: 'node', id: c.id };
    commit({ structure: true });
  }
  function showShortcuts() {
    const rows = [['Ctrl/⌘ Z', 'Undo'], ['Ctrl/⌘ Shift Z, Ctrl/⌘ Y', 'Redo'], ['Delete, Backspace', 'Delete the selected component or connection'], ['Esc', 'Clear the selection, stop connecting'],
      ['Arrow keys', 'Move the selected component (Shift: further)'], ['Ctrl/⌘ D', 'Duplicate the selected component'], ['+  −  0', 'Zoom in, zoom out, fit the design'], ['Ctrl/⌘ wheel, pinch', 'Zoom at the pointer'],
      ['Drag on empty canvas', 'Pan'], ['Ctrl/⌘ Enter', 'Run'], ['Ctrl/⌘ S', 'Save in this browser now (it also saves on its own)'], ['Space', 'Pause or resume the replay (header button)']];
    modal('Workbench shortcuts', h('table.shortcuts', rows.map(([k, d]) => h('tr', h('td', h('span.kbd', k)), h('td', d)))));
  }

  // ---------------- side panels ----------------
  const num = (key, labelTxt, value, [, min, max, int]) => `<label class="wb-field"><span>${labelTxt}</span><input type="number" data-k="${key}" value="${value ?? ''}" min="${min}" max="${max}" step="${int ? 1 : 'any'}"></label>`;
  function focusKey() {
    const a = document.activeElement;
    if (!a || !side.contains(a) || !a.dataset) return null;
    for (const k of ['k', 'r', 'f', 'sw', 'cal', 'calfit', 'cost', 'p', 'act']) if (a.dataset[k] !== undefined) return `[data-${k}="${CSS.escape(a.dataset[k])}"]`;
    return null;
  }
  function renderPanels() {
    if (titleIn !== document.activeElement) titleIn.value = doc.title;
    const keep = focusKey();
    renderInspector(); renderWorkload(); renderRoutes(); renderFaults(); renderAssumptions(); renderCal(); renderSweep(); renderCost(); renderCheck(); renderResults(); paintUndo();
    if (keep && !side.contains(document.activeElement)) side.querySelector(keep)?.focus({ preventScroll: true });
  }
  function renderInspector() {
    if (!sel) { inspector.innerHTML = '<div class="wb-box"><h2>Component</h2><p class="wb-hint">Select a component or a connection to change it.</p></div>'; return; }
    if (sel.kind === 'edge') {
      const e = doc.edges.find(x => x.id === sel.id);
      if (!e) { sel = null; return renderInspector(); }
      const from = nodeById(e.from);
      let s = `<div class="wb-box"><h2>Connection</h2><p class="wb-desc">${esc(label(e.from))} → ${esc(label(e.to))} (${e.kind === 'sync' ? 'waits for the answer' : 'does not wait'})</p>`;
      if (e.kind === 'sync' && from && E.kindOf(from.type) !== 'source') {
        s += `<label class="wb-check"><input type="checkbox" data-p="retry"${e.retry ? ' checked' : ''}> Retry failed calls</label>`;
        if (e.retry) s += num('p.retry.max', 'Retries at most', e.retry.max, E.RETRY.max) + num('p.retry.backoffMs', 'First wait before a retry (ms, doubles each time)', e.retry.backoffMs ?? 50, E.RETRY.backoffMs) + num('p.retry.budgetP', 'Retry budget (extra calls per first call)', e.retry.budgetP ?? 0.2, E.RETRY.budgetP);
        s += `<label class="wb-check"><input type="checkbox" data-p="breaker"${e.breaker ? ' checked' : ''}> Circuit breaker</label>`;
        if (e.breaker) s += num('p.breaker.errorP', 'Open at this error share (0 to 1)', e.breaker.errorP, E.BREAKER.errorP) + num('p.breaker.minCalls', 'Minimum calls before judging', e.breaker.minCalls, E.BREAKER.minCalls) + num('p.breaker.window', 'Judge the last N calls', e.breaker.window, E.BREAKER.window) + num('p.breaker.openMs', 'Stay open (ms), then try one call', e.breaker.openMs, E.BREAKER.openMs);
        s += '<p class="wb-hint">A retry keeps the caller waiting and adds work to the component that is already failing. An open breaker fails calls straight away.</p>';
      }
      inspector.innerHTML = s + '<button class="btn sm danger" data-act="del-edge" type="button">Delete connection</button></div>';
      return;
    }
    const n = nodeById(sel.id);
    if (!n) { sel = null; return renderInspector(); }
    const t = E.TYPES[n.type];
    let s = `<div class="wb-box"><div class="wb-insp-head" style="color:var(${GROUP_VAR[t.group]})">${icon(n.type, 38)}<div><h2>${esc(t.label)}</h2><span class="wb-group">${esc(t.group)}</span></div></div>
      <p class="wb-desc">${esc(t.desc)}</p><p class="wb-hint">${esc(E.KIND_NOTE[t.kind] || '')}</p>
      <label class="wb-field"><span>Name</span><input data-k="label" value="${esc(n.label)}" maxlength="40"></label>`;
    for (const [k, spec] of Object.entries(t.config)) s += num('c.' + k, E.FIELD_LABEL[k] || k, n.config[k], spec);
    for (const [k, vals] of Object.entries(t.enums || {})) s += `<label class="wb-field"><span>${E.FIELD_LABEL[k] || k}</span><select data-k="c.${k}">${vals.map(v => `<option value="${v}"${v === n.config[k] ? ' selected' : ''}>${E.ENUM_LABEL[v] || v}</option>`).join('')}</select></label>`;
    const specs = E.workSpecs(doc, n.id);
    if (specs.length) {
      const d0 = specs[0].spec.serviceMs, many = doc.routes.length > 1;
      for (const { ri, spec } of specs) s += `<label class="wb-field"><span>${many ? `Work time for ${esc(doc.routes[ri].label)} (ms)${spec.skip ? ' (skipped)' : ''}` : 'Work time per request (ms)'}</span><input type="number" data-k="svc:${ri}" value="${+E.svcMean(spec.serviceMs).toFixed(3)}" min="0" max="60000" step="any"></label>`;
      s += `<label class="wb-field"><span>Does the work time vary?</span><select data-k="svcd"><option value="exp"${d0.dist === 'exp' ? ' selected' : ''}>Yes, randomly around it (exponential)</option><option value="const"${d0.dist === 'const' ? ' selected' : ''}>No, always exactly this</option></select></label>`;
    } else if (t.kind === 'server') s += '<p class="wb-hint">Connect this component into the request path to set its work time.</p>';
    s += '<div class="wb-row-btns">' + (n.type !== 'traffic' ? '<button class="btn sm" data-act="dup-node" type="button">Duplicate</button>' : '') + '<button class="btn sm danger" data-act="del-node" type="button">Delete component</button></div></div>';
    inspector.innerHTML = s;
  }
  function renderWorkload() {
    const w = doc.workload;
    workloadBox.innerHTML = num('w.rateRps', 'Requests per second', w.rateRps, E.WORKLOAD.rateRps) +
      `<label class="wb-field"><span>Arrivals</span><select data-k="w.arrivals"><option value="poisson"${w.arrivals === 'poisson' ? ' selected' : ''}>Random (Poisson)</option><option value="uniform"${w.arrivals === 'uniform' ? ' selected' : ''}>Evenly spaced</option></select></label>` +
      '<div class="wb-frow2">' + num('w.durationMs', 'Run length (ms)', w.durationMs, E.WORKLOAD.durationMs) + num('w.warmupMs', 'Warm-up, not measured (ms)', w.warmupMs, E.WORKLOAD.warmupMs) + '</div>';
  }
  function usesOf(route) {
    const out = [], seen = new Set();
    const walk = (calls, depth) => { for (const c of calls || []) { if (!seen.has(c.to)) { seen.add(c.to); out.push({ id: c.to, depth, skip: !!c.skip }); } walk(c.calls, depth + 1); } };
    for (const st of route.steps) walk(st.calls, 0);
    return out;
  }
  function renderRoutes() {
    if (!doc.routes.length) { routesBox.innerHTML = '<p class="wb-hint">Connect Users to a component to create a request type.</p>'; return; }
    let s = '';
    doc.routes.forEach((r, i) => {
      s += `<div class="wb-route"><div class="wb-frow2"><label class="wb-field"><span>Name</span><input data-r="label:${i}" value="${esc(r.label)}" maxlength="30"></label><label class="wb-field"><span>Share %</span><input type="number" data-r="share:${i}" value="${+(r.share * 100).toFixed(1)}" min="0" max="100" step="any"></label></div>`;
      const path = r.steps.map(st => esc(label(st.at))).join(' → ');
      s += `<p class="wb-hint">Users → ${path}</p>`;
      const uses = usesOf(r);
      if (uses.length) s += '<div class="wb-uses"><span>Uses</span>' + uses.map(u => `<label class="wb-check" style="padding-left:${u.depth * 14}px"><input type="checkbox" data-r="use:${i}:${u.id}"${u.skip ? '' : ' checked'}> ${esc(label(u.id))}</label>`).join('') + '</div>';
      if (doc.routes.length > 1) s += `<button class="btn sm ghost" type="button" data-act="del-route" data-i="${i}">Remove ${esc(r.label)}</button>`;
      s += '</div>';
    });
    routesBox.innerHTML = s + (doc.routes.length < E.LIMITS.routes ? '<button class="btn sm" type="button" data-act="add-route">Add a request type</button>' : '');
  }
  function faultText(f) { return `${f.kind === 'burst' ? `Traffic ×${f.factor}` : `${label(f.node)} ${f.kind === 'slow' ? `slow ×${f.factor}` : 'down'}`}, ${secs(f.at)} to ${secs(f.until)} s`; }
  function renderFaults() {
    const list = doc.faults || [], dur = doc.workload.durationMs;
    const ran = result && !result.failed && !result.stale ? JSON.stringify(result.faults) : null;
    const inRun = f => ran !== null && JSON.parse(ran).some(x => JSON.stringify(x) === JSON.stringify(f));
    let s = list.length ? '<ul class="wb-faults">' + list.map((f, i) => `<li>${icon(nodeById(f.node)?.type, 16)}<span>${esc(faultText(f))}</span>${inRun(f) ? '<span class="wb-fstate on">in the last run</span>' : '<span class="wb-fstate">scheduled</span>'}<button class="wb-x" type="button" data-act="del-fault" data-i="${i}" aria-label="Remove fault">×</button></li>`).join('') + '</ul>' : '<p class="wb-hint">No faults scheduled.</p>';
    const targets = doc.nodes.filter(n => E.kindOf(n.type) !== 'source'), users = doc.nodes.find(n => n.type === 'traffic');
    if (targets.length || users) {
      s += `<label class="wb-field"><span>What</span><select data-f="target">${targets.map(n => `<option value="down:${n.id}">${esc(n.label)} goes down</option><option value="slow:${n.id}">${esc(n.label)} gets slow</option>`).join('')}${users ? `<option value="burst:${users.id}">Traffic burst</option>` : ''}</select></label>
        <div class="wb-frow"><label class="wb-field"><span>From (s)</span><input type="number" data-f="at" value="${secs(dur / 3)}" min="0" step="any"></label><label class="wb-field"><span>To (s)</span><input type="number" data-f="until" value="${secs((dur * 2) / 3)}" min="0" step="any"></label><label class="wb-field"><span>Factor</span><input type="number" data-f="factor" value="3" min="1" max="100" step="any" title="Slow: work takes this many times longer. Burst: this many times the traffic."></label></div>
        <button class="btn sm" type="button" data-act="add-fault">Add fault</button>`;
    }
    faultsBox.innerHTML = s;
  }
  function renderAssumptions() {
    const list = doc.assumptions || [];
    assumeWrap.hidden = !list.length;
    if (!list.length) return;
    const guessed = list.filter(a => a.source === 'default' || a.source === 'inferred');
    assumeBox.innerHTML = `<p class="wb-hint">${guessed.length ? `${guessed.length} values were filled in rather than given. The results depend on them.` : 'Every value listed has been confirmed.'}</p><ul class="wb-list">` +
      list.map(a => `<li><span class="wb-src ${esc(a.source)}">${esc(SOURCE_LABEL[a.source] || a.source)}</span>${esc(a.text)}</li>`).join('') + '</ul>' +
      '<button class="btn sm ghost" type="button" data-act="clear-assume">Clear the list</button>';
  }
  function confirmAssumption(ref) { for (const a of doc.assumptions || []) if (a.ref === ref && a.source !== 'user') { a.source = 'user'; a.text = a.text.replace(/ \(default\)$/, ''); } }

  // sweep
  function renderSweep() {
    if (sweepState.busy) return;
    const params = E.sweepParams(doc);
    if (!params.some(p => p.key === sweepState.key)) sweepState.key = 'rate';
    const p = params.find(x => x.key === sweepState.key);
    const from = sweepState.from === '' ? defaultFrom(p) : sweepState.from, to = sweepState.to === '' ? defaultTo(p) : sweepState.to;
    let s = `<label class="wb-field"><span>Change</span><select data-sw="key">${params.map(x => `<option value="${esc(x.key)}"${x.key === p.key ? ' selected' : ''}>${esc(x.label)} (now ${short4(x.now)})</option>`).join('')}</select></label>
      <div class="wb-frow"><label class="wb-field"><span>From</span><input type="number" step="any" data-sw="from" value="${from}"></label><label class="wb-field"><span>To</span><input type="number" step="any" data-sw="to" value="${to}"></label><label class="wb-field"><span>Steps</span><input type="number" min="2" max="9" step="1" data-sw="steps" value="${sweepState.steps}"></label></div>
      <button class="btn sm" type="button" data-act="sweep">Run the sweep (${sweepState.steps} values × ${E.SEEDS} seeds)</button>`;
    if (sweepState.out) {
      const o = sweepState.out, v = x => (x === null ? 'not in this range' : short4(x));
      s += `${sweepState.docKey !== keyOf(doc) ? '<p class="wb-hint">The design changed after this sweep.</p>' : ''}<p class="wb-hint" style="margin-top:8px"><b>${esc(o.label)}</b>: slows down from ${v(o.slowsAt)}, fails from ${v(o.failsAt)}, last healthy value ${v(o.healthyAt)}. The line is the mean of ${E.SEEDS} seeds; the band is their range.</p><div class="wb-sweepchart"></div>`;
    }
    sweepBox.innerHTML = s;
    if (sweepState.out) sweepCharts(sweepBox.querySelector('.wb-sweepchart'), sweepState.out);
  }
  const short4 = v => (v == null ? '–' : String(+(+v).toPrecision(4)));
  const defaultFrom = p => (p.key === 'rate' ? Math.max(1, Math.round(p.now / 2)) : p.int ? Math.max(p.min, Math.round(p.now / 2)) : p.key.startsWith('hitP') ? 50 : +(p.now / 2).toPrecision(3));
  const defaultTo = p => (p.key === 'rate' ? Math.round(p.now * 3) : p.int ? Math.min(p.max, Math.max(p.now * 2, p.now + 3)) : p.key.startsWith('hitP') ? 99 : +(p.now * 3).toPrecision(3));
  async function runSweep(button) {
    if (sweepState.busy) return;
    const p = E.sweepParams(doc).find(x => x.key === sweepState.key);
    const from = Number(sweepBox.querySelector('[data-sw="from"]').value), to = Number(sweepBox.querySelector('[data-sw="to"]').value);
    const clampV = v => Math.max(p.min, Math.min(p.max, v));
    const values = E.sweepValues(clampV(from), clampV(to), Number(sweepState.steps) || 6, p.int);
    if (E.validate(doc).errors.length) return toast('Fix the design errors listed under Check first.');
    sweepState.busy = true; button.disabled = true;
    try {
      const out = await runner.call('sweep', E.clone(doc), { key: p.key, values }, (a, b) => { button.textContent = `Running… ${a}/${b}`; });
      sweepState.out = { ...out, label: p.label }; sweepState.docKey = keyOf(doc);
    } catch (err) { if (err.cancelled) { sweepState.busy = false; return; } sweepState.out = null; toast('The sweep failed: ' + err.message); }
    sweepState.busy = false;
    if (!destroyed) renderSweep();
  }

  // calibration
  const calibration = () => (doc.calibration = doc.calibration || { windows: [{ label: 'Period 1 (fit to)' }, { label: 'Period 2 (check)' }] });
  const fittable = () => doc.nodes.filter(n => E.kindOf(n.type) === 'server' && E.workTime(doc, n.id) !== null).map(n => n.id);
  const ms2 = v => (v == null ? '–' : (+v).toLocaleString('en', { maximumFractionDigits: v < 10 ? 2 : 1 }));
  function renderCal() {
    const ids = fittable();
    if (!ids.length) { calBox.innerHTML = '<p class="wb-hint">Add components with work times first.</p>'; return; }
    const cal = doc.calibration || { windows: [{ label: 'Period 1 (fit to)' }, { label: 'Period 2 (check)' }] };
    const inp = (w, k, lbl, v) => `<label class="wb-field"><span>${esc(lbl)}</span><input type="number" min="0" step="any" placeholder="${k === 'rateRps' ? 'needed' : 'not measured'}" data-cal="${w}:${k}" value="${v ?? ''}"></label>`;
    let s = '<p class="wb-hint">Type in numbers measured on the real system during two calm periods (no incidents). The fit changes work times to match period 1; period 2 then tests the fit on different traffic.</p>';
    cal.windows.forEach((w, i) => {
      s += `<details${i === 0 ? ' open' : ''} class="wb-calwin"><summary>${esc(w.label)}</summary><div class="wb-calgrid">` + CAL_FIELDS.map(([k, l]) => inp(i, k, l, w[k])).join('') + ids.map(id => inp(i, 'util:' + id, `${label(id)} busy %`, w.util?.[id])).join('') + '</div></details>';
    });
    const chosen = cal.fitIds || ids;
    s += '<div class="wb-uses"><span>Fit the work time of</span>' + ids.map(id => `<label class="wb-check"><input type="checkbox" data-calfit="${id}"${chosen.includes(id) ? ' checked' : ''}> ${esc(label(id))} (now ${ms2(E.workTime(doc, id))} ms)</label>`).join('') + '</div>';
    s += `<button class="btn sm" type="button" data-act="cal-fit"${calState?.busy ? ' disabled' : ''}>${calState?.busy ? `Fitting… ${calState.progress || ''}` : 'Fit'}</button>`;
    if (calState?.error) s += `<p class="wb-hint bad">${esc(calState.error)}</p>`;
    if (calState?.out) {
      const { fit: f, check } = calState.out;
      const name = r => (r.name.startsWith('util.') ? label(r.name.slice(5)) + ' busy' : r.name.replace('Rps', '/s').replace('Ms', ' ms').replace('errorRate', 'errors'));
      const val = (r, v) => (r.name.startsWith('util.') || r.name === 'errorRate' ? `${(v * 100).toFixed(1)}%` : ms2(v));
      const row = r => `<tr><td>${esc(name(r))}</td><td>${val(r, r.measured)}</td><td>${val(r, r.model)}</td><td class="${Math.abs(r.err) > 0.15 ? 'bad' : ''}">${r.kind === 'rel' ? `${r.err >= 0 ? '+' : ''}${Math.round(r.err * 100)}%` : `${r.err >= 0 ? '+' : ''}${(r.err * 100).toFixed(1)} pts`}</td></tr>`;
      const table = (title, rows) => `<h3 class="wb-sub">${title}</h3><table class="wb-table"><thead><tr><th></th><th>Measured</th><th>Model</th><th>Off by</th></tr></thead><tbody>${rows.map(row).join('')}</tbody></table>`;
      const worst = rows => { const r = [...rows].sort((a, b) => Math.abs(b.err) - Math.abs(a.err))[0]; return r ? `${r.name.replace('util.', '').replace('Ms', ' ms')} ${r.kind === 'rel' ? Math.round(Math.abs(r.err) * 100) + '%' : (Math.abs(r.err) * 100).toFixed(1) + ' pts'}` : 'none'; };
      s += `<h3 class="wb-sub">Fitted work times</h3><ul class="wb-list">${Object.entries(f.values).map(([id, v]) => `<li>${esc(label(id))}: ${ms2(f.start[id])} → <b>${ms2(v)} ms</b></li>`).join('')}</ul>` + table('Period 1 (fitted to)', f.rows) + (check ? table('Period 2 (check, not fitted)', check.rows) : '') +
        `<p class="wb-hint"><b>${check ? (check.rms <= 0.15 ? 'Fitted, and it holds on a second period.' : 'Fitted, but the check period is off by more than 15% on average: the model is missing something, such as a resource it does not include.') : 'Fitted but not checked: there is only one period. Add period 2 to test it.'}</b>${check ? ` Biggest miss in the check: ${esc(worst(check.rows))}.` : ''} Engine ${E.ENGINE}, seed ${doc.seed}, 30 s runs.</p>
        <div class="wb-actions-row"><button class="btn sm primary" type="button" data-act="cal-apply">Apply the fitted work times</button><button class="btn sm" type="button" data-act="cal-discard">Discard</button></div>`;
    }
    if (cal.last) s += `<p class="wb-hint">Last applied ${esc(cal.last.at)}: ${esc(cal.last.status)}.</p>`;
    calBox.innerHTML = s;
  }
  function periodOf(w) {
    const m = {}, isNum = k => typeof w[k] === 'number';
    if (isNum('completedRps')) m.completedRps = w.completedRps;
    if (isNum('p50Ms')) m.p50Ms = w.p50Ms;
    if (isNum('p95Ms')) m.p95Ms = w.p95Ms;
    if (isNum('errorPct')) m.errorRate = w.errorPct / 100;
    const u = Object.entries(w.util || {}).filter(([, v]) => typeof v === 'number');
    if (u.length) m.util = Object.fromEntries(u.map(([k, v]) => [k, v / 100]));
    return { rateRps: w.rateRps, measured: m };
  }
  async function runFit() {
    const cal = calibration(), p1 = periodOf(cal.windows[0]), p2 = periodOf(cal.windows[1]);
    const ids = (cal.fitIds || fittable()).filter(id => fittable().includes(id));
    if (!(p1.rateRps > 0)) { calState = { error: 'Enter the requests per second for period 1.' }; return renderCal(); }
    if (!Object.keys(p1.measured).length) { calState = { error: 'Enter at least one measured number for period 1 (busy % per component helps most).' }; return renderCal(); }
    if (!ids.length) { calState = { error: 'Tick at least one work time to fit.' }; return renderCal(); }
    calState = { busy: true };
    renderCal();
    try {
      const check = p2.rateRps > 0 && Object.keys(p2.measured).length ? p2 : null;
      const out = await runner.call('calibrate', E.clone(doc), { period: p1, ids, check }, (a, b) => { if (calState) calState.progress = `${a}/${b}`; const b2 = calBox.querySelector('[data-act="cal-fit"]'); if (b2) b2.textContent = `Fitting… ${a}/${b}`; });
      calState = { out, ids, p1 };
    } catch (err) { if (err.cancelled) return; calState = { error: 'The fit failed: ' + err.message }; }
    if (!destroyed) renderCal();
  }
  function applyFit() {
    const { fit: f, check } = calState.out, today = new Date().toISOString().slice(0, 10);
    const status = check ? 'fitted and checked on a second period' : 'fitted, not checked (one period only)';
    for (const id of calState.ids) {
      E.setWorkTime(doc, id, f.values[id]);
      doc.assumptions = (doc.assumptions || []).filter(a => a.ref !== `routes.main.${id}.serviceMs`);
      doc.assumptions.push({ id: 'a' + (doc.assumptions.length + 1), text: `${label(id)} work time ${ms2(f.values[id])} ms (fitted to measurements on ${today}; ${status})`, source: 'fitted', ref: `routes.main.${id}.serviceMs` });
    }
    calibration().last = { at: today, engine: E.ENGINE, seed: doc.seed, run: E.CAL_RUN, fitted: Object.fromEntries(calState.ids.map(id => [id, { from: +f.start[id].toFixed(3), to: +f.values[id].toFixed(3) }])), fitRms: +f.rms.toFixed(4), validation: check ? { rms: +check.rms.toFixed(4) } : null, status };
    calState = null;
    commit({ redraw: false });
  }

  // cost
  function renderCost() {
    const prices = doc.costs, priced = doc.nodes.filter(n => E.basisOf(n.type));
    if (!prices) { costBox.innerHTML = '<p class="wb-hint">No prices are built in. Add your own price list to get a monthly estimate.</p><button class="btn sm" type="button" data-act="cost-start">Add a price list</button>'; return; }
    let s = `<div class="wb-frow2"><label class="wb-field"><span>Prices as of</span><input type="date" data-cost="date" value="${esc(prices.date)}"></label><label class="wb-field"><span>Currency</span><input data-cost="currency" maxlength="6" value="${esc(prices.currency)}"></label></div>`;
    s += priced.map(n => `<label class="wb-field"><span>${esc(n.label)} (${E.BASIS_LABEL[E.basisOf(n.type)]})</span><input type="number" min="0" step="any" placeholder="not priced" data-cost="price:${n.id}" value="${prices.prices[n.id] ?? ''}"></label>`).join('');
    s += `<label class="wb-field"><span>Not included (comma separated)</span><input data-cost="exclusions" value="${esc(prices.exclusions.join(', '))}"></label>`;
    const fresh = result && !result.failed && !result.stale ? result : null;
    const est = E.estimateCost(doc, prices, fresh), money = v => `${(+v).toLocaleString('en', { maximumFractionDigits: 2 })} ${esc(est.currency)}`;
    if (est.rows.length) s += `<table class="wb-table"><tbody>${est.rows.map(r => `<tr><td>${esc(r.label)}<span class="wb-range">${esc(r.how)}</span></td><td>${money(r.amount)}</td></tr>`).join('')}<tr><td><b>Estimate per month</b></td><td><b>${money(est.total)}</b></td></tr></tbody></table>`;
    s += `<p class="wb-hint" style="margin-top:8px">${esc(est.note)} Prices dated ${esc(est.date || '?')}.${est.unpriced.length ? ` Not priced: ${esc(est.unpriced.join(', '))}.` : ''} Not included: ${esc(est.exclusions.join(', ') || 'nothing listed')}.</p><button class="btn sm danger" type="button" data-act="cost-remove">Remove the price list</button>`;
    costBox.innerHTML = s;
  }

  // check / run
  function renderCheck() {
    const v = E.validate(doc);
    const li = (cls, t) => `<li class="${cls}">${esc(t)}</li>`;
    issues.innerHTML = [...v.errors.map(x => li('err', x)), ...(routeNote ? [li('warn', routeNote)] : []), ...v.warnings.map(x => li('warn', x))].join('') || li('ok', 'The design is complete and valid.');
    runB.disabled = running || v.errors.length > 0;
    runB.textContent = running ? 'Running…' : result ? 'Run again' : 'Run';
    runState.textContent = running ? runNote || 'Running the model…' : result ? (result.failed ? 'The last run failed.' : result.stale ? 'The design changed: the results below are out of date.' : 'The results below match this design.') : 'Not run yet.';
    runState.dataset.state = running ? 'running' : result ? (result.stale || result.failed ? 'stale' : 'fresh') : 'idle';
  }
  runB.onclick = () => run();
  async function run() {
    if (running || E.validate(doc).errors.length) return;
    running = true; runNote = baseline ? `Running seed 1 of ${E.SEEDS}…` : '';
    renderCheck();
    const key = keyOf(doc), snap = E.clone(doc);
    try {
      const r = await runner.call('run', snap, {});
      if (destroyed) return;
      result = r.ok ? Object.assign(r, { key }) : { failed: 'The design has errors: ' + r.errors.join('; ') };
      if (r.ok) startReplay();
      if (r.ok && baseline) result.summary = await seedSummary(r, snap);
    } catch (err) {
      if (err.cancelled || destroyed) return;
      result = { failed: 'The run failed: ' + err.message };
    } finally { running = false; runNote = ''; if (!destroyed) queueMicrotask(renderCheck); }
    if (destroyed) return;
    markStale();
    renderCheck(); renderResults(); renderFaults(); renderCost();
    paintHot();
  }
  async function seedSummary(first, snap) {
    const runs = [first], seeds = E.seedsFrom(snap.seed);
    for (let i = 1; i < seeds.length; i++) {
      runNote = `Running seed ${i + 1} of ${seeds.length}…`; renderCheck();
      runs.push(await runner.call('run', { ...E.clone(snap), seed: seeds[i] }, { trace: false }));
    }
    return E.summarize(runs);
  }
  function paintHot() {
    for (const g of nodeLayer.querySelectorAll('.hot')) g.classList.remove('hot');
    if (!result || result.failed || result.stale) return;
    for (const [id, n] of Object.entries(result.nodes)) if ((n.util !== null && n.util >= 0.9) || (result.errorAt[id] || 0) / Math.max(1, result.offered) > 0.01) nodeLayer.querySelector(`[data-node="${CSS.escape(id)}"]`)?.classList.add('hot');
  }

  // results
  function renderResults() {
    resultsWrap.hidden = !result;
    if (!result) return;
    const r = result;
    if (r.failed) { resultsInner.innerHTML = `<p class="wb-hint bad">${esc(r.failed)}</p>`; return; }
    const e = r.errors, row = (k, v, bad) => `<dt>${k}</dt><dd${bad ? ' class="bad"' : ''}>${v}</dd>`;
    let s = (r.stale ? '<p class="wb-hint">The design changed after this run. Run again to update.</p>' : '') + (r.stopped ? `<p class="wb-hint bad">${esc(r.stopped)}</p>` : '') +
      `<div${r.stale ? ' class="wb-stale"' : ''}><p class="wb-hint">Measured over ${fmt(r.windowMs / 1000)} s after the warm-up. Seed ${r.seed}.</p><dl class="wb-stats">` +
      row('Offered', fmt(r.offeredRps, 1) + ' req/s') + row('Completed', fmt(r.completedRps, 1) + ' req/s') + row('Errors', `${fmt(e.total)} (${pct(r.errorRate)})`, e.total > 0) +
      (e.total ? row('&nbsp; by kind', E.ERROR_KINDS.filter(k => e[k]).map(k => `${k} ${fmt(e[k])}`).join(', '), true) : '') +
      row('Latency p50 / p95 / p99', `${fmt(r.p50Ms, 1)} / ${fmt(r.p95Ms, 1)} / ${fmt(r.p99Ms, 1)} ms`) + row('Still in progress at the end', fmt(r.inFlight)) +
      (r.jobs ? row('Background jobs done', `${fmt(r.jobs.completedRps, 1)}/s, p95 ${fmt(r.jobs.p95Ms, 1)} ms`) : '') +
      '</dl><p class="wb-hint">Per component: requests that reached it and requests it finished, per second.</p><table class="wb-table"><thead><tr><th>Component</th><th>In/s</th><th>Done/s</th><th>Busy</th><th>Line max</th></tr></thead><tbody>';
    for (const [id, n] of Object.entries(r.nodes)) {
      const node = nodeById(id);
      s += `<tr><td><span class="ico-cell">${icon(node?.type, 14)}</span>${esc(node?.label || id)}${n.hitRate !== null ? `<span class="wb-hit">hit ${pct(n.hitRate)}</span>` : ''}</td><td>${fmt(n.arrivedRps, 1)}</td><td${n.errors ? ' class="bad"' : ''}>${fmt(n.doneRps, 1)}</td><td${n.util !== null && n.util >= 0.9 ? ' class="bad"' : ''}>${n.util === null ? '–' : pct(n.util)}</td><td>${n.kind === 'server' ? fmt(n.queueMax) : '–'}</td></tr>`;
    }
    s += '</tbody></table>';
    const eds = Object.values(r.edges || {});
    if (eds.length) {
      s += '<h3 class="wb-sub">Retries and breakers</h3><table class="wb-table"><thead><tr><th>Call</th><th>Calls/s</th><th>Retries/s</th><th>Load ×</th><th>Fast fail/s</th></tr></thead><tbody>';
      for (const x of eds) s += `<tr><td>${esc(label(x.from))} → ${esc(label(x.to))}${x.opened ? `<span class="wb-range">breaker opened ${x.opened}×</span>` : ''}${x.deniedByBudget ? `<span class="wb-range">${fmt(x.deniedByBudget)} retries over budget</span>` : ''}</td><td>${fmt(x.firstRps, 1)}</td><td>${fmt(x.retryRps, 1)}</td><td${x.amplification > 1.5 ? ' class="bad"' : ''}>${fmt(x.amplification, 2)}</td><td>${fmt(x.fastFailRps, 1)}</td></tr>`;
      s += '</tbody></table>';
    }
    s += '<h3 class="wb-sub">Over time</h3><div class="wb-timeline"></div>';
    if (!r.stale) {
      s += compareHtml(r);
      s += '<h3 class="wb-sub">What happened</h3><ol class="wb-story">' + E.story(doc, r).map(x => `<li class="${x.kind}">${esc(x.text)}.</li>`).join('') + '</ol>';
      s += '<h3 class="wb-sub">What to try</h3><ul class="wb-tips">' + E.advise(doc, r).map(x => `<li><b>${esc(x.evidence)}.</b> ${esc(x.text)}</li>`).join('') + '</ul>';
      s += '<div class="wb-actions-row"><button class="btn sm" type="button" data-act="evidence">Download evidence (design, run, results)</button>' + (r.replay?.traces?.length ? '<button class="btn sm" type="button" data-act="replay">Replay the requests</button>' : '') + '</div><p class="wb-hint">Anyone can open the evidence file with Import: the run is repeated and checked to come out identical.</p>';
    }
    resultsInner.innerHTML = s + '</div>';
    timelineCharts(resultsInner.querySelector('.wb-timeline'), r);
  }
  function compareHtml(r) {
    if (!baseline) return '<h3 class="wb-sub">Compare</h3><p class="wb-hint">Keep this run as a baseline, change the design, then run again to see what got better and what it cost.</p><button class="btn sm" type="button" data-act="save-base">Save as baseline</button>';
    let s = `<h3 class="wb-sub">Compared with the baseline</h3><p class="wb-hint">Baseline "${esc(baseline.doc.title)}", saved ${esc(new Date(baseline.savedAt).toLocaleString())}. Mean of ${baseline.summary.seeds.length} seeds; the range is in brackets.</p>`;
    const unfair = E.unfairChanges(baseline.doc, doc);
    if (unfair.length) s += `<div class="wb-warnbox"><b>Not a fair comparison:</b><ul>${unfair.map(x => `<li>${esc(x)}</li>`).join('')}</ul>Set these back to compare only the design change.</div>`;
    const ch = E.designChanges(baseline.doc, doc);
    s += `<p class="wb-hint">Design changes: ${ch.length ? esc(ch.join('; ')) : 'none'}.</p>`;
    if (!r.summary) return s + '<p class="wb-hint">Run again to compare.</p><div class="wb-actions-row"><button class="btn sm" type="button" data-act="clear-base">Clear the baseline</button></div>';
    const cell = (x, row) => { if (!x) return '–'; const m = row.unit === '%' ? 100 : 1, d = row.unit === '%' ? 1 : row.digits; return fmt(x.mean * m, d) + (x.n > 1 && x.max > x.min ? ` <span class="wb-range">(${fmt(x.min * m, d)}–${fmt(x.max * m, d)})</span>` : ''); };
    s += '<table class="wb-table"><thead><tr><th></th><th>Baseline</th><th>Now</th><th>Change</th></tr></thead><tbody>';
    for (const row of E.compareRows(baseline.summary, r.summary, baseline.doc, doc)) {
      const a = row.base?.mean, b = row.cur?.mean;
      let c = '–';
      if (a != null && b != null) {
        const txt = row.unit === '%' ? `${(b - a) * 100 >= 0 ? '+' : ''}${fmt((b - a) * 100, 1)} pts` : a ? `${b >= a ? '+' : ''}${fmt(((b - a) / a) * 100, 0)}%` : b ? 'new' : '0';
        c = `<span class="${row.better === true ? 'good' : row.better === false ? 'bad' : row.cost && b > a ? 'cost' : ''}">${txt}</span>`;
      }
      s += `<tr><td>${esc(row.label)}${row.unit ? `<span class="wb-range">${esc(row.unit)}</span>` : ''}</td><td>${cell(row.base, row)}</td><td>${cell(row.cur, row)}</td><td>${c}</td></tr>`;
    }
    return s + '</tbody></table><p class="wb-hint">Green is better, red is worse, amber costs more. Changes under 2% count as flat.</p><div class="wb-actions-row"><button class="btn sm" type="button" data-act="save-base">Make this the baseline</button><button class="btn sm" type="button" data-act="clear-base">Clear the baseline</button></div>';
  }
  async function saveBaseline() {
    if (!result || result.stale || result.failed || running) return;
    const snap = E.clone(doc);
    if (!result.summary) {
      running = true; renderCheck();
      try { result.summary = await seedSummary(result, snap); } catch (err) { if (err.cancelled) return; } finally { running = false; runNote = ''; }
    }
    baseline = { doc: snap, summary: result.summary, savedAt: Date.now() };
    writeJSON(BASE_KEY, baseline);
    if (!destroyed) { renderCheck(); renderResults(); toast('Baseline saved'); }
  }

  // challenge banner
  function paintChallenge() {
    challengeBox.hidden = !challenge;
    if (!challenge) return;
    const c = challenge.c;
    challengeBox.innerHTML = challenge.stage === 'before'
      ? `<b>Challenge: ${esc(c.title.replace(/^Break: /, ''))}</b><p>${esc(c.failure)}</p><p><b>Fix to try:</b> ${esc(c.fix)}</p><div class="row"><button class="btn sm primary" type="button" data-ch="run">1. Run it broken</button><button class="btn sm" type="button" data-ch="fix">2. Keep it as the baseline and load the fix</button><button class="btn sm ghost" type="button" data-ch="close">Close</button></div>`
      : `<b>Challenge: ${esc(c.title.replace(/^Break: /, ''))}, with the fix</b><p>${esc(c.fix)}</p><p>Run it and read “Compared with the baseline” under Results.</p><div class="row"><button class="btn sm primary" type="button" data-ch="run">Run the fixed design</button><button class="btn sm ghost" type="button" data-ch="close">Close</button></div>`;
  }
  challengeBox.addEventListener('click', async e => {
    const a = e.target.closest('[data-ch]')?.dataset.ch;
    if (!a || !challenge) return;
    if (a === 'close') { challenge = null; return paintChallenge(); }
    if (a === 'run') return run();
    if (a === 'fix') {
      if (!result || result.stale || result.failed) await run();
      if (destroyed || !challenge) return;
      await saveBaseline();
      if (destroyed || !challenge) return;
      const c = challenge.c;
      replaceDoc(c.after());
      challenge = { c, stage: 'after' };
      paintChallenge();
      run();
    }
  });

  // ---------------- side panel events ----------------
  side.addEventListener('change', e => {
    const t = e.target, d = t.dataset;
    if (d.k) return onField(t);
    if (d.p && sel?.kind === 'edge') {
      const edge = doc.edges.find(x => x.id === sel.id);
      if (!edge) return;
      if (t.checked) edge[d.p] = E.defaultsOf(d.p === 'retry' ? E.RETRY : E.BREAKER); else delete edge[d.p];
      return commit();
    }
    if (d.r) return onRoute(t);
    if (d.sw) {
      if (d.sw === 'key') { sweepState.key = t.value; sweepState.from = ''; sweepState.to = ''; return renderSweep(); }
      sweepState[d.sw] = t.value === '' ? '' : Number(t.value);
      if (d.sw === 'steps') renderSweep();
      return;
    }
    if (d.cal) {
      const [w, ...restKey] = d.cal.split(':'), key = restKey.join(':'), win = calibration().windows[+w], v = t.value === '' ? undefined : Number(t.value);
      if (key.startsWith('util:')) { win.util = win.util || {}; if (v === undefined) delete win.util[key.slice(5)]; else win.util[key.slice(5)] = v; }
      else if (v === undefined) delete win[key]; else win[key] = v;
      return saveDoc();
    }
    if (d.calfit) {
      const cal = calibration(), cur = cal.fitIds || fittable();
      cal.fitIds = t.checked ? [...new Set([...cur, d.calfit])] : cur.filter(x => x !== d.calfit);
      return saveDoc();
    }
    if (d.cost && doc.costs) {
      if (d.cost.startsWith('price:')) { const id = d.cost.slice(6); if (t.value === '') delete doc.costs.prices[id]; else doc.costs.prices[id] = Number(t.value); }
      else if (d.cost === 'exclusions') doc.costs.exclusions = t.value.split(',').map(x => x.trim()).filter(Boolean);
      else doc.costs[d.cost] = t.value.trim();
      return commit({ redraw: false });
    }
  });
  function onField(t) {
    const k = t.dataset.k, raw = t.value, v = t.type === 'number' ? Number(raw) : raw;
    if (t.type === 'number' && raw === '') return;
    if (k.startsWith('w.')) { doc.workload[k.slice(2)] = v; confirmAssumption('workload.' + k.slice(2)); return commit({ redraw: false }); }
    if (k.startsWith('p.') && sel?.kind === 'edge') { const [, grp, f] = k.split('.'), edge = doc.edges.find(x => x.id === sel.id); if (edge?.[grp]) { edge[grp][f] = v; commit(); } return; }
    const n = sel && nodeById(sel.id);
    if (!n) return;
    if (k === 'label') { n.label = String(v).trim() || E.TYPES[n.type].label; return commit(); }
    if (k.startsWith('c.')) { n.config[k.slice(2)] = v; confirmAssumption(`nodes.${n.id}.config.${k.slice(2)}`); return commit(); }
    const specs = E.workSpecs(doc, n.id);
    if (!specs.length) return;
    for (const { ri, spec } of specs) {
      const cur = spec.serviceMs, mean = E.svcMean(cur);
      if (k === 'svc:' + ri) { confirmAssumption(`routes.main.${n.id}.serviceMs`); spec.serviceMs = cur.dist === 'const' ? { dist: 'const', value: v } : { dist: 'exp', mean: v }; }
      if (k === 'svcd') spec.serviceMs = v === 'const' ? { dist: 'const', value: mean } : { dist: 'exp', mean };
    }
    commit({ redraw: false });
  }
  function onRoute(t) {
    const [what, i, id] = t.dataset.r.split(':'), r = doc.routes[+i];
    if (!r) return;
    if (what === 'label') r.label = t.value.trim() || r.id;
    if (what === 'share') {
      if (t.value === '') return;
      r.share = Math.max(0, Math.min(1, Number(t.value) / 100));
      if (doc.routes.length === 2) doc.routes[1 - i].share = +(1 - r.share).toFixed(4);
    }
    if (what === 'use') { const walk = list => { for (const c of list || []) { if (c.to === id) { if (t.checked) delete c.skip; else c.skip = true; } walk(c.calls); } }; for (const st of r.steps) walk(st.calls); }
    commit({ redraw: false });
  }
  side.addEventListener('click', e => {
    const b = e.target.closest('[data-act]');
    if (!b || !side.contains(b)) return;
    const a = b.dataset.act;
    if (a === 'del-node' && sel) return deleteSelection();
    if (a === 'dup-node' && sel) return duplicate();
    if (a === 'del-edge' && sel) return deleteSelection();
    if (a === 'add-fault') {
      const f = k => faultsBox.querySelector(`[data-f="${k}"]`).value;
      const [kind, node] = f('target').split(':');
      const fault = { at: Math.round(Number(f('at')) * 1000), until: Math.round(Number(f('until')) * 1000), node, kind };
      if (kind !== 'down') fault.factor = Number(f('factor'));
      doc.faults = [...(doc.faults || []), fault];
      return commit();
    }
    if (a === 'del-fault') { doc.faults.splice(Number(b.dataset.i), 1); return commit(); }
    if (a === 'add-route') { E.addRoute(doc); return commit({ redraw: false }); }
    if (a === 'del-route') { doc.routes.splice(Number(b.dataset.i), 1); if (doc.routes.length === 1) doc.routes[0].share = 1; return commit({ redraw: false }); }
    if (a === 'clear-assume') { doc.assumptions = []; return commit({ redraw: false }); }
    if (a === 'sweep') return runSweep(b);
    if (a === 'cal-fit') return runFit();
    if (a === 'cal-discard') { calState = null; return renderCal(); }
    if (a === 'cal-apply' && calState?.out) return applyFit();
    if (a === 'cost-start') { doc.costs = E.newPriceList(); return commit({ redraw: false }); }
    if (a === 'cost-remove') { delete doc.costs; return commit({ redraw: false }); }
    if (a === 'save-base') return saveBaseline();
    if (a === 'clear-base') { baseline = null; writeJSON(BASE_KEY, null); return renderResults(); }
    if (a === 'replay') return startReplay();
    if (a === 'evidence' && result && !result.failed && !result.stale) {
      const bundle = E.makeEvidence(doc, result, ['Results come from a model of the settings and assumptions listed, not from measurements.', 'Not modelled: network time, CPU and memory, replication and consistency, autoscaling.', doc.calibration?.last ? `Calibration: ${doc.calibration.last.status}.` : 'Not calibrated against measurements.']);
      download((doc.title || 'design').replace(/[^\w-]+/g, '-').toLowerCase() + '-evidence.json', JSON.stringify(bundle, null, 1));
    }
  });

  // ---------------- charts ----------------
  function chartSvg(host, title, width, height, withAxis) {
    host.append(h('div.wb-chart-title', title));
    const s = svgEl('svg', { width, height: height + (withAxis ? 16 : 0), viewBox: `0 0 ${width} ${height + (withAxis ? 16 : 0)}`, role: 'img', 'aria-label': title });
    const wrapD = h('div.wb-chart');
    wrapD.append(s);
    host.append(wrapD);
    return s;
  }
  function timelineCharts(host, res) {
    if (!host || !res.timeline?.length) return;
    const tl = res.timeline, W = Math.max(240, host.clientWidth || 300), H = 74, L = 34, R = 6, T = 6;
    const dur = res.workload.durationMs / 1000, warm = res.workload.warmupMs / 1000;
    const X = s => L + (s / dur) * (W - L - R), mid = b => (b.t + b.span / 2) / 1000, per = (b, v) => (v * 1000) / b.span;
    const busiest = Object.keys(res.nodes).filter(id => res.nodes[id].util !== null).sort((a, b) => res.nodes[b].util - res.nodes[a].util)[0];
    const charts = [
      { title: 'Requests per second', unit: 'req/s', series: [{ key: 'Offered', cls: 's1', v: b => per(b, b.offered) }, { key: 'Completed', cls: 's2', v: b => per(b, b.completed) }, { key: 'Errors', cls: 's3', v: b => per(b, b.errors) }] },
      { title: 'p95 latency of completed requests', unit: 'ms', series: [{ key: 'p95', cls: 's1', v: b => b.p95Ms }] },
      ...(busiest ? [{ title: `Busiest: ${label(busiest)}, % of time busy`, unit: '%', max: 100, series: [{ key: label(busiest), cls: 's1', v: b => b.util[busiest] * 100 }] }] : []),
    ];
    host.append(h('div.wb-legend', charts[0].series.map(s => h('span', h('i', { class: `wb-key ${s.cls}` }), s.key))));
    const tip = h('div.wb-tip');
    const tipIdle = () => { tip.innerHTML = '<span>Point at a chart to read the values at that second.</span>'; };
    tipIdle();
    host.append(tip);
    const hairs = [];
    const faultName = f => (f.kind === 'burst' ? `traffic ×${f.factor}` : `${label(f.node)} ${f.kind === 'slow' ? 'slow ×' + f.factor : 'down'}`);
    charts.forEach((c, ci) => {
      const last = ci === charts.length - 1, s = chartSvg(host, c.title, W, H, last);
      const vals = tl.flatMap(b => c.series.map(x => x.v(b))).filter(v => v !== null && Number.isFinite(v));
      const max = c.max || niceMax(Math.max(...vals, 0) * 1.05), Y = v => T + (1 - v / max) * (H - T - 4);
      if (warm > 0) { svgEl('rect', { x: X(0), y: T, width: X(warm) - X(0), height: H - T - 4, class: 'band-warm' }, s); if (ci === 0) svgEl('text', { x: X(0) + 3, y: T + 10, class: 'band-t' }, s).textContent = 'warm-up'; }
      for (const f of res.faults || []) {
        const a = Math.min(f.at / 1000, dur), b = Math.min(f.until / 1000, dur);
        if (b <= a) continue;
        svgEl('rect', { x: X(a), y: T, width: Math.max(2, X(b) - X(a)), height: H - T - 4, class: 'band-fault' }, s);
        if (ci === 0) svgEl('text', { x: X(a) + 3, y: T + 10, class: 'band-t' }, s).textContent = faultName(f);
      }
      for (const v of [0, max / 2, max]) { svgEl('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'gl' }, s); svgEl('text', { x: L - 4, y: Y(v) + 3.5, class: 'axis', 'text-anchor': 'end' }, s).textContent = fmtLoose(v, max < 10 ? 1 : 0); }
      for (const ser of c.series) {
        let d = '', on = false;
        for (const b of tl) { const v = ser.v(b); if (v === null || !Number.isFinite(v)) { on = false; continue; } d += `${on ? 'L' : 'M'}${X(mid(b)).toFixed(1)},${Y(Math.min(v, max)).toFixed(1)}`; on = true; }
        svgEl('path', { d, class: `ln ${ser.cls}` }, s);
      }
      if (last) for (let k = 0; k <= 4; k++) { const sx = (dur * k) / 4; svgEl('text', { x: X(sx), y: H + 12, class: 'axis', 'text-anchor': k === 0 ? 'start' : k === 4 ? 'end' : 'middle' }, s).textContent = fmtLoose(sx, 1) + ' s'; }
      hairs.push(svgEl('line', { x1: 0, x2: 0, y1: T, y2: H - 4, class: 'hair', visibility: 'hidden' }, s));
      const area = svgEl('rect', { x: L, y: 0, width: W - L - R, height: H, fill: 'transparent', tabindex: ci === 0 ? 0 : -1 }, s);
      const show = clientX => {
        const r = s.getBoundingClientRect(), scale = W / (r.width || W);
        const at = (((clientX - r.left) * scale - L) / (W - L - R)) * dur;
        const k = Math.max(0, Math.min(tl.length - 1, Math.floor(at))), b = tl[k], x = X(mid(b));
        for (const hl of hairs) { hl.setAttribute('x1', x); hl.setAttribute('x2', x); hl.setAttribute('visibility', 'visible'); }
        let t = `<span><b>${fmtLoose(b.t / 1000)}–${fmtLoose((b.t + b.span) / 1000)} s</b></span>`;
        for (const cc of charts) for (const ser of cc.series) t += `<span><i class="wb-key ${ser.cls}"></i>${cc.series.length > 1 ? esc(ser.key) : esc(cc.title.split(',')[0].replace(' of completed requests', ''))}: <b>${fmtLoose(ser.v(b), cc.unit === 'req/s' ? 0 : 1)} ${cc.unit}</b></span>`;
        const fs = (res.faults || []).filter(f => b.t < f.until && b.t + b.span > f.at).map(faultName);
        if (fs.length) t += `<span class="f">Fault: ${esc(fs.join(', '))}</span>`;
        tip.innerHTML = t;
        area.dataset.k = k;
      };
      area.addEventListener('pointermove', ev => show(ev.clientX));
      area.addEventListener('pointerleave', () => { tipIdle(); for (const hl of hairs) hl.setAttribute('visibility', 'hidden'); });
      area.addEventListener('focus', () => { const r = s.getBoundingClientRect(); show(r.left + (L + 1) * (r.width / W)); });
      area.addEventListener('keydown', ev => {
        if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
        ev.preventDefault();
        const k = Math.max(0, Math.min(tl.length - 1, Number(area.dataset.k || 0) + (ev.key === 'ArrowRight' ? 1 : -1)));
        const r = s.getBoundingClientRect();
        show(r.left + X(mid(tl[k])) * (r.width / W));
      });
    });
    const rows = tl.map(b => `<tr><td>${fmtLoose(b.t / 1000)}</td><td>${fmtLoose(per(b, b.offered))}</td><td>${fmtLoose(per(b, b.completed))}</td><td>${fmtLoose(per(b, b.errors))}</td><td>${fmtLoose(b.p95Ms, 1)}</td>${busiest ? `<td>${fmtLoose(b.util[busiest] * 100)}</td>` : ''}</tr>`).join('');
    host.append(h('details.wb-numbers', { html: `<summary>Show the numbers for each second</summary><div class="wb-scroll"><table class="wb-table"><thead><tr><th>s</th><th>Offered/s</th><th>Done/s</th><th>Errors/s</th><th>p95 ms</th>${busiest ? `<th>${esc(label(busiest))} %</th>` : ''}</tr></thead><tbody>${rows}</tbody></table></div>` }));
  }
  function sweepCharts(host, out) {
    const pts = out.points.filter(p => !p.error);
    if (!pts.length) { host.append(h('p.wb-hint', 'No result: ' + (out.points[0]?.error || 'nothing ran'))); return; }
    const W = Math.max(240, host.clientWidth || 300), H = 70, L = 34, R = 8, T = 6;
    const vs = pts.map(p => p.value), lo = Math.min(...vs), hi = Math.max(...vs);
    const X = v => L + (hi === lo ? 0.5 : (v - lo) / (hi - lo)) * (W - L - R);
    const charts = [['Completed requests/s', p => p.completedRps, 1], ['Errors %', p => p.errorRate, 100], ['p95 latency ms', p => p.p95Ms, 1]];
    charts.forEach(([title, get, mul], ci) => {
      const last = ci === charts.length - 1, s = chartSvg(host, title, W, H, last);
      const tops = pts.flatMap(p => { const x = get(p); return x ? [x.max * mul] : []; });
      const max = niceMax(Math.max(...tops, mul === 100 ? 1 : 0) * 1.05), Y = v => T + (1 - v / max) * (H - T - 4);
      for (const v of [0, max / 2, max]) { svgEl('line', { x1: L, x2: W - R, y1: Y(v), y2: Y(v), class: 'gl' }, s); svgEl('text', { x: L - 4, y: Y(v) + 3.5, class: 'axis', 'text-anchor': 'end' }, s).textContent = fmtLoose(v, max < 10 ? 1 : 0); }
      const marks = out.slowsAt !== null && out.slowsAt === out.failsAt ? [[out.failsAt, 'mark-fail', 'slows + fails']] : [[out.slowsAt, 'mark-slow', 'slows'], [out.failsAt, 'mark-fail', 'fails']];
      for (const [v, cls, t] of marks) if (v != null) { svgEl('line', { x1: X(v), x2: X(v), y1: T, y2: H - 4, class: cls }, s); if (ci === 0) svgEl('text', { x: X(v) + 3, y: T + 9, class: 'band-t' }, s).textContent = t; }
      const have = pts.filter(p => get(p));
      if (have.length > 1) {
        const up = have.map(p => `${X(p.value).toFixed(1)},${Y(get(p).max * mul).toFixed(1)}`), down = have.map(p => `${X(p.value).toFixed(1)},${Y(get(p).min * mul).toFixed(1)}`).reverse();
        svgEl('polygon', { points: [...up, ...down].join(' '), class: 'range' }, s);
        svgEl('path', { d: have.map((p, k) => `${k ? 'L' : 'M'}${X(p.value).toFixed(1)},${Y(get(p).mean * mul).toFixed(1)}`).join(''), class: 'ln s1' }, s);
      }
      for (const p of have) { const c = svgEl('circle', { cx: X(p.value), cy: Y(get(p).mean * mul), r: 4, class: 'mdot' }, s); svgEl('title', {}, c).textContent = `${out.label} ${fmtLoose(p.value, 2)}: ${fmtLoose(get(p).mean * mul, 1)} (seeds ${fmtLoose(get(p).min * mul, 1)}–${fmtLoose(get(p).max * mul, 1)})`; }
      if (last) for (const v of [lo, (lo + hi) / 2, hi]) svgEl('text', { x: X(v), y: H + 12, class: 'axis', 'text-anchor': v === lo ? 'start' : v === hi ? 'end' : 'middle' }, s).textContent = fmtLoose(v, 2);
    });
    const rows = out.points.map(p => `<tr><td>${fmtLoose(p.value, 2)}</td>${p.error ? `<td colspan="3">${esc(p.error)}</td>` : `<td>${fmtLoose(p.completedRps.mean, 1)}</td><td>${fmtLoose(p.errorRate.mean * 100, 1)}</td><td>${fmtLoose(p.p95Ms?.mean, 1)}</td>`}</tr>`).join('');
    host.append(h('details.wb-numbers', { html: `<summary>Show the numbers</summary><div class="wb-scroll"><table class="wb-table"><thead><tr><th>${esc(out.label)}</th><th>Done/s</th><th>Errors %</th><th>p95 ms</th></tr></thead><tbody>${rows}</tbody></table></div>` }));
  }

  // ---------------- replay ----------------
  function startReplay() {
    stopReplay();
    if (!result || result.failed || !result.replay?.traces?.length) return;
    replay = makeReplay(result);
    replayBar.hidden = false;
    rpTime.max = result.workload.durationMs;
    const routeVar = ['--wb-s1', '--wb-s2', '--wb-s3'];
    rpLegend.innerHTML = (doc.routes.length > 1 ? doc.routes.map((r, i) => `<span><i style="background:var(${routeVar[i % 3]})"></i>${esc(r.label)}</span>`).join('') : '<span><i style="background:var(--wb-s1)"></i>request</span>') +
      '<span><i class="ring" style="border-color:var(--green)"></i>done</span><span><i class="ring" style="border-color:var(--red)"></i>failed</span>' +
      (result.replay.every > 1 ? `<span>1 in ${result.replay.every} requests shown</span>` : '') + '<span class="count"></span>';
    const durs = result.replay.traces.filter(t => t.e >= 0).map(t => t.e - t.b).sort((a, b) => a - b);
    const want = durs.length ? durs[durs.length >> 1] / 2000 : 0.05;
    let sp = SPEEDS[0][0];
    for (const [v] of SPEEDS) if (v <= want) sp = v;
    sp = Math.min(sp, 0.05);
    rpSpeed.innerHTML = SPEEDS.map(([v, l]) => `<option value="${v}">${l} speed${v === sp ? ' (suits this run)' : ''}</option>`).join('');
    rpSpeed.value = String(sp);
    replay.speed = sp;
    const firstFault = Math.min(...(result.faults || []).map(f => f.at));
    replay.seek(Number.isFinite(firstFault) ? Math.max(0, firstFault - 3000 * sp) : result.workload.warmupMs);
    replay.play();
  }
  function stopReplay() { replay?.destroy(); replay = null; replayBar.hidden = true; }
  rpPlay.onclick = () => replay?.toggle();
  rpTime.addEventListener('input', () => { replay?.pause(); replay?.seek(Number(rpTime.value)); });
  rpSpeed.addEventListener('change', () => { if (replay) replay.speed = Number(rpSpeed.value); });
  rpClose.onclick = stopReplay;
  function makeReplay(res) {
    const R = res.replay, end = res.workload.durationMs, traces = R.traces, tl = res.timeline, faults = res.faults || [];
    const usersIdx = R.nodes.indexOf(doc.nodes.find(n => n.type === 'traffic')?.id);
    const longest = Math.min(end, traces.reduce((m, t) => Math.max(m, (t.e >= 0 ? t.e : end) - t.b), 0));
    const segs = new Array(traces.length);
    const st = { t: 0, playing: false, speed: 0.05 };
    const g = svgEl('g', {}, overLayer);
    const dotPool = [], ringPool = [];
    const MAXDOTS = 80, MOVE_MS = 220, LINGER_MS = 500;
    function timelineOf(tr) {
      const evs = [];
      tr.v.forEach((v, i) => { evs.push([v[1], 1, i]); if (v[2] >= 0) evs.push([v[2], 0, i]); });
      evs.sort((a, b) => a[0] - b[0] || a[1] - b[1] || (a[1] ? a[2] - b[2] : b[2] - a[2]));
      const out = [{ t: tr.b, n: usersIdx }], stack = [], stop = tr.e >= 0 ? tr.e : Infinity;
      for (const [t, enter, i] of evs) {
        if (t > stop) break;
        if (enter) stack.push(i); else { const k = stack.lastIndexOf(i); if (k >= 0) stack.splice(k, 1); }
        const n = stack.length ? tr.v[stack[stack.length - 1]][0] : usersIdx;
        if (out[out.length - 1].t === t) out[out.length - 1].n = n; else if (out[out.length - 1].n !== n) out.push({ t, n });
      }
      return out.filter((x, i) => i === 0 || x.n !== out[i - 1].n);
    }
    function where(seg, t, move) {
      if (!seg.length || t < seg[0].t) return null;
      let i = 0;
      while (i + 1 < seg.length && seg[i + 1].t <= t) i++;
      const cur = seg[i];
      if (i === 0 || move <= 0) return { from: cur.n, to: cur.n, f: 1 };
      const nextT = seg[i + 1]?.t ?? Infinity, span = Math.min(move, (nextT - cur.t) * 0.5);
      return { from: seg[i - 1].n, to: cur.n, f: span > 0 ? Math.min(1, (t - cur.t) / span) : 1 };
    }
    const lowerBound = t => { let a = 0, b = traces.length; while (a < b) { const m = (a + b) >> 1; if (traces[m].b < t) a = m + 1; else b = m; } return a; };
    const jitter = i => { const x = Math.imul(i + 1, 2654435761) >>> 0; return [((x & 255) / 255 - 0.5) * 22, (((x >> 8) & 255) / 255 - 0.5) * 16]; };
    const center = idx => { const n = nodeById(R.nodes[idx]); return n ? { x: n.pos.x + NW / 2, y: n.pos.y + NH / 2, n } : null; };
    function draw() {
      g.replaceChildren();
      const bin = tl[Math.min(tl.length - 1, Math.floor(st.t / 1000))];
      for (const id of R.nodes) {
        const n = nodeById(id);
        if (!n) continue;
        const u = bin?.util?.[id];
        if (u !== undefined) {
          svgEl('rect', { x: n.pos.x + 8, y: n.pos.y + NH + 4, width: NW - 16, height: 4, rx: 2, class: 'wb-ubar-bg' }, g);
          svgEl('rect', { x: n.pos.x + 8, y: n.pos.y + NH + 4, width: (NW - 16) * Math.min(1, u), height: 4, rx: 2, class: `wb-ubar${u >= 0.9 ? ' hot' : u >= 0.7 ? ' warm' : ''}` }, g);
        }
        const q = bin?.queue?.[id];
        if (q >= 0.5) {
          const txt = q >= 1000 ? Math.round(q / 1000) + 'k' : String(Math.round(q)), w = txt.length * 7 + 10;
          const bg = svgEl('g', { class: 'wb-qbadge' }, g);
          svgEl('rect', { x: n.pos.x + NW - w - 4, y: n.pos.y - 9, width: w, height: 18, rx: 9 }, bg);
          svgEl('text', { x: n.pos.x + NW - 4 - w / 2, y: n.pos.y + 4, 'text-anchor': 'middle' }, bg).textContent = txt;
        }
        if (faults.some(f => f.node === id && f.kind !== 'burst' && st.t >= f.at && st.t < f.until)) svgEl('rect', { x: n.pos.x - 4, y: n.pos.y - 4, width: NW + 8, height: NH + 8, rx: 12, class: 'wb-faultring', opacity: 0.55 + 0.45 * Math.sin(performance.now() / 160) }, g);
      }
      const move = MOVE_MS * st.speed, linger = LINGER_MS * st.speed;
      const from = lowerBound(st.t - longest - linger), to = lowerBound(st.t + 1e-9), active = [];
      for (let i = from; i < to; i++) { const tr = traces[i], e = tr.e >= 0 ? tr.e : Infinity; if (st.t <= e + linger) active.push(i); }
      const stride = Math.max(1, Math.ceil(active.length / MAXDOTS));
      const routeVar = ['--wb-s1', '--wb-s2', '--wb-s3'];
      for (const i of active) {
        if (i % stride) continue;
        const tr = traces[i];
        segs[i] = segs[i] || timelineOf(tr);
        const done = tr.e >= 0 && st.t > tr.e;
        let w = where(segs[i], done ? tr.e : st.t, move);
        if (!w) continue;
        const failedAt = done && tr.k ? tr.v.find(v => v[3] === 2) : null;
        if (failedAt) w = { from: failedAt[0], to: failedAt[0], f: 1 };
        const a = center(w.from), b = center(w.to);
        if (!a || !b) continue;
        const [jx, jy] = jitter(i), x = a.x + (b.x - a.x) * w.f + jx, y = a.y + (b.y - a.y) * w.f + jy;
        if (done) {
          const k = 1 - (st.t - tr.e) / linger;
          svgEl('circle', { cx: x, cy: y, r: 5 + (1 - k) * 8, class: `wb-ring ${tr.k ? 'bad' : 'ok'}`, opacity: Math.max(0, k) }, g);
          if (tr.k) svgEl('path', { d: `M${x - 4},${y - 4}L${x + 4},${y + 4}M${x + 4},${y - 4}L${x - 4},${y + 4}`, class: 'wb-ring bad', opacity: Math.max(0, k) }, g);
        } else {
          svgEl('circle', { cx: x, cy: y, r: 5, class: 'wb-dot', style: `fill:var(${routeVar[tr.r % 3]})` }, g);
          const hit = tr.v.find(v => v[3] === 1 && st.t >= v[2] && st.t - v[2] < linger);
          const hc = hit && center(hit[0]);
          if (hc) svgEl('circle', { cx: hc.x + jx, cy: hc.y + jy, r: 9, class: 'wb-hitring' }, g);
        }
      }
      void dotPool; void ringPool;
      rpTime.value = st.t;
      rpLabel.textContent = `${(st.t / 1000).toFixed(st.speed < 0.05 ? 3 : 2)} s`;
      rpPlay.textContent = st.playing ? 'Pause' : 'Play';
      const cnt = rpLegend.querySelector('.count');
      if (cnt) cnt.textContent = `${active.length} in flight${stride > 1 ? `, 1 in ${stride} drawn` : ''}`;
    }
    const off = addTicker(dt => {
      if (!st.playing) return;
      st.t += dt * 1000 * st.speed;
      if (st.t >= end) { st.t = end; st.playing = false; }
      draw();
    });
    return {
      get speed() { return st.speed; }, set speed(v) { st.speed = v; draw(); },
      play() { if (st.t >= end) st.t = 0; st.playing = true; draw(); },
      pause() { st.playing = false; draw(); },
      toggle() { if (st.playing) this.pause(); else this.play(); },
      seek(t) { st.t = Math.max(0, Math.min(end, t)); draw(); },
      draw,
      destroy() { off(); g.remove(); },
    };
  }
  cleanups.push(() => stopReplay());

  // ---------------- dialogs ----------------
  function buildDialogs() {
    const stopKeys = dlg => dlg.addEventListener('keydown', e => { if (e.key !== 'Escape') e.stopPropagation(); });
    // import
    const importText = h('textarea.input', { rows: 10, spellcheck: 'false', placeholder: 'nodes:\n  - {id: nginx, type: lb}\n  - {id: api, type: app, config: {instances: 3}}\n  - {id: pg, type: db}\nedges:\n  - nginx -> api -> pg\nworkload: {rate: 200}' });
    const importReview = h('div', { 'aria-live': 'polite' });
    const importGo = h('button.btn.primary', { type: 'button', disabled: true }, 'Import (Undo brings the current design back)');
    const importDlg = h('dialog.wb-dlg', { 'aria-labelledby': `wbImpT-${uid}` },
      h('h2', { id: `wbImpT-${uid}` }, 'Import a design'),
      h('p.wb-hint', { html: 'Paste JSON or YAML, or choose a file. Short forms work: components with a type, and connections like <code>nginx -&gt; api -&gt; db</code>. Missing values are filled with defaults and listed so you can check them.' }),
      importText,
      h('div.wb-dlg-row', h('button.btn.sm', { type: 'button', onclick: () => fileIn.click() }, 'Choose a file…'), h('span.wb-hint', { style: { margin: 0 } }, `Types: ${Object.keys(E.TYPES).join(', ')}.`)),
      importReview,
      h('div.wb-dlg-row.end', h('button.btn', { type: 'button', onclick: () => importDlg.close() }, 'Cancel'), importGo));
    stopKeys(importDlg);
    let pending = null, t1 = 0;
    const reviewImport = () => {
      if (importText.value.length > 1e6) return showImportReview({ errors: ['The text is larger than 1 MB'], assumptions: [], ignored: [], warnings: [] });
      showImportReview(IO.importText(importText.value));
    };
    importText.addEventListener('input', () => { clearTimeout(t1); t1 = setTimeout(reviewImport, 300); });
    function showImportReview(res) {
      pending = res.doc ? res : null;
      importGo.disabled = !res.doc;
      const list = (title, items, cls) => (items.length ? `<h3 class="wb-sub">${title} (${items.length})</h3><ul class="wb-list ${cls}">${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '');
      let s = '';
      if (res.doc) s += `<p class="wb-hint">${esc(res.format || '')} · "${esc(res.doc.title)}": ${res.doc.nodes.length} components, ${res.doc.edges.length} connections, ${res.doc.routes.length} request type${res.doc.routes.length === 1 ? '' : 's'}.</p>`;
      s += list('Cannot import', res.errors, 'err') + list('Filled with defaults (check these)', res.assumptions.filter(a => a.source === 'default').map(a => a.text), '') + list('Not used (listed, not imported)', res.ignored, '') + list('Warnings', res.warnings || [], '');
      if (res.doc && !res.assumptions.length) s += '<p class="wb-hint">Everything came from the file; nothing was filled in.</p>';
      if (res.bundle) {
        const b = res.bundle;
        s = `<div class="wb-${b.identical ? 'okbox' : 'warnbox'}"><b>Evidence bundle</b> from ${esc((b.created || '').slice(0, 10))}, engine ${esc(b.engine)}. ` +
          (b.identical ? `Ran it again: the results are identical (fingerprint ${esc(b.fingerprint)}).` : b.error ? `Could not run it again: ${esc(b.error)}.` : `Ran it again: the results differ${b.diffs.length ? ` in ${esc(b.diffs.join(', '))}` : ''} (fingerprint ${esc(b.fingerprint)}, recorded ${esc(b.expected)}).${b.engineMatches ? ' The file was changed after it was made.' : ` It was made with engine ${esc(b.engine)}; this is ${E.ENGINE}.`}`) + '</div>' + s;
      }
      importReview.innerHTML = s;
    }
    importGo.onclick = () => { if (!pending) return; replaceDoc(pending.doc); challenge = null; paintChallenge(); importDlg.close(); toast('Design imported'); };

    // questionnaire
    const guideForm = h('form.wb-guide-form', { onsubmit: e => e.preventDefault() });
    guideForm.innerHTML = IO.GUIDE_FORM.map(([legend, qs]) => `<fieldset><legend>${esc(legend)}</legend>` + qs.map(([k, type, opts, when]) => {
      const attrs = `data-q="${k}"${when ? ` data-when="${when}"` : ''}`;
      if (type === 'bool') return `<label class="wb-check" ${attrs}><input type="checkbox" data-q="${k}"> ${esc(IO.GUIDE_TEXT[k])}</label>`;
      if (type === 'select') return `<label class="wb-field" ${attrs}><span>${esc(IO.GUIDE_TEXT[k])}</span><select data-q="${k}">${opts.map(([v, l]) => `<option value="${v}">${esc(l)}</option>`).join('')}</select></label>`;
      return `<label class="wb-field" ${attrs}><span>${esc(IO.GUIDE_TEXT[k])}</span><input ${type === 'num' ? 'type="number" min="0" step="any" placeholder="not sure"' : 'maxlength="80" placeholder="My system"'} data-q="${k}"></label>`;
    }).join('') + '</fieldset>').join('');
    const guidePreview = h('div.wb-preview', { 'aria-live': 'polite' });
    const guideGo = h('button.btn.primary', { type: 'button' }, 'Create the design (Undo brings the current one back)');
    const guideDlg = h('dialog.wb-dlg', { 'aria-labelledby': `wbGT-${uid}` },
      h('h2', { id: `wbGT-${uid}` }, 'Describe your system'),
      h('p.wb-hint', 'Leave a number empty if you are not sure: a default is used and listed under Assumptions, so you can see what the results rest on.'),
      guideForm, guidePreview,
      h('div.wb-dlg-row.end', h('button.btn', { type: 'button', onclick: () => guideDlg.close() }, 'Cancel'), guideGo));
    stopKeys(guideDlg);
    let guideDoc = null;
    const answers = () => { const a = {}; for (const el of guideForm.querySelectorAll('input[data-q], select[data-q]')) a[el.dataset.q] = el.type === 'checkbox' ? el.checked : el.value; return a; };
    const refreshGuide = () => {
      const a = answers();
      for (const l of guideForm.querySelectorAll('label[data-when]')) l.hidden = !a[l.dataset.when];
      const out = IO.fromAnswers(a);
      if (!out.doc) { guidePreview.innerHTML = `<p class="wb-hint bad">${esc(out.errors.join('; '))}</p>`; guideGo.disabled = true; guideDoc = null; return; }
      const d = out.doc, defs = d.assumptions.filter(x => x.source === 'default'), nm = id => d.nodes.find(n => n.id === id)?.label;
      const pathTxt = d.routes[0].steps.map(st => nm(st.at)).join(' → ');
      const others = d.nodes.filter(n => n.type !== 'traffic' && !d.routes[0].steps.some(st => st.at === n.id)).map(n => n.label);
      guidePreview.innerHTML = `<p><b>This will create:</b> Users → ${esc(pathTxt)}${others.length ? ` (+ ${esc(others.join(', '))})` : ''}.${d.routes.length > 1 ? ' ' + d.routes.map(r => `${esc(r.label)} ${Math.round(r.share * 100)}%`).join(', ') + '.' : ''}</p><details><summary>${defs.length} values filled with defaults (you can change them later)</summary><ul class="wb-list">${defs.map(x => `<li>${esc(x.text)}</li>`).join('')}</ul></details>`;
      guideGo.disabled = false; guideDoc = d;
    };
    guideForm.addEventListener('input', refreshGuide);
    guideForm.addEventListener('change', refreshGuide);
    guideGo.onclick = () => { if (!guideDoc) return; replaceDoc(guideDoc); challenge = null; paintChallenge(); guideDlg.close(); };

    // written description
    const descText = h('textarea.input', { rows: 4, maxlength: 5000, spellcheck: 'false', placeholder: 'React -> Nginx -> 3 Node instances -> PostgreSQL; Redis cache; BullMQ workers' });
    const descReview = h('div', { 'aria-live': 'polite' }), descResult = h('div.wb-preview', { 'aria-live': 'polite' });
    const descGo = h('button.btn.primary', { type: 'button', disabled: true }, 'Create the draft (Undo brings the current design back)');
    const descDlg = h('dialog.wb-dlg.wide', { 'aria-labelledby': `wbDT-${uid}` },
      h('h2', { id: `wbDT-${uid}` }, 'Draft a design from a description'),
      h('p.wb-hint', { html: 'Write how requests flow, for example <code>React -&gt; Nginx -&gt; 3 Node instances -&gt; PostgreSQL; Redis cache; BullMQ workers</code>. It is read by fixed rules inside your browser: nothing is sent anywhere, and the text is treated purely as data. A description gives the shape, not the numbers, so answer the questions or keep the listed defaults.' }),
      descText, descReview, descResult,
      h('div.wb-dlg-row.end', h('button.btn', { type: 'button', onclick: () => descDlg.close() }, 'Cancel'), descGo));
    stopKeys(descDlg);
    let readOut = null, descDoc = null, t2 = 0;
    const descAnswers = () => { const a = {}; for (const el of descReview.querySelectorAll('[data-a]')) a[el.dataset.a] = el.value; return a; };
    const refreshDraft = () => {
      if (!readOut) return;
      const out = IO.draftFromDescription(readOut, descAnswers());
      descDoc = out.doc; descGo.disabled = !out.doc;
      if (!out.doc) { descResult.innerHTML = `<ul class="wb-list err">${out.errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul>`; return; }
      const nm = id => out.doc.nodes.find(n => n.id === id)?.label, defs = out.doc.assumptions.filter(x => x.source === 'default').length;
      descResult.innerHTML = `<p><b>Draft:</b> Users → ${esc(out.doc.routes[0].steps.map(st => nm(st.at)).join(' → '))}, ${out.doc.nodes.length} components. ${defs} other values use defaults (listed under Assumptions).</p>`;
    };
    const readDesc = () => {
      const txt = descText.value;
      readOut = txt.trim() ? IO.readDescription(txt) : null;
      if (!readOut) { descReview.innerHTML = ''; descResult.innerHTML = ''; descGo.disabled = true; descDoc = null; return; }
      const col = (title, items, cls) => `<div class="wb-dcol ${cls}"><h3>${title} (${items.length})</h3>${items.length ? `<ul>${items.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : '<p class="wb-hint">none</p>'}</div>`;
      descReview.innerHTML = '<div class="wb-dgrid">' + col('Stated in your text', readOut.facts.map(f => f.text), 'fact') + col('Inferred (check these)', readOut.inferred.map(f => f.text), 'inf') +
        col('Not modelled (listed, not imported)', readOut.unsupported.map(u => `${u.text}: ${u.reason}`), 'uns') +
        `<div class="wb-dcol q"><h3>Questions (${readOut.questions.length})</h3>` + (readOut.questions.length ? readOut.questions.map(q => IO.NUMERIC_QUESTIONS.has(q.key) ? `<label class="wb-field"><span>${esc(q.text)}</span><input type="number" min="0" step="any" placeholder="not sure" data-a="${q.key}"></label>` : `<p class="wb-hint">${esc(q.text)}</p>`).join('') : '<p class="wb-hint">none</p>') + '</div></div>';
      refreshDraft();
    };
    descText.addEventListener('input', () => { clearTimeout(t2); t2 = setTimeout(readDesc, 300); });
    descReview.addEventListener('input', refreshDraft);
    descGo.onclick = () => { if (!descDoc) return; descDoc.title = 'Described system'; replaceDoc(descDoc); challenge = null; paintChallenge(); descDlg.close(); };
    guideB.onclick = () => { guideForm.reset(); refreshGuide(); guideDlg.showModal(); };
    descB.onclick = () => { descText.value = ''; readOut = null; readDesc(); descDlg.showModal(); };
    cleanups.push(() => { clearTimeout(t1); clearTimeout(t2); for (const d of [importDlg, guideDlg, descDlg]) if (d.open) d.close(); });
    return {
      importDlg, guideDlg, descDlg, importText, reviewImport, showImportReview,
      openImport() { importText.value = ''; importReview.innerHTML = ''; importGo.disabled = true; pending = null; importDlg.showModal(); },
    };
  }

  // ---------------- start ----------------
  history.record(JSON.stringify(doc));
  drawCanvas();
  applyView();
  renderPanels();
  paintChallenge();

  return {
    destroy() {
      destroyed = true;
      for (const f of cleanups.splice(0).reverse()) { try { f(); } catch (err) { console.error(err); } }
      wbRoot.remove();
      document.getElementById(CSS_ID)?.remove();
    },
  };
}

// ---------------- helpers ----------------
function makeHistory(limit) {
  let past = [], future = [], cur = null;
  return {
    record(s) { if (s === cur) return false; if (cur !== null) { past.push(cur); if (past.length > limit) past.shift(); } cur = s; future = []; return true; },
    undo() { if (!past.length) return null; future.push(cur); cur = past.pop(); return cur; },
    redo() { if (!future.length) return null; past.push(cur); cur = future.pop(); return cur; },
    get canUndo() { return past.length > 0; },
    get canRedo() { return future.length > 0; },
  };
}

function download(name, text) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

/** One job at a time in a module worker; starting a new job cancels the old one. Falls back to the main thread. */
function makeRunner() {
  let worker = null, job = null, seq = 1, broken = false;
  const fail = err => { const j = job; job = null; j?.reject(err); };
  function spawn() {
    try {
      worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
      worker.onmessage = ({ data }) => {
        if (!job || data.id !== job.id) return;
        if (data.progress) return job.onProgress?.(...data.progress);
        const j = job; job = null;
        if (data.error) j.reject(new Error(data.error)); else j.resolve(data.result);
      };
      worker.onerror = ev => { ev.preventDefault?.(); const j = job; worker?.terminate(); worker = null; broken = true; if (j) { job = null; inline(j); } };
    } catch { worker = null; broken = true; }
  }
  function inline(j) {
    setTimeout(() => {
      try {
        const r = j.kind === 'sweep' ? E.sweep(j.doc, j.opts.key, j.opts.values, { onStep: j.onProgress })
          : j.kind === 'calibrate' ? E.calibrate(j.doc, j.opts.period, j.opts.ids, j.opts.check, { onStep: j.onProgress })
            : E.simulate(j.doc, j.opts);
        j.resolve(r);
      } catch (err) { j.reject(err); }
    }, 0);
  }
  function cancel() {
    if (!job) return;
    worker?.terminate(); worker = null;
    fail(Object.assign(new Error('Run cancelled'), { cancelled: true }));
  }
  return {
    call(kind, doc, opts, onProgress) {
      cancel();
      return new Promise((resolve, reject) => {
        job = { id: seq++, kind, doc, opts, onProgress, resolve, reject };
        if (!broken && !worker) spawn();
        if (worker) worker.postMessage({ id: job.id, kind, doc, opts });
        else { const j = job; job = null; inline(j); }
      });
    },
    dispose() { cancel(); worker?.terminate(); worker = null; },
  };
}
