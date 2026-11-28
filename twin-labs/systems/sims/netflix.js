// Video streaming with adaptive bitrate: the player downloads 4-second segments one at a time,
// choosing a quality for each, into a buffer of at most 30 s of video.
// Model: ladder 240p 0.4 · 480p 1 · 720p 2.5 · 1080p 5 · 4K 15 Mbps. A segment of quality q holds
// mbps(q) × 4 megabits and downloads at the current connection speed. Playback starts once 4 s
// are buffered and stalls whenever the buffer is empty. Rules: "Always 4K"; "By speed" picks the
// highest rung ≤ 80% of a smoothed throughput estimate (est = 0.6·est + 0.4·last segment);
// "By buffer" maps the buffer level to a rung (5 s → 240p … 25 s+ → 4K). "On a train": every 25 s
// there is a 7-second tunnel at 18% speed, plus ±15% wobble.

import { stepper, unpause, alpha as alphaC } from './_e-util.js';

const LADDER = [{ q: '240p', mbps: 0.4 }, { q: '480p', mbps: 1 }, { q: '720p', mbps: 2.5 }, { q: '1080p', mbps: 5 }, { q: '4K', mbps: 15 }];
const SEG = 4, MAXBUF = 30, START = 4, WINDOW = 60;

function speedAt(t, bw, bumpy) {
  if (!bumpy) return bw;
  const ph = t % 25;
  return bw * (ph > 14 && ph < 22 ? 0.18 : 1) * (0.85 + 0.3 * Math.abs(Math.sin(t * 1.7)));
}

export default {
  lead: 'A film is cut into 4-second segments, and every segment is stored in five qualities from 240p to 4K. The player keeps a buffer of video ahead of the picture and chooses a quality for each segment. Aim too high for the connection and the buffer runs dry, so the spinner appears; aim too low and the picture is soft for no reason.',
  emptyLog: 'Playback is starting. Change the quality rule or the network.',
  stageHeight: 420,
  tryThis: [
    'Pick <b>Always 4K</b> at 8 Mbps. Every 4-second segment needs 7.5 seconds to download, so playback keeps stopping.',
    'Return to <b>By speed</b> and choose <b>On a train</b>. It tracks the dips, but it reacts late and can still stall when speed falls off a cliff.',
    'Try <b>By buffer</b> on the train. A full buffer carries playback through the tunnels without a stall, in exchange for more quality switches.',
  ],
  inShort: {
    what: 'Adaptive bitrate streaming keeps every film in several qualities cut into short segments, and the player chooses one per segment as it plays.',
    why: 'Viewers have very different, constantly changing connections, and stalls drive people away far more than a slightly softer picture.',
    tradeoff: 'Higher quality looks better but risks stalls; switching often keeps playback smooth, but the picture visibly changes.',
    interview: 'HLS or DASH manifests with a bitrate ladder per title, segments served from a CDN (Netflix runs its own, Open Connect), and a hybrid ABR rule using both measured throughput and buffer level.',
  },
  quiz: [
    { q: 'Why does forcing 4K on an 8 Mbps connection keep pausing?', o: ['4K is broken', 'Each segment takes longer to download than to play, so the buffer drains', 'The CDN is slow', 'The film is too long'], a: 1,
      why: '15 Mbps of video over an 8 Mbps link means each 4 seconds of film needs 7.5 seconds to arrive.' },
    { q: 'What does the playback buffer protect against?', o: ['Viruses', 'Brief drops in network speed, by playing video that has already arrived', 'Low picture quality', 'High server costs'], a: 1,
      why: 'With 20–30 seconds buffered, a tunnel shorter than that passes without a stall.' },
    { q: 'What is the weakness of choosing quality from measured speed alone?', o: ['It never changes quality', 'It reacts only after speed has already fallen, so a sudden dip can still empty the buffer', 'It always picks 240p', 'It needs a GPU'], a: 1,
      why: 'Throughput estimates lag behind reality; buffer-based rules, and hybrids like the one Netflix uses, also watch how much video is left.' },
  ],
  guided: {
    intro: 'Force 4K on an 8 Mbps connection and watch the buffer.',
    example: '“Run the guided example” restarts playback with “Always 4K”, a steady network and 8 Mbps.',
    question: 'What will playback look like?',
    predictions: ['It starts late and then keeps stopping to buffer.', 'It plays smoothly in 4K once it has started.', 'The player quietly drops to 1080p.'],
    correctPrediction: 0,
    running: 'Watch the buffer bar and the screen. A red band on the speed chart marks time spent buffering.',
    observation: 'Each 4K segment took 7.5 s to download but held only 4 s of video, so the buffer emptied and playback stalled.',
    explainQuestion: 'Why did playback stall?',
    explanations: ['Segments arrived more slowly than they were played, so the buffer could never fill.', 'The server ran out of 4K segments.', 'The buffer is too small for 4K by design.'],
    correctExplanation: 0,
    why: 'Smooth playback needs the chosen bitrate below the real throughput; adaptive rules exist to keep it there as the network changes.',
    retryHint: 'Compare the 4K line (15 Mbps) with the white connection-speed line.',
    nextSlug: 'uber',
    nextLabel: 'Next experiment: ride hailing →',
    waitSeconds: 22,
  },

  setup(kit) {
    const { stage } = kit;
    const fixed = stepper(0.05);
    const s = { mode: 'throughput', bw: 8, bumpy: false };
    let P, st;

    kit.metrics([
      { key: 'q', label: 'Average quality' }, { key: 'stall', label: 'Time spent buffering' },
      { key: 'sw', label: 'Quality switches' }, { key: 'start', label: 'Start-up time' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'buf', label: 'Buffer (s of video)', color: 'wire' }],
      bars: { key: 'stall', label: 'Seconds stalled', color: 'bad' },
      format: v => `${v.toFixed(0)} s`,
    });

    const p = kit.panel;
    const mode = p.seg('How the player picks quality', { options: [['fixed', 'Always 4K'], ['throughput', 'By speed'], ['buffer', 'By buffer']], value: 'throughput',
      onChange: v => { s.mode = v; restart(); kit.log({ fixed: 'Restarted with every segment in 4K', throughput: 'Restarted: quality follows the measured download speed', buffer: 'Restarted: quality follows how full the buffer is' }[v]); } });
    const net = p.seg('Network', { options: [['steady', 'Steady'], ['bumpy', 'On a train']], value: 'steady',
      onChange: v => { s.bumpy = v === 'bumpy'; restart(); kit.log(s.bumpy ? 'Restarted on a train: a tunnel every 25 s cuts speed to a fifth' : 'Restarted on a steady connection'); } });
    const bw = p.slider('Connection speed', { min: 1, max: 25, step: 1, value: 8, format: v => `${v} Mbps`, hint: '240p 0.4 · 480p 1 · 720p 2.5 · 1080p 5 · 4K 15 Mbps',
      onInput: v => { s.bw = v; if (P) P.bw = v; } });
    p.buttons([{ label: 'Restart playback', kind: 'outline', onClick: () => { restart(); kit.log('Playback restarted'); } }]);

    function player() {
      return { mode: s.mode, bw: s.bw, bumpy: s.bumpy, now: 0, buf: 0, started: false, startAt: null, stall: 0, dl: null, est: null, segs: [], switches: 0, last: null, hist: [], sampleAt: 0, played: 0, qSum: 0, stalling: false };
    }
    function choose() {
      if (P.mode === 'fixed') return LADDER.length - 1;
      if (P.mode === 'buffer') return Math.max(0, Math.min(LADDER.length - 1, Math.floor((P.buf - 5) / (20 / (LADDER.length - 1))) + 1));
      const est = P.est ?? 1;
      let k = 0;
      LADDER.forEach((r, i) => { if (r.mbps <= est * 0.8) k = i; });
      return k;
    }
    const playingQ = () => (P.segs.length ? P.segs[Math.max(0, P.segs.length - Math.max(1, Math.ceil(P.buf / SEG)))] : null);
    function tick(h) {
      P.now += h;
      const sp = speedAt(P.now, P.bw, P.bumpy);
      if (!P.dl && P.buf + SEG <= MAXBUF) {
        const q = choose();
        if (P.last != null && q !== P.last) { P.switches++; kit.log(`Next segment ${q > P.last ? 'up' : 'down'} from ${LADDER[P.last].q} to ${LADDER[q].q}`); }
        P.last = q;
        P.dl = { q, left: LADDER[q].mbps * SEG, t0: P.now };
      }
      if (P.dl) {
        P.dl.left -= sp * h;
        if (P.dl.left <= 0) {
          const took = P.now - P.dl.t0, measured = (LADDER[P.dl.q].mbps * SEG) / Math.max(took, 0.05);
          P.est = P.est == null ? measured : P.est * 0.6 + measured * 0.4;
          P.buf += SEG; P.segs.push(P.dl.q); P.dl = null;
        }
      }
      if (!P.started && P.buf >= START) { P.started = true; P.startAt = P.now; kit.log(`Playback started after ${P.now.toFixed(1)} s`); }
      if (P.started) {
        if (P.buf > 0) {
          if (P.stalling) { P.stalling = false; kit.log(`Playback resumed after ${(P.now - P.stallFrom).toFixed(1)} s of buffering`); checkGuided(); }
          const t = Math.min(h, P.buf);
          P.qSum += t * (playingQ() ?? 0); P.buf -= t; P.played += t;
        } else {
          if (!P.stalling) { P.stalling = true; P.stallFrom = P.now; kit.log('Buffer empty: playback stopped to buffer'); }
          P.stall += h; st.secStall += h;
        }
      }
      if (P.now >= P.sampleAt) {
        P.sampleAt += 0.5;
        P.hist.push({ t: P.now, bw: sp, q: P.last ?? 0, stall: P.started && P.buf <= 0 });
        if (P.hist.length > 240) P.hist.shift();
      }
    }
    function checkGuided() {
      if (!st.guided) return;
      st.guided = null;
      kit.guided.observe(`Playback started only after ${P.startAt.toFixed(1)} s, then stopped for ${P.stall.toFixed(1)} s: each 4K segment needs 7.5 s at 8 Mbps but holds just 4 s of video, so the buffer emptied.`);
    }
    function restart() { P = player(); st.secStall = 0; chart.reset(); paint(); }
    function reset() { st = { secStall: 0, guided: null }; P = player(); kit.resetTime(); chart.reset(); kit.clearLog(); paint(); }

    function paint() {
      const a = P.played ? P.qSum / P.played : 0;
      kit.metric('q', P.played ? LADDER[Math.round(a)].q : '–', a >= 2.5 ? 'good' : a >= 1.5 ? 'warn' : 'bad');
      kit.metric('stall', `${P.stall.toFixed(1)} s`, P.stall > 1 ? 'bad' : 'good');
      kit.metric('sw', String(P.switches), P.switches > 10 ? 'warn' : '');
      kit.metric('start', P.startAt == null ? '…' : `${P.startAt.toFixed(1)} s`, P.startAt > 3 ? 'warn' : 'good');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h, ctx = stage.ctx;
      const col = [c.bad, c.signal, c.teal, c.wire, c.violet];
      const narrow = W < 520;
      const L = 34, R = W - 14, T0 = 18, B0 = H * 0.48;
      const tEnd = Math.max(WINDOW, P.now);
      const X = t => L + ((R - L) * (t - (tEnd - WINDOW))) / WINDOW;
      const yMax = Math.max(16, s.bw * 1.25);
      const Y = v => B0 - (B0 - T0) * Math.min(1, v / yMax);
      for (const hpt of P.hist) if (hpt.stall) stage.rect(X(hpt.t) - 2, T0, 4, B0 - T0, { fill: alphaC(c.bad, 0.15), r: 0 });
      let lastY = 1e9;
      LADDER.forEach((r, i) => {
        if (r.mbps > yMax) return;
        stage.line(L, Y(r.mbps) + 0.5, R, Y(r.mbps) + 0.5, { color: col[i], width: 1, dash: [2, 4], alpha: 0.35 });
        if (lastY - Y(r.mbps) >= 10) { stage.text(r.q, L - 3, Y(r.mbps), { size: 9, align: 'right', color: col[i] }); lastY = Y(r.mbps); }
      });
      const hs = P.hist;
      if (hs.length > 1) {
        stage.path(hs.map(x => [X(x.t), Y(x.bw)]), { color: c.ink, width: 1.5 });
        for (let i = 1; i < hs.length; i++) stage.line(X(hs[i - 1].t), Y(LADDER[hs[i - 1].q].mbps), X(hs[i].t), Y(LADDER[hs[i - 1].q].mbps), { color: col[hs[i - 1].q], width: 3 });
      }
      stage.text(narrow ? 'thin = speed · thick = quality' : 'thin line = connection speed · thick line = quality being downloaded · red = buffering', L, 8, { size: 10, color: c.muted });

      // buffer bar
      const by = B0 + 28, bh = 18, BX = t => L + ((R - L) * t) / MAXBUF;
      stage.text(`buffer: ${P.buf.toFixed(1)} s of video ahead`, L, by - 9, { size: 10, color: c.muted });
      stage.text(`max ${MAXBUF} s`, R, by - 9, { size: 10, color: c.muted, align: 'right' });
      stage.rect(L, by, R - L, bh, { fill: c.surface, stroke: c.line, r: 4, width: 1 });
      const n = Math.ceil(P.buf / SEG), inBuf = P.segs.slice(P.segs.length - n);
      let acc = 0;
      inBuf.forEach((q, i) => {
        const len = i === 0 ? P.buf - (n - 1) * SEG : SEG;
        stage.rect(BX(acc) + 1, by + 2, Math.max(1, BX(acc + len) - BX(acc) - 2), bh - 4, { fill: alphaC(col[q], 0.8), r: 1 });
        acc += len;
      });
      if (P.dl) {
        const k = 1 - P.dl.left / (LADDER[P.dl.q].mbps * SEG);
        stage.rect(BX(acc) + 1, by + 2, Math.max(1, (BX(acc + SEG) - BX(acc)) * Math.max(0, k) - 2), bh - 4, { fill: alphaC(col[P.dl.q], 0.3), r: 1 });
      }

      // the screen
      const sy = by + bh + 14, sh = Math.max(30, H - sy - 10), sw = Math.min(R - L, (sh * 16) / 9), sx = (W - sw) / 2;
      stage.rect(sx, sy, sw, sh, { fill: '#05070c', r: 8 });
      const q = playingQ();
      if (!P.started || (P.started && P.buf <= 0)) {
        ctx.save(); ctx.strokeStyle = c.bad; ctx.lineWidth = 3;
        const a = P.now * 5;
        ctx.beginPath(); ctx.arc(W / 2, sy + sh / 2 - 6, 10, a, a + Math.PI * 1.4); ctx.stroke(); ctx.restore();
        stage.text(P.started ? 'buffering…' : 'starting…', W / 2, sy + sh / 2 + 16, { size: 10, weight: 600, align: 'center', color: '#e8ecf3' });
      } else {
        stage.text(LADDER[q].q, W / 2, sy + sh / 2 - (sh >= 56 ? 4 : 0), { size: Math.min(28, sh * 0.35), weight: 700, align: 'center', color: col[q] });
        if (sh >= 56) stage.text('playing', W / 2, sy + sh - 10, { size: 9, align: 'center', color: '#e8ecf3' });
      }
    }

    kit.loop(dt => { fixed(dt, tick); paint(); draw(); });
    kit.every(1, () => { chart.push({ buf: P.buf, stall: st.secStall }); st.secStall = 0; });
    st = { secStall: 0 };
    reset();

    return {
      reset,
      guidedRun() {
        mode.set('fixed', true); s.mode = 'fixed';
        net.set('steady', true); s.bumpy = false;
        bw.set(8, true); s.bw = 8;
        reset();
        st.guided = true;
        unpause();
      },
    };
  },
};

