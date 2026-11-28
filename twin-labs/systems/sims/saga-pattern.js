// Saga pattern: one order runs four local steps in four services (create order, reserve stock,
// charge card, book courier). Each step fails at its own rate (the order step never fails). When a
// step fails, the saga runs the undo of every step that already succeeded, newest first. With
// compensation off, failed orders keep whatever their earlier steps did. Each step or undo takes
// 0.45 s; orders run one after another.

import { fixedStep, clamp, box, link, burst, row, unpause, hide3dButton } from './_d-util.js';

const STEPS = [
  { k: 'order', does: 'Create order', undo: 'Cancel order', short: 'Order' },
  { k: 'stock', does: 'Reserve stock', undo: 'Release stock', short: 'Stock' },
  { k: 'pay', does: 'Charge card', undo: 'Refund card', short: 'Card' },
  { k: 'ship', does: 'Book courier', undo: 'Cancel courier', short: 'Courier' },
];
const STEP_S = 0.45;

function runSaga(fail, compensate) {
  const log = [], ok = [];
  let failedAt = null;
  for (const x of STEPS) {
    const good = !(Math.random() < (fail[x.k] || 0));
    log.push({ k: x.k, act: 'do', ok: good });
    if (!good) { failedAt = x.k; break; }
    ok.push(x.k);
  }
  if (failedAt && compensate) for (const k of ok.slice().reverse()) log.push({ k, act: 'undo', ok: true });
  return { ok: !failedAt, failedAt, log, leftover: failedAt && !compensate ? ok.slice() : [], done: ok.slice() };
}
const step = k => STEPS.find(x => x.k === k);

export default {
  lead: 'An order touches four services, each owning its own database: orders, inventory, payments and shipping. No single transaction can span them. A saga runs the steps one at a time, and when one fails it runs an undo for every step that had already succeeded.',
  emptyLog: 'Orders are running. Failures appear here.',
  tryThis: [
    'Wait for an order to fail at <b>Book courier</b>. The saga refunds the card, releases the stock and cancels the order, newest step first.',
    'Switch compensation <b>Off</b>. Failed orders leave stock reserved and cards charged: customers paid for nothing.',
    'Notice that nothing is ever locked across services. Each step commits by itself; the saga only promises to finish in a consistent state.',
  ],
  inShort: {
    what: 'A saga breaks one business action into local steps in different services, and gives each step a compensating undo that runs if a later step fails.',
    why: 'Each microservice owns its own database, so no single transaction covers them, and two-phase commit blocks and scales badly.',
    tradeoff: 'While a saga runs the system is briefly inconsistent; some undos are imperfect (a sent email stays sent), and every undo must be idempotent.',
    interview: 'An orchestrated saga: the order service drives reserve stock, charge, book courier; on failure it runs refund, release and cancel, with every step idempotent and retried.',
  },
  quiz: [
    { q: 'Why use a saga rather than one database transaction for an order?', o: ['Sagas are quicker to write', 'The steps live in different services and databases, so one transaction cannot cover them', 'Transactions are insecure', 'To skip testing'], a: 1,
      why: 'Each microservice owns its data; a saga coordinates local transactions instead of holding a distributed lock over all of them.' },
    { q: 'The card was charged, but booking a courier failed. What does the saga do?', o: ['Nothing', 'Runs compensations: refund the card, release the stock, cancel the order', 'Charges the card again', 'Waits forever'], a: 1,
      why: 'Every successful step has an undo, executed in reverse order, so the system ends up consistent.' },
    { q: 'What property must compensating actions have?', o: ['Instant', 'Safe to repeat (idempotent), because they may run more than once after a failure', 'Invisible to users', 'Run before the step'], a: 1,
      why: 'An undo may be retried after a crash, and refunding twice must not happen; use idempotency keys.' },
  ],
  guided: {
    intro: 'Turn compensation off and make couriers scarce.',
    example: '“Run the guided example” resets with compensation off, no card declines, no stock-outs and courier booking failing half the time.',
    question: 'What happens to orders that fail at the courier step?',
    predictions: ['The customer is charged but gets no order.', 'Everything is rolled back automatically.', 'The order ships anyway.'],
    correctPrediction: 0,
    running: 'Watch the step boxes and the “Charged with no order” metric.',
    observation: 'Without undos, an order that failed at the courier step kept its reserved stock and its charge.',
    explainQuestion: 'Why was the money not returned?',
    explanations: ['Each step had committed on its own, and nothing ran the refund once a later step failed.', 'The card network kept it.', 'Couriers charge a cancellation fee.'],
    correctExplanation: 0,
    why: 'With no global transaction, only compensating actions can reverse committed steps. Turn them back on and failed orders roll back cleanly.',
    retryHint: 'Look at which steps a failed order left applied in the recent-orders list.',
    nextSlug: 'inventory-holds',
    nextLabel: 'Next experiment: inventory holds →',
    waitSeconds: 14,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { comp: true, fail: { pay: 0.15, ship: 0.15, stock: 0.1 } };
    let st;

    kit.metrics([
      { key: 'ok', label: 'Orders completed' }, { key: 'undo', label: 'Rolled back cleanly' },
      { key: 'bad', label: 'Left half-done' }, { key: 'money', label: 'Charged with no order' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'ok', label: 'Completed', color: 'ok' }, { key: 'undo', label: 'Rolled back', color: 'signal' }, { key: 'bad', label: 'Half-done', color: 'bad' }],
    });

    const p = kit.panel;
    const comp = p.seg('Compensating actions (undo)', { options: [['on', 'On'], ['off', 'Off']], value: 'on',
      onChange: v => { s.comp = v === 'on'; kit.log(s.comp ? 'Compensation on: failed orders will be undone step by step' : 'Compensation off: failed orders keep whatever their earlier steps did'); } });
    const pay = p.slider('Card declined', { min: 0, max: 50, step: 5, value: 15, format: v => `${v}%`, onInput: v => { s.fail.pay = v / 100; } });
    const ship = p.slider('No courier available', { min: 0, max: 50, step: 5, value: 15, format: v => `${v}%`, onInput: v => { s.fail.ship = v / 100; } });
    const stock = p.slider('Out of stock', { min: 0, max: 50, step: 5, value: 10, format: v => `${v}%`, onInput: v => { s.fail.stock = v / 100; } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    function reset() {
      st = { t: 0, cur: null, curT: 0, n: { ok: 0, undo: 0, bad: 0, money: 0 }, recent: [], guided: false };
      kit.resetTime();
      chart.reset();
      kit.clearLog();
      paint();
    }

    function finish() {
      const o = st.cur;
      if (o.ok) st.n.ok++;
      else if (o.log.some(e => e.act === 'undo') || !o.done.length) {
        st.n.undo++;
        kit.log(o.done.length ? `${step(o.failedAt).does} failed, so the saga ran ${o.done.slice().reverse().map(k => step(k).undo.toLowerCase()).join(', ')}` : `${step(o.failedAt).does} failed at the first step; nothing to undo`);
      } else {
        st.n.bad++;
        const charged = o.leftover.includes('pay');
        if (charged) st.n.money++;
        kit.log(`${step(o.failedAt).does} failed with no undo: left ${o.leftover.map(k => step(k).does.toLowerCase()).join(', ')} in place${charged ? ', so the customer paid for nothing' : ''}`);
        if (charged && st.guided) { st.guided = false; kit.guided.observe(`An order failed at “${step(o.failedAt).does}” but its card charge and stock reservation stayed: the customer paid and got nothing.`); }
      }
      st.recent.unshift(o);
      st.recent.length = Math.min(st.recent.length, 6);
      st.cur = null;
    }

    function tick(dt) {
      st.t += dt;
      if (!st.cur) { st.cur = runSaga(s.fail, s.comp); st.curT = 0; return; }
      st.curT += dt;
      if (st.curT >= (st.cur.log.length + 1) * STEP_S) finish();
    }

    function everySecond() { chart.push({ ...st.n }); paint(); }

    function paint() {
      const n = st.n;
      kit.metric('ok', String(n.ok));
      kit.metric('undo', String(n.undo), n.undo ? 'warn' : '');
      kit.metric('bad', String(n.bad), n.bad ? 'bad' : 'good');
      kit.metric('money', String(n.money), n.money ? 'bad' : 'good');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h, small = W < 520;
      const bw = clamp((W - 40) / 4 - 10, 62, 130), bh = small ? 36 : 42, y = H * 0.3;
      const boxes = STEPS.map((x, i) => ({ x: 20 + bw / 2 + i * ((W - 40 - bw) / 3), y, w: bw, h: bh, s: x }));
      link(stage, boxes, { color: c.wire });
      const o = st.cur, idx = o ? Math.floor(st.curT / STEP_S) : -1, state = {};
      if (o) o.log.slice(0, Math.max(0, idx)).forEach(e => { state[e.k] = e.act === 'undo' ? 'undone' : e.ok ? 'done' : 'failed'; });
      for (const b of boxes) {
        const k = state[b.s.k];
        const col = k === 'done' ? c.ok : k === 'failed' ? c.bad : k === 'undone' ? c.signal : c.wire;
        box(stage, b, small ? b.s.short : b.s.does, k === 'undone' ? (small ? 'undone' : b.s.undo) : k || '', { stroke: col, width: k ? 2.5 : 1.5, subColor: k ? col : undefined, size: small ? 11 : 12.5 });
      }
      if (o && idx >= 0 && idx < o.log.length) {
        const e = o.log[idx], b = boxes[STEPS.findIndex(x => x.k === e.k)], k = (st.curT % STEP_S) / STEP_S;
        if (e.act === 'do' && !e.ok && k > 0.5) burst(stage, b, (k - 0.5) * 2, c.bad);
        else stage.dot(b.x, b.y - bh / 2 - 10 - (1 - k) * 10, 4.5, e.act === 'undo' ? c.signal : c.wire);
        const x = step(e.k);
        stage.text(e.act === 'undo' ? `undo: ${x.undo}` : e.ok ? x.does : `${x.does} failed`, W / 2, y + bh / 2 + 12, { size: 11, weight: 600, align: 'center', baseline: 'top', color: e.act === 'undo' ? c.signal : e.ok ? c.ink : c.bad });
      }
      const ly = y + bh / 2 + 36, rh = small ? 14 : 16;
      stage.text('Recent orders', 12, ly, { size: 10.5, weight: 600, color: c.muted });
      st.recent.slice(0, Math.max(1, Math.floor((H - ly - 8) / rh))).forEach((r, i) => {
        const half = !r.ok && r.leftover.length > 0;
        const f = r.failedAt && step(r.failedAt).does.toLowerCase();
        const txt = r.ok ? 'completed' : half ? `${f} failed: left ${r.leftover.join(', ')} applied` : `${f} failed: rolled back`;
        row(stage, 12, ly + 10 + i * rh, W - 24, rh - 3, txt, '', { leftColor: half ? c.bad : r.ok ? c.ok : c.signal, fill: half ? c.surface3 : c.surface });
      });
    }

    const fixed = fixedStep(tick);
    kit.loop(dt => { fixed(dt); draw(); });
    kit.every(1, everySecond);
    hide3dButton(kit);
    reset();

    return {
      reset,
      guidedRun() {
        comp.set('off', true); s.comp = false;
        pay.set(0, true); s.fail.pay = 0;
        stock.set(0, true); s.fail.stock = 0;
        ship.set(50, true); s.fail.ship = 0.5;
        reset();
        st.guided = true;
        kit.log('Guided run: compensation off, courier booking fails half the time');
        unpause();
      },
    };
  },
};
