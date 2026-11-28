// Digital wallet: six wallets of ₹1,000 each, so the system must always hold ₹6,000.
// Model: transfers of ₹50–₹240 between two random wallets arrive at `rate` per second. Each one
// reads both balances, waits `gap` (the time between read and write), then writes.
//  - Read, then write: it writes the balances it read earlier, so a concurrent transfer on the same
//    wallet is overwritten (lost update) and money is created or destroyed.
//  - Lock both wallets: a transfer starts only when neither wallet is locked; others wait in line.
//  - Double-entry ledger: on commit it appends a debit and an equal credit row; balances are the
//    sum of the rows, so nothing is ever overwritten.
// A transfer is refused when the payer (as read, or as summed for the ledger) cannot afford it.

import { inr, fixedStep, clamp, unpause, hide3dButton } from './_d-util.js';

const N = 6;
const START = 1000;
const NAMES = ['Asha', 'Ravi', 'Meera', 'Kabir', 'Zoya', 'Dev'];
const MODE_NAME = { none: 'read, then write', lock: 'lock both wallets', ledger: 'double-entry ledger' };

function wallets(mode, gap) {
  const w = { mode, gap, bal: Array(N).fill(START), locks: new Set(), pending: [], waiting: [], rows: 0, done: 0, failed: 0, lost: 0, start: START * N };
  w.total = () => w.bal.reduce((a, b) => a + b, 0);
  const begin = (x, t) => { x.readFrom = w.bal[x.from]; x.readTo = w.bal[x.to]; x.end = t + w.gap; w.pending.push(x); };
  w.transfer = (from, to, amt, t) => {
    const x = { from, to, amt };
    if (w.mode === 'lock' && (w.locks.has(from) || w.locks.has(to))) { w.waiting.push(x); return 'waiting'; }
    if (w.mode === 'lock') { w.locks.add(from); w.locks.add(to); }
    begin(x, t);
    return 'started';
  };
  w.tick = t => {
    const out = { lostUpdates: 0 };
    for (const x of w.pending.filter(q => q.end <= t)) {
      w.pending.splice(w.pending.indexOf(x), 1);
      if (w.mode === 'ledger') {
        if (w.bal[x.from] < x.amt) w.failed++;
        else { w.rows += 2; w.bal[x.from] -= x.amt; w.bal[x.to] += x.amt; w.done++; }
      } else if (x.readFrom < x.amt) w.failed++;
      else {
        if (w.bal[x.from] !== x.readFrom || w.bal[x.to] !== x.readTo) { out.lostUpdates++; w.lost++; }
        w.bal[x.from] = x.readFrom - x.amt;
        w.bal[x.to] = x.readTo + x.amt;
        w.done++;
      }
      if (w.mode === 'lock') { w.locks.delete(x.from); w.locks.delete(x.to); }
    }
    if (w.mode === 'lock') {
      for (const x of w.waiting.slice()) {
        if (w.locks.has(x.from) || w.locks.has(x.to)) continue;
        w.waiting.splice(w.waiting.indexOf(x), 1);
        w.locks.add(x.from); w.locks.add(x.to);
        begin(x, t);
      }
    }
    return out;
  };
  return w;
}

export default {
  lead: 'Six wallets begin with ₹1,000 each, so the system must hold exactly ₹6,000 forever: a transfer moves money, it never makes or destroys it. Each transfer reads two balances, checks them and writes them back. When two transfers touch the same wallet at the same moment, the naive approach loses one of the writes and the total drifts.',
  emptyLog: 'Nothing yet. Watch the total under “Read, then write”.',
  tryThis: [
    'Under <b>Read, then write</b>, keep an eye on the total. Two transfers read the same balance and the later write erases the earlier one, so money appears or disappears.',
    'Pick <b>Lock both wallets</b>. The total holds at ₹6,000, but transfers touching a busy wallet queue up (take the locks in a fixed order or you risk a deadlock).',
    'Pick <b>Double-entry ledger</b>. Each transfer adds a debit row and an equal credit row. Nothing is overwritten, balances are sums, and the books always balance.',
  ],
  inShort: {
    what: 'A wallet holds money for each user and moves it between them; every transfer has to take from one account exactly what it adds to the other.',
    why: 'Transfers that run at the same time on one account can overwrite each other and silently create or destroy money unless the writes are protected.',
    tradeoff: 'Locking is easy but forces a busy account to process transfers one by one. An append-only double-entry ledger scales and leaves an audit trail, but balances must be summed or cached.',
    interview: 'I would write paired double-entry ledger rows in one transaction, check funds with SELECT … FOR UPDATE on the balance row, and attach an idempotency key to every transfer.',
  },
  quiz: [
    { q: 'Two transfers both read a wallet balance of ₹500 at the same instant, each takes off ₹100 and saves. What balance remains?', o: ['₹300', '₹400, so ₹100 has vanished from the books', '₹500', '₹600'], a: 1,
      why: 'Each one saves 500 − 100 = 400, and the second save replaces the first. That is the lost-update race.' },
    { q: 'Why should a transfer always lock the two wallets in the same order, such as the lower id first?', o: ['It runs faster', 'So that two opposite transfers can never each hold one lock and wait on the other forever', 'It uses less memory', 'Regulators insist on it'], a: 1,
      why: 'A→B taking A then B while B→A takes B then A can deadlock. One global order removes the cycle.' },
    { q: 'What keeps a double-entry ledger safe?', o: ['Encryption', 'Every transfer appends a debit and a matching credit and never overwrites, so all entries add up to zero', 'Old rows get deleted', 'It runs on a single server'], a: 1,
      why: 'Paired, append-only rows leave an audit trail and balances are derived from them, so money cannot quietly appear or vanish.' },
  ],
  guided: {
    intro: 'Run many overlapping transfers with no protection and watch the total.',
    example: '“Run the guided example” resets to read, then write, with 20 transfers per second and 600 ms between each read and its write.',
    question: 'What happens to the total, which should stay at ₹6,000?',
    predictions: ['It drifts away from ₹6,000 within seconds.', 'It stays at exactly ₹6,000.', 'It only falls when a transfer is refused.'],
    correctPrediction: 0,
    running: 'Watch the green total line on the diagram and the “Created or lost” number.',
    observation: 'Overlapping transfers overwrote each other\'s balances and the total moved away from ₹6,000.',
    explainQuestion: 'Where did the money come from or go?',
    explanations: ['A transfer wrote back a balance it had read before another transfer changed it, wiping out that change.', 'Refused transfers keep the money.', 'Rounding errors in the amounts.'],
    correctExplanation: 0,
    why: 'Read-modify-write without a lock or an atomic append is a race. Locks serialise it; a ledger avoids overwriting entirely.',
    retryHint: 'Look for “lost update” lines in the event log.',
    nextSlug: 'upi-payments',
    nextLabel: 'Next experiment: instant bank payments →',
    waitSeconds: 8,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { mode: 'none', rate: 8, gap: 0.3 };
    let st;

    kit.metrics([
      { key: 'total', label: 'Total money (should be ₹6,000)' }, { key: 'drift', label: 'Created or lost' },
      { key: 'done', label: 'Transfers done' }, { key: 'fail', label: 'Refused: not enough money' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'total', label: 'Total money', color: 'ok' }, { key: 'target', label: '₹6,000 target', color: 'muted' }],
      format: v => inr(v),
    });

    const p = kit.panel;
    const mode = p.seg('How transfers are written', { options: [['none', 'Read, then write'], ['lock', 'Lock both wallets'], ['ledger', 'Double-entry ledger']], value: 'none',
      onChange: v => { s.mode = v; reset(); kit.log(`Restarted with ${MODE_NAME[v]}: every wallet back to ₹1,000`); } });
    const rate = p.slider('Transfers per second', { min: 1, max: 20, step: 1, value: 8, format: v => `${v} /s`, onInput: v => { s.rate = v; } });
    const gap = p.slider('Time between read and write', { min: 0.05, max: 1, step: 0.05, value: 0.3, format: v => `${Math.round(v * 1000)} ms`, onInput: v => { s.gap = v; } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    function reset() {
      st = { t: 0, acc: 0, w: wallets(s.mode, s.gap), hist: [], lostWin: 0, lostLogAt: -9, firstLost: false, guided: false };
      kit.resetTime();
      chart.reset();
      kit.clearLog();
      paint();
    }

    function step(dt) {
      st.t += dt;
      const w = st.w;
      w.gap = s.gap;
      st.acc += s.rate * dt;
      while (st.acc >= 1) {
        st.acc -= 1;
        const a = Math.floor(Math.random() * N);
        let b = Math.floor(Math.random() * (N - 1));
        if (b >= a) b++;
        w.transfer(a, b, 50 + Math.floor(Math.random() * 20) * 10, st.t);
      }
      const r = w.tick(st.t);
      if (r.lostUpdates) {
        st.lostWin += r.lostUpdates;
        if (!st.firstLost) { st.firstLost = true; kit.log('Lost update: a transfer wrote back balances it had read before another transfer changed them'); }
        if (st.guided && w.total() !== w.start) {
          st.guided = false;
          kit.guided.observe(`Within ${st.t.toFixed(1)} s the total reached ${inr(w.total())}: overlapping transfers overwrote each other's balances.`);
        }
      }
      if (!st.hist.length || st.t - st.hist[st.hist.length - 1].t >= 0.25) { st.hist.push({ t: st.t, v: w.total() }); if (st.hist.length > 120) st.hist.shift(); }
    }

    function everySecond() {
      const w = st.w;
      if (st.lostWin && st.t - st.lostLogAt >= 4) {
        const d = w.total() - w.start;
        kit.log(`${st.lostWin} lost update${st.lostWin > 1 ? 's' : ''} recently; the books are now ${d === 0 ? 'balanced by luck' : (d > 0 ? inr(d) + ' over' : inr(-d) + ' short')}`);
        st.lostWin = 0; st.lostLogAt = st.t;
      }
      if (s.mode === 'lock' && w.waiting.length >= 5 && Math.round(st.t) % 4 === 0) kit.log(`${w.waiting.length} transfers queued, waiting for a wallet lock to be released`);
      chart.push({ total: w.total(), target: w.start });
      paint();
    }

    function paint() {
      const w = st.w, tot = w.total(), d = tot - w.start;
      kit.metric('total', inr(tot), d ? 'bad' : 'good');
      kit.metric('drift', d ? (d > 0 ? '+' : '') + inr(d) : 'none', d ? 'bad' : 'good');
      kit.metric('done', String(w.done));
      kit.metric('fail', String(w.failed));
    }

    function draw() {
      stage.clear();
      const c = stage.colors, w = st.w, W = stage.w, H = stage.h, small = W < 520;
      const top = 22, barH = H * (small ? 0.32 : 0.42), colW = (W - 24) / N, base = top + barH;
      const max = Math.max(3000, ...w.bal);
      const busy = new Set();
      w.pending.forEach(x => { busy.add(x.from); busy.add(x.to); });
      for (let i = 0; i < N; i++) {
        const b = w.bal[i], x = 12 + i * colW + colW * 0.15, bw = colW * 0.7, bh = barH * clamp(b / max, 0, 1);
        const col = w.mode === 'lock' && w.locks.has(i) ? c.signal : busy.has(i) ? c.wire : c.ok;
        stage.ctx.save(); stage.ctx.globalAlpha = 0.85;
        stage.rect(x, base - bh, bw, Math.max(2, bh), { fill: col, r: 4 });
        stage.ctx.restore();
        stage.text(inr(b), x + bw / 2, base - bh - 3, { size: small ? 9.5 : 11, weight: 600, align: 'center', baseline: 'bottom' });
        stage.text(NAMES[i], x + bw / 2, base + 4, { size: small ? 9.5 : 10.5, color: c.muted, align: 'center', baseline: 'top' });
        if (w.mode === 'lock' && w.locks.has(i) && !small) stage.text('locked', x + bw / 2, base + 17, { size: 10, color: c.signal, align: 'center', baseline: 'top' });
      }
      for (const x of w.pending) {
        const x1 = 12 + (x.from + 0.5) * colW, x2 = 12 + (x.to + 0.5) * colW;
        const k = clamp(1 - (x.end - st.t) / Math.max(0.01, w.gap), 0, 1);
        const y0 = base + (small ? 22 : 34), bend = small ? 10 : 18;
        const ctx = stage.ctx;
        ctx.save(); ctx.globalAlpha = 0.5; ctx.strokeStyle = c.wire; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(x1, y0); ctx.quadraticCurveTo((x1 + x2) / 2, y0 + bend, x2, y0); ctx.stroke(); ctx.restore();
        stage.dot(x1 + (x2 - x1) * k, y0 + bend * 2 * k * (1 - k), 3.5, c.signal);
      }
      const y1 = H * (small ? 0.8 : 0.78), y2 = H - 8, hist = st.hist;
      if (hist.length > 1) {
        const lo = Math.min(w.start * 0.8, ...hist.map(q => q.v)), hi = Math.max(w.start * 1.2, ...hist.map(q => q.v));
        const X = i => 12 + (i * (W - 24)) / 119, Y = v => y2 - ((v - lo) / (hi - lo)) * (y2 - y1);
        stage.line(12, Y(w.start), W - 12, Y(w.start), { color: c.line, dash: [4, 4] });
        stage.path(hist.map((q, i) => [X(i), Y(q.v)]), { color: hist[hist.length - 1].v === w.start ? c.ok : c.bad, width: 2 });
        stage.text(small ? 'total money (dashed = ₹6,000)' : 'total money over time (dashed = ₹6,000)', 12, y1 - 2, { size: 10, color: c.muted, baseline: 'bottom' });
      }
      if (w.mode === 'ledger') stage.text(`${w.rows} ledger rows, each pair sums to 0`, W - 12, 4, { size: 10, color: c.muted, align: 'right', baseline: 'top' });
      else if (w.mode === 'lock' && w.waiting.length) stage.text(`${w.waiting.length} waiting for a lock`, W - 12, 4, { size: 10, color: c.signal, align: 'right', baseline: 'top' });
    }

    const fixed = fixedStep(step);
    kit.loop(dt => { fixed(dt); draw(); });
    kit.every(1, everySecond);
    hide3dButton(kit);
    reset();

    return {
      reset,
      guidedRun() {
        mode.set('none', true); s.mode = 'none';
        rate.set(20, true); s.rate = 20;
        gap.set(0.6, true); s.gap = 0.6;
        reset();
        st.guided = true;
        kit.log('Guided run: read, then write, 20 transfers/s, 600 ms between read and write');
        unpause();
      },
    };
  },
};
