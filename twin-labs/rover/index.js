// Rover Lab: build a four-wheel robot car step by step in 3D, then drive it in a simulator.
// Routes: #/rover            the saved step (or step 1)
//         #/rover/<step id>  e.g. #/rover/motors, #/rover/drive
//         #/rover/step/<n>   the n-th step (1–10)
// Query:  ?board=uno|esp32 picks the controller board.

import { h, toast, modal } from '../js/core/dom.js';
import * as store from '../js/core/store.js';
import { STEPS, BOARDS, pick, stepIndex, checkKeys } from './data/steps.js';
import { PARTS } from './data/parts.js';
import { LANGS, TRANSLATED, t, setLang, currentLang, langInfo, preferredLang } from './i18n/index.js';
import { renderLesson, renderPart } from './ui/lesson.js';
import { createFlow } from './ui/flow.js';
import { createDrivePanel } from './ui/drive-panel.js';
import { createMinimap } from './ui/minimap.js';
import { openSettings, DEFAULT_SETTINGS } from './ui/settings.js';
import { CarLink } from './link.js';
import { Buzzer } from './sound.js';

const DRIVE = STEPS.length - 1;
/** A step's title, translated when the language has it. */
function stepTitle(s, board) {
  const key = typeof s.title === 'object' ? `title.${s.id}.${board}` : `title.${s.id}`;
  const v = t(key);
  return v === key ? pick(s.title, board) : v;
}
const CODE = stepIndex('code');
const ICON = {
  wrench: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.6 2.6-2.4-.6-.6-2.4z"/></svg>',
  wheel: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="2.5"/><path d="M12 3v6.5M4.2 16.5l5.6-3M19.8 16.5l-5.6-3"/></svg>',
  plus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>',
  minus: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M5 12h14"/></svg>',
  layers: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/><path d="M3 17.5l9 5 9-5" opacity=".5"/></svg>',
  home: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/></svg>',
  camera: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><rect x="3" y="7" width="13" height="10" rx="2"/><path d="M16 11l5-3v8l-5-3z"/></svg>',
  play: '<svg viewBox="0 0 24 24" width="16" height="16"><path d="M7 5l12 7-12 7z" fill="currentColor"/></svg>',
  pause: '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>',
  gear: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z"/></svg>',
  globe: '<svg viewBox="0 0 24 24" width="17" height="17" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/></svg>',
  help: '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M9.5 9a2.5 2.5 0 1 1 3.5 2.3c-.7.3-1 .9-1 1.7M12 16.5v.5"/></svg>',
  chip: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2"><rect x="4" y="6" width="16" height="12" rx="2"/><path d="M8 10h3v4H8z"/></svg>',
  wifi: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M2 9a15 15 0 0 1 20 0M5.5 12.5a10 10 0 0 1 13 0M9 16a5 5 0 0 1 6 0"/><circle cx="12" cy="19.5" r="1" fill="currentColor"/></svg>',
  chevL: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M15 6l-6 6 6 6"/></svg>',
  chevR: '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M9 6l6 6-6 6"/></svg>',
};

export function mount(el, rest, ctx) {
  const app = new RoverApp(el, ctx);
  app.route(rest, ctx.query);
  return { update: (r, q) => app.route(r, q), destroy: () => app.destroy() };
}

class RoverApp {
  constructor(el, ctx) {
    this.el = el;
    this.ctx = ctx;
    this.board = store.get('rover:board', 'uno') === 'esp32' ? 'esp32' : 'uno';
    this.step = -1;
    this.checks = new Set(store.get('rover:checks', []));
    this.settings = { ...DEFAULT_SETTINGS, ...store.get('rover:settings', {}) };
    this.thumbs = {};
    this.held = [];
    this.disposers = [];
    this.link = new CarLink({
      onStatus: s => this.onLinkStatus(s),
      onTelemetry: tm => { this.telemetry = { ...this.telemetry, ...tm }; if (this.driveView) this.driveView.external = this.telemetry; },
      onLog: line => this.drivePanel?.log(line),
    });
    this.buzzer = new Buzzer();

    this.css = h('link', { rel: 'stylesheet', href: new URL('./rover.css', import.meta.url).href });
    document.head.append(this.css);

    el.classList.add('rover-main');
    this.root = h('div.rover');
    el.append(this.root);
    this.viewport = h('div.rv-viewport');
    this.buildShell();
    this.renderChrome();
    this.initBench();

    const onKey = e => this.onKey(e);
    const onKeyUp = e => this.onKeyUp(e);
    const onTheme = () => this.onTheme();
    const onBlur = () => this.releaseAll();
    window.addEventListener('keydown', onKey);
    window.addEventListener('keyup', onKeyUp);
    window.addEventListener('themechange', onTheme);
    window.addEventListener('blur', onBlur);
    this.disposers.push(() => { window.removeEventListener('keydown', onKey); window.removeEventListener('keyup', onKeyUp); window.removeEventListener('themechange', onTheme); window.removeEventListener('blur', onBlur); });

    const want = store.get('rover:lang', null) || preferredLang();
    if (want !== 'en') setLang(want).then(() => { if (!this.dead) this.renderChrome(true); });
  }

  // ---- layout ----------------------------------------------------------------------------------

  buildShell() {
    this.benchTitle = h('h2.rv-bench-title');
    this.benchSub = h('span.rv-bench-sub');
    this.benchBadge = h('span.rv-badge-icon');
    this.connPill = h('span.rv-pill', { hidden: true }, h('i'), h('span'));
    this.tools = h('div.rv-tools');
    this.tip = h('div.rv-tip', { hidden: true }, h('b'), h('span'));
    this.hud = h('div.rv-hud', { hidden: true });
    this.mapSlot = h('div.rv-map-slot');
    this.flowSlot = h('div.rv-flow-slot');
    this.veil = h('div.rv-veil', { hidden: true });
    this.benchCard = h('section.card.rv-bench', { 'aria-label': 'Workbench' },
      this.viewport,
      h('header.rv-bench-head', this.benchBadge, h('div', this.benchTitle, this.benchSub), this.connPill),
      this.tools, this.tip, this.hud, this.veil, this.mapSlot, this.flowSlot);
    this.stripList = h('ol.rv-strip');
    this.stripView = h('div.rv-strip-view', this.stripList);
    this.stripPrev = h('button.rv-strip-nav', { type: 'button', html: ICON.chevL, onclick: () => this.scrollStrip(-1) });
    this.stripNext = h('button.rv-strip-nav', { type: 'button', html: ICON.chevR, onclick: () => this.scrollStrip(1) });
    this.stripView.addEventListener('scroll', () => this.updateStripNav(), { passive: true });
    this.strip = h('nav.card.rv-stripcard', this.stripPrev, this.stripView, this.stripNext);
    this.lessonPane = h('div.rv-lesson-pane');
    this.partPane = h('div.rv-part-pane', { hidden: true });
    this.lesson = h('section.card.rv-lesson', this.lessonPane, this.partPane);
    this.root.append(this.benchCard, this.strip, this.lesson);
  }

  /** (Re)build every piece of text: header controls, strip, lesson, overlays. */
  renderChrome(langChanged = false) {
    this.root.setAttribute('lang', TRANSLATED.has(currentLang()) ? currentLang() : 'en');
    this.renderHeader();
    this.renderStrip();
    this.stripPrev.setAttribute('aria-label', t('strip.prev'));
    this.stripNext.setAttribute('aria-label', t('strip.next'));
    this.strip.setAttribute('aria-label', t('strip.aria'));
    this.renderTools();
    if (this.step >= 0) {
      this.renderLessonPane();
      this.renderBenchHead();
      if (langChanged) this.setupOverlays(true);
    }
  }

  renderHeader() {
    const slot = this.ctx.headerSlot;
    const boardSeg = h('div.seg.rv-board', { role: 'radiogroup', 'aria-label': t('header.board') },
      ...Object.values(BOARDS).map(b => h('button', { type: 'button', role: 'radio', 'aria-pressed': String(this.board === b.id), 'aria-checked': String(this.board === b.id), title: b.mcu, onclick: () => this.setBoard(b.id) },
        h('span', { html: b.id === 'uno' ? ICON.chip : ICON.wifi }), h('span.rv-board-long', b.name), h('span.rv-board-short', b.short))));
    const info = langInfo(currentLang());
    const list = h('div.rv-lang-list', { role: 'menu' }, LANGS.map(l => h('button.rv-lang-item', { type: 'button', role: 'menuitemradio', 'aria-checked': String(l.code === info.code), lang: l.code, onclick: () => this.setLanguage(l.code) },
      h('span.rv-lang-chip', l.chip), h('span', l.native), !TRANSLATED.has(l.code) ? h('span.faint.rv-lang-note', t('header.langFallback')) : null)));
    const panel = h('div.rv-lang-panel', { hidden: true }, h('div.eyebrow', t('header.language')), list);
    const btn = h('button.btn.rv-lang-btn', { type: 'button', 'aria-haspopup': 'menu', 'aria-expanded': 'false', title: t('header.language') }, h('span', { html: ICON.globe }), h('b', info.chip));
    const closeMenu = () => { panel.hidden = true; btn.setAttribute('aria-expanded', 'false'); document.removeEventListener('pointerdown', outside); };
    const outside = e => { if (!picker.contains(e.target)) closeMenu(); };
    btn.addEventListener('click', () => { const open = panel.hidden; panel.hidden = !open; btn.setAttribute('aria-expanded', String(open)); if (open) document.addEventListener('pointerdown', outside); else closeMenu(); });
    this.closeLangMenu = closeMenu;
    const picker = h('div.rv-lang', btn, panel);
    slot.replaceChildren(h('div.rv-header',
      h('span.rv-header-label', t('header.board')), boardSeg, picker,
      h('button.btn.icon.rv-hbtn.rv-help-btn', { type: 'button', title: t('header.help'), 'aria-label': t('header.help'), html: ICON.help, onclick: () => this.showHelp() }),
      h('button.btn.icon.rv-hbtn', { type: 'button', title: t('header.settings'), 'aria-label': t('header.settings'), html: ICON.gear, onclick: () => this.showSettings() })));
  }

  renderStrip() {
    this.stripList.replaceChildren(...STEPS.map((s, i) => {
      const keys = checkKeys(s, this.board);
      const done = keys.length > 0 && keys.every(k => this.checks.has(k));
      const img = h('span.rv-thumb', this.thumbs[`${this.board}:${i}`] ? h('img', { src: this.thumbs[`${this.board}:${i}`], alt: '' }) : null);
      return h('li', h('a.rv-stepcard', { href: `#/rover/${s.id}`, 'aria-current': i === this.step ? 'step' : null, dataset: { i: String(i) } },
        img, h('span.rv-stepcard-txt', h('span.rv-chip-num', String(i + 1).padStart(2, '0')), h('b', t(`step.${s.id}`, null) === `step.${s.id}` ? s.label : t(`step.${s.id}`))),
        done ? h('span.rv-done', { title: t('strip.done'), html: '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3.5"><path d="M5 12.5l4.2 4.2L19 7"/></svg>' }) : null));
    }));
    requestAnimationFrame(() => this.updateStripNav());
  }

  scrollStrip(dir) { this.stripView.scrollBy({ left: dir * this.stripView.clientWidth * 0.8, behavior: 'smooth' }); }
  updateStripNav() {
    const v = this.stripView;
    this.stripPrev.disabled = v.scrollLeft <= 2;
    this.stripNext.disabled = v.scrollLeft + v.clientWidth >= v.scrollWidth - 2;
  }

  renderTools() {
    const tool = (icon, label, fn, extra = {}) => h('button.rv-tool', { type: 'button', title: label, 'aria-label': label, html: icon, onclick: fn, ...extra });
    this.playBtn = tool(ICON.pause, t('tools.pause'), () => this.togglePlay());
    this.speedBtn = h('button.rv-tool.text', { type: 'button', title: t('tools.speed'), 'aria-label': t('tools.speed'), onclick: () => this.cycleSpeed() }, `${this.bench?.speed || 1}×`);
    this.playGroup = h('div.rv-tool-group', this.playBtn, this.speedBtn);
    this.explodeBtn = tool(ICON.layers, t('tools.explode'), () => this.toggleExplode(), { 'aria-pressed': 'false' });
    this.camBtn = tool(ICON.camera, t('tools.camera'), () => this.cycleCamera());
    this.tools.replaceChildren(
      this.playGroup,
      h('div.rv-tool-group', tool(ICON.plus, t('tools.zoomIn'), () => this.bench.zoom(1)), tool(ICON.minus, t('tools.zoomOut'), () => this.bench.zoom(-1))),
      h('div.rv-tool-group', this.explodeBtn, this.camBtn, tool(ICON.home, t('tools.reset'), () => this.resetView())));
    this.syncTools();
  }

  syncTools() {
    if (!this.bench) return;
    const drive = this.step === DRIVE;
    const build = this.step >= 1 && this.step <= 7;
    this.playGroup.hidden = !(build && (this.bench.isAnimating() || this.step > 0));
    this.playBtn.innerHTML = this.bench.isAnimating() && this.bench.playing ? ICON.pause : ICON.play;
    const lbl = this.bench.isAnimating() ? (this.bench.playing ? t('tools.pause') : t('tools.play')) : t('tools.replay');
    this.playBtn.title = lbl; this.playBtn.setAttribute('aria-label', lbl);
    this.playBtn.classList.toggle('on', this.bench.isAnimating());
    this.speedBtn.textContent = `${this.bench.speed}×`;
    this.explodeBtn.hidden = drive || this.step === 0;
    this.explodeBtn.setAttribute('aria-pressed', String(this.bench.explodeTarget > 0));
    this.camBtn.hidden = !drive;
    if (drive && this.driveView) {
      const m = this.driveView.camMode;
      this.camBtn.title = t('tools.cam.' + m);
      this.camBtn.classList.toggle('on', m !== 'orbit');
    }
  }

  renderBenchHead() {
    const drive = this.step === DRIVE;
    this.benchBadge.innerHTML = drive ? ICON.wheel : ICON.wrench;
    this.benchTitle.textContent = drive ? t('bench.arena') : t('bench.title');
    this.benchSub.textContent = drive ? t('bench.arenaSub') : t('bench.sub', { n: this.step + 1, title: stepTitle(STEPS[this.step], this.board) });
    this.benchCard.setAttribute('aria-label', drive ? t('bench.arena') : t('bench.title'));
    this.connPill.hidden = !drive;
    if (drive) this.paintPill();
  }

  renderLessonPane() {
    const s = STEPS[this.step];
    const i = this.step;
    const prev = i > 0 ? STEPS[i - 1] : null;
    const next = i < DRIVE ? STEPS[i + 1] : null;
    const kicker = t(`kicker.${s.kicker.toLowerCase()}`) === `kicker.${s.kicker.toLowerCase()}` ? s.kicker : t(`kicker.${s.kicker.toLowerCase()}`);
    this.lessonView = renderLesson({
      board: this.board, step: i, checks: this.checks,
      onToggle: key => this.toggleCheck(key),
      onHover: parts => this.bench?.highlight(parts),
      onInspect: part => this.openPart(part),
      onPlayPhase: k => { this.bench.replayPhase(k); this.syncTools(); },
    });
    const body = h('div.rv-lesson-body', this.lessonView.el);
    if (i === DRIVE) body.append(this.drivePanelSlot = h('div.rv-drive-slot'));
    this.lessonPane.replaceChildren(
      h('header.rv-lesson-head',
        h('span.rv-stepnum', String(i + 1).padStart(2, '0')),
        h('div', h('span.rv-kicker', t('lesson.kicker', { kind: kicker, n: i + 1, total: STEPS.length })), h('h2.rv-title', stepTitle(s, this.board)))),
      body,
      h('footer.rv-lesson-foot',
        h('button.btn.ghost', { type: 'button', disabled: !prev, onclick: () => this.go(i - 1) }, '← ', t('lesson.back')),
        h('span.rv-keyhint', h('span.kbd', i === DRIVE ? '[' : '←'), h('span.kbd', i === DRIVE ? ']' : '→'), ' ', t('lesson.steps')),
        next ? h('button.btn.amber', { type: 'button', onclick: () => this.go(i + 1) }, t('lesson.next', { label: t(`step.${next.id}`) === `step.${next.id}` ? next.label : t(`step.${next.id}`) }), ' →')
          : h('button.btn.amber', { type: 'button', onclick: () => this.go(0) }, t('lesson.restart'), ' ↺')));
    body.scrollTop = 0;
  }

  // ---- 3D ----------------------------------------------------------------------------------------

  initBench() {
    // the scene module is imported lazily so the panel appears at once
    this.benchReady = import('./scene/bench.js').then(({ Bench }) => {
      if (this.dead) return;
      this.bench = new Bench(this.viewport, {
        onHover: (part, x, y) => this.showTip(part, x, y),
        onPick: part => this.openPart(part),
        onLabelHover: parts => this.bench.highlight(parts),
        onPhase: k => this.lessonView?.setPhase(k),
        onPlayState: () => this.syncTools(),
        onFrame: dt => this.onFrame(dt),
      });
      this.bench.setLabels(this.settings.labels);
      if (this.settings.quality === 'low') this.bench.setQuality('low');
      this.bench.setBoard(this.board);
      if (this.step >= 0) { this.bench.snapStep(this.step === DRIVE ? 8 : this.step); this.enterStep3D(this.step, -1); }
      this.syncTools();
      this.thumbTimer = setTimeout(() => this.makeThumbs(), 700);
    }).catch(err => {
      console.error(err);
      this.viewport.append(h('div.rv-nogl', h('b', t('bench.noGl')), h('span', String(err?.message || err))));
    });
  }

  makeThumbs() {
    if (!this.bench || this.dead) return;
    const board = this.board;
    this.bench.makeThumbs(STEPS.map((_, i) => i), (i, url) => {
      this.thumbs[`${board}:${i}`] = url;
      if (board !== this.board) return;
      const card = this.stripList.querySelector(`[data-i="${i}"] .rv-thumb`);
      if (card) card.replaceChildren(h('img', { src: url, alt: '' }));
    });
  }

  enterStep3D(step, prev) {
    const b = this.bench;
    if (!b) return;
    if (step === DRIVE) {
      if (!this.driveView) this.startDrive();
    } else {
      this.stopDrive();
      const animate = this.settings.animate && prev >= 0 && step === prev + 1;
      b.showStep(step, { animate });
      const modeChanged = prev < 0 || (prev === 0) !== (step === 0) || prev === DRIVE;
      if (modeChanged) { const p = b.presetFor(step); prev < 0 ? (b.camera.position.copy(p.pos), b.controls.target.copy(p.target)) : b.flyTo(p.pos, p.target); }
    }
    this.syncTools();
  }

  // ---- routing and steps ------------------------------------------------------------------------

  route(rest, query) {
    const qb = query?.get?.('board');
    if ((qb === 'uno' || qb === 'esp32') && qb !== this.board) this.setBoard(qb, { quiet: true });
    let i = -1;
    if (rest[0] === 'step') i = (parseInt(rest[1], 10) || 1) - 1;
    else if (rest[0]) i = stepIndex(rest[0]);
    if (i < 0 || i >= STEPS.length) i = Math.min(Math.max(0, store.get('rover:step', 0) | 0), DRIVE);
    if (!rest[0] || rest[0] === 'step') { history.replaceState(null, '', `#/rover/${STEPS[i].id}`); }
    this.applyStep(i);
  }

  go(i) {
    i = Math.max(0, Math.min(DRIVE, i));
    this.ctx.navigate(`#/rover/${STEPS[i].id}`);
  }

  applyStep(i) {
    const prev = this.step;
    if (i === prev) { this.closePart(); return; }
    this.step = i;
    store.set('rover:step', i);
    this.closePart(true);
    this.releaseAll();
    this.renderLessonPane();
    this.renderBenchHead();
    for (const a of this.stripList.querySelectorAll('.rv-stepcard')) {
      const on = +a.dataset.i === i;
      if (on) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current');
      if (on) { const v = this.stripView, l = a.parentElement.offsetLeft, w = a.parentElement.offsetWidth; if (l < v.scrollLeft || l + w > v.scrollLeft + v.clientWidth) v.scrollTo({ left: l - (v.clientWidth - w) / 2, behavior: prev < 0 ? 'auto' : 'smooth' }); }
    }
    this.setupOverlays();
    this.enterStep3D(i, prev);
    document.title = `${stepTitle(STEPS[i], this.board)} · Rover Lab`;
  }

  setBoard(board, { quiet = false } = {}) {
    if (board === this.board) return;
    this.board = board;
    store.set('rover:board', board);
    this.bench?.setBoard(board);
    this.renderHeader();
    this.renderStrip();
    if (this.step >= 0) {
      this.renderLessonPane();
      this.renderBenchHead();
      if (this.driveView) { this.stopDrive(); this.startDrive(); }
      else if (this.bench) this.bench.snapStep(this.step);
      this.setupOverlays(true);
    }
    if (this.partId) this.openPart(this.partId);
    if (!quiet) toast(t('toast.board', { board: BOARDS[board].name }));
    clearTimeout(this.thumbTimer);
    if (!STEPS.every((_, i) => this.thumbs[`${board}:${i}`])) this.thumbTimer = setTimeout(() => this.makeThumbs(), 400);
  }

  async setLanguage(code) {
    this.closeLangMenu?.();
    store.set('rover:lang', code);
    await setLang(code);
    if (this.dead) return;
    this.renderChrome(true);
    if (!TRANSLATED.has(code)) toast(t('toast.langFallback', { lang: langInfo(code).native }));
  }

  toggleCheck(key) {
    const on = !this.checks.has(key);
    if (on) this.checks.add(key); else this.checks.delete(key);
    store.set('rover:checks', [...this.checks]);
    const s = STEPS[this.step];
    const keys = checkKeys(s, this.board);
    if (on && keys.every(k => this.checks.has(k))) toast(t('toast.stepDone', { title: stepTitle(s, this.board) }));
    this.renderStrip();
    return on;
  }

  // ---- part details -----------------------------------------------------------------------------

  openPart(id) {
    const info = PARTS[id];
    if (!info) return;
    this.partId = id;
    this.partPane.replaceChildren(renderPart(id, info, this.board, {
      stepIndex: this.step,
      onBack: () => this.closePart(),
      onGo: si => { this.closePart(); this.go(si); },
    }));
    this.partPane.hidden = false;
    this.lessonPane.hidden = true;
    this.partPane.querySelector('button')?.focus();
    this.bench?.highlight([id]);
    this.pinnedHighlight = id;
  }

  closePart(silent = false) {
    if (!this.partId && silent) return;
    this.partId = null;
    this.pinnedHighlight = null;
    this.partPane.hidden = true;
    this.lessonPane.hidden = false;
    this.bench?.highlight(null);
  }

  showTip(part, x, y) {
    if (!part || !PARTS[part] || this.step === DRIVE) {
      this.tip.hidden = true;
      if (!this.pinnedHighlight && this.hoverLit) { this.bench.highlight(null); this.hoverLit = false; }
      return;
    }
    const r = this.benchCard.getBoundingClientRect();
    this.tip.hidden = false;
    this.tip.firstChild.textContent = PARTS[part].name;
    this.tip.lastChild.textContent = t('bench.inspect');
    this.tip.style.transform = `translate(${x - r.left + 14}px, ${y - r.top + 16}px)`;
    if (!this.pinnedHighlight) { this.bench.highlight([part]); this.hoverLit = true; }
  }

  // ---- overlays: flow chart, minimap, drive panel ------------------------------------------------

  setupOverlays(force = false) {
    const wantFlow = this.step === CODE || this.step === DRIVE;
    if (!wantFlow || force) { this.flow?.card.remove(); this.flow?.overlay.remove(); this.flow = null; }
    if (wantFlow && !this.flow) {
      this.flow = createFlow({
        getBoard: () => this.board,
        onAuto: () => { if (this.step !== DRIVE) { this.go(DRIVE); setTimeout(() => this.send({ cmd: 'mode', value: 'auto' }), 300); } else this.send({ cmd: 'mode', value: 'auto' }); },
        onOpenChange: open => { this.veil.hidden = !open; },
      });
      this.flowSlot.replaceChildren(this.flow.card, this.flow.overlay);
      this.flow.setLive(null, this.step === DRIVE ? 'manual' : null);
    }
    this.veil.hidden = true;
    if (this.step !== DRIVE) { this.mapSlot.replaceChildren(); this.minimap = null; this.hud.hidden = true; }
    if (this.step === DRIVE && force && this.sim) this.buildDriveUi();
  }

  startDrive() {
    this.benchReady?.then(async () => {
      if (this.dead || this.step !== DRIVE || this.driveView || !this.bench) return;
      const [{ RoverSim }, { DriveView }] = await Promise.all([import('./sim/sim.js'), import('./sim/drive-view.js')]);
      if (this.dead || this.step !== DRIVE || this.driveView) return;
      this.bench.snapStep(8);
      this.bench.setExplode(false);
      this.sim = new RoverSim({ board: this.board, obstacles: store.get('rover:arena', null) || undefined, onLog: line => this.drivePanel?.log(line) });
      this.driveView = new DriveView(this.bench, this.sim, { beam: this.settings.beam, follow: this.settings.follow });
      this.buildDriveUi();
      this.sim.boot();
      if (this.settings.conn === 'ws') this.connectCar();
      this.syncTools();
    });
  }

  buildDriveUi() {
    this.drivePanel = createDrivePanel({ send: c => this.send(c), hold: (dir, release) => this.hold(dir, release) });
    this.drivePanelSlot?.replaceChildren(this.drivePanel.el);
    this.minimap = createMinimap({
      getSim: () => this.sim,
      onEditChange: on => { if (this.driveView) this.driveView.paused = on; this.veil.hidden = !on; this.benchCard.classList.toggle('editing', on); this.releaseAll(); },
      onSave: list => {
        this.sim.setObstacles(list);
        this.sim.unstick();
        this.driveView.rebuildObstacles();
        store.set('rover:arena', list);
        toast(t('toast.arenaSaved'));
      },
    });
    this.mapSlot.replaceChildren(this.minimap.el);
    this.hud.hidden = false;
    this.hudVals = {};
    const item = (k, label, unit) => { const v = h('b', '--'); this.hudVals[k] = v; return h('div.rv-hud-item', h('span.rv-hud-k', label), h('span.rv-hud-v', v, unit ? h('small', unit) : null)); };
    this.hudLed = h('span.rv-dot.led');
    this.hudBuz = h('span.rv-dot.buzzer');
    this.hud.replaceChildren(item('distance', t('hud.distance'), ' cm'), item('speed', t('hud.speed'), ' %'), item('mode', t('hud.mode')), item('servo', t('hud.servo'), '°'),
      h('div.rv-hud-item.dots', h('span', this.hudLed, t('drive.led')), h('span', this.hudBuz, t('drive.buzzer'))));
  }

  stopDrive() {
    if (!this.driveView) return;
    this.releaseAll();
    this.link.close();
    this.driveView.dispose();
    this.driveView = null;
    this.sim = null;
    this.drivePanel = null;
    this.buzzer.set(false, false);
    this.mapSlot.replaceChildren();
    this.minimap = null;
    this.hud.hidden = true;
  }

  send(cmd) {
    if (this.settings.conn === 'ws' && this.link.status === 'connected') { this.link.send(cmd); return; }
    this.sim?.send(cmd);
  }

  /** Hold a direction (keyboard or pad) — repeated so the car's dead-man stop never fires while held. */
  hold(dir, release) {
    if (release) this.held = this.held.filter(d => d !== release);
    else if (dir) { this.held = this.held.filter(d => d !== dir); this.held.push(dir); }
    else this.held = [];
    const cur = this.held[this.held.length - 1] || null;
    clearInterval(this.holdTimer);
    if (cur) {
      this.send({ cmd: 'drive', dir: cur });
      this.holdTimer = setInterval(() => this.send({ cmd: 'drive', dir: cur }), 150);
    } else if (release || dir === null) this.send({ cmd: 'drive', dir: 'stop' });
  }

  releaseAll() {
    if (this.held.length) { this.held = []; clearInterval(this.holdTimer); this.send({ cmd: 'drive', dir: 'stop' }); }
    clearInterval(this.holdTimer);
  }

  onFrame() {
    if (this.step !== DRIVE || !this.sim) return;
    const s = this.settings.conn === 'ws' && this.telemetry && this.link.status === 'connected' ? { ...this.sim.snapshot(), ...this.telemetry } : this.sim.snapshot();
    this.drivePanel?.update(s);
    const now = performance.now();
    if (now - (this.hudAt || 0) > 100) {
      this.hudAt = now;
      if (this.hudVals) {
        this.hudVals.distance.textContent = s.distance >= 400 ? '400+' : s.distance.toFixed(1);
        this.hudVals.distance.parentElement.classList.toggle('warn', s.distance < this.sim.cfg.clear);
        this.hudVals.speed.textContent = s.speed;
        this.hudVals.mode.textContent = t('mode.' + s.mode).toUpperCase();
        this.hudVals.servo.textContent = s.servo;
        this.hudLed.classList.toggle('on', !!s.led);
        this.hudBuz.classList.toggle('on', !!s.buzzer);
      }
      this.flow?.setLive(this.autoView(s), s.mode);
    }
    this.minimap?.draw();
    this.buzzer.set(s.buzzer, this.settings.sound);
  }

  autoView(s) {
    if (s.mode !== 'auto' || !this.sim || this.settings.conn === 'ws') return null;
    const a = this.sim.auto, c = this.sim.cfg;
    const cm = v => `${Math.round(v)} cm`;
    let what, why;
    switch (a.state) {
      case 'cruise': what = t('live.cruise'); why = t('live.cruiseWhy', { d: s.distance >= 400 ? '400+ cm' : cm(s.distance), stop: c.clear }); break;
      case 'halt': what = t('live.halt'); why = a.why === 'stuck' ? t('live.stuckWhy', { s: c.stuck }) : t('live.haltWhy', { d: cm(a.stoppedAt || s.distance) }); break;
      case 'lookRight': what = t('live.lookRight'); why = t('live.lookWhy', { a: c.lookR }); break;
      case 'lookLeft': what = t('live.lookLeft'); why = t('live.lookLeftWhy', { a: c.lookL, r: cm(a.right) }); break;
      case 'centre': what = t('live.centre'); why = t('live.centreWhy', { l: cm(a.left), r: cm(a.right) }); break;
      case 'reverse': what = t('live.reverse'); why = a.why === 'boxed' ? t('live.boxedWhy', { l: cm(a.left), r: cm(a.right), min: c.boxed }) : t('live.stuckWhy', { s: c.stuck }); break;
      case 'turn': what = t(a.turn === 'left' ? 'live.turnLeft' : 'live.turnRight'); why = a.again ? t('live.againWhy') : t('live.sideWhy', { l: cm(a.left), r: cm(a.right) }); break;
      default: what = ''; why = '';
    }
    return { node: a.node, path: a.path, what: what + ' · ', why };
  }

  // ---- real car ---------------------------------------------------------------------------------

  connectCar() {
    if (!this.settings.url) return;
    this.telemetry = null;
    this.link.connect(this.settings.url);
  }

  onLinkStatus(s) {
    if (this.driveView) this.driveView.external = s === 'connected' ? (this.telemetry || {}) : null;
    if (s === 'error' && this.settings.conn === 'ws') toast(t('toast.linkError'));
    this.paintPill();
  }

  paintPill() {
    const ws = this.settings.conn === 'ws';
    const st = ws ? this.link.status : 'sim';
    this.connPill.dataset.state = ws ? (st === 'connected' ? 'ok' : st === 'connecting' ? 'wait' : 'bad') : 'ok';
    this.connPill.lastChild.textContent = ws ? t('pill.' + (st === 'idle' ? 'closed' : st)) : t('pill.sim');
  }

  // ---- tools ------------------------------------------------------------------------------------

  togglePlay() {
    const b = this.bench;
    if (!b) return;
    if (b.isAnimating()) b.setPlaying(!b.playing);
    else b.replay();
    this.syncTools();
  }
  cycleSpeed() {
    const speeds = [0.5, 1, 2];
    const b = this.bench;
    b.setSpeed(speeds[(speeds.indexOf(b.speed) + 1) % speeds.length]);
    this.syncTools();
  }
  toggleExplode() {
    if (!this.bench || this.step === DRIVE || this.step === 0) return;
    this.bench.setExplode(!(this.bench.explodeTarget > 0));
    this.syncTools();
  }
  cycleCamera(mode) {
    if (!this.driveView) return;
    const order = ['orbit', 'chase', 'top'];
    const next = mode || order[(order.indexOf(this.driveView.camMode) + 1) % order.length];
    this.driveView.setCamMode(this.driveView.camMode === next && mode ? 'orbit' : next);
    toast(t('tools.cam.' + this.driveView.camMode), 1400);
    this.syncTools();
  }
  resetView() {
    if (this.driveView) { this.driveView.setCamMode('orbit'); this.syncTools(); return; }
    this.bench?.resetView();
  }

  // ---- keyboard ---------------------------------------------------------------------------------

  onKey(e) {
    const tag = e.target?.tagName;
    const typing = tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target?.isContentEditable;
    if (document.querySelector('.modal-back')) return;
    if (this.minimap?.isEditing()) { if (this.minimap.onKey(e)) e.preventDefault(); return; }
    if (e.key === 'Escape') {
      if (this.flow?.isOpen()) { this.flow.close(); return; }
      if (this.partId) { this.closePart(); return; }
      this.closeLangMenu?.();
      return;
    }
    if (typing || e.ctrlKey || e.metaKey) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const drive = this.step === DRIVE && this.sim;
    if (drive) {
      const dirs = { w: 'forward', ArrowUp: 'forward', s: 'backward', ArrowDown: 'backward', a: 'left', ArrowLeft: 'left', d: 'right', ArrowRight: 'right' };
      if (dirs[k] && !e.altKey) { e.preventDefault(); if (!e.repeat) this.hold(dirs[k]); return; }
      if (k === ' ') { e.preventDefault(); this.hold(null); this.send({ cmd: 'drive', dir: 'stop' }); return; }
      if (k === '1' || k === '2' || k === '3') { this.send({ cmd: 'mode', value: ['manual', 'auto', 'stop'][+k - 1] }); return; }
      if (k === 'l') { this.send({ cmd: 'led', value: !this.sim.led }); return; }
      if (k === 'b') { this.send({ cmd: 'buzzer', value: !this.sim.buzzer }); return; }
      if (k === 'c') { this.cycleCamera('chase'); return; }
      if (k === 't') { this.cycleCamera('top'); return; }
      if (k === '[' || k === 'PageUp' || (e.altKey && k === 'ArrowLeft')) { e.preventDefault(); this.go(this.step - 1); return; }
      if (k === ']' || k === 'PageDown' || (e.altKey && k === 'ArrowRight')) { e.preventDefault(); this.go(this.step + 1); return; }
    } else {
      if (k === 'ArrowLeft' || k === '[' || k === 'PageUp') { e.preventDefault(); this.go(this.step - 1); return; }
      if (k === 'ArrowRight' || k === ']' || k === 'PageDown') { e.preventDefault(); this.go(this.step + 1); return; }
      if (k === 'e') { this.toggleExplode(); return; }
      if (k === ' ' && this.step >= 1 && this.step <= 7 && !e.target?.closest?.('button, a, summary')) { e.preventDefault(); this.togglePlay(); return; }
      if (k === 'f' && this.flow) { this.flow.open(); return; }
    }
    if (k === '+' || k === '=') { this.bench?.zoom(1); return; }
    if (k === '-' || k === '_') { this.bench?.zoom(-1); return; }
    if (k === '0') { this.resetView(); return; }
    if (k === '?' || (k === '/' && e.shiftKey)) { this.showHelp(); return; }
  }

  onKeyUp(e) {
    if (this.step !== DRIVE) return;
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    const dirs = { w: 'forward', ArrowUp: 'forward', s: 'backward', ArrowDown: 'backward', a: 'left', ArrowLeft: 'left', d: 'right', ArrowRight: 'right' };
    if (dirs[k] && this.held.includes(dirs[k])) this.hold(null, dirs[k]);
  }

  showHelp() {
    const rows = [
      ['← →', t('help.steps')], ['E', t('help.explode')], ['Space', t('help.play')], ['+ −', t('help.zoom')], ['0', t('help.reset')], ['F', t('help.flow')],
      ['W A S D / ↑ ← ↓ →', t('help.drive')], ['Space', t('help.stop')], ['1 2 3', t('help.mode')], ['L · B', t('help.ledBuzzer')], ['C · T', t('help.camera')], ['[ ]', t('help.stepsDrive')],
      ['?', t('help.help')], ['Esc', t('help.esc')],
    ];
    modal(t('help.title'), h('div.rv-help',
      h('p.muted', t('help.intro')),
      h('dl', rows.map(([k, v]) => [h('dt', k.split(' ').map(x => (x === '/' ? ' / ' : h('span.kbd', x)))), h('dd', v)]))));
    document.querySelector('.modal')?.classList.add('rv-modal');
  }

  showSettings() {
    openSettings(this.settings, {
      langs: LANGS, lang: currentLang(), onLang: code => this.setLanguage(code),
      linkStatus: () => t('pill.' + (this.link.status === 'idle' ? 'closed' : this.link.status)),
      onApply: s => {
        const old = this.settings;
        this.settings = s;
        store.set('rover:settings', s);
        this.bench?.setLabels(s.labels);
        if (s.quality !== old.quality) this.bench?.setQuality(s.quality);
        this.driveView?.setOptions({ beam: s.beam, follow: s.follow });
        if (this.driveView) {
          if (s.conn === 'ws' && (old.conn !== 'ws' || old.url !== s.url)) this.connectCar();
          if (s.conn !== 'ws' && old.conn === 'ws') { this.link.close(); this.driveView.external = null; }
        }
        this.paintPill();
        toast(t('toast.settings'));
      },
      onResetSim: () => {
        if (!this.sim) { store.set('rover:arena', null); toast(t('toast.simReset')); return; }
        this.releaseAll();
        this.sim.reset();
        this.drivePanel?.log('— reset —');
        this.sim.boot();
        this.driveView?.setCamMode('orbit');
        toast(t('toast.simReset'));
      },
      onResetProgress: () => {
        this.checks.clear();
        store.set('rover:checks', []);
        this.renderStrip();
        this.renderLessonPane();
        toast(t('toast.progressReset'));
      },
    });
  }

  onTheme() {
    if (!this.bench) return;
    this.bench.applyTheme();
    this.minimap?.draw();
    this.thumbs = {};
    clearTimeout(this.thumbTimer);
    this.thumbTimer = setTimeout(() => this.makeThumbs(), 300);
  }

  destroy() {
    this.dead = true;
    clearTimeout(this.thumbTimer);
    clearInterval(this.holdTimer);
    for (const d of this.disposers) d();
    this.link.close();
    this.buzzer.dispose();
    this.stopDrive();
    this.bench?.dispose();
    this.bench = null;
    this.css.remove();
    this.el.classList.remove('rover-main');
    this.ctx.headerSlot.replaceChildren();
    this.root.remove();
    document.querySelectorAll('.modal-back').forEach(m => m.remove());
  }
}
