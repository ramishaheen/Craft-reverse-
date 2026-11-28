// Sharding: 60 keys (user:101, user:108, …) are placed on database servers DB-A…DB-J.
// Model: every key and every server point is hashed to a 32-bit number. "hash mod N" puts a key on
// server number (hash mod N). Consistent hashing puts each server on a ring at hash("DB-X#v") for
// v = 0…virtual nodes−1, and a key belongs to the first server point clockwise from its own hash.
// When the server list changes, "keys moved" counts keys whose owner changed, and the comparison
// box recomputes the same change under both strategies. A seven-step lesson walks through it.

import { h, esc } from '../../js/core/dom.js';
import { clamp, pct, ease, hash32, hide3dButton, panelBox, barsHtml } from './_a-util.js';

const RING = 4294967296; // 2^32
const VNODE_STEPS = [1, 2, 5, 10, 50, 100];
const NAMES = 'ABCDEFGHIJ'.split('');
const HUES = [212, 152, 36, 276, 348, 188, 96, 18, 318, 248];

function ringOf(servers, vn) {
  const pts = [];
  for (const s of servers) for (let v = 0; v < vn; v++) pts.push({ h: hash32(`DB-${s}#${v}`), s, v });
  return pts.sort((a, b) => a.h - b.h);
}
function ownerOf(hv, mode, servers, ring) {
  if (mode === 'mod') { const i = hv % servers.length; return { s: servers[i], i }; }
  let lo = 0, hi = ring.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (ring[mid].h < hv) lo = mid + 1; else hi = mid; }
  return ring[lo % ring.length];
}
function movedShare(hashes, mode, from, to, vn) {
  const r1 = ringOf(from, vn), r2 = ringOf(to, vn);
  let n = 0;
  for (const hv of hashes) if (ownerOf(hv, mode, from, r1).s !== ownerOf(hv, mode, to, r2).s) n++;
  return n / hashes.length;
}

const LESSON = [
  { t: 'Why shard at all?', b: 'A single database server can only hold so much data and answer so many queries. Sharding splits the data across several servers, called shards. Each key, such as <code>user:142</code>, lives on exactly one shard, and every app server has to agree on which.',
    d: 'Each dot is a key. Its colour and its box tell you which database server stores it.', set: { mode: 'mod', n: 4, vn: 1 } },
  { t: 'The simple rule: hash mod N', b: 'A hash function turns any key into a large number, always the same one for the same key. Divide it by the number of servers N and keep the remainder: 0 to N−1 picks the server. It is quick and spreads keys evenly.',
    d: 'Type a key of your own in the box under the picture and press <b>Find</b>. Follow the three lines of arithmetic.', focus: 'find', set: { mode: 'mod', n: 4, vn: 1 }, look: true },
  { t: 'The catch: adding a server', b: 'Business grows and a fifth server joins. N is now 5 instead of 4, so the remainder changes for nearly every key. Most keys suddenly belong somewhere else and their data must be copied over. For a cache it is almost the same as emptying it.',
    d: 'Press <b>Add a server</b>. Keys that had to move get an orange ring. Count them.', focus: 'add', set: { mode: 'mod', n: 4, vn: 1 } },
  { t: 'Consistent hashing: a ring', b: 'Hash the servers as well, and place keys and servers on the same circle. A key belongs to the first server you reach walking clockwise from it, so each server owns the arc just before it.',
    d: 'Press <b>Find</b> again and follow the orange arrow clockwise from the key to its server.', focus: 'find', set: { mode: 'ch', n: 4, vn: 1 }, look: true },
  { t: 'A new server on the ring', b: 'A new server lands at one spot and takes over part of a single arc from its neighbour. Every other key stays put. On average only about 1 ÷ N of the keys move.',
    d: 'Press <b>Add a server</b>, then compare with mod N under “How many keys had to move?”.', focus: 'add', set: { mode: 'ch', n: 4, vn: 1 } },
  { t: 'Uneven arcs and virtual nodes', b: 'With one point per server the arcs come out in random sizes, so one server can end up with twice its fair share. The fix is to give each server many points on the ring, called virtual nodes; lots of small arcs even out.',
    d: 'Move <b>Virtual nodes per server</b> from 1 up to 100 and watch “Keys per server” level out.', focus: 'vn', set: { mode: 'ch', n: 4, vn: 1 } },
  { t: 'Where you will meet this', b: 'DynamoDB, Cassandra and Riak place data with consistent hashing, and many Memcached clients use it to choose a cache server. Redis Cluster uses a close cousin: 16,384 fixed hash slots divided between nodes. In an interview, mention virtual nodes and replication: each key is also copied to the next servers clockwise.',
    d: 'Free play: switch strategies, add and remove servers, and try your own keys.', set: null },
];

export default {
  lead: 'Two ways to decide which server stores each key. Step through the short lesson above the picture, or go straight to the controls and add or remove servers.',
  emptyLog: 'Nothing yet. Add a server or look up a key.',
  tryThis: [
    'With <b>hash mod N</b>, add a fifth server and count the orange rings: most keys move.',
    'Switch to <b>consistent hashing</b> and add a server again. Only the keys on one arc change hands.',
    'Set virtual nodes to <b>100</b> and watch “Busiest server share” fall towards the fair share.',
  ],
  inShort: {
    what: 'Sharding splits data across machines by key; consistent hashing places keys and servers on a ring so that adding a server moves only a few keys.',
    why: 'One database can only store and serve so much; sharding spreads both the data and the traffic.',
    tradeoff: 'Queries that span shards are slow and joins get hard, and a poorly chosen shard key creates a hot shard.',
    interview: 'I would shard by user id with consistent hashing and virtual nodes, so adding a node moves only about 1/N of the keys.',
  },
  quiz: [
    { q: 'Using hash(key) mod N, about what share of keys move when you go from 4 servers to 5?', o: ['About 20%', 'About 50%', 'About 80%', 'None'], a: 2,
      why: 'Most remainders change when N changes, so roughly (N−1)/N of keys, around 80% here, end up on a different server.' },
    { q: 'With consistent hashing, roughly how many keys move when one server joins N others?', o: ['All of them', 'About 1/N of them', 'Exactly half', 'None'], a: 1,
      why: 'The newcomer takes over part of one neighbour’s arc; everything else stays where it was.' },
    { q: 'What are virtual nodes for?', o: ['Encrypting keys', 'Spreading each server over many small arcs so the load evens out', 'Keeping extra copies', 'Faster lookups'], a: 1,
      why: 'A single point per server gives arcs of random size. Many points per server average out.' },
  ],
  guided: {
    intro: 'Use hash mod N with four servers, then add a fifth and count the keys that have to move.',
    example: '“Run the guided example” resets to hash mod N with four servers and one point per server, then adds a server after a moment.',
    question: 'How many of the 60 keys move to a different server?',
    predictions: ['Most of them, around 80%.', 'About a fifth, only what the new server needs.', 'None: existing keys stay where they are.'],
    correctPrediction: 0,
    running: 'Watch the dots regroup and count the orange rings. The comparison box on the right shows both strategies.',
    observation: 'Most keys changed servers, because the remainder of hash ÷ N changes for most keys when N changes.',
    explainQuestion: 'Why did so many keys move?',
    explanations: ['Changing N changes hash mod N for most keys, not only the ones the new server needs.', 'The new server copied every key onto itself.', 'The hash function changes whenever a server is added.'],
    correctExplanation: 0,
    why: 'The minimum is about 1/N (only the share the new server should own). Consistent hashing gets close to it; mod N moves roughly (N−1)/N.',
    retryHint: 'Look at “How many keys had to move?”: compare the mod N bar with the ring bar.',
    nextSlug: 'replication',
    nextLabel: 'Next experiment: replication →',
    waitSeconds: 6,
  },

  setup(kit) {
    const { stage } = kit;
    hide3dButton(kit);
    const s = { mode: 'mod', vn: 1, servers: NAMES.slice(0, 4), keys: [], ring: [], moved: null, flash: 0, cmp: null, look: null };
    for (let i = 0; i < 60; i++) { const name = `user:${101 + i * 7}`; s.keys.push({ name, h: hash32(name), owner: null, x: null, y: null, moved: false }); }

    const isDark = () => {
      const m = /^#?([0-9a-f]{6})/i.exec(stage.colors.bg || '');
      if (!m) return true;
      const n = parseInt(m[1], 16);
      return ((n >> 16) & 255) * 0.3 + ((n >> 8) & 255) * 0.59 + (n & 255) * 0.11 < 128;
    };
    const colour = name => { const hue = HUES[NAMES.indexOf(name)] ?? 0; return isDark() ? `hsl(${hue} 70% 66%)` : `hsl(${hue} 62% 42%)`; };

    kit.metrics([
      { key: 'n', label: 'Servers' }, { key: 'moved', label: 'Keys moved last change' },
      { key: 'busy', label: 'Busiest server share' }, { key: 'ideal', label: 'Fair share' },
    ]);

    // ---- lesson (above the stage) and key lookup (under the canvas) ----
    const stepN = h('span', { style: { font: '600 12px var(--font)', color: 'var(--accent-2)', letterSpacing: '.04em', textTransform: 'uppercase' } });
    const dots = h('div', { style: { display: 'flex', gap: '6px' } });
    const lTitle = h('h3', { style: { margin: '8px 0 6px' } });
    const lBody = h('p', { style: { margin: '0 0 8px', color: 'var(--text-2)', lineHeight: '1.55' } });
    const lDo = h('div', { style: { padding: '8px 12px', borderRadius: '8px', background: 'var(--accent-soft)', color: 'var(--text)', fontSize: '14px' } });
    const back = h('button.btn.ghost', { type: 'button' }, 'Back');
    const fwd = h('button.btn.primary', { type: 'button' }, 'Next');
    const lesson = h('section.card', { style: { padding: '16px 18px' } },
      h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '10px', flexWrap: 'wrap' } }, stepN, dots),
      lTitle, lBody, lDo, h('div', { style: { display: 'flex', gap: '8px', marginTop: '10px' } }, back, fwd));
    const stageCard = kit.stageEl.parentElement;
    stageCard.before(lesson);

    const keyInput = h('input.input', { value: 'user:roshan', autocomplete: 'off', autocapitalize: 'off', spellcheck: 'false', 'aria-label': 'Key to look up', style: { flex: '1', minWidth: '0' } });
    const findBtn = h('button.btn.primary', { type: 'button' }, 'Find');
    const calc = h('div', { style: { fontSize: '13px', lineHeight: '1.6', color: 'var(--text-2)', marginTop: '8px' } }, 'Type any key and press Find to see the calculation.');
    const lookup = h('div', { style: { padding: '12px 14px', borderTop: '1px solid var(--line)', background: 'var(--surface)' } },
      h('label', { style: { font: '600 13px var(--font)', display: 'block', marginBottom: '6px' } }, 'Where does this key live?'),
      h('div', { style: { display: 'flex', gap: '8px' } }, keyInput, findBtn), calc);
    kit.stageEl.after(lookup);

    // ---- controls ----
    const p = kit.panel;
    const mode = p.seg('Placement strategy', { options: [['mod', 'hash(key) mod N'], ['ch', 'Consistent hashing']], value: 'mod',
      onChange: v => { s.mode = v; s.cmp = null; place(null); kit.log(v === 'mod' ? 'Placement: hash(key) mod N' : 'Placement: consistent hashing on a ring'); } });
    const vn = p.slider('Virtual nodes per server', { values: VNODE_STEPS, value: 1, hint: 'Only used by consistent hashing',
      onInput: v => { s.vn = v; place(null); unpulse('vn'); kit.log(`${v} point${v > 1 ? 's' : ''} per server on the ring`); } });
    const btns = p.buttons([
      { label: 'Add a server', kind: 'primary', onClick: addServer },
      { label: 'Remove a server', kind: 'outline', onClick: removeServer },
    ]);
    const [addBtn, removeBtn] = btns.buttons;
    const cmpBox = panelBox(p, 'How many keys had to move?');
    const barsBox = panelBox(p, 'Keys per server');
    const focusEls = { find: findBtn, add: addBtn, vn: vn.el };

    function addServer() {
      const name = NAMES.find(n => !s.servers.includes(n));
      if (!name) return;
      const before = s.servers.slice();
      s.servers.push(name);
      place(before);
      unpulse('add');
      kit.log(`Added DB-${name}: ${s.moved} of 60 keys moved to a different server`);
      kit.guided.observe(`Going from ${before.length} to ${s.servers.length} servers with ${s.mode === 'mod' ? 'hash mod N' : 'consistent hashing'}, ${s.moved} of the 60 keys (${pct(s.moved / 60)}) had to move.`);
    }
    function removeServer() {
      if (s.servers.length <= 1) return;
      const before = s.servers.slice();
      const gone = s.servers.pop();
      place(before);
      kit.log(`Removed DB-${gone}: ${s.moved} of 60 keys moved to a different server`);
    }

    function place(before) {
      s.ring = ringOf(s.servers, s.vn);
      let moved = 0;
      for (const k of s.keys) {
        const o = ownerOf(k.h, s.mode, s.servers, s.ring).s;
        k.moved = !!before && k.owner !== null && o !== k.owner;
        if (k.moved) moved++;
        k.owner = o;
      }
      if (before) {
        s.moved = moved; s.flash = 4;
        const hs = s.keys.map(k => k.h);
        s.cmp = { mod: movedShare(hs, 'mod', before, s.servers, s.vn), ch: movedShare(hs, 'ch', before, s.servers, s.vn), from: before.length, to: s.servers.length };
      } else { s.moved = null; s.flash = 0; s.keys.forEach(k => { k.moved = false; }); }
      if (s.look) lookUp(s.look.name, true);
      paint();
    }

    function lookUp(raw, keepAnim) {
      const name = (raw || '').trim() || 'user:roshan';
      const hv = hash32(name), own = ownerOf(hv, s.mode, s.servers, s.ring), n = s.servers.length;
      s.look = { name, h: hv, owner: own.s, v: own.v, oh: own.h, t: keepAnim && s.look ? s.look.t : 0 };
      const big = hv.toLocaleString('en-US');
      const key = `<code>${esc(name)}</code>`, srv = `<b style="color:${colour(own.s)}">DB-${own.s}</b>`;
      if (s.mode === 'mod') {
        calc.innerHTML = `1. hash(${key}) = <b>${big}</b><br>2. ${big} mod ${n} = <b>${hv % n}</b> (what is left after dividing by ${n})<br>3. Server #${hv % n} in the list is ${srv}`;
      } else {
        const deg = x => Math.round((x / RING) * 360);
        calc.innerHTML = `1. hash(${key}) = <b>${big}</b>, which is <b>${deg(hv)}°</b> around the ring<br>2. Walk clockwise to the first server point: <b>${deg(own.h)}°</b>${s.vn > 1 ? ` (virtual node ${own.s}#${own.v})` : ''}<br>3. So the key lives on ${srv}`;
      }
    }

    function paint() {
      const n = s.servers.length, counts = {};
      s.servers.forEach(x => { counts[x] = 0; });
      s.keys.forEach(k => { counts[k.owner]++; });
      const most = Math.max(1, ...Object.values(counts));
      kit.metric('n', String(n));
      kit.metric('moved', s.moved == null ? '–' : `${s.moved} of 60`, s.moved == null ? '' : s.moved / 60 > 0.5 ? 'bad' : 'good');
      const busy = most / 60;
      kit.metric('busy', pct(busy), busy > 1.6 / n ? 'bad' : busy > 1.3 / n ? 'warn' : 'good');
      kit.metric('ideal', pct(1 / n));
      barsBox.body.innerHTML = barsHtml(s.servers.map(x => ({ label: `DB-${x}`, value: counts[x] / most, text: String(counts[x]), color: colour(x) })));
      const c = s.cmp;
      cmpBox.body.innerHTML = c
        ? barsHtml([{ label: 'mod N', value: c.mod, text: pct(c.mod), color: 'var(--red)' }, { label: 'Ring', value: c.ch, text: pct(c.ch), color: 'var(--green)' }])
          + `<p style="margin:8px 0 0;font-size:12.5px;color:var(--text-3)">From ${c.from} to ${c.to} servers. The least possible is about ${pct(1 / Math.max(c.from, c.to))}: only the share the ${c.to > c.from ? 'new' : 'removed'} server owns has to move.</p>`
        : '<p style="margin:0;font-size:12.5px;color:var(--text-3)">Add or remove a server. Both strategies are compared on the same 60 keys.</p>';
      addBtn.disabled = n >= 10;
      removeBtn.disabled = n <= 1;
      vn.input.disabled = s.mode === 'mod';
    }
    const onTheme = () => { paint(); if (s.look) lookUp(s.look.name, true); };
    window.addEventListener('themechange', onTheme);
    kit.onCleanup(() => window.removeEventListener('themechange', onTheme));

    // ---- lesson logic ----
    let stepIdx = 0;
    const pulses = new Set();
    function pulse(k) { const el = focusEls[k]; if (!el) return; el.style.boxShadow = '0 0 0 3px var(--amber)'; el.style.borderRadius = '10px'; pulses.add(k); }
    function unpulse(k) { const el = focusEls[k]; if (el && pulses.has(k)) { el.style.boxShadow = ''; pulses.delete(k); } }
    function go(i) {
      stepIdx = i;
      const L = LESSON[i];
      if (L.set) { s.mode = L.set.mode; s.servers = NAMES.slice(0, L.set.n); s.vn = L.set.vn; s.cmp = null; mode.set(s.mode, true); vn.set(s.vn, true); }
      s.look = null;
      calc.textContent = 'Type any key and press Find to see the calculation.';
      place(null);
      if (L.look) lookUp(keyInput.value);
      stepN.textContent = `Step ${i + 1} of ${LESSON.length}`;
      lTitle.textContent = L.t;
      lBody.innerHTML = L.b;
      lDo.innerHTML = '→ ' + L.d;
      dots.replaceChildren(...LESSON.map((_, k) => h('button', { type: 'button', 'aria-label': `Go to step ${k + 1}`,
        style: { width: '10px', height: '10px', borderRadius: '50%', border: 'none', padding: 0, cursor: 'pointer', background: k === i ? 'var(--accent)' : 'var(--line-2)' },
        onclick: () => go(k) })));
      back.disabled = i === 0;
      fwd.textContent = i === LESSON.length - 1 ? 'Start again' : 'Next';
      for (const k of [...pulses]) unpulse(k);
      if (L.focus) pulse(L.focus);
    }
    back.onclick = () => go(Math.max(0, stepIdx - 1));
    fwd.onclick = () => go(stepIdx === LESSON.length - 1 ? 0 : stepIdx + 1);
    findBtn.onclick = () => { lookUp(keyInput.value); unpulse('find'); kit.log(`Looked up ${esc(s.look.name)}: it lives on DB-${s.look.owner}`); };
    keyInput.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); findBtn.onclick(); } });

    // ---- drawing ----
    function draw(real) {
      stage.clear();
      const c = stage.colors, ctx = stage.ctx, w = stage.w, H = stage.h, n = s.servers.length, TAU = Math.PI * 2;
      const now = performance.now() / 1000;
      s.flash = Math.max(0, s.flash - real);
      const glow = Math.min(1, s.flash / 1.5);
      const L = s.look;
      if (L) L.t += real;
      let target = null;
      if (s.mode === 'mod') {
        stage.text(`server number = hash(key) mod ${n}`, w / 2, 16, { size: 13, weight: 600, align: 'center' });
        const gap = n > 6 ? 5 : 8, bw = (w - 20 - gap * (n - 1)) / n, top = 76, bh = H - top - 12;
        const perRow = Math.max(1, Math.floor((bw - 8) / 13)), slots = {};
        s.servers.forEach((name, i) => {
          const x = 10 + i * (bw + gap), col = colour(name);
          ctx.save(); ctx.globalAlpha = 0.08; stage.rect(x, top, bw, bh, { fill: col }); ctx.restore();
          stage.rect(x, top, bw, bh, { stroke: col, width: L && L.owner === name && L.t > 1 ? 3 : 1.5 });
          stage.text(`#${i}`, x + bw / 2, top - 24, { size: 10.5, color: c.muted, align: 'center' });
          stage.text(bw < 44 ? name : `DB-${name}`, x + bw / 2, top - 10, { size: bw < 40 ? 10.5 : 12.5, weight: 700, color: col, align: 'center' });
          slots[name] = { x, j: 0 };
          if (L && L.owner === name) target = { x: x + bw / 2, y: top + bh - 16 };
        });
        for (const k of s.keys) {
          const sl = slots[k.owner], j = sl.j++;
          k.tx = sl.x + (bw - perRow * 13) / 2 + (j % perRow) * 13 + 6.5;
          k.ty = top + 12 + Math.floor(j / perRow) * 13;
        }
      } else {
        const cx = w / 2, cy = H / 2 + 6, R = Math.min(w, H) * 0.36;
        const ang = x => (x / RING) * TAU - Math.PI / 2;
        stage.ring(cx, cy, R, { color: c.line, width: 16 });
        ctx.save(); ctx.globalAlpha = 0.4; ctx.lineWidth = 16;
        for (let i = 0; i < s.ring.length; i++) {
          const a0 = ang(i ? s.ring[i - 1].h : s.ring[s.ring.length - 1].h - RING), a1 = ang(s.ring[i].h);
          if (a1 <= a0) continue;
          ctx.strokeStyle = colour(s.ring[i].s); ctx.beginPath(); ctx.arc(cx, cy, R, a0, a1); ctx.stroke();
        }
        ctx.restore();
        stage.text('0°', cx, cy - R - 22, { size: 11, color: c.muted, align: 'center' });
        ctx.save(); ctx.strokeStyle = c.muted; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(cx, cy, R + 30, -Math.PI / 2 + 0.12, -Math.PI / 2 + 0.5); ctx.stroke();
        const ea = -Math.PI / 2 + 0.5, ex = cx + Math.cos(ea) * (R + 30), ey = cy + Math.sin(ea) * (R + 30);
        ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(ex - 7 * Math.cos(ea - 0.9), ey - 7 * Math.sin(ea - 0.9)); ctx.moveTo(ex, ey); ctx.lineTo(ex - 7 * Math.cos(ea + 2.3), ey - 7 * Math.sin(ea + 2.3)); ctx.stroke();
        ctx.restore();
        stage.text('clockwise', cx + Math.cos(-Math.PI / 2 + 0.32) * (R + 46), cy + Math.sin(-Math.PI / 2 + 0.32) * (R + 46), { size: 11, color: c.muted, align: 'center' });
        s.keys.forEach((k, i) => { const a = ang(k.h), r = R - 30 - (i % 3) * 8; k.tx = cx + Math.cos(a) * r; k.ty = cy + Math.sin(a) * r; });
        const big = s.vn <= 2;
        for (const pt of s.ring) {
          const a = ang(pt.h), x = cx + Math.cos(a) * R, y = cy + Math.sin(a) * R;
          if (big) {
            if (L && L.owner === pt.s && L.oh === pt.h && L.t > 1.2) stage.dot(x, y, 21, c.signal, 0.3 + 0.2 * Math.sin(now * 6));
            stage.dot(x, y, 13, colour(pt.s));
            stage.text(pt.s, x, y + 0.5, { size: 12, weight: 700, color: c.surface, align: 'center' });
          } else stage.dot(x, y, s.vn > 10 ? 2.6 : 4, colour(pt.s));
        }
        if (L) {
          const a0 = ang(L.h);
          let d = L.oh - L.h; if (d < 0) d += RING;
          const a1 = a0 + (d / RING) * TAU, k = clamp(L.t / 1.2, 0, 1), a = a0 + (a1 - a0) * ease(k);
          ctx.save(); ctx.strokeStyle = c.signal; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(cx, cy, R + 20, a0, Math.max(a0 + 0.001, a)); ctx.stroke(); ctx.restore();
          stage.dot(cx + Math.cos(a) * (R + 20), cy + Math.sin(a) * (R + 20), 4.5, c.signal);
          if (!big && k >= 1) {
            const x = cx + Math.cos(a1) * R, y = cy + Math.sin(a1) * R;
            stage.dot(x, y, 11, c.signal, 0.35 + 0.25 * Math.sin(now * 6));
            stage.dot(x, y, 5, colour(L.owner));
          }
          target = { x: cx + Math.cos(a0) * (R - 12), y: cy + Math.sin(a0) * (R - 12) };
        }
        if (s.moved != null) {
          stage.text(`${s.moved} / 60`, cx, cy - 8, { size: 30, weight: 600, align: 'center' });
          stage.text('keys moved', cx, cy + 16, { size: 12, color: c.muted, align: 'center' });
        } else {
          stage.text(`${n} server${n > 1 ? 's' : ''}`, cx, cy - 8, { size: 14, weight: 600, align: 'center' });
          stage.text('60 keys', cx, cy + 12, { size: 11.5, color: c.muted, align: 'center' });
        }
      }
      const k = Math.min(1, real * 6);
      for (const key of s.keys) {
        if (key.x == null) { key.x = key.tx; key.y = key.ty; }
        key.x += (key.tx - key.x) * k; key.y += (key.ty - key.y) * k;
        stage.dot(key.x, key.y, 4.5, colour(key.owner));
        if (key.moved && s.moved != null) {
          ctx.save(); ctx.globalAlpha = 0.55 + 0.45 * glow;
          stage.ring(key.x, key.y, 7.5 + 1.5 * Math.sin(now * 5) * glow, { color: c.signal, width: 2 });
          ctx.restore();
        }
      }
      if (s.mode === 'mod' && s.moved != null) stage.text(`${s.moved} of 60 keys had to move`, w / 2, 34, { size: 12, weight: 600, color: c.signal, align: 'center' });
      if (L && target) {
        let pos = target;
        if (s.mode === 'mod') { const e = ease(clamp(L.t, 0, 1)); pos = { x: w / 2 + (target.x - w / 2) * e, y: 60 + (target.y - 60) * e }; }
        ctx.save(); ctx.translate(pos.x, pos.y); ctx.rotate(Math.PI / 4);
        ctx.fillStyle = c.signal; ctx.fillRect(-6, -6, 12, 12); ctx.strokeStyle = c.surface; ctx.lineWidth = 2; ctx.strokeRect(-6, -6, 12, 12);
        ctx.restore();
        ctx.font = `600 11.5px ${stage.font}`;
        const tw = ctx.measureText(L.name).width + 14, lx = clamp(pos.x - tw / 2, 4, w - tw - 4), ly = clamp(pos.y - 34, 4, H - 24);
        stage.rect(lx, ly, tw, 20, { fill: c.surface, stroke: c.signal, r: 10 });
        stage.text(L.name, lx + tw / 2, ly + 10.5, { size: 11.5, weight: 600, align: 'center' });
      }
    }

    let guideTimer = 0;
    kit.onCleanup(() => clearTimeout(guideTimer));
    kit.loop((dt, real) => draw(Math.min(real || 0, 0.1)));
    go(0);

    return {
      reset() { go(0); },
      guidedRun() {
        s.mode = 'mod'; s.servers = NAMES.slice(0, 4); s.vn = 1; s.cmp = null; s.look = null;
        mode.set('mod', true); vn.set(1, true);
        calc.textContent = 'Type any key and press Find to see the calculation.';
        place(null);
        kit.log('Guided run: four servers with hash mod N, adding a fifth in a moment');
        clearTimeout(guideTimer);
        guideTimer = setTimeout(addServer, 1500);
      },
    };
  },
};
