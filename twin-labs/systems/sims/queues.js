// Queues: producers → a FIFO queue → a pool of consumers, with retries and a dead-letter queue.
// Model: messages arrive at the chosen rate. Each idle consumer takes the head of the queue and
// works on it for job time × a random 0.6–1.4. A message fails with the failure chance; a failed
// message goes back to the tail and is retried until it has failed more than "retries" times, then
// it moves to the dead-letter queue. Consumer capacity = consumers × 1000 / job ms messages per second.
// Pausing consumers (a deploy) stops them taking new messages; the queue just grows.

import { fixedStep, addLegend, unpause, no3d, clamp, along, fmtMs, cnode } from './_b-kit.js';

const RATES = [1, 2, 5, 10, 20, 30, 50, 75, 100, 150, 200];

export default {
  lead: 'Producers drop messages into a queue and carry on. Consumers take them off one at a time at their own pace. A message that fails is tried again, and after too many failures it is parked in a dead-letter queue.',
  emptyLog: 'Nothing yet. Send a burst or pause the consumers.',
  stageHeight: 380,
  tryThis: [
    'Push incoming above the <b>consumer capacity</b>. The backlog never stops growing: a queue absorbs bursts, not overload that lasts.',
    '<b>Send 300 at once</b> and watch the queue drain at the spare capacity. No message is lost, it simply takes longer.',
    'Pause the consumers for 10 seconds, then resume. This is why deploys are safe behind a queue.',
    'Little’s law: waiting time ≈ queue length ÷ throughput. Check it against the numbers under the diagram.',
  ],
  inShort: {
    what: 'A message queue sits between producers and consumers; consumers pull messages when they are ready and failed ones are retried.',
    why: 'It soaks up traffic spikes and lets slow work happen later, so the user is not kept waiting for it.',
    tradeoff: 'The work becomes asynchronous, so you need retries, a dead-letter queue and idempotent consumers, because a message can be delivered twice.',
    interview: 'I would move the slow work onto a queue with retries and a dead-letter queue, and make the consumer idempotent.',
  },
  quiz: [
    { q: 'All day long, messages arrive faster than the consumers can handle them. What happens?', o: ['The queue absorbs it indefinitely', 'The backlog keeps growing until something gives way', 'Messages get processed faster', 'Producers slow down by themselves'], a: 1,
      why: 'Queues smooth out bursts. Overload that lasts needs more consumers or less work per message.' },
    { q: 'What is a dead-letter queue used for?', o: ['Messages that failed too many times, kept aside to inspect', 'Messages from deleted accounts', 'Low-priority messages', 'Duplicate messages'], a: 0,
      why: 'Once the retry limit is reached, a poison message is moved aside so it stops blocking or wasting the consumers.' },
    { q: 'Why do queue consumers need to be idempotent?', o: ['To run faster', 'Because the same message can be delivered more than once', 'Because queues shuffle messages', 'To use less memory'], a: 1,
      why: 'With at-least-once delivery, a retry after a timeout can hand the same message over a second time.' },
  ],
  guided: {
    intro: 'Dump a burst of 300 messages on a queue whose consumers have some spare capacity.',
    example: '“Run the guided example” resets to 20 msg/s, 5 consumers, 100 ms per message, no failures and no pause, then sends 300 messages at once.',
    question: 'What happens to the 300 extra messages?',
    predictions: ['They wait, and the backlog drains steadily using the spare capacity, with nothing lost.', 'Most of them are dropped because the queue is full.', 'The consumers process all 300 instantly.'],
    correctPrediction: 0,
    running: 'Watch “Waiting in queue” and the queue-length line in the chart fall back towards zero.',
    observation: 'The burst waited in the queue and drained at the consumers’ spare capacity; every message was processed.',
    explainQuestion: 'Why did the backlog drain at that speed?',
    explanations: ['Consumers can do 50 messages a second and 20 keep arriving, so only the 30 spare per second eat into the backlog.', 'The queue deleted old messages to make room.', 'Producers stopped sending during the burst.'],
    correctExplanation: 0,
    why: 'Drain time ≈ backlog ÷ (capacity − arrival rate). A queue buys time; it does not add capacity.',
    retryHint: 'Compare “Consumer capacity” with the incoming rate in the Producers box.',
    nextSlug: 'kafka',
    nextLabel: 'Next experiment: Kafka →',
    waitSeconds: 20,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { rate: 20, cons: 3, job: 100, fail: 5, retries: 3, paused: false };
    let st, watch = false;

    kit.metrics([
      { key: 'backlog', label: 'Waiting in queue' }, { key: 'age', label: 'Oldest message' }, { key: 'done', label: 'Processed / s' },
      { key: 'cap', label: 'Consumer capacity' }, { key: 'dlq', label: 'Dead letters' },
    ]);
    const chart = kit.chart({ lines: [{ key: 'backlog', label: 'Queue length', color: 'wire' }], bars: { key: 'fail', label: 'Failed attempts', color: 'bad' }, format: v => `${kit.fmt(Math.round(v))} msgs`, yMax: undefined });
    addLegend(kit, [['wire', 'New message', 'dot'], ['signal', 'Being retried', 'dot'], ['ok', 'Processed', 'dot'], ['bad', 'Dead-lettered', 'dot']]);

    const p = kit.panel;
    const rate = p.slider('Incoming messages', { values: RATES, value: s.rate, format: v => `${v} msg/s`, onInput: v => { s.rate = v; paint(); } });
    const cons = p.slider('Consumers', { min: 1, max: 10, step: 1, value: s.cons, onInput: v => { s.cons = v; fitWorkers(); paint(); } });
    const job = p.slider('Time to process one message', { min: 50, max: 2000, step: 50, value: s.job, format: v => `${v} ms`, onInput: v => { s.job = v; paint(); } });
    const fail = p.slider('Failure chance', { min: 0, max: 50, step: 1, value: s.fail, format: v => `${v}%`, onInput: v => { s.fail = v; } });
    const retries = p.slider('Retries before dead-letter', { min: 0, max: 5, step: 1, value: s.retries, onInput: v => { s.retries = v; } });
    const pause = p.toggle('Pause consumers (simulate a deploy)', { value: false, onChange: v => { s.paused = v; kit.log(v ? 'Consumers paused for a deploy: messages keep arriving and wait in the queue' : `Consumers back: they start working through ${kit.fmt(st.queue.length)} waiting messages`); } });
    p.buttons([{ label: 'Send 300 at once', kind: 'primary', onClick: () => burst() }, { label: 'Reset', kind: 'outline', onClick: reset }]);

    function reset() {
      st = { t: 0, acc: 0, queue: [], workers: [], dlq: 0, id: 0, win: { in: 0, done: 0, fail: 0 }, last: null, parts: [], lastDlqLog: -9 };
      fitWorkers();
      kit.resetTime();
      chart.reset();
      stage.clearFlows();
      paint();
    }
    function fitWorkers() {
      while (st.workers.length < s.cons) st.workers.push({ busy: null, until: 0, start: 0 });
      while (st.workers.length > s.cons) { const w = st.workers.pop(); if (w.busy) st.queue.unshift(w.busy); }
    }
    function burst() {
      for (let i = 0; i < 300; i++) st.queue.push({ id: st.id++, born: st.t, tries: 0 });
      kit.log(`300 messages arrived at once. The queue now holds ${kit.fmt(st.queue.length)}`);
    }

    const step = fixedStep(dt => {
      st.t += dt;
      st.acc += s.rate * dt;
      const n = Math.floor(st.acc);
      st.acc -= n;
      const vis = Math.min(1, 16 / Math.max(1, s.rate));
      for (let i = 0; i < n; i++) {
        st.queue.push({ id: st.id++, born: st.t, tries: 0 });
        st.win.in++;
        if (Math.random() < vis) st.parts.push({ kind: 'in', t: 0, dur: 0.6 });
      }
      st.workers.forEach((w, i) => {
        if (w.busy && st.t >= w.until) {
          const m = w.busy;
          w.busy = null;
          if (Math.random() < s.fail / 100) {
            m.tries++; st.win.fail++;
            if (m.tries > s.retries) {
              st.dlq++;
              if (Math.random() < vis * 2) st.parts.push({ kind: 'dlq', i, t: 0, dur: 0.8 });
              if (st.t - st.lastDlqLog > 3) { st.lastDlqLog = st.t; kit.log(`Message #${m.id} failed ${m.tries} times and moved to the dead-letter queue`); }
            } else {
              st.queue.push(m);
              if (Math.random() < vis * 2) st.parts.push({ kind: 'retry', i, t: 0, dur: 1 });
            }
          } else {
            st.win.done++;
            if (Math.random() < vis) st.parts.push({ kind: 'done', i, t: 0, dur: 0.5 });
          }
        }
        if (!w.busy && !s.paused && st.queue.length) {
          w.busy = st.queue.shift(); w.start = st.t;
          w.until = st.t + (s.job / 1000) * (0.6 + Math.random() * 0.8);
          if (Math.random() < vis) st.parts.push({ kind: 'take', i, t: 0, dur: 0.4 });
        }
      });
    });

    kit.every(1, () => {
      const w = st.win;
      st.last = { in: w.in, done: w.done, fail: w.fail, backlog: st.queue.length, age: st.queue.length ? st.t - st.queue[0].born : 0 };
      chart.push({ backlog: st.queue.length, fail: w.fail });
      st.win = { in: 0, done: 0, fail: 0 };
      paint();
      if (watch && st.queue.length <= 3 && st.t > 2) {
        watch = false;
        kit.guided.observe(`The 300-message burst drained in about ${Math.round(st.t - watchStart)} s while 20 new messages kept arriving every second, and nothing went to the dead-letter queue.`);
      }
    });
    let watchStart = 0;

    function paint() {
      const cap = (s.cons * 1000) / s.job;
      kit.metric('cap', `${kit.fmt(cap)}/s`, s.rate > cap ? 'bad' : s.rate > cap * 0.8 ? 'warn' : 'good');
      kit.metric('dlq', String(st.dlq), st.dlq ? 'bad' : '');
      const l = st.last;
      if (!l) { for (const k of ['backlog', 'age', 'done']) kit.metric(k, '–'); return; }
      kit.metric('backlog', kit.fmt(l.backlog), l.backlog > 200 ? 'bad' : l.backlog > 30 ? 'warn' : '');
      kit.metric('age', fmtMs(l.age * 1000), l.age > 10 ? 'bad' : l.age > 2 ? 'warn' : '');
      kit.metric('done', kit.fmt(l.done));
    }

    function draw(dt) {
      stage.clear();
      const c = stage.colors, w = stage.w, H = stage.h;
      const pw = clamp(w * 0.16, 64, 96), prod = { x: Math.max(w * 0.09, pw / 2 + 8), y: H * 0.42, w: pw, h: 44 };
      const cw = clamp(w * 0.22, 80, 124), cx = w - cw / 2 - 10, qy = H * 0.42, qh = 32;
      const q0 = prod.x + pw / 2 + 16, q1 = cx - cw / 2 - 20;
      const dl = { x: (q0 + q1) / 2, y: H * 0.85, w: clamp(w * 0.24, 84, 116), h: 38 };
      const n = st.workers.length, gap = n > 6 ? 4 : 6, rh = Math.min(34, (H * 0.78 - gap * (n - 1)) / n), top = qy - (n * rh + (n - 1) * gap) / 2;
      const ry = i => top + i * (rh + gap) + rh / 2;
      stage.line(prod.x + pw / 2, qy, q0, qy, { color: c.wire, alpha: 0.35 });
      for (let i = 0; i < n; i++) stage.line(q1, qy, cx - cw / 2, ry(i), { color: c.wire, alpha: 0.35 });
      stage.line(cx - cw / 2, top + n * (rh + gap), dl.x, dl.y, { color: c.bad, alpha: 0.3, dash: [4, 4] });
      const retryPath = i => [{ x: cx - cw / 2, y: ry(i) }, { x: q1, y: qy + qh / 2 + 16 }, { x: q0 + 10, y: qy + qh / 2 + 16 }, { x: q0 + 10, y: qy }];
      const col = { in: c.wire, take: c.wire, done: c.ok, retry: c.signal, dlq: c.bad };
      st.parts = st.parts.filter(a => {
        a.t += dt;
        if (a.t >= a.dur || (a.i != null && a.i >= n)) return false;
        const k = a.t / a.dur;
        const pts = a.kind === 'in' ? [{ x: prod.x + pw / 2, y: qy }, { x: q0 + 10, y: qy }]
          : a.kind === 'take' ? [{ x: q1 - 6, y: qy }, { x: cx - cw / 2, y: ry(a.i) }]
          : a.kind === 'done' ? [{ x: cx + cw / 2 - 6, y: ry(a.i) }, { x: w - 2, y: ry(a.i) }]
          : a.kind === 'retry' ? retryPath(a.i) : [{ x: cx - cw / 2, y: ry(a.i) }, dl];
        const at = along(pts, k);
        stage.dot(at.x, at.y, 3.8, col[a.kind], a.kind === 'done' ? 1 - k : 1);
        return true;
      });
      // the queue pipe
      stage.rect(q0, qy - qh / 2, q1 - q0, qh, { fill: c.surface, stroke: c.wire, r: qh / 2 });
      const cell = 10, fit = Math.max(1, Math.floor((q1 - q0 - 20) / cell)), shown = Math.min(st.queue.length, fit);
      for (let i = 0; i < shown; i++) { stage.ctx.fillStyle = st.queue[i].tries ? c.signal : c.wire; stage.ctx.fillRect(q1 - 14 - i * cell, qy - 4, 8, 8); }
      stage.text(st.queue.length ? `${kit.fmt(st.queue.length)} waiting` : 'Queue empty', (q0 + q1) / 2, qy - qh / 2 - 12, { size: 11.5, weight: 600, align: 'center' });
      stage.text('head', q1 - 6, qy + qh / 2 + 8, { size: 10, color: c.muted, align: 'right' });
      stage.text('tail', q0 + 6, qy + qh / 2 + 8, { size: 10, color: c.muted });
      cnode(stage, prod, 'Producers', `${s.rate} msg/s`, { size: 12 });
      cnode(stage, dl, 'Dead letters', String(st.dlq), { stroke: c.bad, subColor: st.dlq ? c.bad : c.muted, size: 12 });
      st.workers.forEach((wk, i) => {
        const x = cx - cw / 2, y = ry(i) - rh / 2;
        const prog = wk.busy ? clamp((st.t - wk.start) / Math.max(1e-6, wk.until - wk.start), 0, 1) : 0;
        stage.node(x, y, cw, rh, {
          title: (cw >= 110 ? 'Consumer ' : 'C') + (i + 1), align: 'left', size: rh < 24 ? 10.5 : 11.5,
          fill: prog, fillColor: c.ok, state: s.paused ? 'idle' : undefined,
          right: s.paused ? 'paused' : wk.busy ? 'busy' : 'idle', rightColor: c.muted,
        });
      });
    }

    no3d(kit);
    kit.loop(dt => { step(dt); draw(dt); });
    reset();

    return {
      reset() { reset(); kit.clearLog(); },
      guidedRun() {
        rate.set(20, true); s.rate = 20;
        cons.set(5, true); s.cons = 5;
        job.set(100, true); s.job = 100;
        fail.set(0, true); s.fail = 0;
        retries.set(3, true); s.retries = 3;
        pause.set(false, true); s.paused = false;
        reset(); kit.clearLog();
        unpause();
        setTimeout(() => { burst(); watch = true; watchStart = st.t; }, 800);
      },
    };
  },
};
