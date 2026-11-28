// Idempotency: client → payment API → ledger, with replies lost on the way back.
// Model: payments start at `rate` per second. A request takes 0.55 s to reach the API, which charges
// the card (one ledger row per charge). The reply then travels back for 0.55 s, but with probability
// `loss` it is lost half-way. A client that hears nothing waits 0.5 s and retries (up to `retries`
// times). Without a key every arriving request is a new charge; with a key the API stores
// key → charge number and answers a repeat from that store, so no second charge is made.

const TRAVEL = 0.55; // seconds for a request or a reply to cross
const RETRY_WAIT = 0.5; // client timeout before it retries
import { fixedStep, along, glow, failMark, tile, fitText, box, clamp, throttle, unpause } from './_c-util.js';

function makeServer(idem) {
  const srv = { idem, store: new Map(), ledger: [], nextCharge: 1 };
  srv.handle = (payment, key) => {
    if (srv.idem && srv.store.has(key)) return { charge: srv.store.get(key), replay: true };
    const charge = srv.nextCharge++;
    srv.ledger.push({ payment, charge });
    if (srv.idem) srv.store.set(key, charge);
    return { charge, replay: false };
  };
  srv.doubles = () => {
    const seen = new Set();
    let n = 0;
    for (const row of srv.ledger) { if (seen.has(row.payment)) n++; else seen.add(row.payment); }
    return n;
  };
  return srv;
}

export default {
  lead: 'The card gets charged, but the reply never makes it back. From the client\'s side that looks exactly like a request that was never received, so it tries again. With no idempotency key, the second attempt is a second charge.',
  emptyLog: 'Nothing yet. Payments are starting.',
  tryThis: [
    'Leave the key <b>Off</b> and lose 30% of replies. Red rows build up in the ledger: one payment, two charges.',
    'Switch the key <b>On</b>. The client keeps retrying, yet the API answers each repeat from its key store, so every payment shows up in the ledger exactly once.',
    'Drop retries to <b>0</b>. Double charges vanish, but now some customers never find out whether they paid. You need the retries; the key is what makes them harmless.',
  ],
  inShort: {
    what: 'An idempotency key is a unique id attached to a request so the server can tell that a second arrival is a retry of the same operation.',
    why: 'A timed-out call could have failed before or after doing its work, so clients have to retry, and without a key a retried payment is charged again.',
    tradeoff: 'The server has to keep every key with its stored result for some time (a day is common) and cope with two copies of a request arriving at once.',
    interview: 'Each payment carries an Idempotency-Key from the client; the server records the outcome under that key in the same transaction as the charge and replays it to any retry.',
  },
  quiz: [
    { q: 'A payment call times out on the client. What does the client really know?', o: ['The card was not charged', 'The card was charged', 'Nothing: either the request or just its reply may have gone missing', 'The server is down'], a: 2,
      why: 'A timeout is identical whether the request never got there or the charge went through and only the reply vanished. That ambiguity is why retries need idempotency.' },
    { q: 'How does an idempotency key prevent a double charge?', o: ['It encrypts the request', 'The server saves the result under the key and hands it back for any repeat', 'It makes the network reliable', 'It forbids retries'], a: 1,
      why: 'The first call does the charge and records the result under the key. A retry carrying the same key gets that saved result, and nothing is charged again.' },
    { q: 'Who should generate the idempotency key?', o: ['The server, once it has charged', 'The client, once per payment, reusing it on every retry', 'A fresh random key on each retry', 'The database'], a: 1,
      why: 'Every retry of one payment must carry the same key, so the client makes it before the first attempt (Stripe, for example, reads it from an Idempotency-Key header).' },
  ],
  guided: {
    intro: 'Run payments with no idempotency key while some replies get lost, and watch the ledger.',
    example: '“Run the guided example” switches the key off, loses 30% of replies, allows 2 retries at 1.5 payments a second, and starts over.',
    question: 'What will show up in the ledger?',
    predictions: ['Some payments are charged twice.', 'Every payment is charged exactly once, because the client only retries failures.', 'Payments with a lost reply are never charged.'],
    correctPrediction: 0,
    running: 'Watch the ledger on the right. A red row means one payment produced more than one charge.',
    observation: 'A payment whose reply was lost was retried, and the API charged it again because the retry looked like a brand-new payment.',
    explainQuestion: 'Why was a payment charged twice?',
    explanations: ['The first charge succeeded but its reply was lost, so the client retried and the API, with no key to compare, charged again.', 'The ledger counts each payment twice by design.', 'The client sent two different payments by mistake.'],
    correctExplanation: 0,
    why: 'A lost reply hides a success. Without a key, the server cannot recognise the retry, so it repeats the side effect.',
    retryHint: 'Look for the “reply lost” mark on the way back, then the amber retry dot that follows it.',
    nextSlug: 'distributed-lock',
    nextLabel: 'Next experiment: distributed lock →',
    waitSeconds: 10,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { idem: false, loss: 0.3, retries: 2, rate: 1.5 };
    const clock = fixedStep();
    const once = throttle();
    let st;

    kit.metrics([
      { key: 'pay', label: 'Payments made' }, { key: 'chg', label: 'Charges in the ledger' },
      { key: 'dbl', label: 'Double charges' }, { key: 'rty', label: 'Retries sent' },
    ]);

    const p = kit.panel;
    const key = p.seg('Idempotency key', { options: [['off', 'Off'], ['on', 'On']], value: 'off', hint: 'On: every retry of a payment carries the same key',
      onChange: v => { s.idem = v === 'on'; reset(); kit.log(s.idem ? 'Key on: the API now remembers each payment key and its charge' : 'Key off: the API treats every request as a new payment'); } });
    const loss = p.slider('Replies lost', { min: 0, max: 60, step: 5, value: 30, format: v => `${v}%`, onInput: v => { s.loss = v / 100; } });
    const retries = p.slider('Retries per payment', { min: 0, max: 4, step: 1, value: 2, format: v => String(v), onInput: v => { s.retries = v; } });
    const rate = p.slider('Payments per second', { min: 0.5, max: 4, step: 0.5, value: 1.5, format: v => `${v} /s`, onInput: v => { s.rate = v; } });
    p.buttons([{ label: 'Start over', kind: 'outline', onClick: () => { reset(); kit.log('Started over with an empty ledger'); } }]);

    function reset() {
      st = { acc: 0, srv: makeServer(s.idem), flights: [], payments: 0, sent: 0, done: 0, gaveUp: 0, flash: [], seenDouble: 0 };
      clock.reset(); once.clear();
      kit.resetTime();
      kit.clearLog();
      paint();
    }
    const launch = (payment, attempt) => st.flights.push({ p: payment, attempt, kind: 'req', t: 0 });

    function step(dt) {
      st.acc += s.rate * dt;
      while (st.acc >= 1) { st.acc -= 1; launch(++st.payments, 1); }
      const next = [];
      for (const f of st.flights) {
        f.t += dt;
        if (f.kind === 'req' && f.t >= TRAVEL) {
          const r = st.srv.handle(f.p, 'pay-' + f.p);
          st.flash.push({ t: 0, replay: r.replay });
          if (r.replay && once.ok('replay', 2.5, kit.time)) kit.log(`Retry of payment ${f.p} carried a known key, so the API replayed charge #${r.charge} instead of charging again`);
          next.push({ p: f.p, attempt: f.attempt, kind: 'res', t: 0, lost: Math.random() < s.loss, replay: r.replay });
          continue;
        }
        if (f.kind === 'res' && f.lost && f.t >= TRAVEL * 0.5) { next.push({ p: f.p, attempt: f.attempt, kind: 'wait', t: 0 }); continue; }
        if (f.kind === 'res' && f.t >= TRAVEL) { st.done++; continue; }
        if (f.kind === 'wait' && f.t >= RETRY_WAIT) {
          if (f.attempt <= s.retries) { st.sent++; launch(f.p, f.attempt + 1); }
          else { st.gaveUp++; if (once.ok('gave', 3, kit.time)) kit.log(`Client gave up on payment ${f.p} after ${s.retries} retr${s.retries === 1 ? 'y' : 'ies'}; it still does not know if the card was charged`); }
          continue;
        }
        next.push(f);
      }
      st.flights = next;
      st.flash = st.flash.filter(x => (x.t += dt) < 0.6);
      const d = st.srv.doubles();
      if (d > st.seenDouble) {
        st.seenDouble = d;
        const counts = new Map();
        for (const row of st.srv.ledger) counts.set(row.payment, (counts.get(row.payment) || 0) + 1);
        const worst = [...counts].reverse().find(([, n]) => n > 1);
        if (worst && once.ok('double', 2, kit.time)) kit.log(`Payment ${worst[0]} is now charged ${worst[1]}×: its retry looked like a new payment`);
        if (worst) kit.guided.observe(`Payment ${worst[0]} lost its reply, the client retried, and with no key the API charged it again (${worst[1]} charges for one payment).`);
      }
    }

    function paint() {
      const srv = st.srv;
      kit.metric('pay', String(st.payments));
      kit.metric('chg', String(srv.ledger.length));
      const d = srv.doubles();
      kit.metric('dbl', String(d), d ? 'bad' : 'good');
      kit.metric('rty', String(st.sent), st.sent ? 'warn' : '');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, w = stage.w, h = stage.h, ctx = stage.ctx;
      const narrow = w < 520;
      const bw = clamp(w * 0.2, 70, 110);
      const y = Math.max(h * 0.22, 48);
      const cl = { x: Math.max(w * 0.1, bw / 2 + 8), y, w: bw, h: 42 };
      const api = { x: w / 2, y, w: bw, h: 42 };
      const led = { x: w - Math.max(w * 0.1, bw / 2 + 8), y, w: bw, h: 42 };
      stage.line(cl.x, y, led.x, y, { color: c.wire, alpha: 0.35 });

      for (const f of st.flights) {
        if (f.kind === 'req') glow(stage, along([{ x: cl.x, y: y - 6 }, { x: api.x, y: y - 6 }], f.t / TRAVEL), 4.5, f.attempt > 1 ? c.signal : c.wire);
        else if (f.kind === 'res') glow(stage, along([{ x: api.x, y: y + 6 }, { x: cl.x, y: y + 6 }], f.t / TRAVEL), 4.5, f.replay ? c.signal : c.ok);
        else if (f.kind === 'wait' && f.t < 0.35) {
          const pt = along([{ x: api.x, y: y + 6 }, { x: cl.x, y: y + 6 }], 0.5);
          failMark(stage, pt, f.t / 0.35, c.bad);
          stage.text('reply lost', pt.x, pt.y - 8, { size: 10, weight: 600, color: c.bad, align: 'center', baseline: 'bottom' });
        }
      }
      box(stage, cl, 'Client', `up to ${s.retries} retr${s.retries === 1 ? 'y' : 'ies'}`);
      const fl = st.flash[st.flash.length - 1];
      box(stage, api, narrow ? 'API' : 'Payment API', s.idem ? 'checks key' : 'charges all', { stroke: fl ? (fl.replay ? c.signal : c.ok) : c.wire, width: fl ? 2.5 : 1.5 });
      box(stage, led, 'Ledger', `${st.srv.ledger.length} charges`);
      const waiting = st.flights.filter(f => f.kind === 'wait').length;
      if (waiting) stage.text(`${waiting} waiting to retry`, cl.x, cl.y - cl.h / 2 - 6, { size: 10.5, color: c.muted, align: 'center', baseline: 'bottom' });

      // lists: key store (left) and charges per payment (right)
      const top = y + 40, rowH = narrow ? 14 : 15;
      const rows = Math.max(1, Math.floor((h - top - 12) / rowH));
      const rx = w * 0.5 + 6, rw = w - rx - 12, lx = 12, lw = w * 0.5 - 24;
      const head = (txt, x, maxW) => fitText(stage, txt, x, top - 2, maxW, { size: 10.5, weight: 600, color: c.muted });
      const counts = new Map();
      for (const row of st.srv.ledger) counts.set(row.payment, (counts.get(row.payment) || 0) + 1);
      head(narrow ? 'Charges per payment' : 'Ledger: charges per payment', rx, rw);
      [...counts].slice(-(rows - 1)).reverse().forEach(([pay, n], i) => {
        const ry = top + 10 + i * rowH;
        const dbl = n > 1;
        tile(stage, rx, ry, rw, rowH - 3, { fill: dbl ? c.bad : c.surface, fillAlpha: dbl ? 0.32 : 1, stroke: dbl ? c.bad : c.line });
        stage.text(`payment ${pay}`, rx + 6, ry + (rowH - 3) / 2, { size: 10, color: c.ink });
        stage.text(dbl ? `charged ${n}×` : 'charged once', rx + rw - 6, ry + (rowH - 3) / 2, { size: 10, weight: dbl ? 700 : 500, color: dbl ? c.bad : c.ink, align: 'right' });
      });
      head(s.idem ? 'Key store' : narrow ? 'No key store' : 'No key store: a retry looks new', lx, lw);
      if (s.idem) {
        [...st.srv.store].slice(-(rows - 1)).reverse().forEach(([k, ch], i) => {
          const ry = top + 10 + i * rowH;
          tile(stage, lx, ry, lw, rowH - 3, { fill: c.surface, stroke: c.line });
          ctx.font = `500 10px ${stage.font}`;
          stage.text(narrow ? `${k} → #${ch}` : `${k}  →  charge #${ch}`, lx + 6, ry + (rowH - 3) / 2, { size: 10, color: c.ink, maxWidth: lw - 10 });
        });
      }
    }

    kit.loop(dt => { clock.run(dt, step); paint(); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        key.set('off', true); s.idem = false;
        loss.set(30, true); s.loss = 0.3;
        retries.set(2, true); s.retries = 2;
        rate.set(1.5, true); s.rate = 1.5;
        reset();
        unpause();
      },
    };
  },
};
