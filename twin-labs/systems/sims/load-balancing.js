// Load balancing: users → balancer → a pool of servers with different speeds.
// Model: each server drains `capacity × speed` requests per second from its queue. A queue longer
// than ~0.4 s of work rejects new requests. Latency grows with utilisation (queueing) and backlog.
// A crashed server keeps receiving traffic until health checks (2 s) take it out of rotation.
// New servers need 4 s to boot. Auto-scaling adds servers above 75% load (2 s in a row) and
// drains one below 30% load (5 s in a row).

const RPS_STEPS = [50, 100, 200, 300, 400, 600, 800, 1000, 1500, 2000, 3000, 4000, 5000];
const SPEEDS = [1, 0.6, 1.25, 0.9, 1.1, 0.7, 1, 1.3, 0.8, 1.15, 0.9, 1.2];
const MAX_SERVERS = 12;
const BOOT_S = 4;
const HEALTH_S = 2;
const ALGO_NAME = { rr: 'round robin', lc: 'least connections', random: 'random' };

export default {
  lead: 'Every server here runs at its own speed, as real machines on shared hardware do. Push one past its limit and it starts turning requests away. Crash one and see how long the health checks take to notice.',
  emptyLog: 'Nothing yet. Fire a spike or crash a server.',
  tryThis: [
    'At <b>800 req/s</b> with 3 servers, switch between round robin and least connections. Watch the slow server (×0.6) drown under one and recover under the other.',
    'Turn on least connections, then <b>crash a server</b>. A dead server has no open connections, so it looks idle and attracts traffic until health checks remove it.',
    'Enable <b>auto-scaling</b> and fire a spike. Count the seconds of errors while the new servers are still booting.',
  ],
  inShort: {
    what: 'A load balancer spreads incoming requests across many servers using a rule such as round robin, least connections or weighted routing.',
    why: 'One machine has a ceiling. Several machines behind one address give more capacity and keep the service up when one of them dies.',
    tradeoff: 'Round robin ignores how busy each server is, so a slow one overloads. Health checks need a few seconds to spot a dead server, and requests sent there in the meantime fail.',
    interview: 'I would put the servers behind a load balancer using least connections with health checks, so slow or failed instances stop receiving traffic.',
  },
  quiz: [
    { q: 'The servers run at different speeds. Which rule automatically sends less work to the slow one?', o: ['Round robin', 'Random', 'Least connections', 'None of them'], a: 2,
      why: 'A slow server holds each request longer, so it always has more open connections, and least connections steers new work elsewhere.' },
    { q: 'A server crashes. Why do some requests keep failing for a few seconds?', o: ['The balancer keeps routing to it until health checks mark it down', 'DNS still caches the dead server', 'The database is locked', 'Auto-scaling deletes requests'], a: 0,
      why: 'Health checks run on an interval and usually need several failures in a row, so detection takes time.' },
    { q: 'Auto-scaling is on and traffic suddenly triples. Why are there still errors at first?', o: ['Auto-scaling only runs at night', 'New servers need time to boot before joining the pool', 'The rule switches to random', 'Errors are part of auto-scaling'], a: 1,
      why: 'The scaler reacts after it sees high load, and each new instance must start up and pass health checks first. Keep headroom for that gap.' },
  ],
  guided: {
    intro: 'Crash one server and watch when the balancer stops using it.',
    example: '“Run the guided example” resets to 3 servers, 200 req/s, 250 req/s capacity each, round robin and no auto-scaling, then crashes a server.',
    question: 'What happens right after the crash?',
    predictions: ['Some requests fail until health checks remove the server.', 'Every request instantly moves to another server with no failures.', 'The healthy servers stop receiving traffic.'],
    correctPrediction: 0,
    running: 'Watch the diagram and “What just happened”. The health-check event should appear about 2 simulated seconds after the crash.',
    observation: 'The crashed server was taken out of rotation only after its health checks failed; until then its share of requests failed.',
    explainQuestion: 'Why did requests fail for a short while?',
    explanations: ['The balancer kept sending requests to the failed server until health checks marked it down.', 'Auto-scaling always deletes requests.', 'The cache has to be flushed after every server failure.'],
    correctExplanation: 0,
    why: 'Redundancy only helps once routing detects the failure, and the surviving servers need spare capacity to absorb the extra share.',
    retryHint: 'Compare the time of the crash with the time of the health-check event in the log.',
    nextSlug: 'caching',
    nextLabel: 'Next experiment: caching →',
    waitSeconds: 9,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { rps: 600, cap: 250, algo: 'rr', auto: false };
    let st; // simulation state, rebuilt by reset()

    kit.metrics([
      { key: 'in', label: 'Incoming / s' }, { key: 'ok', label: 'Served / s' }, { key: 'err', label: 'Failed' },
      { key: 'p95', label: 'p95 response' }, { key: 'live', label: 'Servers in pool' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'avg', label: 'Average', color: 'wire' }, { key: 'p95', label: 'p95', color: 'signal' }],
      bars: { key: 'err', label: 'Failed requests', color: 'bad' },
      format: v => fmtMs(v),
    });
    kit.enable3d({ yaw: -0.35, pitch: 0.5 });

    // ---- controls ----
    const p = kit.panel;
    const rps = p.slider('Traffic', { values: RPS_STEPS, value: s.rps, format: v => `${kit.fmt(v)} req/s`, onInput: v => { s.rps = v; } });
    const count = p.stepper('Servers', { min: 0, max: MAX_SERVERS, value: 3, hint: `New servers take ~${BOOT_S} s to start`,
      onChange: v => { const n = activeCount(); if (v > n) addServer(true); else if (v < n) drainOne(); } });
    const cap = p.slider('Capacity per server', { min: 50, max: 600, step: 10, value: s.cap, format: v => `${v} req/s`, onInput: v => { s.cap = v; } });
    const algo = p.seg('Load-balancing algorithm', { options: [['rr', 'Round robin'], ['lc', 'Least connections'], ['random', 'Random']], value: s.algo,
      onChange: v => { s.algo = v; kit.log(`Switched to ${ALGO_NAME[v]}`); } });
    const auto = p.toggle('Auto-scaling', { value: false, onChange: v => { s.auto = v; st.hot = st.cold = 0; kit.log(v ? 'Auto-scaling on: adds servers above 75% load, drains them below 30%' : 'Auto-scaling off'); } });
    p.buttons([
      { label: 'Traffic spike ×3', kind: 'primary', onClick: spike },
      { label: 'Crash a server', kind: 'outline', onClick: crash },
      { label: 'Reset', kind: 'outline', onClick: reset },
    ]);

    function reset() {
      st = { rr: -1, servers: [], nextId: 1, spikeUntil: 0, acc: 0, winT: 0, win: blankWin(), hot: 0, cold: 0, dotAcc: 0, last: null };
      kit.resetTime();
      stage.clearFlows();
      chart.reset();
      kit.clearLog();
      for (let i = 0; i < 3; i++) addServer(false);
      count.set(3, true);
      paintMetrics();
    }
    const blankWin = () => ({ in: 0, ok: 0, err: 0, lat: [] });
    const activeCount = () => st.servers.filter(x => x.alive && !x.drain).length;

    function addServer(boot) {
      if (activeCount() >= MAX_SERVERS) return null;
      const id = st.nextId++;
      const srv = { id, name: `web-${id}`, speed: SPEEDS[(id - 1) % SPEEDS.length], q: 0, alive: true, inRot: !boot, bootAt: boot ? kit.time + BOOT_S : 0, deadAt: 0, drain: false, took: 0, rho: 0 };
      st.servers.push(srv);
      if (boot) kit.log(`Starting ${srv.name} (×${srv.speed} speed)`);
      return srv;
    }
    function drainOne() {
      const pool = st.servers.filter(x => x.inRot && x.alive);
      if (!pool.length) return;
      const srv = pool[pool.length - 1];
      srv.inRot = false; srv.drain = true;
      kit.log(`Draining ${srv.name}: no new requests, finishing the ones it has`);
    }
    function spike() { st.spikeUntil = kit.time + 10; kit.log('Traffic spike: 3× normal traffic for 10 seconds'); }
    function crash() {
      const pool = st.servers.filter(x => x.alive && x.inRot);
      if (!pool.length) { kit.log('No running server left to crash'); return; }
      const srv = pool[Math.floor(Math.random() * pool.length)];
      srv.alive = false; srv.deadAt = kit.time;
      st.win.err += Math.round(srv.q); st.win.in += Math.round(srv.q); srv.q = 0;
      kit.log(`${srv.name} crashed. Requests routed to it fail until health checks notice`);
      count.set(activeCount(), true);
    }

    function choose() {
      const pool = st.servers.filter(x => x.inRot);
      if (!pool.length) return null;
      if (s.algo === 'rr') { st.rr = (st.rr + 1) % pool.length; return pool[st.rr]; }
      if (s.algo === 'lc') return pool.reduce((a, b) => (b.q / b.speed < a.q / a.speed ? b : a));
      return pool[Math.floor(Math.random() * pool.length)];
    }

    // ---- simulation step ----
    function step(dt) {
      const mult = kit.time < st.spikeUntil ? 3 : 1;
      for (const srv of st.servers) {
        if (srv.bootAt && kit.time >= srv.bootAt) { srv.bootAt = 0; srv.inRot = true; kit.log(`${srv.name} finished starting and joined the pool`); count.set(activeCount(), true); }
        if (srv.drain && srv.q < 0.5) { srv.gone = true; }
      }
      st.servers = st.servers.filter(x => !(x.drain && x.gone) && !(x.removedAt && kit.time > x.removedAt));
      st.acc += s.rps * mult * dt;
      const n = Math.floor(st.acc);
      st.acc -= n;
      const dotRate = Math.min(1, 28 / Math.max(1, s.rps * mult)); // draw at most ~28 dots per second
      for (let i = 0; i < n; i++) {
        st.win.in++;
        const srv = choose();
        let ok = false;
        if (srv) {
          srv.took++;
          const capPerS = s.cap * srv.speed;
          if (!srv.alive) { st.win.err++; }
          else if (srv.q > capPerS * 0.4) { st.win.err++; }
          else {
            const rho = Math.min(srv.rho, 0.95);
            const lat = 15 + Math.random() * 10 + 15 * (1 / (1 - rho) - 1) + (srv.q / capPerS) * 1000;
            srv.q += 1; st.win.ok++; st.win.lat.push(lat); ok = true;
          }
        } else st.win.err++;
        st.dotAcc += dotRate;
        if (st.dotAcc >= 1 && srv) { st.dotAcc -= 1; sendDot(srv, ok); }
      }
      for (const srv of st.servers) {
        const capPerS = s.cap * srv.speed;
        if (srv.alive) srv.q = Math.max(0, srv.q - capPerS * dt);
        srv.rho = srv.rho * 0.92 + 0.08 * (dt > 0 ? srv.took / (capPerS * dt) : srv.rho);
        srv.took = 0;
      }
    }

    function everySecond() {
      for (const srv of st.servers) {
        if (!srv.alive && srv.inRot && kit.time - srv.deadAt >= HEALTH_S) {
          srv.inRot = false; srv.removedAt = kit.time + 2;
          kit.log(`Health checks failed for ${srv.name}, so the balancer took it out of rotation`);
          kit.guided.observe(`${srv.name} was removed from rotation only after its health checks failed; the remaining servers now take every new request.`);
        }
      }
      const pool = st.servers.filter(x => x.inRot && x.alive);
      const total = pool.reduce((a, x) => a + s.cap * x.speed, 0);
      const load = total ? st.win.in / total : 9;
      if (s.auto) {
        const live = activeCount();
        const booting = st.servers.some(x => x.bootAt);
        if (load > 0.75) { st.hot++; st.cold = 0; } else if (load < 0.3) { st.cold++; st.hot = 0; } else { st.hot = 0; st.cold = 0; }
        if (st.hot >= 2 && live < MAX_SERVERS) {
          const want = Math.min(4, MAX_SERVERS - live, Math.max(1, Math.ceil(st.win.in / (s.cap * 0.65)) - live));
          const names = [];
          for (let i = 0; i < want; i++) { const x = addServer(true); if (x) names.push(x.name); }
          if (names.length) kit.log(`Pool at ${pct(Math.min(load, 9.99))} of capacity, so the auto-scaler is starting ${names.join(', ')}`);
          st.hot = 0;
        }
        if (st.cold >= 5 && pool.length > 1 && !booting) {
          const x = pool[pool.length - 1];
          x.inRot = false; x.drain = true; st.cold = 0;
          kit.log(`Pool only at ${pct(load)} of capacity, so the auto-scaler is draining ${x.name}`);
        }
        count.set(activeCount(), true);
      }
      const w = st.win;
      st.last = { in: w.in, ok: w.ok, err: w.err, errPct: w.in ? w.err / w.in : 0, avg: mean(w.lat), p95: p95(w.lat), live: pool.length };
      chart.push({ avg: st.last.avg, p95: st.last.p95, err: w.err });
      st.win = blankWin();
      paintMetrics();
    }

    function paintMetrics() {
      const l = st.last;
      if (!l) { for (const k of ['in', 'ok', 'err', 'p95', 'live']) kit.metric(k, '–'); return; }
      kit.metric('in', kit.fmt(l.in));
      kit.metric('ok', kit.fmt(l.ok));
      kit.metric('err', l.err ? pct(l.errPct) + (l.errPct < 0.01 ? ' (<1%)' : '') : '0%', l.errPct > 0.05 ? 'bad' : l.err ? 'warn' : 'good');
      kit.metric('p95', l.p95 == null ? '–' : fmtMs(l.p95), l.p95 > 600 ? 'bad' : l.p95 > 200 ? 'warn' : '');
      kit.metric('live', String(l.live));
    }

    // ---- drawing ----
    function layout() {
      const w = stage.w, h = stage.h;
      const nodeW = Math.min(110, w * 0.15), lbW = Math.min(130, w * 0.18);
      const user = { x: 14, y: h / 2 - 24, w: nodeW, h: 48 };
      const lb = { x: w * 0.27, y: h / 2 - 24, w: lbW, h: 48 };
      const list = st.servers;
      const sw = Math.min(300, w * 0.4);
      const rowH = Math.min(40, (h - 24) / Math.max(1, list.length) - 6);
      const gap = Math.min(10, ((h - 24) - rowH * list.length) / Math.max(1, list.length));
      const top = h / 2 - (list.length * (rowH + gap) - gap) / 2;
      const rows = list.map((x, i) => ({ x: w - sw - 12, y: top + i * (rowH + gap), w: sw, h: rowH }));
      return { user, lb, rows };
    }
    function sendDot(srv, ok) {
      stage.send(() => {
        const L = layout();
        const i = st.servers.indexOf(srv);
        const r = L.rows[i];
        if (!r) return null;
        return [[L.user.x + L.user.w, L.user.y + L.user.h / 2], [L.lb.x, L.lb.y + L.lb.h / 2], [L.lb.x + L.lb.w, L.lb.y + L.lb.h / 2], [r.x, r.y + r.h / 2]];
      }, { dur: 1, fail: !ok, color: ok ? stage.colors.ok : stage.colors.bad });
    }

    function draw(dt) {
      stage.clear();
      if (kit.is3d) return draw3d();
      const c = stage.colors;
      const L = layout();
      const mult = kit.time < st.spikeUntil ? 3 : 1;
      for (const r of L.rows) stage.line(L.lb.x + L.lb.w, L.lb.y + L.lb.h / 2, r.x, r.y + r.h / 2, { color: c.line2 });
      stage.line(L.user.x + L.user.w, L.user.y + L.user.h / 2, L.lb.x, L.lb.y + L.lb.h / 2, { color: c.line2 });
      stage.drawFlows(dt);
      stage.node(L.user.x, L.user.y, L.user.w, L.user.h, { title: 'Users', sub: `${kit.fmt(s.rps * mult)} req/s`, stroke: mult > 1 ? c.signal : undefined, subColor: mult > 1 ? c.signal : undefined });
      stage.node(L.lb.x, L.lb.y, L.lb.w, L.lb.h, { title: 'Load balancer', sub: ALGO_NAME[s.algo] });
      st.servers.forEach((srv, i) => {
        const r = L.rows[i];
        const load = srv.alive && !srv.bootAt ? srv.rho : 0;
        const status = !srv.alive ? 'down' : srv.bootAt ? `starting ${Math.max(0, Math.ceil(srv.bootAt - kit.time))}s` : srv.drain ? 'draining' : pct(Math.min(load, 9.99));
        stage.node(r.x, r.y, r.w, r.h, {
          title: srv.name, align: 'left', size: Math.min(13, r.h * 0.4 + 2),
          fill: load, state: !srv.alive ? 'dead' : srv.bootAt || srv.drain ? 'idle' : undefined,
          right: status, rightColor: !srv.alive || load >= 1 ? c.bad : srv.bootAt || srv.drain ? c.muted : load > 0.7 ? c.signal : c.ink,
        });
        stage.text(`×${srv.speed}`, r.x + 16 + stage.ctx.measureText(srv.name).width + 8, r.y + r.h / 2, { size: 11, color: c.muted });
      });
      if (!st.servers.length) stage.text('No servers left', stage.w * 0.78, stage.h / 2, { color: c.bad, weight: 700, align: 'center' });
    }

    function draw3d() {
      const c = stage.colors;
      const cam = kit.cam(Math.min(stage.w * 0.42, stage.h * 0.62));
      const n = st.servers.length;
      const cols = Math.min(6, Math.max(3, Math.ceil(n / 2)));
      const items = st.servers.map((srv, i) => {
        const row = Math.floor(i / cols), col = i % cols, inRow = Math.min(cols, n - row * cols);
        return { srv, x: 0.55 + row * 0.42, y: (col - (inRow - 1) / 2) * 0.4 };
      });
      stage.isoBox(cam, -1.1, 0, 0.32, 0.32, 0.12, c.wire, { label: 'Users' });
      stage.isoBox(cam, -0.35, 0, 0.32, 0.32, 0.18, c.teal, { label: 'Balancer' });
      items.sort((a, b) => (a.x + a.y) - (b.x + b.y));
      for (const it of items) {
        const load = it.srv.alive && !it.srv.bootAt ? Math.min(it.srv.rho, 1.6) : 0;
        const col = !it.srv.alive ? c.bad : it.srv.bootAt || it.srv.drain ? c.muted : load >= 1 ? c.bad : load > 0.7 ? c.signal : c.ok;
        stage.isoBox(cam, it.x, it.y, 0.26, 0.26, Math.max(0.03, load * 0.6), col,
          { label: it.srv.name, sub: !it.srv.alive ? 'down' : it.srv.bootAt ? 'starting' : pct(load) });
      }
      stage.text('Drag to rotate · bar height = load', 12, 16, { size: 11, color: c.muted });
    }

    kit.loop(dt => { step(dt); draw(dt); });
    kit.every(1, everySecond);
    reset();

    return {
      reset,
      guidedRun() {
        rps.set(200, true); s.rps = 200;
        cap.set(250, true); s.cap = 250;
        algo.set('rr', true); s.algo = 'rr';
        auto.set(false, true); s.auto = false;
        reset();
        import('../kit/clock.js').then(m => { if (m.isPaused()) m.setPaused(false); });
        setTimeout(crash, 600);
      },
    };
  },
};

const pct = v => `${Math.round(v * 100)}%`;
const mean = a => (a.length ? a.reduce((x, y) => x + y, 0) / a.length : null);
function p95(a) { if (!a.length) return null; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]; }
function fmtMs(v) { if (v == null || !isFinite(v)) return '–'; return v >= 1000 ? `${(v / 1000).toFixed(1)} s` : `${Math.round(v)} ms`; }
