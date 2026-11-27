// Systems Lab: home page (#/systems), topic pages (#/systems/<slug>) and the
// build-your-own-system workbench (#/systems/workbench).

import { h, $, $$, esc, modal, toast, pick } from '../js/core/dom.js';
import { TOPICS, CATEGORIES, PATHS, ORDERED, bySlug, catLabel } from './catalog.js';
import { mountTopicPage } from './kit/page.js';
import { onClockChange, setSpeed, togglePause, isPaused } from './kit/clock.js';
import * as progress from './kit/progress.js';
import { icon } from './kit/icons.js';

const CSS_ID = 'systems-css';

export function mount(el, rest, ctx) {
  if (!document.getElementById(CSS_ID)) {
    document.head.append(h('link', { rel: 'stylesheet', href: new URL('./systems.css', import.meta.url).href, id: CSS_ID }));
  }
  const root = h('div.systems');
  el.append(root);
  const header = headerControls(ctx.headerSlot);
  let view = null;
  let token = 0;

  async function show(rest) {
    const my = ++token;
    view?.destroy?.();
    view = null;
    root.replaceChildren();
    window.scrollTo(0, 0);
    const slug = rest[0];
    if (!slug) { view = renderHome(root); document.title = 'Systems Lab — Twin Labs'; return; }
    if (slug === 'workbench') {
      document.title = 'Build your own system — Systems Lab';
      root.append(h('div.loading', h('div.spinner')));
      try {
        const mod = await import('./workbench/index.js');
        if (my !== token) return;
        root.replaceChildren();
        view = mod.mount(root, rest.slice(1));
      } catch (err) { failed(root, err); }
      return;
    }
    const topic = bySlug(slug);
    if (!topic) { root.append(h('div.error-box', h('h2', 'No such topic'), h('p', h('a', { href: '#/systems' }, 'Back to the Systems Lab')))); return; }
    document.title = `${topic.short} — Systems Lab`;
    const layout = labLayout(root, topic);
    layout.main.append(h('div.loading', h('div.spinner')));
    try {
      const mod = await import(`./sims/${topic.slug}.js`);
      if (my !== token) { layout.destroy(); return; }
      layout.main.replaceChildren();
      const page = mountTopicPage(layout.main, topic, mod.default);
      view = { destroy() { page.destroy(); layout.destroy(); } };
    } catch (err) {
      if (my !== token) return;
      console.error(err);
      layout.main.replaceChildren(h('div.error-box', h('h2', 'This simulation is not available yet'), h('p.muted', String(err.message || err))));
      view = layout;
    }
  }
  show(rest);

  return {
    update(r) { show(r); },
    destroy() { token++; view?.destroy?.(); header.destroy(); root.remove(); document.getElementById(CSS_ID)?.remove(); },
  };
}

function failed(root, err) {
  console.error(err);
  root.replaceChildren(h('div.error-box', h('h2', 'Could not load this page'), h('p.muted', String(err.message || err))));
}

// ---------- header: search, pause, speed ----------
function headerControls(slot) {
  const search = h('button.btn.search-btn', { type: 'button', onclick: openSearch, 'aria-label': 'Search topics' },
    h('span', { html: icon('search', 16) }), h('span.search-label', 'Search topics'), h('span.kbd', 'Ctrl K'));
  const pause = h('button.btn.icon', { type: 'button', onclick: togglePause, title: 'Pause or resume (Space)' });
  const speeds = h('div.seg.compact', { role: 'group', 'aria-label': 'Simulation speed' },
    [[0.5, '½×'], [1, '1×'], [2, '2×']].map(([s, l]) => h('button', { type: 'button', dataset: { speed: s }, onclick: () => setSpeed(s) }, l)));
  const wrap = h('div.sys-header', search, pause, speeds);
  slot.append(wrap);
  const off = onClockChange(st => {
    pause.innerHTML = st.paused ? icon('play', 16) : icon('pause', 16);
    pause.setAttribute('aria-pressed', String(st.paused));
    pause.setAttribute('aria-label', st.paused ? 'Resume' : 'Pause');
    for (const b of speeds.children) b.setAttribute('aria-pressed', String(!st.paused && Number(b.dataset.speed) === st.speed));
  });
  const onKey = e => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) || e.target.isContentEditable;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') { e.preventDefault(); openSearch(); return; }
    if (typing || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('.modal-back')) return;
    if (e.key === ' ' && location.hash.startsWith('#/systems/')) { e.preventDefault(); togglePause(); }
    else if (e.key.toLowerCase() === 'r') surprise();
    else if (e.key === '?') shortcuts();
    else if (e.key === '/') { e.preventDefault(); openSearch(); }
  };
  document.addEventListener('keydown', onKey);
  return { destroy() { off(); document.removeEventListener('keydown', onKey); wrap.remove(); } };
}

export function surprise() {
  const cur = location.hash.split('/')[2];
  const pool = TOPICS.filter(t => t.slug !== cur && !progress.isDone(t.slug));
  const t = pick(pool.length ? pool : TOPICS);
  location.hash = `#/systems/${t.slug}`;
}

function shortcuts() {
  const rows = [['Ctrl K or /', 'Search topics'], ['Space', 'Pause or resume the simulation'], ['R', 'Surprise me: open a random topic you have not finished'], ['?', 'Show these shortcuts'], ['Esc', 'Close a dialog']];
  modal('Keyboard shortcuts', h('table.shortcuts', rows.map(([k, d]) => h('tr', h('td', h('span.kbd', k)), h('td', d)))));
}

function openSearch() {
  if (document.querySelector('.search-modal')) return;
  const input = h('input.input.search-input', { type: 'search', placeholder: 'Search 56 topics: caching, kafka, payments…', 'aria-label': 'Search topics' });
  const list = h('ul.search-results', { role: 'listbox' });
  let sel = 0, results = [];
  const body = h('div.search-modal', input, list, h('p.faint.search-tip', h('span.kbd', '↑'), ' ', h('span.kbd', '↓'), ' to move · ', h('span.kbd', 'Enter'), ' to open'));
  const close = modal('Search topics', body);
  const render = () => {
    const q = input.value.trim().toLowerCase();
    results = ORDERED.map(t => ({ t, s: score(t, q) })).filter(r => r.s > 0).sort((a, b) => b.s - a.s).slice(0, 12).map(r => r.t);
    sel = Math.min(sel, Math.max(0, results.length - 1));
    list.replaceChildren(...results.map((t, i) => h('li', { role: 'option', 'aria-selected': String(i === sel), onclick: () => go(t) },
      h('span.sr-icon', { html: icon(t.icon, 16) }), h('span', h('b', t.short), h('small.faint', ` · ${catLabel(t.cat)}`), h('br'), h('small.muted', t.desc)))));
    if (!results.length) list.append(h('li.empty', 'No topic matches. Try “cache”, “queue” or “payment”.'));
  };
  const go = t => { close(); location.hash = `#/systems/${t.slug}`; };
  input.addEventListener('input', () => { sel = 0; render(); });
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') { sel = Math.min(results.length - 1, sel + 1); render(); e.preventDefault(); }
    if (e.key === 'ArrowUp') { sel = Math.max(0, sel - 1); render(); e.preventDefault(); }
    if (e.key === 'Enter' && results[sel]) go(results[sel]);
  });
  render();
  setTimeout(() => input.focus(), 0);
}

function score(t, q) {
  if (!q) return 1;
  const hay = [t.short, t.title, t.desc, catLabel(t.cat), ...t.tags].join(' ').toLowerCase();
  let s = 0;
  for (const w of q.split(/\s+/)) {
    if (!w) continue;
    if (t.short.toLowerCase().startsWith(w)) s += 10;
    else if (t.short.toLowerCase().includes(w)) s += 6;
    else if (t.tags.some(x => x.includes(w))) s += 4;
    else if (hay.includes(w)) s += 1;
    else return 0;
  }
  return s;
}

// ---------- lab layout: sidebar + main ----------
function labLayout(root, topic) {
  const sidebar = h('nav.sidebar', { 'aria-label': 'Topics' });
  const main = h('div.lab-main');
  const toggle = h('button.btn.sidebar-toggle', { type: 'button', onclick: () => document.body.classList.toggle('sidebar-open') }, h('span', { html: icon('list', 16) }), 'Topics');
  root.append(h('div.lab', sidebar, h('div.lab-col', toggle, main)));

  const paint = () => {
    const done = progress.doneCount();
    sidebar.replaceChildren();
    sidebar.append(...[
      h('div.side-head', h('span.eyebrow', 'Topics'),
        h('span.faint.side-progress', progress.streak() ? `🔥 ${progress.streak()} · ` : '', `${done} of ${TOPICS.length} done`)),
      h('button.side-cta.surprise', { type: 'button', onclick: surprise }, h('span', { html: icon('shuffle', 16) }), h('span', 'Surprise me'), h('span.kbd', 'R')),
      h('a.side-cta.build', { href: '#/systems/workbench' }, h('span', { html: icon('layers', 16) }), h('span', 'Build your own system'), h('span.chip.accent', 'Beta')),
      CATEGORIES.map(c => [
        h('div.side-cat', c.label),
        h('ul', TOPICS.filter(t => t.cat === c.id).map(t => h('li',
          h('a.side-link', { href: `#/systems/${t.slug}`, 'aria-current': t.slug === topic.slug ? 'page' : null, onclick: () => document.body.classList.remove('sidebar-open') },
            h('span.side-icon', { html: icon(t.icon, 16) }),
            h('span.side-name', t.short),
            t.isNew && h('span.chip.accent.tiny', 'New'),
            h('span.side-dot', { class: 'side-dot ' + (progress.isDone(t.slug) ? 'done' : progress.isVisited(t.slug) ? 'seen' : ''), title: progress.isDone(t.slug) ? 'Done' : progress.isVisited(t.slug) ? 'Visited' : 'Not started' })))))]),
      h('div.side-foot', h('a', { href: '#/systems' }, '← Systems Lab home'), h('button.btn.ghost.sm', { type: 'button', onclick: shortcuts }, 'Keyboard shortcuts'))].flat(3));
    sidebar.querySelector('[aria-current="page"]')?.scrollIntoView({ block: 'nearest' });
  };
  paint();
  window.addEventListener('progresschange', paint);
  return { main, destroy() { window.removeEventListener('progresschange', paint); document.body.classList.remove('sidebar-open'); } };
}

// ---------- home ----------
function renderHome(root) {
  let filter = 'all';
  let query = '';
  const grid = h('div.topic-grid-cards');
  const filters = h('div.filters', { role: 'group', 'aria-label': 'Filter topics' });
  const filterInput = h('input.input.filter-input', { type: 'search', placeholder: 'Filter topics', 'aria-label': 'Filter topics' });
  filterInput.addEventListener('input', () => { query = filterInput.value.trim().toLowerCase(); paintGrid(); });

  const allCats = [['all', `All ${TOPICS.length}`], ...CATEGORIES.map(c => [c.id, `${c.label} ${TOPICS.filter(t => t.cat === c.id).length}`])];
  const order = ['overview', 'foundations', 'scale', 'async', 'edge', 'devops', 'payments', 'designs'];
  const cards = order.flatMap(c => TOPICS.filter(t => t.cat === c));
  for (const [id, label] of allCats) {
    filters.append(h('button.chip.filter', { type: 'button', 'aria-pressed': String(id === filter), onclick: e => { filter = id; for (const b of filters.children) b.setAttribute('aria-pressed', String(b === e.currentTarget)); paintGrid(); } }, label));
  }
  function paintGrid() {
    grid.replaceChildren(...cards.filter(t => (filter === 'all' || t.cat === filter) && score(t, query) > 0).map(t =>
      h('a.topic-card', { href: `#/systems/${t.slug}` },
        h('div.tc-top', h('span.tc-icon', { html: icon(t.icon, 18) }), h('span.eyebrow', catLabel(t.cat)), t.isNew && h('span.chip.accent.tiny', 'New'),
          progress.isDone(t.slug) && h('span.chip.green.tiny', 'Done')),
        h('h3', t.short), h('p.muted', t.desc),
        h('div.tc-foot', h('span.chip', t.level), h('span.faint', `≈ ${t.mins} min`), h('span.tc-open', 'Open →')))));
    if (!grid.children.length) grid.append(h('p.muted', 'No topics match that filter.'));
  }
  paintGrid();

  const demoHost = h('div.demo-stage');
  const demo = h('div.demo.card',
    h('div.demo-head', h('span.live', h('i'), 'Live'), h('span.faint.demo-stat', '')),
    demoHost,
    h('div.demo-actions'),
    h('p.faint.demo-tip', 'Try it: spike the traffic or crash a server. ', h('a', { href: '#/systems/load-balancing' }, 'Open the full load-balancing lab →')));

  const pathCards = PATHS.map(p => {
    const done = p.steps.filter(s => progress.isDone(s)).length;
    const nextStep = p.steps.find(s => !progress.isDone(s)) || p.steps[0];
    return h('div.path-card.card',
      h('div.path-top', h('h3', p.title), h('span.faint', `${done} / ${p.steps.length}`)),
      h('p.muted', p.blurb),
      h('div.path-bar', h('i', { style: { width: `${(done / p.steps.length) * 100}%` } })),
      h('ol.path-steps', p.steps.map(s => h('li', { class: progress.isDone(s) ? 'done' : '' }, h('a', { href: `#/systems/${s}` }, bySlug(s)?.short || s)))),
      h('a.btn.primary.sm', { href: `#/systems/${nextStep}` }, done ? 'Continue →' : 'Start →'));
  });

  const page = h('div.sys-home',
    h('section.sys-hero',
      h('div.hero-copy',
        h('div.eyebrow', 'Systems Lab', h('span.faint', '  /  '), 'Interactive simulations'),
        h('h1', 'Stop memorising system design. ', h('span.grad', 'Break it and watch.')),
        h('p.hero-lead', `${TOPICS.length} live simulations of the machinery behind big websites. Raise the traffic, crash a server, empty the cache, flip a setting, and see exactly what happens next, with real numbers instead of boxes and arrows.`),
        h('div.hero-ctas',
          h('a.btn.primary.lg', { href: `#/systems/${PATHS[0].steps[0]}` }, 'Start the interview path →'),
          h('a.btn.outline.lg', { href: '#topics', onclick: e => { e.preventDefault(); $('#topics')?.scrollIntoView({ behavior: 'smooth' }); } }, 'Browse all topics')),
        h('ul.hero-ticks', h('li', 'No sign-up'), h('li', 'Runs in your browser, phones too'), h('li', 'Free'))),
      demo),
    h('a.wb-banner', { href: '#/systems/workbench' },
      h('span.chip.accent', 'New · Beta'),
      h('span', h('b', 'Build your own system'), h('br'), h('span.muted', 'Drop in components, wire them up, send traffic and find out what your design can handle.')),
      h('span.wb-arrow', '→')),
    h('section.stats',
      stat(TOPICS.length, 'interactive simulations'), stat(CATEGORIES.length, 'areas of system design'),
      stat(TOPICS.length * 3, 'quiz questions with explanations'), stat(PATHS.length, 'guided learning paths')),
    h('section#topics.sys-section',
      h('div.eyebrow', 'Explore'),
      h('h2', 'Every topic is a working system'),
      h('p.muted', 'Each one has live controls, numbers that react, a list of experiments to try and a short quiz.'),
      h('div.filter-row', filters, filterInput),
      grid),
    h('section#paths.sys-section',
      h('div.eyebrow', 'Learning paths'),
      h('h2', 'Not sure where to start? Follow a path.'),
      h('div.paths', pathCards)),
    h('section#how.sys-section',
      h('div.eyebrow', 'How it works'),
      h('h2', 'Predict, break, explain'),
      h('div.how',
        how('1', 'Predict', 'Every guided experiment asks what you expect before anything runs. Committing to a guess is what makes the surprise stick.'),
        how('2', 'Break it', 'Push traffic past the limit, crash a node, cut a network link. Watch the metrics, the chart and the event log react.'),
        how('3', 'Explain', 'Pick the explanation that fits what you saw, then take the three-question quiz. Topics you ace are marked done.'))),
    h('footer.sys-foot',
      h('span', 'Progress, notes and saved topics stay on this device.'),
      h('button.btn.ghost.sm', { type: 'button', onclick: () => { if (confirm('Reset all Systems Lab progress on this device?')) { progress.resetAll(); toast('Progress reset'); location.reload(); } } }, 'Reset progress')));
  root.append(page);

  const demoView = startDemo(demoHost, demo);
  const onProg = () => paintGrid();
  window.addEventListener('progresschange', onProg);
  return { destroy() { demoView.destroy(); window.removeEventListener('progresschange', onProg); } };
}

const stat = (n, l) => h('div.stat', h('b', String(n)), h('span', l));
const how = (n, t, d) => h('div.how-card.card', h('span.how-n', n), h('h3', t), h('p.muted', d));

// A small live load balancer on the home page.
function startDemo(host, card) {
  let destroyed = false, cleanup = () => {};
  Promise.all([import('./kit/stage.js'), import('./kit/clock.js')]).then(([{ createStage }, { addTicker }]) => {
    if (destroyed) return;
    const st = createStage(host, { height: 280, minHeight: 240 });
    const servers = [1, 2, 3, 4].map(i => ({ name: `web-${i}`, alive: true, load: 0, q: 0 }));
    let rps = 24, spikeUntil = 0, t = 0, acc = 0, rr = 0, failed = 0, served = 0, winT = 0, statTxt = '';
    const actions = card.querySelector('.demo-actions');
    const stat = card.querySelector('.demo-stat');
    const btn = (l, k, f) => { const b = h(`button.btn.${k}.sm`, { type: 'button', onclick: f }, l); actions.append(b); return b; };
    btn('Traffic spike', 'primary', () => { spikeUntil = t + 8; });
    btn('Crash a server', 'outline', () => { const a = servers.filter(s => s.alive); if (a.length > 1) pick(a).alive = false; setTimeout(() => servers.forEach(s => (s.alive = true)), 9000); });
    const pauseB = btn('Pause', 'outline', () => { paused = !paused; pauseB.textContent = paused ? 'Resume' : 'Pause'; });
    let paused = false;
    const layout = () => {
      const w = st.w, hh = st.h;
      const user = { x: 16, y: hh / 2 - 22, w: Math.min(100, w * 0.18), h: 44 };
      const lb = { x: w * 0.3, y: hh / 2 - 22, w: Math.min(120, w * 0.22), h: 44 };
      const sw = Math.min(150, w * 0.26);
      const sv = servers.map((s, i) => ({ x: w - sw - 12, y: 14 + i * ((hh - 28) / 4), w: sw, h: Math.min(40, (hh - 28) / 4 - 10) }));
      return { user, lb, sv };
    };
    const off = addTicker((_dt, real) => {
      const dt = paused ? 0 : real;
      t += dt;
      const L = layout();
      const rate = rps * (t < spikeUntil ? 4 : 1);
      acc += rate * dt;
      while (acc >= 1) {
        acc -= 1;
        const alive = servers.filter(s => s.alive);
        const s = servers[rr++ % servers.length];
        const i = servers.indexOf(s);
        const ok = s.alive && s.q < 6;
        if (ok) { s.q++; served++; } else failed++;
        const a = [L.user.x + L.user.w, L.user.y + L.user.h / 2], b = [L.lb.x, L.lb.y + L.lb.h / 2], c = [L.lb.x + L.lb.w, L.lb.y + L.lb.h / 2];
        st.send(() => { const LL = layout(); return [[LL.user.x + LL.user.w, LL.user.y + LL.user.h / 2], [LL.lb.x, LL.lb.y + LL.lb.h / 2], [LL.lb.x + LL.lb.w, LL.lb.y + LL.lb.h / 2], [LL.sv[i].x, LL.sv[i].y + LL.sv[i].h / 2]]; }, { dur: 1.1, fail: !ok, color: ok ? undefined : st.colors.bad });
        void alive; void a; void b; void c;
      }
      for (const s of servers) { s.q = Math.max(0, s.q - 3.2 * dt); s.load = s.load * 0.9 + 0.1 * (s.q / 6); }
      winT += dt;
      if (winT >= 1) { statTxt = `${Math.round(rate)} req/s · ${failed ? failed + ' failed' : 'all served'}`; failed = 0; served = 0; winT = 0; stat.textContent = statTxt; }
      st.clear();
      const c = st.colors;
      L.sv.forEach(b => st.line(L.lb.x + L.lb.w, L.lb.y + L.lb.h / 2, b.x, b.y + b.h / 2, { color: c.line2 }));
      st.line(L.user.x + L.user.w, L.user.y + L.user.h / 2, L.lb.x, L.lb.y + L.lb.h / 2, { color: c.line2 });
      st.drawFlows(dt);
      st.node(L.user.x, L.user.y, L.user.w, L.user.h, { title: 'Users', sub: 'browsing' });
      st.node(L.lb.x, L.lb.y, L.lb.w, L.lb.h, { title: 'Load balancer', sub: 'round robin' });
      servers.forEach((s, i) => { const b = L.sv[i]; st.node(b.x, b.y, b.w, b.h, { title: s.name, align: 'left', fill: s.alive ? s.load : 0, state: s.alive ? undefined : 'dead', right: s.alive ? Math.round(s.load * 100) + '%' : 'down', rightColor: s.alive ? undefined : c.bad }); });
    });
    cleanup = () => { off(); st.destroy(); };
  });
  return { destroy() { destroyed = true; cleanup(); } };
}

// re-exported for other modules
export { esc, $$ };
