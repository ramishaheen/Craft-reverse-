// Query plans: one query — a customer's 20 latest paid orders — under three index choices.
// Model (rough cost per row): sequential read 0.0002 ms, random index read 0.004 ms,
// filter 0.00005 ms, sort 0.0004 ms × log2(n) per row. 60% of a customer's orders are paid.
// No index: scan and filter every row, then sort all matches. (customer_id): read only that
// customer's rows through the index, filter, sort. (customer_id, status, created_at): walk the index
// backwards, already filtered and ordered, and stop after 20 rows — no sort step.

import { pct, hide3dButton, unpause } from './_a-util.js';

const COST = { seq: 2e-4, rand: 0.004, sortPerRowLog: 4e-4, filter: 5e-5 };
const LIMIT = 20;
const fmtRows = v => (v >= 1e6 ? `${(v / 1e6).toFixed(v >= 1e7 || v % 1e6 === 0 ? 0 : 1)}M` : v >= 1000 ? `${(v / 1000).toFixed(v % 1000 ? 1 : 0)}k` : String(Math.round(v)));
const fmtTime = t => (t >= 1000 ? `${(t / 1000).toFixed(1)} s` : t >= 1 ? `${t.toFixed(0)} ms` : `${t.toFixed(2)} ms`);
const INDEX_NAME = { none: 'no index', customer: 'an index on (customer_id)', composite: 'the composite index (customer_id, status, created_at)' };

function plan({ rows, perCustomer, paid = 0.6, index }) {
  const mine = Math.min(rows, perCustomer), matches = Math.round(mine * paid), out = Math.min(LIMIT, matches);
  const steps = [];
  let ms = 0, read = 0;
  if (index === 'none') {
    read = rows; ms += rows * COST.seq + rows * COST.filter;
    steps.push({ op: 'Seq Scan on orders', rows, note: 'reads every row' },
      { op: 'Filter: customer_id = ? AND status = paid', rows: matches, note: `${(rows - matches).toLocaleString('en-US')} rows thrown away` });
  } else if (index === 'customer') {
    read = mine; ms += mine * COST.rand + mine * COST.filter;
    steps.push({ op: 'Index Scan using idx_customer', rows: mine, note: 'only this customer’s orders' },
      { op: 'Filter: status = paid', rows: matches, note: `${(mine - matches).toLocaleString('en-US')} rows thrown away` });
  } else {
    read = out; ms += out * COST.rand;
    steps.push({ op: 'Index Scan Backward using idx_cust_status_created', rows: out, note: 'already filtered and in date order' });
  }
  const sorted = index !== 'composite';
  if (sorted) { ms += matches * Math.log2(Math.max(2, matches)) * COST.sortPerRowLog; steps.push({ op: 'Sort by created_at DESC', rows: matches, note: 'every match sorted just to keep 20' }); }
  steps.push({ op: `Limit ${LIMIT}`, rows: out, note: '' });
  return { steps: steps.reverse(), ms, read, out, sorted };
}

export default {
  lead: `One query that nearly every app runs: a customer’s 20 latest paid orders. The database turns it into a plan of steps, read from the bottom up, each passing rows to the next. Without an index it reads the whole table; a good index reads only what it needs, already in order, and stops after 20 rows.
    <pre style="margin:10px 0 0;white-space:pre-wrap;background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:10px 12px;font:13px/1.5 var(--font-mono, ui-monospace, monospace)">SELECT * FROM orders
WHERE customer_id = ? AND status = 'paid'
ORDER BY created_at DESC LIMIT 20;</pre>`,
  emptyLog: 'Nothing yet. Pick an index.',
  stageHeight: 380,
  tryThis: [
    'With <b>None</b>, grow the table to 100 million rows. The plan scans everything to return 20 rows.',
    'Pick <b>(customer_id)</b>. Only this customer’s rows are read, but they still have to be filtered and sorted. Give the customer 100,000 orders and it slows down again.',
    'Pick the <b>composite</b> index. The sort step vanishes and the scan stops after 20 rows, whatever the sizes.',
  ],
  inShort: {
    what: 'Optimising a query means reading the execution plan the database chose (EXPLAIN) and adding the index that lets it read the fewest rows.',
    why: 'The same query can take 25 seconds or a fraction of a millisecond depending on whether an index fits it.',
    tradeoff: 'Every index speeds up its queries but slows each write and takes space, so index for the queries you really run, not every column.',
    interview: 'Run EXPLAIN ANALYZE, look for sequential scans and sorts on big tables, and add a composite index with the equality columns first and the ORDER BY column last.',
  },
  quiz: [
    { q: 'EXPLAIN shows “Seq Scan” on a 100-million-row table for a query that returns 20 rows. What does it mean?', o: ['It is optimal', 'The database reads every row because no index fits the WHERE clause', 'The table is empty', 'The cache is warm'], a: 1,
      why: 'A sequential scan reads the whole table; an index that matches the filter avoids it.' },
    { q: 'Why can the composite index (customer_id, status, created_at) skip the Sort step?', o: ['Sorting is switched off', 'Rows come out of the index already filtered and in created_at order', 'It caches the results', 'It uses more memory'], a: 1,
      why: 'With the equality columns first and the ORDER BY column last, index order is result order, so LIMIT can stop early.' },
    { q: 'An index on customer_id alone is fast for most customers but slow for one very large customer. Why?', o: ['Bad luck', 'It still reads, filters and sorts all of that customer’s rows to return 20', 'Indexes expire', 'The customer is blocked'], a: 1,
      why: 'Cost grows with the rows the index matches, so skewed data needs the more specific index.' },
  ],
  guided: {
    intro: 'Start with no index on a 100-million-row table, then add the composite index.',
    example: '“Run the guided example” sets 100 million orders, 316 orders for this customer and no index, then switches to the composite index after 2 seconds.',
    question: 'What happens to the rows read when the composite index is added?',
    predictions: ['They drop from 100 million to 20, and the sort step disappears.', 'They halve, but the sort is still needed.', 'Nothing changes: the table is the same size.'],
    correctPrediction: 0,
    running: 'Watch the plan boxes and the “Rows read” number.',
    observation: 'The plan became a single backward index scan that reads 20 rows and needs no sort.',
    explainQuestion: 'Why is the composite index so effective here?',
    explanations: ['Its order matches the WHERE and ORDER BY, so rows come out filtered and sorted and the scan stops at 20.', 'It stores a copy of the query result.', 'It makes the disk faster.'],
    correctExplanation: 0,
    why: 'Equality columns first, then the ORDER BY column: the database walks straight to the answer and LIMIT ends the walk.',
    retryHint: 'Compare the plan before and after: count the steps and the rows on the bottom one.',
    nextSlug: 'elasticsearch-inverted-index',
    nextLabel: 'Next experiment: search index →',
    waitSeconds: 6,
  },

  setup(kit) {
    const { stage } = kit;
    hide3dButton(kit);
    const s = { rows: 1e6, perCustomer: Math.round(Math.pow(10, 2.5)), paid: 0.6, index: 'none' };
    let P = plan(s);

    kit.metrics([{ key: 'read', label: 'Rows read' }, { key: 'ms', label: 'Query time (rough)' }, { key: 'sort', label: 'Sort step' }, { key: 'out', label: 'Rows returned' }]);

    const p = kit.panel;
    const idx = p.seg('Index on orders', { options: [['none', 'None'], ['customer', '(customer_id)'], ['composite', '(customer_id, status, created_at)']], value: 'none',
      onChange: v => { s.index = v; update(); describe(); } });
    const rows = p.slider('Rows in orders', { min: 4, max: 8, step: 0.5, value: 6, format: v => fmtRows(Math.round(Math.pow(10, v))), onInput: v => { s.rows = Math.round(Math.pow(10, v)); update(); } });
    const mine = p.slider('Orders of this customer', { min: 1, max: 5, step: 0.5, value: 2.5, format: v => fmtRows(Math.round(Math.pow(10, v))), hint: 'A big business customer can have tens of thousands',
      onInput: v => { s.perCustomer = Math.round(Math.pow(10, v)); update(); } });

    function update() {
      P = plan(s);
      kit.metric('read', fmtRows(P.read), P.read > 1e5 ? 'bad' : P.read > 1e3 ? 'warn' : 'good');
      kit.metric('ms', fmtTime(P.ms), P.ms > 100 ? 'bad' : P.ms > 5 ? 'warn' : 'good');
      kit.metric('sort', P.sorted ? 'needed' : 'none', P.sorted ? 'warn' : 'good');
      kit.metric('out', String(P.out));
    }
    function describe() {
      kit.log(`With ${INDEX_NAME[s.index]}: ${P.steps.length} steps, ${fmtRows(P.read)} rows read, about ${fmtTime(P.ms)}${P.sorted ? ', sort needed' : ', no sort'}`);
      if (s.index === 'composite') kit.guided.observe(`With the composite index the plan reads ${fmtRows(P.read)} rows (out of ${fmtRows(s.rows)}) in about ${fmtTime(P.ms)}, with no sort step.`);
    }

    function draw() {
      stage.clear();
      const c = stage.colors, ctx = stage.ctx, w = stage.w, H = stage.h, narrow = w < 520, n = P.steps.length;
      const x = narrow ? 14 : w * 0.12, bw = narrow ? w - 28 : w * 0.76, gap = narrow ? 16 : 30;
      const bh = Math.min(narrow ? 40 : 48, (H - 30 - (n - 1) * gap) / n), top = (H - (n * bh + (n - 1) * gap)) / 2;
      stage.text(narrow ? 'plan (read bottom-up)' : 'execution plan · rows flow upward, as in EXPLAIN ANALYZE', 14, 10, { size: 10, color: c.muted });
      const logMax = Math.log10(Math.max(10, s.rows)), roomy = bh >= 38;
      P.steps.forEach((st, i) => {
        const note = roomy ? st.note : '', y = top + i * (bh + gap), last = i === n - 1;
        const badStep = (last && s.index === 'none') || st.op.startsWith('Sort');
        stage.rect(x, y, bw, bh, { fill: c.surface, stroke: badStep ? c.bad : last ? c.ok : c.line, width: 1.4 });
        stage.text(st.op, x + 10, y + bh / 2 - (note ? 7 : 0), { size: narrow ? 10 : 12, weight: 700, maxWidth: bw - 90 });
        if (note) stage.text(note, x + 10, y + bh / 2 + 8, { size: narrow ? 9 : 10, color: badStep ? c.bad : c.muted });
        stage.text(`${fmtRows(st.rows)} rows`, x + bw - 10, y + bh / 2 - (note ? 7 : 0), { size: narrow ? 10 : 11, weight: 600, align: 'right' });
        if (i > 0) {
          const ax = x + bw / 2, y1 = y, y0 = y - gap;
          const lw = Math.max(1.5, ((narrow ? 6 : 10) * Math.log10(Math.max(1, st.rows))) / logMax);
          const col = st.rows > 1e5 ? c.bad : st.rows > 1e3 ? c.signal : c.ok;
          stage.line(ax, y1, ax, y0 + 6, { color: col, width: lw });
          ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(ax - 6 - lw / 2, y0 + 8); ctx.lineTo(ax + 6 + lw / 2, y0 + 8); ctx.lineTo(ax, y0); ctx.closePath(); ctx.fill();
        }
      });
    }

    kit.loop(() => draw());
    update();

    let timer = 0;
    kit.onCleanup(() => clearTimeout(timer));
    return {
      reset() { idx.set('none'); rows.set(6); mine.set(2.5); },
      guidedRun() {
        clearTimeout(timer);
        idx.set('none', true); s.index = 'none';
        rows.set(8, true); s.rows = 1e8;
        mine.set(2.5, true); s.perCustomer = Math.round(Math.pow(10, 2.5));
        update(); describe();
        unpause();
        timer = setTimeout(() => { idx.set('composite', true); s.index = 'composite'; update(); describe(); }, 2000);
      },
    };
  },
};
