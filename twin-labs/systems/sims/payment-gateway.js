// Payment gateway: card payments go through authorise (a hold) and capture (the money moves).
// Model: 1.5 payments arrive per second, ₹100–₹2,000 each. The bank declines a share at once.
// An authorised hold is captured `captureAfter` seconds later, unless the hold expires first
// (`holdTTL`; a capture time longer than the hold means every hold expires). Every state change
// queues a webhook for the merchant. While the merchant endpoint is down a webhook is retried
// with exponential backoff: 0.5 s, 1 s, 2 s, 4 s, then every 8 s, until it is delivered.
// Seconds stand in for days (real holds last about 7 days).

import { inr, fixedStep, box, link, at, unpause, hide3dButton } from './_d-util.js';

const RATE = 1.5;
const STATES = [
  ['authorized', 'Authorised (held)', 'Held', 'signal'],
  ['captured', 'Captured', 'Captured', 'ok'],
  ['refunded', 'Refunded', 'Refunded', 'wire'],
  ['expired', 'Hold expired', 'Expired', 'bad'],
  ['declined', 'Declined', 'Declined', 'muted'],
];

function gateway() {
  const g = { decline: 0.1, captureAfter: 2, holdTTL: 6, merchantUp: true, pays: [], hooks: [], delivered: 0, nextId: 1 };
  const hook = (p, ev, due) => g.hooks.push({ id: p.id, ev, due, tries: 0 });
  g.pay = (amount, t) => {
    const p = { id: g.nextId++, amount, t, state: Math.random() < g.decline ? 'declined' : 'authorized' };
    g.pays.push(p);
    hook(p, 'payment.' + p.state, t);
    return p;
  };
  g.refund = (p, t) => { if (p.state !== 'captured') return false; p.state = 'refunded'; hook(p, 'payment.refunded', t); return true; };
  g.tick = t => {
    const changed = { captured: 0, expired: 0 };
    for (const p of g.pays) {
      if (p.state !== 'authorized') continue;
      if (g.captureAfter <= g.holdTTL && t - p.t >= g.captureAfter) { p.state = 'captured'; hook(p, 'payment.captured', t); changed.captured++; }
      else if (t - p.t >= g.holdTTL) { p.state = 'expired'; hook(p, 'payment.expired', t); changed.expired++; }
    }
    let delivered = 0;
    for (const w of g.hooks) {
      if (w.done || w.due > t) continue;
      w.tries++;
      if (g.merchantUp) { w.done = true; g.delivered++; delivered++; }
      else w.due = t + Math.min(8, 0.5 * 2 ** (w.tries - 1));
    }
    g.hooks = g.hooks.filter(w => !w.done);
    return { ...changed, delivered };
  };
  g.count = s => g.pays.filter(p => p.state === s).length;
  g.sum = s => g.pays.filter(p => p.state === s).reduce((a, p) => a + p.amount, 0);
  return g;
}

export default {
  lead: 'A card payment takes two steps. First the bank checks the card and puts a hold on the money (authorise). Later the money really moves, usually when the order ships (capture). An uncaptured hold eventually lapses, and the merchant learns about each step through webhooks that must survive the merchant being offline.',
  emptyLog: 'Nothing notable yet. Take the merchant endpoint down or stretch the capture delay.',
  tryThis: [
    'Make <b>capture after</b> longer than <b>hold expires after</b>. Each hold lapses before the goods ship, so the merchant is never paid.',
    'Switch the merchant endpoint to <b>Down</b> for a while. Webhooks queue up and retry further and further apart; switch it back and the whole backlog lands.',
    'Press <b>refund</b>. Only captured money can go back; a lapsed hold simply vanishes from the customer\'s statement.',
  ],
  inShort: {
    what: 'A payment gateway stands between the merchant and the banks: it authorises a card (placing a hold), captures it (moving the money) and processes refunds.',
    why: 'Keeping authorise and capture apart lets a shop charge only for what it actually ships, and the merchant must hear about every step reliably.',
    tradeoff: 'Capturing late risks the hold running out. Webhooks may come late or more than once, so merchants have to be idempotent and also check status through the API.',
    interview: 'I would keep a payment state machine (created, authorised, captured, refunded, expired) in a durable store, require an idempotency key on every call, and send signed webhooks that retry with backoff.',
  },
  quiz: [
    { q: 'How does authorising a card payment differ from capturing it?', o: ['They are the same step', 'Authorising reserves the money; capturing actually transfers it', 'Capture always comes first', 'Authorising gives the money back'], a: 1,
      why: 'A shop authorises when you check out and captures when it ships, so you only pay for goods that were sent.' },
    { q: 'What becomes of a hold that nobody captures?', o: ['It is charged regardless', 'It lapses and the reserved money is freed for the customer', 'It turns into a refund', 'The bank pays the merchant anyway'], a: 1,
      why: 'Authorisations have a lifetime (often around 7 days). After that the merchant has to authorise again.' },
    { q: 'The merchant\'s webhook endpoint is offline. What should the gateway do?', o: ['Throw the events away', 'Keep retrying with longer and longer gaps, and let the merchant read the status from the API too', 'Charge the customer a second time', 'Pause all payments'], a: 1,
      why: 'Webhooks are delivered at least once, with backoff. Merchants should ignore duplicates and reconcile by polling the API.' },
  ],
  guided: {
    intro: 'Ship later than the hold lasts and see what the merchant collects.',
    example: '“Run the guided example” resets the gateway with capture after 8 s, holds expiring after 6 s, 10% declines and the merchant endpoint up.',
    question: 'What happens to the captured total?',
    predictions: ['It stays at ₹0: every hold lapses before capture.', 'It grows normally, just 2 seconds later.', 'Payments are captured twice to make up for it.'],
    correctPrediction: 0,
    running: 'Watch the “Authorised” column fill, then the “Hold expired” column. Look at the Captured number below the diagram.',
    observation: 'Every hold reached its 6 s limit before the 8 s capture, so it lapsed and nothing was captured.',
    explainQuestion: 'Why did the merchant collect nothing?',
    explanations: ['A hold only lives for a fixed time, and capture was scheduled after that time ran out.', 'The bank declined every card.', 'The webhooks were lost, so the money was not moved.'],
    correctExplanation: 0,
    why: 'Capture must happen within the authorisation window. Shops that ship slowly re-authorise or capture part of the amount before the hold runs out.',
    retryHint: 'Compare the two slider values: capture after and hold expires after.',
    nextSlug: 'digital-wallet',
    nextLabel: 'Next experiment: digital wallet →',
    waitSeconds: 12,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { capAfter: 2, ttl: 6, dec: 0.1, up: true };
    let st;

    kit.metrics([
      { key: 'cap', label: 'Captured' }, { key: 'held', label: 'On hold now' },
      { key: 'exp', label: 'Holds expired' }, { key: 'hooks', label: 'Webhooks waiting' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'held', label: 'On hold', color: 'signal' }, { key: 'hooks', label: 'Webhooks waiting', color: 'wire' }],
      bars: { key: 'exp', label: 'Holds expired', color: 'bad' },
    });

    const p = kit.panel;
    const capAfter = p.slider('Capture after', { min: 0, max: 10, step: 0.5, value: 2, format: v => (v ? `${v} s` : 'at once'),
      hint: '0 captures immediately (digital goods); a later value captures when the order ships', onInput: v => { s.capAfter = v; } });
    const ttl = p.slider('Hold expires after', { min: 1, max: 10, step: 0.5, value: 6, format: v => `${v} s`,
      hint: 'Banks keep a hold for roughly 7 days; here a second stands for a day', onInput: v => { s.ttl = v; } });
    const dec = p.slider('Bank declines', { min: 0, max: 50, step: 5, value: 10, format: v => `${v}%`, onInput: v => { s.dec = v / 100; } });
    const merchant = p.seg('Merchant webhook endpoint', { options: [['up', 'Up'], ['down', 'Down']], value: 'up', onChange: v => {
      s.up = v === 'up';
      if (s.up) kit.log(`Merchant endpoint back up; ${st.g.hooks.length} queued webhooks will now be delivered`);
      else kit.log('Merchant endpoint is down: webhooks now fail and retry with growing gaps');
    } });
    p.buttons([
      { label: 'Refund the latest captured payment', kind: 'primary', onClick: refund },
      { label: 'Reset', kind: 'outline', onClick: reset },
    ]);

    function reset() {
      st = { t: 0, g: gateway(), acc: 0, flash: [], win: { exp: 0 }, expLog: 0, expLogAt: 0, warnedTTL: false, guided: false };
      kit.resetTime();
      chart.reset();
      kit.clearLog();
      paint();
    }
    function refund() {
      const x = st.g.pays.filter(q => q.state === 'captured').pop();
      if (x && st.g.refund(x, st.t)) kit.log(`Refunded payment #${x.id} (${inr(x.amount)}); a payment.refunded webhook is queued`);
      else kit.log('Nothing to refund: only captured payments can be refunded');
    }

    function step(dt) {
      st.t += dt;
      const g = st.g;
      g.captureAfter = s.capAfter; g.holdTTL = s.ttl; g.decline = s.dec; g.merchantUp = s.up;
      st.acc += RATE * dt;
      while (st.acc >= 1) { st.acc -= 1; g.pay(100 * (1 + Math.floor(Math.random() * 20)), st.t); }
      const r = g.tick(st.t);
      for (let i = 0; i < Math.min(4, r.delivered); i++) st.flash.push({ t: 0 });
      st.win.exp += r.expired;
      st.expLog += r.expired;
      if (r.expired && st.guided && g.sum('captured') === 0) {
        st.guided = false;
        const ne = g.count('expired');
        kit.guided.observe(`${ne} hold${ne === 1 ? '' : 's'} lapsed at the 6 s mark and the captured total is still ${inr(0)}: capture (8 s) was planned after every hold had run out.`);
      }
      if (s.capAfter > s.ttl && !st.warnedTTL) { st.warnedTTL = true; kit.log(`Capture (${s.capAfter} s) now comes after hold expiry (${s.ttl} s): no hold can be captured`); }
      if (s.capAfter <= s.ttl) st.warnedTTL = false;
      if (g.pays.length > 300) g.pays = g.pays.filter(q => q.state === 'authorized' || st.t - q.t < 40);
      st.flash = st.flash.filter(f => (f.t += dt) < 0.6);
    }

    function everySecond() {
      const g = st.g;
      if (st.expLog && st.t - st.expLogAt >= 5) {
        kit.log(`${st.expLog} hold${st.expLog > 1 ? 's' : ''} lapsed without being captured; the money goes back to the customers`);
        st.expLog = 0; st.expLogAt = st.t;
      }
      if (!s.up && g.hooks.length && Math.round(st.t) % 5 === 0) {
        const maxTries = Math.max(...g.hooks.map(w => w.tries));
        kit.log(`${g.hooks.length} webhooks waiting; the oldest has failed ${maxTries} time${maxTries === 1 ? '' : 's'} and now retries every ${Math.min(8, 0.5 * 2 ** Math.max(0, maxTries - 1))} s`);
      }
      chart.push({ held: g.count('authorized'), hooks: g.hooks.length, exp: st.win.exp });
      st.win.exp = 0;
      paint();
    }

    function paint() {
      const g = st.g;
      kit.metric('cap', inr(g.sum('captured')));
      kit.metric('held', String(g.count('authorized')));
      const e = g.count('expired');
      kit.metric('exp', String(e), e ? 'bad' : 'good');
      kit.metric('hooks', String(g.hooks.length), g.hooks.length > 10 ? 'bad' : g.hooks.length ? 'warn' : 'good');
    }

    function draw(dt) {
      stage.clear();
      const c = stage.colors, g = st.g, w = stage.w, h = stage.h, small = w < 520;
      const top = 54, colW = (w - 24) / STATES.length, sz = small ? 9 : 11;
      const perRow = Math.max(1, Math.floor((colW - 6) / (sz + 2)));
      const bottom = h * 0.7;
      STATES.forEach(([key, label, shortLabel, col], i) => {
        const x0 = 12 + i * colW;
        stage.text(small ? shortLabel : label, x0, top - 34, { size: small ? 9 : 10.5, weight: 600, color: c.muted });
        stage.text(String(g.count(key)), x0, top - 18, { size: small ? 12 : 13, weight: 700 });
        const rows = Math.max(1, Math.floor((bottom - top) / (sz + 2)));
        const items = g.pays.filter(q => q.state === key).slice(-perRow * rows);
        items.forEach((q, j) => {
          const a = key === 'authorized' ? Math.max(0.25, Math.min(1, 1 - (st.t - q.t) / g.holdTTL)) : 1;
          stage.ctx.save(); stage.ctx.globalAlpha = a;
          stage.rect(x0 + (j % perRow) * (sz + 2), top + Math.floor(j / perRow) * (sz + 2), sz, sz, { fill: c[col], r: 2 });
          stage.ctx.restore();
        });
      });
      const by = h * 0.88, bw = small ? 64 : 96, bh = small ? 26 : 30;
      const gw = { x: Math.max(w * 0.12, 50), y: by, w: bw, h: bh };
      const mc = { x: w - Math.max(w * 0.12, 50), y: by, w: bw, h: bh };
      link(stage, [gw, mc], { color: s.up ? c.wire : c.bad, dash: s.up ? null : [4, 4] });
      for (const f of st.flash) { const pt = at([gw, mc], f.t / 0.6); stage.dot(pt.x, pt.y, 3.5, c.ok); }
      const n = Math.min(g.hooks.length, small ? 14 : 30);
      for (let i = 0; i < n; i++) stage.dot(gw.x + gw.w / 2 + 10 + i * 7, by - 14, 2.6, c.signal);
      box(stage, gw, 'Gateway', '', { size: small ? 11 : 12.5 });
      box(stage, mc, 'Merchant', '', { stroke: s.up ? c.wire : c.bad, dashed: !s.up, size: small ? 11 : 12.5 });
      const msg = s.up ? `webhooks delivered: ${g.delivered}` : small ? `merchant down: ${g.hooks.length} retrying` : `merchant down: ${g.hooks.length} webhooks retrying with backoff`;
      stage.text(msg, w / 2, by - 26, { size: 10, align: 'center', color: s.up ? c.muted : c.bad });
    }

    const fixed = fixedStep(step);
    kit.loop(dt => { fixed(dt); draw(dt); });
    kit.every(1, everySecond);
    hide3dButton(kit);
    reset();

    return {
      reset,
      guidedRun() {
        capAfter.set(8, true); s.capAfter = 8;
        ttl.set(6, true); s.ttl = 6;
        dec.set(10, true); s.dec = 0.1;
        merchant.set('up', true); s.up = true;
        reset();
        st.guided = true; st.warnedTTL = true;
        kit.log('Guided run: capture after 8 s, holds expire after 6 s');
        unpause();
      },
    };
  },
};
