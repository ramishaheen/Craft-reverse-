// Autoscaling: a fleet of servers (50 req/s each) follows traffic by target-tracking on CPU.
// Model: CPU = traffic ÷ ready capacity. Once a second the autoscaler averages CPU over the last 3 s
// and wants ceil(ready × CPU ÷ target) servers (between 2 and 30). It adds servers at once (each ready
// after `boot` seconds) and removes them only if `cooldown` seconds passed since the last change.
// Traffic beyond ready capacity is dropped; latency = 40 ms ÷ (1 − CPU), CPU capped at 95%. Traffic
// patterns (±8% noise): steady 300/s; a wave 300 ± 220 with a 2-minute period; a spike to 900/s from
// t = 20 s to 80 s over a 250/s base. The run restarts after 4 simulated minutes.

import { fixedStep, fitText, tile, unpause } from './_c-util.js';

const PER = 50;
const WINDOW = 3;
const PATTERNS = {
  steady: () => 300,
  wave: t => 300 + 220 * Math.sin((t / 60) * Math.PI * 2 / 2),
  spike: t => (t >= 20 && t < 80 ? 900 : 250),
};

function makeFleet({ pattern = 'spike', auto = true, target = 0.6, boot = 10, cooldown = 20, min = 2, max = 30, start = 6, noise = 0.08, t0 = 0 } = {}) {
  const S = { pattern, auto, target, boot, cooldown, min, max, noise, now: t0, acc: 0, servers: [], load: 0, util: 0, served: 0, dropped: 0, cost: 0, lastScale: -1e9, samples: [], hist: [], sec: { t: t0, load: 0, cap: 0, k: 0 }, lat: 0, latSum: 0, latN: 0, log: [] };
  for (let i = 0; i < start; i++) S.servers.push({ ready: 0 });
  S.up = () => S.servers.filter(x => x.ready <= S.now).length;
  S.count = () => S.servers.length;
  S.booting = () => S.servers.length - S.up();
  S.avgLat = () => (S.latN ? S.latSum / S.latN : 0);
  function scaleTo(n, why) {
    const cur = S.count();
    n = Math.max(S.min, Math.min(S.max, n));
    if (n === cur) return;
    if (n > cur) for (let i = cur; i < n; i++) S.servers.push({ ready: S.now + S.boot });
    else { S.servers.sort((a, b) => b.ready - a.ready); S.servers.splice(0, cur - n); }
    S.lastScale = S.now;
    S.log.push({ t: S.now, from: cur, to: n, why });
  }
  function decide() {
    const win = S.samples.filter(x => x.t > S.now - WINDOW);
    if (!win.length) return;
    const cpu = win.reduce((a, x) => a + x.u, 0) / win.length;
    const want = Math.ceil(Math.max(1, S.up()) * cpu / S.target - 1e-9);
    if (want > S.count()) scaleTo(want, 'up');
    else if (want < S.count() && S.now >= S.lastScale + S.cooldown) scaleTo(want, 'down');
  }
  S.tick = dt => {
    S.now += dt;
    S.load = PATTERNS[S.pattern](S.now) * (1 + S.noise * (Math.random() * 2 - 1));
    const cap = S.up() * PER, served = Math.min(S.load, cap), drop = S.load - served;
    S.util = cap ? S.load / cap : 9;
    S.served += served * dt; S.dropped += drop * dt; S.cost += S.count() * dt;
    S.lat = Math.round(40 / (1 - Math.min(S.util, 0.95)));
    S.latSum += S.lat * dt; S.latN += dt;
    S.samples.push({ t: S.now, u: Math.min(S.util, 2) });
    S.samples = S.samples.filter(x => x.t > S.now - WINDOW);
    S.acc += dt;
    if (S.auto && S.acc >= 1) { S.acc -= 1; decide(); }
    const sc = S.sec;
    sc.load += S.load; sc.cap += cap; sc.k++;
    if (S.now - sc.t >= 1) {
      S.hist.push({ t: sc.t, load: sc.load / sc.k, cap: sc.cap / sc.k });
      if (S.hist.length > 120) S.hist.shift();
      S.sec = { t: S.now, load: 0, cap: 0, k: 0 };
    }
  };
  S.dropShare = () => { const tot = S.served + S.dropped; return tot ? S.dropped / tot : 0; };
  return S;
}

export default {
  lead: `Each server handles ${PER} requests a second. Traffic changes through the day and sometimes leaps all at once. An autoscaler watches CPU and adds or removes servers to hold it near a target. New servers need time to boot, though, so a sudden spike still hurts. Tune the target, the boot time and the cooldown, and weigh dropped requests against cost.`,
  emptyLog: 'Nothing yet. Watch the traffic.',
  tryThis: [
    'With <b>Sudden spike</b>, switch the autoscaler off. A fixed fleet drops most of the spike.',
    'Switch it back on and set the boot time to 30 s, then to 2 s. Most dropped requests come from the boot delay.',
    'Set the target to 30%, then 90%. The low target costs more but leaves room for the spike while new servers boot.',
    'Choose <b>Daily wave</b> and set the cooldown to 0. The fleet keeps going up and down (flapping).',
  ],
  inShort: {
    what: 'Autoscaling adds servers when a metric such as CPU is above a target and removes them when it drops, so capacity tracks traffic.',
    why: 'Paying for peak capacity all day is wasteful, yet too few servers drop requests. Autoscaling keeps both in check.',
    tradeoff: 'A low CPU target keeps headroom for spikes while new servers boot, but costs more. Cooldowns prevent flapping but slow down scale-in.',
    interview: 'Target tracking around 60% CPU, quick scale-out, slow scale-in behind a cooldown, and warm pools or scheduled scaling for peaks you can predict.',
  },
  quiz: [
    { q: 'Traffic triples in one second. Why are requests still dropped with autoscaling on?', o: ['The autoscaler is off', 'New servers need time to boot before they can serve', 'Autoscaling only scales in', 'CPU is not measured'], a: 1,
      why: 'Scaling reacts to a metric and new capacity has a boot time. Headroom, warm pools or scheduled scaling bridge the gap.' },
    { q: 'What does a lower CPU target (say 40% rather than 80%) buy you?', o: ['Lower cost', 'More spare capacity to soak up spikes while new servers boot', 'Faster boots', 'Fewer servers'], a: 1,
      why: 'You pay for idle headroom so latency holds and nothing is dropped during the scale-out delay.' },
    { q: 'Why have a scale-in cooldown?', o: ['To save logs', 'To stop the fleet flapping up and down on noisy traffic', 'To slow scale-out', 'The law requires it'], a: 1,
      why: 'Without one, every dip removes servers that the next bump needs again, wasting boots and risking drops.' },
  ],
  guided: {
    intro: 'Hit the autoscaled fleet with a sudden traffic spike and watch the gap before new servers are ready.',
    example: '“Run the guided example” picks Sudden spike, turns the autoscaler on with a 60% target, 10 s boot time and 20 s cooldown, and starts 5 s before the spike.',
    question: 'What happens when traffic jumps to 900 requests a second?',
    predictions: ['Requests are dropped until the new servers finish booting.', 'Nothing is dropped, because the autoscaler reacts instantly.', 'The autoscaler removes servers to save money.'],
    correctPrediction: 0,
    running: 'Watch the red band between the traffic and capacity lines, and the dashed (booting) servers below.',
    observation: 'The autoscaler added servers within a second, but they needed their boot time before serving; meanwhile requests above capacity were dropped.',
    explainQuestion: 'Why were requests dropped even though autoscaling was on?',
    explanations: ['New servers only add capacity after booting, so traffic above the old capacity was dropped during the boot delay.', 'The target CPU was too high to scale at all.', 'The cooldown stopped the scale-out.'],
    correctExplanation: 0,
    why: 'Scale-out is always late by the measurement window plus the boot time. Keep headroom (a lower target) or warm capacity for spikes.',
    retryHint: 'Compare when the spike starts with when the dashed servers turn solid.',
    nextSlug: 'deployment-strategies',
    nextLabel: 'Next experiment: deployment strategies →',
    waitSeconds: 22,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { pattern: 'spike', auto: true, target: 0.6, boot: 10, cooldown: 20 };
    const clock = fixedStep();
    let S, dropWarn = false, everDropped = false;

    kit.metrics([
      { key: 'drop', label: 'Requests dropped' }, { key: 'lat', label: 'Average latency' },
      { key: 'n', label: 'Servers now' }, { key: 'cost', label: 'Cost (server-minutes)' },
    ]);
    const p = kit.panel;
    p.buttons([{ label: 'Start over', kind: 'outline', onClick: () => reset() }]);
    const pattern = p.seg('Traffic', { options: [['spike', 'Sudden spike'], ['wave', 'Daily wave'], ['steady', 'Steady']], value: 'spike', onChange: v => { s.pattern = v; reset(); } });
    const auto = p.toggle('Autoscaler on', { value: true, onChange: v => { s.auto = v; S.auto = v; kit.log(v ? 'Autoscaler on' : 'Autoscaler off: the fleet stays at its current size'); } });
    const target = p.slider('Target CPU', { min: 30, max: 90, step: 10, value: 60, format: v => `${v}%`, hint: 'Lower = more spare servers, higher = fewer servers but less headroom.', onInput: v => { s.target = v / 100; S.target = s.target; } });
    const boot = p.slider('Server boot time', { min: 2, max: 30, step: 1, value: 10, format: v => `${v} s`, hint: 'A VM takes about a minute; a container on a warm node takes seconds.', onInput: v => { s.boot = v; S.boot = v; } });
    const cool = p.slider('Scale-in cooldown', { min: 0, max: 60, step: 5, value: 20, format: v => `${v} s`, hint: 'Wait this long after any change before removing servers.', onInput: v => { s.cooldown = v; S.cooldown = v; } });

    function reset(t0 = 0) {
      S = makeFleet({ ...s, t0 });
      dropWarn = false; everDropped = false;
      clock.reset();
      kit.resetTime();
      kit.clearLog();
      paint();
    }
    function step(dt) {
      S.tick(dt);
      for (const e of S.log.splice(0)) {
        kit.log(e.why === 'up' ? `CPU above ${Math.round(S.target * 100)}%: scaling out ${e.from} → ${e.to} servers (ready in ${S.boot} s).` : `Traffic fell: scaling in ${e.from} → ${e.to} servers.`);
      }
      const over = S.load > S.up() * PER;
      if (over && !dropWarn) { kit.log(`Traffic ${Math.round(S.load)}/s is above capacity ${S.up() * PER}/s: requests dropped.`); everDropped = true; }
      if (!over && dropWarn && everDropped) {
        kit.log(`Capacity caught up (${S.up()} servers ready). ${(S.dropShare() * 100).toFixed(1)}% of requests so far were dropped.`);
        kit.guided.observe(`The autoscaler asked for more servers within a second of the spike, but they needed ${S.boot} s to boot. Until they were ready, traffic above capacity was dropped (${(S.dropShare() * 100).toFixed(1)}% of all requests so far).`);
      }
      dropWarn = over;
      if (S.now > 240) { reset(); kit.log('Four minutes passed: starting the day again'); }
    }
    function paint() {
      const d = S.dropShare(), lat = S.avgLat();
      kit.metric('drop', (d * 100).toFixed(1) + '%', d > 0.01 ? 'bad' : 'good');
      kit.metric('lat', Math.round(lat) + ' ms', lat > 200 ? 'bad' : lat > 100 ? 'warn' : 'good');
      kit.metric('n', S.count() + (S.booting() ? ` (${S.booting()} booting)` : ''));
      kit.metric('cost', (S.cost / 60).toFixed(1));
    }

    function draw() {
      stage.clear();
      const c = stage.colors, w = stage.w, h = stage.h, ctx = stage.ctx;
      const H = S.hist, pad = 14, top = 26, base = h * 0.62;
      const max = Math.max(1100, ...H.map(x => Math.max(x.load, x.cap))) * 1.05;
      const X = i => w - pad - (w - 2 * pad) * (H.length - 1 - i) / 119;
      const Y = v => base - (base - top) * v / max;
      stage.text('requests per second · last 2 min', pad, top - 6, { size: 10, color: c.muted, baseline: 'bottom' });
      H.forEach((x, i) => { if (x.load > x.cap) tile(stage, X(i) - 1.5, Y(x.load), 3, Y(x.cap) - Y(x.load), { fill: c.bad, fillAlpha: 0.25, r: 0 }); });
      if (H.length >= 2) {
        for (const [k, col, lab] of [['cap', c.ok, 'capacity'], ['load', c.wire, 'traffic']]) {
          stage.path(H.map((x, i) => [X(i), Y(x[k])]), { color: col, width: 2 });
          const last = H[H.length - 1];
          stage.text(lab, w - pad, Y(last[k]) + (k === 'cap' ? -9 : 9), { size: 10, color: col, align: 'right' });
        }
      }
      stage.line(pad, base + 0.5, w - pad, base + 0.5, { color: c.line, width: 1 });
      const n = S.servers.length, cols = Math.min(30, Math.max(10, n)), g = 3;
      const sw = (w - 2 * pad - g * (cols - 1)) / cols, sh = Math.max(6, Math.min(22, (h - base - 48) / 2)), sy = base + 22;
      fitText(stage, `servers · CPU ${Math.round(Math.min(S.util, 9.99) * 100)}% (target ${Math.round(S.target * 100)}%, measured over ${WINDOW} s)`, pad, sy - 4, w - 2 * pad, { size: 10, color: c.muted, baseline: 'bottom' });
      const u = Math.min(1, S.util);
      S.servers.forEach((x, i) => {
        const bx = pad + (i % cols) * (sw + g), by = sy + Math.floor(i / cols) * (sh + g), ready = x.ready <= S.now;
        tile(stage, bx, by, sw, sh, { stroke: ready ? c.accent : c.muted, dash: ready ? null : [2, 2], r: 3 });
        if (ready) tile(stage, bx + 1, by + sh - 1 - (sh - 2) * u, sw - 2, (sh - 2) * u, { fill: u > 0.9 ? c.bad : u > S.target ? c.signal : c.accent, fillAlpha: 0.55, r: 1 });
      });
      ctx.globalAlpha = 1;
    }

    kit.loop(dt => { clock.run(dt, step); paint(); draw(); });
    reset();

    return {
      reset: () => reset(),
      guidedRun() {
        pattern.set('spike', true); auto.set(true, true); target.set(60, true); boot.set(10, true); cool.set(20, true);
        Object.assign(s, { pattern: 'spike', auto: true, target: 0.6, boot: 10, cooldown: 20 });
        reset(15);
        unpause();
      },
    };
  },
};
