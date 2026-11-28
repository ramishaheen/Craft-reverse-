// Service discovery: instances heartbeat into a registry, clients cache the registry's list.
// Model: each live instance sends a heartbeat every TTL ÷ 3 seconds; the registry lists an instance
// while its last heartbeat is at most TTL old. Three clients each keep a copy of the list and refresh
// it every `cache` seconds (staggered). 30 requests per second go to a random client, which picks a
// random instance from its cached copy; a request to a crashed instance fails. A crashed instance is
// forgotten 5 s after it leaves the registry. Registry load = heartbeats/s + client lookups/s.

import { fixedStep, fitText, tile, pct, throttle, unpause } from './_c-util.js';

const RATE = 30;
const CLIENTS = 3;
const MAX_INST = 7;

function makeDiscovery({ ttl = 15, cache = 10, n = 4 } = {}) {
  const D = { ttl, cache, now: 0, acc: 0, next: n + 1, inst: [], clients: [], ok: 0, failed: 0, beats: 0, lookups: 0, served: {}, recent: [], events: [] };
  const mk = id => ({ id, up: true, beat: 0, born: 0 });
  for (let i = 1; i <= n; i++) D.inst.push(mk(i));
  D.registry = () => D.inst.filter(x => D.now - x.beat <= D.ttl).map(x => x.id);
  for (let i = 0; i < CLIENTS; i++) D.clients.push({ list: D.registry(), next: D.cache * (i + 1) / CLIENTS });
  D.kill = () => {
    const x = D.inst.find(i => i.up);
    if (x) { x.up = false; x.diedAt = D.now; }
    return x;
  };
  D.add = () => { const x = mk(D.next++); x.beat = D.now; x.born = D.now; D.inst.push(x); return x; };
  D.tick = dt => {
    D.now += dt;
    for (const x of D.inst) if (x.up && D.now - x.beat >= D.ttl / 3) { x.beat = D.now; D.beats++; }
    D.inst = D.inst.filter(x => x.up || D.now - x.beat <= D.ttl + 5);
    D.clients.forEach((cl, i) => {
      cl.next -= dt;
      if (cl.next <= 0) {
        cl.next += D.cache;
        const before = cl.list;
        cl.list = D.registry();
        D.lookups++;
        D.events.push({ client: i + 1, dropped: before.filter(id => !cl.list.includes(id)), added: cl.list.filter(id => !before.includes(id)) });
      }
    });
    D.acc += RATE * dt;
    while (D.acc >= 1) {
      D.acc -= 1;
      const cl = D.clients[Math.floor(Math.random() * D.clients.length)];
      if (!cl.list.length) { D.failed++; continue; }
      const id = cl.list[Math.floor(Math.random() * cl.list.length)];
      const x = D.inst.find(i => i.id === id);
      const ok = !!(x && x.up);
      if (ok) { D.ok++; D.served[id] = (D.served[id] || 0) + 1; } else D.failed++;
      D.recent.unshift({ id, ok, t: D.now, cl: D.clients.indexOf(cl) });
      if (D.recent.length > 40) D.recent.pop();
    }
  };
  D.cleared = x => D.clients.every(cl => !cl.list.includes(x.id)) && !D.registry().includes(x.id);
  return D;
}

export default {
  lead: 'Clients have to know which copies of a service are alive. Every instance registers and keeps sending heartbeats; the registry drops one that stays silent longer than its TTL. Clients keep a cached copy of the list so they do not ask every time. Crash an instance and see requests keep landing on it until the registry and every client cache have noticed.',
  emptyLog: 'Nothing yet. Crash an instance or add one.',
  tryThis: [
    'Press <b>Crash an instance</b>. Requests to it fail (red) for up to TTL plus cache time, about 20 seconds with these settings.',
    'Set the TTL to 3 s and the cache to 2 s, then crash another. The failures stop within a few seconds, but the registry now handles far more calls.',
    'Press <b>Add an instance</b>. It can serve straight away, yet it gets no traffic until the clients refresh their cached lists.',
  ],
  inShort: {
    what: 'Service discovery maintains a live list of which instances of each service are up, built from registrations and heartbeats, so clients know where to send requests.',
    why: 'Deploys, autoscaling and crashes add and remove instances all the time, and fixed addresses break the moment that happens.',
    tradeoff: 'Short TTLs and caches spot failures quickly but load the registry and risk flapping; long ones are cheap but keep routing to dead instances.',
    interview: 'Instances register in Consul or etcd (or Kubernetes endpoints) with health checks, clients watch for changes or cache for a short time, and they retry on another instance when one fails.',
  },
  quiz: [
    { q: 'An instance crashes. Why do some requests still reach it?', o: ['They do not', 'The registry waits out the TTL, and clients use their cached list until their next refresh', 'The instance restarts', 'DNS is broken'], a: 1,
      why: 'In the worst case it takes about TTL plus the client cache time; retrying on another instance hides most of those failures.' },
    { q: 'What does a shorter registry TTL cost?', o: ['Nothing', 'More frequent heartbeats, and more false removals during brief network blips', 'Less memory', 'Slower clients'], a: 1,
      why: 'Fast detection and stability pull against each other; beating every TTL ÷ 3 lets an instance miss one or two beats without being dropped.' },
    { q: 'Why might a brand-new instance stay idle right after it starts?', o: ['It is broken', 'Clients only hear about it at their next refresh of the cached list', 'The registry rejects it', 'It needs a reboot'], a: 1,
      why: 'Discovery is eventually consistent; push-style watches (Consul, Kubernetes endpoints) shrink the gap.' },
  ],
  guided: {
    intro: 'Crash one instance and time how long clients keep sending requests to it.',
    example: '“Run the guided example” starts over with a 9 s registry TTL and a 5 s client cache, then crashes an instance.',
    question: 'What happens to requests right after the crash?',
    predictions: ['Some keep going to the dead instance and fail until the registry and every client cache have caught up.', 'They all move to healthy instances at once, because the registry knows immediately.', 'Every request fails until the instance restarts.'],
    correctPrediction: 0,
    running: 'Watch the red lines to the crashed instance and the “Dead instance still used for” number. It settles once the last client refreshes after the registry removes it.',
    observation: 'The crashed instance stayed in the registry until its TTL ran out, and each client kept using it until its own cache refreshed.',
    explainQuestion: 'Why did the failures last so long?',
    explanations: ['Two delays stack up: the registry waits a full TTL without heartbeats, then each client keeps its old list until its cache time is up.', 'The load balancer was down.', 'Requests are retried forever on the same instance.'],
    correctExplanation: 0,
    why: 'Worst-case staleness is roughly TTL plus the cache time. Shorter values notice sooner at the cost of more registry traffic; client retries hide the rest.',
    retryHint: 'Look in the log for the moment the registry dropped the instance, then for each client refresh after it.',
    nextSlug: 'multi-region-failover',
    nextLabel: 'Next experiment: region failover →',
    waitSeconds: 20,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { ttl: 15, cache: 10 };
    const clock = fixedStep();
    const once = throttle();
    let st;

    kit.metrics([
      { key: 'fail', label: 'Requests failed' }, { key: 'clear', label: 'Dead instance still used for' },
      { key: 'new', label: 'New instance\'s first request after' }, { key: 'load', label: 'Registry calls per second' },
    ]);
    const p = kit.panel;
    const btns = p.buttons([
      { label: 'Crash an instance', kind: 'primary', onClick: crash },
      { label: 'Add an instance', kind: 'outline', onClick: add },
      { label: 'Start over', kind: 'outline', onClick: () => { reset(); kit.log('Started over with four healthy instances'); } },
    ]).buttons;
    const ttl = p.slider('Registry TTL', { min: 3, max: 30, step: 1, value: 15, format: v => `${v} s`, hint: 'Heartbeat every TTL ÷ 3; silent for longer than the TTL means removed',
      onInput: v => { s.ttl = v; st.D.ttl = v; } });
    const cache = p.slider('Clients cache the list for', { min: 1, max: 30, step: 1, value: 10, format: v => `${v} s`,
      onInput: v => { s.cache = v; st.D.cache = v; for (const cl of st.D.clients) cl.next = Math.min(cl.next, v); } });

    function reset() {
      st = { D: makeDiscovery({ ttl: s.ttl, cache: s.cache }), dead: null, clearT: null, born: null, firstT: null, inReg: false };
      clock.reset(); once.clear();
      kit.resetTime();
      kit.clearLog();
      paint();
    }
    function crash() {
      const D = st.D;
      if (D.inst.filter(x => x.up).length < 2) { kit.log('Keep at least one instance running'); return; }
      st.dead = D.kill(); st.clearT = null; st.inReg = true;
      if (st.dead) kit.log(`Instance ${st.dead.id} crashed. It stays in the registry until ${D.ttl} s pass without a heartbeat`);
      paint();
    }
    function add() {
      const D = st.D;
      if (D.inst.length >= MAX_INST) { kit.log(`At most ${MAX_INST} instances in this demo`); return; }
      st.born = D.add(); st.firstT = null;
      kit.log(`Instance ${st.born.id} started and registered. Clients will only see it at their next refresh`);
      paint();
    }

    function step(dt) {
      const D = st.D;
      D.tick(dt);
      for (const e of D.events.splice(0)) {
        if (st.dead && e.dropped.includes(st.dead.id)) kit.log(`Client ${e.client} refreshed its list and dropped instance ${st.dead.id}`);
        if (st.born && e.added.includes(st.born.id)) kit.log(`Client ${e.client} refreshed and now knows instance ${st.born.id}`);
      }
      if (st.dead && st.inReg && !D.registry().includes(st.dead.id)) {
        st.inReg = false;
        kit.log(`Registry removed instance ${st.dead.id}: no heartbeat for ${D.ttl} s. Clients with an old copy still use it`);
      }
      if (st.dead && st.clearT == null && D.cleared(st.dead)) {
        st.clearT = D.now - st.dead.diedAt;
        kit.log(`Nobody routes to instance ${st.dead.id} any more, ${st.clearT.toFixed(1)} s after it crashed`);
        kit.guided.observe(`Instance ${st.dead.id} kept receiving requests for ${st.clearT.toFixed(1)} s: first the registry waited out its ${D.ttl} s TTL, then each client waited for its next cache refresh.`);
      }
      if (st.born && st.firstT == null && D.served[st.born.id]) {
        st.firstT = D.now - st.born.born;
        kit.log(`Instance ${st.born.id} served its first request ${st.firstT.toFixed(1)} s after it started`);
      }
      const last = D.recent[0];
      if (last && !last.ok && last.t === D.now && once.ok('fail', 3, kit.time)) kit.log(`A client still sent a request to crashed instance ${last.id}; it failed`);
    }

    function paint() {
      const D = st.D, tot = D.ok + D.failed;
      kit.metric('fail', tot ? `${D.failed} (${pct(D.failed / tot)})` : '–', D.failed ? 'bad' : 'good');
      kit.metric('clear', st.dead ? (st.clearT != null ? st.clearT.toFixed(1) + ' s' : 'still used…') : '–', st.dead ? (st.clearT != null && st.clearT < 6 ? 'good' : 'bad') : '');
      kit.metric('new', st.born ? (st.firstT != null ? st.firstT.toFixed(1) + ' s' : 'waiting…') : '–', st.born ? 'warn' : '');
      kit.metric('load', ((D.inst.filter(x => x.up).length * 3) / D.ttl + D.clients.length / D.cache).toFixed(1));
      btns[0].disabled = D.inst.filter(x => x.up).length < 2;
      btns[1].disabled = D.inst.length >= MAX_INST;
    }

    function draw() {
      stage.clear();
      const c = stage.colors, w = stage.w, h = stage.h, D = st.D;
      const narrow = w < 520;
      const reg = D.registry();
      const n = D.inst.length;
      const iw = Math.min(110, (w - 28 - (n - 1) * 8) / n);
      const iy = narrow ? 12 : 20, ih = narrow ? 40 : 52;
      const ix = i => (w - (n * iw + (n - 1) * 8)) / 2 + i * (iw + 8);
      const rw = narrow ? 160 : 220, rh = narrow ? 36 : 44;
      const rx = w / 2 - rw / 2;
      const ry = iy + ih + (narrow ? 14 : 30);
      const cn = D.clients.length;
      const cw = Math.min(150, (w - 28 - (cn - 1) * 12) / cn);
      const cy = narrow ? Math.max(ry + rh + 24, h - 50) : h - 64;
      const ch = narrow ? 44 : 54;
      const cx = i => (w - (cn * cw + (cn - 1) * 12)) / 2 + i * (cw + 12);
      const centre = {};
      D.inst.forEach((x, i) => { centre[x.id] = ix(i) + iw / 2; });

      for (const r of D.recent) {
        if (D.now - r.t >= 0.35) continue;
        const fx = cx(r.cl % cn) + cw / 2, tx = centre[r.id];
        if (tx == null) continue;
        stage.line(fx, cy, tx, iy + ih, { color: r.ok ? c.ok : c.bad, width: r.ok ? 1.2 : 2, alpha: 0.5 * (1 - (D.now - r.t) / 0.35) });
      }
      D.inst.forEach((x, i) => {
        const bx = ix(i);
        tile(stage, bx, iy, iw, ih, { fill: x.up ? c.surface : c.bad, fillAlpha: x.up ? 1 : 0.2, stroke: x.up ? c.ok : c.bad, width: 1.4, r: 8 });
        fitText(stage, `instance ${x.id}`, bx + iw / 2, iy + 6, iw - 6, { size: 11, weight: 700, color: c.ink, align: 'center', baseline: 'top' });
        fitText(stage, x.up ? `${D.served[x.id] || 0} served` : 'crashed', bx + iw / 2, iy + 21, iw - 6, { size: 9, color: x.up ? c.muted : c.bad, align: 'center', baseline: 'top' });
        const age = Math.min(1, (D.now - x.beat) / D.ttl);
        const by = iy + ih - (narrow ? 6 : 12), bh = narrow ? 3 : 5;
        tile(stage, bx + 8, by, iw - 16, bh, { fill: c.bg2, r: 1 });
        tile(stage, bx + 8, by, (iw - 16) * (1 - age), bh, { fill: age > 0.66 ? c.bad : c.wire, r: 1 });
        if (x.up && D.now - x.beat < 0.3) stage.line(bx + iw / 2, iy + ih, rx + rw / 2, ry, { color: c.wire, alpha: 1 - (D.now - x.beat) / 0.3 });
        if (!reg.includes(x.id) && !x.up) stage.text('removed', bx + iw / 2, iy + ih + 3, { size: 8, color: c.muted, align: 'center', baseline: 'top' });
      });
      tile(stage, rx, ry, rw, rh, { fill: c.bg2, stroke: c.wire, width: 1.5, r: 8 });
      stage.text('registry', rx + rw / 2, ry + 5, { size: 11, weight: 700, color: c.ink, align: 'center', baseline: 'top' });
      fitText(stage, `alive: ${reg.join(', ') || 'none'}`, rx + rw / 2, ry + 21, rw - 8, { size: 10, weight: 600, color: c.muted, align: 'center', baseline: 'top' });
      if (!narrow) stage.text('bar under each instance = time since its last heartbeat', 14, ry + rh + 8, { size: 9, color: c.muted, baseline: 'top' });

      D.clients.forEach((cl, i) => {
        const bx = cx(i);
        const stale = cl.list.some(id => { const x = D.inst.find(k => k.id === id); return !x || !x.up; }) || reg.some(id => !cl.list.includes(id));
        tile(stage, bx, cy, cw, ch, { fill: c.surface, stroke: stale ? c.signal : c.line, width: 1.3, r: 8 });
        stage.text(`client ${i + 1}`, bx + cw / 2, cy + 5, { size: 10, weight: 700, color: c.ink, align: 'center', baseline: 'top' });
        fitText(stage, `cached: ${cl.list.join(', ')}`, bx + cw / 2, cy + 19, cw - 8, { size: 9, color: stale ? c.signal : c.muted, align: 'center', baseline: 'top' });
        const k = Math.max(0, cl.next / D.cache);
        tile(stage, bx + 8, cy + ch - 11, cw - 16, 4, { fill: c.bg2, r: 1 });
        tile(stage, bx + 8, cy + ch - 11, (cw - 16) * Math.min(1, k), 4, { fill: c.muted, r: 1 });
      });
      fitText(stage, narrow ? 'orange = stale cache' : 'orange client = its cached list is out of date · bar = time to next refresh', 14, cy - 4, w - 28, { size: 9, color: c.muted, baseline: 'bottom' });
    }

    kit.loop(dt => { clock.run(dt, step); paint(); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        ttl.set(9, true); s.ttl = 9;
        cache.set(5, true); s.cache = 5;
        reset();
        unpause();
        setTimeout(crash, 1000);
      },
    };
  },
};
