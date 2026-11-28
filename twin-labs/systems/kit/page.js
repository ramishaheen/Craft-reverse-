// Builds one topic page around a simulation module and hands the sim a `kit`.
// Page anatomy (top to bottom): header (area · level · minutes, Save/Share/Classroom/Full screen),
// title + lead, guided experiment, [stage + metrics + chart + event log | controls + Try this],
// In short, My notes, Check yourself (quiz), Previous/Next, footnote.

import { h, esc, toast, modal } from '../../js/core/dom.js';
import { catLabel, ORDERED } from '../catalog.js';
import { createStage } from './stage.js';
import { createChart, fmtNum } from './chart.js';
import { createPanel } from './controls.js';
import { addTicker } from './clock.js';
import * as progress from './progress.js';

/**
 * Mount a topic page. Returns { destroy }.
 * sim: the default export of sims/<slug>.js
 */
export function mountTopicPage(host, topic, sim) {
  const cleanups = [];
  const idx = ORDERED.findIndex(t => t.slug === topic.slug);
  const prev = ORDERED[idx - 1], next = ORDERED[idx + 1];
  progress.visit(topic.slug);

  // ---------- header ----------
  const favBtn = h('button.btn.outline.sm', { type: 'button' });
  const paintFav = () => { const on = progress.isFav(topic.slug); favBtn.innerHTML = `${on ? '★' : '☆'} ${on ? 'Saved' : 'Save'}`; favBtn.setAttribute('aria-pressed', String(on)); };
  favBtn.onclick = () => { const on = progress.toggleFav(topic.slug); paintFav(); toast(on ? 'Saved to your list' : 'Removed from your list'); };
  paintFav();
  const shareBtn = h('button.btn.outline.sm', { type: 'button', onclick: share }, '↗ Share');
  const classBtn = h('button.btn.outline.sm', { type: 'button', onclick: toggleClassroom, 'aria-pressed': 'false' }, '▣ Classroom');
  const fullBtn = h('button.btn.outline.sm', { type: 'button', onclick: fullscreen }, '⤢ Full screen');

  const page = h('article.topic', { dataset: { slug: topic.slug } },
    h('header.topic-head',
      h('div.topic-meta',
        h('span.eyebrow', catLabel(topic.cat)),
        h('span.chip', topic.level),
        h('span.chip', `≈ ${topic.mins} min`),
        topic.isNew && h('span.chip.accent', 'New'),
        h('span.topic-actions', favBtn, shareBtn, classBtn, fullBtn)),
      h('h1', topic.title),
      h('p.lead', { html: sim.lead || topic.desc })));
  host.append(page);

  // ---------- guided experiment ----------
  const guidedBox = h('section.guided-box');
  page.append(guidedBox);

  // ---------- main grid ----------
  const stageHost = h('div.stage-host');
  const view3dBtn = h('button.btn.outline.block', { type: 'button', hidden: true }, '3D view');
  const metricsRow = h('div.metrics');
  const chartHost = h('div.chart-host');
  const logList = h('ol.event-log', h('li.empty', sim.emptyLog || 'Nothing yet. Change a control or press a button.'));
  const stageCard = h('div.stage-card.card', stageHost, metricsRow);
  const left = h('div.topic-main', stageCard, chartHost,
    h('section.card.log-card', h('h3', 'What just happened'), logList));
  const panelHost = h('div.card.panel-card');
  const tryList = h('section.card.try-card', h('h3', 'Try this'), h('ul', (sim.tryThis || []).map(t => h('li', { html: t }))));
  const right = h('aside.topic-side', panelHost, tryList);
  page.append(h('div.topic-grid', left, right));

  // ---------- in short / notes / quiz / nav ----------
  if (sim.inShort) {
    const s = sim.inShort;
    page.append(h('section.card.inshort',
      h('h3', 'In short'),
      h('dl',
        s.what && [h('dt', 'What'), h('dd', { html: s.what })],
        s.why && [h('dt', 'Why'), h('dd', { html: s.why })],
        s.tradeoff && [h('dt', 'Trade-off'), h('dd', { html: s.tradeoff })],
        s.interview && [h('dt', 'Say in the interview'), h('dd', { html: `“${s.interview}”` })])));
  }
  page.append(notesSection(topic));
  if (sim.quiz?.length) page.append(quizSection(topic, sim.quiz));
  page.append(h('nav.topic-nav', { 'aria-label': 'Topic navigation' },
    prev ? h('a.btn', { href: `#/systems/${prev.slug}` }, h('span.faint', '← Previous'), h('b', prev.short)) : h('span'),
    next ? h('a.btn', { href: `#/systems/${next.slug}` }, h('span.faint', 'Next →'), h('b', next.short)) : h('span')));
  page.append(h('p.footnote', 'Numbers are simplified models of real systems, tuned to make behaviour visible rather than to match any particular provider.'));

  // ---------- kit for the simulation ----------
  const stage = createStage(stageHost, { height: sim.stageHeight || 420 });
  cleanups.push(() => stage.destroy());
  const panel = createPanel(panelHost);
  const metricEls = {};
  let chart = null;
  let simTime = 0;
  let events = [];
  const timers = [];

  const kit = {
    topic,
    stage,
    stageEl: stageHost,
    panel,
    get time() { return simTime; },
    is3d: false,

    /** Define the metric strip. defs: [{ key, label, value? }] */
    metrics(defs) {
      metricsRow.replaceChildren();
      for (const d of defs) {
        const b = h('b', d.value ?? '–');
        metricEls[d.key] = b;
        metricsRow.append(h('div.metric', b, h('span', d.label)));
      }
    },
    /** Update one metric: tone '' | 'good' | 'warn' | 'bad'. */
    metric(key, value, tone = '') {
      const b = metricEls[key];
      if (!b) return;
      b.textContent = value;
      b.className = tone ? `tone-${tone}` : '';
    },
    chart(opts) { chart?.destroy(); chart = createChart(chartHost, opts); return chart; },
    log(msg) {
      events.unshift({ t: simTime, msg });
      events = events.slice(0, 40);
      logList.replaceChildren(...events.map(e => h('li', h('time', fmtTime(e.t)), h('span', { html: e.msg }))));
    },
    clearLog() { events = []; logList.replaceChildren(h('li.empty', sim.emptyLog || 'Nothing yet. Change a control or press a button.')); },
    /** fn(dt) each frame with simulated seconds (0 while paused). */
    loop(fn) { const off = addTicker((dt, real) => fn(dt, real)); cleanups.push(off); return off; },
    /** Call fn every `sec` simulated seconds. */
    every(sec, fn) { const t = { sec, acc: 0, fn }; timers.push(t); return () => timers.splice(timers.indexOf(t), 1); },
    resetTime() { simTime = 0; for (const t of timers) t.acc = 0; },
    /** Enable the 3D toggle; sim reads kit.is3d in its draw and can call kit.cam() for an iso camera. */
    enable3d(opts = {}) {
      view3dBtn.hidden = false;
      cam.yaw = opts.yaw ?? -0.6; cam.pitch = opts.pitch ?? 0.55;
      view3dBtn.onclick = () => { kit.is3d = !kit.is3d; view3dBtn.textContent = kit.is3d ? '2D view' : '3D view'; view3dBtn.setAttribute('aria-pressed', String(kit.is3d)); };
    },
    cam(scale) { cam.cx = stage.w / 2; cam.cy = stage.h * 0.55; cam.scale = scale ?? Math.min(stage.w, stage.h) * 0.42; return cam; },
    guided: { observe: () => {} },
    onCleanup(fn) { cleanups.push(fn); },
    fmt: fmtNum,
  };
  const cam = { yaw: -0.6, pitch: 0.55, cx: 0, cy: 0, scale: 100 };
  let drag = null;
  stage.onPointer((type, x, y) => {
    if (!kit.is3d) return;
    if (type === 'pointerdown') drag = { x, y, yaw: cam.yaw, pitch: cam.pitch };
    else if (type === 'pointermove' && drag) { cam.yaw = drag.yaw + (x - drag.x) * 0.01; cam.pitch = Math.max(0.2, Math.min(1.3, drag.pitch + (y - drag.y) * 0.006)); }
    else drag = null;
  });

  // The page's own ticker is registered before the sim's, so it advances simulated time exactly
  // once per frame (before any sim loop runs) and fires the fixed-step timers.
  kit.loop(dt => {
    simTime += dt;
    for (const t of timers) {
      t.acc += dt;
      let guard = 0;
      while (t.acc >= t.sec && guard++ < 20) { t.acc -= t.sec; t.fn(); }
    }
  });

  let simApi = {};
  try {
    simApi = sim.setup(kit) || {};
  } catch (err) {
    console.error(err);
    stageHost.append(h('div.error-box', 'This simulation failed to start: ' + esc(err.message)));
  }
  panelHost.append(view3dBtn);
  if (sim.guided) guidedSection(guidedBox, topic, sim.guided, kit, simApi, panel);

  // keyboard: this page listens for "reset" via the lab shell (R is surprise me), so nothing here.

  function share() {
    const url = location.href;
    (navigator.clipboard?.writeText(url) || Promise.reject()).then(() => toast('Link copied'), () => modal('Share this topic', h('input.input', { value: url, readonly: true, onfocus: e => e.target.select() })));
  }
  function toggleClassroom() {
    const on = document.body.classList.toggle('classroom');
    classBtn.setAttribute('aria-pressed', String(on));
    stage.resize();
    toast(on ? 'Classroom mode: larger text, no sidebar. Press it again to leave.' : 'Classroom mode off');
  }
  function fullscreen() {
    const el = stageCard;
    if (document.fullscreenElement) document.exitFullscreen();
    else el.requestFullscreen?.().then(() => setTimeout(() => stage.resize(), 50)).catch(() => toast('Full screen is not available here'));
  }
  const onFs = () => setTimeout(() => stage.resize(), 60);
  document.addEventListener('fullscreenchange', onFs);
  cleanups.push(() => document.removeEventListener('fullscreenchange', onFs));
  cleanups.push(() => document.body.classList.remove('classroom'));

  return {
    destroy() {
      try { simApi.destroy?.(); } catch (e) { console.error(e); }
      chart?.destroy();
      for (const f of cleanups.splice(0)) { try { f(); } catch (e) { console.error(e); } }
      page.remove();
    },
  };
}

function fmtTime(t) {
  const s = Math.floor(t);
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

// ---------- guided experiment: predict → run → explain ----------
function guidedSection(box, topic, g, kit, simApi, panel) {
  const name = `g-${topic.slug}`;
  let phase = 'predict', prediction = null, observed = false, waitTimer = null;
  const status = h('p.guided-status', { role: 'status', 'aria-live': 'polite' });
  const result = h('p.guided-result');
  const feedback = h('p.guided-feedback', { role: 'status', 'aria-live': 'polite' });
  const runBtn = h('button.btn.primary', { type: 'submit', disabled: true }, '2. Run the guided example');
  const predictSet = h('fieldset', h('legend', `1. Predict: ${g.question}`),
    g.predictions.map((p, i) => h('label', h('input', { type: 'radio', name: `${name}-p`, value: i }), h('span', { html: p }))));
  const form = h('form.guided-form', predictSet, runBtn);
  const next = g.nextSlug ? h('a.btn', { href: `#/systems/${g.nextSlug}`, hidden: true }, g.nextLabel || 'Next experiment →') : null;
  const explain = h('form.guided-explain', { hidden: true }, result,
    h('fieldset', h('legend', `3. Explain: ${g.explainQuestion}`),
      g.explanations.map((p, i) => h('label', h('input', { type: 'radio', name: `${name}-e`, value: i, required: true }), h('span', { html: p })))),
    h('button.btn.primary', { type: 'submit' }, 'Check my explanation'), feedback, next);
  const retry = h('button.btn.ghost', { type: 'button' }, 'Start this check again');
  const details = h('details.guided',
    h('summary', 'Guided experiment · Predict, run, explain'),
    h('div.guided-body',
      h('p', { html: g.intro }),
      g.example && h('p.guided-hint', { html: `${g.example} Free exploration stays available, and this check does not change your quiz progress.` }),
      form, status, explain, retry));
  box.append(details);

  form.addEventListener('change', e => { if (e.target.name === `${name}-p`) { prediction = Number(e.target.value); runBtn.disabled = false; } });
  form.addEventListener('submit', e => {
    e.preventDefault();
    if (phase !== 'predict' || prediction == null) return;
    phase = 'running';
    runBtn.disabled = true; predictSet.disabled = true;
    status.innerHTML = g.running;
    applying = true;
    try { simApi.guidedRun?.(); } finally { applying = false; }
    clearTimeout(waitTimer);
    waitTimer = setTimeout(() => observe(g.observation || ''), (g.waitSeconds || 8) * 1000);
  });
  kit.guided.observe = text => observe(text);
  function observe(text) {
    if (phase !== 'running' || observed) return;
    observed = true; phase = 'explain';
    clearTimeout(waitTimer);
    const right = prediction === g.correctPrediction;
    status.innerHTML = text ? `<b>Observed:</b> ${text}` : '';
    result.innerHTML = right ? '✓ Your prediction matched what happened.' : `✗ Not quite. The expected outcome was: <i>${g.predictions[g.correctPrediction]}</i>`;
    result.className = 'guided-result ' + (right ? 'tone-good' : 'tone-bad');
    explain.hidden = false;
  }
  explain.addEventListener('submit', e => {
    e.preventDefault();
    const v = Number(new FormData(explain).get(`${name}-e`));
    if (v === g.correctExplanation) {
      feedback.innerHTML = `✓ Correct. ${g.why || ''}`;
      feedback.className = 'guided-feedback tone-good';
      phase = 'complete';
      if (next) next.hidden = false;
    } else {
      feedback.innerHTML = `✗ Not this one. ${g.retryHint || 'Look again at the event log.'}`;
      feedback.className = 'guided-feedback tone-bad';
    }
  });
  retry.onclick = reset;
  let applying = false;
  panel.onUserChange(() => { if (!applying && phase === 'running') reset(); });
  function reset() {
    phase = 'predict'; prediction = null; observed = false; clearTimeout(waitTimer);
    form.reset(); explain.reset(); explain.hidden = true; predictSet.disabled = false; runBtn.disabled = true;
    status.textContent = ''; feedback.textContent = ''; if (next) next.hidden = true;
  }
  kit.onCleanup(() => clearTimeout(waitTimer));
}

// ---------- notes ----------
function notesSection(topic) {
  const ta = h('textarea.input', { placeholder: 'What surprised you? What would you say in an interview?', 'aria-label': 'My notes' });
  ta.value = progress.getNote(topic.slug);
  const saved = h('span.faint');
  const btn = h('button.btn.sm', { type: 'button', onclick: () => { progress.setNote(topic.slug, ta.value.trim()); saved.textContent = 'Saved on this device'; setTimeout(() => (saved.textContent = ''), 2000); } }, 'Save');
  return h('section.card.notes-card', h('h3', 'My notes'), ta, h('div.notes-actions', btn, saved));
}

// ---------- quiz ----------
function quizSection(topic, quiz) {
  const form = h('form.quiz');
  const results = h('p.quiz-score', { role: 'status', 'aria-live': 'polite' });
  quiz.forEach((q, i) => {
    form.append(h('fieldset.quiz-q', { dataset: { i } },
      h('legend', h('span.quiz-n', String(i + 1)), h('span', { html: q.q })),
      q.o.map((opt, j) => h('label', h('input', { type: 'radio', name: `q${i}`, value: j }), h('span', { html: opt }))),
      h('p.quiz-why', { hidden: true })));
  });
  const check = h('button.btn.primary', { type: 'submit' }, 'Check answers');
  const again = h('button.btn.ghost', { type: 'button', hidden: true }, 'Try again');
  form.append(h('div.quiz-actions', check, again, results));
  form.addEventListener('submit', e => {
    e.preventDefault();
    let score = 0;
    quiz.forEach((q, i) => {
      const fs = form.querySelector(`fieldset[data-i="${i}"]`);
      const sel = form.querySelector(`input[name="q${i}"]:checked`);
      const v = sel ? Number(sel.value) : -1;
      const ok = v === q.a;
      if (ok) score++;
      fs.classList.toggle('right', ok);
      fs.classList.toggle('wrong', !ok);
      const why = fs.querySelector('.quiz-why');
      why.hidden = false;
      why.innerHTML = `${ok ? '✓ Right.' : `✗ ${v < 0 ? 'Not answered.' : 'Not quite.'} Answer: <b>${q.o[q.a]}</b>.`} ${q.why || ''}`;
      fs.disabled = true;
    });
    progress.recordQuiz(topic.slug, score, quiz.length);
    results.textContent = score === quiz.length ? `All ${score} right. Topic marked as done.` : `${score} of ${quiz.length} right.`;
    check.hidden = true; again.hidden = false;
  });
  again.onclick = () => {
    form.reset();
    for (const fs of form.querySelectorAll('fieldset')) { fs.disabled = false; fs.classList.remove('right', 'wrong'); fs.querySelector('.quiz-why').hidden = true; }
    results.textContent = ''; check.hidden = false; again.hidden = true;
  };
  return h('section.card.quiz-card', h('h3', 'Check yourself'), form);
}
