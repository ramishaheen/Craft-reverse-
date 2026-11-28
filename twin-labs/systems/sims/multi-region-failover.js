// Multi-region failover: three regions, one primary database, users routed by DNS.
// Model: 20 requests per second. Health checks run every `check` seconds; 3 failed checks in a row
// declare the primary region dead. Promoting a replica then takes 3 s. After that, users move to the
// new primary only as their cached DNS answer expires: the share that has moved grows linearly over
// one TTL. Requests that still reach the dead region fail. With async replication each write reaches
// the replicas 1 s later; writes still in that window when the primary dies are lost (RPO). Sync
// replication loses nothing but adds a 70 ms cross-region round trip to every write (30 → 100 ms).

import { fixedStep, failMark, tile, fitText, unpause } from './_c-util.js';

const REGIONS = ['Mumbai', 'Singapore', 'Frankfurt'];
const CROSS_MS = 70;
const MISSES = 3;
const PROMOTE_S = 3;
const RATE = 20;
const LAG_S = 1;

function makeFailover({ interval = 5, ttl = 60, mode = 'async' } = {}) {
  const F = {
    interval, misses: MISSES, promote: PROMOTE_S, ttl, mode, lag: LAG_S, rate: RATE,
    now: 0, acc: 0, nextCheck: interval, fails: 0, primary: 0, old: 0, up: [true, true, true],
    phase: 'ok', tFail: null, tDetect: null, tPromote: null, tDone: null, pending: [],
    ok: 0, failed: 0, lost: 0, hist: [], sec: { ok: 0, fail: 0, t: 0 }, events: [],
  };
  F.moved = () => F.phase === 'dns' ? Math.min(1, (F.now - F.tPromote) / Math.max(0.001, F.ttl)) : F.phase === 'ok' ? 1 : 0;
  F.writeMs = () => 30 + (F.mode === 'sync' ? CROSS_MS : 0);
  F.candidate = () => F.up.findIndex((u, i) => u && i !== F.old);
  F.fail = () => {
    if (F.phase !== 'ok' || !F.up[F.primary]) return false;
    F.up[F.primary] = false; F.old = F.primary; F.phase = 'down'; F.tFail = F.now;
    F.tDetect = F.tPromote = F.tDone = null; F.fails = 0;
    return true;
  };
  F.recover = () => { F.up = F.up.map(() => true); };
  F.outage = () => (F.tFail == null ? 0 : (F.tDone ?? F.now) - F.tFail);
  function request() {
    const target = F.phase === 'ok' || Math.random() < F.moved() ? F.primary : F.old;
    if (F.up[target] && target === F.primary) {
      F.ok++; F.sec.ok++;
      if (F.mode === 'async') F.pending.push(F.now + F.lag);
      return true;
    }
    F.failed++; F.sec.fail++;
    return false;
  }
  F.tick = dt => {
    F.now += dt;
    if (F.up[F.primary]) F.pending = F.pending.filter(t => t > F.now);
    if (F.now >= F.nextCheck) {
      F.nextCheck += F.interval;
      F.fails = F.up[F.primary] ? 0 : F.fails + 1;
      if (F.phase === 'down') F.events.push({ k: 'check', n: F.fails });
      if (F.phase === 'down' && F.fails >= F.misses) { F.phase = 'promoting'; F.tDetect = F.now; F.events.push({ k: 'detect' }); }
    }
    if (F.phase === 'promoting' && F.now >= F.tDetect + F.promote) {
      const p = F.candidate();
      if (p >= 0) {
        const lost = F.pending.length;
        F.lost += lost; F.pending = []; F.primary = p; F.phase = 'dns'; F.tPromote = F.now;
        F.events.push({ k: 'promote', lost });
      }
    }
    if (F.phase === 'dns' && F.moved() >= 1) { F.phase = 'ok'; F.tDone = F.now; F.events.push({ k: 'done' }); }
    F.acc += F.rate * dt;
    const out = [];
    while (F.acc >= 1) { F.acc -= 1; out.push(request()); }
    if (F.now - F.sec.t >= 1) {
      F.hist.push({ t: F.sec.t, ok: F.sec.ok, fail: F.sec.fail });
      if (F.hist.length > 120) F.hist.shift();
      F.sec = { ok: 0, fail: 0, t: F.now };
    }
    return out;
  };
  return F;
}

export default {
  lead: 'The app runs in three regions, yet only Mumbai holds the primary database. Switch Mumbai off and keep an eye on the clock: health checks have to fail several times before anyone reacts, a replica gets promoted, and users drift over only as their cached DNS answer expires. Writes that had not been copied to a replica yet are simply gone.',
  emptyLog: 'Nothing yet. Fail the primary region to time a failover.',
  stageHeight: 460,
  tryThis: [
    'Press <b>Fail the primary region</b> with the defaults. Count the phases: detection, promotion, then the long DNS tail.',
    'Set the DNS TTL to 5 s and checks to every 1 s, then fail it again. The outage drops from more than a minute to a few seconds.',
    'Choose <b>Sync</b> replication and fail it. Nothing is lost, but every write now pays for a cross-region round trip.',
  ],
  inShort: {
    what: 'Multi-region failover moves both the traffic and the primary database to another region when an entire region fails.',
    why: 'Whole regions do go down (power, networking, a bad deploy), and a single region cannot promise high availability on its own.',
    tradeoff: 'Async replication drops the latest writes (RPO above zero) while sync adds a cross-region round trip; quick checks and low DNS TTLs cut downtime (RTO) but raise the risk of false failovers.',
    interview: 'Active-passive, health checks with a quorum to avoid split brain, automatic replica promotion, low-TTL DNS or a global load balancer, and RTO and RPO targets that decide between async and sync.',
  },
  quiz: [
    { q: 'Why can a region failover take minutes even when the replicas are healthy?', o: ['Replicas are slow', 'Several health checks must fail before anyone reacts, and users hold the old address until their DNS cache expires', 'Databases cannot be promoted', 'The internet is down'], a: 1,
      why: 'RTO is detection plus promotion plus the DNS tail; short check intervals and low TTLs (or anycast and global load balancers) shrink it.' },
    { q: 'With async replication, what is lost when the primary region dies?', o: ['Nothing', 'Writes already confirmed to users but not yet copied to a replica', 'All data', 'Only reads'], a: 1,
      why: 'That gap is the RPO. Sync replication brings it to zero, at the price of a cross-region round trip on every write.' },
    { q: 'What does a lower DNS TTL buy?', o: ['Cheaper DNS', 'Users reach the new region sooner, in exchange for more DNS lookups', 'More replicas', 'Stronger consistency'], a: 1,
      why: 'Clients ask DNS again more often, so after a failover their cached answer pointing at the dead region runs out quickly.' },
  ],
  guided: {
    intro: 'Switch off the primary region and see how long it takes before a replica takes over, and what that costs.',
    example: '“Run the guided example” starts over with async replication, health checks every 2 s and a 20 s DNS TTL, then fails Mumbai.',
    question: 'What happens between the failure and the promotion of a replica?',
    predictions: ['Requests fail for several seconds, and the last few async writes are lost when the replica is promoted.', 'Traffic moves to Singapore instantly with no failures.', 'Nothing fails, because the replicas already have every write.'],
    correctPrediction: 0,
    running: 'Watch the timeline under the regions: red while nobody knows, amber while a replica is promoted, then green while DNS caches expire.',
    observation: 'Health checks needed three misses before the region was declared dead, promotion took a few more seconds, and writes not yet copied to a replica were lost.',
    explainQuestion: 'Why were requests failing and writes lost?',
    explanations: ['Detection waits for several failed checks, so requests keep going to the dead region; async writes still on their way to a replica vanish with it.', 'The replica was too small to take the traffic.', 'DNS deleted the writes.'],
    correctExplanation: 0,
    why: 'RTO is detection + promotion + the DNS tail, and RPO is whatever async replication had not shipped yet. Faster checks, low TTLs and sync replication shrink them at a cost.',
    retryHint: 'Read the “Writes lost (RPO)” number and the red part of the timeline.',
    nextSlug: 'ci-cd-pipeline',
    nextLabel: 'Next experiment: CI/CD pipeline →',
    waitSeconds: 16,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { check: 5, ttl: 60, mode: 'async' };
    const clock = fixedStep();
    let st;

    kit.metrics([
      { key: 'out', label: 'Outage (RTO)' }, { key: 'failed', label: 'Requests failed' },
      { key: 'lost', label: 'Writes lost (RPO)' }, { key: 'ms', label: 'Time per write' },
    ]);
    const p = kit.panel;
    const btns = p.buttons([
      { label: 'Fail the primary region', kind: 'primary', onClick: fail },
      { label: 'Bring regions back', kind: 'outline', onClick: recover },
      { label: 'Start over', kind: 'outline', onClick: () => { reset(); kit.log('Started over: Mumbai is primary again'); } },
    ]).buttons;
    const mode = p.seg('Replication to other regions', { options: [['async', 'Async'], ['sync', 'Sync']], value: 'async',
      onChange: v => { s.mode = v; st.F.mode = v; if (v === 'sync') st.F.pending = []; kit.log(v === 'sync' ? 'Sync replication: a write is confirmed only once a replica has it (+70 ms)' : 'Async replication: writes are confirmed first and copied about 1 s later'); } });
    const check = p.slider('Health check every', { min: 1, max: 10, step: 1, value: 5, format: v => `${v} s`, hint: '3 failed checks in a row and the region is declared dead',
      onInput: v => { s.check = v; st.F.interval = v; st.F.nextCheck = Math.min(st.F.nextCheck, st.F.now + v); } });
    const ttl = p.slider('DNS TTL', { min: 5, max: 300, step: 5, value: 60, format: v => `${v} s`, hint: 'How long users keep the old address in their cache',
      onInput: v => { s.ttl = v; st.F.ttl = v; } });

    function reset() {
      st = { F: makeFailover({ interval: s.check, ttl: s.ttl, mode: s.mode }), dots: [], reps: [] };
      clock.reset();
      kit.resetTime();
      kit.clearLog();
      paint();
    }
    function fail() {
      const F = st.F;
      if (F.fail()) kit.log(`${REGIONS[F.old]} went dark. Its database was the primary, so every write now fails`);
      paint();
    }
    function recover() {
      st.F.recover();
      kit.log('All regions are back. The old primary rejoins as a replica');
      paint();
    }

    function step(dt) {
      const F = st.F;
      F.tick(dt).forEach(ok => {
        if (Math.random() < 0.25) st.dots.push({ to: ok ? F.primary : F.old, ok, t: 0, x: 0.15 + Math.random() * 0.7 });
      });
      if (F.mode === 'async' && F.up[F.primary] && Math.random() < dt * 4)
        F.up.forEach((u, i) => { if (i !== F.primary && u) st.reps.push({ from: F.primary, to: i, t: 0 }); });
      for (const d of st.dots) d.t += dt * 1.6;
      for (const r of st.reps) r.t += dt / Math.max(0.3, F.lag);
      st.dots = st.dots.filter(d => d.t < 1.4);
      st.reps = st.reps.filter(r => r.t < 1 && F.up[r.from]);
      for (const e of F.events.splice(0)) {
        if (e.k === 'check' && e.n < F.misses) kit.log(`Health check ${e.n} of ${F.misses} failed for ${REGIONS[F.old]}; not declared dead yet`);
        else if (e.k === 'detect') kit.log(`${REGIONS[F.old]} declared dead after ${(F.tDetect - F.tFail).toFixed(0)} s. Promoting ${REGIONS[F.candidate()] ?? 'a replica'}`);
        else if (e.k === 'promote') {
          kit.log(`${REGIONS[F.primary]} promoted to primary. ${e.lost ? `${e.lost} async writes never reached it and are lost` : 'No writes were lost'}. Users move as DNS caches expire`);
          kit.guided.observe(`${REGIONS[F.old]} was declared dead only after ${F.misses} failed checks (${(F.tDetect - F.tFail).toFixed(0)} s), promotion took ${F.promote} s more, and ${e.lost} async writes that had not reached a replica were lost. Users still follow their DNS cache for up to ${F.ttl} s.`);
        } else if (e.k === 'done') kit.log(`Failover complete after ${(F.tDone - F.tFail).toFixed(0)} s: every user now reaches ${REGIONS[F.primary]}`);
      }
    }

    function paint() {
      const F = st.F;
      kit.metric('out', F.tFail == null ? '–' : F.outage().toFixed(0) + ' s' + (F.tDone == null ? '…' : ''), F.tFail == null ? '' : F.outage() > 20 ? 'bad' : 'warn');
      kit.metric('failed', String(F.failed), F.failed ? 'bad' : 'good');
      kit.metric('lost', String(F.lost), F.lost ? 'bad' : 'good');
      kit.metric('ms', F.writeMs() + ' ms', F.mode === 'sync' ? 'warn' : 'good');
      btns[0].disabled = F.phase !== 'ok' || F.up.filter(Boolean).length < 2;
      btns[1].disabled = F.up.every(Boolean);
    }

    function draw() {
      stage.clear();
      const c = stage.colors, w = stage.w, h = stage.h, F = st.F;
      const narrow = w < 520;
      const uy = 22, ry = h * 0.3, rh = narrow ? 50 : 56, gap = narrow ? 8 : 16;
      const rw = (w - 28 - 2 * gap) / 3;
      const rx = i => 14 + i * (rw + gap);
      const mid = i => rx(i) + rw / 2;
      const moved = F.moved();
      fitText(stage, F.phase === 'ok' ? `users → ${REGIONS[F.primary]}` : `users: ${Math.round(moved * 100)}% now go to ${F.phase === 'dns' ? REGIONS[F.primary] : 'the new primary'}`,
        w / 2, uy - 10, w - 28, { size: 10, color: c.muted, align: 'center' });
      for (let i = 0; i < 14; i++) stage.dot(w * (0.15 + 0.7 * i / 13), uy + 4, 3, c.muted, 0.7);
      for (const d of st.dots) {
        const a = { x: w * d.x, y: uy + 8 }, b = { x: mid(d.to) + (d.x - 0.5) * rw * 0.5, y: ry };
        const k = Math.min(1, d.t);
        const pt = { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k };
        if (d.ok) stage.dot(pt.x, pt.y, 2.4, c.ok, Math.max(0, 1 - Math.max(0, d.t - 1) * 2.5));
        else if (d.t < 1) stage.dot(pt.x, pt.y, 2.4, c.bad, 0.9);
        else failMark(stage, b, (d.t - 1) / 0.4, c.bad);
      }
      for (const r of st.reps) {
        const a = { x: mid(r.from), y: ry + rh }, b = { x: mid(r.to), y: ry + rh };
        const cx = (a.x + b.x) / 2, cy = ry + rh + 28, u = 1 - r.t;
        stage.dot(u * u * a.x + 2 * u * r.t * cx + r.t * r.t * b.x, u * u * a.y + 2 * u * r.t * cy + r.t * r.t * b.y, 2.2, c.signal, 0.9);
      }
      REGIONS.forEach((name, i) => {
        const up = F.up[i], prim = i === F.primary && up;
        tile(stage, rx(i), ry, rw, rh, { fill: up ? (prim ? c.ok : c.surface) : c.bad, fillAlpha: up && !prim ? 1 : 0.18, stroke: up ? (prim ? c.ok : c.line) : c.bad, width: prim || !up ? 2 : 1, r: 8 });
        fitText(stage, name, rx(i) + rw / 2, ry + rh * 0.36, rw - 6, { size: narrow ? 11 : 12, weight: 700, color: c.ink, align: 'center' });
        const sub = !up ? 'DOWN' : prim ? (narrow ? 'primary' : 'primary DB · writes') : i === F.old && F.phase !== 'ok' ? '' : F.phase === 'promoting' && i === F.candidate() ? 'promoting…' : 'replica';
        fitText(stage, sub, rx(i) + rw / 2, ry + rh * 0.7, rw - 6, { size: narrow ? 9 : 10, color: up ? (prim ? c.ok : c.muted) : c.bad, align: 'center' });
      });
      fitText(stage, F.mode === 'async' ? `async copies (${F.pending.length} writes not on a replica yet)` : 'sync: a write is confirmed only after a replica has it',
        14, ry + rh + 32, w - 28, { size: 9, color: F.mode === 'async' ? c.signal : c.muted, baseline: 'top' });

      const ty = ry + rh + 66, x0 = 14, x1 = w - 14;
      if (F.tFail != null) {
        const end = Math.max(F.now, F.tDone ?? F.now), span = Math.max(10, end - F.tFail);
        const X = t => x0 + (x1 - x0) * (t - F.tFail) / span;
        const seg = (a, b, col, label) => {
          if (a == null) return;
          const e = b ?? F.now;
          tile(stage, X(a), ty, Math.max(1, X(e) - X(a)), 10, { fill: col, fillAlpha: 0.75, r: 2 });
          if (X(e) - X(a) > 40) fitText(stage, `${label} ${(e - a).toFixed(0)} s`, (X(a) + X(e)) / 2, ty + 13, X(e) - X(a), { size: 9, color: c.ink, align: 'center', baseline: 'top' });
        };
        seg(F.tFail, F.tDetect, c.bad, narrow ? 'unnoticed' : 'nobody knows');
        seg(F.tDetect, F.tPromote, c.signal, 'promote');
        seg(F.tPromote, F.tDone, c.ok, narrow ? 'DNS' : 'DNS caches expire');
        stage.text(F.tDone != null ? `failover took ${(F.tDone - F.tFail).toFixed(0)} s` : 'failover in progress…', x0, ty - 3, { size: 9, color: c.muted, baseline: 'bottom' });
      } else stage.text('Fail the primary region to time a failover.', x0, ty, { size: 10, color: c.muted, baseline: 'top' });

      const hy = ty + 44, hb = h - 8;
      if (hb - hy < 24) return;
      const hist = F.hist.slice(-60), bw = (x1 - x0) / 60, max = Math.max(1, F.rate * 1.1);
      stage.text('requests per second: ok / failed', x1, hy - 12, { size: 9, color: c.muted, align: 'right', baseline: 'top' });
      hist.forEach((b, i) => {
        const x = x0 + i * bw, ok = (hb - hy) * b.ok / max, bad = (hb - hy) * b.fail / max;
        tile(stage, x, hb - ok, bw - 1, ok, { fill: c.ok, fillAlpha: 0.7, r: 0 });
        tile(stage, x, hb - ok - bad, bw - 1, bad, { fill: c.bad, fillAlpha: 0.7, r: 0 });
      });
    }

    kit.loop(dt => { clock.run(dt, step); paint(); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        mode.set('async', true); s.mode = 'async';
        check.set(2, true); s.check = 2;
        ttl.set(20, true); s.ttl = 20;
        reset();
        unpause();
        setTimeout(fail, 700);
      },
    };
  },
};
