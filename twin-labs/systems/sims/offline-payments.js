// Offline payments: 3 shop terminals, 5 customers with ₹500 each on the bank server.
// Model: `rate` payments per second of ₹50–₹200 from a random customer at a random shop.
// Online: the server checks the balance and debits it, or declines.
// Offline: a terminal cannot see balances; it accepts a payment if that customer's offline total at
// that shop stays within the offline limit, and stores it. Back online, stored payments are sent in
// order; any the customer can no longer afford are rejected, and the shop has already handed over
// the goods. Every 8 s a new "day" tops balances back up to ₹500 (only while online).

import { inr, fixedStep, clamp, box, link, burst, unpause, hide3dButton } from './_d-util.js';

const SHOPS = 3, CUSTOMERS = 5, BALANCE = 500, DAY_S = 8;

function system(limit) {
  const o = { limit, online: true, bal: Array(CUSTOMERS).fill(BALANCE), stored: Array.from({ length: SHOPS }, () => []),
    spent: Array.from({ length: SHOPS }, () => Array(CUSTOMERS).fill(0)), ok: 0, offline: 0, declined: 0, synced: 0, lost: 0, lostAmt: 0 };
  o.pay = (shop, cust, amt) => {
    if (o.online) {
      if (o.bal[cust] >= amt) { o.bal[cust] -= amt; o.ok++; return 'paid'; }
      o.declined++; return 'declined';
    }
    if (o.spent[shop][cust] + amt > o.limit) { o.declined++; return 'declined'; }
    o.spent[shop][cust] += amt;
    o.stored[shop].push({ c: cust, amt });
    o.offline++;
    return 'stored';
  };
  o.sync = () => {
    const r = { sent: 0, ok: 0, lost: 0, lostAmt: 0 };
    for (let s = 0; s < SHOPS; s++) {
      for (const x of o.stored[s]) {
        r.sent++;
        if (o.bal[x.c] >= x.amt) { o.bal[x.c] -= x.amt; o.synced++; r.ok++; }
        else { o.lost++; o.lostAmt += x.amt; r.lost++; r.lostAmt += x.amt; }
      }
      o.stored[s] = [];
      o.spent[s].fill(0);
    }
    return r;
  };
  o.waiting = () => o.stored.reduce((a, q) => a + q.length, 0);
  return o;
}

export default {
  lead: 'A shop\'s network drops, but customers still want to pay. The terminal can take small payments offline, keep them, and send them to the bank once the network returns. The danger: one customer can spend the same money at several shops while none of them can check the balance.',
  emptyLog: 'Online. Take the network down to start storing payments.',
  tryThis: [
    'Switch to <b>Offline</b> for a while. Each shop keeps its payments (amber) instead of sending them to the server.',
    'Switch back to <b>Online</b>. The stored payments are sent; the ones a customer could not cover are rejected, and the shop has already given away the goods.',
    'Raise the <b>offline limit</b> and do it again: more sales during the outage but larger losses. At ₹0 nothing is lost, and nothing is sold either.',
  ],
  inShort: {
    what: 'Offline payments let a terminal accept a payment without reaching the server, keep it securely and forward it when the network returns.',
    why: 'Shops with patchy networks still need to sell, and a dropped connection should not halt every sale.',
    tradeoff: 'With no live balance check the same money can be spent twice; small offline limits (and signed, tamper-proof records) cap the loss.',
    interview: 'Signed offline receipts in a local queue, a low per-customer offline limit, idempotent sync on reconnect, and the merchant carrying a small, capped risk.',
  },
  quiz: [
    { q: 'What does "store and forward" mean for offline payments?', o: ['Payments are refused', 'The terminal keeps the payment and sends it to the server once the network is back', 'Payments are printed', 'The customer pays twice'], a: 1,
      why: 'Selling goes on during the outage; stored payments are forwarded and settled later.' },
    { q: 'What is the main risk of taking payments offline?', o: ['Slower receipts', 'A customer can spend more than their balance across shops that cannot check it', 'Higher fees', 'Lost receipts'], a: 1,
      why: 'Nobody can see the real balance while offline, so the same money can be spent twice (double spending).' },
    { q: 'How do offline wallets keep that risk small?', o: ['They don\'t', 'A small offline limit per customer caps the possible loss', 'By encrypting the receipt', 'By asking for a password'], a: 1,
      why: 'Low per-payment and per-wallet limits keep the worst case small while still allowing everyday purchases offline.' },
  ],
  guided: {
    intro: 'Cut the network during a busy spell with a generous offline limit, then reconnect.',
    example: '“Run the guided example” resets with 8 payments per second and a ₹500 offline limit, goes offline, and reconnects after 8 seconds.',
    question: 'What happens when the stored payments are finally sent?',
    predictions: ['Some are rejected because customers overspent across shops.', 'All of them settle, since each was under the limit.', 'They are all refunded to the customers.'],
    correctPrediction: 0,
    running: 'Watch the amber stored payments pile up at each shop, then the “Rejected after sync” metric when the network comes back.',
    observation: 'Several stored payments were rejected on sync: the customers had already spent that money at other shops.',
    explainQuestion: 'Why could a customer overspend?',
    explanations: ['Each shop checked only its own offline limit and none could see the customer\'s real balance.', 'The server lost the balances during the outage.', 'Stored payments were sent twice.'],
    correctExplanation: 0,
    why: 'Offline acceptance trades certainty for availability. The per-shop limit bounds the loss, but across several shops it adds up.',
    retryHint: 'Add up one customer\'s limit across all three shops and compare it with their ₹500 balance.',
    nextSlug: 'fraud-detection',
    nextLabel: 'Next experiment: fraud detection →',
    waitSeconds: 14,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { limit: 200, rate: 3, online: true };
    let st;

    kit.metrics([
      { key: 'off', label: 'Taken offline' }, { key: 'wait', label: 'Stored, not yet sent' },
      { key: 'lost', label: "Rejected after sync (shop's loss)" }, { key: 'dec', label: 'Declined' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'wait', label: 'Stored, not sent', color: 'signal' }, { key: 'paid', label: 'Paid online / s', color: 'ok' }],
      bars: { key: 'lost', label: 'Rejected after sync', color: 'bad' },
    });

    const p = kit.panel;
    const net = p.seg('Network', { options: [['up', 'Online'], ['down', 'Offline']], value: 'up', onChange: v => setOnline(v === 'up') });
    const limit = p.slider('Offline limit per customer, per shop', { min: 0, max: 500, step: 50, value: 200, format: v => `₹${v}`, hint: '₹0 refuses every offline payment', onInput: v => { s.limit = v; } });
    const rate = p.slider('Payments per second', { min: 1, max: 8, step: 1, value: 3, format: v => `${v} /s`, onInput: v => { s.rate = v; } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    function setOnline(on) {
      s.online = on;
      st.o.online = on;
      if (!on) { kit.log('Network down: terminals now accept payments up to the offline limit and store them'); return; }
      const r = st.o.sync();
      st.win.lost += r.lost;
      if (!r.sent) kit.log('Network back: nothing was stored');
      else kit.log(`Network back: sent ${r.sent} stored payments, ${r.ok} settled${r.lost ? `, ${r.lost} rejected (${inr(r.lostAmt)} lost by the shops)` : ', none rejected'}`);
      if (st.guided) { st.guided = false; kit.guided.observe(`On reconnect ${r.sent} stored payments were sent: ${r.ok} settled and ${r.lost} were rejected (${inr(r.lostAmt)}), because customers had spent the same money at several shops.`); }
    }

    function reset() {
      st = { t: 0, acc: 0, o: system(s.limit), fx: [], day: 0, win: { lost: 0, paid: 0 }, guided: false, reconnectAt: null };
      st.o.online = s.online;
      kit.resetTime();
      chart.reset();
      kit.clearLog();
      paint();
    }

    function step(dt) {
      const o = st.o;
      st.t += dt;
      o.limit = s.limit;
      st.acc += s.rate * dt;
      while (st.acc >= 1) {
        st.acc -= 1;
        const shop = Math.floor(Math.random() * SHOPS), cust = Math.floor(Math.random() * CUSTOMERS);
        const r = o.pay(shop, cust, 50 * (1 + Math.floor(Math.random() * 4)));
        if (r === 'paid') st.win.paid++;
        st.fx.push({ s: shop, r, t: 0 });
      }
      if (Math.floor(st.t / DAY_S) > st.day) {
        st.day = Math.floor(st.t / DAY_S);
        if (o.online) { o.bal.fill(BALANCE); kit.log(`New day: every customer's balance is topped up to ${inr(BALANCE)}`); }
      }
      if (st.reconnectAt != null && st.t >= st.reconnectAt) { st.reconnectAt = null; net.set('up', true); setOnline(true); }
      st.fx = st.fx.filter(f => (f.t += dt) < 0.7);
    }

    function everySecond() {
      chart.push({ wait: st.o.waiting(), paid: st.win.paid, lost: st.win.lost });
      st.win = { lost: 0, paid: 0 };
      paint();
    }

    function paint() {
      const o = st.o, w = o.waiting();
      kit.metric('off', String(o.offline));
      kit.metric('wait', String(w), w ? 'warn' : 'good');
      kit.metric('lost', o.lost ? `${o.lost} (${inr(o.lostAmt)})` : '0', o.lost ? 'bad' : 'good');
      kit.metric('dec', String(o.declined));
    }

    function draw() {
      stage.clear();
      const c = stage.colors, o = st.o, W = stage.w, H = stage.h, small = W < 520;
      const bw = clamp(W * 0.2, 64, 110), bh = small ? 36 : 42;
      const server = { x: W - Math.max(W * 0.1, bw / 2 + 6), y: H * 0.45, w: bw, h: bh };
      const shops = Array.from({ length: SHOPS }, (_, i) => ({ x: Math.max(W * 0.12, bw / 2 + 6), y: H * (small ? 0.15 + i * 0.25 : 0.2 + i * 0.28), w: bw, h: bh }));
      for (const b of shops) link(stage, [b, server], { color: o.online ? c.ok : c.bad, dash: o.online ? null : [5, 5] });
      for (const f of st.fx) {
        const b = shops[f.s], k = f.t / 0.7;
        if (f.r === 'paid') stage.dot(b.x + (server.x - b.x) * k, b.y + (server.y - b.y) * k, 3.5, c.ok);
        else burst(stage, b, k, f.r === 'declined' ? c.bad : c.signal);
      }
      shops.forEach((b, i) => {
        const n = o.stored[i].length;
        box(stage, b, `Shop ${i + 1}`, n ? `${n} stored` : o.online ? 'online' : 'offline', { stroke: n ? c.signal : o.online ? c.wire : c.bad, subColor: n ? c.signal : undefined, size: small ? 11 : 12.5 });
        for (let j = 0; j < Math.min(n, small ? 8 : 16); j++) stage.rect(b.x + b.w / 2 + 6 + j * 7, b.y - 4, 5, 8, { fill: c.signal, r: 1 });
      });
      box(stage, server, 'Bank server', o.online ? 'checks balances' : 'unreachable', { stroke: o.online ? c.wire : c.bad, size: small ? 11 : 12.5 });
      const y = H - (small ? 6 : 14), x0 = small ? 12 : W * 0.35, cw = (small ? W - 24 : W * 0.5) / CUSTOMERS;
      o.bal.forEach((b, i) => stage.text(`C${i + 1} ₹${b}`, x0 + i * cw + cw / 2, y, { size: 10, align: 'center', baseline: 'bottom', color: b < 100 ? c.bad : c.muted }));
      if (!small) stage.text('balances on the server:', 12, y, { size: 10, baseline: 'bottom', color: c.muted });
    }

    const fixed = fixedStep(step);
    kit.loop(dt => { fixed(dt); draw(); });
    kit.every(1, everySecond);
    hide3dButton(kit);
    reset();

    return {
      reset,
      guidedRun() {
        net.set('up', true); s.online = true;
        limit.set(500, true); s.limit = 500;
        rate.set(8, true); s.rate = 8;
        reset();
        st.guided = true;
        kit.log('Guided run: 8 payments/s, ₹500 offline limit; the network drops now and returns in 8 s');
        net.set('down', true); setOnline(false);
        st.reconnectAt = 8;
        unpause();
      },
    };
  },
};
