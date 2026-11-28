// CI/CD pipeline: commits queue for runners and pass seven stages on their way to production.
// Model (time in minutes, 2 simulated minutes per second): the team pushes `rate` commits an hour.
// Stages: lint 1, unit tests 4, build image 6 (2 with the dependency cache), integration 8, staging
// deploy 2, end-to-end 10 (optional), prod deploy 3 — 34 minutes in a row. "Parallel" runs lint, unit
// tests and build side by side. A free runner takes the next commit from the queue. 20% of commits
// carry a bug: half are caught by unit tests, a quarter by integration, 15% by end-to-end, and 10% are
// not covered by any test. A bug whose stage is skipped (end-to-end off) reaches users.

import { fixedStep, fit, fitText, tile, unpause } from './_c-util.js';

const STAGES = [
  { id: 'lint', label: 'Lint', mins: 1, early: true },
  { id: 'unit', label: 'Unit tests', mins: 4, early: true },
  { id: 'build', label: 'Build image', mins: 6, cached: 2, early: true },
  { id: 'integ', label: 'Integration', mins: 8 },
  { id: 'stage', label: 'Staging deploy', mins: 2 },
  { id: 'e2e', label: 'End-to-end', mins: 10, optional: true },
  { id: 'prod', label: 'Prod deploy', mins: 3 },
];
const CATCH = [['unit', 0.5], ['integ', 0.25], ['e2e', 0.15], [null, 0.1]];
const BUG_RATE = 0.2;
const SPEED = 2; // simulated minutes per simulated second
const label = id => STAGES.find(x => x.id === id)?.label ?? id;

function makePipeline(o) {
  const P = { ...o, now: 0, acc: 0, seq: 0, queue: [], running: [], done: [], shipped: 0, caught: { unit: 0, integ: 0, e2e: 0 }, escaped: 0, leadSum: 0, finished: [] };
  const mins = x => (x.id === 'build' && P.cache ? x.cached : x.mins);
  P.plan = () => {
    const list = STAGES.filter(x => P.e2e || !x.optional);
    let t = 0;
    const out = [];
    if (P.parallel) {
      const early = list.filter(x => x.early);
      early.forEach(x => out.push({ ...x, from: 0, to: mins(x) }));
      t = Math.max(...early.map(mins));
    }
    for (const x of list) { if (P.parallel && x.early) continue; out.push({ ...x, from: t, to: t + mins(x) }); t += mins(x); }
    return out;
  };
  P.runTime = () => Math.max(...P.plan().map(x => x.to));
  P.push = (bug = Math.random() < BUG_RATE) => {
    let catchAt = null;
    if (bug) {
      let r = Math.random();
      for (const [id, share] of CATCH) { if (r < share) { catchAt = id; break; } r -= share; }
    }
    const c = { id: ++P.seq, at: P.now, bug, catchAt };
    P.queue.push(c);
    return c;
  };
  function start() {
    while (P.queue.length && P.running.length < P.runners) {
      const c = P.queue.shift();
      const plan = P.plan();
      const hit = c.catchAt && plan.find(x => x.id === c.catchAt);
      P.running.push({ c, start: P.now, plan, end: hit ? hit.to : Math.max(...plan.map(x => x.to)), fail: hit ? hit.id : null, parallel: P.parallel });
    }
  }
  function finish() {
    for (const r of P.running.filter(x => P.now >= x.start + x.end)) {
      P.running.splice(P.running.indexOf(r), 1);
      const c = r.c;
      let rec;
      if (r.fail) { P.caught[r.fail]++; rec = { ...c, result: 'caught', stage: r.fail, t: P.now }; }
      else { P.shipped++; P.leadSum += P.now - c.at; if (c.bug) P.escaped++; rec = { ...c, result: c.bug ? 'escaped' : 'shipped', t: P.now }; }
      P.done.push(rec); P.finished.push(rec);
      if (P.done.length > 40) P.done.shift();
    }
  }
  P.leadTime = () => (P.shipped ? P.leadSum / P.shipped : 0);
  P.tick = dt => {
    P.now += dt;
    P.acc += dt * P.rate / 60;
    while (P.acc >= 1) { P.acc -= 1; P.push(); }
    finish(); start();
  };
  return P;
}

export default {
  lead: 'Every commit goes through the same line of steps: lint, unit tests, build an image, integration tests, a staging deploy, end-to-end tests, then production. Roughly one commit in five has a bug, and each test stage catches some of them. Add runners, run the early stages side by side, cache dependencies or skip the slow tests, and watch lead time, the queue and the bugs that slip through to users.',
  emptyLog: 'Nothing yet. Commits are on their way.',
  tryThis: [
    'Set the team to 8 pushes an hour with 1 runner. One run lasts 34 minutes, so the queue grows without end and lead time keeps climbing.',
    'Switch on parallel stages and the cache. Each run gets shorter, so the same runners keep up with more commits.',
    'Switch off end-to-end tests. Pipelines finish much sooner, but the bugs only end-to-end tests would catch now reach users.',
    'Press <b>Push a buggy commit</b> and follow it. Most bugs fail fast in unit tests, which is why the cheap checks come first.',
  ],
  inShort: {
    what: 'A CI/CD pipeline runs every commit through the same automatic checks (lint, tests, build, deploy) so that only tested code reaches production.',
    why: 'Hand-made releases are slow and skip steps. A pipeline makes each release repeatable, and cheap tests run first so most bugs fail within minutes.',
    tradeoff: 'More test stages catch more bugs but lengthen lead time; extra runners, parallel stages and caches buy the speed back with compute.',
    interview: 'Trunk-based development with a pipeline per commit: lint and unit tests in parallel, a cached image build, integration and end-to-end tests on staging, then an automated canary to production.',
  },
  quiz: [
    { q: 'Why do pipelines run lint and unit tests before the slow end-to-end tests?', o: ['Alphabetical order', 'They are cheap and catch most bugs, so bad commits fail within minutes', 'End-to-end tests need lint output', 'Git requires it'], a: 1,
      why: 'Fail fast: the earliest, cheapest stage able to catch a bug should do so, so the expensive stages run less often.' },
    { q: 'Commits arrive faster than one runner can finish pipelines. What happens to lead time?', o: ['It stays the same', 'It keeps rising, because a queue builds up', 'It drops', 'Commits are skipped'], a: 1,
      why: 'Whenever arrivals outpace throughput, the queue grows without limit. Add runners or make each run shorter.' },
    { q: 'You drop the end-to-end stage to ship faster. What does it cost?', o: ['Nothing', 'Bugs that only end-to-end tests catch now reach users', 'Builds get bigger', 'The cache stops working'], a: 1,
      why: 'Each check you remove is a class of bug you will now find in production, which is why teams that trim tests add canaries and monitoring.' },
  ],
  guided: {
    intro: 'Push commits faster than a single runner can finish them, and watch the queue.',
    example: '“Run the guided example” sets 8 pushes an hour, 1 runner, no parallel stages, no cache, end-to-end tests on, and starts over.',
    question: 'What happens to the commits waiting for the runner?',
    predictions: ['The queue keeps growing, so every new commit waits longer.', 'The queue stays empty, because commits are processed as they arrive.', 'Extra commits are dropped.'],
    correctPrediction: 0,
    running: 'Watch the queue dots on the left and the “Commits waiting” number. One run takes 34 minutes; a new commit arrives every 7.5.',
    observation: 'Commits arrived every 7.5 minutes while each run took 34, so the single runner fell behind and the queue kept growing.',
    explainQuestion: 'Why does the queue grow?',
    explanations: ['Arrivals (8 per hour) exceed what one runner can finish (60 ÷ 34 ≈ 1.8 per hour), so the backlog grows without limit.', 'The runner crashes after each commit.', 'Lint rejects every commit.'],
    correctExplanation: 0,
    why: 'When arrivals beat throughput, waiting time grows without bound. More runners, parallel stages and caching raise throughput.',
    retryHint: 'Compare the hint under the toggles (commits an hour the runners can finish) with the push rate.',
    nextSlug: 'docker-image-layers',
    nextLabel: 'Next experiment: Docker layers →',
    waitSeconds: 22,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { rate: 4, runners: 2, parallel: false, cache: false, e2e: true };
    const clock = fixedStep();
    let P, lastQ = 0;
    const stamp = t => `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(Math.floor(t % 60)).padStart(2, '0')}`;
    const log = (t, msg) => kit.log(`<span class="faint">[${stamp(t)}]</span> ${msg}`);

    kit.metrics([
      { key: 'lead', label: 'Lead time (commit → prod)' }, { key: 'queue', label: 'Commits waiting' },
      { key: 'caught', label: 'Bugs caught' }, { key: 'esc', label: 'Bugs reached users' },
    ]);
    const p = kit.panel;
    p.buttons([
      { label: 'Push a buggy commit', kind: 'primary', onClick: pushBug },
      { label: 'Start over', kind: 'outline', onClick: () => { reset(); } },
    ]);
    const rate = p.slider('Team pushes', { min: 1, max: 12, step: 1, value: 4, format: v => `${v} / h`, hint: 'Commits per hour from the whole team.', onInput: v => { s.rate = v; sync(); } });
    const runners = p.slider('Runners', { min: 1, max: 6, step: 1, value: 2, format: v => String(v), hint: 'Pipelines that can run at the same time.', onInput: v => { s.runners = v; sync(); } });
    const par = p.toggle('Run lint, unit tests and build in parallel', { value: false, onChange: v => { s.parallel = v; sync(); } });
    const cache = p.toggle('Cache dependencies (build 6 → 2 min)', { value: false, onChange: v => { s.cache = v; sync(); } });
    const e2e = p.toggle('Run end-to-end tests (10 min)', { value: true, onChange: v => { s.e2e = v; sync(); } });
    const timeNote = p.note('');

    function reset() {
      P = makePipeline({ ...s });
      lastQ = 0;
      clock.reset();
      kit.resetTime();
      kit.clearLog();
      sync();
      paint();
    }
    function sync() {
      Object.assign(P, s);
      const rt = P.runTime();
      timeNote.set(`One run now takes ${rt} min, so ${s.runners} runner${s.runners > 1 ? 's' : ''} can finish about ${(s.runners * 60 / rt).toFixed(1)} commits an hour.`);
    }
    function pushBug() {
      const c = P.push(true);
      log(P.now, `Commit #${c.id} pushed with a bug${c.catchAt ? ` that ${label(c.catchAt)} will catch` : ' that no test covers'}.`);
    }

    function step(dt) {
      P.tick(dt * SPEED);
      for (const r of P.finished.splice(0)) {
        if (r.result === 'caught') log(r.t, `Commit #${r.id}: bug caught by ${label(r.stage)} and sent back to its author.`);
        else if (r.result === 'escaped') log(r.t, `Commit #${r.id} shipped with a bug no stage tested for. Users ran into it.`);
        else if (r.id % 3 === 0) log(r.t, `Commit #${r.id} is live, ${Math.round(r.t - r.at)} min after it was pushed.`);
      }
      if (P.queue.length >= 8 && lastQ < 8) log(P.now, `${P.queue.length} commits are waiting for a runner: pushes arrive faster than pipelines finish.`);
      if (P.queue.length >= 3 && lastQ < 3) kit.guided.observe(`${P.queue.length} commits are already waiting: one run takes ${P.runTime()} min but a commit arrives every ${(60 / s.rate).toFixed(1)} min, so the queue only grows.`);
      lastQ = P.queue.length;
    }

    function paint() {
      const lead = P.leadTime(), caught = P.caught.unit + P.caught.integ + P.caught.e2e;
      kit.metric('lead', P.shipped ? Math.round(lead) + ' min' : '–', lead > 90 ? 'bad' : lead > 45 ? 'warn' : 'good');
      kit.metric('queue', String(P.queue.length), P.queue.length > 5 ? 'bad' : P.queue.length ? 'warn' : 'good');
      kit.metric('caught', String(caught));
      kit.metric('esc', String(P.escaped), P.escaped ? 'bad' : 'good');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, w = stage.w, h = stage.h, ctx = stage.ctx;
      const pad = 14, qw = 70, x0 = pad + qw + 10, x1 = w - pad;
      const plan = P.plan(), rt = P.runTime();
      const X = m => x0 + (x1 - x0) * m / Math.max(rt, 34);
      const lanes = Math.max(P.runners, P.running.length, 1);
      const lh = Math.max(8, Math.min(40, (h * 0.62 - 40) / lanes - 6));
      const top = 40;
      stage.text('queue', pad, top - 6, { size: 10, color: c.muted, baseline: 'bottom' });
      fitText(stage, `runners · one run = ${rt} min`, x0, top - 6, x1 - x0 - 120, { size: 10, color: c.muted, baseline: 'bottom' });
      stage.text(`${stamp(P.now)} into the workday`, x1, top - 6, { size: 10, color: c.ink, align: 'right', baseline: 'bottom' });
      P.queue.slice(0, 24).forEach((q, i) => stage.dot(pad + 8 + (i % 4) * 16, top + 8 + Math.floor(i / 4) * 16, 5, q.bug ? c.signal : c.wire, 0.85));
      if (P.queue.length > 24) stage.text('+' + (P.queue.length - 24), pad, top + 100, { size: 10, color: c.bad, baseline: 'top' });
      const earlyIds = STAGES.filter(x => x.early).map(x => x.id);
      for (let i = 0; i < lanes; i++) {
        const y = top + i * (lh + 6), run = P.running[i];
        for (const sg of run ? run.plan : plan) {
          const side = (run ? run.parallel : P.parallel) && sg.early;
          const idx = side ? earlyIds.indexOf(sg.id) : 0;
          const sh = side ? (lh - 4) / 3 : lh, sy = y + (side ? idx * (sh + 2) : 0);
          let fill = c.surface, a = 1;
          if (run) {
            const el = P.now - run.start;
            if (run.fail === sg.id && el >= sg.to - 1e-6) { fill = c.bad; a = 0.45; }
            else if (el >= sg.to) { fill = c.ok; a = 0.35; }
            else if (el > sg.from) { fill = c.signal; a = 0.35; }
          }
          const sw = X(sg.to) - X(sg.from) - 2;
          tile(stage, X(sg.from) + 1, sy, sw, sh, { fill, fillAlpha: a, stroke: c.line });
          if (sw > 20 && sh >= 12) { ctx.font = `500 9px ${stage.font}`; stage.text(fit(ctx, sg.label, sw - 4), X(sg.from) + 1 + sw / 2, sy + sh / 2, { size: 9, color: c.ink, align: 'center' }); }
        }
        if (run) {
          const k = Math.min(P.now - run.start, run.end);
          stage.line(X(k), y - 2, X(k), y + lh + 2, { color: run.c.bug ? c.bad : c.ink, width: 2 });
          stage.text('#' + run.c.id, x0 - 4, y + lh / 2, { size: 9, color: c.muted, align: 'right' });
        }
      }
      const ry = top + lanes * (lh + 6) + 22, cw = (w - 2 * pad) / 30;
      fitText(stage, 'latest results: green shipped · amber caught by a test · red bug reached users', pad, ry, w - 2 * pad, { size: 10, color: c.muted, baseline: 'bottom' });
      P.done.slice(-30).forEach((d, i) => tile(stage, pad + i * cw, ry + 6, cw - 3, 16, { fill: d.result === 'shipped' ? c.ok : d.result === 'caught' ? c.signal : c.bad, fillAlpha: 0.6, r: 3 }));
    }

    kit.loop(dt => { clock.run(dt, step); paint(); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        rate.set(8, true); s.rate = 8;
        runners.set(1, true); s.runners = 1;
        par.set(false, true); s.parallel = false;
        cache.set(false, true); s.cache = false;
        e2e.set(true, true); s.e2e = true;
        reset();
        unpause();
      },
    };
  },
};
