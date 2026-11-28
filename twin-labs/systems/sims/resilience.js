// Resilience: users → your service (timeout, retries, backoff, circuit breaker) → a dependency.
// Model: the dependency can serve 120 calls/s. Its latency is 50 ms when healthy or 900 ms when slow
// (× a random 0.7–1.3), multiplied by 1 + 8 × (load − 1) once calls in the last second exceed 120.
// Above 1.6× capacity it sheds the excess with instant errors. "Erroring" fails 60% of calls; "down"
// never answers. A call slower than the timeout counts as a failure at the timeout.
// A failed call is retried up to `retries` times, after no wait, 100 ms × 2^(n−1) (exponential) or a
// random fraction of that (jitter). The breaker opens when at least 20 calls in the last 2 s include
// 50% failures; it fails calls instantly for 4 s, then half-opens: one trial call at a time, and
// 3 successes in a row close it again (a failed trial reopens it).

import { fixedStep, addLegend, unpause, no3d, clamp, along, pct, fmtMs, p95, cnode } from './_b-kit.js';

const CAP = 120;
const MODE_TEXT = { ok: 'healthy', slow: 'slow (900 ms responses)', err: 'returning errors for 60% of calls', down: 'down: no responses at all' };
const BREAKER = { threshold: 0.5, minCalls: 20, window: 2, openFor: 4, probes: 3 };

function breaker({ threshold, minCalls, window, openFor, probes }) {
  const b = { state: 'closed', log: [], openUntil: 0, probing: 0, okRun: 0 };
  b.trip = t => { b.state = 'open'; b.openUntil = t + openFor; b.log = []; b.probing = 0; b.okRun = 0; };
  b.canPass = t => {
    if (b.state === 'open') { if (t < b.openUntil) return false; b.state = 'half'; b.probing = 0; b.okRun = 0; }
    if (b.state === 'half') { if (b.probing > 0) return false; b.probing++; return true; }
    return true;
  };
  b.record = (t, ok) => {
    if (b.state === 'half') {
      b.probing = Math.max(0, b.probing - 1);
      if (!ok) { b.trip(t); return; }
      if (++b.okRun >= probes) { b.state = 'closed'; b.log = []; }
      return;
    }
    if (b.state !== 'closed') return;
    b.log.push({ t, ok });
    while (b.log.length && b.log[0].t < t - window) b.log.shift();
    const bad = b.log.filter(x => !x.ok).length;
    if (b.log.length >= minCalls && bad / b.log.length >= threshold) b.trip(t);
  };
  return b;
}
const backoff = (kind, attempt, base = 0.1) => (kind === 'none' ? 0 : kind === 'jitter' ? Math.random() * base * 2 ** (attempt - 1) : base * 2 ** (attempt - 1));

export default {
  lead: 'Your service calls a dependency that can slow down or fail. Retries rescue the occasional error, but when the dependency is struggling they multiply its load and can keep it down long after the original problem is gone. A circuit breaker stops the pile-on.',
  emptyLog: 'Nothing yet. Make the dependency slow.',
  stageHeight: 360,
  tryThis: [
    'With 3 retries and no backoff, switch the dependency to <b>Slow</b> for a few seconds, then back to <b>Healthy</b>. It stays overloaded: a <b>retry storm</b>.',
    'Repeat with the <b>circuit breaker</b> on. It opens, the load falls, and half-open trial calls let the dependency recover.',
    'Compare <b>Exponential</b> with <b>Exp. + jitter</b>: jitter spreads the retries out so they do not land in waves.',
    'Set retries to 0 while it is <b>Erroring</b>: users see every error, but you never make things worse.',
  ],
  inShort: {
    what: 'Timeouts, retries with backoff and jitter, and a circuit breaker that stops calling a failing dependency for a while.',
    why: 'A slow dependency can tie up all your threads and bring your own service down with it (a cascading failure).',
    tradeoff: 'Retries add load exactly when the dependency is struggling, so cap them; and a retried request must be safe to repeat (idempotent).',
    interview: 'Short timeouts, at most 2 retries with exponential backoff and jitter, and a circuit breaker that fails fast and serves a fallback.',
  },
  quiz: [
    { q: 'A dependency slows down and every caller immediately retries 3 times. What can happen?', o: ['Load falls', 'A retry storm: the load multiplies and the dependency cannot recover', 'Nothing', 'Requests speed up'], a: 1,
      why: 'Every failed call turns into several calls, pushing a struggling service even further past its capacity.' },
    { q: 'What does an open circuit breaker do?', o: ['Retries faster', 'Fails calls at once without calling the dependency', 'Queues calls forever', 'Restarts the dependency'], a: 1,
      why: 'It gives the dependency room to recover and gives users a quick answer or a fallback instead of a timeout.' },
    { q: 'Why add jitter to exponential backoff?', o: ['To make retries slower on average', 'To spread retries so many clients do not retry in synchronised waves', 'To encrypt requests', 'To skip retries'], a: 1,
      why: 'Without jitter, clients that failed together also retry together, creating load spikes.' },
  ],
  guided: {
    intro: 'Make the dependency slow for four seconds while every request retries three times without waiting, then heal it.',
    example: '“Run the guided example” resets to 80 req/s, a 500 ms timeout, 3 retries, no backoff and no breaker, makes the dependency slow, and switches it back to healthy 4 s later.',
    question: 'What happens after the dependency is healthy again?',
    predictions: ['It stays overloaded, because the retries keep its load above capacity.', 'It recovers at once, because the original problem is gone.', 'The load drops to zero, because users give up.'],
    correctPrediction: 0,
    running: 'Watch “Dependency load” and the calls line in the chart after the log says the dependency is healthy again.',
    observation: 'Even after the dependency was healthy, the retried calls kept it far above its 120 calls/s capacity.',
    explainQuestion: 'Why did the dependency not recover?',
    explanations: ['Overload made its responses slower than the timeout, so calls kept failing and each failure became up to four calls.', 'The dependency was still slow.', 'The circuit breaker was stuck open.'],
    correctExplanation: 0,
    why: 'Retry storms are self-sustaining. Backoff with jitter, a retry budget or a circuit breaker removes the extra load so the dependency can catch up.',
    retryHint: 'Compare “Calls per request” before and after the dependency turned healthy.',
    nextSlug: 'idempotency',
    nextLabel: 'Next experiment: idempotency →',
    waitSeconds: 14,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { mode: 'ok', rps: 80, to: 0.5, retries: 3, bo: 'none', cb: false };
    let st, plan = null;

    kit.metrics([
      { key: 'ok', label: 'Users served' }, { key: 'p95', label: 'User p95' }, { key: 'load', label: 'Dependency load' },
      { key: 'amp', label: 'Calls per request' }, { key: 'cb', label: 'Breaker' },
    ]);
    const chart = kit.chart({ lines: [{ key: 'calls', label: 'Calls to dependency / s', color: 'wire' }, { key: 'cap', label: 'Its capacity', color: 'muted' }], bars: { key: 'fail', label: 'Failed user requests', color: 'bad' }, format: v => `${kit.fmt(Math.round(v))}/s` });
    addLegend(kit, [['ok', 'Success', 'dot'], ['signal', 'Retry', 'dot'], ['bad', 'Error or timeout', 'dot'], ['muted', 'Fast fail (breaker open)', 'dot']]);

    const p = kit.panel;
    const mode = p.seg('Dependency health', { options: [['ok', 'Healthy'], ['slow', 'Slow'], ['err', 'Erroring'], ['down', 'Down']], value: s.mode, onChange: v => setMode(v) });
    const rps = p.slider('User traffic', { min: 20, max: 200, step: 10, value: s.rps, format: v => `${v} req/s`, hint: `The dependency can handle ${CAP} calls/s.`, onInput: v => { s.rps = v; } });
    const to = p.slider('Timeout', { min: 100, max: 3000, step: 100, value: 500, format: v => fmtMs(v), onInput: v => { s.to = v / 1000; } });
    const retries = p.slider('Retries', { min: 0, max: 4, step: 1, value: s.retries, onInput: v => { s.retries = v; } });
    const bo = p.seg('Wait between retries', { options: [['none', 'None'], ['exp', 'Exponential'], ['jitter', 'Exp. + jitter']], value: s.bo, onChange: v => { s.bo = v; } });
    const cb = p.toggle('Circuit breaker', { value: false, onChange: v => {
      s.cb = v; st.brk = breaker(BREAKER); st.lastState = 'closed';
      kit.log(v ? 'Circuit breaker on: it opens when half the calls in 2 s fail' : 'Circuit breaker off'); paint();
    } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: () => { reset(); kit.clearLog(); } }]);

    function setMode(v) { s.mode = v; kit.log(`Dependency is now ${MODE_TEXT[v]}`); }
    const blank = () => ({ req: 0, ok: 0, fail: 0, calls: 0, lat: [] });
    function reset() {
      st = { t: 0, acc: 0, brk: breaker(BREAKER), inflight: [], retryQ: [], recent: [], win: blank(), last: null, lastState: 'closed', parts: [], vis: 0.2 };
      kit.resetTime();
      chart.reset();
      paint();
    }

    function depAnswer() {
      const n = st.recent.length, load = Math.max(1, n / CAP);
      if (s.mode === 'down') return { lat: Infinity, ok: false };
      const base = s.mode === 'slow' ? 0.9 : 0.05;
      const lat = base * (0.7 + Math.random() * 0.6) * (1 + (load - 1) * 8);
      const shed = n > CAP * 1.6 && Math.random() < 1 - (CAP * 1.6) / n;
      const ok = !shed && !(s.mode === 'err' && Math.random() < 0.6);
      return { lat: shed ? 0.01 : lat, ok };
    }
    function call(req) {
      if (s.cb && !st.brk.canPass(st.t)) { done(req, false, st.t + 0.002, 'fast'); return; }
      st.win.calls++; st.recent.push(st.t);
      const a = depAnswer(), end = st.t + Math.min(a.lat, s.to), ok = a.ok && a.lat <= s.to;
      st.inflight.push({ req, end, ok, timeout: a.lat > s.to });
      if (Math.random() < st.vis) st.parts.push({ kind: 'call', t: 0, dur: 0.5, ok });
    }
    function done(req, ok, at, how) {
      if (how !== 'fast' && s.cb) st.brk.record(at, ok);
      if (ok) { st.win.ok++; st.win.lat.push((at - req.born) * 1000); if (Math.random() < st.vis) st.parts.push({ kind: 'ok', t: 0, dur: 0.6 }); return; }
      if (how !== 'fast' && req.tries <= s.retries) {
        const wait = backoff(s.bo, req.tries);
        req.tries++;
        st.retryQ.push({ req, at: at + wait });
        if (Math.random() < st.vis) st.parts.push({ kind: 'retry', t: 0, dur: 0.6 });
        return;
      }
      st.win.fail++; st.win.lat.push((at - req.born) * 1000);
      if (Math.random() < st.vis) st.parts.push({ kind: how === 'fast' ? 'fast' : 'fail', t: 0, dur: 0.6 });
    }

    const step = fixedStep(dt => {
      st.t += dt;
      st.vis = Math.min(1, 14 / s.rps);
      while (st.recent.length && st.recent[0] < st.t - 1) st.recent.shift();
      st.inflight = st.inflight.filter(c => (c.end > st.t ? true : (done(c.req, c.ok, c.end, c.timeout ? 'timeout' : ''), false)));
      st.retryQ = st.retryQ.filter(r => (r.at > st.t ? true : (call(r.req), false)));
      st.acc += s.rps * dt;
      const n = Math.floor(st.acc);
      st.acc -= n;
      for (let i = 0; i < n; i++) { st.win.req++; call({ born: st.t, tries: 1 }); }
      if (s.cb && st.brk.state !== st.lastState) {
        kit.log({ open: 'Breaker opened: too many failures, so calls fail fast for 4 s', half: 'Breaker half-open: letting a few trial calls through', closed: 'Breaker closed: the trial calls worked, traffic flows again' }[st.brk.state]);
        st.lastState = st.brk.state;
        paint();
      }
    });

    kit.every(1, () => {
      const w = st.win, ended = w.ok + w.fail;
      st.last = { ok: ended ? w.ok / ended : 1, p95: p95(w.lat), calls: w.calls, amp: w.req ? w.calls / w.req : 0 };
      chart.push({ calls: w.calls, cap: CAP, fail: w.fail });
      st.win = blank();
      paint();
      if (plan) {
        if (plan.healAt != null && st.t >= plan.healAt) { mode.set('ok', true); setMode('ok'); plan.watchFrom = st.t; plan.healAt = null; }
        else if (plan.watchFrom != null && st.t - plan.watchFrom >= 5) {
          kit.guided.observe(`Five seconds after the dependency became healthy it was still receiving ${st.last.calls} calls/s (${pct(st.last.calls / CAP)} of capacity), ×${st.last.amp.toFixed(2)} calls per user request.`);
          plan = null;
        }
      }
    });

    function paint() {
      kit.metric('cb', s.cb ? { closed: 'closed', open: 'OPEN', half: 'half-open' }[st.brk.state] : 'off', s.cb && st.brk.state !== 'closed' ? 'warn' : '');
      const l = st.last;
      if (!l) { for (const k of ['ok', 'p95', 'load', 'amp']) kit.metric(k, '–'); return; }
      kit.metric('ok', pct(l.ok), l.ok > 0.98 ? 'good' : l.ok > 0.8 ? 'warn' : 'bad');
      kit.metric('p95', fmtMs(l.p95), l.p95 > 1000 ? 'bad' : l.p95 > 300 ? 'warn' : '');
      kit.metric('load', pct(l.calls / CAP), l.calls > CAP ? 'bad' : l.calls > CAP * 0.8 ? 'warn' : 'good');
      kit.metric('amp', `×${l.amp.toFixed(2)}`, l.amp > 1.5 ? 'bad' : l.amp > 1.1 ? 'warn' : '');
    }

    function draw(dt) {
      stage.clear();
      const c = stage.colors, ctx = stage.ctx, w = stage.w, H = stage.h, y = H * 0.45, nw = clamp(w * 0.18, 72, 112);
      const users = { x: Math.max(w * 0.1, nw / 2 + 8), y, w: nw, h: 46 };
      const svc = { x: w * 0.45, y, w: clamp(w * 0.22, 90, 140), h: 56 };
      const dep = { x: w - Math.max(w * 0.13, nw / 2 + 10), y, w: nw + 10, h: 56 };
      const bx = (svc.x + svc.w / 2 + dep.x - dep.w / 2) / 2;
      stage.line(users.x + users.w / 2, y, svc.x - svc.w / 2, y, { color: c.wire, alpha: 0.4 });
      stage.line(svc.x + svc.w / 2, y, dep.x - dep.w / 2, y, { color: c.wire, alpha: 0.4 });
      const state = s.cb ? st.brk.state : 'closed';
      st.parts = st.parts.filter(a => {
        a.t += dt;
        if (a.t >= a.dur) return false;
        let pts, col;
        if (a.kind === 'call') { pts = [svc, dep]; col = a.ok ? c.wire : c.bad; }
        else if (a.kind === 'ok') { pts = [svc, users]; col = c.ok; }
        else if (a.kind === 'retry') { pts = [dep, { x: dep.x - 30, y: y + 46 }, { x: svc.x + 30, y: y + 46 }, svc]; col = c.signal; }
        else if (a.kind === 'fast') { pts = [{ x: bx - 6, y }, svc, users]; col = c.muted; }
        else { pts = [svc, users]; col = c.bad; }
        const at = along(pts, a.t / a.dur);
        stage.dot(at.x, at.y, 3.8, col);
        return true;
      });
      cnode(stage, users, 'Users', `${s.rps} req/s`, { size: 12 });
      cnode(stage, svc, 'Your service', `timeout ${fmtMs(s.to * 1000)} · ${s.retries} retr${s.retries === 1 ? 'y' : 'ies'}`, { size: 12 });
      const modeCol = s.mode === 'ok' ? c.wire : s.mode === 'slow' ? c.signal : c.bad;
      cnode(stage, dep, 'Dependency', { ok: 'healthy', slow: 'slow', err: 'erroring', down: 'down' }[s.mode], { size: 12, stroke: modeCol, subColor: s.mode === 'ok' ? c.muted : modeCol });
      const load = st.last ? st.last.calls / CAP : 0, gx = dep.x - dep.w / 2 + 8, gy = dep.y + dep.h / 2 + 8, gw = dep.w - 16;
      stage.bar(gx, gy, gw, 6, clamp(load, 0, 1), load >= 1 ? c.bad : load > 0.8 ? c.signal : c.ok, c.grid);
      stage.text(`${kit.fmt(st.last ? st.last.calls : 0)} / ${CAP} calls/s`, dep.x, gy + 18, { size: 10.5, weight: 600, align: 'center', color: load >= 1 ? c.bad : c.muted });
      if (s.cb) {
        const col = state === 'closed' ? c.ok : state === 'open' ? c.bad : c.signal, R = 15;
        stage.ring(bx, y, R, { color: col, width: 2, fill: c.surface });
        ctx.save(); ctx.strokeStyle = col; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.moveTo(bx - 8, y + 3);
        ctx.lineTo(state === 'closed' ? bx + 8 : bx + 5, state === 'closed' ? y + 3 : state === 'open' ? y - 8 : y - 3); ctx.stroke(); ctx.restore();
        stage.text({ closed: 'CLOSED', open: 'OPEN', half: 'HALF-OPEN' }[state], bx, y - R - 10, { size: 10.5, weight: 700, color: col, align: 'center' });
      }
      stage.text(`Dependency is ${MODE_TEXT[s.mode]}`, w / 2, H - 16, { size: 11, color: c.muted, align: 'center' });
    }

    no3d(kit);
    kit.loop(dt => { step(dt); draw(dt); });
    reset();

    return {
      reset() { reset(); kit.clearLog(); },
      guidedRun() {
        rps.set(80, true); s.rps = 80;
        to.set(500, true); s.to = 0.5;
        retries.set(3, true); s.retries = 3;
        bo.set('none', true); s.bo = 'none';
        cb.set(false, true); s.cb = false;
        mode.set('ok', true); s.mode = 'ok';
        reset(); kit.clearLog();
        unpause();
        mode.set('slow', true); setMode('slow');
        plan = { healAt: 4, watchFrom: null };
      },
    };
  },
};
