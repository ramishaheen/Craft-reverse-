// Shopping cart: where the cart is kept and what checkout checks.
// Model (one simulated day = 2 seconds): 4 new carts per second. Each shopper comes back after an
// exponentially distributed delay (mean 2 days); 35% come back on another device; 60% intend to buy.
// On return: a browser-only cart is gone if they switched device; a cache cart is gone if they
// return after the TTL (1–7 days); otherwise non-buyers leave. For buyers, the chance that the price
// changed is min(60%, 10% per day away) and that an item sold out is min(40%, 5% per day); if either
// happened, "re-check" shows them the new price/stock, while "trust the cart" places a wrong order.
// Cart load time: browser 0 ms, cache 1 ms, database 8 ms. Shares count since the last change.

import { stepper, pct, unpause, alpha } from './_e-util.js';

const DAY = 2, RATE = 4, AXIS_DAYS = 7;
const STORE = { browser: { ms: 0 }, cache: { ms: 1 }, db: { ms: 8 } };
const OUT = {
  ok: ['bought', 'ok'], updated: ['shown new price/stock', 'wire'], bad: ['wrong price or sold out', 'bad'],
  lost: ['cart was gone', 'bad'], left: ['did not buy', 'muted'],
};

export default {
  lead: 'Shoppers fill a cart and return days later, a third of them on a different device. Keep the cart only in the browser and the laptop shows it empty. Keep it in a cache with an expiry and old carts disappear. A database keeps everything, but each view is a little slower. And the longer a cart waits, the more likely a price has changed or an item has sold out.',
  emptyLog: 'Carts are being filled. Shoppers come back over the next few simulated days.',
  stageHeight: 380,
  tryThis: [
    'Keep carts in the <b>Browser</b>. Every shopper who returns on another device finds the cart empty.',
    'Use <b>Cache + TTL</b> at 1 day. Fast and small, but anyone back after a weekend has lost the cart. At 7 days far more carts sit in memory.',
    'Pick <b>Trust the cart</b>. Orders go through at last week\'s price or for items that have already sold out.',
  ],
  inShort: {
    what: 'A cart service keeps each shopper\'s items between visits, and checkout turns the cart into an order after checking the current price and stock.',
    why: 'Shoppers change devices and come back days later while prices and stock keep moving.',
    tradeoff: 'A cache is quick but forgets old carts; a database keeps them for a little latency; trusting the cart risks wrong prices and overselling.',
    interview: 'The cart is keyed by user id in a fast store such as Redis and written through to a database; a guest cart is merged at login, and checkout re-validates prices and reserves stock before taking payment.',
  },
  quiz: [
    { q: 'Why do carts saved only in the browser go missing?', o: ['Browsers clear them every hour', 'The shopper returns on another device, which has its own storage', 'They are too large', 'Cookies are banned'], a: 1,
      why: 'Local storage lives on one device; a server-side cart tied to the account follows the shopper.' },
    { q: 'What is the trade-off of keeping carts in Redis with a TTL?', o: ['There is none', 'Fast reads and bounded memory, but carts older than the TTL vanish', 'Slower than a database', 'It uses no memory'], a: 1,
      why: 'Many systems keep active carts in a cache and persist them to a database so long-lived carts survive.' },
    { q: 'Why must checkout check the price and stock again?', o: ['For fun', 'The cart may be days old: prices move and items sell out', 'The cart is encrypted', 'To slow down bots'], a: 1,
      why: 'The cart is only a wish list; the order service validates against current prices and inventory before charging.' },
  ],
  guided: {
    intro: 'Keep carts only in the browser and see who finds an empty cart.',
    example: '“Run the guided example” resets with carts stored in the browser and re-checking at checkout, then lets shoppers come and go for about 14 seconds (seven simulated days).',
    question: 'Roughly how many returning shoppers will find their cart gone?',
    predictions: ['About a third: everyone who comes back on another device.', 'None: browser storage is permanent.', 'All of them: browsers delete carts every night.'],
    correctPrediction: 0,
    running: 'Watch the hollow dots (shoppers who will return on another device) and the “cart was gone” bar.',
    observation: 'Roughly a third of returning shoppers found an empty cart: exactly the ones who came back on a different device.',
    explainQuestion: 'Why were those carts gone?',
    explanations: ['The cart lived in one browser\'s storage, and the other device has its own.', 'The cache expired them after one day.', 'Checkout deleted them after a price change.'],
    correctExplanation: 0,
    why: 'Keep the cart on the server under the account, and use the browser only as a fast copy or for guests.',
    retryHint: 'Compare the “cart was gone” count with the share of shoppers on a new device (35%).',
    nextSlug: 'ticket-booking',
    nextLabel: 'Next experiment: ticket booking →',
    waitSeconds: 24,
  },

  setup(kit) {
    const { stage } = kit;
    const fixed = stepper(0.05);
    let C, st;

    kit.metrics([
      { key: 'lost', label: 'Shoppers whose cart was gone' }, { key: 'bad', label: 'Orders at a wrong price or sold out' },
      { key: 'ms', label: 'Cart load time' }, { key: 'held', label: 'Carts kept on the server' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'held', label: 'Carts kept on the server', color: 'wire' }],
      bars: { key: 'lost', label: 'Carts lost this second', color: 'bad' },
      format: v => String(Math.round(v)),
    });

    const p = kit.panel;
    const store = p.seg('Cart stored in', { options: [['browser', 'Browser'], ['cache', 'Cache + TTL'], ['db', 'Database']], value: 'cache',
      onChange: v => { C.store = v; clearStats(); kit.log({ browser: 'Carts now live only in each shopper\'s browser', cache: `Carts now live in a cache and expire after ${C.ttl} day${C.ttl > 1 ? 's' : ''}`, db: 'Carts are now saved in a database: kept forever, 8 ms per load' }[v]); } });
    const ttl = p.slider('Cache keeps carts for', { min: 1, max: 7, step: 1, value: 3, format: v => `${v} ${v > 1 ? 'days' : 'day'}`, onInput: v => { C.ttl = v; clearStats(); } });
    const check = p.seg('At checkout', { options: [['on', 'Re-check price and stock'], ['off', 'Trust the cart']], value: 'on',
      onChange: v => { C.recheck = v === 'on'; clearStats(); kit.log(C.recheck ? 'Checkout now re-checks price and stock' : 'Checkout now trusts whatever the cart says'); } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    const age = c => (C.now - c.t) / DAY;
    function add() {
      C.carts.push({ t: C.now, back: -Math.log(1 - Math.random()) * 2, switch: Math.random() < 0.35, buys: Math.random() < 0.6, lane: Math.random() });
    }
    function settle(c) {
      const d = c.back;
      let out;
      if (C.store === 'browser' && c.switch) out = 'lost';
      else if (C.store === 'cache' && d > C.ttl) out = 'lost';
      else if (!c.buys) out = 'left';
      else {
        const priced = Math.random() < Math.min(0.6, 0.1 * d), soldOut = Math.random() < Math.min(0.4, 0.05 * d);
        out = priced || soldOut ? (C.recheck ? 'updated' : 'bad') : 'ok';
      }
      C.n[out]++; c.out = out;
      C.done.unshift(c); if (C.done.length > 14) C.done.pop();
      if (out === 'lost') st.secLost++;
      if ((out === 'lost' || out === 'bad') && kit.time - st.lastLog > 2.5) {
        st.lastLog = kit.time;
        kit.log(out === 'bad' ? `A shopper back after ${d.toFixed(1)} days was charged an old price or for a sold-out item`
          : C.store === 'browser' ? 'A shopper came back on another device and the cart was empty (it lived in the other browser)'
            : `A shopper came back after ${d.toFixed(1)} days, past the ${C.ttl}-day TTL: the cart had been deleted`);
      }
    }
    function tick(h) {
      C.now += h; C.acc += RATE * h;
      while (C.acc >= 1) { C.acc -= 1; add(); }
      C.carts = C.carts.filter(c => (age(c) >= c.back ? (settle(c), false) : true));
    }
    const total = () => Object.values(C.n).reduce((a, b) => a + b, 0);
    const held = () => (C.store === 'cache' ? C.carts.filter(c => age(c) <= C.ttl).length : C.store === 'db' ? C.carts.length : 0);
    const lostShare = () => (total() ? C.n.lost / total() : 0);
    const badShare = () => { const b = C.n.ok + C.n.bad + C.n.updated; return b ? C.n.bad / b : 0; };
    function clearStats() { C.n = { ok: 0, lost: 0, bad: 0, updated: 0, left: 0 }; C.done = []; }

    function reset() {
      C = { store: store.get(), ttl: ttl.get(), recheck: check.get() === 'on', now: 0, acc: 0, carts: [], done: [], n: { ok: 0, lost: 0, bad: 0, updated: 0, left: 0 } };
      st = { secLost: 0, lastLog: -9, guided: null };
      kit.resetTime(); chart.reset(); kit.clearLog(); paint();
    }
    function paint() {
      if (!total()) { for (const k of ['lost', 'bad', 'ms', 'held']) kit.metric(k, '–'); return; }
      kit.metric('lost', pct(lostShare()), lostShare() > 0.1 ? 'bad' : lostShare() > 0 ? 'warn' : 'good');
      kit.metric('bad', pct(badShare()), badShare() > 0 ? 'bad' : 'good');
      kit.metric('ms', `${STORE[C.store].ms} ms`, C.store === 'db' ? 'warn' : 'good');
      kit.metric('held', C.store === 'browser' ? '0 (in browsers)' : String(held()));
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h, ctx = stage.ctx;
      const narrow = W < 520, L = 14, R = narrow ? W - 14 : W * 0.62, T = 26, B = narrow ? H * 0.55 : H - 26;
      const X = d => L + ((R - L) * Math.min(d, AXIS_DAYS)) / AXIS_DAYS;
      stage.rect(L, T, R - L, B - T, { fill: c.surface, stroke: c.line, r: 8, width: 1 });
      for (let d = 0; d <= AXIS_DAYS; d++) stage.text(d === 0 ? 'today' : `${d}d`, Math.min(R - 8, Math.max(L + 12, X(d))), B + 9, { size: 9, align: 'center', color: c.muted });
      stage.text(narrow ? 'waiting carts by age' : 'waiting carts by age · hollow = will return on another device', L, T - 9, { size: 9, color: c.muted });
      if (C.store === 'cache') {
        stage.rect(X(C.ttl), T, R - X(C.ttl), B - T, { fill: alpha(c.bad, 0.1), r: 0 });
        stage.line(X(C.ttl), T, X(C.ttl), B, { color: c.bad, width: 2, dash: [5, 4] });
        stage.text('TTL: deleted', X(C.ttl) + 4, T + 10, { size: 9, weight: 600, color: c.bad });
      }
      for (const cart of C.carts) {
        const a = age(cart), x = X(a), y = T + 10 + (B - T - 20) * cart.lane;
        const gone = C.store === 'cache' && a > C.ttl;
        if (cart.switch) stage.ring(x, y, 3.2, { color: alpha(gone ? c.bad : c.ink, gone ? 0.5 : 0.9), width: 1.3 });
        else stage.dot(x, y, 3.2, gone ? c.bad : c.ink, gone ? 0.5 : 0.9);
      }
      const lx = narrow ? 14 : R + 16, ly = narrow ? B + 34 : T, lw = W - 14 - lx, rh = narrow ? 14 : 16;
      stage.text('shoppers coming back', lx, narrow ? ly - 8 : ly - 9, { size: 10, color: c.muted });
      const tot = Math.max(1, total());
      Object.entries(OUT).forEach(([k, [label, col]], i) => {
        const y = ly + i * rh;
        stage.rect(lx, y + 2, Math.max(0.5, (lw * 0.45 * C.n[k]) / tot), rh - 5, { fill: alpha(c[col], 0.75), r: 1 });
        stage.text(`${C.n[k]} ${label}`, lx + lw * 0.47, y + rh / 2, { size: 9, maxWidth: lw * 0.53 });
      });
      if (narrow) return;
      const y0 = ly + 5 * rh + 14, rows = Math.max(0, Math.floor((B - y0) / rh));
      stage.text('latest', lx, y0 - 7, { size: 10, color: c.muted });
      C.done.slice(0, rows).forEach((d, i) => {
        const y = y0 + i * rh, [label, col] = OUT[d.out];
        stage.rect(lx, y, lw, rh - 3, { fill: c.surface, r: 4 });
        stage.text(`${d.back.toFixed(1)}d later${d.switch ? ', new device' : ''}`, lx + 5, y + (rh - 3) / 2, { size: 9 });
        stage.text(label, lx + lw - 5, y + (rh - 3) / 2, { size: 9, align: 'right', color: c[col] });
      });
      void ctx;
    }

    kit.loop(dt => { fixed(dt, tick); paint(); draw(); });
    kit.every(1, () => {
      chart.push({ held: held(), lost: st.secLost });
      st.secLost = 0;
      if (st.guided && kit.time >= 14 && total() >= 40) {
        st.guided = null;
        kit.guided.observe(`${C.n.lost} of ${total()} returning shoppers (${pct(lostShare())}) found an empty cart, all of them shoppers who came back on a different device.`);
      }
    });
    reset();

    return {
      reset,
      guidedRun() {
        store.set('browser', true); check.set('on', true);
        reset();
        st.guided = true;
        unpause();
      },
    };
  },
};
