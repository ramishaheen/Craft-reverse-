// Route planning: a 32 × 18 grid of intersections. Ordinary streets take 1 minute per block;
// every 6th row and column is a highway (0.35 min per block, about 3× faster). A downtown jam
// (columns 12–20, rows 5–11) makes any block touching it 5× slower. Each trip runs Dijkstra or A*
// (Manhattan distance × highway cost as the heuristic, which never overestimates) using either the
// live weights or free-flow weights. "ETA shown" is the planned cost; "real driving time" re-costs
// the chosen path with the real (jammed) weights. The search animates at 220 intersections per
// second, then the route is drawn; a new random trip (endpoints > 20 blocks apart) starts about
// 3.4 s later.

import { glow, stepper, unpause, alpha } from './_e-util.js';

const GW = 32, GH = 18, HW = 6, STREET = 1, HIGHWAY = 0.35, JAMX = 5;
const JAM = { x: 12, y: 5, w: 9, h: 7 };
const SPEED = 220;

function makeGraph() {
  const g = { jamOn: true };
  g.id = (x, y) => y * GW + x;
  g.xy = i => [i % GW, Math.floor(i / GW)];
  g.inJam = (x, y) => g.jamOn && x >= JAM.x && x < JAM.x + JAM.w && y >= JAM.y && y < JAM.y + JAM.h;
  g.cost = (x1, y1, x2, y2, live = true) => {
    const base = (y1 === y2 && y1 % HW === 0) || (x1 === x2 && x1 % HW === 0) ? HIGHWAY : STREET;
    return base * (live && (g.inJam(x1, y1) || g.inJam(x2, y2)) ? JAMX : 1);
  };
  g.near = i => {
    const [x, y] = g.xy(i), out = [];
    if (x > 0) out.push([x - 1, y]); if (x < GW - 1) out.push([x + 1, y]);
    if (y > 0) out.push([x, y - 1]); if (y < GH - 1) out.push([x, y + 1]);
    return out;
  };
  return g;
}

// Binary-heap shortest path. Returns the path, the order nodes were settled in, and its cost.
function route(g, from, to, { astar, live }) {
  const N = GW * GH, dist = new Float64Array(N).fill(Infinity), prev = new Int32Array(N).fill(-1), done = new Uint8Array(N), order = [];
  const [tx, ty] = g.xy(to);
  const hcost = i => { if (!astar) return 0; const [x, y] = g.xy(i); return (Math.abs(x - tx) + Math.abs(y - ty)) * HIGHWAY; };
  const heap = [];
  const push = (k, v) => { heap.push([k, v]); let i = heap.length - 1; while (i > 0) { const p = (i - 1) >> 1; if (heap[p][0] <= heap[i][0]) break; [heap[p], heap[i]] = [heap[i], heap[p]]; i = p; } };
  const pop = () => {
    const top = heap[0], last = heap.pop();
    if (heap.length) {
      heap[0] = last; let i = 0;
      for (;;) { const l = 2 * i + 1, r = l + 1; let m = i; if (l < heap.length && heap[l][0] < heap[m][0]) m = l; if (r < heap.length && heap[r][0] < heap[m][0]) m = r; if (m === i) break; [heap[m], heap[i]] = [heap[i], heap[m]]; i = m; }
    }
    return top;
  };
  dist[from] = 0; push(hcost(from), from);
  while (heap.length) {
    const [, n] = pop();
    if (done[n]) continue;
    done[n] = 1; order.push(n);
    if (n === to) break;
    const [x, y] = g.xy(n);
    for (const [u, v] of g.near(n)) {
      const o = g.id(u, v);
      if (done[o]) continue;
      const d = dist[n] + g.cost(x, y, u, v, live);
      if (d < dist[o]) { dist[o] = d; prev[o] = n; push(d + hcost(o), o); }
    }
  }
  const path = [];
  for (let n = to; n !== -1; n = prev[n]) path.unshift(n);
  return { path, order, planned: dist[to] };
}
function realCost(g, path) {
  let t = 0;
  for (let i = 1; i < path.length; i++) { const [a, b] = g.xy(path[i - 1]), [c, d] = g.xy(path[i]); t += g.cost(a, b, c, d, true); }
  return t;
}

export default {
  lead: 'The map is a graph: intersections are nodes and roads are edges weighted by driving time. Dijkstra spreads out in every direction until it hits the destination; A* adds a straight-line estimate so it heads the right way and explores far less. Live traffic changes the weights, so the route steers around the jam and the arrival time stays honest.',
  emptyLog: 'Trips are being planned. Switch the search or the traffic data.',
  stageHeight: 400,
  tryThis: [
    'Compare <b>Dijkstra</b> and <b>A*</b> on the same trips. Both land on the fastest route, but A* explores only a slice of the city to find it.',
    'Set live traffic to <b>Ignored</b>. Routes head straight through the red area and the arrival estimate is way off.',
    '<b>Clear</b> the jam. Ignoring traffic now costs nothing: live data only matters when the roads are not behaving normally.',
  ],
  inShort: {
    what: 'A maps service stores roads as a weighted graph and answers route requests with a shortest-path search that uses live speeds as the weights.',
    why: 'Billions of route requests have to come back in milliseconds and stay accurate as traffic changes.',
    tradeoff: 'Precomputed shortcuts (contraction hierarchies) make queries fast but must be rebuilt as traffic shifts, and live data needs a large stream of speeds from phones.',
    interview: 'The road graph is split into tiles, queries use contraction hierarchies or A*, live speeds streamed from phones update the edge weights, and ETA models sit on top.',
  },
  quiz: [
    { q: 'Why does A* explore fewer intersections than Dijkstra?', o: ['It skips roads at random', 'It adds an estimate of the distance still to go, so it searches towards the destination first', 'It only uses highways', 'It is not exact'], a: 1,
      why: 'With an estimate that never overshoots, A* still finds the fastest route while ignoring directions that cannot help.' },
    { q: 'How does live traffic change the route?', o: ['It does not', 'It changes the edge weights (driving times), so another route can become the fastest', 'It adds roads', 'It removes highways'], a: 1,
      why: 'Weights come from current speeds; a jam makes its roads expensive and the search goes around them.' },
    { q: 'What happens when the router ignores a traffic jam?', o: ['Nothing', 'The route may run through the jam and the ETA shown is far too optimistic', 'Routes get shorter', 'The search gets slower'], a: 1,
      why: 'The plan uses free-flow times, but the car drives through the real ones.' },
  ],
  guided: {
    intro: 'Plan a trip straight across downtown while ignoring live traffic.',
    example: '“Run the guided example” sets Dijkstra, the jam on and live traffic ignored, then plans a trip from the west side to the east side across the jammed area.',
    question: 'How will the route and its ETA turn out?',
    predictions: ['The route goes through the jam and the real driving time is much longer than the ETA.', 'The route avoids the jam anyway.', 'The ETA is exact because Dijkstra is optimal.'],
    correctPrediction: 0,
    running: 'Watch the search spread, then the route: red segments are blocks inside the jam. Compare “ETA shown” with “Real driving time”.',
    observation: 'Without live data the planner used free-flow times, sent the car along the highway through the jam, and promised an ETA far below the real driving time.',
    explainQuestion: 'Why was the ETA so wrong?',
    explanations: ['The search used weights that did not include the jam, so its cost estimate was for empty roads.', 'Dijkstra does not find the shortest path.', 'Highways are slower than streets.'],
    correctExplanation: 0,
    why: 'A shortest path is only as good as its weights: optimal on wrong weights is still a wrong answer.',
    retryHint: 'Look at the red route segments and the “ETA error” metric.',
    nextSlug: 'twitter',
    nextLabel: 'Next experiment: social feed →',
    waitSeconds: 10,
  },

  setup(kit) {
    const { stage } = kit;
    const fixed = stepper(0.05);
    const G = makeGraph();
    const s = { astar: false, live: true };
    let st;

    kit.metrics([
      { key: 'n', label: 'Intersections explored' }, { key: 'eta', label: 'ETA shown to the driver' },
      { key: 'real', label: 'Real driving time' }, { key: 'err', label: 'ETA error' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'n', label: 'Intersections explored (current trip)', color: 'wire' }],
      bars: { key: 'late', label: 'Minutes late vs ETA', color: 'bad' },
      format: v => String(Math.round(v)),
    });

    const p = kit.panel;
    const alg = p.seg('Route search', { options: [['dijkstra', 'Dijkstra'], ['astar', 'A*']], value: 'dijkstra', onChange: v => { s.astar = v === 'astar'; replan(true); } });
    const live = p.seg('Live traffic data', { options: [['on', 'Used'], ['off', 'Ignored']], value: 'on', onChange: v => { s.live = v === 'on'; replan(true); } });
    const jam = p.seg('Traffic jam downtown', { options: [['on', 'Jammed'], ['off', 'Clear']], value: 'on', hint: 'Thick lines are highways (about 3× faster); the red area is 5× slower',
      onChange: v => { G.jamOn = v === 'on'; kit.log(G.jamOn ? 'A jam builds up downtown: those blocks are now 5× slower' : 'The downtown jam cleared'); replan(true); } });
    p.buttons([{ label: 'New trip', kind: 'primary', onClick: newTrip }, { label: 'Reset', kind: 'outline', onClick: reset }]);

    function rand() { st.seed = (st.seed * 16807) % 2147483647; return st.seed / 2147483647; }
    function newTrip() {
      let a, b;
      for (let guard = 0; guard < 200; guard++) {
        a = Math.floor(rand() * GW * GH); b = Math.floor(rand() * GW * GH);
        const [x1, y1] = G.xy(a), [x2, y2] = G.xy(b);
        if (Math.abs(x1 - x2) + Math.abs(y1 - y2) > 20) break;
      }
      st.ends = [a, b];
      replan(false);
    }
    function replan(byControl) {
      const [a, b] = st.ends;
      const r = route(G, a, b, s);
      st.trip = { ...r, real: realCost(G, r.path), logged: false };
      st.t = 0;
      if (byControl) kit.log(`Re-planned the same trip with ${s.astar ? 'A*' : 'Dijkstra'}${s.live ? ' using live traffic' : ' ignoring traffic'}`);
      paint();
    }
    function paint() {
      const t = st.trip;
      if (!t) return;
      kit.metric('n', String(t.order.length), t.order.length > 300 ? 'warn' : 'good');
      kit.metric('eta', `${t.planned.toFixed(0)} min`);
      kit.metric('real', `${t.real.toFixed(0)} min`);
      const e = (t.real - t.planned) / t.real;
      kit.metric('err', e < 0.02 ? 'on time' : `+${(t.real - t.planned).toFixed(0)} min late`, e < 0.02 ? 'good' : 'bad');
    }
    function tick(h) {
      st.t += h;
      const t = st.trip, searchT = t.order.length / SPEED;
      if (!t.logged && st.t > searchT + 0.6) {
        t.logged = true;
        const jamBlocks = t.path.filter(i => { const [x, y] = G.xy(i); return G.inJam(x, y); }).length;
        kit.log(`${s.astar ? 'A*' : 'Dijkstra'} explored ${t.order.length} of ${GW * GH} intersections. ETA ${t.planned.toFixed(0)} min, real ${t.real.toFixed(0)} min${jamBlocks ? ` (${jamBlocks} blocks in the jam)` : ''}`);
        if (st.guided) {
          st.guided = false;
          kit.guided.observe(`Ignoring traffic, the route ran ${jamBlocks} blocks through the jam. The driver was promised ${t.planned.toFixed(0)} min but the real drive takes ${t.real.toFixed(0)} min.`);
        }
      }
      if (st.t > searchT + 1 + 2.4 && !st.hold) newTrip();
    }
    function reset() {
      st = { seed: 7, t: 0, trip: null, ends: null, guided: false, hold: false };
      kit.resetTime(); chart.reset(); kit.clearLog();
      newTrip();
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h, ctx = stage.ctx;
      const narrow = W < 520, pad = 14;
      const d = Math.min((W - 2 * pad) / (GW - 1), (H - 2 * pad - 14) / (GH - 1));
      const ox = (W - d * (GW - 1)) / 2, oy = pad + 14;
      const P = i => { const [x, y] = G.xy(i); return [ox + x * d, oy + y * d]; };
      if (G.jamOn) stage.rect(ox + (JAM.x - 0.5) * d, oy + (JAM.y - 0.5) * d, JAM.w * d, JAM.h * d, { fill: alpha(c.bad, 0.16), r: 2 });
      ctx.save(); ctx.strokeStyle = c.line; ctx.lineWidth = 1; ctx.beginPath();
      for (let y = 0; y < GH; y++) if (y % HW) { ctx.moveTo(ox, oy + y * d); ctx.lineTo(ox + (GW - 1) * d, oy + y * d); }
      for (let x = 0; x < GW; x++) if (x % HW) { ctx.moveTo(ox + x * d, oy); ctx.lineTo(ox + x * d, oy + (GH - 1) * d); }
      ctx.stroke();
      ctx.strokeStyle = c.muted; ctx.lineWidth = narrow ? 2 : 3; ctx.beginPath();
      for (let y = 0; y < GH; y += HW) { ctx.moveTo(ox, oy + y * d); ctx.lineTo(ox + (GW - 1) * d, oy + y * d); }
      for (let x = 0; x < GW; x += HW) { ctx.moveTo(ox + x * d, oy); ctx.lineTo(ox + x * d, oy + (GH - 1) * d); }
      ctx.stroke(); ctx.restore();
      const t = st.trip;
      if (!t) return;
      const shown = Math.min(t.order.length, Math.floor(st.t * SPEED)), sq = Math.max(2, d * 0.42);
      ctx.save(); ctx.fillStyle = c.wire;
      for (let i = 0; i < shown; i++) { const [x, y] = P(t.order[i]); ctx.globalAlpha = 0.18 + 0.4 * (i / Math.max(1, t.order.length)); ctx.fillRect(x - sq / 2, y - sq / 2, sq, sq); }
      ctx.restore();
      if (shown >= t.order.length) {
        const k = Math.min(1, (st.t - t.order.length / SPEED) / 0.6), n = Math.max(2, Math.ceil(t.path.length * k));
        const pts = t.path.slice(0, n).map(P);
        ctx.save(); ctx.lineJoin = 'round'; ctx.restore();
        stage.path(pts, { color: c.ok, width: narrow ? 3 : 4 });
        for (let i = 1; i < n; i++) {
          const [a, b] = G.xy(t.path[i - 1]), [x2, y2] = G.xy(t.path[i]);
          if (G.inJam(a, b) || G.inJam(x2, y2)) { const p1 = P(t.path[i - 1]), p2 = P(t.path[i]); stage.line(p1[0], p1[1], p2[0], p2[1], { color: c.bad, width: narrow ? 3 : 4 }); }
        }
      }
      const [sx, sy] = P(st.ends[0]), [ex, ey] = P(st.ends[1]);
      glow(stage, sx, sy, 6, c.ink); glow(stage, ex, ey, 6, c.signal);
      const name = s.astar ? 'A*' : 'Dijkstra';
      stage.text(narrow ? `${name} · ${shown} explored` : `${name}: ${shown} of ${GW * GH} intersections explored · white dot = start · orange dot = destination`, ox, 9, { size: 10, color: c.muted });
    }

    kit.loop(dt => { fixed(dt, tick); draw(); });
    kit.every(1, () => { const t = st.trip; if (t) chart.push({ n: Math.min(t.order.length, Math.floor(st.t * SPEED)), late: Math.max(0, t.real - t.planned) }); });
    reset();

    return {
      reset,
      guidedRun() {
        alg.set('dijkstra', true); s.astar = false;
        live.set('off', true); s.live = false;
        jam.set('on', true); G.jamOn = true;
        reset();
        st.ends = [G.id(1, 7), G.id(30, 8)];
        st.guided = true; st.hold = true;
        replan(false);
        unpause();
        setTimeout(() => { if (st) st.hold = false; }, 9000);
      },
    };
  },
};
