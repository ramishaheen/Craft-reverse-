// File sync: a laptop, a server chunk store and a phone.
// Model: a 100 MB file is 25 chunks of 4 MB, each named by a hash of its contents. "Edit one
// slide" replaces one random chunk with new content (a new hash). With "Changed chunks" the laptop
// uploads only chunks the server lacks (dedupe on: hash not in the store; dedupe off: chunk differs
// from the server's previous version of that file); with "Whole file" it uploads all 25. The store
// keeps one copy per hash with dedupe on, every uploaded chunk with it off. After a file's upload
// finishes the phone downloads the chunks it is missing (all of them in whole-file mode). Upload runs
// at the chosen speed (10–100 Mbps); download is twice as fast. The server already holds the 25
// chunks of a popular disk image (ubuntu.iso) from other users.

import { stepper, unpause, alpha } from './_e-util.js';

const CHUNK_MB = 4, CHUNKS = 25;
const mb = v => (v >= 1000 ? `${(v / 1000).toFixed(1)} GB` : `${v} MB`);

export default {
  lead: 'A 100 MB file is kept as twenty-five 4 MB chunks, each named after a hash of its bytes. Change one slide and only the chunk that changed needs to travel. If the server already holds a chunk with that hash, yours or anyone else\'s, nothing is uploaded at all. The phone then fetches only the chunks it is missing.',
  emptyLog: 'Everything is in sync. Edit a slide, save a copy or add a popular file.',
  stageHeight: 380,
  tryThis: [
    'Press <b>Edit one slide</b>. One chunk changes colour, and only that chunk is uploaded and synced, in about a second.',
    'Switch to <b>Whole file</b> and edit again. All 100 MB go up and come back down for a single changed slide.',
    'With dedupe on, <b>Add ubuntu.iso</b> or <b>Save a copy</b>. The server already has every chunk, so the upload finishes at once and storage stays flat.',
  ],
  inShort: {
    what: 'A file-sync service such as Dropbox splits files into chunks named by their content hash, uploads only the chunks the server is missing, and stores each file version as a list of chunk hashes.',
    why: 'People change large files a little at a time across several devices, and many users keep identical files.',
    tradeoff: 'Smaller chunks find more duplicates and send less per edit, but mean more hashes, more metadata and more requests.',
    interview: 'The client chunks and hashes the file, asks the metadata service which hashes are missing, uploads those to block storage, commits the new version, and the other devices are notified to fetch the difference.',
  },
  quiz: [
    { q: 'You change one slide in a 100 MB file. What does chunked sync upload?', o: ['All 100 MB', 'Only the chunk or chunks whose hash changed', 'Nothing', 'A screenshot'], a: 1,
      why: 'Chunks are compared by content hash, and the unchanged ones are already on the server.' },
    { q: 'Why can uploading a widely shared file take no time at all?', o: ['It is compressed', 'The server already has chunks with the same hashes, so only the list of chunks is sent', 'Popular files are free', 'Encryption is skipped'], a: 1,
      why: 'Content-addressed storage deduplicates identical chunks across every user.' },
    { q: 'What does naming chunks by their hash give the server?', o: ['Prettier names', 'An instant way to tell whether it already has exactly that content', 'Faster disks', 'Smaller files'], a: 1,
      why: 'The same bytes always produce the same hash, so the hash is both the chunk\'s id and its duplicate check.' },
  ],
  guided: {
    intro: 'Edit one slide twice: once syncing changed chunks, once uploading the whole file.',
    example: '“Run the guided example” resets with dedupe on and a 100 Mbps upload, edits a slide with changed-chunk sync, then switches to whole-file upload and edits another slide.',
    question: 'How do the two syncs compare?',
    predictions: ['The whole-file sync takes many times longer, because all 25 chunks go up and come down.', 'Both take the same time, since only one slide changed.', 'Whole-file sync is faster because it sends one big piece.'],
    correctPrediction: 0,
    running: 'Watch the outlined chunks on the laptop (waiting to upload), the arrows to and from the chunk store, and “Last save reached the phone in”.',
    observation: 'The chunked sync moved one 4 MB chunk in about half a second; the whole-file sync moved all 100 MB up and down and took over ten seconds.',
    explainQuestion: 'Why was the chunked sync so much faster?',
    explanations: ['Only the chunk whose hash changed was missing on the server and on the phone, so only it travelled.', 'Chunked sync compresses the file better.', 'The phone downloads faster in chunked mode.'],
    correctExplanation: 0,
    why: 'Content hashes let each side ask “do I already have this?” per chunk, so a small edit costs a small transfer.',
    retryHint: 'Compare the two “reached the phone” times in the event log.',
    nextSlug: 'shopping-cart',
    nextLabel: 'Next experiment: shopping cart →',
    waitSeconds: 24,
  },

  setup(kit) {
    const { stage } = kit;
    const fixed = stepper(0.05);
    const s = { chunked: true, dedupe: true, mbps: 40 };
    let S, st;

    kit.metrics([
      { key: 'up', label: 'Uploaded so far' }, { key: 'sync', label: 'Last save reached the phone in' },
      { key: 'store', label: 'Server storage used' }, { key: 'skip', label: 'Chunks not sent' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'pending', label: 'Chunks still to sync', color: 'signal' }],
      bars: { key: 'mb', label: 'MB uploaded this second', color: 'wire' },
      format: v => String(Math.round(v)),
    });

    const p = kit.panel;
    const acts = p.buttons([
      { label: 'Edit one slide', kind: 'primary', onClick: () => { edit(); } },
      { label: 'Save a copy', kind: 'outline', onClick: () => copy() },
      { label: 'Add ubuntu.iso', kind: 'outline', onClick: () => addIso() },
    ]);
    const [, copyBtn, isoBtn] = acts.buttons;
    const modeSeg = p.seg('Upload', { options: [['whole', 'Whole file'], ['chunks', 'Changed chunks']], value: 'chunks',
      onChange: v => { s.chunked = v === 'chunks'; rebuild(); kit.log(s.chunked ? 'Start over: only changed chunks will be uploaded' : 'Start over: every save uploads the whole 100 MB file'); } });
    const dedupeSeg = p.seg('Dedupe on the server', { options: [['on', 'On'], ['off', 'Off']], value: 'on',
      onChange: v => { s.dedupe = v === 'on'; rebuild(); kit.log(s.dedupe ? 'Start over: the server keeps one copy per chunk hash' : 'Start over: the server keeps every chunk it receives'); } });
    const bw = p.slider('Upload speed', { min: 10, max: 100, step: 10, value: 40, format: v => `${v} Mbps`, onInput: v => { s.mbps = v; if (S) S.mbps = v; } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    function model() {
      const m = { chunked: s.chunked, dedupe: s.dedupe, mbps: s.mbps, now: 0, store: new Map(), stored: 0, files: [], up: [], down: [], uploaded: 0, saved: 0, syncs: [], next: 1 };
      const h = () => `h${m.next++}`;
      m.hash = h;
      m.popular = Array.from({ length: CHUNKS }, h);
      for (const x of m.popular) { m.store.set(x, 1); m.stored++; }
      const f = { name: 'report.pptx', chunks: Array.from({ length: CHUNKS }, h), phone: [], server: [], t: null };
      for (const x of f.chunks) { m.store.set(x, 1); m.stored++; }
      f.phone = f.chunks.slice(); f.server = f.chunks.slice();
      m.files.push(f);
      return m;
    }
    function startUpload(f) {
      S.up = S.up.filter(q => q.f !== f); S.down = S.down.filter(q => q.f !== f);
      const need = S.chunked ? f.chunks.filter((x, i) => (S.dedupe ? !S.store.has(x) : x !== f.server[i])) : f.chunks.slice();
      S.saved += f.chunks.length - need.length;
      for (const x of need) S.up.push({ c: x, f });
      f.t = S.now; f.pendingUp = need.length;
      if (!need.length) { kit.log(`${f.name}: the server already has all ${f.chunks.length} chunks, so nothing is uploaded`); startDownload(f); }
      return need.length;
    }
    function startDownload(f) {
      f.server = f.chunks.slice();
      const need = S.chunked ? f.chunks.filter((x, i) => f.phone[i] !== x) : f.chunks.slice();
      for (const x of need) S.down.push({ c: x, f });
      f.pendingDown = need.length;
      if (!need.length) done(f);
    }
    function done(f) {
      f.phone = f.chunks.slice();
      const secs = S.now - f.t;
      S.syncs.unshift({ name: f.name, secs }); if (S.syncs.length > 8) S.syncs.pop();
      kit.log(`${f.name} reached the phone ${secs.toFixed(1)} s after saving`);
      const g = st.guided;
      if (g && g.stage === 1) { g.first = secs; g.stage = 2; modeSeg.set('whole', true); s.chunked = false; S.chunked = false; kit.log('Guided run: now uploading whole files'); g.wait = 0.8; }
      else if (g && g.stage === 3) { st.guided = null; kit.guided.observe(`Changed chunks: the edit reached the phone in ${g.first.toFixed(1)} s (one 4 MB chunk). Whole file: ${secs.toFixed(1)} s, because all 25 chunks (100 MB) went up and came back down.`); }
    }
    function edit() {
      const f = S.files[0];
      f.chunks[Math.floor(Math.random() * f.chunks.length)] = S.hash();
      const n = startUpload(f);
      kit.log(`Edited one slide in report.pptx: 1 chunk changed, ${n} chunk${n === 1 ? '' : 's'} (${n * CHUNK_MB} MB) to upload`);
      paint();
    }
    function copy() {
      if (S.files.some(f => f.name.includes('copy'))) return;
      const src = S.files[0];
      const f = { name: 'report (copy).pptx', chunks: src.chunks.slice(), phone: Array(CHUNKS).fill(null), server: Array(CHUNKS).fill(null), t: null };
      S.files.push(f);
      const n = startUpload(f);
      if (n) kit.log(`Saved a copy: ${n} chunks to upload`);
      paint();
    }
    function addIso() {
      if (S.files.some(f => f.name === 'ubuntu.iso')) return;
      const f = { name: 'ubuntu.iso', chunks: S.popular.slice(), phone: Array(CHUNKS).fill(null), server: Array(CHUNKS).fill(null), t: null };
      S.files.push(f);
      const n = startUpload(f);
      if (n) kit.log(`Added ubuntu.iso: ${n} chunks to upload`);
      paint();
    }
    function tick(h) {
      S.now += h;
      for (const [list, rate, isUp] of [[S.up, S.mbps / 8 / CHUNK_MB, true], [S.down, S.mbps / 4 / CHUNK_MB, false]]) {
        let budget = rate * h;
        while (list.length && budget > 0) {
          const q = list[0];
          q.left = q.left ?? 1;
          const k = Math.min(budget, q.left);
          q.left -= k; budget -= k;
          if (q.left <= 1e-9) {
            list.shift();
            if (isUp) {
              S.uploaded += CHUNK_MB; st.secMb += CHUNK_MB;
              if (!S.dedupe || !S.store.has(q.c)) S.stored++;
              S.store.set(q.c, 1);
              if (--q.f.pendingUp === 0) startDownload(q.f);
            } else if (--q.f.pendingDown === 0) done(q.f);
          }
        }
      }
      const g = st.guided;
      if (g && g.stage === 2) { g.wait -= h; if (g.wait <= 0) { g.stage = 3; edit(); } }
    }
    const logical = () => S.files.reduce((a, f) => a + f.chunks.length, 0) * CHUNK_MB + S.popular.length * CHUNK_MB;

    function rebuild() { S = model(); paint(); }
    function reset() { st = { secMb: 0, guided: null }; S = model(); kit.resetTime(); chart.reset(); kit.clearLog(); paint(); }
    function paint() {
      kit.metric('up', mb(S.uploaded), S.uploaded > 200 ? 'bad' : S.uploaded > 40 ? 'warn' : 'good');
      const last = S.syncs[0];
      kit.metric('sync', S.up.length || S.down.length ? 'syncing…' : last ? `${last.secs.toFixed(1)} s` : '–', last && last.secs > 10 ? 'bad' : 'good');
      kit.metric('store', `${S.stored * CHUNK_MB} / ${mb(logical())}`, S.stored * CHUNK_MB >= logical() ? 'warn' : 'good');
      kit.metric('skip', String(S.saved), 'good');
      copyBtn.disabled = S.files.some(f => f.name.includes('copy'));
      isoBtn.disabled = S.files.some(f => f.name === 'ubuntu.iso');
    }

    const colorIdx = hsh => (hsh ? (Number(hsh.slice(1)) * 7) % 6 : -1);
    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h, ctx = stage.ctx;
      const palette = [c.wire, c.ok, c.teal, c.violet, c.orange, c.signal];
      const narrow = W < 520, top = 22;
      const colW = narrow ? (W - 36) / 2 : (W - 28 - 140 - 80) / 2;
      const lx = 14, rx = narrow ? lx + colW + 8 : W - 14 - colW, sx = lx + colW + 40, sw = narrow ? 0 : 140;
      const upSet = new Set(S.up.map(q => q.c)), downSet = new Set(S.down.map(q => q.c));
      const box = (x, title) => { stage.rect(x, top, colW, H - top - 10, { fill: c.surface, stroke: c.line, r: 10, width: 1 }); stage.text(title, x + 10, top + 14, { size: 11, weight: 700 }); };
      box(lx, 'Laptop'); box(rx, 'Phone');
      const rows = (x, chunksOf, pending, head) => S.files.forEach((f, i) => {
        const y = top + 30 + i * (narrow ? 40 : 46), cw = (colW - 20) / f.chunks.length, ch = narrow ? 14 : 18;
        stage.text(f.name, x + 10, y + 5, { size: 9, color: c.muted, maxWidth: colW - 20 });
        chunksOf(f).forEach((hsh, k) => {
          const cx = x + 10 + k * cw, cy = y + 13;
          ctx.save();
          ctx.fillStyle = hsh ? palette[colorIdx(hsh)] : c.surface2;
          ctx.globalAlpha = hsh ? 0.8 : 1;
          ctx.fillRect(cx, cy, cw - 1.5, ch);
          ctx.restore();
          if (hsh && pending.has(hsh) && f === ((head && head.f) || f)) { ctx.save(); ctx.strokeStyle = c.ink; ctx.lineWidth = 1.5; ctx.strokeRect(cx + 0.5, cy + 0.5, cw - 2.5, ch - 1); ctx.restore(); }
        });
      });
      rows(lx, f => f.chunks, upSet, S.up[0]);
      if (S.up.length) stage.text('outlined = waiting to upload', lx + 10, H - (narrow ? 34 : 24), { size: 9, color: c.muted });
      rows(rx, f => f.chunks.map((x, k) => (f.phone[k] === x ? x : null)), downSet, S.down[0]);
      const busy = S.up.length || S.down.length;
      if (narrow) {
        stage.text(busy ? `uploading ${S.up.length} · downloading ${S.down.length} chunks` : 'in sync', W / 2, H - 16, { size: 9, align: 'center', color: busy ? c.signal : c.muted });
        return;
      }
      stage.rect(sx, top + 30, sw, H - top - 80, { fill: c.surface2, stroke: c.wire, r: 10 });
      stage.text('chunk store', sx + sw / 2, top + 44, { size: 11, weight: 700, align: 'center' });
      stage.text(S.dedupe ? 'one copy per hash' : 'every upload kept', sx + sw / 2, top + 58, { size: 9, align: 'center', color: c.muted });
      const per = 10, cell = (sw - 20) / per, maxRows = Math.max(1, Math.floor((H - top - 150) / (cell * 0.8)));
      for (let i = 0; i < Math.min(S.stored, per * Math.min(14, maxRows)); i++) stage.rect(sx + 10 + (i % per) * cell, top + 68 + Math.floor(i / per) * cell * 0.8, cell - 2, cell * 0.8 - 2, { fill: alpha(c.wire, 0.55), r: 1 });
      stage.text(`${S.stored} chunks · ${mb(S.stored * CHUNK_MB)}`, sx + sw / 2, H - 62, { size: 10, weight: 600, align: 'center' });
      const arrow = (x1, x2, y, on, label) => {
        stage.arrow(x1, y, x2, y, { color: on ? c.signal : c.line, width: on ? 2 : 1, head: 6 });
        if (on) stage.text(label, (x1 + x2) / 2, y - 9, { size: 9, align: 'center', color: c.signal });
      };
      arrow(lx + colW + 3, sx - 3, top + 80, S.up.length > 0, `${S.up.length} up`);
      arrow(sx + sw + 3, rx - 3, top + 80, S.down.length > 0, `${S.down.length} down`);
    }

    kit.loop(dt => { fixed(dt, tick); paint(); draw(); });
    kit.every(1, () => { chart.push({ pending: S.up.length + S.down.length, mb: st.secMb }); st.secMb = 0; });
    reset();

    return {
      reset,
      guidedRun() {
        modeSeg.set('chunks', true); s.chunked = true;
        dedupeSeg.set('on', true); s.dedupe = true;
        bw.set(100, true); s.mbps = 100;
        reset();
        st.guided = { stage: 1 };
        unpause();
        edit();
      },
    };
  },
};
