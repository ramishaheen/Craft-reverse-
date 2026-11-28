// Replication with quorums: a coordinator copies each write to N replicas and reads from R of them.
// Model (fixed 50 ms steps): 6 operations/s, 35% writes. A write goes to every replica that is up;
// replica i receives it after delay × speed[i] × (0.5…1.5) (speeds 1, 1.3, 3.2, 0.8, 2.2, 1.6, 0.9, so
// some replicas lag). The write succeeds once W replicas have it (latency = the W-th fastest) and the
// "latest committed" version advances at that moment. A read asks R random live replicas (4–16 ms ×
// speed each) and returns the newest version it sees; it is stale if that is older than the latest
// committed write. Fewer than W (or R) live replicas rejects the write (or read). Read repair copies
// the newest version back to the replicas that were read. Restored replicas catch up in 1.5 s.

import { clamp, pct, p95, fmtMs, fixedSteps, unpause, drawKey, panelBox, hide3dButton } from './_a-util.js';

const SPEED = [1, 1.3, 3.2, 0.8, 2.2, 1.6, 0.9];
const CITIES = [[50.11, 8.68, 'Frankfurt'], [35.68, 139.69, 'Tokyo'], [-23.55, -46.63, 'São Paulo'], [13.08, 80.27, 'Chennai'],
  [38.9, -77.4, 'Virginia'], [-33.87, 151.21, 'Sydney'], [1.35, 103.82, 'Singapore']];
const HOME = [19.07, 72.87]; // the coordinator, in Mumbai

function makeCluster(n) {
  return { replicas: Array.from({ length: n }, () => ({ up: true, ver: 0 })), pending: [], commits: [], committed: 0, nextVer: 1 };
}
function settle(c, now) {
  c.pending = c.pending.filter(m => { if (m.at > now) return true; const r = c.replicas[m.i]; if (r && r.up) r.ver = Math.max(r.ver, m.ver); return false; });
  c.commits = c.commits.filter(m => { if (m.at > now) return true; c.committed = Math.max(c.committed, m.ver); return false; });
}
const liveIdx = c => c.replicas.map((r, i) => (r.up ? i : -1)).filter(i => i >= 0);
function write(c, now, W, delays) {
  const live = liveIdx(c);
  if (live.length < W) return { ok: false };
  const ver = c.nextVer++;
  for (const i of live) c.pending.push({ i, ver, at: now + delays[i] });
  const lat = live.map(i => delays[i]).sort((a, b) => a - b)[W - 1];
  c.commits.push({ ver, at: now + lat });
  return { ok: true, ver, lat, targets: live };
}
function read(c, R, delays, repair) {
  const live = liveIdx(c);
  if (live.length < R) return { ok: false };
  for (let i = live.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [live[i], live[j]] = [live[j], live[i]]; }
  const set = live.slice(0, R);
  const ver = Math.max(...set.map(i => c.replicas[i].ver));
  const lat = set.map(i => delays[i]).sort((a, b) => a - b)[R - 1];
  if (repair) for (const i of set) c.replicas[i].ver = Math.max(c.replicas[i].ver, ver);
  return { ok: true, ver, stale: ver < c.committed, lat, set };
}

export default {
  lead: 'Each key is copied to N replicas. A write counts once W of them have it; a read asks R of them and keeps the newest answer. Choose N, W and R and watch consistency, latency and availability trade against each other.',
  emptyLog: 'Nothing yet. Try failing a replica.',
  tryThis: [
    'Set <b>W = 1, R = 1</b> and raise the delay. It is fast, but amber stale reads appear: the read reached a replica the write had not got to yet.',
    'Now make <b>R + W &gt; N</b>. Stale reads drop to zero, because every read set shares at least one replica with every write set.',
    'With N = 3 and W = 3, <b>fail a replica</b>. Every write is rejected: strict consistency costs availability.',
    '<b>W = 2, R = 2</b> survives one failure on N = 3 and stays consistent, which is why it is the classic default.',
  ],
  inShort: {
    what: 'Every piece of data is stored on N replicas; a write waits for W of them to confirm and a read asks R of them.',
    why: 'Copies survive the loss of a machine or a region and let more machines answer reads.',
    tradeoff: 'With W + R > N every read sees the latest write but takes longer; smaller W and R are quicker but reads can be stale (eventual consistency).',
    interview: 'With N = 3, W = 2 and R = 2 every read set overlaps every write set, so reads are never stale and one node can be down.',
  },
  quiz: [
    { q: 'N = 3. Which W and R make sure a read sees the latest successful write?', o: ['W = 1, R = 1', 'W = 1, R = 2', 'W = 2, R = 2', 'W = 2, R = 1'], a: 2,
      why: 'You need R + W > N so that every read set overlaps every write set in at least one replica: 2 + 2 = 4 > 3.' },
    { q: 'N = 3 and W = 3, and one replica goes down. What happens to writes?', o: ['They succeed, only slower', 'They are rejected until the replica is back', 'They go to the cache instead', 'Nothing changes'], a: 1,
      why: 'Each write needs acknowledgements from all three replicas, so losing one makes writes unavailable.' },
    { q: 'What does read repair do?', o: ['Restarts failed replicas', 'When a read finds an old copy, it writes the newer value back to that replica', 'Deletes stale data', 'Rebalances shards'], a: 1,
      why: 'A read compares the versions it got from several replicas and fixes the out-of-date ones on the spot.' },
  ],
  guided: {
    intro: 'Make writes and reads as cheap as possible, W = 1 and R = 1, with slow replication, and see what readers get.',
    example: '“Run the guided example” resets to N = 3, W = 1, R = 1, a 1,200 ms replication delay and no read repair.',
    question: 'Will any read return an older version than the latest committed write?',
    predictions: ['Yes: some reads return a stale version.', 'No: a committed write is visible to every read straight away.', 'Reads will be rejected instead.'],
    correctPrediction: 0,
    running: 'Watch for amber dots and the “Stale read returned!” label, and the “Stale reads” number.',
    observation: 'Some reads landed on a replica the latest write had not reached yet, so they returned an old version.',
    explainQuestion: 'Why could a read be stale?',
    explanations: ['With R + W = 2 ≤ N = 3, the replica a read asks may not be the one that confirmed the write.', 'Replicas lose data when they are slow.', 'Reads always go to the slowest replica.'],
    correctExplanation: 0,
    why: 'Only R + W > N forces the read set and the write set to share a replica. Below that you trade freshness for speed and availability.',
    retryHint: 'Add R and W together and compare with N in the quorum box.',
    nextSlug: 'raft-consensus',
    nextLabel: 'Next experiment: Raft consensus →',
    waitSeconds: 12,
  },

  setup(kit) {
    const { stage } = kit;
    hide3dButton(kit);
    const s = { n: 3, w: 2, r: 2, delay: 0.3, repair: false };
    let st;

    kit.metrics([
      { key: 'wok', label: 'Writes succeeded' }, { key: 'wl', label: 'Write p95' }, { key: 'rl', label: 'Read p95' },
      { key: 'stale', label: 'Stale reads' }, { key: 'rok', label: 'Reads succeeded' },
    ]);
    const chart = kit.chart({ lines: [{ key: 'stale', label: 'Stale reads %', color: 'signal' }], bars: { key: 'rej', label: 'Rejected operations', color: 'bad' }, format: v => `${Math.round(v)}%` });
    kit.enable3d({ yaw: -2.6, pitch: 0.4 });

    const p = kit.panel;
    const math = panelBox(p, null);
    math.el.style.borderTop = 'none'; math.el.style.paddingTop = '0';
    const nSeg = p.seg('Replicas (N)', { options: [[3, 'N = 3'], [5, 'N = 5'], [7, 'N = 7']], value: 3,
      onChange: v => { s.n = v; st.c = makeCluster(v); fitQuorums(); kit.log(`New cluster with ${v} replicas`); } });
    const wS = p.slider('Write quorum (W)', { min: 1, max: 3, step: 1, value: 2, onInput: v => { s.w = v; paintMath(); } });
    const rS = p.slider('Read quorum (R)', { min: 1, max: 3, step: 1, value: 2, onInput: v => { s.r = v; paintMath(); } });
    const delay = p.slider('Replication delay', { min: 20, max: 1500, step: 20, value: 300, format: v => `${v} ms`, hint: 'Typical time for a write to reach one replica. Some replicas are slower than others.',
      onInput: v => { s.delay = v / 1000; } });
    const repair = p.toggle('Read repair', { value: false, onChange: v => { s.repair = v; kit.log(v ? 'Read repair on: a read that finds an old copy fixes it on the spot' : 'Read repair off'); } });
    p.buttons([
      { label: 'Fail a replica', kind: 'primary', onClick: fail },
      { label: 'Restore replicas', kind: 'outline', onClick: heal },
      { label: 'Reset', kind: 'outline', onClick: reset },
    ]);

    function fitQuorums() {
      for (const [sl, key] of [[wS, 'w'], [rS, 'r']]) { sl.input.max = s.n; const v = Math.min(s[key], s.n); s[key] = v; sl.set(v, true); }
      paintMath();
    }
    function paintMath() {
      const ok = s.r + s.w > s.n, up = st ? st.c.replicas.filter(r => r.up).length : s.n, wf = s.n - s.w, rf = s.n - s.r;
      math.body.innerHTML = `<div style="font:700 18px var(--font);color:var(${ok ? '--green' : '--amber'});margin-bottom:6px">R + W = ${s.r + s.w} ${ok ? '&gt;' : '≤'} N = ${s.n}</div>
        <p style="margin:0 0 6px;font-size:13px;color:var(--text-2)">${ok ? 'Every read overlaps the latest successful write in at least one replica, so reads are never stale.' : 'A read can miss every replica holding the latest write, so stale reads are possible.'}</p>
        <ul style="margin:0;padding-left:18px;font-size:13px;color:var(--text-2)"><li>Writes survive <b>${wf}</b> failed replica${wf === 1 ? '' : 's'}; reads survive <b>${rf}</b>.</li><li>Replicas up now: <b>${up} of ${s.n}</b>.</li></ul>`;
    }

    const blankWin = () => ({ w: 0, wok: 0, r: 0, rok: 0, stale: 0, wl: [], rl: [] });
    function reset() {
      st = { t: 0, arr: 0, c: makeCluster(s.n), winT: 0, win: blankWin(), last: null, parts: [], flash: 0, staleSeen: false };
      kit.resetTime(); chart.reset(); kit.clearLog(); paintMetrics(); paintMath();
    }
    function fail() {
      const live = liveIdx(st.c);
      if (!live.length) return;
      const i = live[live.length - 1];
      st.c.replicas[i].up = false;
      const up = live.length - 1;
      kit.log(`Replica ${i + 1} failed. ${up} of ${s.n} up: ${up < s.w ? 'writes are now rejected' : 'writes still reach W'}, ${up < s.r ? 'reads are now rejected' : 'reads still reach R'}`);
      paintMath();
    }
    function heal() {
      let n = 0;
      st.c.replicas.forEach((r, i) => { if (!r.up) { r.up = true; st.c.pending.push({ i, ver: st.c.committed, at: st.t + 1.5 }); n++; } });
      if (n) { kit.log(`${n} replica${n > 1 ? 's' : ''} back. They catch up from the others (anti-entropy) in about 1.5 s`); paintMath(); }
    }

    function step(dt) {
      st.t += dt;
      settle(st.c, st.t);
      st.arr += 6 * dt;
      const n = Math.floor(st.arr);
      st.arr -= n;
      for (let k = 0; k < n; k++) {
        if (Math.random() < 0.35) {
          st.win.w++;
          const d = st.c.replicas.map((_, i) => s.delay * SPEED[i] * (0.5 + Math.random()));
          const res = write(st.c, st.t, s.w, d);
          if (res.ok) { st.win.wok++; st.win.wl.push(res.lat * 1000 + 4); for (const i of res.targets) st.parts.push({ kind: 'w', i, t: 0, dur: 0.3 + Math.min(1.6, d[i] * 1.2) }); }
          else st.parts.push({ kind: 'x', t: 0, dur: 0.6 });
        } else {
          st.win.r++;
          const d = st.c.replicas.map((_, i) => (0.004 + Math.random() * 0.012) * SPEED[i]);
          const res = read(st.c, s.r, d, s.repair);
          if (res.ok) {
            st.win.rok++; st.win.rl.push(res.lat * 1000 + 2);
            if (res.stale) {
              st.win.stale++; st.flash = 0.6;
              if (!st.staleSeen) { st.staleSeen = true; kit.log(`Stale read: got v${res.ver} while v${st.c.committed} was already committed`); }
              kit.guided.observe(`A read returned v${res.ver} although v${st.c.committed} was already committed: it asked a replica the newest write had not reached yet.`);
            }
            for (const i of res.set) st.parts.push({ kind: res.stale ? 's' : 'r', i, t: 0, dur: 0.7 });
          } else st.parts.push({ kind: 'x', t: 0, dur: 0.6 });
        }
      }
      st.winT += dt;
      if (st.winT >= 1 - 1e-9) {
        st.winT = 0;
        const w = st.win;
        st.last = { wok: w.w ? w.wok / w.w : 1, rok: w.r ? w.rok / w.r : 1, stale: w.rok ? w.stale / w.rok : 0, wl: p95(w.wl), rl: p95(w.rl) };
        chart.push({ stale: st.last.stale * 100, rej: w.w - w.wok + (w.r - w.rok) });
        st.win = blankWin();
        paintMetrics();
      }
    }

    function paintMetrics() {
      const a = st.last;
      if (!a) { for (const k of ['wok', 'wl', 'rl', 'stale', 'rok']) kit.metric(k, '–'); return; }
      kit.metric('wok', pct(a.wok), a.wok < 0.99 ? 'bad' : 'good');
      kit.metric('wl', fmtMs(a.wl), a.wl > 800 ? 'warn' : '');
      kit.metric('rl', fmtMs(a.rl));
      kit.metric('stale', pct(a.stale) + (a.stale > 0 && a.stale < 0.01 ? ' (<1%)' : ''), a.stale > 0.05 ? 'bad' : a.stale > 0 ? 'warn' : 'good');
      kit.metric('rok', pct(a.rok), a.rok < 0.99 ? 'bad' : 'good');
    }

    const COL = c => ({ w: c.wire, r: c.ok, s: c.signal, x: c.bad });
    function along(pts, t) {
      const k = clamp(t, 0, 1) * (pts.length - 1), i = Math.min(pts.length - 2, Math.floor(k)), f = k - i;
      return [pts[i][0] + (pts[i + 1][0] - pts[i][0]) * f, pts[i][1] + (pts[i + 1][1] - pts[i][1]) * f];
    }

    function draw(dt) {
      stage.clear();
      st.flash = Math.max(0, st.flash - dt);
      if (kit.is3d) return drawGlobe(dt);
      const c = stage.colors, w = stage.w, H = stage.h - 24, col = COL(c);
      const cl = { w: clamp(w * 0.17, 70, 104), h: 44 }, co = { w: clamp(w * 0.2, 84, 128), h: 48 };
      const clX = clamp(w * 0.12, 48, 90), coX = w * 0.42, cy = H / 2;
      const n = st.c.replicas.length, rw = clamp(w * 0.3, 96, 180), rx = w - rw - 10, gap = n > 5 ? 5 : 8;
      const rh = Math.min(42, (H - 24 - gap * (n - 1)) / n), top = (H - (n * rh + (n - 1) * gap)) / 2;
      const ry = i => top + i * (rh + gap) + rh / 2;
      stage.line(clX, cy, coX, cy, { color: c.wire, alpha: 0.35 });
      for (let i = 0; i < n; i++) stage.line(coX, cy, rx, ry(i), { color: c.wire, alpha: st.c.replicas[i].up ? 0.3 : 0.1 });
      st.parts = st.parts.filter(pt => {
        pt.t += dt;
        if (pt.t >= pt.dur) return false;
        const f = pt.t / pt.dur;
        if (pt.kind === 'x') {
          const [x, y] = along([[clX, cy], [coX, cy]], Math.min(1, f * 1.5));
          stage.dot(x, y, f > 0.7 ? 5 : 4, col.x, f > 0.7 ? 1 - (f - 0.7) / 0.3 : 1);
          return true;
        }
        if (pt.i >= n) return false;
        const path = pt.kind === 'w' ? [[coX, cy], [rx, ry(pt.i)]] : [[coX, cy], [rx, ry(pt.i)], [coX, cy]];
        const [x, y] = along(path, f);
        stage.dot(x, y, 3.8, col[pt.kind]);
        return true;
      });
      stage.node(clX - cl.w / 2, cy - cl.h / 2, cl.w, cl.h, { title: 'Clients', sub: 'reads + writes' });
      stage.node(coX - co.w / 2, cy - co.h / 2, co.w, co.h, { title: 'Coordinator', sub: `W=${s.w}  R=${s.r}` });
      const com = st.c.committed;
      st.c.replicas.forEach((r, i) => {
        const behind = com - r.ver;
        stage.node(rx, ry(i) - rh / 2, rw, rh, {
          title: `Replica ${i + 1}`, align: 'left', size: rh < 26 ? 10.5 : 12,
          state: r.up ? (behind > 0 ? 'warn' : 'ok') : 'dead', dashed: !r.up,
          right: r.up ? (behind > 0 ? `v${r.ver} (${behind} behind)` : `v${r.ver}`) : 'down',
          rightColor: r.up ? (behind > 0 ? c.signal : c.muted) : c.bad,
        });
      });
      stage.text(`Latest committed: v${com}`, coX, cy + co.h / 2 + 16, { size: 12, weight: 600, align: 'center' });
      if (st.flash > 0) stage.text('Stale read returned!', coX, cy + co.h / 2 + 34, { size: 12, weight: 600, color: c.signal, align: 'center' });
      drawKey(stage, 10, stage.h - 12, [[c.wire, 'write'], [c.ok, 'read, fresh'], [c.signal, 'read, stale'], [c.bad, 'rejected: too few replicas']], w - 20);
    }

    // ---- 3D: replicas on a globe, coordinator in Mumbai ----
    function drawGlobe(dt) {
      const c = stage.colors, ctx = stage.ctx, col = COL(c);
      const cam = kit.cam();
      const R = Math.min(stage.w, stage.h - 24) * 0.38, cx = stage.w / 2, cy = (stage.h - 24) / 2;
      const cyw = Math.cos(cam.yaw), syw = Math.sin(cam.yaw), cp = Math.cos(cam.pitch - 0.4), sp = Math.sin(cam.pitch - 0.4);
      const P = ([x, y, z]) => {
        const x1 = x * cyw - y * syw, y1 = x * syw + y * cyw;
        const depth = y1 * cp - z * sp, up = z * cp + y1 * sp, k = 5 / (5 + depth);
        return { x: cx + x1 * R * k, y: cy - up * R * k, d: depth };
      };
      const ll = (lat, lon, r = 1) => { const a = lat * Math.PI / 180, b = lon * Math.PI / 180; return [r * Math.cos(a) * Math.cos(b), r * Math.cos(a) * Math.sin(b), r * Math.sin(a)]; };
      const front = v => P(v).d < 0.05;
      const hidden = v => { const q = P(v), o = P([0, 0, 0]); return q.d > 0 && Math.hypot(q.x - o.x, q.y - o.y) < R * 0.98; };
      const arc = (a, b, steps = 40, lift = 0.22) => {
        const A = ll(a[0], a[1]), B = ll(b[0], b[1]), ang = Math.acos(clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1)), out = [];
        for (let i = 0; i <= steps; i++) {
          const t = i / steps, sn = Math.sin(ang) || 1, ka = ang ? Math.sin((1 - t) * ang) / sn : 1 - t, kb = ang ? Math.sin(t * ang) / sn : t;
          const m = 1 + lift * Math.sin(Math.PI * t) * Math.min(1, ang * 1.4);
          out.push([(A[0] * ka + B[0] * kb) * m, (A[1] * ka + B[1] * kb) * m, (A[2] * ka + B[2] * kb) * m]);
        }
        return out;
      };
      const g = ctx.createRadialGradient(cx - R * 0.35, cy - R * 0.4, R * 0.1, cx, cy, R);
      g.addColorStop(0, c.surface3); g.addColorStop(1, c.bg2);
      stage.ring(cx, cy, R, { fill: g, color: c.wire, width: 1.2 });
      ctx.save(); ctx.strokeStyle = c.wire; ctx.globalAlpha = 0.18; ctx.lineWidth = 1;
      const grid = pts => { let on = false; ctx.beginPath(); for (const v of pts) { const q = P(v); if (q.d < 0.05) { if (on) ctx.lineTo(q.x, q.y); else ctx.moveTo(q.x, q.y); on = true; } else on = false; } ctx.stroke(); };
      for (let lat = -60; lat <= 60; lat += 30) { const pts = []; for (let lon = -180; lon <= 180; lon += 6) pts.push(ll(lat, lon)); grid(pts); }
      for (let lon = -180; lon < 180; lon += 30) { const pts = []; for (let lat = -90; lat <= 90; lat += 6) pts.push(ll(lat, lon)); grid(pts); }
      ctx.restore();
      const n = st.c.replicas.length, arcs = st.c.replicas.map((_, i) => arc(HOME, CITIES[i]));
      arcs.forEach((pts, i) => {
        // split the arc into runs that are in front of / behind the globe, draw each run as one dashed path
        let run = [], back = null;
        const flush = () => {
          if (run.length < 2) return;
          ctx.save(); ctx.strokeStyle = c.wire; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
          ctx.globalAlpha = (st.c.replicas[i].up ? 0.7 : 0.2) * (back ? 0.15 : 1);
          ctx.beginPath(); run.forEach((q, k) => (k ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y))); ctx.stroke(); ctx.restore();
        };
        for (const v of pts) {
          const hid = hidden(v), q = P(v);
          if (back !== null && hid !== back) { run.push(q); flush(); run = [q]; } else run.push(q);
          back = hid;
        }
        flush();
      });
      const home = P(ll(...HOME));
      st.parts = st.parts.filter(pt => {
        pt.t += dt;
        if (pt.t >= pt.dur) return false;
        const f = pt.t / pt.dur;
        if (pt.kind === 'x') { if (f > 0.4) stage.dot(home.x, home.y, 4 + f * 8, col.x, 1 - f); return true; }
        if (pt.i >= n) return false;
        const pts = arcs[pt.i], u = pt.kind === 'w' ? f : f < 0.5 ? f * 2 : 2 - f * 2, v = pts[Math.round(u * (pts.length - 1))], q = P(v);
        stage.dot(q.x, q.y, 3.6, col[pt.kind], hidden(v) ? 0.2 : 1);
        return true;
      });
      const com = st.c.committed;
      st.c.replicas.forEach((r, i) => {
        const v = ll(CITIES[i][0], CITIES[i][1]), q = P(v), vis = front(v), behind = com - r.ver;
        stage.dot(q.x, q.y, 6, r.up ? (behind > 0 ? c.signal : c.ok) : c.bad, vis ? 1 : 0.3);
        if (vis) stage.text(`${CITIES[i][2]} · ${r.up ? (behind > 0 ? `v${r.ver} (${behind} behind)` : `v${r.ver}`) : 'down'}`, q.x + 9, q.y, { size: 11, weight: 600, color: r.up ? c.ink : c.bad });
      });
      stage.dot(home.x, home.y, 7, c.ink);
      stage.text(`Coordinator · Mumbai · W=${s.w} R=${s.r}`, home.x - 11, home.y, { size: 11, weight: 700, align: 'right' });
      stage.text(st.flash > 0 ? 'Stale read returned!' : `Latest committed: v${com} · far replicas lag behind · drag to turn`, stage.w / 2, stage.h - 12, { size: 12, weight: 600, color: st.flash > 0 ? c.signal : c.muted, align: 'center' });
    }

    kit.loop(dt => { fixedSteps(st, dt, step); draw(dt); });
    reset();

    return {
      reset,
      guidedRun() {
        nSeg.set(3, true); s.n = 3;
        wS.input.max = 3; rS.input.max = 3;
        wS.set(1, true); s.w = 1; rS.set(1, true); s.r = 1;
        delay.set(1200, true); s.delay = 1.2;
        repair.set(false, true); s.repair = false;
        reset();
        unpause();
        kit.log('Guided run: N = 3, W = 1, R = 1, replication takes about 1.2 s');
      },
    };
  },
};
