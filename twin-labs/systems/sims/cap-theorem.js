// CAP theorem: three copies of a cart total, two in Mumbai and one in Singapore.
// Model: 6 requests/s, 60% from Mumbai users and 40% from Singapore; the slider sets the share that
// are writes (each adds 50–500 to the local total). While the link is up every write reaches both
// regions. During a partition, CP mode refuses reads and writes on the side without a majority
// (Singapore: 1 of 3 copies); AP mode answers everywhere, so a read is stale when the other side holds
// a newer write. Healing applies last-write-wins: the side with the older last write takes the other
// side's value and the writes it accepted during the split are counted as lost.

import { clamp, pct, hide3dButton, unpause } from './_a-util.js';

function makeCap(mode) {
  const C = { mode, split: false, sides: { M: { nodes: 2, v: 100, ts: 0 }, S: { nodes: 1, v: 100, ts: 0 } }, clock: 0, splitWrites: { M: 0, S: 0 }, ok: 0, errors: 0, stale: 0, lost: 0 };
  const other = k => (k === 'M' ? 'S' : 'M');
  const majority = k => C.sides[k].nodes * 2 > 3;
  C.write = (k, v) => {
    if (C.split && C.mode === 'CP' && !majority(k)) { C.errors++; return 'error'; }
    const ts = ++C.clock, side = C.sides[k];
    side.v = v; side.ts = ts;
    if (C.split) C.splitWrites[k]++;
    else { const o = C.sides[other(k)]; o.v = v; o.ts = ts; }
    C.ok++;
    return 'ok';
  };
  C.read = k => {
    if (C.split && C.mode === 'CP' && !majority(k)) { C.errors++; return 'error'; }
    const stale = C.split && C.sides[other(k)].ts > C.sides[k].ts;
    if (stale) C.stale++;
    C.ok++;
    return stale ? 'stale' : 'ok';
  };
  C.partition = () => { C.split = true; C.splitWrites = { M: 0, S: 0 }; };
  C.heal = () => {
    if (!C.split) return 0;
    const win = C.sides.M.ts >= C.sides.S.ts ? 'M' : 'S', lose = other(win), n = C.splitWrites[lose];
    C.lost += n;
    C.sides[lose].v = C.sides[win].v; C.sides[lose].ts = C.sides[win].ts;
    C.split = false;
    return { n, win, lose };
  };
  C.diverged = () => C.sides.M.v !== C.sides.S.v;
  return C;
}

const REGION = { M: 'Mumbai', S: 'Singapore' };

export default {
  lead: 'Three copies of a shopping-cart total: two in Mumbai, one in Singapore. While the link works every copy agrees. Cut it, and each region can still reach its own users, so the system must pick: refuse requests to stay consistent (CP), or keep answering and let the copies drift (AP).',
  emptyLog: 'Nothing yet. Cut the link.',
  tryThis: [
    'In <b>CP</b>, cut the link. Mumbai holds 2 of 3 copies, a majority, so it carries on; Singapore cannot tell whether it is up to date, so it returns errors.',
    'Switch to <b>AP</b> and cut again. Both regions keep working, but Singapore reads old totals and the two values drift apart.',
    '<b>Heal</b> the link in AP. The last write wins, so the other region’s writes from the split are discarded. That is what staying available cost.',
  ],
  inShort: {
    what: 'CAP says that while the network is split, a replicated system has to choose between consistency (refuse) and availability (answer, possibly with stale data).',
    why: 'Links between data centres really do fail, so every distributed database must decide which of the two it gives up during a split.',
    tradeoff: 'CP returns errors on the minority side; AP keeps serving, but reads go stale and conflicting writes must be merged or lost.',
    interview: 'Payments and stock are CP, likes and feeds are AP; and when there is no partition, PACELC says the trade-off becomes latency against consistency.',
  },
  quiz: [
    { q: 'While the network is partitioned, what does CAP say you must give up?', o: ['Partition tolerance', 'Either consistency or availability', 'Both consistency and availability', 'Nothing'], a: 1,
      why: 'Partitions happen, so during one a system either refuses some requests (CP) or answers with possibly stale data (AP).' },
    { q: 'In CP mode, which side keeps working during the split?', o: ['Both', 'The side holding a majority of the replicas', 'The side with more users', 'Neither'], a: 1,
      why: 'Only a majority can be sure it has the latest data, so the minority refuses rather than risk a wrong answer.' },
    { q: 'An AP system heals with last-write-wins. What can happen?', o: ['Nothing is lost', 'Writes accepted on the losing side during the split are discarded', 'The database stops', 'Every write is kept twice'], a: 1,
      why: 'LWW keeps only the newest value. Systems that must not lose writes merge instead, using CRDTs, version vectors or app-level merges such as a cart union.' },
  ],
  guided: {
    intro: 'Run in AP mode, split the regions for a few seconds, then heal the link.',
    example: '“Run the guided example” resets to AP with 30% writes, cuts the link after 1 second and heals it 6 seconds later.',
    question: 'What happens when the link heals?',
    predictions: ['Some writes made on one side during the split are thrown away.', 'Both sides’ writes are merged and nothing is lost.', 'The system refuses all requests while it heals.'],
    correctPrediction: 0,
    running: 'Watch the two totals drift apart during the split and the “Writes lost at heal” number.',
    observation: 'Last write wins kept only the newer side’s value, so writes the other side had accepted during the split were lost.',
    explainQuestion: 'Why were writes lost?',
    explanations: ['Both sides accepted writes independently, and last-write-wins keeps one value and discards the other side’s changes.', 'The network dropped the writes while it was down.', 'CP mode refused them.'],
    correctExplanation: 0,
    why: 'Availability during a split means conflicting histories; at heal time you must merge them (CRDTs, app logic) or accept losing some.',
    retryHint: 'Look at the heal event in the log: it names the side whose writes were discarded.',
    nextSlug: 'sql-vs-nosql',
    nextLabel: 'Next experiment: SQL vs NoSQL →',
    waitSeconds: 12,
  },

  setup(kit) {
    const { stage } = kit;
    hide3dButton(kit);
    const s = { mode: 'CP', wr: 0.3 };
    const TRAVEL = 0.5;
    let st;

    kit.metrics([{ key: 'avail', label: 'Requests answered' }, { key: 'err', label: 'Errors' }, { key: 'stale', label: 'Stale reads' }, { key: 'lost', label: 'Writes lost at heal' }]);

    const p = kit.panel;
    const mode = p.seg('During a partition, choose', { options: [['CP', 'Consistency (CP)'], ['AP', 'Availability (AP)']], value: 'CP',
      onChange: v => { s.mode = v; reset(); kit.log(v === 'CP' ? 'CP: the minority side will refuse during a split' : 'AP: both sides will keep answering during a split'); } });
    p.heading('Network');
    p.buttons([{ label: 'Cut the link', kind: 'primary', onClick: cut }, { label: 'Heal it', kind: 'outline', onClick: heal }]);
    const wr = p.slider('Share of requests that are writes', { min: 10, max: 70, step: 10, value: 30, format: v => `${v}%`, onInput: v => { s.wr = v / 100; } });

    function reset() {
      st = { t: 0, arr: 0, cap: makeCap(s.mode), parts: [], lastHeal: null };
      kit.resetTime(); kit.clearLog(); paintMetrics();
    }
    function cut() {
      if (st.cap.split) return;
      st.cap.partition();
      kit.log(s.mode === 'CP' ? 'Link cut. Mumbai has a majority and carries on; Singapore starts refusing' : 'Link cut. Both regions keep answering on their own');
    }
    function heal() {
      if (!st.cap.split) return;
      const r = st.cap.heal();
      st.lastHeal = { n: r.n, t: st.t };
      if (r.n) {
        kit.log(`Link healed. Last write wins: ${REGION[r.win]}’s total is kept and ${r.n} write${r.n > 1 ? 's' : ''} made in ${REGION[r.lose]} during the split are discarded`);
        kit.guided.observe(`At heal time last-write-wins kept ${REGION[r.win]}’s total and threw away ${r.n} write${r.n > 1 ? 's' : ''} accepted in ${REGION[r.lose]} during the split.`);
      } else kit.log('Link healed. Nothing to reconcile');
    }

    function step(dt) {
      const C = st.cap;
      st.t += dt;
      st.arr += 6 * dt;
      while (st.arr >= 1) {
        st.arr -= 1;
        const side = Math.random() < 0.6 ? 'M' : 'S', isWrite = Math.random() < s.wr;
        const r = isWrite ? C.write(side, C.sides[side].v + Math.round(50 + Math.random() * 450)) : C.read(side);
        st.parts.push({ side, w: isWrite, r, t: 0 });
      }
      st.parts = st.parts.filter(x => (x.t += dt) < TRAVEL * 1.6);
      paintMetrics();
    }
    function paintMetrics() {
      const C = st.cap, total = C.ok + C.errors;
      kit.metric('avail', total ? pct(C.ok / total) : '–', C.errors ? 'warn' : 'good');
      kit.metric('err', String(C.errors), C.errors ? 'bad' : 'good');
      kit.metric('stale', String(C.stale), C.stale ? 'bad' : 'good');
      kit.metric('lost', String(C.lost), C.lost ? 'bad' : 'good');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, C = st.cap, w = stage.w, H = stage.h, narrow = w < 520;
      const bw = w * 0.4, top = H * 0.16, bh = H * 0.62, lx = w * 0.06, rx = w - lx - bw;
      const region = (x, label, k) => {
        stage.rect(x, top, bw, bh, { fill: c.surface2, stroke: c.line, width: 1, r: 10 });
        stage.text(label, x + 10, top + 14, { size: 11, weight: 600, color: c.muted });
        const refusing = C.split && C.mode === 'CP' && k === 'S';
        stage.text(refusing ? 'refusing' : `₹${C.sides[k].v}`, x + bw / 2, top + bh - (narrow ? 26 : 32), { size: narrow ? 15 : 20, weight: 700, align: 'center',
          color: refusing ? c.muted : C.split && C.diverged() ? c.signal : c.ink });
        stage.text('cart total here', x + bw / 2, top + bh - (narrow ? 10 : 13), { size: 10, color: c.muted, align: 'center' });
      };
      region(lx, 'Mumbai: 2 copies', 'M');
      region(rx, 'Singapore: 1 copy', 'S');
      const my = top + bh * 0.42;
      const dbs = { M: [{ x: lx + bw * 0.3, y: my }, { x: lx + bw * 0.7, y: my }], S: [{ x: rx + bw * 0.5, y: my }] };
      const r = clamp(w * 0.03, 10, 16);
      stage.line(lx + bw, my, rx, my, { color: C.split ? c.bad : c.ok, width: 2.5, dash: C.split ? [5, 5] : undefined });
      if (C.split) {
        const mx = (lx + bw + rx) / 2;
        stage.line(mx - 7, my - 7, mx + 7, my + 7, { color: c.bad, width: 3 });
        stage.line(mx + 7, my - 7, mx - 7, my + 7, { color: c.bad, width: 3 });
        stage.text('partition', mx, my - 16, { size: 10, weight: 600, color: c.bad, align: 'center' });
      }
      for (const k of ['M', 'S']) for (const d of dbs[k]) {
        const refusing = C.split && C.mode === 'CP' && k === 'S';
        stage.ring(d.x, d.y, r, { fill: c.surface, width: 2, color: refusing ? c.bad : C.split && C.mode === 'AP' && C.diverged() ? c.signal : c.ok });
        stage.text('DB', d.x, d.y, { size: 9.5, weight: 600, align: 'center' });
      }
      for (const x of st.parts) {
        const from = { x: (x.side === 'M' ? lx : rx) + bw * 0.5, y: top + bh + 20 }, to = dbs[x.side][0], k = x.t / TRAVEL;
        if (k < 1) stage.dot(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, 3.5, x.w ? c.signal : c.wire);
        else {
          const f = Math.min(1, (k - 1) / 0.6), ctx = stage.ctx;
          ctx.save(); ctx.globalAlpha = clamp(1 - f, 0, 1);
          stage.ring(to.x, to.y, 4 + f * 10, { color: x.r === 'error' ? c.bad : x.r === 'stale' ? c.signal : c.ok, width: 1.6 });
          ctx.restore();
        }
      }
      stage.text('users', lx + bw / 2, top + bh + 30, { size: 10, color: c.muted, align: 'center' });
      stage.text('users', rx + bw / 2, top + bh + 30, { size: 10, color: c.muted, align: 'center' });
      const healed = st.lastHeal && st.t - st.lastHeal.t < 4;
      const msg = healed ? (st.lastHeal.n ? `Healed: last write wins, ${st.lastHeal.n} write${st.lastHeal.n > 1 ? 's' : ''} thrown away` : 'Healed: nothing to reconcile')
        : C.split ? (C.mode === 'CP' ? 'CP: the minority side refuses' : 'AP: both sides answer, copies drift apart') : 'Link up: every copy agrees';
      stage.text(msg, w / 2, top - 12, { size: healed ? 11 : 10.5, weight: healed ? 600 : 500, align: 'center', color: healed ? (st.lastHeal.n ? c.bad : c.ok) : c.muted });
      stage.text('blue = read, amber = write; ring: green answered, amber stale, red refused', w / 2, H - 8, { size: 10, color: c.muted, align: 'center' });
    }

    kit.loop(dt => { if (dt > 0) step(Math.min(dt, 0.1)); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
                mode.set('AP', true); s.mode = 'AP';
        wr.set(30, true); s.wr = 0.3;
        reset();
        unpause();
        kit.log('Guided run: AP mode, the link will be cut for 6 seconds');
        const startAt = st.t, mine = st;
        const off = kit.loop(() => {
          if (st !== mine) { off(); return; }
          if (!st.cap.split && !st.didCut && st.t - startAt >= 1) { st.didCut = true; cut(); }
          if (st.cap.split && st.didCut && st.t - startAt >= 7) { heal(); off(); }
        });
      },
    };
  },
};
