// Instant bank payments: payer app → central switch → payer's bank (debit) → payee's bank (credit).
// Model: 1.2 payments per second of ₹100–₹2,000. If the payer's bank is down the payment is declined
// at once and nothing is debited. Otherwise the money is debited and the switch waits for the credit:
// a healthy payee bank answers in 0.25 s, a slow one in 3 s. The switch times out after 2 s, so a slow
// answer shows the payment as pending until the late credit arrives. If the payee bank is down, the
// debited payment stays pending and is reversed to the payer after 6 s (in real life up to a day).

import { inr, fixedStep, clamp, box, link, at, burst, unpause, hide3dButton } from './_d-util.js';

const RATE = 1.2;
const LEG = 0.35; // animation seconds per hop
const TIMEOUT = 2, REVERSE_AFTER = 6, FAST = 0.25, SLOW = 3;

function network() {
  const n = { payerUp: true, payeeUp: true, payeeSlow: false, txns: [], nextId: 1 };
  n.pay = (t, amount) => {
    const x = { id: n.nextId++, t, amount };
    n.txns.push(x);
    if (!n.payerUp) { x.state = 'declined'; x.debited = false; return x; }
    x.debited = true;
    if (!n.payeeUp) { x.state = 'pending'; x.creditAt = null; return x; }
    const d = n.payeeSlow ? SLOW : FAST;
    x.creditAt = t + d;
    x.state = d <= TIMEOUT ? 'success' : 'pending';
    return x;
  };
  n.tick = t => {
    const fin = [];
    for (const x of n.txns) {
      if (x.state !== 'pending') continue;
      if (x.creditAt != null && t >= x.creditAt) { x.state = 'late'; x.doneAt = t; fin.push(x); }
      else if (t - x.t >= REVERSE_AFTER) { x.state = 'reversed'; x.doneAt = t; fin.push(x); }
    }
    return fin;
  };
  n.count = s => n.txns.filter(x => x.state === s).length;
  n.inLimbo = () => n.txns.filter(x => x.state === 'pending').reduce((a, x) => a + x.amount, 0);
  return n;
}

export default {
  lead: 'You pay a shop ₹200 from a phone app. The app passes the request to a central switch, which asks your bank to debit you, asks the shop\'s bank to credit them, and then tells both apps. Nearly every payment finishes within a second. The interesting cases are a bank that is slow or down after your money has already left.',
  emptyLog: 'All banks healthy. Take one down or make the shop\'s bank slow.',
  tryThis: [
    'Switch the <b>payer\'s bank down</b>. Payments are refused straight away and no money moves: the harmless kind of failure.',
    'Make the <b>shop\'s bank slow</b>. You are debited, but the credit reply misses the 2 s timeout and the app says "pending". Shortly afterwards it completes.',
    'Switch the <b>shop\'s bank down</b>. Debited payments sit in pending, then the switch reverses them and the payer gets the money back. Real reversals can take until the next day.',
  ],
  inShort: {
    what: 'An instant payment network (India\'s UPI is the best-known one) moves money between any two bank accounts in seconds: the payer\'s app sends the request to a central switch, which debits one bank and credits the other.',
    why: 'Billions of payments a month cross many apps and banks, so each step needs a definite outcome even when one bank fails to answer in time.',
    tradeoff: 'A timeout after the debit leaves money in limbo. The system marks it pending and settles it with status checks and reversals, which can take hours.',
    interview: 'Each request carries a unique transaction id; on a timeout I mark it pending, poll the status API and rely on the switch\'s reconciliation to either credit or reverse it.',
  },
  quiz: [
    { q: 'In an instant bank payment, what links your bank to the shop\'s bank?', o: ['Your phone, directly', 'The central switch run by the network operator', 'A search engine', 'The central bank\'s website'], a: 1,
      why: 'Your payment app talks to the switch, which sends the debit to your bank and the credit to the payee\'s bank.' },
    { q: 'Your account was debited, but the shop\'s bank never replied. What does the app show?', o: ['Failed, and the money is gone', 'Pending: it will either complete or be reversed to you', 'Success', 'Nothing at all'], a: 1,
      why: 'Since the debit happened, the payment cannot simply be called failed. It stays pending until the credit is confirmed or the switch reverses it.' },
    { q: 'Which failure is the least harmful?', o: ['The payee\'s bank going down after the debit', 'The payer\'s bank being down before the debit', 'Both are equally harmful', 'A slow switch'], a: 1,
      why: 'With the payer\'s bank down, nothing is debited and the payment is refused immediately. Failures after the debit need a reversal.' },
  ],
  guided: {
    intro: 'Take the shop\'s bank offline and follow money that has already left the payer.',
    example: '“Run the guided example” resets with the payer\'s bank up and the shop\'s bank down.',
    question: 'What happens to payments that were already debited?',
    predictions: ['They wait as pending, then are reversed to the payer.', 'They fail instantly and the money is lost.', 'They show success and the shop is paid later.'],
    correctPrediction: 0,
    running: 'Watch the pending count under the switch, then the “Reversed to payer” metric. The first reversal comes 6 s after the first payment.',
    observation: 'Debited payments stayed pending until the 6 s limit, then the switch reversed them to the payer.',
    explainQuestion: 'Why can\'t the switch just mark them failed straight away?',
    explanations: ['The debit already happened, so the money has to be either credited or explicitly returned.', 'The payer\'s bank is down.', 'Pending payments are always successful in the end.'],
    correctExplanation: 0,
    why: 'Once one side has moved money, only a completed credit or a reversal ends the payment cleanly. Status checks and reconciliation decide which.',
    retryHint: 'Check whether the money was debited before the failure.',
    nextSlug: 'reconciliation',
    nextLabel: 'Next experiment: reconciliation →',
    waitSeconds: 12,
  },

  setup(kit) {
    const { stage } = kit;
    let st;
    const net = { payer: 'up', payee: 'up' };

    kit.metrics([
      { key: 'ok', label: 'Successful' }, { key: 'pend', label: 'Pending now' },
      { key: 'rev', label: 'Reversed to payer' }, { key: 'dec', label: 'Declined' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'pend', label: 'Pending', color: 'signal' }, { key: 'ok', label: 'Successful / s', color: 'ok' }],
      bars: { key: 'rev', label: 'Reversed', color: 'bad' },
    });

    const p = kit.panel;
    const payer = p.seg("Payer's bank (debit)", { options: [['up', 'Up'], ['down', 'Down']], value: 'up', onChange: v => { net.payer = v; apply();
      kit.log(v === 'up' ? "Payer's bank is back: debits work again" : "Payer's bank is down: new payments are declined before any money moves"); } });
    const payee = p.seg("Shop's bank (credit)", { options: [['up', 'Up'], ['slow', 'Slow'], ['down', 'Down']], value: 'up', onChange: v => { net.payee = v; apply();
      kit.log(v === 'up' ? "Shop's bank answers in 0.25 s again" : v === 'slow' ? "Shop's bank is slow: credits take 3 s, past the 2 s timeout" : "Shop's bank is down: debited payments will wait as pending"); } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);
    function apply() { st.n.payerUp = net.payer === 'up'; st.n.payeeUp = net.payee !== 'down'; st.n.payeeSlow = net.payee === 'slow'; }

    function reset() {
      st = { t: 0, acc: 0, n: network(), parts: [], win: { ok: 0, rev: 0, late: 0, dec: 0 }, guided: false };
      apply();
      kit.resetTime();
      chart.reset();
      kit.clearLog();
      paint();
    }

    function step(dt) {
      st.t += dt;
      const n = st.n;
      st.acc += RATE * dt;
      while (st.acc >= 1) {
        st.acc -= 1;
        const x = n.pay(st.t, 100 * (1 + Math.floor(Math.random() * 20)));
        st.parts.push({ x, t: 0 });
        if (x.state === 'success') st.win.ok++;
        if (x.state === 'declined') st.win.dec++;
      }
      for (const x of n.tick(st.t)) {
        st.parts.push({ x, t: 0, fin: x.state });
        if (x.state === 'late') { st.win.late++; st.win.ok++; }
        else {
          st.win.rev++;
          if (st.guided) { st.guided = false; kit.guided.observe(`Payment #${x.id} (${inr(x.amount)}) was debited, waited ${REVERSE_AFTER} s as pending, and was then reversed to the payer.`); }
        }
      }
      if (n.txns.length > 300) n.txns = n.txns.filter(x => x.state === 'pending' || st.t - x.t < 60);
      st.parts = st.parts.filter(q => (q.t += dt) < LEG * 6);
    }

    function everySecond() {
      const w = st.win;
      if (w.late) kit.log(`${w.late} pending payment${w.late > 1 ? 's' : ''} completed when the late credit answer arrived`);
      if (w.rev) kit.log(`${w.rev} pending payment${w.rev > 1 ? 's' : ''} reversed: the money went back to the payer`);
      if (w.dec && Math.round(st.t) % 5 === 0) kit.log(`Payments are still being declined at the payer's bank; nothing was debited`);
      chart.push({ pend: st.n.count('pending'), ok: w.ok, rev: w.rev });
      st.win = { ok: 0, rev: 0, late: 0, dec: 0 };
      paint();
    }

    function paint() {
      const n = st.n, pend = n.count('pending'), rev = n.count('reversed'), dec = n.count('declined');
      kit.metric('ok', String(n.count('success') + n.count('late')));
      kit.metric('pend', pend ? `${pend} (${inr(n.inLimbo())})` : '0', pend ? 'warn' : 'good');
      kit.metric('rev', String(rev), rev ? 'warn' : '');
      kit.metric('dec', String(dec), dec ? 'bad' : '');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, n = st.n, W = stage.w, H = stage.h, small = W < 520;
      const bw = clamp(W * 0.2, 64, 112), bh = small ? 36 : 42, side = Math.max(W * 0.1, bw / 2 + 6);
      const app = { x: side, y: H * 0.3, w: bw, h: bh }, shopApp = { x: side, y: H * 0.72, w: bw, h: bh };
      const sw = { x: W / 2, y: H * 0.5, w: bw, h: bh };
      const payerBank = { x: W - side, y: H * 0.3, w: bw, h: bh }, payeeBank = { x: W - side, y: H * 0.72, w: bw, h: bh };
      for (const b of [app, shopApp, payerBank, payeeBank]) link(stage, [b, sw], { color: c.wire, width: 1.5, dash: null });
      for (const q of st.parts) {
        const k = q.t / LEG, x = q.x;
        if (q.fin) {
          const route = q.fin === 'late' ? [payeeBank, sw, shopApp] : [sw, payerBank, sw, app];
          if (k < route.length - 1) { const pt = at(route, k / (route.length - 1)); stage.dot(pt.x, pt.y, 4, q.fin === 'late' ? c.ok : c.signal); }
          continue;
        }
        if (x.state === 'declined') {
          if (k < 2) { const pt = at([app, sw, payerBank], k / 2); stage.dot(pt.x, pt.y, 4, c.wire); }
          else burst(stage, payerBank, (k - 2) / 0.6, c.bad);
          continue;
        }
        const route = [app, sw, payerBank, sw, payeeBank], L = route.length - 1;
        if (k < L) { const pt = at(route, k / L); stage.dot(pt.x, pt.y, 4, k < 2 ? c.wire : c.signal); }
        else if (x.state === 'success' && k < L + 1) { const pt = at([payeeBank, sw, shopApp], k - L); stage.dot(pt.x, pt.y, 4, c.ok); }
        else if (x.state === 'pending') burst(stage, payeeBank, (k - L) / 0.6, c.signal);
      }
      const fs = small ? 11 : 12.5;
      box(stage, app, small ? 'Your app' : 'Your app (PSP)', 'pays ₹', { size: fs });
      box(stage, shopApp, small ? 'Shop app' : 'Shop app (PSP)', 'gets paid', { size: fs });
      box(stage, sw, 'Switch', 'routes payments', { size: fs });
      box(stage, payerBank, 'Your bank', 'debit', { size: fs, stroke: n.payerUp ? c.wire : c.bad, dashed: !n.payerUp, subColor: n.payerUp ? undefined : c.bad });
      const sub = n.payeeUp ? (n.payeeSlow ? 'slow' : 'credit') : 'down';
      const col = n.payeeUp ? (n.payeeSlow ? c.signal : c.wire) : c.bad;
      box(stage, payeeBank, small ? 'Shop bank' : "Shop's bank", sub, { size: fs, stroke: col, dashed: !n.payeeUp, subColor: n.payeeUp && !n.payeeSlow ? undefined : col });
      const pend = n.txns.filter(x => x.state === 'pending');
      if (pend.length) {
        const y = small ? 10 : sw.y + bh / 2 + 14;
        stage.text(small ? `${pend.length} pending: debited, not credited` : `${pend.length} pending: debited, not yet credited`, sw.x, y, { size: 10.5, weight: 600, color: c.signal, align: 'center' });
        const oldest = Math.max(...pend.map(x => st.t - x.t));
        stage.text(n.payeeUp ? 'waiting for the late credit answer' : small ? `reversal after ${REVERSE_AFTER} s` : `automatic reversal after ${REVERSE_AFTER} s (oldest ${oldest.toFixed(1)} s)`, sw.x, y + 14, { size: 10, color: c.muted, align: 'center' });
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
        payer.set('up', true); net.payer = 'up';
        payee.set('down', true); net.payee = 'down';
        reset();
        st.guided = true;
        kit.log("Guided run: payer's bank up, shop's bank down");
        unpause();
      },
    };
  },
};
