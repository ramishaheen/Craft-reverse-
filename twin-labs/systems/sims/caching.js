// Caching: clients → API server → cache, and on a miss → database (the cache-aside pattern).
// Model (fixed 50 ms steps): requests arrive at the chosen rate. Each asks for one item id, drawn
// either from a skewed "hot" distribution (id = items × u⁴, so low ids are asked for far more often)
// or uniformly. A cached, unexpired id is a hit (2–5 ms). Otherwise the query joins the database
// backlog, which drains at `database capacity` per second; latency = 6–14 ms + a queueing term
// 12 × (1/(1−ρ) − 1) + backlog/capacity seconds. A backlog of 1.5 s of work makes new queries time
// out. After a successful miss the answer is cached for the TTL. Flushing empties the cache at once.

import { clamp, pct, mean, p95, fmtMs, fixedSteps, unpause, drawKey, hide3dButton } from './_a-util.js';

const RPS_STEPS = [10, 25, 50, 100, 200, 300, 500, 750, 1000];
const ITEM_STEPS = [100, 1000, 10000, 100000];

export default {
  lead: 'Cache-aside in its plainest form: the API looks in an in-memory cache first and only asks the database when the item is missing, then keeps the answer for a while (the TTL).',
  emptyLog: 'Nothing yet. Flush the cache or switch it off under load.',
  tryThis: [
    'Raise traffic to <b>300 req/s</b>, then turn the cache off. The database backlog runs away within seconds.',
    'Press <b>Flush cache</b> while traffic is high: every request misses together, the way a cold start or a cache stampede does.',
    'Spread requests <b>evenly over 100k items</b>. Even with the cache on, the hit rate falls through the floor.',
    'Lengthen the TTL and the hit rate climbs, but each answer can be older. That is the bargain you are making.',
  ],
  inShort: {
    what: 'With cache-aside, the application reads the cache first; on a miss it reads the database and stores the result with a time to live (TTL).',
    why: 'Memory answers in well under a millisecond and shields the database from reading the same rows again and again.',
    tradeoff: 'Until the TTL runs out a cached value can be stale, and when a popular key expires many requests can rush the database together (a stampede).',
    interview: 'I would use cache-aside with a TTL, and add request coalescing or jittered expiry so one hot key expiring cannot swamp the database.',
  },
  quiz: [
    { q: 'With cache-aside, what puts an item into the cache after a miss?', o: ['The database pushes it over', 'The application, once it has read the database', 'The cache fetches it on its own', 'Nothing: the cache is filled in advance'], a: 1,
      why: 'The application checks the cache, falls back to the database on a miss, then writes the answer into the cache with a TTL.' },
    { q: 'What do you give up by choosing a longer TTL?', o: ['Hit rate goes down', 'Readers may get older data', 'The database works harder', 'Each item takes more memory'], a: 1,
      why: 'Entries live longer, so more requests hit, but a change in the database takes longer to reach readers.' },
    { q: 'The cache is flushed during heavy traffic and the database collapses. What is the name for this?', o: ['Split brain', 'A cache stampede (thundering herd)', 'Write amplification', 'Replication lag'], a: 1,
      why: 'All requests miss at the same moment and every one of them goes to the database at once.' },
  ],
  guided: {
    intro: 'Warm the cache under heavy traffic, then empty it in one go and watch the database.',
    example: '“Run the guided example” resets to 750 req/s, the cache on, a 30 s TTL, 1,000 items with a few hot ones and a database that handles 150 queries/s, starting with a warm cache, then flushes the cache after 6 seconds.',
    question: 'What happens in the seconds after the flush?',
    predictions: ['The database load jumps past its capacity and requests time out until the cache refills.', 'Nothing changes: the cache refills before anyone notices.', 'Responses get faster because the cache is empty and lighter.'],
    correctPrediction: 0,
    running: 'Watch the database box and the “Timeouts / s” number. The flush happens about 6 simulated seconds in.',
    observation: 'Right after the flush every request missed at once, the database went far past its capacity, and requests timed out until the hot items were cached again.',
    explainQuestion: 'Why did the database suddenly overload?',
    explanations: ['Every request missed the empty cache at the same moment, so all of them went to the database together.', 'Flushing the cache also slows the database down.', 'The TTL became shorter after the flush.'],
    correctExplanation: 0,
    why: 'A warm cache was hiding most of the read load. Real systems protect against this with request coalescing, staggered warm-up and jittered TTLs.',
    retryHint: 'Compare “Database load” just before and just after the flush event in the log.',
    nextSlug: 'connection-pooling',
    nextLabel: 'Next experiment: connection pooling →',
    waitSeconds: 14,
  },

  setup(kit) {
    const { stage } = kit;
    hide3dButton(kit);
    const s = { rps: 100, cache: true, ttl: 10, keys: 1000, hot: true, dbCap: 200 };
    let st;

    kit.metrics([
      { key: 'hit', label: 'Cache hit rate' }, { key: 'avg', label: 'Avg response' }, { key: 'p95', label: 'p95 response' },
      { key: 'db', label: 'Database load' }, { key: 'err', label: 'Timeouts / s' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'avg', label: 'Average', color: 'wire' }, { key: 'p95', label: 'p95', color: 'signal' }],
      bars: { key: 'err', label: 'Timeouts', color: 'bad' },
      format: v => fmtMs(v),
    });

    const p = kit.panel;
    const rps = p.slider('Traffic', { values: RPS_STEPS, value: s.rps, format: v => `${kit.fmt(v)} req/s`, onInput: v => { s.rps = v; } });
    const cache = p.toggle('Cache (in memory)', { value: true, onChange: v => {
      s.cache = v;
      if (!v) st.store.clear();
      kit.log(v ? 'Cache switched on. It starts empty, so the first requests all miss' : 'Cache switched off: every request now goes to the database');
    } });
    const ttl = p.slider('Cache TTL', { min: 1, max: 120, step: 1, value: s.ttl, format: v => `${v} s`, onInput: v => { s.ttl = v; } });
    const keys = p.slider('Distinct items requested', { values: ITEM_STEPS, value: s.keys, format: v => kit.fmt(v), onInput: v => { s.keys = v; } });
    const pattern = p.seg('Access pattern', { options: [['hot', 'A few hot items'], ['even', 'Evenly spread']], value: 'hot',
      onChange: v => { s.hot = v === 'hot'; kit.log(s.hot ? 'Traffic now favours a few popular items' : 'Traffic now spreads evenly over every item'); } });
    const dbCap = p.slider('Database capacity', { min: 50, max: 600, step: 10, value: s.dbCap, format: v => `${v} queries/s`, onInput: v => { s.dbCap = v; } });
    p.buttons([
      { label: 'Flush cache', kind: 'primary', onClick: flush },
      { label: 'Reset', kind: 'outline', onClick: reset },
    ]);

    const blankWin = () => ({ hit: 0, miss: 0, err: 0, lat: [], db: 0 });
    function reset() {
      st = { store: new Map(), backlog: 0, rho: 0, arr: 0, winT: 0, win: blankWin(), last: null, dotAcc: 0, overloaded: false, flushAt: null, beforeFlush: null };
      kit.resetTime();
      stage.clearFlows();
      chart.reset();
      kit.clearLog();
      paintMetrics();
    }
    function flush() {
      const n = st.store.size;
      st.store.clear();
      st.flushAt = kit.time;
      st.beforeFlush = st.last ? st.last.db / s.dbCap : 0;
      kit.log(`Cache flushed: ${kit.fmt(n)} items thrown away, the next requests all miss`);
    }

    function step(dt) {
      const t = kit.time;
      st.backlog = Math.max(0, st.backlog - s.dbCap * dt);
      st.arr += s.rps * dt;
      const n = Math.floor(st.arr);
      st.arr -= n;
      const dotRate = Math.min(1, 22 / Math.max(1, s.rps));
      let toDb = 0;
      for (let i = 0; i < n; i++) {
        const id = s.hot ? Math.floor(s.keys * Math.pow(Math.random(), 4)) : Math.floor(Math.random() * s.keys);
        let kind, lat = 0;
        if (s.cache && st.store.get(id) > t) { kind = 'hit'; lat = 2 + Math.random() * 3; st.win.hit++; }
        else if (st.backlog >= s.dbCap * 1.5) { kind = 'err'; st.win.err++; }
        else {
          st.backlog += 1; toDb++; st.win.db++; st.win.miss++;
          kind = s.cache ? 'miss' : 'db';
          lat = 6 + Math.random() * 8 + 12 * (1 / (1 - Math.min(st.rho, 0.95)) - 1) + (st.backlog / s.dbCap) * 1000;
          if (s.cache) st.store.set(id, t + s.ttl);
        }
        if (kind !== 'err') st.win.lat.push(lat);
        st.dotAcc += dotRate;
        if (st.dotAcc >= 1) { st.dotAcc -= 1; sendDot(kind, lat); }
      }
      st.rho = st.rho * 0.9 + 0.1 * (toDb / (s.dbCap * dt));
    }

    function everySecond() {
      const w = st.win, total = w.hit + w.miss + w.err;
      let cached = 0;
      for (const [k, exp] of st.store) { if (exp > kit.time) cached++; else st.store.delete(k); }
      st.last = { hr: s.cache && total ? w.hit / total : 0, avg: mean(w.lat), p95: p95(w.lat), db: w.db, err: w.err, cached };
      chart.push({ avg: st.last.avg, p95: st.last.p95, err: w.err });
      const load = w.db / s.dbCap;
      if (w.err && !st.overloaded) { st.overloaded = true; kit.log(`The database is ${Math.round(st.backlog)} queries behind, so new misses time out`); }
      else if (!w.err && st.overloaded && st.backlog < s.dbCap * 0.25) { st.overloaded = false; kit.log('The database caught up and timeouts stopped'); }
      if (st.flushAt != null && kit.time - st.flushAt >= 0.9) {
        kit.log(`Database load went from ${pct(st.beforeFlush)} before the flush to ${pct(load)} now`);
        if (load > 1) kit.guided.observe(`Database load went from ${pct(st.beforeFlush)} just before the flush to ${pct(load)} right after it${w.err ? `, and ${w.err} requests timed out in that second` : ', so its backlog started to build'}.`);
        st.flushAt = null;
      }
      st.win = blankWin();
      paintMetrics();
    }

    function paintMetrics() {
      const l = st.last;
      if (!l) { for (const k of ['hit', 'avg', 'p95', 'db', 'err']) kit.metric(k, '–'); return; }
      kit.metric('hit', s.cache ? pct(l.hr) : 'off', s.cache ? (l.hr > 0.8 ? 'good' : l.hr < 0.4 ? 'warn' : '') : '');
      kit.metric('avg', fmtMs(l.avg), l.avg > 500 ? 'bad' : l.avg > 150 ? 'warn' : '');
      kit.metric('p95', fmtMs(l.p95), l.p95 > 1000 ? 'bad' : l.p95 > 300 ? 'warn' : '');
      const load = l.db / s.dbCap;
      kit.metric('db', pct(load), load >= 1 ? 'bad' : load > 0.75 ? 'warn' : '');
      kit.metric('err', String(l.err), l.err ? 'bad' : '');
    }

    // ---- drawing ----
    function layout() {
      const w = stage.w, h = stage.h;
      const nw = clamp(w * 0.19, 78, 130), nh = 46;
      const right = w - Math.max(w * 0.17, nw / 2 + 12);
      const box = (cx, cy) => ({ x: cx - nw / 2, y: cy - nh / 2, w: nw, h: nh, cx, cy });
      return {
        clients: box(Math.max(w * 0.1, nw / 2 + 10), h * 0.5),
        api: box(w * 0.42, h * 0.5),
        cache: box(right, h * 0.22),
        db: box(right, h * 0.7),
      };
    }
    const ROUTES = {
      hit: ['clients', 'api', 'cache', 'api', 'clients'],
      miss: ['clients', 'api', 'cache', 'api', 'db', 'api', 'clients'],
      db: ['clients', 'api', 'db', 'api', 'clients'],
      err: ['clients', 'api', 'db'],
    };
    function sendDot(kind, lat) {
      const c = stage.colors;
      const dur = kind === 'hit' ? 1.1 : kind === 'err' ? 1.2 : 1.7 + Math.min(lat, 2000) / 1000;
      stage.send(() => { const L = layout(); return ROUTES[kind].map(k => [L[k].cx, L[k].cy]); },
        { dur, fail: kind === 'err', color: kind === 'hit' ? c.ok : kind === 'err' ? c.bad : c.signal });
    }

    function draw(dt) {
      stage.clear();
      const c = stage.colors, L = layout(), l = st.last;
      stage.line(L.clients.cx, L.clients.cy, L.api.cx, L.api.cy, { color: c.wire, alpha: 0.4 });
      stage.line(L.api.cx, L.api.cy, L.db.cx, L.db.cy, { color: c.wire, alpha: 0.4 });
      stage.line(L.api.cx, L.api.cy, L.cache.cx, L.cache.cy, s.cache ? { color: c.wire, alpha: 0.4 } : { color: c.wire, alpha: 0.15, dash: [4, 4] });
      stage.drawFlows(dt);
      stage.node(L.clients.x, L.clients.y, L.clients.w, L.clients.h, { title: 'Clients', sub: `${kit.fmt(s.rps)} req/s` });
      stage.node(L.api.x, L.api.y, L.api.w, L.api.h, { title: 'API server', sub: 'cache-aside' });
      stage.ctx.save();
      if (!s.cache) stage.ctx.globalAlpha = 0.45;
      stage.node(L.cache.x, L.cache.y, L.cache.w, L.cache.h, { title: 'Cache', stroke: c.ok, dashed: !s.cache,
        sub: s.cache ? (l ? `${kit.fmt(l.cached)} items` : 'warming up') : 'switched off' });
      stage.ctx.restore();
      const load = l ? l.db / s.dbCap : 0;
      stage.node(L.db.x, L.db.y, L.db.w, L.db.h, { title: 'Database', sub: `${l ? l.db : 0} / ${s.dbCap} q/s`,
        stroke: load >= 1 ? c.bad : c.wire, subColor: load >= 1 ? c.bad : undefined });
      const bx = L.db.x + 8, by = L.db.y + L.db.h + 6, bw = L.db.w - 16;
      stage.bar(bx, by, bw, 5, clamp(load, 0, 1), load >= 1 ? c.bad : load > 0.75 ? c.signal : c.ok);
      if (st.backlog > s.dbCap * 0.25) stage.text(`${Math.round(st.backlog)} queries waiting`, L.db.cx, by + 18, { size: 11, weight: 600, color: c.bad, align: 'center' });
      drawKey(stage, 10, stage.h - 14, [[c.ok, 'cache hit'], [c.signal, 'goes to database'], [c.bad, 'timed out']], stage.w - 20);
    }

    kit.loop(dt => { fixedSteps(st, dt, step); draw(dt); });
    kit.every(1, everySecond);
    reset();

    return {
      reset,
      guidedRun() {
        rps.set(750, true); s.rps = 750;
        cache.set(true, true); s.cache = true;
        ttl.set(30, true); s.ttl = 30;
        keys.set(1000, true); s.keys = 1000;
        pattern.set('hot', true); s.hot = true;
        dbCap.set(150, true); s.dbCap = 150;
        reset();
        unpause();
        for (let id = 0; id < s.keys; id++) st.store.set(id, Math.random() * s.ttl); // start warm, expiries spread over the TTL
        kit.log('Guided run: the cache starts warm; it will be flushed after 6 seconds');
        const mine = st;
        const off = kit.loop(() => { if (st !== mine) { off(); return; } if (kit.time >= 6) { off(); flush(); } });
      },
    };
  },
};
