// Video upload: uploads → job queue → a pool of transcoding workers → published video.
// Model (time compressed: one simulated second stands for one minute of the real pipeline's
// arrival clock): uploads arrive at 4–30 per minute (rate/60 per simulated second), each 2–15
// minutes long. Every video becomes four renditions (240p, 480p, 720p, 1080p) costing 0.2, 0.4,
// 0.8 and 1.6 worker-seconds per minute of video. Split into 1-minute segments each (segment ×
// quality) is a separate job; kept whole a video is only four (long) jobs. Workers take jobs FIFO;
// with "240p is ready" the queue is ordered by quality first and a video goes live when all its
// 240p segments are done, otherwise when every rendition is done.

import { stepper, pct, unpause, alpha } from './_e-util.js';

const Q = ['240p', '480p', '720p', '1080p'];
const COST = [0.2, 0.4, 0.8, 1.6];

export default {
  lead: 'Each upload is converted into four qualities, from 240p for weak phones up to 1080p. That is heavy work, so a pool of transcoding workers does it. Cut a video into one-minute segments and many workers share it; keep it whole and one long 1080p job runs on a single worker. Publishing the low quality first lets people start watching sooner.',
  emptyLog: 'Uploads are arriving. Watch videos go live, or change how they are transcoded.',
  stageHeight: 420,
  tryThis: [
    'Pick <b>As one file</b>. Every video is now just four jobs, and one long 1080p job ties up a single worker while the video sits waiting.',
    'Back on segments, choose <b>240p is ready</b>. Videos go live within seconds and the sharper versions follow, much like on YouTube.',
    'Raise uploads to <b>30 a minute</b>. The queue keeps growing until you add workers: capacity has to keep up with the arrival rate.',
  ],
  inShort: {
    what: 'A video platform such as YouTube keeps the raw upload, cuts it into segments, transcodes each segment into several qualities on a worker pool, then publishes streaming playlists.',
    why: 'Transcoding is the most expensive step, and every viewer needs a quality that suits their screen and connection.',
    tradeoff: 'More workers shorten the wait but cost money while idle. Releasing low quality first is quick, but the first viewers get a blurry picture.',
    interview: 'Resumable uploads into object storage, a queue of per-segment transcode jobs on an autoscaled worker pool, HLS or DASH renditions pushed to the CDN, and a status service that switches the video to live.',
  },
  quiz: [
    { q: 'Why cut a video into short segments before transcoding it?', o: ['Smaller files on disk', 'Many workers can process the same video at once, so it is ready much sooner', 'It improves the picture', 'Browsers require it'], a: 1,
      why: 'A whole-file 1080p job occupies one worker; segments spread that same work across the pool.' },
    { q: 'What do you gain by publishing the 240p version first?', o: ['Nothing', 'Viewers can start watching within seconds while sharper versions finish', 'Less storage', 'Better audio'], a: 1,
      why: 'Low quality is the cheapest rendition; the player moves up to sharper ones once they exist.' },
    { q: 'Uploads arrive faster than the workers can transcode them. What happens?', o: ['Videos get shorter', 'The job queue grows without bound until workers are added', 'Quality improves', 'Uploads are rejected automatically'], a: 1,
      why: 'Throughput has to match the arrival rate or waiting time grows forever, which is why the pool autoscales on queue length.' },
  ],
  guided: {
    intro: 'Push uploads to the maximum with only six workers and watch the queue.',
    example: '“Run the guided example” resets to segments, all qualities before going live and 6 workers, then sets uploads to 30 a minute.',
    question: 'What happens to the job queue?',
    predictions: ['It keeps growing, and videos wait longer and longer to go live.', 'It stays small because segments are processed in parallel.', 'Uploads are refused once the workers are busy.'],
    correctPrediction: 0,
    running: 'Watch “Jobs waiting” and the queue counter above the workers, and how long the newest videos say they are waiting.',
    observation: 'The workers were busy all the time, yet the queue kept growing: 30 uploads a minute need more transcoding work than six workers can do.',
    explainQuestion: 'Why did the queue never shrink?',
    explanations: ['Work arrived faster than the pool could finish it, so the backlog grows until capacity is added.', 'Segments are slower to transcode than whole files.', 'The queue only empties when uploads stop completely by design.'],
    correctExplanation: 0,
    why: 'A queue only stays bounded when throughput is at least the arrival rate; scale the worker pool on queue length.',
    retryHint: 'Compare “Workers busy” with “Jobs waiting” over time.',
    nextSlug: 'netflix',
    nextLabel: 'Next experiment: video streaming →',
    waitSeconds: 20,
  },

  setup(kit) {
    const { stage } = kit;
    const fixed = stepper(0.05);
    const s = { split: true, early: false, workers: 6, rate: 12 / 60 };
    let T, st;

    kit.metrics([
      { key: 'live', label: 'Upload to watchable' }, { key: 'q', label: 'Jobs waiting' },
      { key: 'util', label: 'Workers busy' }, { key: 'done', label: 'Videos live' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'q', label: 'Jobs waiting', color: 'signal' }],
      bars: { key: 'live', label: 'Videos gone live', color: 'ok' },
      format: v => String(Math.round(v)),
    });

    const p = kit.panel;
    const split = p.seg('Transcode each video', { options: [['seg', 'In 1-minute segments'], ['whole', 'As one file']], value: 'seg',
      onChange: v => { s.split = v === 'seg'; rebuild(); kit.log(s.split ? 'Videos are now cut into 1-minute segments: one job per segment and quality' : 'Videos are now transcoded whole: four long jobs per video'); } });
    const early = p.seg('Go live when', { options: [['all', 'All qualities ready'], ['low', '240p is ready']], value: 'all',
      onChange: v => { s.early = v === 'low'; T.early = s.early; kit.log(s.early ? 'Videos go live once their 240p version exists; 240p jobs jump the queue' : 'Videos go live only when all four qualities are done'); } });
    const workers = p.slider('Transcoding workers', { min: 2, max: 16, step: 1, value: 6, format: v => String(v),
      onInput: v => { s.workers = v; setWorkers(v); } });
    const rate = p.slider('Uploads per minute', { min: 4, max: 30, step: 2, value: 12, format: v => String(v), hint: 'Each video is 2 to 15 minutes long',
      onInput: v => { s.rate = v / 60; T.rate = s.rate; } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    function model() {
      return { workers: Array.from({ length: s.workers }, () => null), split: s.split, early: s.early, rate: s.rate, now: 0, acc: 0, queue: [], videos: [], next: 1, busy: 0, time: 0 };
    }
    function upload() {
      const len = 2 + Math.floor(Math.random() * 14);
      const v = { id: T.next++, len, t: T.now, segs: T.split ? len : 1, cells: [], live: null, full: null };
      for (let seg = 0; seg < v.segs; seg++) for (let q = 0; q < 4; q++) {
        const job = { v, s: seg, q, state: 'wait', work: COST[q] * (len / v.segs), t: T.now, done: 0 };
        v.cells.push(job); T.queue.push(job);
      }
      T.videos.push(v);
    }
    function setWorkers(n) {
      while (T.workers.length < n) T.workers.push(null);
      while (T.workers.length > n) { const j = T.workers.pop(); if (j) { j.state = 'wait'; j.done = 0; T.queue.unshift(j); } }
    }
    const ready = (v, upTo) => v.cells.every(c => c.q > upTo || c.state === 'done');
    function tick(h) {
      T.now += h; T.time += h * T.workers.length; T.acc += T.rate * h;
      while (T.acc >= 1) { T.acc -= 1; upload(); }
      if (T.early) T.queue.sort((a, b) => a.q - b.q || a.t - b.t);
      T.workers.forEach((j, i) => {
        if (!j && T.queue.length) { j = T.queue.shift(); j.state = 'run'; j.done = 0; T.workers[i] = j; }
        if (!j) return;
        T.busy += h; j.done += h;
        if (j.done >= j.work) {
          j.state = 'done'; T.workers[i] = null;
          const v = j.v;
          if (v.live == null && ready(v, T.early ? 0 : 3)) {
            v.live = T.now; st.sec.live++;
            kit.log(T.early && !ready(v, 3) ? `Video ${v.id} (${v.len} min) is watchable in 240p after ${(v.live - v.t).toFixed(1)} s` : `Video ${v.id} (${v.len} min) went live after ${(v.live - v.t).toFixed(1)} s`);
          }
          if (v.full == null && ready(v, 3)) v.full = T.now;
        }
      });
      if (T.videos.length > 60) T.videos.splice(0, T.videos.length - 60);
      if (T.queue.length > 60 && !st.warned) { st.warned = true; kit.log(`More than 60 jobs are waiting: the ${T.workers.length} workers cannot keep up with ${Math.round(T.rate * 60)} uploads a minute`); }
      if (T.queue.length < 20) st.warned = false;
    }
    const avgLive = () => { const v = T.videos.filter(x => x.live != null); return v.length ? v.reduce((a, x) => a + x.live - x.t, 0) / v.length : 0; };
    const util = () => (T.time ? T.busy / T.time : 0);

    function rebuild() { T = model(); st.sec = { live: 0 }; }
    function reset() { st = { sec: { live: 0 }, warned: false, guided: null }; T = model(); kit.resetTime(); chart.reset(); kit.clearLog(); paint(); }

    function paint() {
      const n = T.videos.filter(v => v.live != null).length, a = avgLive(), u = util();
      kit.metric('live', n ? `${a.toFixed(1)} s` : '–', a > 20 ? 'bad' : a > 8 ? 'warn' : 'good');
      kit.metric('q', String(T.queue.length), T.queue.length > 60 ? 'bad' : T.queue.length > 20 ? 'warn' : 'good');
      kit.metric('util', pct(u), u > 0.95 ? 'warn' : '');
      kit.metric('done', String(n));
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h;
      const col = [c.teal, c.wire, c.violet, c.orange];
      const narrow = W < 520;
      const nW = T.workers.length, perRow = narrow ? Math.min(nW, 4) : Math.min(nW, 8), rowsW = Math.ceil(nW / perRow);
      const ww = (W - 28 - (perRow - 1) * 6) / perRow, wh = narrow ? 26 : 28, top = 20;
      stage.text('workers', 14, top - 9, { size: 10, color: c.muted });
      stage.text(`queue: ${T.queue.length} jobs`, W - 14, top - 9, { size: 10, color: T.queue.length > 60 ? c.bad : c.muted, align: 'right' });
      T.workers.forEach((j, i) => {
        const x = 14 + (i % perRow) * (ww + 6), y = top + Math.floor(i / perRow) * (wh + 5);
        stage.rect(x, y, ww, wh, { fill: c.surface, stroke: c.line, r: 5, width: 1 });
        if (!j) { stage.text('idle', x + ww / 2, y + wh / 2, { size: 9, align: 'center', color: c.muted }); return; }
        stage.rect(x + 1, y + 1, Math.max(1, (ww - 2) * Math.min(1, j.done / j.work)), wh - 2, { fill: alpha(col[j.q], 0.3), r: 4 });
        const segTxt = j.v.segs > 1 ? ` · min ${j.s + 1}` : '';
        stage.ctx.font = `600 9px ${stage.font}`;
        const label = [`video ${j.v.id}${segTxt} · ${Q[j.q]}`, `v${j.v.id}${segTxt} · ${Q[j.q]}`, `v${j.v.id} ${Q[j.q]}`, Q[j.q]].find(t => stage.ctx.measureText(t).width < ww - 8) || Q[j.q];
        stage.text(label, x + ww / 2, y + wh / 2, { size: 9, weight: 600, align: 'center' });
      });
      let y0 = top + rowsW * (wh + 5) + 8;
      let lx = 14;
      Q.forEach((q, i) => {
        stage.rect(lx, y0 + 2, 8, 8, { fill: col[i], r: 1 });
        stage.text(q, lx + 11, y0 + 6, { size: 9, color: c.muted });
        lx += stage.ctx.measureText(q).width + 22;
      });
      stage.text(narrow ? '· column = minute' : '· each column is one minute of video', lx, y0 + 6, { size: 9, color: c.muted });
      y0 += 18;
      const rh = narrow ? 30 : 32, rows = Math.max(1, Math.floor((H - y0 - 4) / rh));
      const lw = narrow ? 40 : 58, rw = narrow ? 78 : 120;
      T.videos.slice(-rows).reverse().forEach((v, i) => {
        const y = y0 + i * rh, gx = 14 + lw, gw = W - 28 - lw - rw, cw = Math.min(14, gw / 15), ch = (rh - 8) / 4;
        stage.text(`video ${v.id}`, 14, y + rh / 2 - 6, { size: 10, weight: 600 });
        stage.text(`${v.len} min`, 14, y + rh / 2 + 7, { size: 9, color: c.muted });
        for (const cell of v.cells) {
          const w = v.segs > 1 ? cw : cw * v.len;
          stage.ctx.save();
          stage.ctx.globalAlpha = cell.state === 'wait' ? 0.35 : 0.85;
          stage.ctx.fillStyle = cell.state === 'done' ? col[cell.q] : cell.state === 'run' ? c.signal : c.line;
          stage.ctx.fillRect(gx + cell.s * cw, y + 2 + cell.q * ch, w - 1, ch - 1);
          stage.ctx.restore();
        }
        const lt = v.live != null ? (v.live - v.t).toFixed(1) : null;
        if (v.full != null) stage.text(narrow ? `live ${lt} s` : `live after ${lt} s`, W - 14, y + rh / 2, { size: 10, weight: 600, align: 'right', color: c.ok });
        else if (v.live != null) stage.text(narrow ? `240p ${lt} s` : `live in 240p after ${lt} s`, W - 14, y + rh / 2, { size: 10, weight: 600, align: 'right', color: c.ok });
        else stage.text(`waiting ${(T.now - v.t).toFixed(0)} s`, W - 14, y + rh / 2, { size: 10, weight: 600, align: 'right', color: c.signal });
      });
    }

    kit.loop(dt => { fixed(dt, tick); paint(); draw(); });
    kit.every(1, () => {
      chart.push({ q: T.queue.length, live: st.sec.live });
      st.sec.live = 0;
      const g = st.guided;
      if (g && kit.time > 10 && T.queue.length > 60 && T.queue.length > g.last) {
        st.guided = null;
        kit.guided.observe(`After ${Math.round(kit.time)} s at 30 uploads a minute, ${T.queue.length} jobs were waiting and growing, with the six workers ${pct(util())} busy. The pool simply cannot finish work as fast as it arrives.`);
      } else if (g) g.last = Math.max(g.last, T.queue.length * 0.9);
    });
    st = { sec: { live: 0 } };
    reset();

    return {
      reset,
      guidedRun() {
        split.set('seg', true); s.split = true;
        early.set('all', true); s.early = false;
        workers.set(6, true); s.workers = 6;
        rate.set(30, true); s.rate = 30 / 60;
        reset();
        st.guided = { last: 0 };
        unpause();
      },
    };
  },
};
