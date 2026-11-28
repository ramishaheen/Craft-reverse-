// Connection pooling: an app sends queries to a database either through a fixed pool of open
// connections or by opening a fresh connection for every request.
// Model (fixed 50 ms steps): requests arrive at the chosen rate; each query holds a connection for
// query time × (0.5…1.5). Pool mode: a free connection runs the query at once, otherwise the request
// joins a FIFO queue; a request that has waited more than 1 s gives up (a timeout). New-connection
// mode: every request first pays 80 ms to connect (handshakes and login) and the database refuses
// anything beyond 100 open connections. Response time = time from arrival to the end of the query.

import { clamp, mean, p95, fmtMs, fixedSteps, unpause, hide3dButton } from './_a-util.js';

const DB_MAX = 100;
const CONNECT_S = 0.08;
const WAIT_LIMIT_S = 1;

/** The connection model, independent of drawing. */
function makePool({ size, pooled }) {
  const P = { size, pooled, busy: [], queue: [], open: 0, done: [], timeouts: 0, refused: 0 };
  P.request = (t, q) => {
    if (P.pooled) {
      if (P.busy.length < P.size) { P.busy.push({ start: t, end: t + q }); return 'run'; }
      P.queue.push({ t, q });
      return 'queued';
    }
    if (P.open >= DB_MAX) { P.refused++; return 'refused'; }
    P.open++;
    P.busy.push({ start: t, end: t + CONNECT_S + q, own: true });
    return 'run';
  };
  P.advance = now => {
    // finish queries in end-time order; each freed connection goes to the head of the queue
    for (;;) {
      let k = -1;
      for (let i = 0; i < P.busy.length; i++) if (P.busy[i].end <= now && (k < 0 || P.busy[i].end < P.busy[k].end)) k = i;
      if (k < 0) break;
      const job = P.busy.splice(k, 1)[0];
      P.done.push(job.end - job.start);
      if (job.own) P.open--;
      while (P.queue.length && job.end - P.queue[0].t > WAIT_LIMIT_S) { P.queue.shift(); P.timeouts++; }
      if (P.pooled && P.queue.length) { const nx = P.queue.shift(); P.busy.push({ start: nx.t, end: job.end + nx.q }); }
    }
    while (P.queue.length && now - P.queue[0].t > WAIT_LIMIT_S) { P.queue.shift(); P.timeouts++; }
    while (P.pooled && P.queue.length && P.busy.length < P.size) { const nx = P.queue.shift(); P.busy.push({ start: nx.t, end: now + nx.q }); }
  };
  P.connections = () => (P.pooled ? P.size : P.open);
  return P;
}

export default {
  lead: 'Opening a database connection is slow (TCP and TLS handshakes, then a login), and a database only accepts so many. A pool opens a fixed set once and lends them out; when all are in use, requests wait in line.',
  emptyLog: 'Nothing yet. Raise the traffic or switch to a new connection per request.',
  tryThis: [
    'Pool of 10, 80 requests/s, 50 ms queries: on average about 4 connections are busy, so nobody has to wait.',
    'Push traffic to <b>300/s</b>. Now 15 connections’ worth of work shares 10: the line grows and requests give up after 1 s.',
    'Choose <b>New one per request</b>. Each request pays 80 ms to connect, and past the database’s limit of 100 connections new ones are turned away.',
  ],
  inShort: {
    what: 'A pool holds a fixed number of open database connections and lends one to each request, which returns it when the query is done.',
    why: 'New connections take time and databases accept only a few hundred, so a connection per request wastes time and runs into the limit.',
    tradeoff: 'A pool that is too small makes requests queue; one that is too large, multiplied over many app servers, overwhelms the database. Size it from load × query time.',
    interview: 'Pool size is roughly requests per second × query time plus headroom; with many app servers I would put a pooler such as PgBouncer in front of Postgres.',
  },
  quiz: [
    { q: 'Why share database connections rather than open a new one for each request?', o: ['Connections cost nothing', 'Each new one pays handshakes and a login, and the database caps how many it accepts', 'Sharing encrypts the queries', 'A pool makes queries return fewer rows'], a: 1,
      why: 'Every new connection pays for TCP, TLS and authentication, and databases limit connections (Postgres often to 100).' },
    { q: 'At 80 requests/s, with each query holding a connection for 50 ms, about how many connections are busy on average?', o: ['1', '4', '40', '80'], a: 1,
      why: 'By Little’s law, busy connections = arrival rate × holding time = 80 × 0.05 = 4.' },
    { q: 'What happens once every pooled connection is in use?', o: ['The pool opens as many extra as needed', 'New requests wait in a queue and fail after a time limit', 'The database restarts', 'Queries speed up'], a: 1,
      why: 'The pool caps the load on the database; requests wait briefly and time out if they wait too long.' },
  ],
  guided: {
    intro: 'Start with a pool that copes easily, then send almost four times the traffic at it.',
    example: '“Run the guided example” resets to the pool, 10 connections, 80 requests/s and 50 ms queries, then raises traffic to 300 requests/s after 4 seconds.',
    question: 'What happens once traffic jumps to 300 requests/s?',
    predictions: ['The queue grows and requests start failing after waiting 1 s.', 'The pool quietly opens more connections, so nothing changes.', 'Queries get faster because the connections are already warm.'],
    correctPrediction: 0,
    running: 'Watch the queue dots under the pool and the “Failed / s” number.',
    observation: 'With all 10 connections busy, new requests piled up in the queue, and those that waited longer than 1 s gave up.',
    explainQuestion: 'Why did requests start failing?',
    explanations: ['The work needed about 15 busy connections but the pool only has 10, so the queue grew until requests timed out.', 'The database crashed under the load.', 'Opening each new connection took 80 ms.'],
    correctExplanation: 0,
    why: 'By Little’s law, 300 requests/s × 50 ms needs 15 connections. Below that the queue only grows; size the pool (and the database) for peak load.',
    retryHint: 'Multiply requests per second by the query time and compare it with the pool size.',
    nextSlug: 'cache-eviction',
    nextLabel: 'Next experiment: cache eviction →',
    waitSeconds: 12,
  },

  setup(kit) {
    const { stage } = kit;
    hide3dButton(kit);
    const s = { pooled: true, size: 10, rate: 80, query: 0.05 };
    let st;

    kit.metrics([
      { key: 'avg', label: 'Avg response' }, { key: 'p95', label: 'p95 response' },
      { key: 'q', label: 'Waiting in the queue' }, { key: 'err', label: 'Failed / s' },
    ]);
    // The busy/waiting history is drawn inside the stage (as stacked bars), so no separate chart.

    const p = kit.panel;
    const mode = p.seg('Connections', { options: [['pool', 'Pool'], ['none', 'New one per request']], value: 'pool',
      onChange: v => {
        s.pooled = v === 'pool';
        size.input.disabled = !s.pooled;
        reset();
        kit.log(s.pooled ? `Using a pool of ${s.size} connections` : 'Opening a new connection for every request (80 ms each, database limit 100)');
      } });
    const size = p.slider('Pool size', { min: 2, max: 40, step: 1, value: s.size, onInput: v => { s.size = v; if (st) st.pool.size = v; } });
    const rate = p.slider('Requests per second', { min: 10, max: 300, step: 10, value: s.rate, format: v => `${v} /s`, onInput: v => { s.rate = v; } });
    const query = p.slider('Query time', { min: 10, max: 300, step: 10, value: 50, format: v => `${v} ms`, onInput: v => { s.query = v / 1000; } });

    function reset() {
      st = { t: 0, arr: 0, pool: makePool({ size: s.size, pooled: s.pooled }), winT: 0, fails: 0, failRate: 0, lat: [], failing: false, queueing: false, hist: [] };
      kit.resetTime();
      kit.clearLog();
      paintMetrics();
    }

    function step(dt) {
      const P = st.pool;
      st.t += dt;
      st.arr += s.rate * dt;
      while (st.arr >= 1) { st.arr -= 1; P.request(st.t, s.query * (0.5 + Math.random())); }
      const before = P.timeouts + P.refused;
      P.advance(st.t);
      st.fails += P.timeouts + P.refused - before;
      st.lat.push(...P.done.splice(0));
      if (st.lat.length > 600) st.lat.splice(0, st.lat.length - 600);
      st.winT += dt;
      if (st.winT >= 0.5 - 1e-9) {
        st.failRate = st.fails / st.winT;
        st.fails = 0; st.winT = 0;
        st.hist.push({ b: P.busy.length, q: P.queue.length });
        if (st.hist.length > 60) st.hist.shift();
        events();
        paintMetrics();
      }
    }

    function events() {
      const P = st.pool;
      if (s.pooled && P.queue.length > 0 && P.busy.length >= P.size && !st.queueing) { st.queueing = true; kit.log(`All ${P.size} connections are busy, so requests are lining up`); }
      else if (st.queueing && P.queue.length === 0) { st.queueing = false; kit.log('The queue has emptied'); }
      if (st.failRate > 0 && !st.failing) {
        st.failing = true;
        if (s.pooled) {
          kit.log('Requests are giving up after waiting 1 s for a connection');
          kit.guided.observe(`All ${P.size} connections stayed busy, ${P.queue.length} requests were waiting, and about ${Math.round(st.failRate)} per second gave up after 1 s in the queue.`);
        } else kit.log(`The database hit its limit of ${DB_MAX} connections and refused new ones`);
      } else if (st.failRate === 0 && st.failing) { st.failing = false; kit.log('No more failures'); }
    }

    function paintMetrics() {
      const P = st.pool, a = st.lat.slice(-300);
      const avg = mean(a), hi = p95(a);
      kit.metric('avg', avg == null ? '–' : fmtMs(avg * 1000), avg > 0.3 ? 'bad' : '');
      kit.metric('p95', hi == null ? '–' : fmtMs(hi * 1000), hi > 0.6 ? 'bad' : '');
      kit.metric('q', String(P.queue.length), P.queue.length > s.size ? 'bad' : P.queue.length ? 'warn' : 'good');
      kit.metric('err', st.failRate.toFixed(0), st.failRate > 0 ? 'bad' : 'good');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, P = st.pool, w = stage.w, h = stage.h;
      const narrow = w < 520;
      const nw = clamp(w * 0.18, 62, 110), nh = narrow ? 36 : 42;
      const cy = Math.max(nh / 2 + 34, h * 0.24);
      const app = { x: Math.max(w * 0.1, nw / 2 + 8) - nw / 2, y: cy - nh / 2 };
      const db = { x: w - Math.max(w * 0.1, nw / 2 + 8) - nw / 2, y: cy - nh / 2 };
      const left = app.x + nw + 16, span = db.x - 16 - left;
      const count = s.pooled ? s.size : Math.min(Math.max(P.open, 1), 60);
      const perRow = Math.min(count, narrow ? 10 : 20), rows = Math.ceil(count / perRow);
      const cw = Math.min(18, span / perRow - 3), ch = Math.min(14, cw * 0.8);
      const top = cy - (rows * (ch + 3)) / 2;
      stage.line(app.x + nw, cy, left, cy, { color: c.wire, alpha: 0.3 });
      stage.line(left + span, cy, db.x, cy, { color: c.wire, alpha: 0.3 });
      stage.node(app.x, app.y, nw, nh, { title: 'App', sub: `${s.rate} req/s` });
      const full = !s.pooled && P.open >= DB_MAX;
      stage.node(db.x, db.y, nw, nh, { title: narrow ? 'DB' : 'Database', sub: narrow ? `${P.connections()}/${DB_MAX}` : `${P.connections()} of ${DB_MAX} conns`, stroke: full ? c.bad : undefined, subColor: full ? c.bad : undefined });
      stage.text(s.pooled ? `Pool: ${P.busy.length} of ${s.size} busy` : `${P.open} connections open`, left + span / 2, top - 10, { size: 10.5, weight: 600, color: c.muted, align: 'center' });
      const x0 = left + (span - perRow * (cw + 3)) / 2;
      for (let i = 0; i < count; i++) {
        const x = x0 + (i % perRow) * (cw + 3), y = top + Math.floor(i / perRow) * (ch + 3);
        const job = P.busy[i];
        const fill = job ? (job.own && st.t < job.start + CONNECT_S ? c.signal : c.ok) : c.surface;
        stage.rect(x, y, cw, ch, { fill, stroke: c.line, width: 1, r: 3 });
      }
      const qy = cy + nh / 2 + 22;
      stage.text(s.pooled ? `Queue: ${P.queue.length} waiting (they give up after 1 s)` : 'No queue: each request opens its own connection', 12, qy, { size: 10.5, weight: 600, color: c.muted });
      const shown = Math.min(P.queue.length, Math.floor((w - 30) / 9));
      for (let i = 0; i < shown; i++) {
        const age = st.t - P.queue[i].t;
        stage.dot(18 + i * 9, qy + 20, 3.2, age > 0.7 ? c.bad : age > 0.3 ? c.signal : c.wire);
      }
      if (!s.pooled) stage.text('amber = still connecting (80 ms), green = running its query', 12, qy + 20, { size: 10.5, color: c.muted });
      // history: busy (green) with waiting (amber, red when longer than the pool) stacked on top
      const hy = qy + 40, bottom = h - 10;
      if (bottom - hy > 30) {
        const max = Math.max(s.pooled ? s.size : 10, ...st.hist.map(d => d.b + d.q), 1);
        const bw = (w - 24) / 60, k = (bottom - hy - 16) / max;
        stage.text(narrow ? 'Busy (green) and waiting, 30 s' : 'Busy connections (green) and waiting requests, last 30 s', 12, hy, { size: 10.5, weight: 600, color: c.muted });
        const ctx = stage.ctx;
        ctx.save(); ctx.globalAlpha = 0.85;
        st.hist.forEach((d, i) => {
          const x = 12 + i * bw, bwid = Math.max(1, bw - 1);
          ctx.fillStyle = c.ok; ctx.fillRect(x, bottom - d.b * k, bwid, d.b * k);
          ctx.fillStyle = d.q > s.size ? c.bad : c.signal; ctx.fillRect(x, bottom - (d.b + d.q) * k, bwid, d.q * k);
        });
        ctx.restore();
        if (s.pooled) { const y = bottom - s.size * k; stage.line(12, y, w - 12, y, { color: c.muted, dash: [4, 4], width: 1 }); stage.text(`pool size ${s.size}`, w - 14, y - 7, { size: 10, color: c.muted, align: 'right' }); }
      }
    }

    kit.loop(dt => { fixedSteps(st, dt, step); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        mode.set('pool', true); s.pooled = true; size.input.disabled = false;
        size.set(10, true); s.size = 10;
        rate.set(80, true); s.rate = 80;
        query.set(50, true); s.query = 0.05;
        reset();
        unpause();
        kit.log('Guided run: 80 requests/s for 4 seconds, then 300 requests/s');
        const mine = st;
        const off = kit.loop(() => {
          if (st !== mine) { off(); return; }
          if (st.t >= 4) { off(); rate.set(300, true); s.rate = 300; kit.log('Traffic raised to 300 requests/s'); }
        });
      },
    };
  },
};
