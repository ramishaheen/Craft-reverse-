// Database deadlock: transfers between 4 busy accounts (rows A–D), each locking two rows.
// Model: transfers start at the chosen rate between two random accounts. Each takes the lock on its
// first row, waits 0.3 s, then asks for the second; with both locks held it works for 0.4 s and
// commits, releasing both. "From, then to" locks in the transfer's own order; "lowest id first" sorts
// the two rows, so every transfer asks in the same global order. Every `detector interval` the
// database builds the wait-for graph (who waits for whose lock); a cycle is a deadlock and the
// youngest transaction in it is aborted, releasing its locks and retrying 0.3 s later.

import { hide3dButton, unpause } from './_a-util.js';

function makeBank({ accounts = 4, rate = 1.8, work = 0.4, gap = 0.3, detect = 1, ordered = false } = {}) {
  const B = { accounts, rate, work, gap, detect, ordered, now: 0, arr: 0, next: 1, txns: [], owner: new Array(accounts).fill(null),
    done: 0, deadlocks: 0, aborted: 0, waitSum: 0, nextDetect: detect, log: [], lastCycle: [] };
  const note = text => { B.log.unshift({ t: B.now, text }); if (B.log.length > 8) B.log.pop(); };
  B.start = () => {
    const from = Math.floor(Math.random() * B.accounts);
    let to;
    do to = Math.floor(Math.random() * B.accounts); while (to === from);
    const t = { id: B.next++, from, to, born: B.now, held: [], state: 'locking', retry: 0 };
    t.order = B.ordered ? [Math.min(from, to), Math.max(from, to)] : [from, to];
    B.txns.push(t);
  };
  const release = t => { for (const r of t.held) B.owner[r] = null; t.held = []; };
  B.cycle = () => {
    const waits = new Map();
    for (const t of B.txns) if (t.state === 'locking' && t.held.length < 2) {
      const own = B.owner[t.order[t.held.length]];
      if (own != null && own !== t.id) waits.set(t.id, own);
    }
    for (const start of waits.keys()) {
      const path = [start];
      let cur = waits.get(start);
      while (cur != null && !path.includes(cur)) { path.push(cur); cur = waits.get(cur); }
      if (cur != null) return path.slice(path.indexOf(cur));
    }
    return [];
  };
  B.tick = dt => {
    B.now += dt;
    B.arr += B.rate * dt;
    while (B.arr >= 1) { B.arr -= 1; B.start(); }
    for (const t of B.txns) {
      if (t.state === 'retry') { if (B.now >= t.retryAt) { t.state = 'locking'; t.born = B.now; } continue; }
      if (t.state === 'working') { if (B.now >= t.doneAt) { release(t); t.state = 'done'; B.done++; } continue; }
      if (t.held.length < 2 && !(t.held.length === 1 && B.now < t.nextAt)) {
        const row = t.order[t.held.length];
        if (B.owner[row] == null) { B.owner[row] = t.id; t.held.push(row); t.nextAt = B.now + B.gap; }
      }
      if (t.held.length === 2) { t.state = 'working'; t.doneAt = B.now + B.work; } else B.waitSum += dt;
    }
    B.txns = B.txns.filter(t => t.state !== 'done');
    if (B.now >= B.nextDetect) {
      B.nextDetect = B.now + B.detect;
      const cyc = B.cycle();
      if (cyc.length) {
        B.deadlocks++;
        B.lastCycle = cyc.slice();
        const victim = B.txns.filter(t => cyc.includes(t.id)).sort((a, b) => b.born - a.born)[0];
        release(victim); victim.state = 'retry'; victim.retry++; victim.retryAt = B.now + 0.3; B.aborted++;
        B.lastVictim = victim.id;
        note(`deadlock: T${cyc.join(' → T')} → T${cyc[0]}; aborted T${victim.id}, retrying`);
      }
    }
  };
  B.name = i => String.fromCharCode(65 + i);
  return B;
}

export default {
  lead: 'A transfer from A to B locks row A, then row B. At the same moment a transfer from B to A locks B, then asks for A. Each holds what the other needs and neither can finish. The deadlock detector finds the cycle, kills one transaction and the app retries it. Locking rows in one fixed order makes the cycle impossible.',
  emptyLog: 'Nothing yet. Wait for a red loop.',
  tryThis: [
    'Watch for a red loop: two transfers each holding one row and waiting for the other’s. The detector kills the younger one.',
    'Slow the detector to <b>5 s</b>. Each deadlock now freezes those rows for seconds, and the queue behind them balloons.',
    'Choose <b>Lowest id first</b>. Same transfers, same load, and not one deadlock.',
  ],
  inShort: {
    what: 'A deadlock is two or more transactions each holding a lock another one needs; the database spots the cycle and aborts one of them.',
    why: 'Busy tables with transfers, stock levels or counters run into it under load, and every abort means a retry and extra latency.',
    tradeoff: 'Frequent detection frees rows quickly but costs checking; strict lock ordering or shorter transactions prevent deadlocks but need discipline in code.',
    interview: 'Lock rows in a consistent order (SELECT … FOR UPDATE ORDER BY id), keep transactions short, and retry deadlock errors with a small backoff.',
  },
  quiz: [
    { q: 'Transfer A→B locks A then B; transfer B→A locks B then A. What can happen?', o: ['Nothing', 'Each holds one row and waits for the other forever: a deadlock', 'Both finish sooner', 'The money doubles'], a: 1,
      why: 'Opposite lock orders create a cycle in the wait-for graph.' },
    { q: 'What does the database do when it detects a deadlock?', o: ['Waits forever', 'Aborts one transaction (the victim) so the other can finish; the app should retry it', 'Restarts the server', 'Deletes the rows'], a: 1,
      why: 'Postgres and MySQL both pick a victim and return an error such as “deadlock detected”; retrying is up to the application.' },
    { q: 'How do you prevent this kind of deadlock?', o: ['More CPU', 'Always lock rows in the same order, for example lowest id first', 'Bigger disks', 'Turn transactions off'], a: 1,
      why: 'With one global order no cycle can form; keeping transactions short also narrows the window.' },
  ],
  guided: {
    intro: 'Let transfers lock rows in their own from-then-to order and wait for the first deadlock.',
    example: '“Run the guided example” resets to “From, then to”, a detector every 1 s and 2.4 transfers per second.',
    question: 'What happens when two transfers lock the same two rows in opposite order?',
    predictions: ['They block each other until the detector kills one of them.', 'The database queues them and both finish normally.', 'Both transfers are committed twice.'],
    correctPrediction: 0,
    running: 'Watch for a red loop in the diagram and the detector’s entry in “What just happened”.',
    observation: 'Two transfers each held one row and waited for the other’s; the detector found the cycle and aborted the younger one.',
    explainQuestion: 'Why could neither transfer finish on its own?',
    explanations: ['Each held the lock the other needed, so the waits formed a cycle with no way out.', 'The rows were deleted.', 'The detector locked both rows.'],
    correctExplanation: 0,
    why: 'Only breaking the cycle helps: abort a victim, or prevent cycles altogether by taking locks in one global order.',
    retryHint: 'Read the detector entry: it lists the cycle of transactions and the victim.',
    nextSlug: 'database-transactions',
    nextLabel: 'Next experiment: transactions →',
    waitSeconds: 30,
  },

  setup(kit) {
    const { stage } = kit;
    hide3dButton(kit);
    const s = { ordered: false, detect: 1, rate: 1.8 };
    let B, seen = 0, flash = 0;

    kit.metrics([{ key: 'done', label: 'Transfers committed' }, { key: 'dead', label: 'Deadlocks (one transfer killed each)' }, { key: 'wait', label: 'Average wait for locks' }, { key: 'q', label: 'Transfers waiting now' }]);

    const p = kit.panel;
    const order = p.seg('Lock order', { options: [['written', 'From, then to'], ['sorted', 'Lowest id first']], value: 'written',
      onChange: v => { s.ordered = v === 'sorted'; reset(); kit.log(s.ordered ? 'Every transfer now locks the lower account first' : 'Each transfer locks its own “from” row first, then “to”'); } });
    const det = p.slider('Deadlock detector runs every', { min: 0.2, max: 5, step: 0.2, value: 1, format: v => `${v.toFixed(1)} s`,
      onInput: v => { s.detect = v; if (B) { B.detect = v; B.nextDetect = Math.min(B.nextDetect, B.now + v); } } });
    const rate = p.slider('Transfers per second', { min: 0.4, max: 2.4, step: 0.2, value: 1.8, format: v => v.toFixed(1), hint: 'Between 4 busy accounts',
      onInput: v => { s.rate = v; if (B) B.rate = v; } });

    function reset() {
      B = makeBank({ ordered: s.ordered, detect: s.detect, rate: s.rate });
      seen = 0; flash = 0;
      kit.resetTime(); kit.clearLog(); paint();
    }
    function step(dt) {
      B.tick(dt);
      if (B.deadlocks !== seen) {
        seen = B.deadlocks; flash = 1.2;
        const cyc = B.lastCycle;
        kit.log(`Deadlock: T${cyc.join(' → T')} → T${cyc[0]} each wait for the next. T${B.lastVictim} was aborted and will retry`);
        kit.guided.observe(`T${cyc.join(' and T')} each held a row the other wanted; the detector found the cycle and aborted T${B.lastVictim}, which retried.`);
      }
      flash = Math.max(0, flash - dt);
      paint();
    }
    const waiting = () => B.txns.filter(t => t.state === 'locking' && t.held.length < 2).length;
    function paint() {
      const avg = B.done ? B.waitSum / B.done : 0, q = waiting();
      kit.metric('done', String(B.done), 'good');
      kit.metric('dead', String(B.deadlocks), B.deadlocks ? 'bad' : 'good');
      kit.metric('wait', `${avg.toFixed(1)} s`, avg > 3 ? 'bad' : avg > 0.8 ? 'warn' : 'good');
      kit.metric('q', String(q), q > 8 ? 'bad' : q > 3 ? 'warn' : '');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, ctx = stage.ctx, w = stage.w, H = stage.h, narrow = w < 520;
      const span = narrow ? w - 28 : w * 0.62, cx = 14 + span / 2, cy = H / 2, off = Math.min(H * 0.33, 90);
      const rowAt = i => ({ x: 14 + (span * (i + 0.5)) / B.accounts, y: cy });
      const shown = B.txns.filter(t => t.state !== 'retry').slice(0, 10), cols = Math.ceil(shown.length / 2) || 1, pos = new Map();
      shown.forEach((t, i) => pos.set(t.id, { x: 14 + (span * (Math.floor(i / 2) + 0.5)) / cols, y: i % 2 ? cy + off : cy - off }));
      const inCycle = new Set(flash > 0 ? B.lastCycle : []);
      for (const t of shown) {
        const q = pos.get(t.id);
        for (const r of t.held) { const a = rowAt(r); stage.line(a.x, a.y, q.x, q.y, { color: inCycle.has(t.id) ? c.bad : c.ok, width: 2.5 }); }
        if (t.state === 'locking' && t.held.length < 2) {
          const r = t.order[t.held.length];
          if (B.owner[r] != null && B.owner[r] !== t.id) { const a = rowAt(r); stage.line(q.x, q.y, a.x, a.y, { color: inCycle.has(t.id) ? c.bad : c.signal, width: 2, dash: [5, 4] }); }
        }
      }
      for (let i = 0; i < B.accounts; i++) {
        const a = rowAt(i), own = B.owner[i];
        stage.rect(a.x - 22, a.y - 16, 44, 32, { fill: c.surface, stroke: own != null ? c.wire : c.line, r: 7 });
        stage.text(B.name(i), a.x, a.y - 3, { size: 13, weight: 700, align: 'center' });
        stage.text(own != null ? `T${own}` : 'free', a.x, a.y + 9, { size: 8, color: c.muted, align: 'center' });
      }
      const rr = narrow ? 11 : 13;
      for (const t of shown) {
        const q = pos.get(t.id);
        const col = inCycle.has(t.id) ? c.bad : t.state === 'working' ? c.ok : t.held.length ? c.signal : c.muted;
        stage.ring(q.x, q.y, rr, { fill: c.surface, color: col, width: 2 });
        stage.text(`${B.name(t.from)}→${B.name(t.to)}`, q.x, q.y, { size: narrow ? 8 : 9, weight: 700, align: 'center' });
      }
      if (flash > 0) stage.text('DEADLOCK: cycle found, victim killed', cx, 14, { size: 12, weight: 700, color: c.bad, align: 'center' });
      stage.text(narrow ? 'solid = holds · dashed = waits' : 'solid line = holds the row lock · dashed = waiting for it', 14, H - 10, { size: 9, color: c.muted });
      if (narrow) return;
      const lx = 14 + span + 14, lw = w - 14 - lx;
      stage.text('detector log', lx, 14, { size: 10, color: c.muted });
      B.log.slice(0, Math.floor((H - 30) / 16)).forEach((e, i) => {
        ctx.font = `500 9px ${stage.font}`;
        let txt = e.text;
        while (ctx.measureText(txt).width > lw - 6 && txt.length > 10) txt = txt.slice(0, -2);
        stage.text(txt === e.text ? txt : txt + '…', lx, 32 + i * 16, { size: 9, color: c.bad });
      });
      if (!B.log.length) stage.text('no deadlocks so far', lx, 32, { size: 10, color: c.ok });
    }

    kit.loop(dt => { if (dt > 0) step(Math.min(dt, 0.1)); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        order.set('written', true); s.ordered = false;
        det.set(1, true); s.detect = 1;
        rate.set(2.4, true); s.rate = 2.4;
        reset();
        unpause();
        kit.log('Guided run: transfers lock “from” then “to”; waiting for a deadlock');
      },
    };
  },
};
