// Capacity planning: back-of-the-envelope estimates from a handful of inputs.
// Model (all per day, a day = 86,400 s):
//   reads/day = DAU × reads per user;  writes/day = DAU × writes per user
//   read QPS = reads/day ÷ 86,400;  write QPS = writes/day ÷ 86,400;  peak = (read + write QPS) × peak factor
//   storage = writes/day × write size × 365 × years × copies
//   bandwidth in = write QPS × write size;  out = read QPS × read size
//   cache = 20% of a day's read bytes (the 80/20 rule)
//   app servers = ceil(peak ÷ per-server QPS) + 1 spare (minimum 2); DB nodes at 10 TB; cache nodes at 64 GB.

import { addCard, bytes, count, no3d } from './_b-kit.js';
import { h } from '../../js/core/dom.js';

const LISTS = {
  dau: [1e5, 1e6, 5e6, 1e7, 5e7, 1e8, 3e8, 5e8, 1e9],
  readsPerUser: [1, 2, 5, 10, 20, 30, 40, 50, 100, 200],
  writesPerUser: [0.1, 0.5, 1, 2, 5, 10, 20, 40],
  readBytes: [100, 300, 500, 1e3, 5e3, 2e4, 1e5, 3e5, 1e6],
  writeBytes: [100, 300, 500, 1e3, 2e3, 1e4, 1e5, 1e6, 2e6, 5e6],
  serverQps: [200, 500, 800, 1e3, 2e3, 3e3, 5e3, 1e4],
};
const PRESETS = {
  shortener: { label: 'URL shortener', dau: 1e8, readsPerUser: 10, writesPerUser: 1, readBytes: 500, writeBytes: 500, years: 5, replication: 3, peak: 3, cacheShare: 0.2, serverQps: 2e3 },
  social: { label: 'Social feed', dau: 3e8, readsPerUser: 50, writesPerUser: 2, readBytes: 2e4, writeBytes: 2e3, years: 5, replication: 3, peak: 3, cacheShare: 0.2, serverQps: 1e3 },
  chat: { label: 'Chat app', dau: 5e8, readsPerUser: 40, writesPerUser: 40, readBytes: 300, writeBytes: 300, years: 3, replication: 3, peak: 2, cacheShare: 0.1, serverQps: 3e3 },
  photos: { label: 'Photo sharing', dau: 5e7, readsPerUser: 30, writesPerUser: 0.5, readBytes: 3e5, writeBytes: 2e6, years: 10, replication: 3, peak: 2.5, cacheShare: 0.2, serverQps: 800 },
};
const NODE_BYTES = 1e13, CACHE_NODE_BYTES = 64e9, DAY = 86400;
const LATENCY = [
  ['L1 cache hit', 1e-9], ['Main memory access', 1e-7], ['Compress 1 KB with a fast codec', 2e-6], ['Read 1 MB from memory', 3e-6],
  ['Random read on an SSD', 16e-6], ['Read 1 MB from an SSD', 5e-5], ['Round trip inside one data centre', 5e-4],
  ['Read 1 MB from a spinning disk', 8e-4], ['Disk seek', 0.002], ['Round trip Europe ↔ US', 0.15],
];

export function estimate(p) {
  const readsDay = p.dau * p.readsPerUser, writesDay = p.dau * p.writesPerUser;
  const readQps = readsDay / DAY, writeQps = writesDay / DAY, qps = readQps + writeQps, peakQps = qps * p.peak;
  const storageDay = writesDay * p.writeBytes, storageTotal = storageDay * 365 * p.years * p.replication;
  const cacheBytes = readsDay * p.readBytes * p.cacheShare;
  return {
    readsDay, writesDay, readQps, writeQps, qps, peakQps, storageDay, storageTotal,
    ingress: writeQps * p.writeBytes, egress: readQps * p.readBytes, cacheBytes,
    appServers: Math.max(2, Math.ceil(peakQps / p.serverQps) + 1),
    dbNodes: Math.max(1, Math.ceil(storageTotal / NODE_BYTES)),
    cacheNodes: Math.max(1, Math.ceil(cacheBytes / CACHE_NODE_BYTES)),
  };
}

export default {
  lead: 'Real designs and interviews both begin with rough numbers: requests per second, storage, and how many machines that adds up to. Change any input and every estimate, every line of the working and the fleet picture follow along.',
  emptyLog: 'Nothing yet. Pick a classic question or move an input.',
  stageHeight: 340,
  tryThis: [
    'Start from the <b>URL shortener</b>, then switch to the <b>Social feed</b>. Watch the app-server row explode: big responses and many reads per user add up fast.',
    'Raise <b>Copies of each item</b> from 1 to 3. Storage triples, which is why replication shows up in every storage estimate.',
    'Set <b>Peak ÷ average traffic</b> to ×6. Servers are sized for the peak, so the fleet doubles even though the daily total did not change.',
  ],
  inShort: {
    what: 'Back-of-the-envelope maths converts a user count into requests per second, yearly storage and a number of machines.',
    why: 'The numbers drive the design: 100 requests per second fits on one box, while 100,000 calls for sharding, caches and queues.',
    tradeoff: 'The estimates are deliberately rough. Round aggressively (a day is about 100,000 seconds) and size for peak traffic rather than the average.',
    interview: '10 million daily users × 10 requests ÷ 100,000 seconds is about 1,000 requests per second, roughly 3,000 at peak.',
  },
  quiz: [
    { q: 'For quick estimates, roughly how many seconds does a day have?', o: ['10³', '10⁴', '10⁵', '10⁶'], a: 2,
      why: '86,400 seconds is close to 10⁵, so dividing a daily total by a day becomes simple.' },
    { q: '100 million users each do 10 reads per day. What is the average read QPS, roughly?', o: ['1,000', '12,000', '120,000', '1.2 million'], a: 1,
      why: '10⁹ reads ÷ about 86,400 s ≈ 11,600 per second, so around 12k. The peak would be a few times that.' },
    { q: 'Why does a storage estimate multiply by a replication factor?', o: ['Compression makes data larger', 'Every item is kept on several machines for durability and availability', 'Indexes are three times the size of the data', 'To turn bytes into bits'], a: 1,
      why: 'Three copies is a common choice, so the raw disk needed is about three times the logical data.' },
  ],
  guided: {
    intro: 'Compare two classic interview questions and see what changes the size of the fleet.',
    example: '“Run the guided example” loads the URL shortener estimate, then switches to the social feed.',
    question: 'Going from the URL shortener to the social feed, what happens to the number of app servers?',
    predictions: ['It grows by more than twenty times.', 'It roughly doubles.', 'It stays about the same, because servers are sized for storage.'],
    correctPrediction: 0,
    running: 'Watch the “App servers” row in the drawing and the last line of the working.',
    observation: 'The social feed needs hundreds of app servers where the shortener needed about twenty.',
    explainQuestion: 'Why did the fleet grow so much?',
    explanations: ['Three times the users each making five times the reads, against servers that each handle half as many requests, multiplies the peak load.', 'The social feed keeps data for longer.', 'The social feed uses more copies of each item.'],
    correctExplanation: 0,
    why: 'Request rate is users × actions per user ÷ a day, times the peak factor; servers are that peak divided by what one server can do.',
    retryHint: 'Compare the “Peak” line and the per-server figure in the working for both questions.',
    nextSlug: 'networking',
    nextLabel: 'Next experiment: networking →',
    waitSeconds: 4,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { ...PRESETS.shortener };
    let est = estimate(s), quiet = false, watch = false;

    kit.metrics([
      { key: 'qps', label: 'Average requests / s' }, { key: 'peak', label: 'Peak requests / s' }, { key: 'store', label: 'Storage, all years' },
      { key: 'egress', label: 'Outgoing bandwidth' }, { key: 'cache', label: 'Cache memory' },
    ]);
    const work = addCard(kit, 'The working, step by step');
    const ol = h('ol', { style: { margin: 0, paddingLeft: '22px', display: 'grid', gap: '6px', lineHeight: 1.55, color: 'var(--text-2)' } });
    work.body.append(ol);

    const p = kit.panel;
    const preset = p.seg('Start from a classic question', { options: Object.entries(PRESETS).map(([k, v]) => [k, v.label]), value: 'shortener', onChange: v => load(v, true) });
    const fmtFor = k => v => (k.endsWith('Bytes') ? bytes(v) : count(v));
    const sliders = {};
    const LABELS = { dau: 'Daily active users', readsPerUser: 'Reads per user per day', writesPerUser: 'Writes per user per day', readBytes: 'Size of one read response', writeBytes: 'Size of one stored write' };
    for (const k of ['dau', 'readsPerUser', 'writesPerUser', 'readBytes', 'writeBytes']) sliders[k] = p.slider(LABELS[k], { values: LISTS[k], value: s[k], format: fmtFor(k), onInput: v => { s[k] = v; update(); } });
    sliders.years = p.slider('Keep data for', { min: 1, max: 10, step: 1, value: s.years, format: v => `${v} year${v === 1 ? '' : 's'}`, onInput: v => { s.years = v; update(); } });
    sliders.replication = p.slider('Copies of each item', { min: 1, max: 5, step: 1, value: s.replication, format: v => `${v} cop${v === 1 ? 'y' : 'ies'}`, onInput: v => { s.replication = v; update(); } });
    sliders.peak = p.slider('Peak ÷ average traffic', { min: 1, max: 6, step: 0.5, value: s.peak, format: v => `×${v}`, onInput: v => { s.peak = v; update(); } });
    sliders.serverQps = p.slider('Requests one app server handles', { values: LISTS.serverQps, value: s.serverQps, format: fmtFor('serverQps'), onInput: v => { s.serverQps = v; update(); } });

    // latency cheat sheet (right column, like the original)
    const lo = Math.log10(1e-9), hi = Math.log10(0.15);
    const fmtT = v => (v < 1e-6 ? `${Math.round(v * 1e9)} ns` : v < 1e-3 ? `${+(v * 1e6).toPrecision(2)} µs` : v < 1 ? `${+(v * 1e3).toPrecision(3)} ms` : `${v} s`);
    const lat = h('div', { style: { display: 'grid', gap: '6px', marginTop: '6px' } },
      LATENCY.map(([name, v]) => h('div', { style: { display: 'grid', gridTemplateColumns: 'minmax(0,1.4fr) minmax(0,1fr) auto', gap: '8px', alignItems: 'center', fontSize: '12.5px' } },
        h('span', { style: { color: 'var(--text-2)' } }, name),
        h('div', { style: { height: '6px', borderRadius: '3px', background: 'var(--surface-3)', overflow: 'hidden' } },
          h('span', { style: { display: 'block', height: '100%', width: `${(4 + (96 * (Math.log10(v) - lo)) / (hi - lo)).toFixed(1)}%`, background: 'var(--accent-2)' } })),
        h('b', { style: { fontVariantNumeric: 'tabular-nums', fontSize: '12px' } }, fmtT(v)))));
    p.heading('Latency numbers to remember');
    p.custom(lat);
    p.note('Orders of magnitude for current hardware; real figures vary.');

    function load(key, log) {
      const pr = PRESETS[key];
      quiet = true;
      Object.assign(s, pr);
      for (const k of Object.keys(sliders)) sliders[k].set(pr[k], true);
      quiet = false;
      update();
      if (log) kit.log(`Loaded “${pr.label}”: ${count(pr.dau)} daily users, ${pr.readsPerUser} reads and ${pr.writesPerUser} writes each, sized for ×${pr.peak} peaks`);
    }

    let lastServers = null;
    function update() {
      if (quiet) return;
      est = estimate(s);
      const e = est, b = x => `<b style="color:var(--text)">${x}</b>`;
      kit.metric('qps', count(e.qps));
      kit.metric('peak', count(e.peakQps), e.peakQps > 1e6 ? 'bad' : e.peakQps > 1e5 ? 'warn' : '');
      kit.metric('store', bytes(e.storageTotal));
      kit.metric('egress', bytes(e.egress) + '/s');
      kit.metric('cache', bytes(e.cacheBytes));
      ol.innerHTML = [
        `Reads per day = ${count(s.dau)} users × ${s.readsPerUser} = ${b(count(e.readsDay))}`,
        `Read QPS = ${count(e.readsDay)} ÷ 86,400 s ≈ ${b(count(e.readQps) + '/s')} <span style="color:var(--text-3)">(shortcut: one day is about 10⁵ s)</span>`,
        `Write QPS = ${count(s.dau)} × ${s.writesPerUser} ÷ 86,400 ≈ ${b(count(e.writeQps) + '/s')}, so reads to writes is about ${b(Math.max(1, Math.round(e.readQps / Math.max(e.writeQps, 1e-9))) + ' : 1')}`,
        `Peak = (${count(e.readQps)} + ${count(e.writeQps)}) × ${s.peak} = ${b(count(e.peakQps) + '/s')}`,
        `New data each day = ${count(e.writesDay)} writes × ${bytes(s.writeBytes)} = ${b(bytes(e.storageDay))}`,
        `Total storage = ${bytes(e.storageDay)} × 365 × ${s.years} years × ${s.replication} copies = ${b(bytes(e.storageTotal))}`,
        `Bandwidth: in ${b(bytes(e.ingress) + '/s')}; out = ${count(e.readQps)}/s × ${bytes(s.readBytes)} = ${b(bytes(e.egress) + '/s')}`,
        `Cache (80/20 rule) = 20% of one day of reads: ${count(e.readsDay)} × ${bytes(s.readBytes)} × ${s.cacheShare} = ${b(bytes(e.cacheBytes))}`,
        `App servers = ${count(e.peakQps)} ÷ ${count(s.serverQps)} per server, plus 1 spare = ${b(e.appServers)}; database nodes at 10 TB each = ${b(e.dbNodes)}; cache nodes at 64 GB each = ${b(e.cacheNodes)}`,
      ].map(x => `<li>${x}</li>`).join('');
      if (watch && lastServers != null && e.appServers !== lastServers) {
        watch = false;
        kit.guided.observe(`App servers went from ${lastServers} to ${e.appServers} (peak ${count(e.peakQps)} requests/s against ${count(s.serverQps)} per server).`);
      }
      lastServers = e.appServers;
    }
    function fleet(x, y, w, label, n, col, round) {
      const c = stage.colors;
      stage.text(`${label}: ${count(n)}`, x, y, { size: 12.5, weight: 700 });
      const sz = round ? 16 : 12, g = 4, perRow = Math.max(1, Math.floor((w - 40) / (sz + g))), shown = Math.min(n, perRow * 2);
      for (let i = 0; i < shown; i++) {
        const bx = x + (i % perRow) * (sz + g), by = y + 12 + Math.floor(i / perRow) * (sz + g);
        stage.rect(bx, by, sz, sz, { fill: col, r: round ? sz / 2.5 : 3 });
      }
      if (n > shown) stage.text(`+${count(n - shown)} more`, x + w, y, { size: 11, weight: 700, color: c.muted, align: 'right' });
    }

    function draw() {
      stage.clear();
      const c = stage.colors, w = stage.w, H = stage.h;
      const cl = (v, a, b) => Math.max(a, Math.min(b, v));
      const users = { x: cl(w * 0.09, 40, 70), y: H * 0.5, w: cl(w * 0.13, 58, 90), h: 44 };
      const lb = { x: users.x + users.w / 2 + cl(w * 0.1, 40, 80), y: H * 0.5, w: cl(w * 0.12, 56, 84), h: 40 };
      const fx = lb.x + lb.w / 2 + 24, fw = w - fx - 12, rows = [H * 0.14, H * 0.44, H * 0.74];
      stage.line(users.x + users.w / 2, users.y, lb.x - lb.w / 2, lb.y, { color: c.wire, alpha: 0.4 });
      for (const ry of rows) stage.line(lb.x + lb.w / 2, lb.y, fx - 4, ry + 16, { color: c.wire, alpha: 0.4 });
      stage.node(users.x - users.w / 2, users.y - users.h / 2, users.w, users.h, { title: 'Users', sub: `${count(s.dau)}/day`, size: 12 });
      stage.node(lb.x - lb.w / 2, lb.y - lb.h / 2, lb.w, lb.h, { title: 'LB', sub: `${count(est.peakQps)}/s`, size: 12 });
      fleet(fx, rows[0], fw, 'App servers', est.appServers, c.wire, false);
      fleet(fx, rows[1], fw, 'Cache nodes', est.cacheNodes, c.ok, false);
      fleet(fx, rows[2], fw, 'Database nodes', est.dbNodes, c.signal, true);
    }

    no3d(kit);
    kit.loop(draw);
    load('shortener', false);

    return {
      reset() { preset.set('shortener', true); load('shortener', false); },
      guidedRun() {
        preset.set('shortener', true); load('shortener', true);
        watch = true;
        setTimeout(() => { preset.set('social', true); load('social', true); }, 1200);
      },
    };
  },
};
