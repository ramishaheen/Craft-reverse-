// SQL vs NoSQL: the same workload on one relational primary (+2 read replicas) and on a sharded
// key-value / document store.
// Model (steady state, recomputed whenever a control moves): the "joins and transactions" share is
// split evenly between joins and multi-row transactions; the rest are lookups by key.
// SQL: the primary (15,000 ops/s) handles every join and transaction and a third of the lookups
// (replicas take the rest). Base latencies 1.5 / 6 / 5 ms, scaled by 1/(1−ρ); overloaded at ρ ≥ 0.98.
// NoSQL: 10,000 ops/s per node. A join becomes 3 lookups from the app and a transaction 2 separate
// writes, each paying lookup time + a 2 ms round trip. 2% of those multi-document updates are left
// half done, and 3% of reads may be stale (eventual consistency).

import { clamp, pct, hide3dButton, unpause } from './_a-util.js';

const SQL = { cap: 15000, replicas: 2, key: 1.5, join: 6, txn: 5 };
const NO = { capPerNode: 10000, key: 1.5, rtt: 2, lookupsPerJoin: 3, halfDone: 0.02, stale: 0.03 };
const queue = (base, rho) => (rho >= 0.98 ? Infinity : base / (1 - rho));

function model({ load, rel, nodes }) {
  const join = (load * rel) / 2, txn = (load * rel) / 2, key = load - join - txn;
  const sqlRho = (join + txn + key / (1 + SQL.replicas)) / SQL.cap;
  const sql = { rho: sqlRho, lat: { key: queue(SQL.key, sqlRho), join: queue(SQL.join, sqlRho), txn: queue(SQL.txn, sqlRho) }, anomalies: 0, stale: 0 };
  const noRho = (key + join * NO.lookupsPerJoin + txn * 2) / (NO.capPerNode * nodes);
  const k = queue(NO.key, noRho);
  const nosql = { rho: noRho, lat: { key: k, join: (k + NO.rtt) * NO.lookupsPerJoin, txn: (k + NO.rtt) * 2 }, anomalies: txn * NO.halfDone, stale: NO.stale };
  const avg = m => (load ? (key * m.lat.key + join * m.lat.join + txn * m.lat.txn) / load : 0);
  sql.avg = avg(sql); nosql.avg = avg(nosql);
  sql.maxLoad = SQL.cap / (rel + (1 - rel) / (1 + SQL.replicas));
  nosql.maxLoad = (NO.capPerNode * nodes) / (1 - rel + (rel / 2) * NO.lookupsPerJoin + rel);
  return { sql, nosql };
}

export default {
  lead: 'A relational database gives you joins and transactions on one primary, with replicas for reads, but writes stop at what that primary can take. A key-value or document store spreads data over many nodes and scales out, yet joins turn into several round trips from your code and a multi-document update can half succeed. Change the workload and see which fits.',
  emptyLog: 'Nothing yet. Move the sliders.',
  stageHeight: 330,
  tryThis: [
    'Set joins to <b>5%</b> and push requests to <b>40,000</b>. The single SQL primary saturates; add NoSQL nodes and that side keeps going.',
    'Set joins to <b>70%</b> at 5,000 requests. SQL is quicker and every order stays consistent; NoSQL pays for round trips and leaves some updates half done.',
    'Look for the crossover: most real systems keep orders and money in SQL and use a NoSQL store for high-volume lookups such as sessions, carts and feeds.',
  ],
  inShort: {
    what: 'SQL databases keep related tables with joins and transactions on a primary; NoSQL stores spread keys or documents over many nodes.',
    why: 'The choice decides how far writes can scale and how much consistency your own code has to provide.',
    tradeoff: 'SQL gives joins, transactions and fresh reads but has a write ceiling per primary; NoSQL scales out but pushes joins and atomicity into the application.',
    interview: 'Postgres for orders, payments and anything relational; DynamoDB, Cassandra or Redis for high-volume key access such as sessions, carts and feeds.',
  },
  quiz: [
    { q: 'Your app does mostly simple lookups by key, at very high volume. Which fits better?', o: ['A single SQL primary', 'A sharded key-value or document store that scales out with more nodes', 'A spreadsheet', 'Neither'], a: 1,
      why: 'Lookups by key need no joins, so spreading them over many nodes scales almost linearly.' },
    { q: 'Why are joins slower in many NoSQL stores?', o: ['They are not', 'The app fetches each related record itself, one network round trip at a time', 'NoSQL disks are slow', 'Joins are not allowed'], a: 1,
      why: 'Without joins on the server, data is either denormalised or stitched together in application code.' },
    { q: 'An order must take the money and reduce the stock together, or not at all. What matters most?', o: ['Raw throughput', 'Multi-row transactions (all or nothing), which relational databases provide directly', 'A flexible schema', 'Eventual consistency'], a: 1,
      why: 'Money and stock need atomic updates; many systems keep them in SQL and use NoSQL for the rest.' },
  ],
  guided: {
    intro: 'Mostly simple lookups, then a big rise in traffic.',
    example: '“Run the guided example” sets joins to 5% and 8 NoSQL nodes, then raises traffic from 8,000 to 45,000 requests/s over a few seconds.',
    question: 'Which database keeps up as traffic climbs?',
    predictions: ['The SQL primary saturates; the NoSQL store keeps up.', 'Both saturate at the same point.', 'SQL keeps up; NoSQL saturates first.'],
    correctPrediction: 0,
    running: 'Watch the load bars inside the primary and the shards, and the two average latencies.',
    observation: 'The SQL primary ran out of capacity while the NoSQL shards still had room.',
    explainQuestion: 'Why did the SQL side hit a ceiling?',
    explanations: ['Every write and a share of reads go through one primary, while the NoSQL store spreads lookups across many nodes.', 'SQL queries are always slower than NoSQL ones.', 'The SQL replicas went offline.'],
    correctExplanation: 0,
    why: 'For simple keyed traffic, scaling out wins. With many joins and transactions the picture flips: try 70% joins at low load.',
    retryHint: 'Compare “Max load: SQL / NoSQL” with the request rate.',
    nextSlug: 'query-optimization',
    nextLabel: 'Next experiment: query plans →',
    waitSeconds: 10,
  },

  setup(kit) {
    const { stage } = kit;
    hide3dButton(kit);
    const s = { load: 8000, rel: 0.3, nodes: 4 };
    let r = model(s), dots = [], prev = null;
    const fmtLat = v => (v === Infinity ? 'overloaded' : `${v.toFixed(1)} ms`);
    const fin = v => (Number.isFinite(v) ? v : 60);

    kit.metrics([{ key: 'sql', label: 'SQL average latency' }, { key: 'nosql', label: 'NoSQL average latency' }, { key: 'max', label: 'Max load: SQL / NoSQL' }, { key: 'anom', label: 'NoSQL half-done updates per second' }]);

    const p = kit.panel;
    const load = p.slider('Requests per second', { min: 1000, max: 60000, step: 1000, value: 8000, format: v => kit.fmt(v), onInput: v => { s.load = v; update(); } });
    const rel = p.slider('Joins and multi-row transactions', { min: 0, max: 80, step: 5, value: 30, format: v => `${v}%`, hint: 'The rest are simple lookups by key', onInput: v => { s.rel = v / 100; update(); } });
    const nodes = p.slider('NoSQL nodes', { min: 1, max: 16, step: 1, value: 4, onInput: v => { s.nodes = v; update(); } });

    function update() {
      r = model(s);
      kit.metric('sql', fmtLat(r.sql.avg), r.sql.avg > r.nosql.avg * 1.2 ? 'bad' : 'good');
      kit.metric('nosql', fmtLat(r.nosql.avg), r.nosql.avg > r.sql.avg * 1.2 ? 'bad' : 'good');
      kit.metric('max', `${kit.fmt(r.sql.maxLoad)} / ${kit.fmt(r.nosql.maxLoad)}`);
      kit.metric('anom', r.nosql.anomalies.toFixed(0), r.nosql.anomalies > 10 ? 'bad' : r.nosql.anomalies > 0 ? 'warn' : 'good');
      const now = { sqlOver: r.sql.avg === Infinity, noOver: r.nosql.avg === Infinity, faster: r.sql.avg <= r.nosql.avg ? 'SQL' : 'NoSQL' };
      if (prev) {
        if (now.sqlOver && !prev.sqlOver) {
          kit.log(`The SQL primary is overloaded at ${kit.fmt(s.load)} requests/s (its limit for this mix is about ${kit.fmt(r.sql.maxLoad)})`);
          if (!now.noOver) kit.guided.observe(`At ${kit.fmt(s.load)} requests/s the SQL primary passed its limit of about ${kit.fmt(r.sql.maxLoad)}, while ${s.nodes} NoSQL nodes could take about ${kit.fmt(r.nosql.maxLoad)}.`);
        }
        if (!now.sqlOver && prev.sqlOver) kit.log('The SQL primary is back under its limit');
        if (now.noOver && !prev.noOver) kit.log(`The NoSQL nodes are overloaded: ${s.nodes} node${s.nodes > 1 ? 's' : ''} take about ${kit.fmt(r.nosql.maxLoad)} requests/s for this mix`);
        if (!now.noOver && prev.noOver) kit.log('The NoSQL nodes are back under their limit');
        if (!now.sqlOver && !now.noOver && !prev.sqlOver && !prev.noOver && now.faster !== prev.faster) kit.log(`${now.faster} now has the lower average latency`);
      }
      prev = now;
    }

    function step(dt) {
      if (Math.random() < dt * Math.min(30, s.load / 800)) dots.push({ t: 0, side: Math.random() < 0.5 ? 0 : 1, kind: Math.random() < s.rel ? (Math.random() < 0.5 ? 'join' : 'txn') : 'key', lane: Math.random() });
      for (const d of dots) d.t += dt * 1.5;
      dots = dots.filter(d => d.t < 1);
    }

    function draw() {
      stage.clear();
      const c = stage.colors, ctx = stage.ctx, w = stage.w, H = stage.h, narrow = w < 520;
      const pad = 14, mid = narrow ? 10 : 24, colW = (w - 2 * pad - mid) / 2, xs = [pad, pad + colW + mid];
      const top = 8, head = narrow ? 16 : 20, rowH = narrow ? 18 : 22;
      const kc = { key: c.wire, join: c.violet, txn: c.signal };
      const scale = Math.max(20, ...['key', 'join', 'txn'].flatMap(k => [Math.min(60, fin(r.sql.lat[k])), Math.min(60, fin(r.nosql.lat[k]))]));
      [['SQL (relational)', r.sql], ['NoSQL (key-value / document)', r.nosql]].forEach(([name, m], side) => {
        const x = xs[side];
        stage.text(narrow ? name.split(' ')[0] : name, x, top, { size: narrow ? 10 : 12, weight: 700, baseline: 'top' });
        const count = side ? s.nodes : 3, perRow = side ? Math.min(count, narrow ? 4 : 8) : 3, rows = Math.ceil(count / perRow);
        const bw = (colW - (perRow - 1) * 5) / perRow, bh = Math.min(narrow ? 26 : 32, (H * 0.32 - (rows - 1) * 5) / rows), y0 = top + head;
        for (let i = 0; i < count; i++) {
          const bx = x + (i % perRow) * (bw + 5), by = y0 + Math.floor(i / perRow) * (bh + 5);
          const rho = side || i === 0 ? m.rho : m.rho * 0.6, hot = rho >= 0.9, f = Math.min(1, rho);
          stage.rect(bx, by, bw, bh, { fill: c.surface, stroke: hot ? c.bad : c.line, width: 1.2, r: 5 });
          ctx.save(); ctx.globalAlpha = 0.35; ctx.fillStyle = hot ? c.bad : rho > 0.6 ? c.signal : c.ok;
          ctx.fillRect(bx + 1, by + bh - 1 - (bh - 2) * f, bw - 2, (bh - 2) * f); ctx.restore();
          if (bw > 34) stage.text(side ? `shard ${i + 1}` : i ? 'replica' : 'primary', bx + bw / 2, by + bh / 2, { size: narrow ? 8 : 9, weight: 600, align: 'center' });
        }
        const ly = y0 + rows * (bh + 5) + (narrow ? 10 : 16);
        [['key', 'lookup by key'], ['join', 'join'], ['txn', 'transaction']].forEach(([k, label], j) => {
          const y = ly + j * rowH, v = m.lat[k], barW = colW * 0.48, bx = x + colW * 0.5;
          stage.text(label, x, y + 6, { size: narrow ? 9 : 10, color: c.muted });
          ctx.fillStyle = c.surface2; ctx.fillRect(bx, y, barW, 12);
          ctx.save(); ctx.globalAlpha = 0.8; ctx.fillStyle = v === Infinity ? c.bad : kc[k]; ctx.fillRect(bx, y, barW * Math.min(1, fin(v) / scale), 12); ctx.restore();
          stage.text(fmtLat(v), bx + barW - 3, y + 6, { size: 9, weight: 600, align: 'right' });
        });
        const ty = ly + 3 * rowH + (narrow ? 6 : 10), lh = narrow ? 13 : 15, sz = narrow ? 9 : 10;
        stage.text(side ? (narrow ? `${m.anomalies.toFixed(0)} half-done/s` : `transactions: ${m.anomalies.toFixed(0)} half-done updates/s`) : (narrow ? 'atomic' : 'transactions: all-or-nothing'), x, ty, { size: sz, weight: 600, baseline: 'top', color: side ? c.bad : c.ok });
        stage.text(side ? (narrow ? `${pct(m.stale)} stale reads` : `reads: ${pct(m.stale)} may be stale (eventual)`) : (narrow ? 'fresh reads' : 'reads: fresh from the primary'), x, ty + lh, { size: sz, weight: 600, baseline: 'top', color: side ? c.signal : c.ok });
        stage.text(`max ≈ ${kit.fmt(m.maxLoad)} requests/s`, x, ty + lh * 2, { size: 9, color: c.muted, baseline: 'top' });
      });
      for (const d of dots) stage.dot(xs[d.side] + colW * d.lane, top + head - 8 + d.t * 12, 2, kc[d.kind], 1 - d.t);
    }

    kit.loop(dt => { if (dt > 0) step(Math.min(dt, 0.1)); draw(); });
    update();

    let ramp = null;
    kit.onCleanup(() => ramp?.());
    p.onUserChange(() => { ramp?.(); ramp = null; });
    return {
      reset() { load.set(8000); rel.set(30); nodes.set(4); },
      guidedRun() {
        ramp?.();
        rel.set(5, true); s.rel = 0.05;
        nodes.set(8, true); s.nodes = 8;
        load.set(8000, true); s.load = 8000;
        prev = null; update();
        unpause();
        kit.log('Guided run: 5% joins, 8 NoSQL nodes, traffic climbing to 45,000 requests/s');
        let acc = 0;
        ramp = kit.loop(dt => {
          acc += dt;
          if (acc < 0.4) return;
          acc = 0;
          const v = Math.min(45000, s.load + 3000);
          load.set(v, true); s.load = v; update();
          if (v >= 45000) { ramp(); ramp = null; }
        });
      },
    };
  },
};
