// Ride hailing: drivers roam a 10 km × 10 km city and report their location every N seconds;
// one rider request per second is matched to the closest free driver the server knows about.
// Model: the server only knows each driver's last reported position (the faded dot). "Every
// driver" scans all free drivers; "Nearby cells" buckets drivers into a grid of cells × cells and
// searches rings of cells around the rider, stopping one ring after the first ring with a driver.
// Pickup time = real distance at 25 km/h. A match is "stale" when the chosen driver is really more
// than 1.3× (+0.2 km) further than the truly nearest free driver. Writes/s = drivers ÷ interval.
// Drivers move at 0.012 city-widths per simulated second and turn now and then; a matched driver is
// busy for 4 s + 20 s per city-width of distance while driving to the rider.

import { glow, pulse, stepper, pct, unpause, alpha as alphaC } from './_e-util.js';

const CITY_KM = 10, KMH = 25;
const minutesFor = d => ((d * CITY_KM) / KMH) * 60;

export default {
  lead: 'Every few seconds each driver\'s phone reports where it is. When a rider asks for a car, the server has to find the nearest free driver quickly. Checking every driver works for a hundred, not for a hundred thousand. Cutting the map into cells (geohash, H3) means only the cells around the rider need to be searched.',
  emptyLog: 'Riders are requesting cars. Change the search or how often drivers report.',
  stageHeight: 420,
  tryThis: [
    'Choose <b>Every driver</b> and raise drivers to 400. Each request now looks at all 400; with cells it looks at a few dozen.',
    'Set <b>cells per side</b> to 20. Each search sees fewer drivers, but now and then a closer one sits just outside the searched rings.',
    'Report locations <b>every 30 s</b>. The server\'s view goes stale and riders get drivers who have already driven away. Every 1 s is accurate but costs far more writes.',
  ],
  inShort: {
    what: 'A ride-hailing service such as Uber keeps every driver\'s latest position in a geospatial index and, for each request, searches nearby cells for the closest free driver.',
    why: 'Millions of location updates and ride requests arrive every minute, and riders expect a match within seconds.',
    tradeoff: 'Frequent updates give accurate matches but cost writes; small cells mean fewer checks but more misses at cell borders.',
    interview: 'Driver phones send GPS every few seconds to a location service that holds an in-memory H3 or geohash index (for example Redis GEO); matching searches rings of cells around the rider and then ranks the candidates by ETA.',
  },
  quiz: [
    { q: 'Why divide the map into cells (geohash, H3) for matching?', o: ['Nicer-looking maps', 'Only drivers in the cells around the rider are checked, not every driver in the city', 'Drivers go faster', 'GPS becomes more precise'], a: 1,
      why: 'A geo index turns "nearest driver" into a lookup of a few cells, so the cost stays small as the city grows.' },
    { q: 'Drivers report every 30 seconds instead of every 4. What goes wrong?', o: ['Nothing', 'The server matches on old positions, so the chosen driver may already have left', 'Phones overheat', 'Cells grow'], a: 1,
      why: 'Older positions mean worse matches; frequent updates are accurate but multiply the write load.' },
    { q: 'What is the risk of searching only the closest rings of cells?', o: ['None', 'A slightly closer driver just beyond the searched rings can be missed', 'It checks every driver', 'Riders wait forever'], a: 1,
      why: 'Cell search is approximate; searching one extra ring after the first hit cuts the misses at a small cost.' },
  ],
  guided: {
    intro: 'Slow the location updates from every 4 seconds to every 30 and compare the matches.',
    example: '“Run the guided example” resets to nearby-cell search with 8 cells per side and 120 drivers reporting every 4 s, runs for 5 s, then changes the interval to 30 s.',
    question: 'What happens to the matches after the change?',
    predictions: ['More riders get a driver who has already moved away, so pickups get worse.', 'Matches improve because the server does less work.', 'Nothing changes: the search is the same.'],
    correctPrediction: 0,
    running: 'Watch the gap between each driver\'s real dot and its faded last-known dot, and red “stale” lines in the request list.',
    observation: 'With 30-second updates the server matched on positions up to half a minute old, and the share of stale matches rose sharply.',
    explainQuestion: 'Why did stale matches rise?',
    explanations: ['The index held older positions, so the driver that looked closest often was not.', 'Fewer cells were searched.', 'Drivers refuse rides when updates are slow.'],
    correctExplanation: 0,
    why: 'Match quality depends on how fresh the index is; the update interval trades accuracy against write volume.',
    retryHint: 'Compare “Matched on an old location” before and after the interval changed.',
    nextSlug: 'google-maps',
    nextLabel: 'Next experiment: route planning →',
    waitSeconds: 20,
  },

  setup(kit) {
    const { stage } = kit;
    const fixed = stepper(0.05);
    let D, st;

    kit.metrics([
      { key: 'chk', label: 'Drivers checked per request' }, { key: 'eta', label: 'Average pickup' },
      { key: 'stale', label: 'Matched on an old location' }, { key: 'w', label: 'Location writes per second' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'chk', label: 'Drivers checked', color: 'wire' }],
      bars: { key: 'stale', label: 'Stale matches', color: 'bad' },
      format: v => String(Math.round(v)),
    });

    const p = kit.panel;
    const mode = p.seg('Search', { options: [['scan', 'Every driver'], ['cells', 'Nearby cells']], value: 'cells',
      onChange: v => { D.mode = v; resetStats(); kit.log(v === 'scan' ? 'Search now checks every free driver in the city' : 'Search now looks only at rings of cells around the rider'); } });
    const cells = p.slider('Cells per side', { min: 2, max: 20, step: 1, value: 8, format: v => String(v), onInput: v => { D.cells = v; resetStats(); } });
    const drivers = p.slider('Drivers in the city', { min: 20, max: 400, step: 20, value: 120, format: v => String(v), onInput: v => { setN(v); resetStats(); } });
    const update = p.slider('Location sent every', { min: 1, max: 30, step: 1, value: 4, format: v => `${v} s`, hint: 'Faded dot = where the server thinks the driver is',
      onInput: v => { D.update = v; for (const d of D.drivers) d.next = Math.min(d.next, v); resetStats(); } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    function newDriver() {
      const a = Math.random() * Math.PI * 2;
      const x = Math.random(), y = Math.random();
      return { x, y, kx: x, ky: y, vx: Math.cos(a) * 0.012, vy: Math.sin(a) * 0.012, next: Math.random() * D.update, busy: 0, tx: x, ty: y };
    }
    function setN(n) { while (D.drivers.length < n) D.drivers.push(newDriver()); D.drivers.length = n; D.n = n; }
    const cellOf = (x, y) => [Math.min(D.cells - 1, Math.floor(x * D.cells)), Math.min(D.cells - 1, Math.floor(y * D.cells))];

    function search(rx, ry) {
      const free = D.drivers.filter(d => !d.busy);
      if (D.mode === 'scan') return { cand: free, checked: free.length, seen: null };
      const [cx, cy] = cellOf(rx, ry);
      const buckets = new Map();
      for (const d of free) { const k = cellOf(d.kx, d.ky).join(); (buckets.get(k) || buckets.set(k, []).get(k)).push(d); }
      let cand = [], hitRing = -1, ring = 0;
      const seen = [];
      for (; ring < D.cells; ring++) {
        for (let i = cx - ring; i <= cx + ring; i++) for (let j = cy - ring; j <= cy + ring; j++) {
          if (Math.max(Math.abs(i - cx), Math.abs(j - cy)) !== ring || i < 0 || j < 0 || i >= D.cells || j >= D.cells) continue;
          seen.push([i, j]);
          cand = cand.concat(buckets.get(`${i},${j}`) || []);
        }
        if (cand.length && hitRing < 0) hitRing = ring;
        if (hitRing >= 0 && ring > hitRing) break;
      }
      return { cand, checked: cand.length, seen };
    }
    function request() {
      const rx = Math.random(), ry = Math.random();
      const r = search(rx, ry);
      D.reqs++; D.checked += r.checked; st.sec.chk.push(r.checked);
      if (!r.cand.length) { D.last = { rx, ry, none: true, ...r }; if (kit.time - st.noneLog > 3) { st.noneLog = kit.time; kit.log('No free driver found for a rider: every car is busy'); } return; }
      const dist = (d, known) => Math.hypot((known ? d.kx : d.x) - rx, (known ? d.ky : d.y) - ry);
      const pick = r.cand.reduce((a, b) => (dist(b, true) < dist(a, true) ? b : a));
      const real = dist(pick, false);
      const best = Math.min(...D.drivers.filter(d => !d.busy).map(d => dist(d, false)));
      const stale = real > best * 1.3 + 0.02;
      if (stale) {
        D.stale++; st.sec.stale++;
        if (kit.time - st.staleLog > 3) { st.staleLog = kit.time; kit.log(`Matched a driver who was really ${minutesFor(real).toFixed(1)} min away; a free car ${minutesFor(best).toFixed(1)} min away was missed (old location data)`); }
      }
      D.pick += minutesFor(real);
      pick.busy = 4 + real * 20; pick.tx = rx; pick.ty = ry;
      D.last = { rx, ry, driver: pick, stale, ...r };
      D.recent.unshift({ min: minutesFor(real), checked: r.checked, stale });
      if (D.recent.length > 10) D.recent.pop();
      st.flash = 0;
    }
    function tick(h) {
      D.now += h;
      for (const d of D.drivers) {
        if (d.busy) {
          d.busy = Math.max(0, d.busy - h);
          const k = Math.min(1, h * 1.5);
          d.x += (d.tx - d.x) * k; d.y += (d.ty - d.y) * k;
        } else {
          d.x += d.vx * h; d.y += d.vy * h;
          if (d.x < 0 || d.x > 1) { d.vx *= -1; d.x = Math.max(0, Math.min(1, d.x)); }
          if (d.y < 0 || d.y > 1) { d.vy *= -1; d.y = Math.max(0, Math.min(1, d.y)); }
          if (Math.random() < h * 0.15) { const a = Math.random() * Math.PI * 2; d.vx = Math.cos(a) * 0.012; d.vy = Math.sin(a) * 0.012; }
        }
        d.next -= h;
        if (d.next <= 0) { d.next += D.update; d.kx = d.x; d.ky = d.y; }
      }
      D.acc += h;
      while (D.acc >= 1) { D.acc -= 1; request(); }
      st.flash += h;
    }
    function resetStats() { D.reqs = D.checked = D.pick = D.stale = 0; }
    function reset() {
      D = { n: 0, cells: cells.get(), mode: mode.get(), update: update.get(), now: 0, acc: 0, drivers: [], reqs: 0, checked: 0, pick: 0, stale: 0, last: null, recent: [] };
      setN(drivers.get());
      st = { flash: 9, sec: { chk: [], stale: 0 }, staleLog: -9, noneLog: -9, guided: null };
      kit.resetTime(); chart.reset(); kit.clearLog(); paint();
    }
    function paint() {
      if (!D.reqs) { for (const k of ['chk', 'eta', 'stale']) kit.metric(k, '–'); kit.metric('w', (D.n / D.update).toFixed(0)); return; }
      const chk = D.checked / D.reqs, eta = D.pick / D.reqs, stale = D.stale / D.reqs, w = D.n / D.update;
      kit.metric('chk', chk.toFixed(0), chk > 100 ? 'bad' : chk > 40 ? 'warn' : 'good');
      kit.metric('eta', `${eta.toFixed(1)} min`, eta > 2 ? 'warn' : 'good');
      kit.metric('stale', pct(stale), stale > 0.15 ? 'bad' : stale > 0.05 ? 'warn' : 'good');
      kit.metric('w', w.toFixed(0), w > 100 ? 'warn' : '');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h, ctx = stage.ctx;
      const narrow = W < 520;
      const size = Math.min(narrow ? W - 28 : W * 0.58, H - 28);
      const ox = narrow ? (W - size) / 2 : 14, oy = (H - size) / 2;
      const P = (x, y) => [ox + x * size, oy + y * size];
      stage.rect(ox, oy, size, size, { fill: c.surface, stroke: c.line, r: 6, width: 1 });
      const L = D.last, cs = size / D.cells;
      if (D.mode === 'cells') {
        if (L && L.seen) for (const [i, j] of L.seen) stage.rect(ox + i * cs, oy + j * cs, cs, cs, { fill: alphaC(c.wire, 0.12), r: 0 });
        ctx.save(); ctx.globalAlpha = 0.7; ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.beginPath();
        for (let i = 1; i < D.cells; i++) { ctx.moveTo(ox + i * cs + 0.5, oy); ctx.lineTo(ox + i * cs + 0.5, oy + size); ctx.moveTo(ox, oy + i * cs + 0.5); ctx.lineTo(ox + size, oy + i * cs + 0.5); }
        ctx.stroke(); ctx.restore();
      } else if (L && !L.none) stage.rect(ox, oy, size, size, { fill: alphaC(c.wire, 0.06), r: 6 });
      const cand = new Set((L && L.cand) || []);
      for (const d of D.drivers) {
        const [x, y] = P(d.x, d.y), [kx, ky] = P(d.kx, d.ky);
        if (!d.busy && Math.hypot(x - kx, y - ky) > 3) { stage.line(kx, ky, x, y, { color: c.muted, width: 1, alpha: 0.35 }); stage.dot(kx, ky, 2, c.muted, 0.4); }
        stage.dot(x, y, d.busy ? 2.2 : 2.8, d.busy ? c.muted : cand.has(d) ? c.wire : c.ink, d.busy ? 0.5 : 0.95);
      }
      if (L) {
        const [rx, ry] = P(L.rx, L.ry);
        if (L.driver) {
          const [dx, dy] = P(L.driver.x, L.driver.y);
          stage.line(rx, ry, dx, dy, { color: L.stale ? c.bad : c.ok, width: 2, dash: [4, 3] });
          glow(stage, dx, dy, 4.5, L.stale ? c.bad : c.ok);
        }
        glow(stage, rx, ry, 5, c.signal);
        if (st.flash < 0.6) pulse(stage, rx, ry, st.flash / 0.6, c.signal, 6);
      }
      const lx = narrow ? null : ox + size + 16;
      if (lx == null || W - lx < 120) return;
      stage.text('latest requests', lx, oy + 6, { size: 10, color: c.muted });
      const rh = 17;
      D.recent.slice(0, Math.max(0, Math.floor((size - 80) / rh))).forEach((r, i) => {
        const y = oy + 16 + i * rh;
        stage.rect(lx, y, W - 14 - lx, rh - 3, { fill: c.surface, r: 4 });
        stage.text(`${r.checked} checked`, lx + 6, y + (rh - 3) / 2, { size: 10 });
        stage.text(`${r.min.toFixed(1)} min${r.stale ? ' · stale' : ''}`, W - 20, y + (rh - 3) / 2, { size: 10, align: 'right', color: r.stale ? c.bad : c.ok });
      });
      [[c.signal, 'rider'], [c.wire, 'driver checked'], [c.ok, 'matched'], [c.bad, 'matched, but moved away']].forEach(([col, label], i) => {
        const y = oy + size - 4 - (3 - i) * 14;
        glow(stage, lx + 4, y - 5, 3.5, col);
        stage.text(label, lx + 12, y - 5, { size: 9, color: c.muted });
      });
    }

    kit.loop(dt => { fixed(dt, tick); paint(); draw(); });
    kit.every(1, () => {
      const a = st.sec.chk;
      chart.push({ chk: a.length ? a.reduce((x, y) => x + y, 0) / a.length : null, stale: st.sec.stale });
      st.sec = { chk: [], stale: 0 };
      const g = st.guided;
      if (!g) return;
      if (!g.switched && kit.time >= 5) {
        g.before = D.reqs ? D.stale / D.reqs : 0; g.switched = true; g.at = kit.time;
        update.set(30);
        kit.log('Guided run: drivers now report every 30 s');
      } else if (g.switched && kit.time - g.at >= 10) {
        st.guided = null;
        kit.guided.observe(`With 4-second updates ${pct(g.before)} of matches went to a driver who had moved; with 30-second updates it was ${pct(D.reqs ? D.stale / D.reqs : 0)}, and the average pickup grew to ${(D.pick / Math.max(1, D.reqs)).toFixed(1)} min.`);
      }
    });
    reset();

    return {
      reset,
      guidedRun() {
        mode.set('cells', true); cells.set(8, true); drivers.set(120, true); update.set(4, true);
        reset();
        st.guided = { switched: false };
        unpause();
      },
    };
  },
};

