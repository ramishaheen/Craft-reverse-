// URL shortener: 4 new links per second and `rate` clicks per second.
// Codes: a counter (starting at 1000) written in base 62, or random codes of `len` characters
// (62^len possible); a random code that is already taken is a collision and is drawn again; when
// every code is used, creation stops. Clicks pick a link with Zipf-like popularity (weight 1/rank)
// from one of 40 visitors. The app checks an LRU cache of 25 links before the database. With 301
// redirects a browser that has already followed a link answers from memory and never reaches us.

import { pct, fixedStep, clamp, box, link, at, row, unpause, hide3dButton } from './_d-util.js';

const ALPHABET = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
const CREATE_RATE = 4, CACHE = 25, VISITORS = 40, LEG = 0.45;
const space = n => 62 ** n;
const compact = n => new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);

function base62(n) { let s = ''; do { s = ALPHABET[n % 62] + s; n = Math.floor(n / 62); } while (n > 0); return s; }

function codeMaker(scheme, len) {
  const m = { scheme, len, used: new Set(), next: 1000, collisions: 0, full: false };
  m.make = () => {
    if (m.scheme === 'counter') { const c = base62(m.next++); m.used.add(c); return c; }
    if (m.used.size >= space(m.len)) { m.full = true; return null; }
    for (let guard = 0; guard < 100000; guard++) {
      let c = '';
      for (let i = 0; i < m.len; i++) c += ALPHABET[Math.floor(Math.random() * 62)];
      if (!m.used.has(c)) { m.used.add(c); return c; }
      m.collisions++;
    }
    return null;
  };
  return m;
}

function lru(cap) {
  const map = new Map();
  return {
    get(k) { if (!map.has(k)) return false; map.delete(k); map.set(k, 1); return true; },
    put(k) { map.delete(k); map.set(k, 1); if (map.size > cap) map.delete(map.keys().next().value); },
    size: () => map.size,
  };
}

export default {
  lead: 'There are two flows. Creating a link turns a long URL into a short code and saves it. Opening a short link looks the code up and redirects. Redirects vastly outnumber creations, so the design is all about fast reads: a cache in front of the database, and the right redirect status.',
  emptyLog: 'Links are being created. Change the code scheme or the cache.',
  tryThis: [
    'Choose <b>Random</b> with length <b>2</b>: only 3,844 codes exist, so collisions mount as links accumulate. With 7 characters there are 3.5 trillion.',
    'Switch the <b>cache off</b>. Popular links get clicked over and over, so the database suddenly serves every read.',
    'Switch to <b>301</b>. Server traffic falls, but your click counts go wrong because repeat visits stay inside the browser.',
  ],
  inShort: {
    what: 'A service that maps a short code to a long URL: one write when a link is made, then many reads and redirects.',
    why: 'Reads outnumber writes by a hundred to one or more, so the design is about quick lookups and a code space that never runs out.',
    tradeoff: 'Counter codes are unique but guessable; random codes hide the count but collide as the space fills; 301 saves traffic but loses analytics.',
    interview: 'A counter (or ID ranges per server) encoded in base 62, links in a key-value store, a cache for hot codes, and 302 redirects so every click is counted.',
  },
  quiz: [
    { q: 'How many distinct 7-character codes can be made from a–z, A–Z and 0–9?', o: ['About 8 billion', 'About 3.5 trillion', 'About 78 billion', 'Exactly 1 million'], a: 1,
      why: '62 to the 7th power is roughly 3.5 trillion, more than enough for most shorteners.' },
    { q: 'Why put a cache in front of a URL shortener\'s database?', o: ['Creating links needs it', 'A few popular links get most clicks, so caching them removes most database reads', 'It makes codes shorter', 'It prevents collisions'], a: 1,
      why: 'Clicks have a long tail: the hottest links are read again and again, which is exactly what a cache handles well.' },
    { q: 'What do you give up by answering 301 Moved Permanently instead of 302?', o: ['Nothing', 'Speed', 'Accurate click counts, because browsers remember the target and skip your server', 'HTTPS'], a: 2,
      why: 'Browsers cache a 301, so repeat clicks never reach you. Use 302 (or 307) when you need analytics.' },
  ],
  guided: {
    intro: 'Make random codes from a tiny alphabet space and watch for collisions.',
    example: '“Run the guided example” resets with random codes of a single character (62 possible codes), the cache on and 302 redirects.',
    question: 'With 62 possible codes, when does the first collision happen?',
    predictions: ['Long before the space is full, after only a handful of links.', 'Only when all 62 codes are used.', 'Never, random codes are always unique.'],
    correctPrediction: 0,
    running: 'Watch the “Code collisions” metric and the “Links created” count beside it.',
    observation: 'A collision came after only a handful of links: random picks start repeating long before the space is full.',
    explainQuestion: 'Why so early?',
    explanations: ['Each new code can clash with any existing one, so the chance of some repeat grows with the square of the count (the birthday effect).', 'The random generator is broken.', 'The counter overflowed.'],
    correctExplanation: 0,
    why: 'With N possible codes, repeats become likely around √N picks: about 8 here (and about 62 for 2-character codes). Long codes or a counter avoid it.',
    retryHint: 'Think of the birthday paradox: 23 people already give even odds of a shared birthday.',
    nextSlug: 'twitter',
    nextLabel: 'Next experiment: social feed →',
    waitSeconds: 20,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { scheme: 'counter', len: 2, cache: true, code: '302', rate: 20 };
    let st;

    kit.metrics([
      { key: 'links', label: 'Links created' }, { key: 'hit', label: 'Cache hit rate' },
      { key: 'db', label: 'Database reads / s' }, { key: 'col', label: 'Code collisions' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'db', label: 'Database reads / s', color: 'bad' }, { key: 'hits', label: 'Cache hits / s', color: 'ok' }, { key: 'mem', label: 'Answered by browsers / s', color: 'violet' }],
      bars: { key: 'col', label: 'Collisions', color: 'signal' },
    });

    const p = kit.panel;
    const scheme = p.seg('How codes are made', { options: [['counter', 'Counter + base 62'], ['random', 'Random']], value: 'counter',
      onChange: v => { s.scheme = v; reset(); kit.log(v === 'counter' ? 'Codes now come from a counter written in base 62: unique, never collide' : `Codes are now random, ${s.len} characters: ${compact(space(s.len))} possible`); } });
    const len = p.slider('Random code length', { min: 1, max: 7, step: 1, value: 2, format: v => `${v} letters`, hint: ' ',
      onInput: v => { s.len = v; reset(); if (s.scheme === 'random') kit.log(`Random codes of ${v} characters: ${compact(space(v))} possible`); } });
    const lenHint = len.el.querySelector('.ctl-hint');
    const cache = p.seg('Cache', { options: [['on', 'On'], ['off', 'Off']], value: 'on', onChange: v => {
      s.cache = v === 'on'; st.lru = lru(CACHE); st.hits = 0; st.reads = 0;
      kit.log(s.cache ? 'Cache on: popular links will be served from memory once warm' : 'Cache off: every click is a database read'); } });
    const code = p.seg('Redirect code', { options: [['302', '302 Found'], ['301', '301 Moved Permanently']], value: '302',
      hint: '301 lets browsers remember the target, so repeat clicks never reach you (and are not counted)',
      onChange: v => { s.code = v; st.seen = new Set(); st.browser = 0;
        kit.log(v === '301' ? '301: browsers will now remember each target and skip the server on repeat clicks' : '302: every click comes back to the server and is counted'); } });
    const rate = p.slider('Clicks per second', { min: 5, max: 60, step: 5, value: 20, format: v => `${v} /s`, onInput: v => { s.rate = v; } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    function reset() {
      st = { t: 0, accC: 0, accR: 0, codes: codeMaker(s.scheme, s.len), lru: lru(CACHE), links: [], seen: new Set(), parts: [], hits: 0, reads: 0,
        dbWin: 0, dbRate: 0, winT: 0, browser: 0, recent: [], win: { db: 0, hits: 0, mem: 0, col: 0 }, saidFull: false, firstCol: false, guided: false };
      lenHint.textContent = s.scheme === 'random' ? `${compact(space(s.len))} possible codes` : 'Not used: the counter decides the length';
      len.input.disabled = s.scheme !== 'random';
      kit.resetTime();
      chart.reset();
      kit.clearLog();
      paint();
    }

    function pick() {
      const n = st.links.length;
      let total = 0;
      for (let i = 0; i < n; i++) total += 1 / (i + 1);
      let r = Math.random() * total;
      for (let i = 0; i < n; i++) { r -= 1 / (i + 1); if (r <= 0) return st.links[i]; }
      return st.links[n - 1];
    }

    function step(dt) {
      st.t += dt;
      st.accC += CREATE_RATE * dt;
      while (st.accC >= 1) {
        st.accC -= 1;
        const before = st.codes.collisions;
        const c = st.codes.make();
        const extra = st.codes.collisions - before;
        st.win.col += extra;
        if (extra && !st.firstCol) {
          st.firstCol = true;
          kit.log(`First collision after ${st.links.length} links: a random code was already taken and had to be drawn again`);
          if (st.guided) { st.guided = false; kit.guided.observe(`The first collision came when only ${st.links.length} of ${compact(space(st.codes.len))} codes were used.`); }
        }
        if (c) { st.links.push(c); st.recent.unshift(c); st.recent.length = Math.min(st.recent.length, 6); st.parts.push({ k: 'create', t: 0 }); }
        else if (st.codes.full && !st.saidFull) { st.saidFull = true; kit.log(`Every one of the ${compact(space(st.codes.len))} codes is taken: no new links can be created`); }
      }
      if (st.links.length) {
        st.accR += s.rate * dt;
        while (st.accR >= 1) {
          st.accR -= 1;
          const c = pick(), visit = c + ':' + Math.floor(Math.random() * VISITORS);
          if (s.code === '301' && st.seen.has(visit)) { st.browser++; st.win.mem++; if (Math.random() < 0.15) st.parts.push({ k: 'browser', t: 0 }); continue; }
          st.seen.add(visit); st.reads++;
          const hit = s.cache && st.lru.get(c);
          if (hit) { st.hits++; st.win.hits++; } else { st.dbWin++; st.win.db++; if (s.cache) st.lru.put(c); }
          if (Math.random() < 0.25) st.parts.push({ k: hit ? 'hit' : 'miss', t: 0 });
        }
      }
      st.winT += dt;
      if (st.winT >= 1) { st.dbRate = st.dbWin / st.winT; st.dbWin = 0; st.winT = 0; }
      st.parts = st.parts.filter(q => (q.t += dt) < LEG * 2);
    }

    function everySecond() {
      chart.push({ ...st.win });
      st.win = { db: 0, hits: 0, mem: 0, col: 0 };
      paint();
    }

    function paint() {
      kit.metric('links', kit.fmt(st.links.length));
      kit.metric('hit', st.reads ? pct(st.hits / st.reads) : '–', s.cache ? 'good' : 'bad');
      kit.metric('db', st.dbRate.toFixed(0), st.dbRate > s.rate * 0.6 ? 'bad' : st.dbRate > s.rate * 0.25 ? 'warn' : 'good');
      kit.metric('col', kit.fmt(st.codes.collisions) + (st.codes.full ? ' (full!)' : ''), st.codes.collisions ? 'warn' : '');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h, small = W < 520;
      const bw = clamp(W * 0.19, 62, 104), bh = small ? 36 : 42;
      const yTop = Math.max(bh / 2 + 18, H * 0.2), yBot = yTop + bh + (small ? 18 : 28);
      const users = { x: Math.max(W * 0.09, bw / 2 + 6), y: (yTop + yBot) / 2, w: bw, h: bh };
      const app = { x: W * 0.4, y: (yTop + yBot) / 2, w: bw, h: bh };
      const cacheB = { x: W - Math.max(W * 0.09, bw / 2 + 6), y: yTop, w: bw, h: bh };
      const db = { x: cacheB.x, y: yBot, w: bw, h: bh };
      link(stage, [users, app], { color: c.wire }); link(stage, [app, cacheB], { color: c.wire }); link(stage, [app, db], { color: c.wire });
      for (const q of st.parts) {
        const k = clamp(q.t / LEG, 0, 2);
        if (q.k === 'browser') {
          if (k < 1) { stage.ctx.save(); stage.ctx.globalAlpha = 1 - k; stage.ring(users.x, users.y - bh / 2 - 6, 4 + k * 10, { color: c.ok, width: 2 }); stage.ctx.restore(); }
          continue;
        }
        const target = q.k === 'hit' ? cacheB : db;
        const pt = k < 1 ? at([users, app], k) : at([app, target], k - 1);
        stage.dot(pt.x, pt.y, q.k === 'create' ? 4.5 : 3.5, q.k === 'create' ? c.signal : q.k === 'hit' ? c.ok : s.cache ? c.wire : c.bad);
      }
      const fs = small ? 11 : 12.5;
      box(stage, users, 'Users', s.code === '301' ? `${kit.fmt(st.browser)} from memory` : `${s.rate} clicks/s`, { size: fs });
      box(stage, app, small ? 'App' : 'App server', `${s.code} redirect`, { size: fs });
      box(stage, cacheB, 'Cache', s.cache ? `${st.lru.size()} of ${CACHE} links` : 'off', { dashed: !s.cache, stroke: s.cache ? c.wire : c.line, size: fs });
      box(stage, db, 'Database', `${kit.fmt(st.links.length)} links`, { stroke: st.dbRate > s.rate * 0.6 ? c.bad : c.wire, size: fs });
      const ly = yBot + bh / 2 + 18, rh = small ? 14 : 15;
      stage.text('Newest short links', 12, ly, { size: 10.5, weight: 600, color: c.muted });
      st.recent.slice(0, Math.max(1, Math.floor((H - ly - 8) / rh))).forEach((code, i) => {
        row(stage, 12, ly + 8 + i * rh, W - 24, rh - 3, `sho.rt/${code}`, small ? '→ long URL' : `→ example.com/blog/${1000 + st.links.indexOf(code)}?ref=newsletter`);
      });
    }

    const fixed = fixedStep(step);
    kit.loop(dt => { fixed(dt); draw(); });
    kit.every(1, everySecond);
    hide3dButton(kit);
    reset();

    return {
      reset,
      guidedRun() {
        scheme.set('random', true); s.scheme = 'random';
        len.set(1, true); s.len = 1;
        cache.set('on', true); s.cache = true;
        code.set('302', true); s.code = '302';
        reset();
        st.guided = true;
        kit.log('Guided run: random codes of 1 character (62 possible)');
        unpause();
      },
    };
  },
};
