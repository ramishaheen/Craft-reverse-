// Raft consensus: 3, 5 or 7 servers keep one ordered log.
// Model: every follower has an election timer drawn from 1.5–3 s. When it runs out the follower
// becomes a candidate for term+1, votes for itself and asks the others; a live server that has not
// voted in that term (and whose log is no longer than the candidate's) grants its vote. A majority
// (⌊n/2⌋+1) makes it leader. The leader sends heartbeats every 0.5 s, which reset followers' timers
// and copy any missing log entries to them. Client writes append to the leader's log; an entry is
// committed once a majority of live servers in the leader's term hold it. Crashed servers do nothing.

import { clamp, fixedSteps, unpause, hide3dButton } from './_a-util.js';

function makeRaft({ n = 5, timeout = [1.5, 3], heartbeat = 0.5 } = {}) {
  const R = { n, heartbeat, nodes: [], commit: 0, events: [], t: 0 };
  const draw = () => timeout[0] + Math.random() * (timeout[1] - timeout[0]);
  for (let i = 0; i < n; i++) R.nodes.push({ id: i, state: 'follower', term: 0, voted: null, up: true, log: 0, left: draw(), hb: 0 });
  R.majority = () => Math.floor(n / 2) + 1;
  R.leader = () => R.nodes.find(x => x.up && x.state === 'leader') || null;
  const emit = (k, o) => R.events.push({ k, t: R.t, ...o });
  function stand(c) {
    c.state = 'candidate'; c.term++; c.voted = c.id; c.left = draw();
    let votes = 1;
    emit('stand', { id: c.id, term: c.term });
    for (const x of R.nodes) {
      if (x === c || !x.up) continue;
      if (x.term < c.term) { x.term = c.term; x.voted = null; x.state = 'follower'; }
      if (x.term === c.term && x.voted === null && c.log >= x.log) { x.voted = c.id; x.left = draw(); votes++; emit('vote', { from: x.id, to: c.id }); }
    }
    if (votes >= R.majority()) {
      c.state = 'leader'; c.hb = 0;
      emit('leader', { id: c.id, term: c.term, votes });
      for (const x of R.nodes) if (x !== c && x.state === 'leader') x.state = 'follower';
    }
  }
  function beat(l) {
    for (const x of R.nodes) {
      if (x === l || !x.up || x.term > l.term) continue;
      x.term = l.term; x.state = 'follower'; x.left = draw();
      if (x.log < l.log) { x.log = l.log; emit('copy', { to: x.id }); }
    }
    emit('beat', { id: l.id });
    const have = R.nodes.filter(x => x.up && x.log >= l.log && x.term === l.term).length;
    if (have >= R.majority() && l.log > R.commit) { R.commit = l.log; emit('commit', { index: R.commit }); }
  }
  R.tick = dt => {
    R.t += dt;
    for (const x of R.nodes) {
      if (!x.up) continue;
      if (x.state === 'leader') { x.hb += dt; if (x.hb >= R.heartbeat) { x.hb = 0; beat(x); } continue; }
      x.left -= dt;
      if (x.left <= 0) stand(x);
    }
  };
  R.write = () => { const l = R.leader(); if (!l) return false; l.log++; emit('append', { id: l.id, index: l.log }); return true; };
  R.crash = i => { R.nodes[i].up = false; emit('crash', { id: i }); };
  R.restart = i => { const x = R.nodes[i]; x.up = true; x.state = 'follower'; x.left = draw(); emit('restart', { id: i }); };
  return R;
}

export default {
  lead: 'A handful of servers have to agree on one ordered log even while some of them crash. Raft elects a single leader by majority vote; the leader copies each write to the others, and an entry counts as committed once a majority holds it.',
  emptyLog: 'Nothing yet. Crash the leader.',
  tryThis: [
    '<b>Crash the leader</b>. The followers stop hearing heartbeats; the first whose timer runs out stands for a new term and wins with a majority.',
    'With 5 servers, crash followers until only 2 are up. Writes still land in the leader’s log but never commit: 2 is not a majority of 5.',
    '<b>Restart all</b>. The servers that were down catch up through the leader’s heartbeats.',
  ],
  inShort: {
    what: 'Raft keeps one ordered log on several servers: an elected leader accepts writes, copies them out, and commits each entry once a majority stores it.',
    why: 'Systems such as etcd, Consul and Kafka’s KRaft mode need every server to agree on the same order of changes, even while some are down.',
    tradeoff: 'Every write waits for a round trip to a majority, and with fewer than half plus one servers up nothing can be written at all.',
    interview: 'Run 2N + 1 nodes to tolerate N failures; the leader replicates each entry and commits it when a majority acknowledges.',
  },
  quiz: [
    { q: 'A Raft cluster of 5 loses 3 servers. What happens?', o: ['It keeps committing writes', 'It can no longer commit: 2 is not a majority of 5', 'The last server becomes leader', 'Data is deleted'], a: 1,
      why: 'A write commits only when a majority (3 of 5) stores it, and winning an election also takes 3 votes.' },
    { q: 'Why are Raft’s election timeouts random?', o: ['For security', 'So two followers rarely stand at the same moment and split the vote', 'To save memory', 'To pick the fastest server'], a: 1,
      why: 'If everyone stood at once the votes would split and nobody would win; random timeouts break the tie.' },
    { q: 'How many servers does a cluster need to survive 2 failures?', o: ['3', '4', '5', '6'], a: 2,
      why: 'With 2N + 1 servers you survive N failures: 5 servers still have a majority of 3 after losing 2.' },
  ],
  guided: {
    intro: 'Let a five-server cluster settle on a leader, then crash that leader.',
    example: '“Run the guided example” resets to 5 servers and 1 write per second, waits for a leader, then crashes it.',
    question: 'What happens after the leader crashes?',
    predictions: ['Within a few seconds a follower times out, stands for a new term and wins a majority.', 'The cluster stops for good until the old leader returns.', 'Every follower becomes leader at once.'],
    correctPrediction: 0,
    running: 'Watch the amber timer arcs around the followers and “What just happened”.',
    observation: 'A follower whose timer ran out first stood for a new term, collected a majority of votes and became the new leader.',
    explainQuestion: 'How did the cluster recover without the old leader?',
    explanations: ['Followers that stop hearing heartbeats start an election, and the candidate with a majority of votes takes over.', 'The old leader handed over before crashing.', 'An administrator picked the new leader.'],
    correctExplanation: 0,
    why: 'Leadership needs no outside help, only a live majority. Random timeouts make it likely that one candidate stands alone and wins quickly.',
    retryHint: 'Find the “stands for term” and “won the election” events after the crash.',
    nextSlug: 'cap-theorem',
    nextLabel: 'Next experiment: CAP theorem →',
    waitSeconds: 12,
  },

  setup(kit) {
    const { stage } = kit;
    hide3dButton(kit);
    const s = { n: 5, rate: 1 };
    let st;

    kit.metrics([{ key: 'leader', label: 'Leader' }, { key: 'term', label: 'Term' }, { key: 'commit', label: 'Committed entries' }, { key: 'up', label: 'Servers up' }]);

    const p = kit.panel;
    const nSeg = p.seg('Servers', { options: [[3, '3'], [5, '5'], [7, '7']], value: 5, onChange: v => { s.n = v; reset(); kit.log(`New cluster of ${v} servers: a majority is ${Math.floor(v / 2) + 1}`); } });
    p.heading('Break things');
    p.buttons([
      { label: 'Crash the leader', kind: 'primary', onClick: crashLeader },
      { label: 'Crash a follower', kind: 'outline', onClick: () => { const f = st.raft.nodes.find(x => x.up && x.state !== 'leader'); if (f) st.raft.crash(f.id); } },
      { label: 'Restart all', kind: 'outline', onClick: () => st.raft.nodes.forEach(x => { if (!x.up) st.raft.restart(x.id); }) },
    ]);
    const rate = p.slider('Client writes per second', { min: 0, max: 3, step: 0.5, value: 1, format: v => `${v} /s`, onInput: v => { s.rate = v; } });

    function crashLeader() { const l = st.raft.leader(); if (l) st.raft.crash(l.id); else kit.log('There is no leader to crash right now'); }
    function reset() {
      st = { arr: 0, raft: makeRaft({ n: s.n }), seen: 0, fx: [], stalled: false, guidedCrash: false, crashedAt: null, leaderAt: 0 };
      kit.resetTime(); kit.clearLog(); paintMetrics();
    }

    function step(dt) {
      const R = st.raft;
      R.tick(dt);
      st.arr += s.rate * dt;
      while (st.arr >= 1) { st.arr -= 1; R.write(); }
      for (; st.seen < R.events.length; st.seen++) { const e = R.events[st.seen]; st.fx.push({ ...e, age: 0 }); narrate(e); }
      if (R.events.length > 400) { R.events.splice(0, R.events.length - 50); st.seen = R.events.length; }
      st.fx = st.fx.filter(f => (f.age += dt) < 0.6);
      if (st.guidedCrash && R.leader() && R.t - st.leaderAt > 1.5) { st.guidedCrash = false; crashLeader(); }
      const l = R.leader();
      const up = R.nodes.filter(x => x.up).length;
      const stalled = !!l && l.log > R.commit && up < R.majority();
      if (stalled && !st.stalled) kit.log(`Only ${up} of ${R.n} servers are up, short of a majority of ${R.majority()}: new entries cannot commit`);
      if (!stalled && st.stalled && l) kit.log('A majority is back, so entries commit again');
      st.stalled = stalled;
      paintMetrics();
    }
    function narrate(e) {
      const name = i => `S${i + 1}`;
      if (e.k === 'stand') kit.log(`${name(e.id)}’s election timer ran out: it stands for term ${e.term}`);
      else if (e.k === 'leader') {
        st.leaderAt = e.t;
        kit.log(`${name(e.id)} won the election with ${e.votes} votes and leads term ${e.term}`);
        if (st.crashedAt != null) {
          kit.guided.observe(`${name(e.id)} stood for term ${e.term} and won with ${e.votes} of ${st.raft.n} votes, ${(st.raft.t - st.crashedAt).toFixed(1)} s after the leader crashed.`);
          st.crashedAt = null;
        }
      } else if (e.k === 'crash') {
        const wasLeader = st.raft.nodes[e.id].state === 'leader';
        kit.log(`${name(e.id)} crashed${wasLeader ? ': the followers will stop hearing heartbeats' : ''}`);
        if (wasLeader) st.crashedAt = st.raft.t;
      } else if (e.k === 'restart') kit.log(`${name(e.id)} restarted as a follower and will catch up from the leader`);
    }

    function paintMetrics() {
      const R = st.raft, l = R.leader();
      kit.metric('leader', l ? `S${l.id + 1}` : 'none', l ? 'good' : 'bad');
      kit.metric('term', String(Math.max(...R.nodes.map(x => x.term))));
      kit.metric('commit', String(R.commit));
      const up = R.nodes.filter(x => x.up).length;
      kit.metric('up', `${up} of ${R.n}`, up >= R.majority() ? 'good' : 'bad');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, ctx = stage.ctx, w = stage.w, H = stage.h, R = st.raft, n = R.n, narrow = w < 520;
      const cx = w * (narrow ? 0.5 : 0.36), cy = H * 0.5, rad = Math.min(w * (narrow ? 0.33 : 0.24), H * 0.36);
      const nr = clamp(Math.min(w, H) * 0.065, 16, 26);
      const pos = R.nodes.map((_, i) => { const a = -Math.PI / 2 + (i * 2 * Math.PI) / n; return { x: cx + Math.cos(a) * rad, y: cy + Math.sin(a) * rad }; });
      const leader = R.leader();
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) stage.line(pos[i].x, pos[i].y, pos[j].x, pos[j].y, { color: c.line, width: 1, alpha: 0.6 });
      for (const f of st.fx) {
        const k = f.age / 0.6;
        if (f.k === 'beat' && leader) {
          for (let j = 0; j < n; j++) if (j !== f.id && R.nodes[j].up) { const a = pos[f.id], b = pos[j]; stage.dot(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 3, c.ok, 1 - k * 0.4); }
        } else if (f.k === 'vote') {
          const a = pos[f.from], b = pos[f.to]; stage.dot(a.x + (b.x - a.x) * k, a.y + (b.y - a.y) * k, 3.5, c.signal);
        } else if (f.k === 'stand' || f.k === 'leader' || f.k === 'crash') {
          ctx.save(); ctx.globalAlpha = clamp(1 - k, 0, 1);
          stage.ring(pos[f.id].x, pos[f.id].y, nr + 4 + k * 14, { color: f.k === 'leader' ? c.ok : f.k === 'crash' ? c.bad : c.signal, width: 2 });
          ctx.restore();
        }
      }
      R.nodes.forEach((x, i) => {
        const q = pos[i];
        const col = x.up ? (x.state === 'leader' ? c.ok : x.state === 'candidate' ? c.signal : c.wire) : c.line;
        stage.ring(q.x, q.y, nr, { fill: c.surface, color: col, width: x.state === 'leader' ? 3.5 : 2, dash: x.up ? undefined : [4, 3] });
        if (x.up && x.state !== 'leader') {
          const k = clamp(x.left / 3, 0, 1);
          ctx.save(); ctx.globalAlpha = 0.55; ctx.strokeStyle = c.signal; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(q.x, q.y, nr + 4, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); ctx.stroke(); ctx.restore();
        }
        stage.text(`S${i + 1}`, q.x, q.y - 5, { size: nr > 20 ? 13 : 11, weight: 700, color: x.up ? c.ink : c.muted, align: 'center' });
        stage.text(x.up ? (x.state === 'leader' ? 'leader' : x.state === 'candidate' ? 'candidate' : `term ${x.term}`) : 'down', q.x, q.y + 8, { size: nr > 20 ? 10 : 9, color: c.muted, align: 'center' });
        const sz = 6, cnt = Math.min(x.log, 14), x0 = q.x - (cnt * (sz + 1)) / 2, y0 = q.y + nr + (x.up && x.state !== 'leader' ? 8 : 5);
        ctx.save(); ctx.globalAlpha = x.up ? 1 : 0.4;
        for (let k = 0; k < cnt; k++) { const idx = x.log - cnt + k + 1; ctx.fillStyle = idx <= R.commit ? c.ok : c.signal; ctx.fillRect(x0 + k * (sz + 1), y0, sz, sz); }
        ctx.restore();
      });
      if (!narrow) {
        const lx = w * 0.68, ly = H * 0.18;
        stage.text('How to read it', lx, ly, { size: 11, weight: 600, baseline: 'top' });
        ['Green ring: the leader', 'Amber arc: time left before a follower', '  stands for election', 'Squares: log entries', '  green = committed (on a majority)', '  amber = not committed yet', `Majority of ${n}: ${R.majority()} servers`]
          .forEach((line, i) => stage.text(line, lx, ly + 18 + i * 15, { size: 10.5, color: c.muted, baseline: 'top' }));
      }
    }

    kit.loop(dt => { fixedSteps(st, dt, step); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        nSeg.set(5, true); s.n = 5;
        rate.set(1, true); s.rate = 1;
        reset();
        unpause();
        st.guidedCrash = true;
        kit.log('Guided run: waiting for a leader, then crashing it');
      },
    };
  },
};
