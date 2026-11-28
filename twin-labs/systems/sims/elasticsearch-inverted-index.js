// Search index: ten product titles stand in for a catalogue of 10 to 10 million products.
// Model: the analyzer lower-cases, drops apostrophes, splits on anything that is not a letter or
// digit, removes stop words (a, an, and, for, the, with, that, of, to, in, on, s, t) and, when
// stemming is on, trims suffixes ("running" → "run", "shoes" → "shoe"). The inverted index maps each
// term to the products containing it (with term counts). A query is analysed the same way; results
// are ranked by matched terms, then by TF-IDF (tf × ln(1 + docs/df)). SQL LIKE '%query%' checks
// every product for the exact phrase, so it reads the whole catalogue each time.

import { h } from '../../js/core/dom.js';
import { hide3dButton, unpause } from './_a-util.js';

const TITLES = [
  'Running shoes for men, lightweight and breathable',
  'Women’s trail running shoe with grip',
  'Cotton t-shirt for running and gym',
  'Leather office shoes, black',
  'Kids school shoes with velcro',
  'Wireless earphones for running',
  'Yoga mat, non slip',
  'Men’s formal shirt, white cotton',
  'Smart watch that tracks runs and steps',
  'Walking shoes for women, soft sole',
];
const STOP = new Set(['a', 'an', 'and', 'for', 'the', 'with', 'that', 'of', 'to', 'in', 'on', 's', 't']);

function stem(w) {
  if (w.length > 5 && w.endsWith('ning')) return w.slice(0, -4);
  if (/(ss|x|ch|sh)es$/.test(w)) return w.slice(0, -2);
  for (const suf of ['ing', 'ers', 'er', 's']) if (w.length > suf.length + 2 && w.endsWith(suf) && !w.endsWith('ss')) return w.slice(0, -suf.length);
  return w;
}
function analyze(text, stemOn = true) {
  return text.toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(t => t && !STOP.has(t)).map(t => (stemOn ? stem(t) : t));
}
function buildIndex(docs, stemOn) {
  const idx = new Map();
  docs.forEach((d, id) => {
    const tf = new Map();
    for (const t of analyze(d, stemOn)) tf.set(t, (tf.get(t) || 0) + 1);
    for (const [t, n] of tf) { if (!idx.has(t)) idx.set(t, []); idx.get(t).push({ id, tf: n }); }
  });
  return idx;
}
function search(idx, docs, q, stemOn) {
  const terms = [...new Set(analyze(q, stemOn))], score = new Map();
  for (const t of terms) {
    const list = idx.get(t) || [], idf = Math.log(1 + docs.length / (list.length || 1));
    for (const p of list) score.set(p.id, (score.get(p.id) || 0) + p.tf * idf);
  }
  const hits = [...score].map(([id, sc]) => ({ id, score: sc, matched: terms.filter(t => (idx.get(t) || []).some(p => p.id === id)).length }))
    .sort((a, b) => b.matched - a.matched || b.score - a.score);
  return { terms, hits };
}
function like(docs, q) {
  const needle = q.trim().toLowerCase();
  return needle ? docs.map((d, id) => ({ id, d })).filter(x => x.d.toLowerCase().includes(needle)).map(x => x.id) : [];
}

export default {
  lead: 'Search a shop’s catalogue. A SQL <code>LIKE \'%running shoes%\'</code> reads every product and finds only that exact phrase. A search engine first breaks each title into terms (lower case, no “for” or “with”, “running” becomes “run”), keeps a list of the products containing each term, and reads only those lists. Then it ranks the matches.',
  emptyLog: 'Nothing yet. Try another search.',
  stageHeight: 360,
  tryThis: [
    'Search <b>run shoe</b>. LIKE finds nothing; the index finds both running shoes, because titles and query were both stemmed to “run” and “shoe”.',
    'Switch to <b>Exact words</b>. Now “run” no longer matches “running”: the analyzer decides what can be found.',
    'Grow the catalogue to <b>10 million</b>. LIKE reads every product on each search; the index still reads only the lists for your words.',
  ],
  inShort: {
    what: 'A search engine analyses text into terms and keeps an inverted index from each term to the documents containing it, then ranks matches by relevance.',
    why: 'People type loose words, plurals and variations, and a database LIKE scan is both slow and too literal for that.',
    tradeoff: 'Search becomes fast and forgiving, but the index is a second copy that trails the database and has to be kept in sync.',
    interview: 'Primary data in Postgres, change events through Kafka into the search cluster, an analyzer per language, BM25 ranking, and only search boxes query the search cluster.',
  },
  quiz: [
    { q: 'What is an inverted index?', o: ['A table stored backwards', 'A map from each term to the list of documents that contain it', 'A backup copy', 'A sorted array of documents'], a: 1,
      why: 'A query reads only the lists for its own terms instead of scanning every document.' },
    { q: 'Why does a search for “run shoe” find “Running shoes for men”?', o: ['Luck', 'The analyzer stems both the titles and the query, so both become “run” and “shoe”', 'The engine guesses', 'LIKE matching'], a: 1,
      why: 'Analysis at index time and at query time must match; that is why the choice of analyzer matters so much.' },
    { q: 'Why is SQL LIKE \'%phrase%\' slow on a large table?', o: ['It is not', 'A leading wildcard cannot use an ordinary index, so every row is read', 'It sorts the table', 'It locks the table'], a: 1,
      why: 'The database has to check each row; a full-text index avoids that.' },
  ],
  guided: {
    intro: 'Type a loose query that does not appear word for word in any title.',
    example: '“Run the guided example” searches for “run shoe” with stemming on and a catalogue of 100,000 products.',
    question: 'Which approach finds the running shoes?',
    predictions: ['Only the search index; LIKE finds nothing.', 'Only LIKE; the index needs the exact words.', 'Both find them equally.'],
    correctPrediction: 0,
    running: 'Watch the posting lists on the left and the result counts under the diagram.',
    observation: 'The index found the running shoes through the stemmed terms “run” and “shoe”; LIKE looked for the exact phrase and found nothing.',
    explainQuestion: 'Why did the index find what LIKE missed?',
    explanations: ['Titles and query were both reduced to the same stems, so the terms matched even though the words differ.', 'The index stores every possible spelling of each title.', 'LIKE is switched off for big catalogues.'],
    correctExplanation: 0,
    why: 'Matching happens on analysed terms, not raw text. Switch to Exact words and the same search fails: the analyzer defines what is findable.',
    retryHint: 'Read the “query → terms” line under the posting lists.',
    nextSlug: 'database-deadlock',
    nextLabel: 'Next experiment: database deadlock →',
    waitSeconds: 5,
  },

  setup(kit) {
    const { stage } = kit;
    hide3dButton(kit);
    const s = { q: 'running shoes', stem: true, scale: 1e5 };
    let idx, res, likeHits;

    kit.metrics([{ key: 'hits', label: 'Search engine results' }, { key: 'like', label: 'SQL LIKE results' }, { key: 'scan', label: 'Products read by LIKE' }, { key: 'post', label: 'Index lists read (one per term)' }]);

    const p = kit.panel;
    const input = h('input.input', { type: 'search', value: s.q, autocomplete: 'off', 'aria-label': 'Search', style: { width: '100%' } });
    p.custom(h('div.ctl', h('div.ctl-head', h('label', 'Search')), input));
    const pre = p.seg('', { options: [['running shoes', 'running shoes'], ['run shoe', 'run shoe'], ['shoes women', 'shoes women']], value: 'running shoes', onChange: v => setQuery(v) });
    const stemSeg = p.seg('Analyzer', { options: [['on', 'Stem words'], ['off', 'Exact words']], value: 'on',
      onChange: v => { s.stem = v === 'on'; run(); kit.log(`${s.stem ? 'Stemming on' : 'Exact words'}: “${s.q}” now gives ${res.hits.length} result${res.hits.length === 1 ? '' : 's'}`); } });
    const size = p.slider('Products in the catalogue', { min: 1, max: 7, step: 1, value: 5, format: v => kit.fmt(Math.pow(10, v)), hint: 'The 10 titles shown stand for a catalogue this big',
      onInput: v => { s.scale = Math.pow(10, v); run(); } });

    let typing = 0;
    input.addEventListener('input', () => {
      s.q = input.value.slice(0, 60);
      pre.set(['running shoes', 'run shoe', 'shoes women'].includes(s.q) ? s.q : null, true);
      run();
      clearTimeout(typing);
      typing = setTimeout(report, 700);
    });
    kit.onCleanup(() => clearTimeout(typing));

    function setQuery(q) { s.q = q; input.value = q; run(); report(); }
    function report() {
      kit.log(`“${s.q.replace(/[<>&]/g, '')}”: the index found ${res.hits.length} via ${res.terms.length} term list${res.terms.length === 1 ? '' : 's'}; LIKE found ${likeHits.length} after reading ${kit.fmt(s.scale)} products`);
      if (res.hits.length && !likeHits.length) kit.guided.observe(`For “${s.q}” the index matched ${res.hits.length} products through the terms ${res.terms.map(t => `“${t}”`).join(' and ')}, while LIKE read all ${kit.fmt(s.scale)} products and found none.`);
    }
    function run() {
      idx = buildIndex(TITLES, s.stem);
      res = search(idx, TITLES, s.q, s.stem);
      likeHits = like(TITLES, s.q);
      kit.metric('hits', String(res.hits.length), res.hits.length ? 'good' : 'bad');
      kit.metric('like', String(likeHits.length), likeHits.length ? '' : 'bad');
      kit.metric('scan', kit.fmt(s.scale), 'bad');
      kit.metric('post', String(res.terms.length), 'good');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, ctx = stage.ctx, w = stage.w, H = stage.h, narrow = w < 520;
      const lx = 14, lw = narrow ? w - 28 : w * 0.36, rx = narrow ? 14 : lx + lw + 20, rw = narrow ? w - 28 : w - 14 - rx, top = 8;
      stage.text(narrow ? 'index: term → products' : 'inverted index: term → products containing it', lx, top, { size: 10, color: c.muted, baseline: 'top' });
      let y = top + 16;
      const cell = narrow ? 14 : 16;
      if (!res.terms.length) stage.text('type a word', lx, y + 8, { size: 10, color: c.muted });
      for (const t of res.terms) {
        const list = idx.get(t) || [];
        stage.rect(lx, y, lw, cell + 8, { fill: c.surface, stroke: list.length ? c.wire : c.bad, width: 1, r: 5 });
        stage.text(`"${t}"`, lx + 6, y + (cell + 8) / 2, { size: narrow ? 10 : 11, weight: 700, maxWidth: (narrow ? 70 : 80) - 10 });
        let x = lx + (narrow ? 70 : 80);
        for (const p of list) {
          if (x + cell > lx + lw - 4) break;
          ctx.save(); ctx.globalAlpha = 0.25; stage.rect(x, y + 4, cell, cell, { fill: c.wire, r: 3 }); ctx.restore();
          stage.text(String(p.id + 1), x + cell / 2, y + 4 + cell / 2, { size: 9, weight: 600, align: 'center' });
          x += cell + 3;
        }
        if (!list.length) stage.text('no products', x, y + (cell + 8) / 2, { size: 9, color: c.bad });
        y += cell + 12;
      }
      if (!narrow) {
        stage.text(`query "${s.q}" → terms: ${res.terms.join(', ') || 'none'}`, lx, y + 4, { size: 9, color: c.muted, baseline: 'top', maxWidth: lw });
        stage.text(`title of product 2 → ${analyze(TITLES[1], s.stem).join(', ')}`, lx, y + 18, { size: 9, color: c.muted, baseline: 'top', maxWidth: lw });
      }
      let ry = narrow ? y + 6 : top;
      stage.text('ranked results (TF-IDF)', rx, ry, { size: 10, color: c.muted, baseline: 'top' });
      ry += 16;
      const rh = narrow ? 16 : 19, best = Math.max(1e-9, ...res.hits.map(x => x.score));
      const fits = Math.max(1, Math.floor((H - ry - (narrow ? 20 : 44)) / rh));
      res.hits.slice(0, fits).forEach((hit, i) => {
        const yy = ry + i * rh, full = hit.matched === res.terms.length;
        stage.rect(rx, yy, rw, rh - 3, { fill: c.surface, r: 4 });
        ctx.save(); ctx.globalAlpha = 0.22; ctx.fillStyle = full ? c.ok : c.signal; ctx.fillRect(rx, yy, (rw * hit.score) / best, rh - 3); ctx.restore();
        ctx.font = `500 ${narrow ? 9 : 10}px ${stage.font}`;
        const fullText = `${hit.id + 1}. ${TITLES[hit.id]}`;
        let label = fullText;
        while (ctx.measureText(label).width > rw - 60 && label.length > 10) label = label.slice(0, -2);
        stage.text(label === fullText ? label : label + '…', rx + 5, yy + (rh - 3) / 2, { size: narrow ? 9 : 10 });
        stage.text(`${hit.matched}/${res.terms.length}`, rx + rw - 5, yy + (rh - 3) / 2, { size: narrow ? 9 : 10, align: 'right', color: full ? c.ok : c.muted });
      });
      if (!res.hits.length) stage.text('no results', rx, ry + 6, { size: 10, color: c.bad });
      const by = H - (narrow ? 14 : 34);
      stage.text(narrow ? `LIKE: ${likeHits.length} found, read ${kit.fmt(s.scale)}` : `SQL LIKE '%${s.q}%': ${likeHits.length} found after reading all ${kit.fmt(s.scale)} products`, rx, by,
        { size: narrow ? 9 : 10, weight: 600, color: likeHits.length ? c.ink : c.bad, maxWidth: rw });
      if (!narrow) stage.text(`index: ${res.hits.length} found by reading ${res.terms.length} term list${res.terms.length === 1 ? '' : 's'}, whatever the catalogue size`, rx, by + 16, { size: 10, weight: 600, color: c.ok, maxWidth: rw });
    }

    kit.loop(() => draw());
    run();

    let timer = 0;
    kit.onCleanup(() => clearTimeout(timer));
    return {
      guidedRun() {
        clearTimeout(timer);
        stemSeg.set('on', true); s.stem = true;
        size.set(5, true); s.scale = 1e5;
        unpause();
        timer = setTimeout(() => { pre.set('run shoe', true); setQuery('run shoe'); }, 800);
      },
    };
  },
};
