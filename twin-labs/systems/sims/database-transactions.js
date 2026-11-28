// Database transactions: four accounts start with ₹1,000 each, so the total must always be ₹4,000.
// Model: two transfers per second between random accounts, ₹10–₹90 each. A transfer is two updates
// (debit, then credit) and sits "in flight" for 0.4 s between them.
// - Two separate updates (autocommit): the debit is saved to disk at once; the credit 0.4 s later.
// - In a transaction: nothing is visible or saved until the commit applies both updates together.
// - Commit mode "write log to disk, then OK" (fsync) costs 6 ms per commit; "OK now, flush every
//   second" costs 1 ms but keeps acknowledged commits in memory until the next 1 s flush.
// "Pull the plug" throws away memory: balances revert to what is on disk, open transactions roll
// back, and acknowledged-but-unflushed commits are lost.

import { fixedStep, addLegend, unpause, no3d } from './_b-kit.js';

const START = 1000;
const NAMES = ['Asha', 'Bilal', 'Chen', 'Divya'];
const RATE = 2;          // transfers per second
const GAP_S = 0.4;       // time between the debit and the credit
const FLUSH_S = 1;       // async commit flush interval
const MS = { fsync: 6, async: 1 };
const rupees = v => '₹' + Math.round(v).toLocaleString('en-IN');

export default {
  lead: 'A transfer is really two updates: take money out of one account, put it into another. Kill the server between the two and see what survives. Without a transaction the first half is already saved and the money is simply gone. Inside one, both halves land together or not at all, and a commit only counts as safe once its log entry is on disk.',
  emptyLog: 'Nothing yet. Pull the plug and see what the crash leaves behind.',
  stageHeight: 340,
  tryThis: [
    'Pick <b>as two separate updates</b> and crash a few times. The total shrinks: money left one account and never reached the other.',
    'Switch back to <b>in a transaction</b> and crash again. The half-done transfers are rolled back and the total never moves. That is atomicity.',
    'Choose <b>OK now, flush every second</b> and crash. Commits get quicker, but transfers the user was told had worked disappear. That is durability.',
  ],
  inShort: {
    what: 'A transaction bundles several changes so they are committed together or not at all, and a committed change survives even if the server dies a moment later.',
    why: 'Money, stock levels and orders touch several rows at once, and a crash in the middle must never leave them half-updated.',
    tradeoff: 'Waiting for the log to be flushed to disk on every commit costs a few milliseconds. Asynchronous commit is quicker but can lose the most recent writes that were already acknowledged.',
    interview: 'BEGIN, debit, credit, COMMIT, with the write-ahead log fsynced before replying OK, retries that are idempotent, and replicas used only for reads that can be slightly stale.',
  },
  quiz: [
    { q: 'With no transaction, the server dies after the debit but before the credit. What is the result?', o: ['No effect at all', 'The debit is already stored, so the money is missing from both accounts', 'The transfer finishes on its own later', 'Both updates are reversed'], a: 1,
      why: 'Each UPDATE was committed by itself, and nothing links the two halves of the transfer together.' },
    { q: 'What does atomicity, the A in ACID, promise?', o: ['Faster queries', 'Either every update in the transaction takes effect or none of them do', 'Encrypted data', 'Reads that are always quick'], a: 1,
      why: 'After a crash, transactions that had not committed are undone with the help of the write-ahead log.' },
    { q: 'A database replies OK before the commit has reached the disk. What can go wrong?', o: ['Nothing', 'A crash can wipe out transfers the user was already told had succeeded', 'Commits get slower', 'Deadlocks appear'], a: 1,
      why: 'Durability needs the log flushed (fsync) before the acknowledgement. Asynchronous commit swaps that guarantee for speed.' },
  ],
  guided: {
    intro: 'Run each transfer as two separate updates, then pull the plug while some transfers are half done.',
    example: '“Run the guided example” resets the accounts, switches to two separate updates with the log written before OK, and crashes the server as soon as a transfer is in flight.',
    question: 'What happens to the total of the four accounts after the crash?',
    predictions: ['It drops: debited money never arrives anywhere.', 'It stays at ₹4,000 because the database undoes the half-done transfer.', 'It rises, because the credit is applied twice on restart.'],
    correctPrediction: 0,
    running: 'Watch the total under the four accounts and the red flash when the plug is pulled.',
    observation: 'The debit had already been saved on its own, so after the crash the money was missing from the total.',
    explainQuestion: 'Why did the money disappear?',
    explanations: ['Each update committed separately, so the saved debit had no matching credit when the server died.', 'The write-ahead log was flushed too often.', 'The crash corrupted the disk.'],
    correctExplanation: 0,
    why: 'Only a transaction ties the two halves together; then a crash rolls the unfinished transfer back and the total is preserved.',
    retryHint: 'Look at the in-flight list just before the crash: each row was already debited but not credited.',
    nextSlug: 'queues',
    nextLabel: 'Next experiment: queues →',
    waitSeconds: 6,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { txn: true, sync: 'fsync' };
    let st, flash = 0, guidedCrash = false;

    kit.metrics([
      { key: 'miss', label: 'Money missing after crashes' }, { key: 'rb', label: 'Unfinished transfers rolled back' },
      { key: 'lost', label: '“Successful” transfers lost' }, { key: 'ms', label: 'Time per commit' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'total', label: 'Total of all accounts', color: 'wire' }],
      bars: { key: 'gone', label: 'Transfers broken by a crash', color: 'bad' },
      format: v => rupees(v), yMin: 0,
    });
    addLegend(kit, [['ink', 'Balance in memory'], ['muted', 'Value on disk'], ['wire', 'Inside a transaction (invisible)'], ['signal', 'Debited, not yet credited']]);

    const p = kit.panel;
    p.buttons([{ label: 'Pull the plug (crash)', kind: 'primary', onClick: crash }, { label: 'Reset', kind: 'outline', onClick: reset }]);
    const mode = p.seg('Each transfer runs', { options: [['txn', 'In a transaction'], ['auto', 'As two separate updates']], value: 'txn',
      onChange: v => { s.txn = v === 'txn'; reset(); kit.log(s.txn ? 'Transfers now run inside a transaction: debit and credit commit together' : 'Transfers now run as two independent updates, each saved on its own'); } });
    const sync = p.seg('On commit', { options: [['fsync', 'Write log to disk, then OK'], ['async', 'OK now, flush every second']], value: 'fsync',
      onChange: v => { s.sync = v; reset(); kit.log(v === 'fsync' ? 'Commits now wait for the log to reach the disk (6 ms each)' : 'Commits are acknowledged at once and flushed to disk every second (1 ms each)'); } });

    function reset() {
      st = { now: 0, acc: 0, next: 1, bal: Array(4).fill(START), disk: Array(4).fill(START), open: [], acked: [], committed: 0,
        rolledBack: 0, lost: 0, destroyed: 0, lastFlush: 0, gone: 0, win: 0 };
      flash = 0;
      kit.resetTime();
      chart.reset();
      paint();
    }

    function begin() {
      const from = Math.floor(Math.random() * 4);
      let to;
      do to = Math.floor(Math.random() * 4); while (to === from);
      const t = { id: st.next++, from, to, amt: 10 + Math.floor(Math.random() * 9) * 10, at: st.now + GAP_S };
      st.open.push(t);
      if (!s.txn) { st.bal[from] -= t.amt; st.disk[from] -= t.amt; } // autocommit: debit saved immediately
    }
    function finish(t) {
      if (s.txn) st.bal[t.from] -= t.amt;
      st.bal[t.to] += t.amt;
      st.committed++; st.win++;
      if (s.sync === 'fsync' || !s.txn) {
        if (s.txn) st.disk[t.from] -= t.amt;
        st.disk[t.to] += t.amt;
      } else st.acked.push(t);
    }
    function flushLog() {
      for (const t of st.acked) { st.disk[t.from] -= t.amt; st.disk[t.to] += t.amt; }
      st.acked = []; st.lastFlush = st.now;
    }
    const step = fixedStep(dt => {
      st.now += dt;
      st.acc += RATE * dt;
      while (st.acc >= 1) { st.acc -= 1; begin(); }
      st.open = st.open.filter(t => (st.now >= t.at ? (finish(t), false) : true));
      if (s.sync === 'async' && st.now - st.lastFlush >= FLUSH_S) flushLog();
    });

    function crash() {
      const open = st.open.length, acked = st.acked.length;
      if (s.txn) {
        st.rolledBack += open; st.lost += acked;
        kit.log(`Plug pulled: ${open} unfinished transfer${open === 1 ? '' : 's'} rolled back` +
          (acked ? `, and ${acked} transfer${acked === 1 ? '' : 's'} already reported as done vanished because they were never flushed` : '. The total is intact'));
      } else {
        const sum = st.open.reduce((a, t) => a + t.amt, 0);
        st.destroyed += sum;
        kit.log(`Plug pulled: ${open} transfer${open === 1 ? ' was' : 's were'} debited but never credited, so ${rupees(sum)} disappeared`);
        if (guidedCrash) kit.guided.observe(`${open} half-done transfer${open === 1 ? '' : 's'} had already taken ${rupees(sum)} out of the senders, and after the crash the total read ${rupees(st.disk.reduce((a, b) => a + b, 0))} instead of ₹4,000.`);
      }
      st.gone += s.txn ? acked : open;
      st.open = []; st.acked = []; st.bal = st.disk.slice();
      flash = 1;
      guidedCrash = false;
      paint();
    }

    function paint() {
      kit.metric('miss', rupees(st.destroyed), st.destroyed ? 'bad' : 'good');
      kit.metric('rb', String(st.rolledBack), st.rolledBack ? 'warn' : '');
      kit.metric('lost', String(st.lost), st.lost ? 'bad' : 'good');
      kit.metric('ms', `${MS[s.sync]} ms`, s.sync === 'fsync' ? 'warn' : 'good');
    }

    kit.every(1, () => {
      chart.push({ total: st.bal.reduce((a, b) => a + b, 0), gone: st.gone });
      st.gone = 0; st.win = 0;
      paint();
    });

    function draw() {
      stage.clear();
      const c = stage.colors, w = stage.w, H = stage.h, narrow = w < 520;
      if (flash > 0) { stage.ctx.save(); stage.ctx.globalAlpha = flash * 0.22; stage.ctx.fillStyle = c.bad; stage.ctx.fillRect(0, 0, w, H); stage.ctx.restore(); }
      const pad = 14, gap = 10, bw = (w - pad * 2 - gap * 3) / 4, bh = narrow ? 62 : 74, top = 16;
      st.bal.forEach((v, i) => {
        const x = pad + i * (bw + gap);
        stage.rect(x, top, bw, bh, { fill: c.surface, stroke: c.line2, r: 8, width: 1.2 });
        stage.text(NAMES[i], x + bw / 2, top + 14, { size: narrow ? 10 : 11, weight: 700, color: c.muted, align: 'center' });
        stage.text(rupees(v), x + bw / 2, top + (narrow ? 34 : 38), { size: narrow ? 14 : 18, weight: 800, color: v < START - 300 ? c.signal : c.ink, align: 'center' });
        if (st.disk[i] !== v) stage.text(`on disk ${rupees(st.disk[i])}`, x + bw / 2, top + bh - 12, { size: narrow ? 9 : 10, color: c.muted, align: 'center' });
      });
      const total = st.bal.reduce((a, b) => a + b, 0), ok = total === START * 4;
      const ty = top + bh + 22;
      stage.text(`Total ${rupees(total)} ${ok ? `= ${rupees(START * 4)} ✓` : `≠ ${rupees(START * 4)}, money has vanished`}`, pad, ty, { size: narrow ? 12 : 14, weight: 800, color: ok ? c.ok : c.bad });

      const ly = ty + 26, rowH = narrow ? 22 : 26;
      stage.text(narrow ? 'In flight' : 'Transfers in flight (between the debit and the credit)', pad, ly, { size: 11, color: c.muted, weight: 600 });
      const shown = st.open.slice(0, 4);
      shown.forEach((t, k) => {
        const y = ly + 12 + k * rowH;
        stage.rect(pad, y, w - pad * 2, rowH - 4, { fill: c.surface, stroke: s.txn ? c.wire : c.signal, r: 5, width: 1 });
        stage.text(`#${t.id}  ${rupees(t.amt)}  ${NAMES[t.from]} → ${NAMES[t.to]}`, pad + 8, y + (rowH - 4) / 2, { size: narrow ? 10 : 11.5, weight: 600 });
        const prog = Math.max(0, Math.min(1, 1 - (t.at - st.now) / GAP_S));
        stage.bar(w - pad - (narrow ? 50 : 70), y + (rowH - 4) / 2 - 2, narrow ? 40 : 60, 4, prog, s.txn ? c.wire : c.signal);
        if (!narrow) stage.text(s.txn ? 'inside the transaction, invisible to others' : `already taken from ${NAMES[t.from]}, not yet given`, w - pad - 80, y + (rowH - 4) / 2, { size: 11, color: s.txn ? c.wire : c.signal, align: 'right' });
      });
      if (!shown.length) stage.text('none at this moment', pad, ly + 22, { size: 11, color: c.muted });
      const ay = ly + 12 + 4 * rowH + 8;
      if (s.sync === 'async' && st.acked.length) {
        stage.text(`${st.acked.length} committed transfer${st.acked.length > 1 ? 's' : ''} already told “OK” but not on disk yet`, pad, ay, { size: narrow ? 10.5 : 12, weight: 700, color: c.signal });
        const left = Math.max(0, FLUSH_S - (st.now - st.lastFlush));
        stage.bar(pad, ay + 14, Math.min(220, w - pad * 2), 5, 1 - left / FLUSH_S, c.signal);
        stage.text('next flush', pad + Math.min(220, w - pad * 2) + 8, ay + 16, { size: 10, color: c.muted });
      } else if (s.sync === 'fsync' && s.txn) {
        stage.text('Every commit is on disk before the user hears “OK”.', pad, ay, { size: 11, color: c.muted });
      } else if (!s.txn) {
        stage.text('Each half is saved the moment it runs: nothing links the debit to the credit.', pad, ay, { size: 11, color: c.muted });
      }
      stage.text(`${st.committed} transfers committed since reset`, w - pad, H - 14, { size: 10.5, color: c.muted, align: 'right' });
    }

    no3d(kit);
    kit.loop(dt => { step(dt); flash = Math.max(0, flash - dt); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        mode.set('auto', true); s.txn = false;
        sync.set('fsync', true); s.sync = 'fsync';
        reset();
        kit.clearLog();
        unpause();
        const t0 = performance.now();
        const wait = () => {
          if (st.open.length || performance.now() - t0 > 4000) { guidedCrash = true; crash(); }
          else setTimeout(wait, 100);
        };
        setTimeout(wait, 1200);
      },
    };
  },
};
