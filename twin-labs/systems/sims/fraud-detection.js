// Fraud detection: 12 payments per second; a share of them are fraud. Four signals add points:
// new device (25), 5+ payments in 10 min (30), amount 5× usual (20), card country ≠ IP country (25),
// each firing with a different probability for honest and fraudulent payments, plus 0–19 points of
// noise. Score ≥ block → blocked; review ≤ score < block → manual review; else allowed.
// Fraud amounts are ₹2,000–₹10,000, honest ones ₹200–₹2,000. Statistics cover the last 2,000.

import { inr, pct, fixedStep, row, unpause, hide3dButton } from './_d-util.js';

const RATE = 12;
const SIGNALS = [
  { k: 'newDevice', label: 'new device', pts: 25, legit: 0.18, fraud: 0.55 },
  { k: 'velocity', label: '5+ payments in 10 min', pts: 30, legit: 0.08, fraud: 0.45 },
  { k: 'bigAmount', label: 'amount 5× usual', pts: 20, legit: 0.12, fraud: 0.45 },
  { k: 'geo', label: 'card country ≠ IP country', pts: 25, legit: 0.06, fraud: 0.35 },
];
const SCALE = 110; // score axis

function makePayment(fraudShare) {
  const fraud = Math.random() < fraudShare;
  const x = { fraud, amount: fraud ? 2000 + Math.floor(Math.random() * 8000) : 200 + Math.floor(Math.random() * 1800), hits: [] };
  for (const sg of SIGNALS) if (Math.random() < (fraud ? sg.fraud : sg.legit)) x.hits.push(sg);
  x.score = x.hits.reduce((a, sg) => a + sg.pts, 0) + Math.floor(Math.random() * 20);
  return x;
}
const decide = (x, th) => (x.score >= th.block ? 'block' : x.score >= th.review ? 'review' : 'allow');
function tally(list, th) {
  const r = { caught: 0, missed: 0, lostAmt: 0, goodBlocked: 0, reviewed: 0, fraud: 0, good: 0 };
  for (const x of list) {
    const d = decide(x, th);
    if (x.fraud) { r.fraud++; if (d === 'allow') { r.missed++; r.lostAmt += x.amount; } else r.caught++; }
    else { r.good++; if (d === 'block') r.goodBlocked++; }
    if (d === 'review') r.reviewed++;
  }
  return r;
}

export default {
  lead: 'Each payment gets a risk score built from simple signals: a new device, a burst of payments within minutes, an unusually large amount, a card issued in another country. High scores are blocked and middling ones wait for a person. Wherever the lines go, you trade fraud caught against honest customers turned away.',
  emptyLog: 'Scoring payments. Move a threshold to see the trade-off.',
  tryThis: [
    'Drop <b>Block at</b> to 30. Nearly all fraud is stopped, and so are lots of honest customers using a new phone.',
    'Push it up to 80. Customers are happy, but costly fraud gets through.',
    'Open a wider gap between <b>Review</b> and <b>Block</b>. Fewer automatic mistakes, but a person must check every payment in the gap, which costs time and money.',
  ],
  inShort: {
    what: 'Fraud detection gives every payment a risk score from signals such as device, velocity, amount and location, then allows, reviews or blocks it.',
    why: 'Fraud brings losses and chargebacks, but turning honest customers away costs sales and trust, so the decision has to be quick and adjustable.',
    tradeoff: 'No threshold is perfect: a lower line catches more fraud and refuses more honest people, and manual review in the middle costs staff time.',
    interview: 'Real-time scoring with rules plus a model fed from a feature store, allow/review/block thresholds tuned on chargeback data, and step-up checks such as a one-time code instead of hard blocks.',
  },
  quiz: [
    { q: 'You lower the block threshold. What changes?', o: ['Nothing', 'More fraud is caught, and more honest customers are refused too', 'Less fraud is caught', 'Reviews stop'], a: 1,
      why: 'Honest and fraudulent scores overlap, so any line trades false positives against missed fraud.' },
    { q: 'Why have a manual review band between "allow" and "block"?', o: ['To slow everything down', 'Unclear cases get a human decision instead of an automatic mistake in either direction', 'Rules are illegal', 'To save money'], a: 1,
      why: 'Reviewers take the grey zone, at the cost of time and staff; the width of the band decides how many cases they see.' },
    { q: 'Which of these is a classic fraud signal?', o: ['Paying with a saved card on your usual phone', 'Many payments within a few minutes from a new device', 'Paying in the daytime', 'A small amount'], a: 1,
      why: 'Velocity and unfamiliar devices are typical of a stolen card being tested and then used quickly.' },
  ],
  guided: {
    intro: 'Set an aggressive block line and measure who gets caught.',
    example: '“Run the guided example” clears the history and sets block at 30, review from 30 and 5% fraud.',
    question: 'What happens with the block line at 30?',
    predictions: ['Most fraud is blocked, but many honest customers are blocked too.', 'Only fraud is blocked.', 'Fewer fraud payments are blocked than at 55.'],
    correctPrediction: 0,
    running: 'Watch the red shaded block zone in the histogram swallow part of the green honest bars, and the two percentages below.',
    observation: 'With the line at 30 nearly all fraud was stopped, but a large share of honest payments was blocked as well.',
    explainQuestion: 'Why were honest customers blocked?',
    explanations: ['Honest and fraudulent scores overlap, so a low line cuts into the honest distribution.', 'The model is broken.', 'Honest customers paid too much.'],
    correctExplanation: 0,
    why: 'The threshold moves errors from one kind to the other; it cannot remove the overlap. Better signals separate the distributions.',
    retryHint: 'Look at where the green honest bars sit relative to the block line.',
    nextSlug: 'url-shortener',
    nextLabel: 'Next experiment: URL shortener →',
    waitSeconds: 8,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { block: 55, review: 35, rate: 0.05 };
    let st;
    const th = () => ({ block: s.block, review: Math.min(s.review, s.block) });

    kit.metrics([
      { key: 'caught', label: 'Fraud blocked or reviewed' }, { key: 'lost', label: 'Fraud let through (₹)' },
      { key: 'good', label: 'Honest customers blocked' }, { key: 'rev', label: 'Sent to manual review' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'caught', label: 'Fraud caught %', color: 'ok' }, { key: 'good', label: 'Honest blocked %', color: 'bad' }, { key: 'rev', label: 'Reviewed %', color: 'signal' }],
      format: v => `${Math.round(v)}%`, yMax: 100,
    });

    const p = kit.panel;
    const block = p.slider('Block at score', { min: 10, max: 100, step: 5, value: 55, format: v => String(v), onInput: v => { s.block = v; } });
    const review = p.slider('Review from score', { min: 0, max: 100, step: 5, value: 35, format: v => String(v), hint: 'Payments scoring between review and block wait for a person', onInput: v => { s.review = v; } });
    const rate = p.slider('Share of payments that are fraud', { min: 1, max: 20, step: 1, value: 5, format: v => `${v}%`, onInput: v => { s.rate = v / 100; } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    function reset() {
      st = { t: 0, acc: 0, pays: [], recent: [], win: [], lastTh: '', guided: false, guidedAt: 0 };
      kit.resetTime();
      chart.reset();
      kit.clearLog();
      paint();
    }

    function step(dt) {
      st.t += dt;
      st.acc += RATE * dt;
      while (st.acc >= 1) {
        st.acc -= 1;
        const x = makePayment(s.rate);
        st.pays.push(x); st.win.push(x);
        st.recent.unshift(x);
        if (st.recent.length > 8) st.recent.pop();
      }
      if (st.pays.length > 2000) st.pays.splice(0, st.pays.length - 2000);
    }

    function everySecond() {
      const t = th(), key = `${t.block}/${t.review}`;
      if (key !== st.lastTh && st.lastTh) {
        const r = tally(st.pays, t);
        kit.log(`Thresholds now block ≥ ${t.block}, review ≥ ${t.review}: on recent traffic that catches ${r.fraud ? pct(r.caught / r.fraud) : '–'} of fraud and blocks ${r.good ? pct(r.goodBlocked / r.good) : '–'} of honest payments`);
      }
      st.lastTh = key;
      if (Math.round(st.t) % 5 === 0 && st.win.length) {
        const r = tally(st.win, t);
        if (r.missed || r.goodBlocked) kit.log(`Last 5 s: ${r.missed} fraud payment${r.missed === 1 ? '' : 's'} let through (${inr(r.lostAmt)}), ${r.goodBlocked} honest customer${r.goodBlocked === 1 ? '' : 's'} blocked, ${r.reviewed} sent to review`);
        st.win = [];
      }
      if (st.guided && st.t - st.guidedAt >= 5) {
        st.guided = false;
        const r = tally(st.pays, t);
        kit.guided.observe(`With the line at 30, ${r.fraud ? pct(r.caught / r.fraud) : '–'} of fraud was stopped, but ${r.good ? pct(r.goodBlocked / r.good) : '–'} of honest payments (${r.goodBlocked} people) were blocked too.`);
      }
      const r = tally(st.pays, t);
      chart.push({ caught: r.fraud ? (100 * r.caught) / r.fraud : null, good: r.good ? (100 * r.goodBlocked) / r.good : null, rev: st.pays.length ? (100 * r.reviewed) / st.pays.length : null });
      paint();
    }

    function paint() {
      const r = tally(st.pays, th());
      kit.metric('caught', r.fraud ? pct(r.caught / r.fraud) : '–', r.fraud && r.caught / r.fraud < 0.8 ? 'bad' : 'good');
      kit.metric('lost', inr(r.lostAmt), r.lostAmt ? 'bad' : 'good');
      kit.metric('good', r.good ? pct(r.goodBlocked / r.good) : '–', r.good && r.goodBlocked / r.good > 0.05 ? 'bad' : 'good');
      kit.metric('rev', String(r.reviewed), r.reviewed > st.pays.length * 0.2 ? 'warn' : '');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h, small = W < 520, t = th();
      const x0 = 14, x1 = W - 14, base = H * 0.62, top = 24, X = v => x0 + ((x1 - x0) * v) / SCALE;
      const bins = 22, bw = (x1 - x0) / bins, honest = Array(bins).fill(0), fraud = Array(bins).fill(0);
      for (const x of st.pays) (x.fraud ? fraud : honest)[Math.min(bins - 1, Math.floor((x.score / SCALE) * bins))]++;
      const max = Math.max(1, ...honest, ...fraud.map(v => v * 4));
      const ctx = stage.ctx;
      ctx.save();
      ctx.globalAlpha = 0.08; ctx.fillStyle = c.signal; ctx.fillRect(X(t.review), top, X(t.block) - X(t.review), base - top);
      ctx.fillStyle = c.bad; ctx.fillRect(X(t.block), top, x1 - X(t.block), base - top);
      ctx.globalAlpha = 0.75;
      for (let i = 0; i < bins; i++) {
        const bx = x0 + i * bw, hh = ((base - top) * honest[i]) / max, fh = ((base - top) * fraud[i] * 4) / max;
        ctx.fillStyle = c.ok; ctx.fillRect(bx + 1, base - hh, bw / 2 - 1, hh);
        ctx.fillStyle = c.bad; ctx.fillRect(bx + bw / 2, base - fh, bw / 2 - 1, fh);
      }
      ctx.restore();
      stage.line(x0, base + 0.5, x1, base + 0.5, { color: c.line, width: 1 });
      const mark = (v, col, label) => {
        stage.line(X(v), top - 4, X(v), base, { color: col, width: 2, dash: [5, 4] });
        stage.text(label, X(v), top - 5, { size: 10, weight: 600, color: col, align: 'center', baseline: 'bottom' });
      };
      mark(t.review, c.signal, small ? `review ${t.review}` : `review from ${t.review}`);
      mark(t.block, c.bad, small ? `block ${t.block}` : `block at ${t.block}`);
      stage.text('honest', x0, base + 4, { size: 10, color: c.ok, baseline: 'top' });
      stage.text(small ? 'fraud (×4)' : 'fraud (bars ×4 so they show)', x0 + 48, base + 4, { size: 10, color: c.bad, baseline: 'top' });
      stage.text('risk score →', x1, base + 4, { size: 10, color: c.muted, align: 'right', baseline: 'top' });
      const ly = base + 22, rh = small ? 14 : 15;
      st.recent.slice(0, Math.max(1, Math.floor((H - ly - 4) / rh))).forEach((x, i) => {
        const d = decide(x, t);
        const left = `${inr(x.amount)}  score ${x.score}${small ? '' : '  ' + (x.hits.map(h => h.label).join(', ') || 'no signals')}`;
        row(stage, x0, ly + i * rh, x1 - x0, rh - 3, left, d + (x.fraud ? ' · fraud' : ''), { leftColor: x.fraud ? c.bad : c.ink, rightColor: d === 'block' ? c.bad : d === 'review' ? c.signal : c.ok });
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
        block.set(30, true); s.block = 30;
        review.set(30, true); s.review = 30;
        rate.set(5, true); s.rate = 0.05;
        reset();
        st.guided = true; st.guidedAt = 0; st.lastTh = '30/30';
        kit.log('Guided run: block at 30, review from 30, 5% fraud');
        unpause();
      },
    };
  },
};
