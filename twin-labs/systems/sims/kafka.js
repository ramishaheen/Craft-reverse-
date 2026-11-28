// Kafka: a topic split into partitions, a producer and consumer groups with offsets.
// Model: the producer appends `rate` messages per second, each carrying one of six user keys.
// With keys on, partition = hash(key) mod partitions; with keys off, messages go round robin.
// Group A: each partition is owned by exactly one live consumer (partition i → consumer i mod n);
// a consumer reads `speed` msg/s from its partitions, always from the one with the most lag.
// A crashed consumer stops heartbeating; after 1 s the group notices and rebalances, pausing all
// reading for 1.5 s, then partitions are reassigned. Joins and leaves also trigger a rebalance.
// Group B (analytics) reads every partition at 5 msg/s with its own offsets and can rewind.
// Each partition keeps its last 300 messages (retention); lag = log end − committed offset.

import { fixedStep, addLegend, addLesson, unpause, no3d, clamp, ease, hashStr } from './_b-kit.js';

const KEYS = ['user-12', 'user-24', 'user-40', 'user-45', 'user-51', 'user-53'];
const HUES = [212, 36, 152, 348, 276, 188];
const RATES = [1, 2, 3, 4, 6, 8, 10, 15, 20, 30, 40];
const B_SPEED = 5, RETAIN = 300, NOTICE_S = 1, REBALANCE_S = 1.5;
const BASE = { P: 3, C: 3, rate: 4, speed: 4, keyed: true, B: false };

const LESSON = [
  { t: 'A topic is a log', d: 'Watch the producer add coloured messages to the end of each partition.', set: BASE,
    b: 'Kafka keeps events in a <b>topic</b>, here named <code>orders</code>. The topic is split into <b>partitions</b>, and each partition is an append-only log: new messages are added at the end and never edited. Every message gets a position number, its <b>offset</b>.' },
  { t: 'Keys choose the partition', d: 'Switch <b>Use message keys</b> off, then back on. Follow where each colour lands.', set: BASE, focus: 'keyed',
    b: 'Every message here has a key, a user ID shown as a colour. Kafka hashes the key to pick the partition, so all of one user’s events go to the same partition, in order. Without keys, messages are dealt out round robin and one user’s events spread over several partitions with no order between them.' },
  { t: 'Consumer groups split the work', d: 'Drag <b>Consumers in group A</b> to 4 and spot the idle one.', set: BASE, focus: 'cons',
    b: 'The consumers of one group divide the partitions between them: each partition is read by exactly one consumer of the group. So the partition count limits how many consumers can work in parallel. With 3 partitions, a fourth consumer gets nothing.' },
  { t: 'Consumer lag', d: 'Turn the <b>Producer rate</b> up to 20 msg/s and watch lag rise. Then add partitions and consumers to catch up.', set: BASE, focus: 'rate',
    b: 'The ▼ marker shows how far group A has read in each partition, its committed offset. Faded messages have been read but are still stored. When producers write faster than consumers read, the gap widens. That gap, the consumer lag, is the most important Kafka health number.' },
  { t: 'Crashes and rebalancing', d: 'Press <b>Crash a consumer</b> and read “What just happened”.', set: BASE, focus: 'crash',
    b: 'Consumers send heartbeats. When one goes quiet, the group pauses briefly and gives its partitions to the survivors. Nothing is lost: the new owner carries on from the last committed offset.' },
  { t: 'Reading does not delete', d: 'Turn on <b>Analytics group B</b>, then press <b>Replay group B from start</b>.', set: BASE, focus: 'B',
    b: 'Unlike a classic queue, Kafka keeps messages for a retention period (often days) after they are read. A second group, analytics here, reads the same log independently with its own offsets, and can rewind to replay older messages.' },
  { t: 'Kafka or a queue?', d: 'Free play: every control is yours.', set: null,
    b: 'Pick Kafka for event streams read by many systems, for replays, and for high throughput with ordering per key. Pick a queue such as RabbitMQ or SQS for jobs that should be done once and then removed. In an interview, mention partitions for scale, keys for ordering, consumer groups for parallelism and lag for health.' },
];

export default {
  lead: 'Producers append events to partitioned logs, and consumer groups read them at their own pace. Follow the seven steps, or jump between them with the dots.',
  emptyLog: 'Nothing yet. Try crashing a consumer.',
  stageHeight: 400,
  tryThis: [
    'With 3 partitions, set <b>Consumers in group A</b> to 5. Two consumers sit idle: a group cannot use more consumers than there are partitions.',
    'Turn <b>message keys</b> off and watch one user’s colour spread across every partition, so its events lose their order.',
    'Raise the <b>producer rate</b> until lag climbs, then <b>crash a consumer</b>: lag jumps during the rebalance, and the survivors pick up from the committed offsets.',
  ],
  inShort: {
    what: 'Kafka is a log divided into partitions; producers append to it and every consumer group tracks its own read position, the offset.',
    why: 'Many systems can read the same events independently and replay them, at very high throughput.',
    tradeoff: 'Ordering only holds within one partition, and a group can never have more busy consumers than the topic has partitions.',
    interview: 'I key events by order ID so every event for an order lands in one partition and stays in order.',
  },
  quiz: [
    { q: 'A topic has 3 partitions and a consumer group has 5 consumers. How many consumers are idle?', o: ['0', '1', '2', '3'], a: 2,
      why: 'Within a group each partition goes to exactly one consumer, so only 3 of them can have work.' },
    { q: 'How does Kafka keep every event of one user in order?', o: ['By ordering the whole topic globally', 'By using the user ID as the message key, so all of them go to one partition', 'With timestamps', 'By having a single consumer'], a: 1,
      why: 'Order is guaranteed per partition, and the key decides which partition a message goes to.' },
    { q: 'What is consumer lag?', o: ['Network delay to the broker', 'How far a group’s committed offset trails the end of the log', 'How long a rebalance takes', 'Disk latency'], a: 1,
      why: 'It counts messages that were written but not processed yet, and it is the key health metric for Kafka.' },
  ],
  guided: {
    intro: 'Add a fourth consumer to a group reading a topic that has three partitions.',
    example: '“Run the guided example” resets to 3 partitions, 3 consumers, 4 msg/s and keys on, then adds one consumer to group A.',
    question: 'What does the fourth consumer do after the rebalance?',
    predictions: ['It sits idle, because every partition already has an owner.', 'It takes a quarter of the work, so the group reads a third faster.', 'It shares partition P0 with consumer C1.'],
    correctPrediction: 0,
    running: 'Watch the consumer boxes on the right: the group pauses to rebalance, then shows which partitions each consumer owns.',
    observation: 'After the rebalance C4 had no partition and stayed idle.',
    explainQuestion: 'Why can’t the fourth consumer help?',
    explanations: ['Within one group a partition is read by only one consumer, so parallelism is capped by the partition count.', 'New consumers must wait an hour before reading.', 'The producer only writes to three consumers.'],
    correctExplanation: 0,
    why: 'To read faster you add partitions and consumers together; consumers beyond the partition count are spares.',
    retryHint: 'Read the “Rebalance finished” line in the log: it lists what each consumer owns.',
    nextSlug: 'realtime',
    nextLabel: 'Next experiment: real-time updates →',
    waitSeconds: 8,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { ...BASE, rate: 4 };
    let st, ready = false, watch = false;

    const isDark = () => { const m = /^#?([0-9a-f]{6})$/i.exec(stage.colors.bg || ''); if (!m) return true; const n = parseInt(m[1], 16); return ((n >> 16) + ((n >> 8) & 255) + (n & 255)) / 3 < 128; };
    const keyCol = i => (isDark() ? `hsl(${HUES[i]} 70% 64%)` : `hsl(${HUES[i]} 62% 44%)`);

    kit.metrics([
      { key: 'in', label: 'Produced / s' }, { key: 'a', label: 'Group A reads / s' }, { key: 'lag', label: 'Group A lag' },
      { key: 'idle', label: 'Idle consumers' }, { key: 'blag', label: 'Group B lag' },
    ]);
    const chart = kit.chart({ lines: [{ key: 'lag', label: 'Group A lag', color: 'wire' }, { key: 'blag', label: 'Group B lag', color: 'violet' }], format: v => `${kit.fmt(Math.round(v))} msgs` });
    const legend = addLegend(kit, []);
    const paintLegend = () => legend.set([...KEYS.map((k, i) => [keyCol(i), k, 'box']), ['ink', '▼ group A has read up to here'], ...(s.B ? [['violet', '▲ group B']] : [])]);
    paintLegend();
    const onTheme = () => paintLegend();
    window.addEventListener('themechange', onTheme);
    kit.onCleanup(() => window.removeEventListener('themechange', onTheme));

    const p = kit.panel;
    const parts = p.slider('Partitions', { min: 1, max: 8, step: 1, value: s.P, hint: 'Changing this recreates the topic. Real Kafka can add partitions but never remove them.',
      onInput: v => { s.P = v; if (ready) { reset(); kit.log(`Topic recreated with ${v} partition${v > 1 ? 's' : ''}: ${owners()}`); } } });
    const cons = p.slider('Consumers in group A', { min: 1, max: 8, step: 1, value: s.C, onInput: v => setConsumers(v) });
    const rate = p.slider('Producer rate', { values: RATES, value: s.rate, format: v => `${v} msg/s`, onInput: v => { s.rate = v; } });
    const speed = p.slider('Speed of each consumer', { min: 1, max: 20, step: 1, value: s.speed, format: v => `${v} msg/s`, onInput: v => { s.speed = v; } });
    const keyed = p.toggle('Use message keys (user ID)', { value: true, onChange: v => { s.keyed = v; kit.log(v ? 'Keys on: each user’s events always land in the same partition' : 'Keys off: messages are dealt round robin, so one user’s events scatter'); } });
    const groupB = p.toggle('Analytics group B', { value: false, onChange: v => setB(v, true) });
    const btns = p.buttons([
      { label: 'Crash a consumer', kind: 'primary', onClick: crash },
      { label: 'Replay group B from start', kind: 'outline', onClick: replay },
      { label: 'Reset', kind: 'outline', onClick: () => reset() },
    ]);
    const replayBtn = btns.buttons[1];
    replayBtn.disabled = true;

    function reset() {
      st = { t: 0, acc: 0, bAcc: 0, rr: 0, reb: 0, nextC: 1, parts: [], cons: [], w: { in: 0, a: 0 }, last: null, anims: [] };
      for (let i = 0; i < s.P; i++) st.parts.push({ log: [], end: 0, commit: 0, bOff: 0, owner: null });
      for (let i = 0; i < s.C; i++) st.cons.push({ name: `C${st.nextC++}`, alive: true, acc: 0 });
      assign();
      kit.resetTime();
      chart.reset();
      paint();
      ready = true;
    }
    function assign() { const live = st.cons.filter(c => c.alive); st.parts.forEach((pt, i) => { pt.owner = live.length ? live[i % live.length] : null; }); }
    function owners() {
      return st.cons.filter(c => c.alive).map(c => { const mine = st.parts.map((pt, i) => (pt.owner === c ? `P${i}` : null)).filter(Boolean); return `${c.name} → ${mine.length ? mine.join(', ') : 'idle'}`; }).join('; ');
    }
    function rebalance(msg) { st.reb = st.t + REBALANCE_S; st.parts.forEach(pt => { pt.owner = null; }); kit.log(msg); }
    function setConsumers(v) {
      if (!ready) { s.C = v; return; }
      const have = st.cons.length;
      if (v === have) return;
      const names = [];
      if (v > have) { while (st.cons.length < v) { const c = { name: `C${st.nextC++}`, alive: true, acc: 0 }; st.cons.push(c); names.push(c.name); } }
      else while (st.cons.length > v) names.push(st.cons.pop().name);
      s.C = v;
      rebalance(`${names.join(', ')} ${v > have ? 'joined' : 'left'} group A, so the group rebalances`);
    }
    function setB(v, log) {
      s.B = v; replayBtn.disabled = !v; paintLegend();
      if (!ready || !log) return;
      if (v) { st.parts.forEach(pt => { pt.bOff = pt.end - pt.log.length; }); kit.log('Group B started reading from the oldest message still retained'); }
      else kit.log('Group B stopped');
    }
    function replay() {
      if (!s.B) return;
      st.parts.forEach(pt => { pt.bOff = pt.end - pt.log.length; });
      kit.log('Group B rewound its offsets to the start and is replaying old messages');
    }
    function crash() {
      const live = st.cons.filter(c => c.alive);
      if (!live.length) { kit.log('No running consumer left to crash'); return; }
      const c = live[Math.floor(Math.random() * live.length)];
      c.alive = false; c.deadAt = st.t;
      kit.log(`${c.name} crashed. Its partitions stand still until the group notices`);
    }

    const step = fixedStep(dt => {
      st.t += dt;
      if (st.reb && st.t >= st.reb) {
        st.reb = 0; assign();
        kit.log(`Rebalance finished: ${owners()}`);
        if (watch) {
          const idle = st.cons.filter(c => c.alive && !st.parts.some(pt => pt.owner === c)).map(c => c.name);
          if (idle.length) { watch = false; kit.guided.observe(`After the rebalance ${idle.join(', ')} had no partition to read: ${owners()}.`); }
        }
      }
      for (const c of st.cons.slice()) {
        if (!c.alive && st.t - c.deadAt >= NOTICE_S) {
          st.cons.splice(st.cons.indexOf(c), 1);
          s.C = Math.max(1, st.cons.length); cons.set(s.C, true);
          rebalance(`${c.name} stopped sending heartbeats, so the group pauses and rebalances`);
        }
      }
      st.acc += s.rate * dt;
      const n = Math.floor(st.acc);
      st.acc -= n;
      for (let i = 0; i < n; i++) {
        const k = Math.floor(Math.random() * KEYS.length);
        const pi = s.keyed ? hashStr(KEYS[k]) % st.parts.length : st.rr++ % st.parts.length;
        const pt = st.parts[pi];
        pt.log.push({ o: pt.end, k }); pt.end++;
        if (pt.log.length > RETAIN) pt.log.shift();
        st.w.in++;
        st.anims.push({ type: 'in', p: pi, k, t: 0, dur: 0.5 });
      }
      for (const pt of st.parts) { const first = pt.end - pt.log.length; if (pt.commit < first) pt.commit = first; if (pt.bOff < first) pt.bOff = first; }
      if (!st.reb) {
        for (const c of st.cons) {
          if (!c.alive) continue;
          const mine = st.parts.filter(pt => pt.owner === c);
          if (!mine.length) { c.acc = 0; continue; }
          c.acc += s.speed * dt;
          while (c.acc >= 1) {
            let best = null;
            for (const pt of mine) if (pt.commit < pt.end && (!best || pt.end - pt.commit > best.end - best.commit)) best = pt;
            if (!best) { c.acc = Math.min(c.acc, 1); break; }
            const m = best.log[best.commit - (best.end - best.log.length)];
            best.commit++; c.acc--; st.w.a++;
            if (Math.random() < 0.6) st.anims.push({ type: 'out', p: st.parts.indexOf(best), c, k: m ? m.k : 0, t: 0, dur: 0.45 });
          }
        }
      }
      if (s.B) {
        st.bAcc += B_SPEED * dt;
        while (st.bAcc >= 1) {
          let best = null;
          for (const pt of st.parts) if (pt.bOff < pt.end && (!best || pt.end - pt.bOff > best.end - best.bOff)) best = pt;
          if (!best) { st.bAcc = Math.min(st.bAcc, 1); break; }
          best.bOff++; st.bAcc--;
        }
      }
    });

    kit.every(1, () => {
      const live = st.cons.filter(c => c.alive);
      st.last = {
        in: st.w.in, a: st.w.a,
        lag: st.parts.reduce((a, pt) => a + pt.end - pt.commit, 0),
        blag: st.parts.reduce((a, pt) => a + pt.end - pt.bOff, 0),
        idle: st.reb ? 0 : live.filter(c => !st.parts.some(pt => pt.owner === c)).length,
      };
      st.w = { in: 0, a: 0 };
      chart.push({ lag: st.last.lag, blag: s.B ? st.last.blag : null });
      paint();
    });

    function paint() {
      const l = st.last;
      if (!l) { for (const k of ['in', 'a', 'lag', 'idle', 'blag']) kit.metric(k, '–'); return; }
      kit.metric('in', String(l.in));
      kit.metric('a', String(l.a));
      kit.metric('lag', kit.fmt(l.lag), l.lag > 60 ? 'bad' : l.lag > 15 ? 'warn' : 'good');
      kit.metric('idle', String(l.idle), l.idle ? 'warn' : '');
      kit.metric('blag', s.B ? kit.fmt(l.blag) : 'off', s.B && l.blag > 60 ? 'warn' : '');
    }

    function draw(dt) {
      stage.clear();
      const c = stage.colors, ctx = stage.ctx, w = stage.w, H = stage.h;
      const top = 34, pw = clamp(w * 0.16, 58, 84), cw = clamp(w * 0.19, 62, 104), ccx = w - cw / 2 - 8, bot = s.B ? 52 : 14;
      const np = st.parts.length, pg = np > 5 ? 6 : 9, ph = Math.min(38, (H - top - bot - pg * (np - 1)) / np);
      const py0 = top + (H - top - bot - (np * ph + (np - 1) * pg)) / 2;
      const prod = { x: pw / 2 + 8, y: py0 + (np * ph + (np - 1) * pg) / 2, w: pw, h: 46 };
      const lx0 = prod.x + pw / 2 + 16, lx1 = ccx - cw / 2 - 22, cell = Math.max(6, Math.min(14, ph - 14)), step = cell + 3, bx0 = lx0 + 26;
      const fit = Math.max(1, Math.floor((lx1 - bx0 - 34) / step));
      stage.text(`Topic “orders”, ${np} partition${np > 1 ? 's' : ''}`, lx0, 16, { size: 12, weight: 600 });
      if (st.reb) stage.text('Rebalancing: group paused', w - 8, 16, { size: 12, weight: 600, color: c.signal, align: 'right' });
      const nc = st.cons.length, cg = 6, ch = Math.min(36, (H - top - bot - cg * Math.max(0, nc - 1)) / Math.max(nc, 1));
      const cy0 = top + (H - top - bot - (nc * ch + (nc - 1) * cg)) / 2;
      const cpos = new Map();
      st.cons.forEach((cn, i) => cpos.set(cn, { x: ccx - cw / 2, y: cy0 + i * (ch + cg) + ch / 2 }));
      const rows = st.parts.map((pt, i) => { const y = py0 + i * (ph + pg); return { pt, y, from: Math.max(pt.end - fit, pt.end - pt.log.length, 0), mid: y + ph / 2 }; });
      for (const r of rows) {
        stage.line(prod.x + pw / 2, prod.y, lx0, r.mid, { color: c.wire, alpha: 0.35 });
        if (r.pt.owner && cpos.has(r.pt.owner)) { const q = cpos.get(r.pt.owner); stage.line(lx1, r.mid, q.x, q.y, { color: c.wire, alpha: 0.35 }); }
      }
      rows.forEach((r, i) => {
        const pt = r.pt;
        stage.rect(lx0, r.y, lx1 - lx0, ph, { fill: c.surface, stroke: c.line, r: 7, width: 1 });
        stage.text(`P${i}`, lx0 + 6, r.mid, { size: 11, weight: 700, color: c.muted });
        const first = pt.end - pt.log.length;
        for (let o = r.from; o < pt.end; o++) {
          const m = pt.log[o - first];
          if (!m) continue;
          ctx.save(); ctx.globalAlpha = o < pt.commit ? 0.28 : 1;
          stage.rect(bx0 + (o - r.from) * step, r.mid - cell / 2, cell, cell, { fill: keyCol(m.k), r: 3 });
          ctx.restore();
        }
        const ax = bx0 + (Math.max(pt.commit, r.from) - r.from) * step - 1.5;
        stage.path([[ax - 4, r.y + 1], [ax + 4, r.y + 1], [ax, r.y + 7]], { close: true, fill: c.ink, color: null });
        if (s.B) { const bxm = bx0 + (Math.max(pt.bOff, r.from) - r.from) * step - 1.5; stage.path([[bxm - 4, r.y + ph - 1], [bxm + 4, r.y + ph - 1], [bxm, r.y + ph - 7]], { close: true, fill: c.violet, color: null }); }
        const lag = pt.end - pt.commit;
        stage.text(ph >= 26 ? `lag ${lag}` : String(lag), lx1 - 6, r.mid, { size: 10.5, weight: 600, align: 'right', color: lag > 20 ? c.bad : lag > 6 ? c.signal : c.muted });
        if (ph >= 30) stage.text(`offset ${Math.max(0, pt.end - 1)}`, bx0, r.y + ph - 5, { size: 9, color: c.muted });
      });
      st.anims = st.anims.filter(a => {
        a.t += dt;
        if (a.t >= a.dur) return false;
        const r = rows[a.p];
        if (!r) return false;
        const k = ease(a.t / a.dur);
        let from, to;
        if (a.type === 'in') { from = { x: prod.x + pw / 2, y: prod.y }; to = { x: bx0 + Math.min(fit - 1, r.pt.end - 1 - r.from) * step + cell / 2, y: r.mid }; }
        else { if (!cpos.has(a.c)) return false; from = { x: bx0 + (Math.max(r.pt.commit - 1, r.from) - r.from) * step + cell / 2, y: r.mid }; to = cpos.get(a.c); }
        stage.dot(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, 4, keyCol(a.k));
        return true;
      });
      stage.node(prod.x - pw / 2, prod.y - 23, pw, 46, { title: 'Producer', sub: `${s.rate} msg/s`, size: 12 });
      for (const cn of st.cons) {
        const q = cpos.get(cn), mine = st.parts.map((pt, i) => (pt.owner === cn ? `P${i}` : null)).filter(Boolean), idle = cn.alive && !st.reb && !mine.length;
        stage.node(q.x, q.y - ch / 2, cw, ch, {
          title: cn.name, align: 'left', size: ch < 24 ? 10 : 11.5, dashed: idle || !!st.reb,
          state: !cn.alive ? 'dead' : idle ? 'idle' : undefined,
          right: cn.alive ? (st.reb ? 'paused' : idle ? 'idle' : mine.join(',')) : 'crashed',
          rightColor: cn.alive ? (idle ? c.signal : c.muted) : c.bad,
        });
      }
      if (nc) stage.text('Group A', ccx, cy0 - 11, { size: 10.5, color: c.muted, align: 'center' });
      if (s.B) {
        const y = H - bot + 12;
        stage.rect(lx0, y, lx1 - lx0, 30, { fill: c.surface, stroke: c.violet, r: 7, dash: [4, 3] });
        stage.text(`Group B: analytics reads every partition, ${B_SPEED} msg/s`, (lx0 + lx1) / 2, y + 15, { size: 11.5, weight: 600, align: 'center' });
      }
    }

    function apply(set) {
      ready = false;
      Object.assign(s, set);
      parts.set(s.P, true); cons.set(s.C, true); rate.set(s.rate, true); speed.set(s.speed, true); keyed.set(s.keyed, true); groupB.set(s.B, true);
      setB(s.B, false);
      reset();
    }
    const focusEl = { keyed: keyed.el, cons: cons.el, rate: rate.el, crash: btns.buttons[0], B: groupB.el };
    no3d(kit);
    kit.loop(dt => { step(dt); draw(dt); });
    reset();
    addLesson(kit, LESSON, { apply: st0 => { if (st0.set) { apply(st0.set); kit.clearLog(); } }, focus: st0 => focusEl[st0.focus] }).go(0);

    return {
      reset() { apply(BASE); kit.clearLog(); },
      guidedRun() {
        apply(BASE); kit.clearLog();
        unpause();
        setTimeout(() => { cons.set(4, true); setConsumers(4); watch = true; }, 1000);
      },
    };
  },
};
