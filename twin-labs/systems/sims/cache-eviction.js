// Cache eviction: four caches of the same size see the exact same request stream and differ only in
// which item they throw out when full.
// Model: item ids follow a Zipf-like popularity over 120 items (weight 1/rank^1.1). "With scans" adds
// a batch job: 30% of requests are one-off ids from a sweep of 400 items. "Trends shift" moves the
// popular set every 10 s (ids offset by 37 per period, over 300 ids). Policies: LRU evicts the least
// recently used, LFU the one with the fewest hits (ties: least recent), FIFO the oldest arrival,
// Random any. Hit rates are averaged over the last 10 one-second windows.

import { h } from '../../js/core/dom.js';
import { clamp, pct, hide3dButton, panelBox, unpause } from './_a-util.js';

const POLICIES = [['lru', 'LRU', 'wire'], ['lfu', 'LFU', 'ok'], ['fifo', 'FIFO', 'signal'], ['random', 'Random', 'violet']];
const HINTS = {
  zipf: 'A handful of items get most of the traffic, as on real sites.',
  scan: 'Popular items, plus a batch job sweeping through one-off items 30% of the time.',
  shift: 'Popular items, but which ones are popular changes every 10 s.',
};

function makeCache(policy, capacity) {
  const C = { policy, capacity, map: new Map(), tick: 0 };
  const victim = () => {
    if (policy === 'lru' || policy === 'fifo') return C.map.keys().next().value; // Map keeps insertion order
    if (policy === 'lfu') {
      let best = null;
      for (const [k, v] of C.map) if (!best || v.n < best.n || (v.n === best.n && v.last < best.last)) best = { k, n: v.n, last: v.last };
      return best.k;
    }
    const keys = [...C.map.keys()];
    return keys[Math.floor(Math.random() * keys.length)];
  };
  C.access = id => {
    C.tick++;
    const e = C.map.get(id);
    if (e) {
      e.n++; e.last = C.tick;
      if (policy === 'lru') { C.map.delete(id); C.map.set(id, e); } // move to the "most recent" end
      return true;
    }
    if (C.map.size >= C.capacity) C.map.delete(victim());
    C.map.set(id, { n: 1, last: C.tick });
    return false;
  };
  C.keys = () => [...C.map.keys()];
  return C;
}

/** Sampler for ids 0..n-1 with weight 1/(rank+1)^s. */
function zipf(n, s) {
  const cum = [];
  let tot = 0;
  for (let i = 0; i < n; i++) { tot += 1 / Math.pow(i + 1, s); cum.push(tot); }
  return () => {
    const r = Math.random() * tot;
    let lo = 0, hi = n - 1;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (cum[mid] < r) lo = mid + 1; else hi = mid; }
    return lo;
  };
}

export default {
  lead: 'A cache is small, so once it is full every new item pushes an old one out. Four eviction policies get the very same stream of requests side by side, and the workload decides which one wins.',
  emptyLog: 'Nothing yet. Switch the workload.',
  tryThis: [
    'On <b>With scans</b>, a batch job reads hundreds of items once each. LRU lets them wash the hot items out; LFU holds on to them.',
    'On <b>Trends shift</b>, the popular items change every 10 s. LFU clings to the old favourites while LRU follows the new ones.',
    'Shrink the cache to <b>4</b>. The policy matters most when memory is tight.',
  ],
  inShort: {
    what: 'When a cache is full, an eviction policy chooses what to drop: the least recently used (LRU), the least frequently used (LFU), the oldest arrival (FIFO) or a random item.',
    why: 'The cache holds only a fraction of the data, so keeping the items most likely to be asked for again is what sets the hit rate.',
    tradeoff: 'LRU fits traffic where recent means likely, but one big scan can flush it; LFU keeps steady favourites but is slow to let go of old ones.',
    interview: 'LRU is the usual default; when a few keys are very popular LFU does better, and a scan-resistant policy stops one-off reads from flushing the cache.',
  },
  quiz: [
    { q: 'Every night a job reads thousands of items once each. Which policy is most likely to lose its popular items?', o: ['LFU', 'LRU', 'Neither', 'Both the same'], a: 1,
      why: 'Each scanned item becomes the “most recently used” and shoves popular items out. LFU remembers that the popular items had many hits.' },
    { q: 'The popular items change every few minutes. Which policy is slowest to adapt?', o: ['LRU', 'LFU', 'FIFO', 'Random'], a: 1,
      why: 'LFU keeps high counts for the old favourites, so the newly popular items are the ones it evicts first.' },
    { q: 'With maxmemory and allkeys-lru, how does Redis choose what to evict?', o: ['Exact LRU over every key', 'Approximate LRU: it samples a few keys and drops the least recently used of them', 'FIFO', 'Random only'], a: 1,
      why: 'Sampling a handful of keys is cheap and gets close to true LRU without tracking a full ordering.' },
  ],
  guided: {
    intro: 'Mix a batch scan into normal traffic and see which policy protects the popular items.',
    example: '“Run the guided example” resets to the “With scans” workload, a cache of 16 items and 25 requests/s, then lets it run for about 12 seconds.',
    question: 'Which policy keeps the highest hit rate while the scan runs?',
    predictions: ['LFU', 'LRU', 'FIFO'],
    correctPrediction: 0,
    running: 'Watch the hit-rate bars on the right of each cache and the numbers under the diagram.',
    observation: 'LFU stayed ahead: the one-off scan items never built up hits, so LFU threw them out first and kept the popular items.',
    explainQuestion: 'Why did LFU come out ahead?',
    explanations: ['Scanned items are used once, so they have the lowest counts and LFU evicts them before the popular items.', 'LFU has more memory than the others.', 'LFU skips the scan requests entirely.'],
    correctExplanation: 0,
    why: 'LRU treats every new item as the most valuable, so a scan flushes it. Scan-resistant policies (LFU, 2Q, segmented LRU, TinyLFU) look at frequency too.',
    retryHint: 'Compare the LRU and LFU hit rates after about 10 seconds.',
    nextSlug: 'sharding',
    nextLabel: 'Next experiment: sharding →',
    waitSeconds: 16,
  },

  setup(kit) {
    const { stage } = kit;
    hide3dButton(kit);
    const s = { work: 'zipf', size: 16, rate: 25 };
    const sample = zipf(120, 1.1);
    let st;

    kit.metrics(POLICIES.map(([k, name]) => ({ key: k, label: `${name} hit rate (10 s)` })));
    const chart = kit.chart({ lines: POLICIES.map(([k, name, col]) => ({ key: k, label: name, color: col })), yMax: 100, format: v => `${Math.min(100, Math.round(v / 1.15))}%` });

    const p = kit.panel;
    const work = p.seg('Workload', { options: [['zipf', 'Popular items'], ['scan', 'With scans'], ['shift', 'Trends shift']], value: 'zipf', hint: HINTS.zipf,
      onChange: v => {
        s.work = v; hint.textContent = HINTS[v];
        kit.log({ zipf: 'Workload: a few popular items', scan: 'Workload: popular items plus large one-off scans', shift: 'Workload: popularity changes every 10 s' }[v]);
      } });
    const hint = work.el.querySelector('.ctl-hint');
    const size = p.slider('Cache size', { min: 4, max: 40, step: 2, value: s.size, format: v => `${v} items`,
      onInput: v => { s.size = v; buildCaches(); kit.log(`Caches rebuilt with room for ${v} items`); } });
    const rate = p.slider('Requests', { min: 5, max: 80, step: 5, value: s.rate, format: v => `${v} req/s`, onInput: v => { s.rate = v; } });
    p.buttons([{ label: 'Reset counters', kind: 'outline', onClick: reset }]);
    const about = panelBox(p, 'The four policies');
    about.body.append(h('ul', { style: { margin: 0, paddingLeft: '18px', fontSize: '13px', color: 'var(--text-2)', display: 'grid', gap: '6px' },
      html: '<li><b>LRU</b> (least recently used): drop whatever has gone untouched the longest. The default in most caches and CDNs.</li>'
        + '<li><b>LFU</b> (least frequently used): drop the item with the fewest hits. Great for steady favourites, slow to forget old ones.</li>'
        + '<li><b>FIFO</b>: drop the earliest arrival, however popular it is.</li>'
        + '<li><b>Random</b>: does better than you might expect, and needs no bookkeeping at all.</li>' }));

    function buildCaches() {
      st.caches = POLICIES.map(([k]) => makeCache(k, s.size));
      st.win = POLICIES.map(() => ({ h: 0, n: 0 }));
      st.flash = POLICIES.map(() => new Map());
    }
    function reset() {
      st = { t: 0, arr: 0, scan: 0, period: 0, recent: [], winT: 0, hist: [], last: null, leader: null };
      buildCaches();
      kit.resetTime();
      chart.reset();
      kit.clearLog();
      paintMetrics();
    }

    function nextId() {
      if (s.work === 'scan' && Math.random() < 0.3) return 1000 + (st.scan++ % 400);
      if (s.work === 'shift') {
        const period = Math.floor(st.t / 10);
        if (period !== st.period) { st.period = period; kit.log('The popular items just changed'); }
        return (sample() + period * 37) % 300;
      }
      return sample();
    }

    function step(dt) {
      st.t += dt;
      st.arr += s.rate * dt;
      const n = Math.floor(st.arr);
      st.arr -= n;
      for (let i = 0; i < n; i++) {
        const id = nextId();
        st.recent.unshift(id);
        if (st.recent.length > 40) st.recent.pop();
        st.caches.forEach((c, j) => {
          const hit = c.access(id);
          st.win[j].n++; if (hit) st.win[j].h++;
          st.flash[j].set(id, { hit, t: 0.6 });
        });
      }
      for (const m of st.flash) for (const [k, f] of m) { f.t -= dt; if (f.t <= 0) m.delete(k); }
      st.winT += dt;
      if (st.winT >= 1) {
        st.winT -= 1;
        const sample1 = {};
        POLICIES.forEach(([k], j) => { sample1[k] = st.win[j].n ? (st.win[j].h / st.win[j].n) * 100 : 0; });
        st.hist.push(sample1);
        if (st.hist.length > 60) st.hist.shift();
        chart.push(sample1);
        const lastTen = st.hist.slice(-10);
        st.last = POLICIES.map(([k]) => lastTen.reduce((a, d) => a + d[k], 0) / lastTen.length / 100);
        st.win = POLICIES.map(() => ({ h: 0, n: 0 }));
        trackLeader(lastTen.length);
        paintMetrics();
      }
    }

    function trackLeader(samples) {
      if (samples < 5) return;
      const best = st.last.indexOf(Math.max(...st.last));
      if (best !== st.leader && st.last[best] > 0) {
        st.leader = best;
        kit.log(`${POLICIES[best][1]} now has the best hit rate (${pct(st.last[best])})`);
      }
      if (s.work === 'scan' && samples >= 10) {
        const lru = st.last[0], lfu = st.last[1];
        if (lfu > lru) kit.guided.observe(`Over the last 10 s LFU hit ${pct(lfu)} of requests against ${pct(lru)} for LRU: the scan pushed LRU's popular items out.`);
      }
    }

    function paintMetrics() {
      if (!st.last) { for (const [k] of POLICIES) kit.metric(k, '–'); return; }
      const best = Math.max(...st.last);
      POLICIES.forEach(([k], j) => kit.metric(k, pct(st.last[j]), st.last[j] === best && best > 0 ? 'good' : ''));
    }

    // ---- drawing ----
    const isDark = () => {
      const m = /^#?([0-9a-f]{6})/i.exec(stage.colors.bg || '');
      if (!m) return true;
      const n = parseInt(m[1], 16);
      return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 < 128;
    };
    const colourOf = (id, dark) => id >= 1000 ? stage.colors.muted : `hsl(${(id * 47) % 360} ${dark ? '65% 62%' : '60% 45%'})`;

    function draw() {
      stage.clear();
      const c = stage.colors, w = stage.w, H = stage.h, ctx = stage.ctx, dark = isDark();
      stage.text('Latest requests →', 10, 16, { size: 11.5, weight: 600 });
      const sq = Math.max(8, Math.min(16, (w - 130) / 40));
      st.recent.forEach((id, i) => {
        const x = 120 + i * (sq + 2);
        if (x + sq > w - 8) return;
        ctx.save(); ctx.globalAlpha = 1 - i / 45;
        stage.rect(x, 9, sq, sq, { fill: colourOf(id, dark), r: 3 });
        ctx.restore();
      });
      const top = 36, rowH = (H - top - 8) / POLICIES.length;
      const labelW = clamp(w * 0.12, 48, 70), barW = clamp(w * 0.16, 60, 110);
      const x0 = 10 + labelW, room = w - x0 - barW - 20;
      const perRow = Math.min(s.size, Math.max(4, Math.floor(room / 20)));
      const lines = Math.ceil(s.size / perRow);
      const cell = Math.min(22, (rowH - 14) / lines - 3, room / perRow - 3);
      POLICIES.forEach(([k, name, col], j) => {
        const y = top + j * rowH, cache = st.caches[j], keys = cache.keys();
        stage.text(name, 10, y + rowH / 2, { size: 12, weight: 700, color: c[col] });
        for (let i = 0; i < s.size; i++) {
          const cx = x0 + (i % perRow) * (cell + 3);
          const cy = y + (rowH - lines * (cell + 3)) / 2 + Math.floor(i / perRow) * (cell + 3);
          const id = keys[i];
          if (id == null) { stage.rect(cx, cy, cell, cell, { stroke: c.line, width: 1, r: 4 }); continue; }
          stage.rect(cx, cy, cell, cell, { fill: colourOf(id, dark), r: 4 });
          const f = st.flash[j].get(id);
          if (f) { ctx.save(); ctx.globalAlpha = Math.min(1, f.t / 0.3); stage.rect(cx, cy, cell, cell, { stroke: f.hit ? c.ok : c.signal, width: 2.5, r: 4 }); ctx.restore(); }
        }
        const rate = st.last ? st.last[j] : 0, bx = w - barW - 10, by = y + rowH / 2 - 6;
        stage.rect(bx, by, barW, 12, { fill: c.surface, stroke: c.line, width: 1, r: 4 });
        if (rate > 0) stage.rect(bx, by, Math.max(8, barW * rate), 12, { fill: c[col], r: 4 });
        stage.text(pct(rate), w - 10, by - 9, { size: 11, weight: 600, align: 'right' });
      });
    }

    kit.loop(dt => { if (dt > 0) step(Math.min(dt, 0.1)); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        work.set('scan', true); s.work = 'scan'; hint.textContent = HINTS.scan;
        size.set(16, true); s.size = 16;
        rate.set(25, true); s.rate = 25;
        reset();
        unpause();
        kit.log('Guided run: popular items plus a batch scan, 16-item caches');
      },
    };
  },
};
