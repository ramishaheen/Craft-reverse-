// Real-time analytics: counting a click stream in event-time tumbling windows with a watermark.
// Model: 8 clicks per second are created "now" (event time). Most reach the processor within
// 0–1.2 s; a chosen share are late and take 2–20 s. Each click is counted in the window that holds
// its event time (floor(t / window) × window). Watermark = newest event time seen − allowed lateness.
// When the watermark passes a window's end, its count is published and the window is closed; a click
// for a closed window that arrives later is dropped. "Events counted" compares published counts with
// the true number of clicks created in those windows.

import { fixedStep, addLegend, unpause, no3d, clock, pct } from './_b-kit.js';

const RATE = 8, MAX_LATE = 20;

function pipeline({ win, lateness, lateShare }) {
  const p = { win, lateness, lateShare, now: 0, acc: 0, inflight: [], open: new Map(), emitted: [], truth: new Map(), done: new Set(), maxSeen: 0, dropped: 0 };
  p.start = t => Math.floor(t / p.win) * p.win;
  p.watermark = () => p.maxSeen - p.lateness;
  p.send = () => {
    const late = Math.random() < p.lateShare;
    const delay = late ? 2 + Math.random() * (MAX_LATE - 2) : Math.random() * 1.2;
    p.inflight.push({ t: p.now, arr: p.now + delay, late });
    const k = p.start(p.now);
    p.truth.set(k, (p.truth.get(k) || 0) + 1);
  };
  p.arrive = e => {
    if (e.t > p.maxSeen) p.maxSeen = e.t;
    const k = p.start(e.t);
    if (p.done.has(k)) { p.dropped++; e.dropped = true; } else p.open.set(k, (p.open.get(k) || 0) + 1);
    return e;
  };
  p.close = () => {
    const wm = p.watermark(), out = [];
    for (const k of [...p.open.keys()].sort((a, b) => a - b)) {
      if (k + p.win <= wm) {
        const rec = { start: k, count: p.open.get(k), at: p.now, wait: p.now - (k + p.win) };
        p.emitted.push(rec); out.push(rec); p.open.delete(k); p.done.add(k);
      }
    }
    return out;
  };
  p.tick = dt => {
    p.now += dt;
    p.acc += RATE * dt;
    while (p.acc >= 1) { p.acc -= 1; p.send(); }
    const arrived = [];
    p.inflight = p.inflight.filter(e => (e.arr <= p.now ? (arrived.push(p.arrive(e)), false) : true));
    return { arrived, published: p.close() };
  };
  p.accuracy = () => { let got = 0, real = 0; for (const e of p.emitted) { got += e.count; real += p.truth.get(e.start) || 0; } return real ? got / real : 1; };
  p.avgWait = () => (p.emitted.length ? p.emitted.reduce((a, e) => a + e.wait, 0) / p.emitted.length : 0);
  return p;
}

export default {
  lead: 'Clicks stream in from phones and are counted in 10-second windows by the moment they happened. Most arrive within a second, but some are late: a phone in a tunnel, a retry. The watermark says “I believe everything up to here has arrived”. Once it passes the end of a window the count is published, and anything for that window that turns up afterwards is dropped.',
  emptyLog: 'Nothing yet. The first window is published once the watermark passes its end.',
  stageHeight: 400,
  tryThis: [
    'Set <b>Allowed lateness</b> to 0. Results appear at once, but every late click is lost and the counts come out too low.',
    'Raise it to 20. Almost every click is counted, but each dashboard number now shows up 20 seconds after its window closed.',
    'Set late events to 0%. Now even a small lateness gives exact counts: the trade-off only exists because the network is messy.',
  ],
  inShort: {
    what: 'A real-time analytics pipeline counts events such as clicks, views or payments in time windows as they stream in, feeding live dashboards and alerts.',
    why: 'Events arrive out of order and some very late, so the system has to decide when a window is complete enough to publish.',
    tradeoff: 'A watermark with more allowed lateness gives fuller counts but publishes later; events later than that are dropped or sent as corrections.',
    interview: 'Kafka into Flink with event-time tumbling windows and a watermark of a few seconds, late data going to a side output or an update, and results landing in a fast store such as Druid or Redis for the dashboard.',
  },
  quiz: [
    { q: 'Why count by event time instead of arrival time?', o: ['It is quicker', 'A click belongs to the moment it happened, even if the network delivered it late', 'Arrival time is unknown', 'It saves memory'], a: 1,
      why: 'Event-time windows give the same answer however the network delays events, while arrival-time counts move with every hiccup.' },
    { q: 'What does the watermark tell the stream processor?', o: ['How many events exist', 'That events up to that time have (probably) all arrived, so earlier windows can be published', 'The current wall-clock time', 'Which events are duplicates'], a: 1,
      why: 'When the watermark moves past the end of a window, that window closes and its result is emitted.' },
    { q: 'You increase the allowed lateness. What changes?', o: ['Nothing', 'Counts become more complete, but results are published later', 'Counts become less complete', 'Windows become longer'], a: 1,
      why: 'Waiting longer lets late events in, at the price of latency; many systems also send a corrected result for very late data.' },
  ],
  guided: {
    intro: 'Publish windows with no allowed lateness while a fifth of the clicks are delayed.',
    example: '“Run the guided example” restarts the stream with 0 s allowed lateness, 20% late clicks and 10-second windows.',
    question: 'What will the first published counts look like?',
    predictions: ['They appear almost at once but miss the late clicks, so they are too low.', 'They are exact, because the watermark waits for every click.', 'They are too high, because late clicks are counted twice.'],
    correctPrediction: 0,
    running: 'Watch the window boxes turn green when published, and the red × marks for clicks that came too late.',
    observation: 'Windows were published right after they ended, and the late clicks that arrived afterwards were dropped.',
    explainQuestion: 'Why were the counts too low?',
    explanations: ['With no lateness, the watermark passed each window’s end immediately, so late clicks found the window already closed.', 'The processor counted by arrival time.', 'The phones sent fewer clicks.'],
    correctExplanation: 0,
    why: 'Allowed lateness is a dial between latency and completeness; the right setting depends on how late your data really is.',
    retryHint: 'Compare “clicks N (really M)” in the published list at the bottom of the diagram.',
    nextSlug: 'api-gateway',
    nextLabel: 'Next experiment: API gateway →',
    waitSeconds: 25,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { win: 10, lateness: 2, share: 0.1 };
    let P, drops = [], win = { drop: 0 }, watch = false;

    kit.metrics([{ key: 'wait', label: 'Result published after window ends' }, { key: 'acc', label: 'Events counted' }, { key: 'drop', label: 'Late events dropped' }, { key: 'wins', label: 'Windows published' }]);
    const chart = kit.chart({ lines: [{ key: 'acc', label: 'Share of clicks counted (%)', color: 'ok' }, { key: 'wait', label: 'Publish delay (s × 10)', color: 'signal' }], bars: { key: 'drop', label: 'Dropped late clicks', color: 'bad' }, format: v => kit.fmt(v), yMax: 105 });
    addLegend(kit, [['ink', 'Click on time', 'dot'], ['signal', 'Late click', 'dot'], ['ok', 'Published window', 'box'], ['bad', '× Dropped (too late)']]);

    const p = kit.panel;
    const late = p.slider('Allowed lateness', { min: 0, max: 20, step: 1, value: s.lateness, format: v => `${v} s`, hint: 'Watermark = newest event time seen minus this', onInput: v => { s.lateness = v; P.lateness = v; } });
    const share = p.slider('Events that arrive late', { min: 0, max: 30, step: 1, value: 10, format: v => `${v}%`, hint: 'Late events take 2 to 20 seconds to arrive', onInput: v => { s.share = v / 100; P.lateShare = v / 100; } });
    const winCtl = p.slider('Window size', { min: 5, max: 30, step: 5, value: s.win, format: v => `${v} s`, onInput: v => { s.win = v; reset(); kit.log(`Windows are now ${v} s long; the stream restarted`); } });
    p.buttons([{ label: 'Restart stream', kind: 'outline', onClick: () => { reset(); kit.clearLog(); } }]);

    function reset() {
      P = pipeline({ win: s.win, lateness: s.lateness, lateShare: s.share });
      drops = []; win = { drop: 0 };
      kit.resetTime();
      chart.reset();
      paint();
    }
    const step = fixedStep(dt => {
      const { arrived, published } = P.tick(dt);
      for (const e of arrived) if (e.dropped) { drops.push(e); win.drop++; }
      drops = drops.filter(e => e.t > P.now - 120);
      for (const r of published) {
        const real = P.truth.get(r.start) || 0, miss = real - r.count;
        kit.log(`Window ${clock(r.start)}–${clock(r.start + P.win)} published ${r.wait.toFixed(1)} s after it ended: ${r.count} clicks${miss > 0 ? `, <b>${miss} missing</b> (still on their way)` : ', complete'}`);
      }
    });
    kit.every(1, () => {
      if (watch && P.emitted.length >= 1 && P.dropped >= 3) {
        watch = false;
        kit.guided.observe(`Windows were published ${P.avgWait().toFixed(1)} s after they ended, but ${P.dropped} late clicks arrived after their window had closed and were dropped (${pct(P.accuracy())} counted).`);
      }
      chart.push({ acc: P.emitted.length ? P.accuracy() * 100 : null, wait: P.emitted.length ? P.avgWait() * 10 : null, drop: win.drop });
      win.drop = 0;
      paint();
    });

    function paint() {
      const a = P.accuracy();
      kit.metric('wait', P.emitted.length ? `${P.avgWait().toFixed(1)} s` : '–', P.avgWait() > 8 ? 'warn' : 'good');
      kit.metric('acc', P.emitted.length ? pct(a) : '–', a < 0.97 ? 'bad' : 'good');
      kit.metric('drop', String(P.dropped), P.dropped ? 'bad' : 'good');
      kit.metric('wins', String(P.emitted.length));
    }

    function draw() {
      stage.clear();
      const c = stage.colors, ctx = stage.ctx, w = stage.w, H = stage.h, narrow = w < 520;
      const x0 = 14, x1 = w - 14, span = Math.max(30, 3 * P.win + P.lateness + 4), tEnd = P.now + 1, tStart = tEnd - span;
      const X = t => x0 + ((x1 - x0) * (t - tStart)) / span;
      const netTop = 26, netBot = H * 0.36, wTop = netBot + 10, wBot = H * 0.62;
      stage.text(narrow ? 'in the network' : 'in the network (higher = arrives later)', x0, 12, { size: 10, color: c.muted });
      stage.text('event time →', x1, 12, { size: 10, color: c.muted, align: 'right' });
      const pub = new Map(P.emitted.map(e => [e.start, e]));
      ctx.save(); ctx.beginPath(); ctx.rect(x0, 0, x1 - x0, H); ctx.clip();
      for (let k = Math.max(0, P.start(tStart)); k < tEnd; k += P.win) {
        const a = X(k), b = X(k + P.win), done = pub.get(k), open = P.open.get(k) || 0;
        ctx.save(); ctx.globalAlpha = done ? 0.16 : 1; stage.rect(a + 2, wTop, b - a - 4, wBot - wTop, { fill: done ? c.ok : c.surface, r: 6 }); ctx.restore();
        stage.rect(a + 2, wTop, b - a - 4, wBot - wTop, { stroke: done ? c.ok : c.line, r: 6, width: 1 });
        if (b - a > 34) stage.text(clock(k), a + 6, wTop + 9, { size: 9, color: c.muted });
        const cx = (a + b) / 2, cy = (wTop + wBot) / 2 + 4;
        if (done) {
          const real = P.truth.get(k) || 0;
          stage.text(String(done.count), cx, cy - 6, { size: 13, weight: 700, align: 'center', color: done.count < real ? c.bad : c.ok });
          if (b - a > 50) stage.text(done.count < real ? `of ${real}` : 'published', cx, cy + 9, { size: 9, color: c.muted, align: 'center' });
        } else if (k <= P.now) {
          stage.text(String(open), cx, cy - 6, { size: 13, weight: 700, align: 'center' });
          if (b - a > 50) stage.text('counting', cx, cy + 9, { size: 9, color: c.muted, align: 'center' });
        }
      }
      const yOf = e => netBot - (netBot - netTop) * Math.min(1, (e.arr - P.now) / MAX_LATE);
      for (const e of P.inflight) stage.dot(X(e.t), yOf(e), e.late ? 3.2 : 2.4, e.late ? c.signal : c.ink, 0.9);
      for (const e of drops) {
        const x = X(e.t), y = wBot + 10;
        ctx.save(); ctx.globalAlpha = Math.max(0.25, 1 - (P.now - e.arr) / 15); ctx.strokeStyle = c.bad; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3); ctx.stroke(); ctx.restore();
      }
      const vline = (t, col, label, dash) => {
        const x = X(t);
        stage.line(x, netTop - 4, x, wBot + 16, { color: col, width: 2, dash: dash ? [5, 4] : null });
        stage.text(label, x - 3, wBot + 24, { size: 10, weight: 600, color: col, align: 'right' });
      };
      vline(P.now, c.muted, 'now', false);
      const wm = P.watermark();
      if (wm > tStart) vline(wm, c.signal, 'watermark', true);
      ctx.restore();
      if (drops.length) stage.text('× dropped: arrived after its window was published', x0, wBot + 38, { size: 10, color: c.bad });
      const ly = wBot + 52, rowH = narrow ? 14 : 15, rows = Math.max(1, Math.floor((H - ly - 4) / rowH));
      P.emitted.slice(-rows).reverse().forEach((e, i) => {
        const y = ly + i * rowH, real = P.truth.get(e.start) || 0;
        stage.rect(x0, y, x1 - x0, rowH - 3, { fill: c.surface, r: 4 });
        stage.text(`${clock(e.start)}–${clock(e.start + P.win)}  clicks ${e.count}${narrow ? '' : `  (really ${real})`}`, x0 + 6, y + (rowH - 3) / 2, { size: 10 });
        stage.text(`${e.count < real ? `missed ${real - e.count} · ` : ''}after ${e.wait.toFixed(1)} s`, x1 - 6, y + (rowH - 3) / 2, { size: 10, align: 'right', color: e.count < real ? c.bad : c.ok });
      });
    }

    no3d(kit);
    kit.loop(dt => { step(dt); draw(); });
    reset();

    return {
      reset() { reset(); kit.clearLog(); },
      guidedRun() {
        late.set(0, true); s.lateness = 0;
        share.set(20, true); s.share = 0.2;
        winCtl.set(10, true); s.win = 10;
        reset(); kit.clearLog();
        unpause();
        watch = true;
      },
    };
  },
};
