// Distributed lock: three workers share one lease lock and write to shared storage.
// Model: an idle worker asks for the lock (0.35 s trip). The lock grants a lease of `ttl` seconds with a
// token that grows by one on every grant. The holder works for 0.9 s, then sends its write (0.35 s).
// With probability `chance` a holder freezes `pause` seconds part-way through its work (a long GC
// pause) and, when it wakes, carries on as if it still held the lock. Storage remembers the highest
// token it has accepted: a write with a lower token is refused when fencing is on, and silently lands
// on top of newer data when it is off. A worker refused the lock retries after 0.4–0.8 s.

import { fixedStep, along, glow, burst, tile, fitText, box, clamp, throttle, unpause } from './_c-util.js';

const WORK = 0.9;
const HOP = 0.35;
const NAMES = ['A', 'B', 'C'];

function makeLock(ttl) {
  const l = { ttl, holder: null, token: 0, expires: 0 };
  l.free = now => !l.holder || now >= l.expires;
  l.acquire = (who, now) => {
    if (!l.free(now)) return null;
    l.token++; l.holder = who; l.expires = now + l.ttl;
    return l.token;
  };
  l.release = (who, token) => { if (l.holder === who && l.token === token) { l.holder = null; return true; } return false; };
  l.valid = (who, token, now) => l.holder === who && l.token === token && now < l.expires;
  return l;
}
function makeStore(fencing) {
  const s = { fencing, maxToken: 0, writes: [] };
  s.write = (who, token) => {
    if (token < s.maxToken) {
      const res = s.fencing ? 'rejected' : 'unsafe';
      s.writes.push({ who, token, res });
      return res;
    }
    s.maxToken = token;
    s.writes.push({ who, token, res: 'ok' });
    return 'ok';
  };
  s.count = res => s.writes.filter(x => x.res === res).length;
  return s;
}

export default {
  lead: 'Three workers take turns through one lock so only one writes at a time. The lock is a lease that runs out by itself, which saves you from a crashed holder. The danger is a worker that stalls instead, say in a long garbage-collection pause, and wakes after its lease is gone, still convinced the lock is its own.',
  emptyLog: 'Nothing yet. The workers are starting to ask for the lock.',
  tryThis: [
    'With fencing <b>Off</b>, look for a frozen worker (red outline) that wakes up after its lease has run out. Its write lands on top of the new holder\'s work and shows as a red row.',
    'Switch fencing <b>On</b>. That late write carries an old token, so storage refuses it.',
    'Make the lease longer than the pause. The stale writes stop, but a crashed worker would now block everyone longer. No lease length is safe in every case; fencing is.',
  ],
  inShort: {
    what: 'A distributed lock lets only one of many machines do a thing at a time, usually as a lease that expires after a fixed time.',
    why: 'Two workers running the same job or updating the same record together can corrupt data or charge a customer twice.',
    tradeoff: 'Too short a lease runs out under a slow holder; too long and a crashed holder stalls everyone. Neither setting is safe by itself.',
    interview: 'I would take a lease lock that hands out a fencing token, and have the storage reject any write whose token is older than the newest it has accepted.',
  },
  quiz: [
    { q: 'Why does a distributed lock normally come with a lease (an expiry)?', o: ['To make it faster', 'So a holder that crashes cannot keep the lock forever', 'To encrypt the data', 'Because Redis insists on it'], a: 1,
      why: 'With no expiry, a holder that dies never lets go, and every other worker waits for ever.' },
    { q: 'A worker holding a 2 s lease freezes for 5 s. What can go wrong?', o: ['Nothing: the lock waits for it', 'The lease runs out, another worker gets the lock, and both end up writing', 'The worker is granted a new lease automatically', 'Storage deletes the data'], a: 1,
      why: 'The frozen worker has no idea its lease ended. When it wakes it writes as though it still held the lock.' },
    { q: 'How does a fencing token block the late write?', o: ['It extends the lease', 'Storage turns away any write whose token is lower than one it has already accepted', 'It kills the frozen worker', 'It slows the other workers down'], a: 1,
      why: 'Every grant gets a bigger token. The new holder writes with the bigger token first, so the old holder\'s write is refused.' },
  ],
  guided: {
    intro: 'Let workers freeze longer than their lease, with no fencing, and see what reaches storage.',
    example: '“Run the guided example” turns fencing off, sets a 2 s lease, 3 s pauses and a 60% chance that a holder pauses, then starts over.',
    question: 'What happens when a frozen worker wakes up after its lease ran out?',
    predictions: ['Its write overwrites newer data from the next holder.', 'The lock stops it, so its write never reaches storage.', 'It waits for a new lease before writing.'],
    correctPrediction: 0,
    running: 'Watch for a worker labelled “lease gone!” and the list of writes under the diagram. A red row is an old write saved over newer data.',
    observation: 'A worker woke after its lease expired and wrote with an old token; storage had already accepted a newer one, and with fencing off it saved the stale write anyway.',
    explainQuestion: 'Why did the stale write get through?',
    explanations: ['Nothing checks the lease at storage: without fencing tokens, any write is accepted, even from a holder whose lease has expired.', 'The lock forgot to expire the lease.', 'Two workers were given the same token.'],
    correctExplanation: 0,
    why: 'A lease only protects the lock, not the data. The storage itself must refuse writes with older tokens, which is what fencing adds.',
    retryHint: 'Compare the token on the red row with the token on the row just below it.',
    nextSlug: 'service-discovery',
    nextLabel: 'Next experiment: service discovery →',
    waitSeconds: 20,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { fencing: false, ttl: 2, pause: 3, chance: 0.3 };
    const clock = fixedStep();
    const once = throttle();
    let st;

    kit.metrics([
      { key: 'ok', label: 'Safe writes' }, { key: 'bad', label: 'Old writes over newer data' },
      { key: 'rej', label: 'Stale writes refused' }, { key: 'wait', label: 'Times a worker waited' },
    ]);
    const p = kit.panel;
    const fence = p.seg('Fencing tokens', { options: [['off', 'Off'], ['on', 'On']], value: 'off', hint: 'On: storage turns away a write whose token is older than one it has seen',
      onChange: v => { s.fencing = v === 'on'; reset(); kit.log(s.fencing ? 'Fencing on: storage now compares tokens' : 'Fencing off: storage accepts every write'); } });
    const ttl = p.slider('Lease length', { min: 1, max: 6, step: 0.5, value: 2, format: v => `${v} s`, onInput: v => { s.ttl = v; } });
    const pause = p.slider('Pause length', { min: 0, max: 6, step: 0.5, value: 3, format: v => `${v} s`, onInput: v => { s.pause = v; } });
    const chance = p.slider('Chance a worker pauses', { min: 0, max: 60, step: 5, value: 30, format: v => `${v}%`, onInput: v => { s.chance = v / 100; } });
    p.buttons([{ label: 'Start over', kind: 'outline', onClick: () => { reset(); kit.log('Started over: lock free, storage empty'); } }]);

    function reset() {
      st = {
        t: 0, lock: makeLock(s.ttl), store: makeStore(s.fencing), waits: 0, fx: [],
        workers: NAMES.map((n, i) => ({ n, state: 'idle', t: 0, wait: 0.3 + i * 0.45, token: 0, pauseLeft: 0, warned: false })),
      };
      clock.reset(); once.clear();
      kit.resetTime();
      kit.clearLog();
      paint();
    }

    function step(dt) {
      st.t += dt;
      const L = st.lock, now = st.t;
      L.ttl = s.ttl;
      for (const w of st.workers) {
        w.t += dt;
        if (w.state === 'idle' && w.t >= w.wait) { w.state = 'ask'; w.t = 0; st.fx.push({ k: 'ask', w: w.n, t: 0 }); }
        else if (w.state === 'ask' && w.t >= HOP) {
          const tok = L.acquire(w.n, now);
          if (tok) { w.state = 'work'; w.t = 0; w.token = tok; w.warned = false; w.pauseLeft = Math.random() < s.chance ? s.pause : 0; }
          else { st.waits++; w.state = 'idle'; w.t = 0; w.wait = 0.4 + Math.random() * 0.4; }
        } else if (w.state === 'work') {
          if (w.pauseLeft > 0 && w.t >= WORK * 0.4) {
            w.state = 'frozen'; w.t = 0;
            if (once.ok('freeze' + w.n, 2, now)) kit.log(`Worker ${w.n} froze for ${w.pauseLeft} s while holding token #${w.token} (lease ${s.ttl} s)`);
          } else if (w.t >= WORK) { w.state = 'write'; w.t = 0; st.fx.push({ k: 'write', w: w.n, t: 0 }); }
        } else if (w.state === 'frozen' && w.t >= w.pauseLeft) {
          w.pauseLeft = 0; w.state = 'work'; w.t = WORK * 0.4;
          if (!L.valid(w.n, w.token, now)) kit.log(`Worker ${w.n} woke up; its lease ended while it slept, but it does not know that`);
        } else if (w.state === 'write' && w.t >= HOP) {
          const res = st.store.write(w.n, w.token);
          st.fx.push({ k: res, w: w.n, t: 0 });
          if (res === 'unsafe') {
            kit.log(`Worker ${w.n} saved with old token #${w.token} over data written with #${st.store.maxToken}: corruption`);
            kit.guided.observe(`Worker ${w.n} woke after its lease ended and wrote with token #${w.token}, although storage had already accepted #${st.store.maxToken}. With fencing off, the stale write was saved over the newer data.`);
          } else if (res === 'rejected') kit.log(`Storage refused worker ${w.n}: token #${w.token} is older than #${st.store.maxToken}`);
          L.release(w.n, w.token);
          w.state = 'idle'; w.t = 0; w.wait = 0.5 + Math.random() * 0.8;
        }
      }
      st.fx = st.fx.filter(f => (f.t += dt) < HOP + 0.4);
    }

    function paint() {
      const S = st.store;
      kit.metric('ok', String(S.count('ok')));
      const bad = S.count('unsafe');
      kit.metric('bad', String(bad), bad ? 'bad' : 'good');
      const rej = S.count('rejected');
      kit.metric('rej', String(rej), rej ? 'warn' : '');
      kit.metric('wait', String(st.waits));
    }

    function draw() {
      stage.clear();
      const c = stage.colors, w = stage.w, h = stage.h, ctx = stage.ctx, now = st.t;
      const narrow = w < 520;
      const bw = clamp(w * 0.2, 64, 110);
      const wh = narrow ? 34 : 40;
      const top = Math.max(wh / 2 + 6, h * 0.1);
      const gap = Math.max(wh + 6, Math.min(62, h * 0.62 / 3));
      const lock = { x: w / 2, y: top + gap, w: bw + (narrow ? 6 : 20), h: 54 };
      const store = { x: w - Math.max(w * 0.1, bw / 2 + 8), y: top + gap, w: bw, h: 46 };
      const rows = st.workers.map((wk, i) => ({ wk, x: Math.max(w * 0.1, bw / 2 + 8), y: top + i * gap, w: bw, h: wh }));
      const L = st.lock;
      for (const r of rows) { stage.line(r.x, r.y, lock.x, lock.y, { color: c.wire, alpha: 0.25, width: 1.2 }); stage.line(r.x, r.y, store.x, store.y, { color: c.wire, alpha: 0.25, width: 1.2 }); }
      for (const f of st.fx) {
        const r = rows.find(x => x.wk.n === f.w);
        if (!r) continue;
        const k = clamp(f.t / HOP, 0, 1);
        if (f.k === 'ask') glow(stage, along([r, lock], k), 4, c.wire);
        else if (f.k === 'write') glow(stage, along([r, store], k), 4.5, c.signal);
        else if (f.t < 0.4) burst(stage, store, f.t / 0.4, f.k === 'ok' ? c.ok : f.k === 'unsafe' ? c.bad : c.muted);
      }
      for (const r of rows) {
        const state = r.wk.state;
        const holds = L.holder === r.wk.n && now < L.expires;
        const lost = (state === 'work' || state === 'frozen' || state === 'write') && !L.valid(r.wk.n, r.wk.token, now);
        const label = state === 'frozen' ? 'frozen…' : state === 'work' ? (lost ? 'lease gone!' : 'working') : state === 'write' ? 'writing' : state === 'ask' ? 'asking' : 'idle';
        box(stage, r, 'Worker ' + r.wk.n, label, { stroke: state === 'frozen' ? c.bad : holds ? c.ok : lost ? c.bad : c.wire, width: holds || state === 'frozen' ? 2.5 : 1.5, subColor: lost || state === 'frozen' ? c.bad : undefined });
        if (r.wk.token && (state === 'work' || state === 'frozen' || state === 'write')) stage.text('#' + r.wk.token, r.x + r.w / 2 + 4, r.y, { size: 10, weight: 600, color: c.muted });
      }
      const free = L.free(now);
      box(stage, lock, 'Lock', free ? 'free' : `held by ${L.holder} · #${L.token}`, { stroke: free ? c.wire : c.ok, width: 2 });
      if (!free) {
        const k = clamp((L.expires - now) / L.ttl, 0, 1);
        ctx.save();
        ctx.beginPath(); ctx.strokeStyle = c.signal; ctx.lineWidth = 3;
        ctx.arc(lock.x, lock.y - lock.h / 2 - 12, 7, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke();
        ctx.restore();
        stage.text(`lease ${(L.expires - now).toFixed(1)} s`, lock.x, lock.y - lock.h / 2 - 22, { size: 10, color: c.muted, align: 'center', baseline: 'bottom' });
      }
      box(stage, store, 'Storage', s.fencing ? `max token #${st.store.maxToken}` : 'accepts all');

      const ly = top + 2 * gap + wh / 2 + 16, rowH = narrow ? 14 : 15;
      const n = Math.max(1, Math.floor((h - ly - 6) / rowH));
      const lx = 12, lw = w - 24;
      fitText(stage, 'Writes to storage, newest first', lx, ly, lw, { size: 10.5, weight: 600, color: c.muted });
      st.store.writes.slice(-(n - 1)).reverse().forEach((wr, i) => {
        const ry = ly + 8 + i * rowH;
        const bad = wr.res === 'unsafe', rej = wr.res === 'rejected';
        tile(stage, lx, ry, lw, rowH - 3, { fill: bad ? c.bad : c.surface, fillAlpha: bad ? 0.32 : rej ? 0.55 : 1, stroke: bad ? c.bad : c.line });
        stage.text(`Worker ${wr.who} with token #${wr.token}`, lx + 6, ry + (rowH - 3) / 2, { size: 10, color: rej ? c.muted : c.ink });
        stage.text(wr.res === 'ok' ? 'saved' : bad ? (narrow ? 'saved over newer data' : 'saved over newer data!') : 'refused: old token',
          lx + lw - 6, ry + (rowH - 3) / 2, { size: 10, weight: bad ? 700 : 500, color: bad ? c.bad : rej ? c.muted : c.ink, align: 'right' });
      });
    }

    kit.loop(dt => { clock.run(dt, step); paint(); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        fence.set('off', true); s.fencing = false;
        ttl.set(2, true); s.ttl = 2;
        pause.set(3, true); s.pause = 3;
        chance.set(60, true); s.chance = 0.6;
        reset();
        unpause();
      },
    };
  },
};
