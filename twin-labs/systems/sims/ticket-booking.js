// Ticket booking: an 8 × 14 seat map, buyers arriving at 0.5–5 per second.
// Model: each buyer picks a seat they see as free, weighted towards the centre near the stage
// (exp(-10·d²)). Paying takes 2–10 s and a quarter of buyers close the tab. "No lock": the seat is
// sold when payment finishes, even if it was already sold (sold twice). "Check at payment": the
// seat is re-checked when payment finishes; if it was sold meanwhile the buyer is refunded. "Hold the
// seat": picking places a hold for 3–30 s that hides the seat from others; payment succeeds only if
// the hold is still the buyer's, otherwise it counts as a refund when someone else got the seat.
// When every seat is sold, the next show starts 3 s later.

import { stepper, unpause, alpha, fit } from './_e-util.js';

const ROWS = 8, COLS = 14;

export default {
  lead: 'Hundreds of fans click the same good seats within seconds, and paying takes a while. If the system only asks “is it free?” when you pick, two people can end up paying for one seat. Checking again at payment prevents that, but someone has already paid and must be refunded. Holding the seat for a few minutes while you pay is how big ticketing sites handle it.',
  emptyLog: 'Fans are picking seats. Change how seats are protected.',
  stageHeight: 380,
  tryThis: [
    'Pick <b>No lock</b>. Popular centre seats turn red: two fans paid for the same seat, and one of them is in for a nasty surprise at the door.',
    '<b>Check at payment</b> never sells a seat twice, but some buyers lose the seat after paying and have to be refunded.',
    'With <b>Hold the seat</b>, set the hold to 3 s. Slow payers lose it halfway through paying. At 30 s, seats of people who left stay blocked for a long time.',
  ],
  inShort: {
    what: 'A booking system lets many people race for specific seats and holds a chosen seat briefly while the buyer pays.',
    why: 'Popular shows get thousands of clicks on the same seats in seconds, and selling one seat twice is not acceptable.',
    tradeoff: 'Short holds free seats quickly but cut off slow payers; long holds are kind to payers but keep seats blocked for people who have left.',
    interview: 'The hold is an atomic conditional write with an expiry (Redis SET NX with a TTL, or UPDATE … WHERE status = free), payment happens inside the hold, then a final conditional booking; huge on-sales get a queue in front.',
  },
  quiz: [
    { q: 'How can the same seat be sold twice?', o: ['It cannot happen', 'Two buyers both see it free, both pay, and both writes succeed because nothing locked the seat', 'The venue is too big', 'A refund failed'], a: 1,
      why: 'Check-then-act without a lock or a conditional write is a race condition.' },
    { q: 'What does a timed seat hold give buyers?', o: ['A discount', 'The seat is reserved while they pay, nobody else can take it, and it frees itself if they leave', 'Faster payment', 'A second seat'], a: 1,
      why: 'The hold is an atomic lock that expires on its own (for example Redis SET NX with a TTL, or a row with an expiry time).' },
    { q: 'What goes wrong with a very short hold?', o: ['Nothing', 'Slow payers lose the seat mid-payment and may need a refund', 'Seats stay blocked too long', 'Seats are sold twice'], a: 1,
      why: 'Too short punishes real buyers and too long blocks seats of people who left; typical holds are 5 to 10 minutes.' },
  ],
  guided: {
    intro: 'Remove all protection and let a busy crowd buy seats.',
    example: '“Run the guided example” starts a new show with “No lock” and 5 buyers per second.',
    question: 'What will happen to the most popular seats?',
    predictions: ['Some get sold to two buyers at once.', 'Each seat is still sold exactly once.', 'Nobody can buy, because the seats are locked.'],
    correctPrediction: 0,
    running: 'Watch the centre seats near the stage: a number on a seat means several people are paying for it, and red means it was sold twice.',
    observation: 'Two buyers saw the same seat free, both paid, and both purchases went through: the seat was sold twice.',
    explainQuestion: 'Why was the seat sold twice?',
    explanations: ['Checking “is it free?” and booking it were separate steps, and nothing stopped a second buyer in between.', 'The payment provider charged twice.', 'The seat map showed the wrong colours.'],
    correctExplanation: 0,
    why: 'Only an atomic step (a hold or a conditional write) closes the gap between checking and booking.',
    retryHint: 'Look for a seat with a number on it in the seat map, then the “sold twice” event.',
    nextSlug: 'logging-system',
    nextLabel: 'Next experiment: logging system →',
    waitSeconds: 20,
  },

  setup(kit) {
    const { stage } = kit;
    const fixed = stepper(0.05);
    const s = { mode: 'hold', ttl: 10, rate: 1.5 };
    let V, st;

    kit.metrics([
      { key: 'sold', label: 'Seats sold' }, { key: 'double', label: 'Sold twice' },
      { key: 'refund', label: 'Paid, then refunded' }, { key: 'held', label: 'Seats on hold now' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'held', label: 'Seats on hold', color: 'signal' }, { key: 'paying', label: 'Buyers paying', color: 'wire' }],
      bars: { key: 'bad', label: 'Sold twice or refunded', color: 'bad' },
      format: v => String(Math.round(v)),
    });

    const p = kit.panel;
    const mode = p.seg('Protecting the seat', { options: [['none', 'No lock'], ['check', 'Check at payment'], ['hold', 'Hold the seat']], value: 'hold',
      onChange: v => { s.mode = v; rebuild(); kit.log({ none: 'New show, no protection: seats are booked blindly when payment finishes', check: 'New show: the seat is checked again when payment finishes', hold: `New show: picking a seat holds it for ${s.ttl} s` }[v]); } });
    const ttl = p.slider('Hold lasts', { min: 3, max: 30, step: 1, value: 10, format: v => `${v} s`, hint: 'Paying takes 2 to 10 s; a quarter of buyers close the tab', onInput: v => { s.ttl = v; if (V) V.ttl = v; } });
    const rate = p.slider('Buyers per second', { min: 0.5, max: 5, step: 0.5, value: 1.5, format: v => String(v), onInput: v => { s.rate = v; if (V) V.rate = v; } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    function freshSeats() { return Array.from({ length: ROWS * COLS }, (_, i) => ({ i, r: Math.floor(i / COLS), c: i % COLS, booked: 0, hold: null })); }
    function model() { return { mode: s.mode, ttl: s.ttl, rate: s.rate, now: 0, acc: 0, seats: freshSeats(), paying: [], n: { sold: 0, double: 0, refund: 0, gaveUp: 0, expired: 0 }, list: [], shows: 1, soldOutAt: null }; }
    const looksFree = x => !x.booked && (V.mode !== 'hold' || !x.hold || x.hold.until < V.now);
    const appeal = x => { const dr = (x.r - ROWS * 0.35) / ROWS, dc = (x.c - (COLS - 1) / 2) / COLS; return Math.exp(-(dr * dr + dc * dc) * 10); };
    const name = x => `row ${String.fromCharCode(65 + x.r)} seat ${x.c + 1}`;
    function note(text, kind, toLog) {
      V.list.unshift({ text, kind }); if (V.list.length > 10) V.list.pop();
      if (toLog) kit.log(text);
    }
    function arrive() {
      const free = V.seats.filter(looksFree);
      if (!free.length) return;
      const sum = free.reduce((a, x) => a + appeal(x), 0);
      let r = Math.random() * sum, seat = free[0];
      for (const x of free) { r -= appeal(x); if (r <= 0) { seat = x; break; } }
      const b = { seat, t: V.now, end: V.now + 2 + Math.random() * 8, quit: Math.random() < 0.25, id: Math.floor(Math.random() * 1e9) };
      if (V.mode === 'hold') seat.hold = { until: V.now + V.ttl, by: b.id };
      V.paying.push(b);
    }
    function finish(b) {
      const seat = b.seat, nm = name(seat);
      if (b.quit) { V.n.gaveUp++; note(`${nm}: buyer closed the tab${V.mode === 'hold' && seat.hold && seat.hold.by === b.id ? '; the seat stays held until its timer runs out' : ''}`, 'muted'); return; }
      if (V.mode === 'none') {
        if (seat.booked) {
          seat.booked++; V.n.double++; st.secBad++;
          note(`${nm}: sold a second time!`, 'bad', true);
          if (st.guided) { st.guided = false; kit.guided.observe(`${nm} was picked by two buyers who both saw it free; both paid, so it was sold twice.`); }
        } else { seat.booked = 1; V.n.sold++; note(`${nm}: sold`, 'ok'); }
        return;
      }
      if (V.mode === 'hold' && !(seat.hold && seat.hold.by === b.id && seat.hold.until >= V.now)) {
        V.n.expired++;
        if (seat.booked || (seat.hold && seat.hold.by !== b.id && seat.hold.until >= V.now)) { V.n.refund++; st.secBad++; note(`${nm}: the hold expired mid-payment and someone else took the seat, refund`, 'bad', true); return; }
      }
      if (seat.booked) { V.n.refund++; st.secBad++; note(`${nm}: paid, but the seat was already sold, refund`, 'bad', true); return; }
      seat.booked = 1; seat.hold = null; V.n.sold++; note(`${nm}: sold`, 'ok');
    }
    function tick(h) {
      V.now += h;
      if (V.soldOutAt != null) {
        if (V.now - V.soldOutAt > 3) { V.seats = freshSeats(); V.paying = []; V.soldOutAt = null; V.shows++; kit.log(`Show ${V.shows} goes on sale`); }
        return;
      }
      V.acc += V.rate * h;
      while (V.acc >= 1) { V.acc -= 1; arrive(); }
      V.paying = V.paying.filter(b => (V.now >= b.end ? (finish(b), false) : true));
      for (const x of V.seats) if (x.hold && x.hold.until < V.now && !V.paying.some(b => b.id === x.hold.by)) x.hold = null;
      if (V.seats.every(x => x.booked)) { V.soldOutAt = V.now; note('Sold out; the next show opens in 3 s', 'ok', true); }
    }
    const held = () => V.seats.filter(x => !x.booked && x.hold && x.hold.until >= V.now).length;
    function rebuild() { V = model(); paint(); }
    function reset() { st = { secBad: 0, guided: false }; V = model(); kit.resetTime(); chart.reset(); kit.clearLog(); paint(); }
    function paint() {
      kit.metric('sold', String(V.n.sold), 'good');
      kit.metric('double', String(V.n.double), V.n.double ? 'bad' : 'good');
      kit.metric('refund', String(V.n.refund), V.n.refund ? 'bad' : 'good');
      const hd = held();
      kit.metric('held', V.mode === 'hold' ? String(hd) : '–', hd > 10 ? 'warn' : '');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h;
      const narrow = W < 520, mapW = narrow ? W - 28 : W * 0.56, gap = narrow ? 3 : 4;
      const sz = Math.max(4, Math.min((mapW - (COLS - 1) * gap) / COLS, (H - (narrow ? 96 : 56) - (ROWS - 1) * gap) / ROWS));
      const gw = COLS * sz + (COLS - 1) * gap, ox = narrow ? (W - gw) / 2 : 14, oy = 36;
      stage.rect(ox + gw * 0.15, 14, gw * 0.7, 6, { fill: alpha(c.muted, 0.5), r: 3 });
      stage.text('STAGE', ox + gw / 2, 27, { size: 9, align: 'center', color: c.muted });
      const payers = new Map();
      for (const b of V.paying) payers.set(b.seat.i, (payers.get(b.seat.i) || 0) + 1);
      for (const x of V.seats) {
        const sx = ox + x.c * (sz + gap), sy = oy + x.r * (sz + gap);
        const isHeld = V.mode === 'hold' && !x.booked && x.hold && x.hold.until >= V.now;
        const n = payers.get(x.i) || 0;
        const fill = x.booked > 1 ? c.bad : x.booked ? c.ok : isHeld ? c.signal : c.surface;
        stage.rect(sx, sy, sz, sz, { fill: x.booked || isHeld ? alpha(fill, 0.85) : fill, stroke: c.line, width: 1, r: Math.min(4, sz / 4) });
        if (isHeld) { const left = Math.max(0, (x.hold.until - V.now) / V.ttl); stage.rect(sx + 1, sy + sz - 3, (sz - 2) * (1 - left), 2, { fill: alpha(c.surface, 0.6), r: 0 }); }
        if ((n && !x.booked && V.mode !== 'hold') || n > 1) {
          stage.rect(sx + 1, sy + 1, sz - 2, sz - 2, { stroke: n > 1 ? c.bad : c.wire, width: 2, r: 3 });
          if (n > 1 && sz > 12) stage.text(String(n), sx + sz / 2, sy + sz / 2 + 1, { size: Math.min(11, sz * 0.55), weight: 700, align: 'center', color: c.bad });
        }
      }
      const ly = oy + ROWS * (sz + gap) + 8;
      let lx = ox;
      for (const [col, label] of [[c.surface, 'free'], [c.signal, 'held'], [c.wire, 'someone paying'], [c.ok, 'sold'], [c.bad, 'sold twice']]) {
        if (label === 'held' && V.mode !== 'hold') continue;
        stage.rect(lx, ly, 8, 8, { fill: col, stroke: c.line, width: 1, r: 1 });
        stage.text(label, lx + 11, ly + 4, { size: 9, color: c.muted });
        lx += stage.ctx.measureText(label).width + 22;
      }
      if (V.soldOutAt != null) stage.text('SOLD OUT', ox + gw / 2, oy + (ROWS * (sz + gap)) / 2, { size: 13, weight: 700, align: 'center', color: c.ok });
      const tx = narrow ? 14 : ox + gw + 18, ty = narrow ? ly + 18 : oy, tw = W - 14 - tx, rh = narrow ? 14 : 16;
      const rows = Math.max(0, Math.floor((H - ty - 6) / rh));
      V.list.slice(0, rows).forEach((e, i) => {
        const y = ty + i * rh;
        stage.rect(tx, y, tw, rh - 3, { fill: c.surface, r: 4 });
        stage.ctx.font = `500 ${narrow ? 9 : 10}px ${stage.font}`;
        stage.text(fit(stage, e.text, tw - 10), tx + 5, y + (rh - 3) / 2, { size: narrow ? 9 : 10, color: c[e.kind] });
      });
    }

    kit.loop(dt => { fixed(dt, tick); paint(); draw(); });
    kit.every(1, () => { chart.push({ held: V.mode === 'hold' ? held() : null, paying: V.paying.length, bad: st.secBad }); st.secBad = 0; });
    reset();

    return {
      reset,
      guidedRun() {
        mode.set('none', true); s.mode = 'none';
        rate.set(5, true); s.rate = 5;
        reset();
        st.guided = true;
        unpause();
      },
    };
  },
};
