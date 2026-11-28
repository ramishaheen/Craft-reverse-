// Rate limiting: clients → limiter → API, comparing three algorithms on the same traffic.
// - Token bucket: holds up to `burst` tokens, refilled at `limit` per second; a request spends one.
// - Fixed window: counts requests per calendar second; at most `limit` per window.
// - Sliding window (log): at most `limit` requests in any trailing 1 s.
// Traffic: steady at `rate`; bursty = 4× rate for 0.6 s of every 4 s and 0.42× otherwise (same
// average); window edge = a full `limit` sent in the last 0.1 s of even seconds and the first 0.1 s
// of odd seconds, i.e. two limits in 0.2 s straddling a window boundary.
// "Most allowed in any 1 s" scans the last 10 s of allowed requests with a sliding 1 s window.

import { fixedStep, addLegend, unpause, no3d, clamp, along, cnode } from './_b-kit.js';

const ALGO = { tb: 'Token bucket', fw: 'Fixed window', sw: 'Sliding window' };

function limiter({ algo, limit, burst }) {
  const L = { algo, limit, burst, tokens: burst, winStart: -1, winCount: 0, log: [] };
  L.refill = dt => { L.tokens = Math.min(L.burst, L.tokens + L.limit * dt); };
  L.allow = t => {
    if (L.algo === 'tb') { if (L.tokens >= 1) { L.tokens -= 1; return true; } return false; }
    if (L.algo === 'fw') {
      const win = Math.floor(t);
      if (win !== L.winStart) { L.winStart = win; L.winCount = 0; }
      if (L.winCount < L.limit) { L.winCount++; return true; }
      return false;
    }
    while (L.log.length && L.log[0] <= t - 1) L.log.shift();
    if (L.log.length < L.limit) { L.log.push(t); return true; }
    return false;
  };
  L.used = t => (L.algo === 'fw' ? (Math.floor(t) === L.winStart ? L.winCount : 0) : L.log.filter(x => x > t - 1).length);
  return L;
}

export default {
  lead: 'A rate limiter shields an API by turning away requests above a limit with HTTP 429 Too Many Requests. The algorithms behave very differently when traffic comes in bursts.',
  emptyLog: 'Nothing yet. Switch the algorithm or the traffic pattern.',
  stageHeight: 380,
  tryThis: [
    'Pick <b>Window edge</b> with <b>Fixed window</b>. Twice the limit slips through in 0.2 s, right across the window boundary.',
    'Same pattern with <b>Sliding window</b>: the burst is held to the limit.',
    '<b>Token bucket</b> with a big bucket lets short bursts through while the long-run average stays at the limit. That suits real users who click quickly.',
  ],
  inShort: {
    what: 'A rate limiter caps how many requests a client may make and answers 429 Too Many Requests once the limit is passed.',
    why: 'It protects the service from abuse, from bugs and from one noisy client using up everybody’s capacity.',
    tradeoff: 'A fixed window lets double bursts through at its edges; a token bucket allows short bursts; a sliding window is fairer but needs more memory.',
    interview: 'A token bucket per user in Redis: a steady refill rate plus a burst size, and 429 with Retry-After when it is empty.',
  },
  quiz: [
    { q: 'Fixed window with a limit of 10/s. How many requests can pass in a quick burst that straddles a window boundary?', o: ['10', 'Up to 20', '5', 'No limit'], a: 1,
      why: '10 at the very end of one window plus 10 at the start of the next, all within a fraction of a second.' },
    { q: 'Which algorithm allows short bursts while holding the long-run average to the limit?', o: ['Token bucket', 'Fixed window', 'Sliding log', 'None of them'], a: 0,
      why: 'Tokens pile up to the bucket size, so a burst can spend saved tokens, while the refill rate caps the average.' },
    { q: 'Which HTTP status code means “too many requests”?', o: ['401', '403', '429', '503'], a: 2,
      why: '429 Too Many Requests, often sent with a Retry-After header.' },
  ],
  guided: {
    intro: 'Send a full limit just before and just after each window boundary to a fixed-window limiter.',
    example: '“Run the guided example” sets a fixed window, a limit of 10 req/s and the window-edge traffic pattern.',
    question: 'What is the most requests the limiter lets through in any single second?',
    predictions: ['About 20, twice the limit, within a fraction of a second.', 'Exactly 10, the limit.', 'None: the limiter blocks all of the bursts.'],
    correctPrediction: 0,
    running: 'Watch the green lines on the timeline cluster around each window edge, and the “Most allowed in any 1 s” number.',
    observation: 'Ten requests got through at the end of one window and ten more at the start of the next, so 20 passed within 0.2 s.',
    explainQuestion: 'Why did twice the limit get through?',
    explanations: ['The fixed window resets its counter at the boundary, so each side of the edge gets a fresh allowance.', 'The limiter crashed under load.', 'The clients used two IP addresses.'],
    correctExplanation: 0,
    why: 'Sliding windows and token buckets look at the recent past instead of calendar windows, so they cap such edge bursts.',
    retryHint: 'Compare the timeline lines with the vertical window-edge marks.',
    nextSlug: 'resilience',
    nextLabel: 'Next experiment: resilience →',
    waitSeconds: 7,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { algo: 'tb', limit: 10, burst: 10, rate: 15, pattern: 'steady' };
    let st, watch = false;

    kit.metrics([{ key: 'ok', label: 'Allowed / s' }, { key: 'no', label: 'Rejected / s' }, { key: 'peak', label: 'Most allowed in any 1 s' }]);
    const chart = kit.chart({ lines: [{ key: 'ok', label: 'Allowed / s', color: 'ok' }, { key: 'peak', label: 'Most in any 1 s', color: 'signal' }, { key: 'lim', label: 'Limit', color: 'muted' }], bars: { key: 'no', label: 'Rejected (429)', color: 'bad' } });
    addLegend(kit, [['ok', 'Allowed', 'dot'], ['bad', 'Rejected with 429', 'dot'], ['signal', 'Token in the bucket', 'dot']]);

    const p = kit.panel;
    const algo = p.seg('Algorithm', { options: Object.entries(ALGO), value: s.algo, onChange: v => { s.algo = v; st.lim = limiter(s); burst.input.disabled = v !== 'tb'; kit.log(`Switched to ${ALGO[v].toLowerCase()}`); } });
    const limit = p.slider('Limit', { min: 2, max: 40, step: 1, value: s.limit, format: v => `${v} req/s`, onInput: v => { s.limit = v; st.lim.limit = v; } });
    const burst = p.slider('Bucket size (burst allowance)', { min: 1, max: 40, step: 1, value: s.burst, format: v => `${v} tokens`, hint: 'Used by token bucket only', onInput: v => { s.burst = v; st.lim.burst = v; st.lim.tokens = Math.min(st.lim.tokens, v); } });
    const pattern = p.seg('Traffic pattern', { options: [['steady', 'Steady'], ['bursty', 'Bursty'], ['edge', 'Window edge']], value: s.pattern, onChange: v => setPattern(v, true) });
    const rate = p.slider('Incoming rate', { min: 1, max: 60, step: 1, value: s.rate, format: v => `${v} req/s`, hint: 'Average across the pattern', onInput: v => { s.rate = v; } });
    const rateHint = rate.el.querySelector('.ctl-hint');
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: () => { reset(); kit.clearLog(); } }]);

    function setPattern(v, log) {
      s.pattern = v;
      rate.input.disabled = v === 'edge';
      rateHint.textContent = v === 'edge' ? 'Sends the full limit just before and just after each window edge' : 'Average across the pattern';
      if (log) kit.log({ steady: 'Traffic is now steady', bursty: 'Traffic now comes in bursts: 4× the rate for 0.6 s every 4 s', edge: 'Traffic now sends a full limit on both sides of every window edge' }[v]);
    }

    function reset() {
      st = { t: 0, acc: 0, events: [], parts: [], w: { ok: 0, no: 0 }, last: null, lim: limiter(s) };
      kit.resetTime();
      chart.reset();
      paint();
    }

    const step = fixedStep(dt => {
      st.t += dt;
      st.lim.refill(dt);
      const frac = st.t % 1, sec = Math.floor(st.t);
      if (s.pattern === 'steady') st.acc += s.rate * dt;
      else if (s.pattern === 'bursty') st.acc += (st.t % 4 < 0.6 ? s.rate * 4 : s.rate * 0.42) * dt;
      else if (sec % 2 === 0 ? frac >= 0.9 : frac < 0.1) st.acc += (s.limit / 0.1) * dt;
      const n = Math.floor(st.acc);
      st.acc -= n;
      const vis = Math.min(1, 25 / Math.max(s.rate, s.limit * 2));
      for (let i = 0; i < n; i++) {
        const ok = st.lim.allow(st.t);
        st.events.push({ t: st.t, ok });
        if (ok) st.w.ok++; else st.w.no++;
        if (Math.random() < vis) st.parts.push({ ok, t: 0, dur: 1.1 });
      }
      while (st.events.length && st.events[0].t < st.t - 10) st.events.shift();
    });

    kit.every(1, () => {
      const times = st.events.filter(e => e.ok).map(e => e.t);
      let peak = 0;
      for (let i = 0, j = 0; i < times.length; i++) { while (times[i] - times[j] >= 1) j++; peak = Math.max(peak, i - j + 1); }
      st.last = { ok: st.w.ok, no: st.w.no, peak };
      chart.push({ ok: st.w.ok, no: st.w.no, peak, lim: s.limit });
      st.w = { ok: 0, no: 0 };
      paint();
      if (watch && st.t > 3 && peak > s.limit * 1.5) {
        watch = false;
        kit.guided.observe(`${peak} requests were allowed within one second against a limit of ${s.limit}: a full allowance on each side of the window edge.`);
      }
    });

    function paint() {
      const l = st.last;
      if (!l) { for (const k of ['ok', 'no', 'peak']) kit.metric(k, '–'); return; }
      kit.metric('ok', String(l.ok));
      kit.metric('no', String(l.no), l.no ? 'warn' : '');
      kit.metric('peak', `${l.peak} (limit ${s.limit})`, l.peak > s.limit * 1.15 ? 'bad' : 'good');
    }

    function draw(dt) {
      stage.clear();
      const c = stage.colors, ctx = stage.ctx, w = stage.w, H = stage.h;
      const y = H * 0.28, nw = clamp(w * 0.15, 58, 88);
      const cli = { x: Math.max(w * 0.08, nw / 2 + 8), y, w: nw, h: 40 }, api = { x: w - Math.max(w * 0.08, nw / 2 + 8), y, w: nw, h: 40 };
      const box = { x: w / 2, y, w: clamp(w * 0.4, 140, 230), h: 80 }, rej = { x: w / 2 + box.w * 0.18, y: H * 0.6 };
      stage.line(cli.x, y, api.x, y, { color: c.wire, alpha: 0.35 });
      stage.line(rej.x, box.y + box.h / 2, rej.x, rej.y, { color: c.bad, alpha: 0.35, dash: [4, 4] });
      st.parts = st.parts.filter(a => {
        a.t += dt;
        if (a.t >= a.dur) return false;
        const k = a.t / a.dur, at = along(a.ok ? [cli, box, api] : [cli, { x: rej.x, y: box.y }, rej], k);
        if (!a.ok && k > 0.75) { const f = (k - 0.75) / 0.25; stage.ring(at.x, at.y, 4 + f * 10, { color: c.bad, width: 1.5 }); stage.dot(at.x, at.y, 4, c.bad, 1 - f); }
        else stage.dot(at.x, at.y, 4, a.ok ? c.ok : c.bad);
        return true;
      });
      cnode(stage, cli, 'Clients', s.pattern === 'edge' ? 'edge bursts' : `${s.rate} req/s`, { size: 12 });
      cnode(stage, api, 'API', 'protected', { size: 12 });
      const bx = box.x - box.w / 2, by = box.y - box.h / 2;
      stage.rect(bx, by, box.w, box.h, { fill: c.surface, stroke: c.wire, r: 8 });
      stage.text(ALGO[s.algo], box.x, by + 14, { size: 12, weight: 600, align: 'center' });
      const ix = bx + 12, iw = box.w - 24, iy = by + 30, L = st.lim;
      if (s.algo === 'tb') {
        const per = Math.min(s.burst, Math.floor(iw / 10));
        for (let i = 0; i < s.burst; i++) {
          const cx = ix + (i % per) * 10 + 5, cy = iy + Math.floor(i / per) * 10 + 5;
          if (cy > by + box.h - 20) break;
          const fill = clamp(L.tokens - i, 0, 1);
          stage.ring(cx, cy, 3.6, { color: c.line2, width: 1 });
          if (fill > 0) stage.dot(cx, cy, 3.6, c.signal, fill);
        }
        stage.text(`${L.tokens.toFixed(1)} of ${s.burst} tokens, +${s.limit}/s`, box.x, by + box.h - 10, { size: 10.5, color: c.muted, align: 'center' });
      } else {
        const used = L.used(st.t);
        stage.rect(ix, iy + 2, iw, 12, { fill: c.surface2, stroke: c.line, r: 4, width: 1 });
        if (used) stage.rect(ix, iy + 2, iw * Math.min(1, used / s.limit), 12, { fill: used >= s.limit ? c.bad : c.ok, r: 4 });
        if (s.algo === 'fw') { ctx.fillStyle = c.wire; ctx.fillRect(ix, iy + 20, iw * (st.t % 1), 3); }
        stage.text(s.algo === 'fw' ? `This second: ${used} of ${s.limit}` : `Last 1 s: ${used} of ${s.limit}`, box.x, by + box.h - 10, { size: 10.5, color: c.muted, align: 'center' });
      }
      stage.text('429 Too Many Requests', rej.x, rej.y + 14, { size: 11.5, weight: 600, color: c.bad, align: 'center' });
      // timeline: last 10 s, allowed above the axis, rejected below
      const t0 = H * 0.74, t1 = H - 14, mid = (t0 + t1) / 2, VIEW = 10, X = t => w - 10 - ((st.t - t) / VIEW) * (w - 20);
      stage.line(10, mid + 0.5, w - 10, mid + 0.5, { color: c.line, width: 1 });
      for (let k = Math.ceil(st.t - VIEW); k <= st.t; k++) { const x = Math.round(X(k)) + 0.5; stage.line(x, t0 - 6, x, t1, { color: s.algo === 'fw' ? c.wire : c.grid, width: 1, alpha: s.algo === 'fw' ? 0.5 : 1 }); }
      for (const e of st.events) { const x = X(e.t); stage.line(x, mid, x, e.ok ? t0 : t1, { color: e.ok ? c.ok : c.bad, width: 1.5, alpha: 0.75 }); }
      stage.text('allowed', 12, t0 - 6, { size: 10, color: c.muted });
      stage.text('rejected', 12, t1 - 4, { size: 10, color: c.muted });
      stage.text(s.algo === 'fw' ? 'last 10 s, lines = window edges' : 'last 10 s', w - 12, t0 - 6, { size: 10, color: c.muted, align: 'right' });
    }

    no3d(kit);
    kit.loop(dt => { step(dt); draw(dt); });
    reset();
    burst.input.disabled = s.algo !== 'tb';

    return {
      reset() { reset(); kit.clearLog(); },
      guidedRun() {
        algo.set('fw', true); s.algo = 'fw'; burst.input.disabled = true;
        limit.set(10, true); s.limit = 10;
        pattern.set('edge', true); setPattern('edge', false);
        reset(); kit.clearLog();
        unpause();
        watch = true;
      },
    };
  },
};
