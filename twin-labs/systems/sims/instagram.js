// Photo sharing: phones in three cities load feed photos through a CDN edge in their city;
// misses go to one far-away origin photo store.
// Model: 10 photo loads per second, cities picked uniformly. Which of the 300 feed photos is
// viewed follows a Zipf law (exponent 1.2), so a handful of posts get most views. Each edge is an
// LRU cache holding 5–150 photos. Load time = 15 ms (edge) + 180 ms if it had to reach the origin
// + transfer time at 4 MB/s (150 KB resized copy ≈ 38 ms, 4 MB original = 1 s). Metrics are
// averages since the last control change.

import { glow, along, stepper, fmtMs, pct, unpause, alpha } from './_e-util.js';

const CITIES = ['Delhi', 'Mumbai', 'Bengaluru'];
const EDGE_MS = 15, ORIGIN_MS = 180, MBPS = 4;
const SIZE = { orig: 4, feed: 0.15 }; // MB
const PHOTOS = 300, ZIPF = 1.2, RATE = 10;

export default {
  lead: 'A feed is mostly pictures, and a few posts are viewed by millions. Each upload lands once in the origin store and is resized into small copies. A CDN keeps the popular ones on an edge server in every city, so most phones never talk to the origin. Switch the CDN off, or ship the full-size originals, and see load times and origin traffic climb.',
  emptyLog: 'Photos are loading. Change a control to see what moves.',
  stageHeight: 400,
  tryThis: [
    'Switch the <b>CDN off</b>. Every photo now travels to the far origin: users wait longer and the store takes every single request.',
    'With the CDN on, cut each edge to <b>5 photos</b>. The hit rate drops, yet even that tiny cache still catches the hottest posts.',
    'Send <b>Original</b> files. The CDN barely helps now: 4 MB over a phone connection takes about a second no matter how close the server is.',
  ],
  inShort: {
    what: 'A photo service such as Instagram keeps each upload once in object storage, creates resized copies and delivers them through a CDN with edge servers in every region.',
    why: 'Pictures are most of the bytes in a feed and a few posts collect enormous view counts, so serving everything from one place would be slow and expensive.',
    tradeoff: 'Larger edge caches raise the hit rate but cost money, and brand-new or rarely viewed photos still miss and fall through to the origin.',
    interview: 'Clients upload straight to object storage with a pre-signed URL, background workers produce several sizes, a CDN with long cache lifetimes sits in front, and the feed API only hands out URLs.',
  },
  quiz: [
    { q: 'Why can a small CDN cache still answer most photo requests?', o: ['It compresses the photos', 'A few popular photos collect most views, and those stay cached', 'It holds every photo', 'Phones cache everything themselves'], a: 1,
      why: 'Views follow a long-tail (Zipf) curve, so the top few percent of photos account for the bulk of requests.' },
    { q: 'What is the biggest gain from resizing photos when they are uploaded?', o: ['Nicer colours', 'Phones fetch about 150 KB instead of 4 MB, so pictures appear much sooner', 'Less storage at the origin', 'Fewer uploads'], a: 1,
      why: 'On a phone network the transfer time dominates; a feed-sized copy cuts it by roughly ten times.' },
    { q: 'If the CDN is switched off, what happens to the photo store?', o: ['Nothing changes', 'Every view becomes an origin request, so its load grows with total views', 'It gets quicker', 'It deletes old photos'], a: 1,
      why: 'Edges soak up repeated reads. Without them the origin has to answer every request, and from far away.' },
  ],
  guided: {
    intro: 'Let the CDN warm up, then switch it off and compare the numbers.',
    example: '“Run the guided example” resets to resized photos and a 30-photo cache with the CDN on, lets it warm up for about 8 seconds, then turns the CDN off.',
    question: 'What happens when the CDN goes away?',
    predictions: ['Average load time rises and every request reaches the origin.', 'Nothing changes because the photos are already resized.', 'Load time drops because there is one hop fewer.'],
    correctPrediction: 0,
    running: 'Watch “Requests reaching origin” and “Average photo load”, and the dots that now travel all the way to the photo store.',
    observation: 'With the CDN off every request went to the far origin: the share reaching it jumped to 100% and the average load time rose by roughly the 180 ms round trip.',
    explainQuestion: 'Why did the numbers jump?',
    explanations: ['The edges had been answering popular photos nearby; without them each view pays the long trip to the origin.', 'Turning the CDN off makes the photos bigger.', 'The origin store slows down at random.'],
    correctExplanation: 0,
    why: 'A CDN works because views are skewed: caching the hot few percent close to users removes most long trips and most origin load.',
    retryHint: 'Compare “Served by the edge” before the switch with “Requests reaching origin” after it.',
    nextSlug: 'youtube',
    nextLabel: 'Next experiment: video upload →',
    waitSeconds: 16,
  },

  setup(kit) {
    const { stage } = kit;
    const fixed = stepper(0.05);
    let M, st;

    kit.metrics([
      { key: 'ms', label: 'Average photo load' }, { key: 'hit', label: 'Served by the edge' },
      { key: 'org', label: 'Requests reaching origin' }, { key: 'mb', label: 'Data per photo' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'avg', label: 'Average load (this second)', color: 'wire' }],
      bars: { key: 'org', label: 'Origin requests', color: 'signal' },
      format: v => fmtMs(v),
    });

    const p = kit.panel;
    const cdn = p.seg('CDN', { options: [['on', 'On'], ['off', 'Off']], value: 'on', onChange: v => { M.cdn = v === 'on'; restartStats(); kit.log(M.cdn ? 'CDN on: each city\'s edge answers the photos it holds' : 'CDN off: every photo is fetched from the far origin store'); } });
    const size = p.seg('Photo sent to phones', { options: [['feed', 'Resized (150 KB)'], ['orig', 'Original (4 MB)']], value: 'feed',
      onChange: v => { M.resize = v === 'feed'; restartStats(); kit.log(M.resize ? 'Phones now get the 150 KB feed-size copy' : 'Phones now get the 4 MB original: about 1 s of transfer each'); } });
    const cache = p.slider('Photos each edge keeps', { min: 5, max: 150, step: 5, value: 30, format: v => String(v), hint: `Out of ${PHOTOS} feed photos; the least recently used one is evicted`,
      onInput: v => { M.cache = v; for (const e of M.edges) while (e.size > v) e.delete(e.keys().next().value); restartStats(); } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    // Zipf sampler over photo ranks
    const weights = Array.from({ length: PHOTOS }, (_, i) => 1 / Math.pow(i + 1, ZIPF));
    const wsum = weights.reduce((a, b) => a + b, 0);
    const pick = () => { let r = Math.random() * wsum; for (let i = 0; i < PHOTOS; i++) { r -= weights[i]; if (r <= 0) return i; } return PHOTOS - 1; };

    function request() {
      const city = Math.floor(Math.random() * CITIES.length);
      const photo = pick();
      const mb = M.resize ? SIZE.feed : SIZE.orig;
      let hit = false;
      if (M.cdn) {
        const e = M.edges[city];
        if (e.has(photo)) { hit = true; e.delete(photo); }
        e.set(photo, 1);
        while (e.size > M.cache) e.delete(e.keys().next().value);
        if (!hit && photo < 3 && !st.warned.has(`${city}:${photo}`)) {
          st.warned.add(`${city}:${photo}`);
          kit.log(`${CITIES[city]} edge missed popular photo #${photo + 1}, fetched it from the origin and kept a copy`);
        }
      }
      const ms = EDGE_MS + (hit ? 0 : ORIGIN_MS) + (mb / MBPS) * 1000;
      M.n++; if (hit) M.hits++; else M.origin++;
      M.ms += ms; M.mb += mb;
      st.sec.ms.push(ms); if (!hit) st.sec.org++;
      const r = { city, photo, hit, ms, cdn: M.cdn };
      M.recent.unshift(r); if (M.recent.length > 12) M.recent.pop();
      st.fly.push({ r, t: 0 });
      checkGuided();
    }
    function restartStats() { M.n = M.hits = M.origin = M.ms = M.mb = 0; st.fly = []; }

    function reset() {
      M = { cdn: cdn.get() === 'on', resize: size.get() === 'feed', cache: cache.get(), edges: CITIES.map(() => new Map()), n: 0, hits: 0, origin: 0, ms: 0, mb: 0, recent: [] };
      st = { acc: 0, fly: [], sec: { ms: [], org: 0 }, warned: new Set(), guided: null };
      kit.resetTime(); chart.reset(); kit.clearLog(); paint();
    }

    function paint() {
      if (!M.n) { for (const k of ['ms', 'hit', 'org', 'mb']) kit.metric(k, '–'); return; }
      const avg = M.ms / M.n, hr = M.hits / M.n, os = M.origin / M.n, mb = M.mb / M.n;
      kit.metric('ms', fmtMs(avg), avg > 400 ? 'bad' : avg > 120 ? 'warn' : 'good');
      kit.metric('hit', M.cdn ? pct(hr) : '–', M.cdn ? (hr > 0.6 ? 'good' : 'warn') : '');
      kit.metric('org', pct(os), os > 0.5 ? 'bad' : 'good');
      kit.metric('mb', mb >= 1 ? `${mb.toFixed(1)} MB` : `${Math.round(mb * 1000)} KB`, mb > 1 ? 'bad' : 'good');
    }

    function checkGuided() {
      const g = st.guided;
      if (!g) return;
      if (!g.switched && kit.time >= 8) {
        g.before = { hit: M.n ? M.hits / M.n : 0, ms: M.n ? M.ms / M.n : 0 };
        g.switched = true; cdn.set('off'); g.at = kit.time;
      } else if (g.switched && kit.time - g.at >= 4 && M.n > 20) {
        st.guided = null;
        kit.guided.observe(`Before the switch the edges served ${pct(g.before.hit)} of photos at ${fmtMs(g.before.ms)} on average. With the CDN off, ${pct(M.origin / M.n)} of requests reached the origin and the average load rose to ${fmtMs(M.ms / M.n)}.`);
      }
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h;
      const narrow = W < 520;
      const top = 24, rowH = Math.min(64, (H * 0.62 - top) / 3);
      const px = narrow ? 34 : 60, ex = W * 0.42, ox = W - (narrow ? 44 : 70);
      const oy = top + rowH * 1.5;
      const rowY = i => top + rowH * i + rowH / 2;
      stage.text('phones', px, top - 10, { size: 10, align: 'center', color: c.muted });
      stage.text(narrow ? 'CDN edge' : 'CDN edge in the city', ex, top - 10, { size: 10, align: 'center', color: c.muted });
      stage.text('origin', ox, top - 10, { size: 10, align: 'center', color: c.muted });
      const ow = narrow ? 72 : 112;
      stage.rect(ox - ow / 2, oy - 30, ow, 60, { fill: c.surface, stroke: c.wire });
      stage.text(narrow ? 'store' : 'photo store', ox, oy - 8, { size: 11, weight: 700, align: 'center' });
      stage.text(narrow ? 'far away' : 'Singapore · 180 ms', ox, oy + 9, { size: 9, align: 'center', color: c.muted });
      const ew = narrow ? 62 : 80;
      CITIES.forEach((name, i) => {
        const y = rowY(i);
        stage.text(narrow ? name.slice(0, 5) : name, px, y, { size: 10, weight: 600, align: 'center' });
        stage.line(px + 30, y, ex - 40, y, { color: c.line, width: 1, dash: [3, 4] });
        stage.line(ex + 40, y, ox - ow / 2, oy, { color: c.line, width: 1, dash: [3, 4] });
        stage.rect(ex - ew / 2, y - rowH * 0.36, ew, rowH * 0.72, { fill: M.cdn ? c.surface : c.surface2, stroke: M.cdn ? c.ok : c.line, r: 6, width: 1 });
        if (M.cdn) {
          const fill = M.edges[i].size / M.cache;
          stage.rect(ex - ew / 2 + 4, y + rowH * 0.36 - 8, (ew - 8) * fill, 4, { fill: alpha(c.ok, 0.35), r: 2 });
          stage.text(`${M.edges[i].size} photos`, ex, y - 2, { size: 9, align: 'center' });
        } else stage.text('no CDN', ex, y, { size: 9, align: 'center', color: c.muted });
      });
      for (const f of st.fly) {
        const y = rowY(f.r.city);
        const a = [px + 30, y], e = [ex, y], o = [ox - 30, oy];
        const [x, yy] = along(f.r.hit ? [a, e, a] : [a, e, o, e, a], f.t);
        glow(stage, x, yy, 2.6, f.r.hit ? c.ok : c.signal, 0.9);
      }
      const listTop = top + rowH * 3 + 14, lh = narrow ? 14 : 15;
      const rows = Math.max(1, Math.floor((H - listTop - 4) / lh));
      stage.text('latest photo loads', 14, listTop - 8, { size: 10, color: c.muted });
      M.recent.slice(0, rows).forEach((r, i) => {
        const y = listTop + i * lh;
        stage.rect(14, y, W - 28, lh - 3, { fill: c.surface, r: 4 });
        stage.text(`${CITIES[r.city]} · photo #${r.photo + 1}${narrow ? '' : r.photo < 10 ? ' (popular)' : ''}`, 20, y + (lh - 3) / 2, { size: 10 });
        stage.text(`${r.hit ? 'edge hit' : r.cdn ? 'miss → origin' : 'origin'} · ${fmtMs(r.ms)}`, W - 20, y + (lh - 3) / 2, { size: 10, align: 'right', color: r.hit ? c.ok : c.signal });
      });
    }

    kit.loop(dt => {
      fixed(dt, h => {
        st.acc += RATE * h;
        while (st.acc >= 1) { st.acc -= 1; request(); }
        for (const f of st.fly) f.t += h / Math.min(2.2, 0.5 + f.r.ms / 900);
        st.fly = st.fly.filter(f => f.t < 1);
      });
      paint();
      draw();
    });
    kit.every(1, () => {
      const a = st.sec.ms;
      chart.push({ avg: a.length ? a.reduce((x, y) => x + y, 0) / a.length : null, org: st.sec.org });
      st.sec = { ms: [], org: 0 };
    });
    reset();

    return {
      reset,
      guidedRun() {
        cdn.set('on', true); size.set('feed', true); cache.set(30, true);
        reset();
        st.guided = { switched: false };
        unpause();
      },
    };
  },
};
