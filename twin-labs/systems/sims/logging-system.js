// Logging system: services → agent (level filter) → buffer → indexer → search.
// Model: on a normal day services write DEBUG 2000, INFO 300, WARN 30 and ERROR 4 lines per second.
// An incident lasts 10 s and multiplies ERROR by 25 and every other level by 3. The agent ships only
// lines at or above the chosen level. With the durable buffer every shipped line waits until the
// indexer (300–3000 lines/s) takes it; sending directly, the agent's in-memory buffer holds at most
// 1000 lines and drops the rest. "Search is behind by" = waiting lines ÷ indexer capacity. Storage
// per day = shipped lines per normal second × 86 400 s × 0.5 KB per line.

import { stepper, pct, unpause, alpha } from './_e-util.js';

const LEVELS = ['DEBUG', 'INFO', 'WARN', 'ERROR'];
const BASE = { DEBUG: 2000, INFO: 300, WARN: 30, ERROR: 4 };
const AGENT_BUF = 1000, KB_PER_LINE = 0.5, INCIDENT_S = 10;
const n = v => (v >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : v >= 1e3 ? `${(v / 1e3).toFixed(v % 1e3 && v < 1e4 ? 1 : 0)}k` : String(Math.round(v)));

export default {
  lead: 'Every service writes log lines. An agent on each machine ships them to an indexer, which makes them searchable. On a quiet day that is easy. During an incident, errors flood in exactly when engineers need to search them, and a pipeline without a buffer drops lines or falls behind. Logging everything at DEBUG makes it worse and costs a fortune in storage.',
  emptyLog: 'Logs are flowing on a normal day. Start an incident.',
  stageHeight: 420,
  tryThis: [
    'Pick <b>Send directly</b>, then start an incident. The agents\' small buffers overflow and most of the error lines you need are gone.',
    'Switch back to the <b>durable buffer</b>. Nothing is lost; search falls a few seconds behind, then catches up.',
    'Ship <b>DEBUG</b>. Storage grows about sevenfold and the indexer never catches up. Raise its capacity, or keep DEBUG off in production.',
  ],
  inShort: {
    what: 'A logging system collects log lines from every service through agents, buffers them, indexes them and lets engineers search them.',
    why: 'When something breaks, logs are how you find out why, and they are needed most during the very incident that floods them.',
    tradeoff: 'Shipping more levels and fields helps debugging but multiplies cost and lag; a buffer prevents loss but is one more moving part.',
    interview: 'Agents such as Fluent Bit feed Kafka, consumers write into Elasticsearch, OpenSearch or Loki, INFO and above by default, sampling for noisy sources, and hot/warm/cold retention.',
  },
  quiz: [
    { q: 'Why put a durable buffer such as Kafka between the log agents and the indexer?', o: ['To encrypt logs', 'It absorbs bursts, so lines wait instead of being dropped while the indexer is busy', 'It makes logs smaller', 'The law requires it'], a: 1,
      why: 'Incidents create log spikes exactly when you need the logs; a buffer turns a spike into a short delay instead of lost data.' },
    { q: 'What happens if every service ships DEBUG logs in production?', o: ['Nothing', 'Volume and storage cost multiply and the indexer falls far behind', 'Search gets faster', 'Errors disappear'], a: 1,
      why: 'DEBUG is often ten times the volume of INFO; ship it only for short, targeted debugging.' },
    { q: 'During an incident, why might a search for errors show fewer than really happened?', o: ['Errors are hidden on purpose', 'Some lines were dropped and others are still waiting to be indexed', 'Search only shows warnings', 'Logs expire immediately'], a: 1,
      why: 'Watch both drops and indexing lag; either one leaves the picture incomplete exactly when it matters.' },
  ],
  guided: {
    intro: 'Remove the buffer and trigger an incident.',
    example: '“Run the guided example” resets to INFO and above, an 800 lines/s indexer and “Send directly”, then starts a 10-second incident.',
    question: 'What will a search for error lines show after the incident?',
    predictions: ['Many of the error lines are missing, because the agents\' buffers overflowed.', 'Every error line, just a little late.', 'More errors than happened, because of retries.'],
    correctPrediction: 0,
    running: 'Watch the agent buffer bar fill and turn red, and the search box count found and lost error lines.',
    observation: 'The agent buffer filled within a second and stayed full, so a large share of the incident\'s error lines were dropped before they reached the indexer.',
    explainQuestion: 'Why were error lines lost?',
    explanations: ['Lines arrived faster than the indexer could take them, and the small in-memory buffer had nowhere to put the excess.', 'The indexer deletes errors during an incident.', 'The agent only ships WARN and above.'],
    correctExplanation: 0,
    why: 'A durable buffer turns a burst into a delay; without one, a burst above capacity becomes data loss.',
    retryHint: 'Compare “Error lines lost” with “Error lines you can search” after the incident.',
    nextSlug: 'architecture-3d',
    nextLabel: 'Next: the whole backend in 3D →',
    waitSeconds: 16,
  },

  setup(kit) {
    const { stage } = kit;
    const fixed = stepper(0.05);
    const s = { level: 'INFO', buffer: true, cap: 800 };
    let L, st;

    kit.metrics([
      { key: 'found', label: 'Error lines you can search' }, { key: 'lag', label: 'Search is behind by' },
      { key: 'drop', label: 'Error lines lost' }, { key: 'gb', label: 'Storage per day' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'in', label: 'Lines arriving / s', color: 'signal' }, { key: 'out', label: 'Lines indexed / s', color: 'ok' }],
      bars: { key: 'lost', label: 'Error lines lost', color: 'bad' },
      format: v => n(v),
    });

    const p = kit.panel;
    const acts = p.buttons([{ label: 'Start an incident (10 s)', kind: 'primary', onClick: incident, wide: true }]);
    const incBtn = acts.buttons[0];
    const level = p.seg('Agent ships logs from level', { options: LEVELS.slice(0, 3).map(l => [l, l]), value: 'INFO',
      onChange: v => { s.level = v; kit.log(`Agents now ship ${v} and above (${Math.round(gbPerDay())} GB a day)`); } });
    const buf = p.seg('Between agents and indexer', { options: [['kafka', 'Kafka buffer'], ['none', 'Send directly']], value: 'kafka',
      onChange: v => { s.buffer = v === 'kafka'; kit.log(s.buffer ? 'Lines now wait in a durable buffer until the indexer takes them' : `Lines now go straight to the indexer; each agent holds at most ${n(AGENT_BUF)} in memory`); } });
    const cap = p.slider('Indexer capacity', { min: 300, max: 3000, step: 100, value: 800, format: v => n(v), hint: 'Lines per second it can make searchable', onInput: v => { s.cap = v; } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    const ships = lv => LEVELS.indexOf(lv) >= LEVELS.indexOf(s.level);
    const rate = lv => BASE[lv] * (L.spike > 0 ? (lv === 'ERROR' ? 25 : 3) : 1);
    const waiting = () => L.queue.reduce((a, q) => a + q.n, 0);
    const lag = () => waiting() / s.cap;
    const gbPerDay = () => (LEVELS.filter(ships).reduce((a, lv) => a + BASE[lv], 0) * 86400 * KB_PER_LINE) / 1e6;
    const zero = () => ({ DEBUG: 0, INFO: 0, WARN: 0, ERROR: 0 });

    function incident() {
      if (L.spike > 0) return;
      L.spike = INCIDENT_S;
      kit.log('Incident! Errors jump 25× and every other level 3× for 10 seconds');
    }
    function tick(h) {
      L.now += h;
      const wasSpike = L.spike > 0;
      L.spike = Math.max(0, L.spike - h);
      if (wasSpike && L.spike === 0) { kit.log(`Incident over. ${n(L.dropped.ERROR)} error lines were lost, ${n(waiting())} lines still wait to be indexed`); L.endedAt = L.now; }
      for (const lv of LEVELS) {
        L.acc[lv] += rate(lv) * h;
        const k = Math.floor(L.acc[lv]);
        if (!k) continue;
        L.acc[lv] -= k; L.made[lv] += k;
        if (!ships(lv)) { L.filtered += k; continue; }
        const room = s.buffer ? Infinity : AGENT_BUF - waiting();
        const take = Math.min(k, Math.max(0, room));
        if (k - take > 0) {
          L.dropped[lv] += k - take;
          if (lv === 'ERROR') st.secLost += k - take;
          if (!L.dropping) { L.dropping = true; kit.log('Agent buffer is full: new log lines are being dropped'); }
        }
        if (take) { const last = L.queue[L.queue.length - 1]; if (last && last.lv === lv) last.n += take; else L.queue.push({ lv, n: take }); }
        st.secIn += take;
      }
      let budget = s.cap * h;
      while (budget > 0 && L.queue.length) {
        const q = L.queue[0], k = Math.min(q.n, budget);
        q.n -= k; budget -= k; L.indexed[q.lv] += k; st.secOut += k;
        if (q.n <= 1e-9) L.queue.shift();
      }
      if (L.dropping && waiting() < AGENT_BUF * 0.9) L.dropping = false;
      const lg = lag();
      if (lg > 10 && !L.lagWarned) { L.lagWarned = true; kit.log('Search is now more than 10 s behind the newest logs'); }
      if (lg < 0.5 && L.lagWarned) { L.lagWarned = false; kit.log('The indexer caught up: search is live again'); }
      // dots
      for (const lv of LEVELS) if (Math.random() < Math.min(1, rate(lv) / 600) * h * 12) st.dots.push({ lv, t: 0, y: Math.random(), keep: ships(lv) });
      for (const d of st.dots) d.t += h * 1.4;
      st.dots = st.dots.filter(d => d.t < 1).slice(-220);
      const g = st.guided;
      if (g && L.endedAt != null && L.now - L.endedAt >= 1) {
        st.guided = null;
        const found = L.made.ERROR ? L.indexed.ERROR / L.made.ERROR : 1;
        kit.guided.observe(`Of ${n(L.made.ERROR)} error lines written, ${n(L.dropped.ERROR)} were dropped when the agent buffer overflowed; search can only ever show ${pct(found)} of them.`);
      }
    }
    function reset() {
      L = { now: 0, spike: 0, queue: [], indexed: zero(), made: zero(), dropped: zero(), filtered: 0, acc: zero(), hist: [], dropping: false, lagWarned: false, endedAt: null };
      st = { dots: [], secIn: 0, secOut: 0, secLost: 0, guided: null };
      kit.resetTime(); chart.reset(); kit.clearLog(); paint();
    }
    function paint() {
      const found = L.made.ERROR ? L.indexed.ERROR / L.made.ERROR : 1, lg = lag(), gb = gbPerDay();
      kit.metric('found', L.made.ERROR ? pct(found) : '–', found < 0.95 ? 'bad' : 'good');
      kit.metric('lag', lg < 0.5 ? 'live' : `${lg.toFixed(0)} s`, lg > 10 ? 'bad' : lg > 2 ? 'warn' : 'good');
      kit.metric('drop', n(L.dropped.ERROR), L.dropped.ERROR ? 'bad' : 'good');
      kit.metric('gb', `${gb.toFixed(0)} GB`, gb > 50 ? 'bad' : '');
      incBtn.disabled = L.spike > 0;
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h, ctx = stage.ctx;
      const col = { DEBUG: c.muted, INFO: c.wire, WARN: c.signal, ERROR: c.bad };
      const narrow = W < 520, top = 22, bh = Math.min(90, H * 0.36), gap = narrow ? 8 : 22, bw = (W - 28 - gap * 3) / 4;
      const X = i => 14 + i * (bw + gap);
      const box = (i, title, sub, stroke) => {
        stage.rect(X(i), top, bw, bh, { fill: c.surface, stroke: stroke || c.line, width: 1.3, r: 8 });
        stage.text(title, X(i) + bw / 2, top + 12, { size: narrow ? 10 : 11, weight: 700, align: 'center', maxWidth: bw - 6 });
        if (sub) stage.text(sub, X(i) + bw / 2, top + 26, { size: 9, align: 'center', color: c.muted, maxWidth: bw - 6 });
      };
      box(0, 'services', narrow ? '' : L.spike > 0 ? 'INCIDENT' : 'normal day', L.spike > 0 ? c.bad : null);
      box(1, 'agent', narrow ? `≥ ${s.level}` : `ships ${s.level} and up`);
      const wait = waiting(), full = s.buffer ? Math.max(5000, wait) : AGENT_BUF;
      box(2, s.buffer ? 'Kafka' : 'agent buffer', narrow ? '' : s.buffer ? 'durable, absorbs bursts' : 'small, in memory', !s.buffer && wait >= full * 0.98 ? c.bad : null);
      box(3, 'indexer', narrow ? '' : `${n(s.cap)} lines/s`);
      for (let i = 0; i < 3; i++) stage.arrow(X(i) + bw + 2, top + bh / 2, X(i + 1) - 2, top + bh / 2, { color: c.line2, width: 1, head: 5 });
      const qx = X(2) + 8, qw = bw - 16, qy = top + bh - 20;
      stage.rect(qx, qy, qw, 11, { fill: c.surface2, r: 3 });
      stage.rect(qx, qy, Math.max(0.5, qw * Math.min(1, wait / full)), 11, { fill: alpha(wait >= full * 0.98 ? c.bad : c.signal, 0.8), r: 3 });
      stage.text(wait < 1 ? 'empty' : `${n(wait)} waiting`, qx + qw / 2, qy + 6, { size: 9, weight: 600, align: 'center' });
      for (const d of st.dots) {
        const y = top + 30 + (bh - 50) * d.y, x0 = X(0) + bw * 0.6, x1 = d.keep ? X(3) + bw / 2 : X(1) + bw / 2;
        stage.dot(x0 + (x1 - x0) * d.t, y, d.lv === 'ERROR' ? 3 : 2, col[d.lv], d.keep ? 0.9 : 0.35 * (1 - d.t));
      }
      const sy = top + bh + 16, sh = narrow ? 42 : 46;
      stage.rect(14, sy, W - 28, sh, { fill: c.surface, stroke: c.wire, width: 1.3, r: 8 });
      stage.text('search: level:ERROR', 24, sy + sh / 2 - 8, { size: narrow ? 10 : 11, weight: 600, color: c.muted });
      const found = Math.round(L.indexed.ERROR), made = L.made.ERROR, missing = made - found;
      stage.text(`${n(found)} found${missing > 0 ? ` · ${n(Math.round(L.dropped.ERROR))} lost · ${n(Math.max(0, Math.round(missing - L.dropped.ERROR)))} not indexed yet` : ''}`, 24, sy + sh / 2 + 9,
        { size: narrow ? 11 : 13, weight: 700, color: missing > made * 0.05 ? c.bad : c.ok, maxWidth: W - 48 });
      const cy0 = sy + sh + 26, cy1 = H - 8;
      if (cy1 - cy0 < 26) return;
      const hist = L.hist.slice(-60), bwid = (W - 28) / 60;
      const max = Math.max(s.cap * 1.3, ...hist.map(x => x.in));
      stage.text(narrow ? 'arriving (bars) vs indexed (line)' : 'lines per second: arriving (bars) vs indexed (line) · dashed = capacity', 14, cy0 - 9, { size: 9, color: c.muted });
      hist.forEach((x, i) => { const hh = ((cy1 - cy0) * x.in) / max; stage.rect(14 + i * bwid, cy1 - hh, bwid - 1, hh, { fill: alpha(c.signal, 0.45), r: 0 }); });
      if (hist.length > 1) stage.path(hist.map((x, i) => [14 + i * bwid + bwid / 2, cy1 - ((cy1 - cy0) * x.out) / max]), { color: c.ok, width: 2 });
      const capY = cy1 - ((cy1 - cy0) * s.cap) / max;
      stage.line(14, capY, W - 14, capY, { color: c.muted, width: 1, dash: [4, 4] });
      void ctx;
    }

    kit.loop(dt => { fixed(dt, tick); paint(); draw(); });
    kit.every(1, () => {
      L.hist.push({ in: st.secIn, out: st.secOut }); if (L.hist.length > 90) L.hist.shift();
      chart.push({ in: st.secIn, out: st.secOut, lost: st.secLost });
      st.secIn = st.secOut = st.secLost = 0;
    });
    reset();

    return {
      reset,
      guidedRun() {
        level.set('INFO', true); s.level = 'INFO';
        buf.set('none', true); s.buffer = false;
        cap.set(800, true); s.cap = 800;
        reset();
        st.guided = true;
        unpause();
        incident();
      },
    };
  },
};
