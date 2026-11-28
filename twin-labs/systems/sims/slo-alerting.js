// SLOs and alerting: a 99.9% objective over 30 days, an error budget and two kinds of alert rules.
// Model (one step = one simulated minute; 5 or 20 minutes per second): background errors are
// 0.03% × (0.5–1.5). Incidents add errors: short blip 10% for 4 min, outage 100% for 20 min, slow leak
// 0.8% for 12 h, bad release 4% for 3 h. Budget spent per minute = error rate ÷ (0.1% × 43,200 min).
// Static rule: page when the 5-minute average error rate is above 1%. Burn-rate rule (SRE workbook):
// burn = error rate ÷ 0.1%; page when burn > 14.4 over both 1 h and 5 min, or > 6 over both 6 h and
// 30 min. A page counts as "for nothing" when its incident ended having used under 2% of the budget.

import { fitText, tile, unpause } from './_c-util.js';

const SLO = 0.999;
const BUDGET = 1 - SLO;
const MONTH_MIN = 720 * 60;
const INCIDENTS = {
  blip: { label: 'Short blip', rate: 0.1, mins: 4 },
  outage: { label: 'Outage', rate: 1, mins: 20 },
  leak: { label: 'Slow leak', rate: 0.008, mins: 720 },
  bad: { label: 'Bad release', rate: 0.04, mins: 180 },
};
const RULES = {
  static: [{ win: 5, above: 0.01 }],
  burn: [{ long: 60, short: 5, burn: 14.4 }, { long: 360, short: 30, burn: 6 }],
};
const BUDGET_MIN = (BUDGET * MONTH_MIN).toFixed(1);

function makeMonitor({ mode = 'burn', base = 3e-4 } = {}) {
  const M = { mode, base, now: 0, acc: 0, err: Array(720).fill(base), incidents: [], pages: [], paging: false, spent: 0,
    hist: Array.from({ length: 720 }, (_, i) => ({ t: i - 719, err: base, b1: base / BUDGET, b6: base / BUDGET, page: false })) };
  const avg = n => { const a = M.err.slice(-n); return a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0; };
  M.burn = n => avg(n) / BUDGET;
  M.active = () => M.incidents.filter(x => M.now >= x.start && M.now < x.end);
  M.start = kind => { const d = INCIDENTS[kind], inc = { kind, start: M.now, end: M.now + d.mins, rate: d.rate, spent: 0, pagedAt: null }; M.incidents.push(inc); return inc; };
  M.rate = () => Math.min(1, M.base * (0.5 + Math.random()) + M.active().reduce((a, x) => a + x.rate, 0));
  M.budgetLeft = () => Math.max(0, 1 - M.spent);
  M.firing = () => M.mode === 'static' ? RULES.static.some(r => avg(r.win) > r.above) : RULES.burn.some(r => M.burn(r.long) > r.burn && M.burn(r.short) > r.burn);
  M.minute = () => {
    const act = M.active(), r = M.rate();
    M.now++;
    M.err.push(r);
    if (M.err.length > 2000) M.err.shift();
    const used = r / (BUDGET * MONTH_MIN);
    M.spent += used;
    act.forEach(x => { x.spent += used; });
    const fire = M.firing();
    if (fire && !M.paging) {
      const inc = act.slice(-1)[0] || M.incidents.slice(-1)[0] || null;
      M.pages.push({ t: M.now, cause: inc ? inc.kind : null, inc });
      if (inc && inc.pagedAt == null) inc.pagedAt = M.now;
    }
    M.paging = fire;
    M.hist.push({ t: M.now, err: r, b1: M.burn(60), b6: M.burn(360), page: fire });
    if (M.hist.length > 720) M.hist.shift();
  };
  M.tick = mins => { M.acc += mins; let g = 0; while (M.acc >= 1 && g++ < 200) { M.acc -= 1; M.minute(); } };
  M.noisePages = () => M.pages.filter(pg => {
    const inc = M.incidents.find(x => x.kind === pg.cause && x.start <= pg.t);
    return !inc || (M.now >= inc.end && inc.spent < 0.02);
  }).length;
  return M;
}
const dur = m => m >= 60 ? `${Math.floor(m / 60)} h ${String(Math.round(m % 60)).padStart(2, '0')} min` : `${Math.round(m)} min`;
const clockText = t => `day ${Math.floor(t / 1440) + 1}, ${String(Math.floor((t % 1440) / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;

export default {
  lead: `The service promises that 99.9% of requests succeed over 30 days. The 0.1% it is allowed to fail is the <b>error budget</b>: roughly ${BUDGET_MIN} minutes of complete outage a month. Start incidents and see who gets woken up. A plain “errors above 1%” alert pages for blips that do not matter and sleeps through slow leaks that do. Burn-rate alerts page on how fast the budget is being used up.`,
  emptyLog: 'Nothing yet. Start an incident.',
  tryThis: [
    'With <b>Errors above 1%</b>, start a <b>Short blip</b>. Someone is paged for an error spike that used less than 1% of the monthly budget.',
    'Start a <b>Slow leak</b>. 0.8% errors never reaches 1%, so nobody is paged, yet across 12 hours it eats about 13% of the budget.',
    'Switch to <b>Burn rate</b> and repeat both. The blip is ignored, and the leak pages after a few hours on the 6-hour window.',
    'Start an <b>Outage</b>. Both rules page within minutes, because the budget is burning hundreds of times too fast.',
  ],
  inShort: {
    what: 'An SLO is a reliability target, for example 99.9% of requests succeed over 30 days. What it lets you fail (0.1%) is the error budget.',
    why: 'Alerting on every error spike wakes people for nothing; alerting on budget spend pages only when users are really being hurt.',
    tradeoff: 'Short windows catch outages quickly but are noisy; long windows catch slow leaks but late. Multiwindow burn-rate alerts get both.',
    interview: 'SLIs from the load balancer, a 99.9% SLO, a page on 14.4× burn over 1 h and 5 min or 6× over 6 h and 30 min, and a ticket for slower burns.',
  },
  quiz: [
    { q: 'A 99.9% SLO over 30 days allows roughly how much total outage?', o: ['None', 'About 43 minutes', 'About 7 hours', 'About 3 days'], a: 1,
      why: '0.1% of 43,200 minutes is 43.2 minutes. That is the error budget.' },
    { q: 'The error rate sits at 0.8% for hours, below a 1% static alert. Why is that a problem?', o: ['It is not', 'It burns the budget 8 times too fast and nobody is paged', 'The alert fires too often', 'Errors under 1% do not count'], a: 1,
      why: 'Burn rate = error rate ÷ budget rate. At 8× a month of budget is gone in under 4 days; burn-rate alerts catch it.' },
    { q: 'Why do burn-rate alerts check a long and a short window together?', o: ['To use more memory', 'The long window proves real damage; the short one shows it is still happening, so alerts stop soon after a fix', 'For nicer charts', 'Short windows are cheaper'], a: 1,
      why: 'That is the multiwindow, multi-burn-rate pattern from the Google SRE workbook: few false pages and a quick reset.' },
  ],
  guided: {
    intro: 'Use the simple “errors above 1%” rule and start a short error blip.',
    example: '“Run the guided example” picks the Errors above 1% rule at 5 minutes per second, starts over and starts a Short blip (10% errors for 4 minutes).',
    question: 'What does the alert do?',
    predictions: ['It pages someone, even though the blip uses well under 1% of the monthly budget.', 'It stays quiet, because the blip is too short to matter.', 'It pages only once the whole budget is gone.'],
    correctPrediction: 0,
    running: 'Watch the error-rate chart against the dashed 1% line, and the “Pages sent” number.',
    observation: 'The 5-minute error average crossed 1% within a minute and the on-call engineer was paged, though the blip barely touched the error budget.',
    explainQuestion: 'Why is this page a problem?',
    explanations: ['A threshold on the raw error rate ignores how much budget is actually spent, so short harmless spikes wake people up.', 'The page arrived too late to help.', 'The SLO was set too high.'],
    correctExplanation: 0,
    why: 'Page on budget burn, not on raw error rate. Burn-rate rules ignore the blip and still catch outages and slow leaks.',
    retryHint: 'Look at how much budget the blip used in its “over” event in the log.',
    nextSlug: 'infrastructure-as-code',
    nextLabel: 'Next experiment: infrastructure as code →',
    waitSeconds: 8,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { mode: 'static', speed: 5 };
    let M, ended;
    const log = (t, msg) => kit.log(`<span class="faint">[${clockText(t)}]</span> ${msg}`);
    const ruleText = () => s.mode === 'static'
      ? `Page when the error rate averaged over ${RULES.static[0].win} min is above ${RULES.static[0].above * 100}%.`
      : `Burn rate = error rate ÷ ${BUDGET * 100}%. Page when it is above ${RULES.burn[0].burn}× over both 1 h and 5 min (2% of the budget in an hour), or above ${RULES.burn[1].burn}× over both 6 h and 30 min (5% in 6 hours).`;

    kit.metrics([
      { key: 'left', label: 'Error budget left' }, { key: 'pages', label: 'Pages sent' },
      { key: 'noise', label: 'Pages for nothing' }, { key: 'detect', label: 'Time to page (last)' },
    ]);
    const p = kit.panel;
    p.buttons(Object.entries(INCIDENTS).map(([k, d]) => ({ label: d.label, kind: k === 'blip' ? 'primary' : 'outline', onClick: () => startIncident(k) })));
    p.note(Object.values(INCIDENTS).map(d => `${d.label}: ${d.rate * 100}% errors for ${d.mins >= 60 ? d.mins / 60 + ' h' : d.mins + ' min'}`).join(' · '));
    const mode = p.seg('Alert rule', { options: [['static', 'Errors above 1% (5 min)'], ['burn', 'Burn rate (SRE workbook)']], value: 'static', onChange: v => { s.mode = v; reset(); } });
    const rule = p.note('');
    const speed = p.seg('Clock speed', { options: [['5', '5 min / s'], ['20', '20 min / s']], value: '5', onChange: v => { s.speed = +v; } });
    p.buttons([{ label: 'Start over', kind: 'outline', onClick: () => reset() }]);

    function reset() {
      M = makeMonitor({ mode: s.mode });
      ended = new Set();
      rule.set(ruleText());
      kit.resetTime();
      kit.clearLog();
      paint();
    }
    function startIncident(k) {
      const inc = M.start(k);
      log(inc.start, `${INCIDENTS[k].label} started: ${inc.rate * 100}% of requests fail.`);
    }
    function step(dt) {
      const before = M.pages.length;
      M.tick(dt * s.speed);
      for (const pg of M.pages.slice(before)) {
        const inc = pg.inc && pg.inc.pagedAt === pg.t ? pg.inc : null;
        log(pg.t, `Paged the on-call engineer: ${pg.cause ? INCIDENTS[pg.cause].label : 'background errors'}${inc ? ` after ${dur(pg.t - inc.start)}` : ''}.`);
        if (inc) kit.guided.observe(`The ${s.mode === 'static' ? '1% threshold' : 'burn-rate'} rule paged ${dur(pg.t - inc.start)} after the ${INCIDENTS[inc.kind].label.toLowerCase()} started; so far it had used only ${(inc.spent * 100).toFixed(2)}% of the monthly budget.`);
      }
      M.incidents.forEach((inc, i) => {
        if (M.now >= inc.end && !ended.has(i)) {
          ended.add(i);
          log(inc.end, `${INCIDENTS[inc.kind].label} over: used ${(inc.spent * 100).toFixed(1)}% of the monthly budget${inc.pagedAt == null ? ', and nobody was paged' : ''}.`);
        }
      });
    }
    function paint() {
      const left = M.budgetLeft(), last = M.incidents.filter(x => x.pagedAt != null).slice(-1)[0], noise = M.noisePages();
      kit.metric('left', (left * 100).toFixed(1) + '%', left < 0.5 ? 'bad' : left < 0.8 ? 'warn' : 'good');
      kit.metric('pages', String(M.pages.length));
      kit.metric('noise', String(noise), noise ? 'bad' : 'good');
      kit.metric('detect', last ? dur(last.pagedAt - last.start) : '–');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, w = stage.w, h = stage.h, pad = 14, span = 720, H = M.hist;
      const panel = (top, bottom, title, series, refs, refLabel, cap) => {
        fitText(stage, title, pad, top - 3, w - 2 * pad - 90, { size: 10, color: c.muted, baseline: 'bottom' });
        const X = t => w - pad - (w - 2 * pad) * (M.now - t) / span;
        const Y = v => bottom - (bottom - top) * Math.min(v, cap) / cap;
        stage.line(pad, bottom + 0.5, w - pad, bottom + 0.5, { color: c.line, width: 1 });
        for (const inc of M.incidents) {
          const a = Math.max(X(inc.start), pad), b = Math.min(X(Math.min(inc.end, M.now)), w - pad);
          if (b > a) tile(stage, a, top, b - a, bottom - top, { fill: c.signal, fillAlpha: 0.1, r: 0 });
        }
        for (const x of H) if (x.page) tile(stage, X(x.t) - 1, top, 2, bottom - top, { fill: c.bad, fillAlpha: 0.18, r: 0 });
        for (const r of [].concat(refs)) {
          const y = Y(r);
          stage.line(pad, y, w - pad, y, { color: c.muted, width: 1, dash: [4, 4] });
          stage.text(typeof refLabel === 'function' ? refLabel(r) : refLabel, w - pad, y - 2, { size: 10, color: c.muted, align: 'right', baseline: 'bottom' });
        }
        if (H.length >= 2) for (const [k, col] of series) stage.path(H.map(x => [X(x.t), Y(x[k])]), { color: col, width: 1.8 });
      };
      const t1 = 24, mid = Math.round(h * 0.42), low = Math.round(h * 0.78);
      panel(t1, mid - 18, 'error rate · last 12 h', [['err', c.bad]], s.mode === 'static' ? RULES.static[0].above : [], '1% alert line', 0.05);
      panel(mid + 4, low - 16, 'burn rate over 1 h and 6 h · 1× spends the budget in exactly 30 days', [['b1', c.wire], ['b6', c.pink]], s.mode === 'burn' ? [RULES.burn[0].burn, RULES.burn[1].burn] : [1], r => r + '×', 20);
      const by = low + 8, bw = w - 2 * pad, left = M.budgetLeft();
      fitText(stage, `monthly error budget: ${(left * 100).toFixed(1)}% left of ${BUDGET_MIN} min of full outage`, pad, by + 2, bw, { size: 10, color: c.muted, baseline: 'bottom' });
      tile(stage, pad, by + 6, bw, 14, { fill: c.surface, stroke: c.line, r: 7 });
      tile(stage, pad, by + 6, Math.max(0, bw * left), 14, { fill: left < 0.5 ? c.bad : left < 0.8 ? c.signal : c.ok, fillAlpha: 0.6, r: 7 });
      stage.text(clockText(M.now), w - pad, t1 - 3, { size: 10, color: c.ink, align: 'right', baseline: 'bottom' });
    }

    kit.loop(dt => { step(dt); paint(); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        mode.set('static', true); speed.set('5', true);
        Object.assign(s, { mode: 'static', speed: 5 });
        reset();
        unpause();
        setTimeout(() => startIncident('blip'), 500);
      },
    };
  },
};
