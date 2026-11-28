// Inventory holds: a flash sale of 10 units, open for 8 s, with `rate` buyers per second.
// A share of buyers abandon checkout; the others pay 0.8–3.3 s after clicking Buy.
//  - Check, then write: a buyer reads the stock on Buy and writes "read − 1" when paying, so many
//    buyers who read the same value each sell a unit: oversold.
//  - Atomic at checkout: the decrement happens on payment and only if stock > 0; late buyers are
//    told "sold out" after filling in their card.
//  - Hold on Buy: the unit is reserved at once for `hold` seconds; payment within the hold turns it
//    into a sale, otherwise the hold expires and the unit goes back on sale.
// The sale restarts by itself a few seconds after it closes.

import { fixedStep, unpause, hide3dButton } from './_d-util.js';

const STOCK = 10;
const OPEN_S = 8;
const MODE_NAME = { naive: 'check, then write', atomic: 'atomic at checkout', hold: 'hold on Buy' };

function inventory(mode, ttl) {
  const v = { mode, ttl, stock: STOCK, initial: STOCK, sold: 0, pending: [], holds: [], soldOut: 0, expired: 0 };
  v.buy = (t, pay) => {
    if (v.mode === 'hold') {
      if (v.stock <= 0) { v.soldOut++; return 'sold-out'; }
      v.stock--;
      v.holds.push({ t, until: t + v.ttl, pay });
      return 'held';
    }
    v.pending.push({ t, read: v.stock, at: t + (pay ?? 0.4), abandon: pay == null });
    return 'checkout';
  };
  v.tick = t => {
    const ev = { sold: 0, soldOut: 0, expired: 0 };
    for (const x of v.pending.filter(q => q.at <= t)) {
      v.pending.splice(v.pending.indexOf(x), 1);
      if (x.abandon) continue;
      if (v.mode === 'naive') {
        if (x.read > 0) { v.stock = x.read - 1; v.sold++; ev.sold++; } else { v.soldOut++; ev.soldOut++; }
      } else if (v.stock > 0) { v.stock--; v.sold++; ev.sold++; } else { v.soldOut++; ev.soldOut++; }
    }
    for (const x of v.holds.slice()) {
      if (x.pay != null && t >= x.t + x.pay && x.t + x.pay < x.until) { v.holds.splice(v.holds.indexOf(x), 1); v.sold++; ev.sold++; }
      else if (t >= x.until) { v.holds.splice(v.holds.indexOf(x), 1); v.stock++; v.expired++; ev.expired++; }
    }
    return ev;
  };
  v.oversold = () => Math.max(0, v.sold - v.initial);
  return v;
}

export default {
  lead: 'Ten phones go on sale and hundreds of people press Buy in the same second. Each phone must be sold exactly once. The naive approach oversells. Reserving a unit with a time-limited hold the moment someone presses Buy keeps the count honest, and tells late buyers "sold out" before they type a card number.',
  emptyLog: 'The sale is about to open.',
  tryThis: [
    '<b>Check, then write</b>: lots of buyers read "10 in stock" at the same moment and each writes 9. Red units are phones you sold but do not have.',
    '<b>Atomic at checkout</b> never oversells, but buyers enter their card details first and only then learn the phone is gone.',
    '<b>Hold on Buy</b>: amber units are reserved. When a buyer walks away the hold runs out and the unit is back on sale. Short holds resell sooner but hurry genuine buyers.',
  ],
  inShort: {
    what: 'Inventory reservation gives a buyer a time-limited hold on a unit when they press Buy, and turns it into a sale once they pay.',
    why: 'In a flash sale thousands of buyers race for a handful of units, and a naive read-then-write sells stock that does not exist.',
    tradeoff: 'Long holds park stock behind buyers who never pay; short holds rush the real ones. The hold store has to be atomic and fast (often an in-memory store such as Redis).',
    interview: 'Reserve with an atomic decrement (or UPDATE … WHERE stock > 0) plus a hold row with a TTL; payment confirms the hold and expiry returns the unit.',
  },
  quiz: [
    { q: 'Why does "read the stock, check it is above 0, then write stock − 1" oversell?', o: ['The database is slow', 'Many buyers read the same value together and each writes its own stock − 1', 'Stock is cached', 'It doesn\'t oversell'], a: 1,
      why: 'It is a read-then-write race. A conditional update (WHERE stock > 0) or a lock lets only one decrement win per unit.' },
    { q: 'What does a hold on Buy offer beyond an atomic update at checkout?', o: ['Nothing', 'The buyer knows straight away whether a unit is theirs, before entering a card', 'Extra stock', 'Free delivery'], a: 1,
      why: 'The unit is reserved up front with an expiry, so latecomers see "sold out" immediately.' },
    { q: 'What happens to a hold when the buyer abandons checkout?', o: ['The unit is lost', 'The hold lapses and the unit goes back on sale', 'The buyer is charged', 'The sale ends'], a: 1,
      why: 'Holds have a time limit (commonly 10 to 15 minutes), after which the reserved unit returns to stock.' },
  ],
  guided: {
    intro: 'Run a busy sale with the naive check-then-write approach.',
    example: '“Run the guided example” starts a new sale with check, then write, 30 buyers per second and 30% abandoning checkout.',
    question: 'How many phones end up sold?',
    predictions: ['More than 10: the shop oversells.', 'Exactly 10.', 'Fewer than 10, because buyers abandon.'],
    correctPrediction: 0,
    running: 'Watch for red “oversold” units appearing after the ten real ones.',
    observation: 'More than ten sales went through for ten phones.',
    explainQuestion: 'Why were more phones sold than existed?',
    explanations: ['Many buyers read the same stock value, and each wrote its own value minus one.', 'The stock counter was reset mid-sale.', 'Abandoned buyers were charged.'],
    correctExplanation: 0,
    why: 'Separate read and write steps let concurrent buyers act on the same stale number. An atomic conditional decrement, or a hold taken atomically, closes the gap.',
    retryHint: 'Compare the stock value each buyer read with how many sales completed.',
    nextSlug: 'offline-payments',
    nextLabel: 'Next experiment: offline payments →',
    waitSeconds: 10,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { mode: 'hold', ttl: 4, ab: 0.3, rate: 10 };
    let st;

    kit.metrics([
      { key: 'sold', label: 'Sold' }, { key: 'over', label: 'Oversold' },
      { key: 'out', label: 'Told "sold out"' }, { key: 'exp', label: 'Holds released' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'free', label: 'Stock counter', color: 'wire' }, { key: 'held', label: 'Held', color: 'signal' }, { key: 'sold', label: 'Sold', color: 'ok' }],
      bars: { key: 'out', label: '"Sold out" answers', color: 'bad' },
    });

    const p = kit.panel;
    const mode = p.seg('How stock is taken', { options: [['naive', 'Check, then write'], ['atomic', 'Atomic at checkout'], ['hold', 'Hold on Buy']], value: 'hold',
      onChange: v => { s.mode = v; ttlCtl.input.disabled = v !== 'hold'; newSale(); } });
    const ttlCtl = p.slider('Hold length', { min: 1, max: 10, step: 0.5, value: 4, format: v => `${v} s`, hint: 'A second stands for a minute', onInput: v => { s.ttl = v; } });
    const ab = p.slider('Buyers who abandon checkout', { min: 0, max: 80, step: 10, value: 30, format: v => `${v}%`, onInput: v => { s.ab = v / 100; } });
    const rate = p.slider('Buyers per second', { min: 2, max: 30, step: 2, value: 10, format: v => `${v} /s`, onInput: v => { s.rate = v; } });
    p.buttons([{ label: 'Start a new sale', kind: 'primary', onClick: () => newSale() }]);

    function newSale(keepLog) {
      st = { t: 0, acc: 0, inv: inventory(s.mode, s.ttl), outs: [], win: { out: 0 }, said: { out: false, over: false, closed: false }, guided: st?.guided && keepLog };
      kit.resetTime();
      chart.reset();
      if (!keepLog) kit.clearLog();
      kit.log(`Sale opened: ${STOCK} units, ${MODE_NAME[s.mode]}, ${s.rate} buyers/s`);
      paint();
    }

    function step(dt) {
      const v = st.inv;
      st.t += dt;
      v.ttl = s.ttl;
      if (st.t < OPEN_S) {
        st.acc += s.rate * dt;
        while (st.acc >= 1) {
          st.acc -= 1;
          const pay = Math.random() < s.ab ? null : 0.8 + Math.random() * 2.5;
          if (v.buy(st.t, pay) === 'sold-out') { st.outs.push(st.t); st.win.out++; }
        }
      } else if (!st.said.closed) {
        st.said.closed = true;
        kit.log(`Sale closed to new buyers: ${Math.min(v.sold, STOCK)} sold so far${v.holds.length ? `, ${v.holds.length} holds still open` : ''}${v.pending.length ? `, ${v.pending.length} buyers still paying` : ''}`);
      }
      const ev = v.tick(st.t);
      st.win.out += ev.soldOut;
      if (ev.expired) kit.log(`${ev.expired === 1 ? 'A hold' : ev.expired + ' holds'} ran out without payment; the unit${ev.expired > 1 ? 's go' : ' goes'} back on sale`);
      if (!st.said.out && (v.soldOut > 0)) { st.said.out = true; kit.log('First buyer told "sold out"'); }
      if (!st.said.over && v.oversold() > 0) {
        st.said.over = true;
        kit.log('Oversold: a sale went through for a unit that no longer exists');
        if (st.guided) { st.guided = false; setTimeout(() => kit.guided.observe(`${v.sold} sales completed for ${STOCK} phones (${v.oversold()} oversold so far): buyers who read the same stock each wrote their own count minus one.`), 1500); }
      }
      if (st.t > OPEN_S + s.ttl + 4) {
        kit.log(`Sale over: ${v.sold} sold${v.oversold() ? ` (${v.oversold()} oversold)` : ''}, ${v.soldOut} told "sold out", ${v.expired} holds released. Starting again`);
        newSale(true);
      }
      st.outs = st.outs.filter(t => st.t - t < 1);
    }

    function everySecond() {
      const v = st.inv;
      chart.push({ free: v.stock, held: v.holds.length, sold: v.sold, out: st.win.out });
      st.win.out = 0;
      paint();
    }

    function paint() {
      const v = st.inv;
      kit.metric('sold', `${Math.min(v.sold, v.initial)}${v.sold > v.initial ? ` (+${v.oversold()})` : ''} of ${v.initial}`);
      kit.metric('over', String(v.oversold()), v.oversold() ? 'bad' : 'good');
      kit.metric('out', String(v.soldOut));
      kit.metric('exp', String(v.expired), v.expired ? 'warn' : '');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, v = st.inv, W = stage.w, H = stage.h, small = W < 520;
      const perRow = small ? 6 : 12, sz = Math.min(small ? 40 : 46, (W - 24) / perRow - 8), gap = 8;
      const left = (W - perRow * (sz + gap) + gap) / 2, top = 34;
      const maxCells = perRow * Math.max(2, Math.floor((H - top - 34) / (sz + gap + 12)));
      const total = v.initial + v.oversold(), shown = Math.min(total, maxCells), hidden = total - shown;
      stage.text(st.t < OPEN_S ? `Sale open: ${(OPEN_S - st.t).toFixed(1)} s left` : 'Sale closed: holds finishing', W / 2, 14, { size: 11, weight: 600, color: c.muted, align: 'center' });
      const holds = v.holds.slice().sort((a, b) => a.until - b.until), sold = Math.min(v.sold, v.initial);
      for (let i = 0; i < shown; i++) {
        const x = left + (i % perRow) * (sz + gap), y = top + Math.floor(i / perRow) * (sz + gap + 12);
        let col = c.wire, label = v.mode === 'hold' ? 'free' : '';
        if (i >= v.initial) { col = c.bad; label = 'oversold'; }
        else if (i < sold) { col = c.ok; label = 'sold'; }
        else if (i < sold + holds.length) { col = c.signal; label = `${Math.max(0, holds[i - sold].until - st.t).toFixed(1)} s`; }
        stage.ctx.save(); stage.ctx.globalAlpha = col === c.wire ? 0.35 : 0.85;
        stage.rect(x, y, sz, sz, { fill: col, r: 6 });
        stage.ctx.restore();
        stage.text(String(i + 1), x + sz / 2, y + sz / 2, { size: small ? 11 : 13, weight: 700, align: 'center', color: col === c.wire ? c.ink : '#fff' });
        stage.text(label, x + sz / 2, y + sz + 8, { size: 9.5, color: c.muted, align: 'center' });
      }
      const ly = top + Math.ceil(shown / perRow) * (sz + gap + 12) + 10;
      if (v.mode !== 'hold') {
        stage.text(`${v.pending.length} buyers filling in payment details`, 12, ly, { size: 10.5, color: c.muted });
        for (let i = 0; i < Math.min(v.pending.length, small ? 30 : 60); i++) stage.dot(16 + i * 8, ly + 14, 2.8, c.wire);
      } else stage.text(`stock counter: ${v.stock} free, ${v.holds.length} held`, 12, ly, { size: 10.5, color: c.muted });
      if (hidden > 0) stage.text(`+${hidden} more oversold`, W - 12, ly, { size: 10.5, weight: 600, color: c.bad, align: 'right' });
      const outs = st.outs.length;
      if (outs) stage.text(`"sold out" × ${outs}/s`, W - 12, ly + (hidden > 0 ? 14 : 0), { size: 10.5, weight: 600, color: c.bad, align: 'right' });
    }

    const fixed = fixedStep(step);
    kit.loop(dt => { fixed(dt); draw(); });
    kit.every(1, everySecond);
    hide3dButton(kit);
    newSale();

    return {
      reset: () => newSale(),
      guidedRun() {
        mode.set('naive', true); s.mode = 'naive'; ttlCtl.input.disabled = true;
        rate.set(30, true); s.rate = 30;
        ab.set(30, true); s.ab = 0.3;
        newSale();
        st.guided = true;
        kit.log('Guided run: check, then write, 30 buyers/s');
        unpause();
      },
    };
  },
};
