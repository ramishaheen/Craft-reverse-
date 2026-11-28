// Reconciliation: each simulated day (6 s) has 12 payments. Our records miss a payment when its
// webhook was lost; the bank file lists a payment a day late (T+1) at the "late" rate, and shows a
// different amount (2% fee taken) at the "amount" rate. The nightly job joins both lists on the id:
// matched, missing from the bank (carried to tomorrow and matched again), missing from our records
// (a real break) or amount differs (a break). Rows are checked progressively over 70% of the day.

import { inr, fixedStep, unpause, hide3dButton } from './_d-util.js';

const PER_DAY = 12;
const DAY_S = 6;

function makeDay(day, n, { lost, late, amount }) {
  const ours = [], bank = [], later = [];
  for (let i = 0; i < n; i++) {
    const id = `D${day}-${String(i + 1).padStart(3, '0')}`;
    const amt = 100 * (1 + Math.floor(Math.random() * 30));
    if (Math.random() >= lost) ours.push({ id, amt });
    const b = { id, amt: Math.random() < amount ? amt - Math.round(amt * 0.02) : amt };
    if (Math.random() < late) later.push(b); else bank.push(b);
  }
  return { ours, bank, later };
}

function match(ours, bank) {
  const byBank = new Map(bank.map(r => [r.id, r])), byOurs = new Map(ours.map(r => [r.id, r]));
  const out = [];
  for (const r of ours) {
    const b = byBank.get(r.id);
    out.push(b ? { id: r.id, res: b.amt !== r.amt ? 'amount' : 'matched', ours: r.amt, bank: b.amt } : { id: r.id, res: 'missing-bank', ours: r.amt });
  }
  for (const b of bank) if (!byOurs.has(b.id)) out.push({ id: b.id, res: 'missing-ours', bank: b.amt });
  return out;
}

export default {
  lead: 'Each night the payments team lines up two lists: the payments in our own database and the bank\'s settlement file for that day. Every payment should be in both, with the same amount. Anything else is a break, and someone has to explain it before the books close.',
  emptyLog: 'The first day is being matched…',
  tryThis: [
    'Follow a payment the bank settles <b>late</b>. Today it shows as "not in bank file yet" (amber); tomorrow it is carried over and matches, and nobody has to do anything.',
    'Increase <b>webhooks we never received</b>. The bank paid us but we have no record of it: a genuine break. The fix is to fetch the payment from the provider\'s API and record it.',
    'A different <b>amount</b> usually comes from fees or a partial refund. Matching needs the fee rules as well as the ids.',
  ],
  inShort: {
    what: 'Reconciliation lines up our payment records with the bank\'s or provider\'s settlement file and lists every row that does not agree.',
    why: 'Webhooks get lost, banks settle late and fees change amounts, so without a daily check money can go missing unnoticed.',
    tradeoff: 'Matching on ids alone is easy, but real files need fee rules, partial refunds and tolerance windows, and late rows should be carried forward rather than flagged.',
    interview: 'A daily job loads the settlement file, joins it on transaction id, carries T+1 rows forward, and opens tickets only for breaks it cannot explain.',
  },
  quiz: [
    { q: 'What is payment reconciliation?', o: ['Encrypting payments', 'Checking our records against the bank\'s or provider\'s and explaining every difference', 'Refunding customers', 'Sending invoices'], a: 1,
      why: 'Two independent records of the same money ought to agree; reconciliation finds and explains the places where they don\'t.' },
    { q: 'A payment is in our records but missing from today\'s bank file. What is the usual reason?', o: ['Fraud', 'The bank settles it one day later (T+1)', 'A database crash', 'The customer cancelled'], a: 1,
      why: 'Settlement often lags. Carry the row forward and match it against tomorrow\'s file before raising an alarm.' },
    { q: 'The bank file contains a payment we have no record of. What probably happened?', o: ['The bank invented it', 'Our webhook or callback was lost, so a payment that succeeded was never recorded', 'It is a duplicate', 'Nothing'], a: 1,
      why: 'Fetch it from the provider\'s API, record it and fulfil the order, then fix why the callback went missing.' },
  ],
  guided: {
    intro: 'Make the bank settle many payments a day late, with nothing else going wrong.',
    example: '“Run the guided example” resets with no lost webhooks, no amount differences and 40% of payments settled a day late.',
    question: 'What happens to the late payments over two days?',
    predictions: ['They show as not in the bank file, then match the next day: no breaks.', 'They become permanent breaks someone must chase.', 'They are counted twice.'],
    correctPrediction: 0,
    running: 'Watch day 1 close with amber rows, then day 2 start with those rows carried over in grey and matched.',
    observation: 'Yesterday\'s late rows were carried into the next day and matched the bank\'s T+1 file. No break was raised.',
    explainQuestion: 'Why did the late rows not need anyone\'s attention?',
    explanations: ['They were carried forward and matched once the bank\'s next file included them.', 'The job deletes rows it cannot match.', 'Late rows are ignored by design.'],
    correctExplanation: 0,
    why: 'Timing gaps are expected; a good reconciler carries them forward and only escalates rows that stay unmatched.',
    retryHint: 'Compare the grey (carried) rows of day 2 with the amber rows of day 1.',
    nextSlug: 'saga-pattern',
    nextLabel: 'Next experiment: saga pattern →',
    waitSeconds: 14,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { lost: 0.1, late: 0.15, amt: 0.05 };
    let st;

    kit.metrics([
      { key: 'ok', label: 'Matched' }, { key: 'bank', label: 'Not in bank file yet' },
      { key: 'ours', label: 'Missing from our records' }, { key: 'amt', label: 'Amount differs' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'matched', label: 'Matched (total)', color: 'ok' }, { key: 'carried', label: 'Carried to tomorrow', color: 'signal' }],
      bars: { key: 'breaks', label: 'Breaks found', color: 'bad' },
    });

    const p = kit.panel;
    const lost = p.slider('Webhooks we never received', { min: 0, max: 30, step: 5, value: 10, format: v => `${v}%`, onInput: v => { s.lost = v / 100; } });
    const late = p.slider('Bank settles a day late', { min: 0, max: 40, step: 5, value: 15, format: v => `${v}%`, onInput: v => { s.late = v / 100; } });
    const amt = p.slider('Amount differs (fees, partial refunds)', { min: 0, max: 30, step: 5, value: 5, format: v => `${v}%`, onInput: v => { s.amt = v / 100; } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    function reset() {
      st = { t: 0, day: 0, dayT: 0, carryOurs: [], carryBank: [], tot: { matched: 0, 'missing-bank': 0, 'missing-ours': 0, amount: 0 },
        rows: [], ours: [], bank: [], counted: 0, winBreaks: 0, dayStats: null, guided: false, carriedMatched: 0 };
      kit.resetTime();
      chart.reset();
      kit.clearLog();
      newDay();
      paint();
    }
    function newDay() {
      st.day++; st.dayT = 0;
      const d = makeDay(st.day, PER_DAY, { lost: s.lost, late: s.late, amount: s.amt });
      st.ours = st.carryOurs.concat(d.ours);
      st.bank = st.carryBank.concat(d.bank);
      st.rows = match(st.ours, st.bank);
      st.carryOurs = st.rows.filter(r => r.res === 'missing-bank').map(r => ({ id: r.id, amt: r.ours }));
      st.carryBank = d.later;
      st.counted = 0;
      st.dayStats = { matched: 0, amount: 0, ours: 0, carriedIn: 0 };
    }
    const prefix = () => `D${st.day}-`;
    const visible = () => Math.min(st.rows.length, Math.floor((st.dayT / (DAY_S * 0.7)) * st.rows.length));

    function step(dt) {
      st.t += dt; st.dayT += dt;
      const upto = visible();
      for (; st.counted < upto; st.counted++) {
        const r = st.rows[st.counted];
        if (r.res === 'missing-bank') continue;
        st.tot[r.res]++;
        if (r.res === 'matched') { st.dayStats.matched++; if (!r.id.startsWith(prefix())) st.dayStats.carriedIn++; }
        if (r.res === 'amount') { st.dayStats.amount++; st.winBreaks++; }
        if (r.res === 'missing-ours') { st.dayStats.ours++; st.winBreaks++; }
      }
      if (st.dayT >= DAY_S) {
        const d = st.dayStats, carry = st.carryOurs.length;
        st.tot['missing-bank'] = carry;
        kit.log(`Day ${st.day} closed: ${d.matched} matched${d.carriedIn ? ` (${d.carriedIn} carried from yesterday)` : ''}, ${carry} carried to tomorrow, ${d.ours + d.amount} break${d.ours + d.amount === 1 ? '' : 's'}${d.ours ? ` (${d.ours} missing from our records` : ''}${d.ours && d.amount ? `, ${d.amount} amount` : d.amount ? ` (${d.amount} amount` : ''}${d.ours || d.amount ? ')' : ''}`);
        if (st.guided && st.day >= 2 && d.carriedIn) {
          st.guided = false;
          kit.guided.observe(`Day ${st.day} matched ${d.carriedIn} payment${d.carriedIn > 1 ? 's' : ''} carried over from the day before and found ${d.ours + d.amount} breaks.`);
        }
        newDay();
      }
    }

    function everySecond() {
      chart.push({ matched: st.tot.matched, carried: st.carryOurs.length, breaks: st.winBreaks });
      st.winBreaks = 0;
      paint();
    }

    function paint() {
      const t = st.tot;
      kit.metric('ok', String(t.matched));
      kit.metric('bank', String(st.carryOurs.length), st.carryOurs.length ? 'warn' : 'good');
      kit.metric('ours', String(t['missing-ours']), t['missing-ours'] ? 'bad' : 'good');
      kit.metric('amt', String(t.amount), t.amount ? 'bad' : 'good');
    }

    function colorOf(res) {
      const c = stage.colors;
      return res === 'matched' ? c.ok : res === 'missing-bank' ? c.signal : res === 'missing-ours' || res === 'amount' ? c.bad : c.line;
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h, small = W < 520;
      const top = 30, rh = Math.max(11, Math.min(16, (H - top - 22) / Math.max(st.ours.length, st.bank.length, 1)));
      const cw = small ? W * 0.36 : W * 0.3, lx = 12, rx = W - 12 - cw;
      stage.text(small ? 'Our records' : 'Our records (payments table)', lx, top - 14, { size: 10.5, weight: 600, color: c.muted });
      stage.text(small ? 'Bank file' : 'Bank settlement file', rx + cw, top - 14, { size: 10.5, weight: 600, color: c.muted, align: 'right' });
      stage.text(`Day ${st.day}`, W / 2, top - 14, { size: 10.5, weight: 700, align: 'center' });
      const shown = new Map(st.rows.slice(0, visible()).map(r => [r.id, r.res]));
      const yo = new Map(), yb = new Map();
      const cell = (x, y, id, amount, old) => {
        const res = shown.get(id);
        stage.rect(x, y, cw, rh - 2, { fill: c.surface, stroke: res ? colorOf(res) : c.line, width: res && res !== 'matched' ? 1.8 : 1, r: 3 });
        stage.text(id, x + 5, y + (rh - 2) / 2, { size: small ? 9 : 10, color: old ? c.muted : c.ink });
        stage.text(inr(amount), x + cw - 5, y + (rh - 2) / 2, { size: small ? 9 : 10, color: old ? c.muted : c.ink, align: 'right' });
      };
      st.ours.forEach((r, i) => { const y = top + i * rh; yo.set(r.id, y); cell(lx, y, r.id, r.amt, !r.id.startsWith(prefix())); });
      st.bank.forEach((r, i) => { const y = top + i * rh; yb.set(r.id, y); cell(rx, y, r.id, r.amt, !r.id.startsWith(prefix())); });
      const half = (rh - 2) / 2;
      for (const r of st.rows.slice(0, visible())) {
        const a = yo.get(r.id), b = yb.get(r.id), col = colorOf(r.res);
        if (a != null && b != null) stage.line(lx + cw, a + half, rx, b + half, { color: col, width: 1.4, alpha: 0.75 });
        else if (a != null) stage.line(lx + cw, a + half, lx + cw + 18, a + half, { color: col, width: 1.4, alpha: 0.75, dash: [3, 3] });
        else if (b != null) stage.line(rx, b + half, rx - 18, b + half, { color: col, width: 1.4, alpha: 0.75, dash: [3, 3] });
      }
      if (!small) {
        const items = [['matched', c.ok], ['not in bank yet', c.signal], ['break', c.bad], ['carried from yesterday', c.muted]];
        stage.ctx.font = `500 10px ${stage.font}`;
        const widths = items.map(([l]) => stage.ctx.measureText(l).width + 26);
        let x = W / 2 - widths.reduce((a, b) => a + b, 0) / 2;
        const y = H - 10;
        items.forEach(([l, col], i) => { stage.rect(x, y - 1.5, 12, 3, { fill: col, r: 1 }); stage.text(l, x + 16, y, { size: 10, color: c.muted }); x += widths[i]; });
      }
    }

    const fixed = fixedStep(step);
    kit.loop(dt => { fixed(dt); draw(); });
    kit.every(1, everySecond);
    hide3dButton(kit);
    reset();

    return {
      reset,
      guidedRun() {
        lost.set(0, true); s.lost = 0;
        late.set(40, true); s.late = 0.4;
        amt.set(0, true); s.amt = 0;
        reset();
        st.guided = true;
        kit.log('Guided run: no lost webhooks, no fee differences, 40% settled a day late');
        unpause();
      },
    };
  },
};
