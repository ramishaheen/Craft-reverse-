// Social feed: 40 posts per second from three kinds of accounts — normal (200 followers, 97% of
// posts, each follows 260 normal accounts), popular (20K followers, 2.95%, 30 followed) and celebrity
// (2M followers, 0.05%, 10 followed). Fan-out on write puts one copy per follower into a queue that
// workers drain at 100K copies per second; a post becomes visible when its last copy is written.
// Fan-out on read stores a post once (visible at once) and a timeline load merges every followed
// account: 5 ms + 0.15 ms per merged account. Hybrid fans out accounts below the threshold and
// merges the big ones at read time.

import { fixedStep, clamp, row, unpause, hide3dButton } from './_d-util.js';

const KINDS = [
  { k: 'normal', followers: 200, share: 0.97, followees: 260 },
  { k: 'popular', followers: 20000, share: 0.0295, followees: 30 },
  { k: 'celebrity', followers: 2e6, share: 0.0005, followees: 10 },
];
const BASE_MS = 5, PER_MERGE_MS = 0.15, RATE = 40, CAP = 1e5;
const MODE_NAME = { write: 'fan-out on write', read: 'fan-out on read', hybrid: 'hybrid' };

const big = n => (n >= 1e6 ? (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + 'M' : n >= 1e3 ? (n / 1e3).toFixed(n % 1e3 ? 1 : 0) + 'K' : String(Math.round(n)));

function feed() {
  const f = { mode: 'write', threshold: 1e5, now: 0, acc: 0, queue: 0, drained: 0, enq: 0, pending: [], posts: 0, delays: { normal: [], celebrity: [] }, recent: [] };
  const fanned = kind => f.mode === 'write' || (f.mode === 'hybrid' && kind.followers < f.threshold);
  f.merged = () => (f.mode === 'write' ? 0 : KINDS.reduce((a, k) => a + (f.mode === 'read' || k.followers >= f.threshold ? k.followees : 0), 0));
  f.readMs = () => BASE_MS + PER_MERGE_MS * f.merged();
  f.record = p => { const d = f.delays[p.kind === 'celebrity' ? 'celebrity' : 'normal']; d.push(p.visible - p.t); if (d.length > 200) d.shift(); };
  f.post = (kind = KINDS[2]) => {
    const p = { kind: kind.k, t: f.now, visible: null, inserts: 0 };
    f.posts++;
    if (fanned(kind)) { p.inserts = kind.followers; f.queue += kind.followers; f.enq += kind.followers; p.until = f.enq; f.pending.push(p); }
    else p.visible = f.now;
    f.recent.unshift(p);
    if (f.recent.length > 12) f.recent.pop();
    if (p.visible != null) f.record(p);
    return p;
  };
  f.tick = dt => {
    f.now += dt;
    f.acc += RATE * dt;
    const made = [];
    while (f.acc >= 1) {
      f.acc -= 1;
      let r = Math.random(), kind = KINDS[0];
      for (const k of KINDS) { if (r < k.share) { kind = k; break; } r -= k.share; }
      made.push(f.post(kind));
    }
    const n = Math.min(f.queue, CAP * dt);
    f.queue -= n; f.drained += n;
    const shown = [];
    while (f.pending.length && f.pending[0].until <= f.drained + 1e-6) { const p = f.pending.shift(); p.visible = f.now; f.record(p); shown.push(p); }
    return { made, shown, copied: n };
  };
  f.avgDelay = k => { const d = f.delays[k]; return d.length ? d.reduce((a, b) => a + b, 0) / d.length : 0; };
  f.waitNow = () => f.queue / CAP;
  return f;
}

export default {
  lead: 'When you open the app your home timeline has to appear at once. One way: when someone posts, copy the post into the cached timeline of every follower (fan-out on write). Reads are cheap until a celebrity with millions of followers posts and the copy queue floods. The other way: store each post once and merge everyone you follow at read time. Real systems combine the two.',
  emptyLog: 'Posts are flowing. Press the celebrity button.',
  tryThis: [
    'With fan-out on write, press <b>A celebrity posts</b>. Two million copies block the queue, and your friends\' posts now wait behind them for many seconds.',
    'Switch to <b>On read</b>. Posts show up immediately, but every timeline load merges about 300 accounts and takes about ten times longer.',
    'Pick <b>Hybrid</b> at 100K. Celebrities are merged when you read and everyone else is fanned out: quick reads and no flood, which is how large social networks do it.',
  ],
  inShort: {
    what: 'A home timeline is built either by copying each post into every follower\'s cached feed (fan-out on write) or by merging the accounts you follow when you read.',
    why: 'Reads far outnumber posts and must feel instant, but follower counts range from a handful to tens of millions.',
    tradeoff: 'Fan-out on write gives fast reads but huge write bursts for celebrities; fan-out on read makes posting cheap but reading slow.',
    interview: 'Hybrid: fan out on write into in-memory timelines for normal users, merge celebrity posts at read time, and only keep timelines for users who were active recently.',
  },
  quiz: [
    { q: 'What makes fan-out on write cheap for readers?', o: ['Nothing', 'Every user\'s timeline is already built in a cache, so a read is a single lookup', 'Posts are smaller', 'Readers are offline'], a: 1,
      why: 'The work is done once when the post is made; opening the app just reads the ready list.' },
    { q: 'Why does a celebrity post hurt fan-out on write?', o: ['Celebrities write long posts', 'Millions of follower timelines each need a copy, which floods the queue and delays everyone', 'It doesn\'t', 'Celebrities have no followers'], a: 1,
      why: 'Write cost grows with follower count; one post can mean millions of inserts.' },
    { q: 'How does the hybrid approach work?', o: ['It chooses at random', 'Normal accounts are fanned out on write; posts from huge accounts are merged in at read time', 'It uses two databases', 'It turns timelines off'], a: 1,
      why: 'Readers only merge the few celebrities they follow, so reads stay quick and writes stay bounded.' },
  ],
  guided: {
    intro: 'Let a celebrity post while every post is fanned out on write.',
    example: '“Run the guided example” resets to fan-out on write and then a celebrity with 2M followers posts.',
    question: 'What happens to ordinary posts from your friends right after?',
    predictions: ['They wait many seconds behind the celebrity\'s copies.', 'Nothing, they still appear instantly.', 'They appear faster because the queue is busy.'],
    correctPrediction: 0,
    running: 'Watch the fan-out queue bar and the “Friend\'s post shows after” number.',
    observation: 'Two million copies went into the queue ahead of everyone else, so ordinary posts waited about 20 seconds.',
    explainQuestion: 'Why were ordinary posts delayed?',
    explanations: ['They share one copy queue, and the celebrity\'s two million inserts were ahead of them.', 'The celebrity\'s post was larger.', 'Timeline reads slowed down the workers.'],
    correctExplanation: 0,
    why: 'Write cost scales with followers. Merging huge accounts at read time (hybrid) keeps the queue small.',
    retryHint: 'Divide the copies waiting by the 100K copies per second the workers write.',
    nextSlug: 'whatsapp',
    nextLabel: 'Next experiment: chat messenger →',
    waitSeconds: 8,
  },

  setup(kit) {
    const { stage } = kit;
    let st;
    let mode = 'write', thExp = 5;

    kit.metrics([
      { key: 'read', label: 'Timeline load' }, { key: 'norm', label: "Friend's post shows after" },
      { key: 'celeb', label: 'Celebrity post shows after' }, { key: 'q', label: 'Copies waiting' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'norm', label: "Friend's post delay", color: 'wire' }, { key: 'celeb', label: 'Celebrity post delay', color: 'signal' }],
      format: v => `${v.toFixed(v >= 10 ? 0 : 1)} s`,
    });

    const p = kit.panel;
    p.buttons([{ label: 'A celebrity posts (2M followers)', kind: 'primary', onClick: celebrity }]);
    const modeCtl = p.seg('Fan-out', { options: [['write', 'On write'], ['read', 'On read'], ['hybrid', 'Hybrid']], value: 'write', onChange: v => {
      mode = v; st.f.mode = v;
      kit.log(`Switched to ${MODE_NAME[v]}: a timeline load now merges ${st.f.merged()} accounts (${st.f.readMs().toFixed(0)} ms)`); paint(); } });
    const th = p.slider('Hybrid: merge at read from', { min: 3, max: 7, step: 1, value: 5, format: v => big(10 ** v), hint: 'Accounts with at least this many followers are not fanned out',
      onInput: v => { thExp = v; st.f.threshold = 10 ** v; paint(); } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    function celebrity() {
      const post = st.f.post();
      if (post.inserts) { st.fly.push({ t: 0, kind: 'celebrity' }); kit.log(`A celebrity posted: ${big(post.inserts)} timeline copies queued (${(st.f.queue / CAP).toFixed(1)} s of work for the workers)`); }
      else kit.log('A celebrity posted: stored once, merged into followers\' timelines when they read');
      st.watchCeleb = post;
      paint();
    }

    function reset() {
      st = { f: feed(), fly: [], out: [], watchCeleb: null, guided: false, guidedAt: 0, wasBusy: false };
      st.f.mode = mode; st.f.threshold = 10 ** thExp;
      kit.resetTime();
      chart.reset();
      kit.clearLog();
      paint();
    }

    function step(dt) {
      const f = st.f;
      const r = f.tick(dt);
      for (const post of r.made) if (post.inserts && (post.kind !== 'normal' || Math.random() < 0.3)) st.fly.push({ t: 0, kind: post.kind });
      for (const post of r.made) if (post.kind === 'celebrity') { st.watchCeleb = post; kit.log(post.inserts ? `A celebrity posted on their own: ${big(post.inserts)} copies queued` : 'A celebrity posted on their own: stored once, merged at read time'); }
      if (st.watchCeleb && r.shown.includes(st.watchCeleb)) { kit.log(`The celebrity post reached every follower's timeline after ${(f.now - st.watchCeleb.t).toFixed(1)} s`); st.watchCeleb = null; }
      const n = Math.min(6, Math.round((r.copied / CAP / dt) * 3));
      for (let i = 0; i < n; i++) if (Math.random() < 0.5) st.out.push({ t: 0, c: Math.floor(Math.random() * 40) });
      for (const q of st.fly) q.t += dt * 2;
      for (const q of st.out) q.t += dt * 2.5;
      st.fly = st.fly.filter(q => q.t < 1);
      st.out = st.out.filter(q => q.t < 1);
      const busy = f.waitNow() > 2;
      if (busy && !st.wasBusy) kit.log(`The copy queue is ${f.waitNow().toFixed(1)} s deep: ordinary posts now wait behind it`);
      if (!busy && st.wasBusy) kit.log('The copy queue has drained; ordinary posts show within a moment again');
      st.wasBusy = busy;
      if (st.guided && f.now - st.guidedAt > 1 && f.waitNow() > 5) {
        st.guided = false;
        kit.guided.observe(`${big(f.queue)} copies were waiting in the queue, so a friend's ordinary post now needs about ${f.waitNow().toFixed(0)} s to show up.`);
      }
    }

    function everySecond() {
      const f = st.f;
      chart.push({ norm: Math.max(f.avgDelay('normal'), f.waitNow()), celeb: f.delays.celebrity.length ? f.avgDelay('celebrity') : null });
      paint();
    }

    function paint() {
      const f = st.f, ms = f.readMs(), norm = Math.max(f.avgDelay('normal'), f.waitNow());
      const celeb = f.delays.celebrity.length ? f.avgDelay('celebrity') : null;
      kit.metric('read', `${ms.toFixed(0)} ms`, ms > 30 ? 'bad' : ms > 10 ? 'warn' : 'good');
      kit.metric('norm', `${norm.toFixed(1)} s`, f.waitNow() > 2 ? 'bad' : 'good');
      kit.metric('celeb', celeb == null ? '–' : `${celeb.toFixed(1)} s`, celeb > 5 ? 'bad' : 'good');
      kit.metric('q', big(f.queue), f.queue > 1e5 ? 'bad' : f.queue > 2e4 ? 'warn' : 'good');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, f = st.f, W = stage.w, H = stage.h, small = W < 520;
      const top = 22, bh = Math.min(70, H * 0.3), cw = small ? (W - 48) / 3 : (W - 80) / 3;
      const X = i => 14 + i * (cw + (small ? 10 : 26)), midY = top + bh / 2;
      const card = (i, title, sub, stroke) => {
        stage.rect(X(i), top, cw, bh, { fill: c.surface, stroke: stroke || c.line, width: 1.2, r: 8 });
        stage.text(title, X(i) + cw / 2, top + 6, { size: small ? 10 : 11, weight: 700, align: 'center', baseline: 'top' });
        if (sub) stage.text(sub, X(i) + cw / 2, top + 20, { size: 9, color: c.muted, align: 'center', baseline: 'top' });
      };
      stage.text('write path', 14, top - 4, { size: 10, color: c.muted, baseline: 'bottom' });
      card(0, 'new posts', small ? '' : `${RATE} a second`);
      card(1, small ? 'fan-out' : 'fan-out queue', small ? '' : `workers copy ${big(CAP)}/s`, f.queue > 1e5 ? c.bad : null);
      card(2, small ? 'timelines' : 'timeline caches', small ? '' : 'one list per user');
      stage.arrow(X(0) + cw + 2, midY, X(1) - 2, midY, { color: c.line2 });
      stage.arrow(X(1) + cw + 2, midY, X(2) - 2, midY, { color: c.line2 });
      const fill = Math.min(1, f.queue / CAP / 30), qx = X(1) + 8, qw = cw - 16, qy = top + bh - 22;
      stage.rect(qx, qy, qw, 12, { fill: c.surface3, r: 3 });
      if (fill > 0) { stage.ctx.save(); stage.ctx.globalAlpha = 0.8; stage.rect(qx, qy, Math.max(3, qw * fill), 12, { fill: f.queue > 1e5 ? c.bad : c.signal, r: 3 }); stage.ctx.restore(); }
      stage.text(f.queue < 1 ? 'empty' : `${big(f.queue)} copies · ${(f.queue / CAP).toFixed(1)} s`, qx + qw / 2, qy + 6, { size: 9, weight: 600, align: 'center' });
      const gx = X(2) + 8, gy = top + (small ? 20 : 34), gw = cw - 16, gh = bh - (small ? 26 : 40), cols = 10, rows = 4, cellW = gw / cols, cellH = gh / rows;
      for (let i = 0; i < cols * rows; i++) stage.ctx.fillStyle = c.surface3, stage.ctx.fillRect(gx + (i % cols) * cellW + 1, gy + Math.floor(i / cols) * cellH + 1, cellW - 2, cellH - 2);
      for (const q of st.out) { stage.ctx.save(); stage.ctx.globalAlpha = 1 - q.t; stage.ctx.fillStyle = c.ok; stage.ctx.fillRect(gx + (q.c % cols) * cellW + 1, gy + Math.floor(q.c / cols) * cellH + 1, cellW - 2, cellH - 2); stage.ctx.restore(); }
      for (const q of st.fly) { const a = X(0) + cw, b = X(1); stage.dot(a + (b - a) * q.t, midY, q.kind === 'celebrity' ? 5 : 2.6, q.kind === 'celebrity' ? c.signal : c.ink, 0.9); }
      // read path
      const ry = top + bh + 34, rh = Math.min(64, H * 0.24), merged = f.merged(), youW = cw * 0.7;
      stage.text(`read path: open the app · ${f.readMs().toFixed(0)} ms`, 14, ry - 4, { size: 10, color: c.muted, baseline: 'bottom' });
      stage.rect(14, ry, youW, rh, { fill: c.surface, stroke: c.line, r: 8 });
      stage.text('you', 14 + youW / 2, ry + rh / 2, { size: 10, weight: 600, align: 'center' });
      if (f.mode !== 'read') {
        stage.line(14 + youW, ry + rh * 0.3, X(2) + cw / 2, top + bh, { color: c.ok, width: 2 });
        stage.text(small ? '1 lookup' : '1 cache lookup', 14 + cw * 0.75, ry + rh * 0.18, { size: 9, color: c.ok });
      }
      if (merged) {
        const x0 = X(1), span = X(2) + cw - x0, n = Math.min(small ? 30 : 60, merged), my = ry + rh * 0.72, sz = clamp(span / n - 2, 2, 6);
        for (let i = 0; i < n; i++) {
          const mx = x0 + (span * (i + 0.5)) / n;
          stage.line(14 + youW, ry + rh * 0.55, mx, my, { color: c.signal, width: 1, alpha: 0.35 });
          stage.rect(mx - sz / 2, my, sz, sz, { fill: c.signal, r: 1 });
        }
        stage.text(f.mode === 'hybrid' ? `merge posts of the ${merged} big accounts you follow` : `merge the latest posts of ${merged} followed accounts`, x0 + span / 2, my + sz + 4, { size: 9, color: c.signal, align: 'center', baseline: 'top' });
      }
      const ly = ry + rh + (merged ? 24 : 12), lh = small ? 14 : 15;
      f.recent.slice(0, Math.max(0, Math.floor((H - ly - 4) / lh))).forEach((q, i) => {
        row(stage, 14, ly + i * lh, W - 28, lh - 3, `${q.kind} post${q.inserts ? ` · ${big(q.inserts)} copies` : ' · stored once'}`,
          q.visible == null ? `waiting ${(f.now - q.t).toFixed(1)} s` : `visible after ${(q.visible - q.t).toFixed(1)} s`,
          { leftColor: q.kind === 'celebrity' ? c.signal : c.ink, rightColor: q.visible == null ? c.bad : c.ok });
      });
    }

    const fixed = fixedStep(step);
    kit.loop(dt => { fixed(dt); draw(); });
    kit.every(1, everySecond);
    hide3dButton(kit);
    reset();

    return {
      reset,
      guidedRun() {
        modeCtl.set('write', true); mode = 'write';
        th.set(5, true); thExp = 5;
        reset();
        st.guided = true; st.guidedAt = 0;
        kit.log('Guided run: fan-out on write');
        celebrity();
        unpause();
      },
    };
  },
};
