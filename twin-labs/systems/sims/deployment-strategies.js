// Deployment strategies: replace 10 servers running v1 with v2 by rolling, blue-green or canary.
// Model: 40 requests per second; each server serves its share up to the point where 7 servers carry
// the whole load (a version with fewer ready servers than its traffic share needs drops the excess).
// New servers take 4 s to boot. Rolling: remove `batch` v1 servers, boot as many v2, repeat.
// Blue-green: boot 10 v2 servers beside v1, switch 100% of traffic once all are ready, keep v1 for
// 8 s, then remove it. Canary: shift 10% → 50% → 100% of traffic, booting just enough v2 servers for
// each step, and waiting 8 s at each. A buggy v2 fails 5% or 30% of the requests it serves. The health
// gate looks at v2's requests over the last 5 s (once v2 has served for 5 s and at least 15 requests)
// and rolls back when more than 5% failed.

import { fixedStep, failMark, tile, fitText, unpause } from './_c-util.js';

const N = 10;
const NEED = 7;
const STEPS = [0.1, 0.5, 1];
const GATE = { window: 5, min: 15, max: 0.05 };
const NAMES = { rolling: 'Rolling', bluegreen: 'Blue-green', canary: 'Canary' };

function makeDeploy({ strategy = 'rolling', bug = 0, batch = 2, boot = 4, bake = 8, gate = true, rate = 40 } = {}) {
  const D = { strategy, bug, batch, boot, bake, gate, rate, now: 0, acc: 0, phase: 'idle', servers: [], weight: 0, target: 0, stepIdx: 0, stepAt: 0, tStart: null, tEnd: null, tSwitch: null, tRollback: null, tV2: null, peak: N, ok: 0, bugFail: 0, overload: 0, v2win: [], hist: [], sec: { ok: 0, bug: 0, over: 0, t: 0 } };
  for (let i = 0; i < N; i++) D.servers.push({ ver: 1, ready: 0 });
  const up = v => D.servers.filter(x => x.ver === v && x.ready <= D.now).length;
  const count = v => D.servers.filter(x => x.ver === v).length;
  const booting = v => D.servers.some(x => x.ver === v && x.ready > D.now);
  const add = (v, n) => { for (let i = 0; i < n; i++) D.servers.push({ ver: v, ready: D.now + D.boot }); };
  const remove = (v, n) => {
    const out = D.servers.filter(x => x.ver === v).sort((a, b) => b.ready - a.ready).slice(0, n);
    D.servers = D.servers.filter(x => !out.includes(x));
  };
  D.up = up; D.count = count;
  D.running = () => D.phase === 'deploying' || D.phase === 'rollback';
  D.duration = () => (D.tStart == null ? 0 : (D.tEnd ?? D.now) - D.tStart);
  D.share = () => {
    const a = up(1), b = up(2);
    if (D.strategy === 'rolling') return a + b ? b / (a + b) : 0;
    return b ? (a ? D.weight : 1) : 0;
  };
  D.gateIn = () => (D.tV2 == null ? null : Math.max(0, D.tV2 + GATE.window - D.now));
  D.v2Errors = () => (D.v2win.length ? D.v2win.filter(x => x.fail).length / D.v2win.length : 0);
  function swapBatch(from, to) { // returns true when nothing of `from` is left
    if (booting(to)) return false;
    const left = count(from);
    if (!left) return true;
    const k = Math.min(D.batch, left);
    remove(from, k); add(to, k);
    return false;
  }
  function canaryTo(w) { D.target = w; const more = Math.ceil(N * w) - count(2); if (more > 0) add(2, more); }
  const finish = ph => { D.phase = ph; D.tEnd = D.now; };
  D.start = () => {
    if (D.running() || count(2) === N) return false;
    D.phase = 'deploying'; D.tStart = D.now; D.tEnd = D.tSwitch = D.tRollback = D.tV2 = null; D.v2win = []; D.weight = 0; D.stepIdx = 0;
    if (D.strategy === 'rolling') swapBatch(1, 2);
    else if (D.strategy === 'bluegreen') add(2, N);
    else canaryTo(STEPS[0]);
    return true;
  };
  D.rollback = () => {
    if (D.phase !== 'deploying' && D.phase !== 'done') return false;
    D.phase = 'rollback'; D.tRollback = D.now; D.tEnd = null;
    if (D.strategy === 'rolling') { swapBatch(2, 1); return true; }
    D.weight = 0; D.target = 0; remove(2, count(2));
    const missing = N - count(1);
    if (missing > 0) add(1, missing);
    return true;
  };
  function advance() {
    if (D.phase === 'deploying') {
      if (D.strategy === 'rolling') { if (swapBatch(1, 2) && !booting(2)) finish('done'); }
      else if (D.strategy === 'bluegreen') {
        if (D.tSwitch == null && up(2) === N) { D.weight = 1; D.tSwitch = D.now; }
        else if (D.tSwitch != null && D.now >= D.tSwitch + D.bake) { remove(1, count(1)); finish('done'); }
      } else {
        if (!booting(2) && D.weight !== D.target) {
          D.weight = D.target;
          remove(1, Math.max(0, count(1) - (N - count(2))));
          D.stepAt = D.now;
          if (D.target >= 1) { finish('done'); return; }
        }
        if (D.weight === D.target && D.now >= D.stepAt + D.bake && D.stepIdx < STEPS.length - 1) { D.stepIdx++; canaryTo(STEPS[D.stepIdx]); }
      }
    } else if (D.phase === 'rollback') {
      if (D.strategy === 'rolling') { if (swapBatch(2, 1) && !booting(1)) finish('rolledback'); }
      else if (!booting(1)) finish('rolledback');
    }
  }
  function request() {
    const a = up(1), b = up(2);
    const v = D.strategy === 'rolling' ? (Math.random() * (a + b) < b ? 2 : 1) : (b && (!a || Math.random() < D.weight) ? 2 : 1);
    const share = v === 2 ? D.share() : 1 - D.share();
    const cap = up(v) / NEED;
    const overP = share > 0 ? Math.max(0, 1 - cap / share) : 0;
    let why = null;
    if (!up(v) || Math.random() < overP) why = 'over';
    else if (v === 2 && Math.random() < D.bug) why = 'bug';
    if (why === 'over') { D.overload++; D.sec.over++; } else if (why === 'bug') { D.bugFail++; D.sec.bug++; } else { D.ok++; D.sec.ok++; }
    if (v === 2 && why !== 'over') D.v2win.push({ t: D.now, fail: why === 'bug' });
    return { v, why };
  }
  D.tick = dt => {
    D.now += dt;
    advance();
    D.acc += D.rate * dt;
    const out = [];
    while (D.acc >= 1) { D.acc -= 1; out.push(request()); }
    D.v2win = D.v2win.filter(x => x.t > D.now - GATE.window);
    if (D.phase === 'deploying' && D.tV2 == null && D.share() > 0) D.tV2 = D.now;
    D.gateTripped = false;
    if (D.gate && D.phase === 'deploying' && D.tV2 != null && D.now >= D.tV2 + GATE.window && D.v2win.length >= GATE.min && D.v2Errors() > GATE.max) { D.gateTripped = true; D.rollback(); }
    D.peak = Math.max(D.peak, D.servers.length);
    if (D.now - D.sec.t >= 1) {
      D.hist.push({ t: D.sec.t, ok: D.sec.ok, bug: D.sec.bug, over: D.sec.over });
      if (D.hist.length > 120) D.hist.shift();
      D.sec = { ok: 0, bug: 0, over: 0, t: D.now };
    }
    return out;
  };
  return D;
}

export default {
  lead: 'Ten servers run version 1, and seven of them are enough for today’s traffic. Ship version 2 in three different ways and see who meets it first. Then give v2 a bug: a rolling deploy hurts users one batch at a time, blue-green hurts everybody at once, and a canary hurts only the few it was tried on before the health gate pulls it back.',
  emptyLog: 'Nothing yet. Press Deploy v2.',
  stageHeight: 480,
  tryThis: [
    `Press <b>Deploy v2</b> with each strategy and no bug. Rolling needs no extra servers, blue-green briefly needs ${N * 2}, and canary moves traffic ${STEPS.map(x => x * 100 + '%').join(' → ')}.`,
    'Set the rolling batch to 4 or 5. Too many servers are out at the same time and requests are dropped.',
    'Pick <b>Fails 30%</b> and deploy with blue-green, then with canary. Compare <b>Users hit by the bug</b> before the gate rolls back.',
    'Switch the health gate off and deploy the buggy v2 as a canary. Nothing stops it, and before long every user meets the bug.',
  ],
  inShort: {
    what: 'A deployment strategy is how a new version replaces the old one: a few servers at a time (rolling), a second fleet switched in one go (blue-green), or a few users first (canary).',
    why: 'Any release can carry a bug. The strategy decides how many users meet it, how much spare capacity you need and how quickly you can undo it.',
    tradeoff: 'Rolling needs no spare servers but dips capacity; blue-green undoes instantly but doubles the servers and exposes everyone; canary limits the harm but is slower.',
    interview: 'CI builds one image; CD ships it as a canary (1%, 10%, 50%, 100%) with automatic checks on errors and latency, rolls back automatically on a regression, and uses blue-green when everything must switch together.',
  },
  quiz: [
    { q: 'A rolling deploy replaces 5 of 10 servers at a time, and 7 are needed for the traffic. What happens?', o: ['Nothing, it is just quicker', 'Requests are dropped while each batch boots, because only 5 servers are serving', 'v2 is skipped', 'The deploy is cancelled'], a: 1,
      why: 'Rolling needs no extra servers, but every server you take out is lost capacity. Keep the batch (max unavailable) below your headroom, or add surge servers.' },
    { q: 'Why is a blue-green rollback so quick?', o: ['Green servers are faster', 'The old fleet is still running, so the router just switches back', 'It skips the health checks', 'It deletes the bug'], a: 1,
      why: 'Blue stays up until you trust green. The cost is running two full fleets for a while.' },
    { q: 'v2 fails 30% of requests. Why does a canary hurt fewer users than blue-green?', o: ['Canaries have fewer bugs', 'Only the small share of traffic on v2 meets the bug while the health gate is still measuring', 'Canaries are slower so fewer requests are sent', 'Blue-green has no health checks'], a: 1,
      why: 'The gate needs a window of data before it can judge v2. With 10% of traffic on v2, only 10% of users are exposed during that window.' },
  ],
  guided: {
    intro: 'Ship a badly broken v2 as a canary with the health gate on.',
    example: '“Run the guided example” chooses Canary, makes v2 fail 30% of its requests, turns the health gate on, starts over and presses Deploy v2.',
    question: 'What happens to the buggy release?',
    predictions: ['A few users on the 10% canary hit the bug, then the gate rolls v2 back.', 'Every user hits the bug before anyone notices.', 'No user ever hits the bug.'],
    correctPrediction: 0,
    running: 'Watch the router bar (v1 vs v2 share), the red dots, and the gate countdown in the status line.',
    observation: 'Only the 10% of traffic sent to the canary met the bug; once the gate had 5 s of data it saw the error rate and rolled back.',
    explainQuestion: 'Why were so few users hurt?',
    explanations: ['Only a small share of traffic reached v2 while the gate gathered enough data to judge it, and then it rolled back automatically.', 'The bug only fails on blue-green deployments.', 'v2 never received any traffic.'],
    correctExplanation: 0,
    why: 'A canary limits the blast radius to its traffic share during the measurement window; the gate turns that measurement into an automatic rollback.',
    retryHint: 'Compare “Users hit by the bug” with the total number of requests in the chart.',
    nextSlug: 'slo-alerting',
    nextLabel: 'Next experiment: SLOs and alerting →',
    waitSeconds: 16,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { strategy: 'rolling', bug: 0, batch: 2, gate: true };
    const clock = fixedStep();
    let D, dots, prev;

    kit.metrics([
      { key: 'bug', label: 'Users hit by the bug' }, { key: 'over', label: 'Dropped (too few servers)' },
      { key: 'peak', label: 'Servers at peak' }, { key: 'time', label: 'Deploy time' },
    ]);
    const p = kit.panel;
    const btns = p.buttons([
      { label: 'Deploy v2', kind: 'primary', onClick: deploy },
      { label: 'Roll back', kind: 'outline', onClick: () => { D.rollback(); paint(); } },
      { label: 'Start over', kind: 'outline', onClick: () => reset() },
    ]).buttons;
    const strat = p.seg('Strategy', { options: [['rolling', 'Rolling'], ['bluegreen', 'Blue-green'], ['canary', 'Canary']], value: 'rolling', onChange: v => { s.strategy = v; reset(); } });
    const bug = p.seg('Version 2 has a bug', { options: [['0', 'No bug'], ['0.05', 'Fails 5%'], ['0.3', 'Fails 30%']], value: '0', onChange: v => { s.bug = +v; D.bug = +v; } });
    const batch = p.slider('Rolling batch size', { min: 1, max: 5, step: 1, value: 2, format: v => v + (v > 1 ? ' servers' : ' server'), hint: `Servers replaced at a time. ${NEED} of ${N} must stay up to carry the traffic.`, onInput: v => { s.batch = v; D.batch = v; } });
    const gate = p.toggle(`Health gate: roll back when v2 errors pass ${GATE.max * 100}%`, { value: true, onChange: v => { s.gate = v; D.gate = v; } });

    function reset() {
      D = makeDeploy({ ...s });
      dots = []; prev = {};
      clock.reset();
      kit.resetTime();
      kit.clearLog();
      paint();
    }
    function deploy() {
      if (D.phase === 'done' || D.phase === 'rolledback') reset();
      D.start();
      paint();
    }
    function events() {
      const now = { phase: D.phase, w: D.weight };
      if (now.phase !== prev.phase) {
        if (now.phase === 'deploying') kit.log(`${NAMES[D.strategy]} deploy of v2 started.`);
        if (now.phase === 'rollback') {
          const gated = D.gate && D.v2Errors() > GATE.max;
          kit.log(gated ? `Health gate: v2 failed ${Math.round(D.v2Errors() * 100)}% of its requests. Rolling back.` : 'Rolling back to v1.');
          if (gated) kit.guided.observe(`The gate judged v2 after ${GATE.window} s of data: ${Math.round(D.v2Errors() * 100)}% of its requests failed, so it rolled back. ${D.bugFail} requests hit the bug${D.strategy === 'canary' ? `, all from the ${Math.round(D.weight * 100) || 10}% of traffic on the canary` : ''}.`);
        }
        if (now.phase === 'done') kit.log(`Done: every user is on v2 after ${D.duration().toFixed(0)} s.`);
        if (now.phase === 'rolledback') kit.log(`Back on v1. ${D.bugFail} requests hit the bug.`);
      } else if (D.strategy === 'bluegreen' && D.tSwitch != null && prev.w === 0 && now.w === 1) {
        kit.log(`Green fleet ready: the router switched 100% of users to v2. Blue is kept for ${D.bake} s.`);
      } else if (D.strategy === 'canary' && now.w !== prev.w && now.w > 0 && now.phase === 'deploying') {
        kit.log(`Canary: ${Math.round(now.w * 100)}% of users are now on v2.`);
      }
      prev = now;
    }
    function step(dt) {
      D.tick(dt).forEach(r => { if (Math.random() < 0.3) dots.push({ ...r, t: 0, x: 0.12 + Math.random() * 0.76, slot: Math.random() }); });
      for (const d of dots) d.t += dt * 1.5;
      dots = dots.filter(d => d.t < 1.4);
      events();
    }
    function paint() {
      kit.metric('bug', String(D.bugFail), D.bugFail ? 'bad' : 'good');
      kit.metric('over', String(D.overload), D.overload ? 'bad' : 'good');
      kit.metric('peak', String(D.peak), D.peak > N ? 'warn' : 'good');
      kit.metric('time', D.tStart == null ? '–' : D.duration().toFixed(0) + ' s' + (D.running() ? '…' : ''));
      btns[0].disabled = D.running() || D.count(2) === N;
      btns[1].disabled = !(D.phase === 'deploying' || D.phase === 'done');
      batch.el.style.display = s.strategy === 'rolling' ? '' : 'none';
    }

    function draw() {
      stage.clear();
      const c = stage.colors, w = stage.w, h = stage.h;
      const narrow = w < 520, g = narrow ? 4 : 6, sw = (w - 28 - g * (N - 1)) / N, sh = narrow ? 30 : 36;
      const y1 = h * 0.36, y2 = y1 + sh + 10, X = i => 14 + i * (sw + g);
      const V1 = c.accent, V2 = c.violet, uy = 20, ry = h * 0.17, rw = Math.min(260, w * 0.5), rx = (w - rw) / 2, rh = 24;
      stage.text('users', w / 2, uy - 10, { size: 10, color: c.muted, align: 'center' });
      for (let i = 0; i < 14; i++) stage.dot(w * (0.15 + 0.7 * i / 13), uy + 3, 3, c.muted, 0.7);
      const share = D.share();
      tile(stage, rx, ry, rw, rh, { fill: c.surface, stroke: c.line, r: 6 });
      tile(stage, rx + 3, ry + 3, (rw - 6) * (1 - share), rh - 6, { fill: V1, fillAlpha: 0.35, r: 4 });
      tile(stage, rx + 3 + (rw - 6) * (1 - share), ry + 3, (rw - 6) * share, rh - 6, { fill: V2, fillAlpha: 0.35, r: 4 });
      fitText(stage, `router · v1 ${Math.round((1 - share) * 100)}% · v2 ${Math.round(share * 100)}%`, w / 2, ry + rh / 2, rw - 8, { size: 10, weight: 600, color: c.ink, align: 'center' });
      const v1 = D.servers.filter(x => x.ver === 1), v2 = D.servers.filter(x => x.ver === 2);
      const two = D.servers.length > N || D.strategy !== 'rolling';
      const placed = two ? [...v1.map((x, i) => ({ s: x, x: X(i), y: y1 })), ...v2.map((x, i) => ({ s: x, x: X(i), y: y2 }))] : [...v2, ...v1].map((x, i) => ({ s: x, x: X(i), y: y1 }));
      for (const d of dots) {
        const ready = placed.filter(q => q.s.ver === d.v && q.s.ready <= D.now);
        const tgt = ready.length ? ready[Math.floor(d.slot * ready.length)] : null;
        const a = { x: w * d.x, y: uy + 6 }, m = { x: w / 2 + (d.x - 0.5) * rw * 0.6, y: ry + rh / 2 };
        const b = tgt ? { x: tgt.x + sw / 2, y: tgt.y + sh / 2 } : { x: m.x, y: ry + rh + 20 };
        const k = Math.min(1, d.t);
        const pt = k < 0.4 ? { x: a.x + (m.x - a.x) * k / 0.4, y: a.y + (m.y - a.y) * k / 0.4 } : { x: m.x + (b.x - m.x) * (k - 0.4) / 0.6, y: m.y + (b.y - m.y) * (k - 0.4) / 0.6 };
        const col = d.why === 'bug' ? c.bad : d.why === 'over' ? c.signal : c.ok;
        if (d.t < 1) stage.dot(pt.x, pt.y, 2.3, d.v === 2 && !d.why ? V2 : col, 0.9);
        else if (d.why) failMark(stage, b, (d.t - 1) / 0.4, col);
      }
      for (const q of placed) {
        const ready = q.s.ready <= D.now, col = q.s.ver === 1 ? V1 : V2;
        tile(stage, q.x, q.y, sw, sh, { fill: col, fillAlpha: ready ? 0.28 : 0.08, stroke: col, width: ready ? 1.6 : 1, dash: ready ? null : [3, 3], r: 5 });
        stage.text('v' + q.s.ver, q.x + sw / 2, q.y + sh * (ready ? 0.5 : 0.38), { size: narrow ? 9 : 10, weight: 700, color: ready ? c.ink : c.muted, align: 'center' });
        if (!ready) stage.text(Math.ceil(q.s.ready - D.now) + 's', q.x + sw / 2, q.y + sh * 0.72, { size: 8, color: c.muted, align: 'center' });
      }
      if (two) {
        stage.text(D.strategy === 'bluegreen' ? 'blue (v1)' : 'v1 servers', 14, y1 - 3, { size: 9, color: c.muted, baseline: 'bottom' });
        stage.text(D.strategy === 'bluegreen' ? 'green (v2)' : 'v2 servers', 14, y2 - 3, { size: 9, color: c.muted, baseline: 'bottom' });
      }
      const serving = D.up(1) + D.up(2), ty = (two ? y2 : y1) + sh + 20;
      fitText(stage, `${serving} of ${N} servers serving · ${NEED} needed` + (serving < NEED ? ' · overloaded!' : ''), 14, ty, w - 28, { size: 10, color: serving < NEED ? c.bad : c.muted, baseline: 'top' });
      let status = D.phase === 'idle' ? 'Everyone is on v1. Pick a strategy and press Deploy v2.' : D.phase === 'done' ? 'Everyone is on v2.' : D.phase === 'rolledback' ? 'Rolled back: everyone is on v1 again.' : '';
      if (D.running()) {
        const gi = D.gateIn();
        status = D.phase === 'rollback' ? 'Rolling back…'
          : D.strategy === 'rolling' ? `Replacing ${D.batch} at a time: ${D.count(2)} of ${N} on v2`
          : D.strategy === 'bluegreen' ? (D.tSwitch == null ? `Booting the green fleet (${D.up(2)} of ${N} ready)…` : `All traffic on green; blue kept ${Math.max(0, D.tSwitch + D.bake - D.now).toFixed(0)} s more for rollback`)
          : `Canary step ${D.stepIdx + 1} of ${STEPS.length}: ${Math.round(D.target * 100)}% of users`;
        if (D.phase === 'deploying' && D.gate && gi != null) status += gi > 0 ? ` · gate judges v2 in ${gi.toFixed(0)} s` : ` · gate: v2 errors ${Math.round(D.v2Errors() * 100)}%`;
      }
      fitText(stage, status, 14, ty + 15, w - 28, { size: 10, color: c.ink, baseline: 'top' });
      const hy = ty + 46, hb = h - 8, x0 = 14, x1 = w - 14;
      if (hb - hy < 24) return;
      const hist = D.hist.slice(-60), bw = (x1 - x0) / 60, k = (hb - hy) / Math.max(1, D.rate * 1.1);
      stage.text('requests per second: ok / bug / dropped', x1, hy - 12, { size: 9, color: c.muted, align: 'right', baseline: 'top' });
      hist.forEach((b, i) => {
        let y = hb;
        for (const [v, col] of [[b.ok, c.ok], [b.bug, c.bad], [b.over, c.signal]]) { const hh = v * k; tile(stage, x0 + i * bw, y - hh, bw - 1, hh, { fill: col, fillAlpha: 0.7, r: 0 }); y -= hh; }
      });
    }

    kit.loop(dt => { clock.run(dt, step); paint(); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        strat.set('canary', true); bug.set('0.3', true); gate.set(true, true);
        Object.assign(s, { strategy: 'canary', bug: 0.3, gate: true });
        reset();
        unpause();
        setTimeout(deploy, 600);
      },
    };
  },
};
