// API gateway: one reverse proxy (written in Nginx syntax) in front of a users and an orders service.
// Model: web and mobile users send `rate` req/s: 30% static files, 45% /api/users, 25% /api/orders.
// An optional bot sends 60 req/s from one IP (60% users, 40% orders), half of them without a token.
// Stages in order: TLS termination → auth (401 without a JWT) → per-IP rate limit (token bucket with
// `limit` tokens refilled at `limit`/s; only the bot's IP ever runs out → 429) → cache for /api/users
// (40 distinct profiles, kept for the cache time) → router. Static files are served from disk.
// Upstreams: 2 servers per service; round robin, least_conn (fewest open requests) or ip_hash.
// A crashed server fails each request routed to it; after 3 failures it is skipped for 10 s
// (max_fails=3 fail_timeout=10s). With retry on (proxy_next_upstream) the request goes to the other
// server; otherwise the client gets a 502. Users requests hold a server 80 ms, orders 150 ms.

import { fixedStep, addLegend, addLesson, unpause, no3d, clamp, along, pct, hashStr, cnode } from './_b-kit.js';
import { h, esc } from '../../js/core/dom.js';

const RATES = [5, 10, 20, 40, 80];
const BOT_RPS = 60;
const STAGES = ['TLS termination', 'Auth (JWT)', 'Rate limit', 'Cache', 'Router'];
const BASE = { attack: false, auth: false, rl: false, cache: false, retry: true, lb: 'rr' };
const LB_LOG = {
  rr: 'Round robin: the two servers take turns',
  lc: 'least_conn: each request goes to the server with the fewest open requests',
  ip: 'ip_hash: a client IP always lands on the same server (sticky sessions)',
};
const LESSON = [
  { t: 'One front door', d: 'Watch requests pass each stage of the gateway. The config on the right is exactly what the gateway runs.', set: BASE,
    b: 'Clients never call your services directly. They call one address, and the gateway, acting as a <b>reverse proxy</b>, forwards each request inside your private network. It also deals with HTTPS here (<b>TLS termination</b>), so the services behind it can talk plain HTTP.' },
  { t: 'Routing by path', d: 'Find the three <b>location</b> blocks in the config and match them to the dots.', set: BASE, focus: 'conf',
    b: 'Each <code>location</code> block matches part of the URL. <code>/api/users/</code> goes to the users service, <code>/api/orders/</code> to orders, and files under <code>/static/</code> come straight off the gateway’s disk without touching a service (purple dots).' },
  { t: 'Check identity at the edge', d: 'Turn on <b>Require JWT</b> and watch the amber 401s stop at the Auth stage.', set: { ...BASE, attack: true }, focus: 'auth',
    b: 'A bot is now hammering the API, and half of its calls carry no valid token. With <code>auth_request</code>, the gateway asks an auth service before forwarding anything. Calls without a valid JWT get <b>401 Unauthorized</b> and never reach your services.' },
  { t: 'Rate limiting', d: 'Turn on <b>Rate limit per IP</b> and watch the bot’s traffic stop at that stage.', set: { ...BASE, attack: true, auth: true }, focus: 'rl',
    b: 'Half of the bot’s calls use a stolen but valid token, so auth lets them in. <code>limit_req</code> gives every IP address a budget per second, and anything over it gets <b>429 Too Many Requests</b>. Real users, each on their own IP, never notice.' },
  { t: 'Caching responses', d: 'Turn on <b>Cache /api/users</b> and compare the req/s shown on users-1 and users-2.', set: { ...BASE, auth: true, rl: true }, focus: 'cache',
    b: 'Many users load the same profiles over and over. With <code>proxy_cache</code>, the gateway keeps a copy of each response for the cache time and answers repeats itself (teal dots). The users service does far less work.' },
  { t: 'Load balancing and failover', d: 'Turn <b>Retry</b> off and press <b>Crash orders-1</b>: red 502s appear. Then switch Retry back on.', set: { ...BASE, auth: true, rl: true, cache: true, retry: false }, focus: 'crash',
    b: 'Each <code>upstream</code> lists several servers. When one crashes, the gateway counts failures, and after 3 (<code>max_fails</code>) it skips that server for 10 s. With <code>proxy_next_upstream</code>, a failed request is tried again on the other server, so users never see the error.' },
  { t: 'Plain reverse proxy or full API gateway?', d: 'Free play: change anything and watch the config follow.', set: null,
    b: 'A reverse proxy like Nginx covers routing, TLS, auth checks, rate limits, caching and load balancing. Dedicated gateways such as Kong (built on Nginx), AWS API Gateway or Envoy add API keys, usage plans, analytics and request rewriting. In interviews, the gateway is where cross-cutting concerns live, so no service has to re-implement them.' },
];

export default {
  lead: 'Every request comes in through a single front door. The gateway checks it, limits it, perhaps answers from its cache, then sends it to the right service. The real configuration (in Nginx syntax) updates live as you change things.',
  emptyLog: 'Nothing yet. Try the bot attack or crash a server.',
  stageHeight: 420,
  tryThis: [
    'Start the <b>bot attack</b> with every protection off: the bot’s requests reach the services. Then turn on auth and the rate limit one at a time.',
    'Turn on <b>Cache /api/users</b> and watch the req/s on the users servers drop while the hit rate climbs.',
    'Switch <b>Retry</b> off, crash orders-1 and count the 502s until max_fails takes it out for 10 s.',
  ],
  inShort: {
    what: 'An API gateway is the single front door: it checks authentication, applies rate limits, may cache, and routes every request to the right service.',
    why: 'Shared rules live in one place instead of being copied into every service.',
    tradeoff: 'It is a single point of failure and an extra hop, so it must run as several copies and stay thin.',
    interview: 'The gateway handles authentication, rate limiting and routing, so the services contain only business logic.',
  },
  quiz: [
    { q: 'In this setup, where is the TLS connection normally terminated?', o: ['At every microservice', 'At the gateway (Nginx)', 'At the database', 'At the client'], a: 1,
      why: 'The gateway decrypts HTTPS once; the internal hops can then use plain HTTP or their own mTLS.' },
    { q: 'What does Nginx’s auth_request do?', o: ['Encrypts passwords', 'Asks an auth service to approve each request before proxying it', 'Signs users in', 'Rate-limits per user'], a: 1,
      why: 'Requests without a valid token get a 401 at the edge and never reach your services.' },
    { q: 'An upstream server crashes while proxy_next_upstream is on. What does the client see?', o: ['A 502 on every request', 'Usually a success, because Nginx retries on the other server', 'A 429', 'A redirect'], a: 1,
      why: 'Nginx sends the failed request to another server in the upstream, hiding the failure from the client.' },
  ],
  guided: {
    intro: 'Crash one of the two orders servers while retries on the other server are enabled.',
    example: '“Run the guided example” resets to 20 req/s of user traffic, no bot, round robin and retry on, then crashes orders-1.',
    question: 'What do clients calling /api/orders see after the crash?',
    predictions: ['Mostly successes: failed attempts are retried on orders-2.', 'Every second orders request returns a 502.', 'All requests are rejected with 429.'],
    correctPrediction: 0,
    running: 'Watch the orders dots turn amber at orders-1 and continue to orders-2, and the “Errors / s” number.',
    observation: 'Requests that hit the crashed orders-1 were retried on orders-2, so clients kept getting 200s; after 3 failures the gateway skipped orders-1 entirely.',
    explainQuestion: 'Why did clients not see errors?',
    explanations: ['proxy_next_upstream resent each failed request to the healthy server, and max_fails soon stopped routing to the dead one.', 'The cache answered every orders request.', 'The rate limiter blocked the failing requests.'],
    correctExplanation: 0,
    why: 'Retries hide a crashed upstream only if the request is safe to repeat and another server has spare capacity.',
    retryHint: 'Look for the line about max_fails in “What just happened”.',
    nextSlug: 'rate-limiting',
    nextLabel: 'Next experiment: rate limiting →',
    waitSeconds: 8,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { rate: 20, auth: false, rl: false, limit: 10, cache: false, ttl: 10, lb: 'rr', attack: false, retry: true };
    let st, confText = '', quiet = false, watch = false;

    kit.metrics([
      { key: 'n', label: 'Requests / s' }, { key: 'ok', label: 'Succeeded' }, { key: 'blk', label: 'Blocked / s' },
      { key: 'err', label: 'Errors / s' }, { key: 'hit', label: 'Cache hit rate' },
    ]);
    const chart = kit.chart({ lines: [{ key: 'n', label: 'Requests / s', color: 'wire' }, { key: 'blk', label: 'Blocked (401 + 429)', color: 'signal' }], bars: { key: 'err', label: 'Errors (502)', color: 'bad' } });
    addLegend(kit, [['ok', '200 from a service', 'dot'], ['teal', '200 from the cache', 'dot'], ['violet', 'Static file', 'dot'], ['signal', 'Blocked (401, 429)', 'dot'], ['bad', 'Error (502)', 'dot']]);

    const p = kit.panel;
    const rate = p.slider('Normal user traffic', { values: RATES, value: s.rate, format: v => `${v} req/s`, onInput: v => { s.rate = v; } });
    const flag = (key, label, on, off) => p.toggle(label, { value: s[key], onChange: v => { s[key] = v; conf(); if (!quiet) kit.log(v ? on : off); paint(); } });
    const attack = flag('attack', `Bot attack (${BOT_RPS} req/s from one IP)`, `A bot starts sending ${BOT_RPS} requests a second from one IP, half of them without a token`, 'The bot stopped');
    const auth = flag('auth', 'Require JWT (auth_request)', 'Auth on: the gateway checks every API call with the auth service first', 'Auth off: any request reaches the services');
    const rl = flag('rl', 'Rate limit per IP (limit_req)', 'Rate limiting on: every IP gets a budget, extra requests get 429', 'Rate limiting off');
    p.slider('Limit per IP', { min: 2, max: 30, step: 1, value: s.limit, format: v => `${v} req/s`, onInput: v => { s.limit = v; conf(); } });
    const cache = flag('cache', 'Cache /api/users (proxy_cache)', 'Caching on: repeated /api/users responses are answered by the gateway', 'Caching off: every request reaches the users service');
    p.slider('Cache time', { min: 1, max: 60, step: 1, value: s.ttl, format: v => `${v} s`, onInput: v => { s.ttl = v; st.cache.clear(); conf(); } });
    const lb = p.seg('Load balancing', { options: [['rr', 'Round robin'], ['lc', 'least_conn'], ['ip', 'ip_hash']], value: s.lb, onChange: v => { s.lb = v; conf(); if (!quiet) kit.log(LB_LOG[v]); } });
    const retry = flag('retry', 'Retry on the other server', 'Retry on: a failed request is sent to the other orders server', 'Retry off: a failed request returns 502 to the client');
    const btns = p.buttons([{ label: 'Crash orders-1', kind: 'primary', onClick: toggleCrash }, { label: 'Reset', kind: 'outline', onClick: () => { reset(); kit.clearLog(); } }]);
    const crashBtn = btns.buttons[0];

    // live config, right column
    const copy = h('button.btn.ghost.sm', { type: 'button' }, 'Copy');
    const pre = h('pre', { style: { margin: '6px 0 0', padding: '10px 12px', background: 'var(--bg-2)', border: '1px solid var(--line)', borderRadius: '8px', fontFamily: 'var(--font-mono, ui-monospace, monospace)', fontSize: '11.5px', lineHeight: 1.55, overflowX: 'auto', maxHeight: '420px', whiteSpace: 'pre' } });
    const confBox = h('div', { style: { marginTop: '6px', width: 0, minWidth: '100%' } }, // width 0 keeps the long lines from widening the column
      h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between' } }, h('b', { style: { fontSize: '14px' } }, 'nginx.conf (live)'), copy), pre);
    p.custom(confBox);
    copy.onclick = () => {
      const say = t => { copy.textContent = t; setTimeout(() => { copy.textContent = 'Copy'; }, 1500); };
      try { navigator.clipboard.writeText(confText).then(() => say('Copied'), () => say('Copy failed')); } catch { say('Copy failed'); }
    };

    const inst = (id, svc) => ({ id, svc, alive: true, fails: 0, down: 0, active: 0, cnt: 0, rate: 0 });
    const blank = () => ({ n: 0, ok: 0, c401: 0, c429: 0, c5: 0, hit: 0, cacheable: 0, retried: 0 });
    function reset() {
      st = { t: 0, acc: 0, bacc: 0, inst: [inst('users-1', 'users'), inst('users-2', 'users'), inst('orders-1', 'orders'), inst('orders-2', 'orders')],
        rr: { users: -1, orders: -1 }, tokens: s.limit, cache: new Map(), pending: [], parts: [], codes: [], w: blank(), last: null };
      crashBtn.textContent = 'Crash orders-1';
      kit.resetTime();
      chart.reset();
      stage.clearFlows();
      paint();
    }
    function hold(i, svc) { i.active++; i.cnt++; st.pending.push({ i, until: st.t + (svc === 'orders' ? 0.15 : 0.08) }); }
    function route(svc, client) {
      const w = st.w, all = st.inst.filter(i => i.svc === svc), up = all.filter(i => !(i.down > st.t));
      if (!up.length) { w.c5++; return { stop: 4, kind: '502' }; }
      let pick;
      if (s.lb === 'rr') { st.rr[svc] = (st.rr[svc] + 1) % up.length; pick = up[st.rr[svc]]; }
      else if (s.lb === 'lc') pick = up.reduce((a, b) => (b.active < a.active ? b : a));
      else { pick = all[hashStr(`${client}-ip`) % all.length]; if (pick.down > st.t) pick = up[0]; }
      if (pick.alive) { hold(pick, svc); w.ok++; return { stop: 4, kind: 'ok', inst: pick }; }
      pick.fails++;
      if (pick.fails >= 3) { pick.fails = 0; pick.down = st.t + 10; kit.log(`${pick.id} failed 3 times, so the gateway skips it for 10 s (max_fails=3, fail_timeout=10s)`); }
      if (s.retry) {
        const other = up.find(i => i !== pick && i.alive);
        if (other) { hold(other, svc); w.ok++; w.retried++; return { stop: 4, kind: 'retry', inst: pick, inst2: other }; }
      }
      w.c5++;
      return { stop: 4, kind: '502', inst: pick };
    }
    function request(client, token, vis) {
      const w = st.w;
      w.n++;
      const r = Math.random();
      const path = client === 'bot' ? (r < 0.6 ? 'users' : 'orders') : r < 0.3 ? 'static' : r < 0.75 ? 'users' : 'orders';
      let res;
      if (path === 'static') { res = { stop: 4, kind: 'static' }; w.ok++; }
      else if (s.auth && !token) { res = { stop: 1, kind: '401' }; w.c401++; }
      else if (s.rl && client === 'bot' && st.tokens < 1) { res = { stop: 2, kind: '429' }; w.c429++; }
      else {
        if (s.rl && client === 'bot') st.tokens -= 1;
        let hit = false;
        if (s.cache && path === 'users') {
          w.cacheable++;
          const key = Math.floor(Math.random() * 40);
          if (st.cache.get(key) > st.t) { hit = true; w.hit++; } else st.cache.set(key, st.t + s.ttl);
        }
        res = hit ? (w.ok++, { stop: 3, kind: 'hit' }) : route(path, client);
      }
      if (Math.random() < vis) st.parts.push({ cl: client, res, t: 0 });
    }

    const step = fixedStep(dt => {
      st.t += dt;
      st.tokens = Math.min(s.limit, st.tokens + s.limit * dt);
      st.pending = st.pending.filter(q => (st.t >= q.until ? (q.i.active--, false) : true));
      for (const i of st.inst) if (i.down && st.t >= i.down && i.alive) i.down = 0;
      const total = s.rate + (s.attack ? BOT_RPS : 0), vis = Math.min(1, 14 / Math.max(1, total));
      st.acc += s.rate * dt;
      let n = Math.floor(st.acc);
      st.acc -= n;
      for (let k = 0; k < n; k++) request(Math.random() < 0.6 ? 'web' : 'mobile', true, vis);
      if (s.attack) {
        st.bacc += BOT_RPS * dt;
        n = Math.floor(st.bacc); st.bacc -= n;
        for (let k = 0; k < n; k++) request('bot', Math.random() < 0.5, vis * 1.4);
      }
    });

    kit.every(1, () => {
      const w = st.w;
      for (const i of st.inst) { i.rate = i.cnt; i.cnt = 0; }
      st.last = { n: w.n, ok: w.n ? w.ok / w.n : 1, blk: w.c401 + w.c429, c401: w.c401, c429: w.c429, err: w.c5, hit: w.cacheable ? w.hit / w.cacheable : null, retried: w.retried };
      chart.push({ n: w.n, blk: w.c401 + w.c429, err: w.c5 });
      st.w = blank();
      paint();
      if (watch && st.inst[2].down > st.t) {
        watch = false;
        kit.guided.observe(`orders-1 is down, yet errors stayed at ${st.last.err}/s: failed attempts were resent to orders-2, and after 3 failures the gateway skipped orders-1 for 10 s.`);
      }
    });

    function paint() {
      const l = st.last;
      if (!l) { for (const k of ['n', 'ok', 'blk', 'err', 'hit']) kit.metric(k, '–'); return; }
      kit.metric('n', String(l.n));
      kit.metric('ok', pct(l.ok), l.ok > 0.97 ? 'good' : l.ok > 0.8 ? 'warn' : 'bad');
      kit.metric('blk', String(l.blk), l.blk ? 'warn' : '');
      kit.metric('err', String(l.err), l.err ? 'bad' : 'good');
      kit.metric('hit', s.cache && l.hit != null ? pct(l.hit) : 'off', s.cache && l.hit > 0.6 ? 'good' : '');
    }

    function toggleCrash() {
      const o = st.inst.find(i => i.id === 'orders-1');
      o.alive = !o.alive; o.fails = 0;
      if (o.alive) o.down = 0;
      crashBtn.textContent = o.alive ? 'Crash orders-1' : 'Restore orders-1';
      kit.log(o.alive ? 'orders-1 is back. The gateway starts sending it traffic again' : 'orders-1 crashed. The gateway does not know yet, so it keeps trying it');
    }

    function conf() {
      const lines = [], add = (t, tag = '') => lines.push([t, tag]);
      const lbLine = { lc: '    least_conn;              # fewest active connections', ip: '    ip_hash;                 # same client IP, same server' }[s.lb];
      for (const svc of ['users', 'orders']) {
        add(`upstream ${svc}_service {`);
        if (lbLine) add(lbLine, 'lb');
        for (const k of [1, 2]) add(`    server ${svc}-${k}:8080 max_fails=3 fail_timeout=10s;`);
        add('}'); add('');
      }
      if (s.rl) { add(`limit_req_zone $binary_remote_addr zone=per_ip:10m rate=${s.limit}r/s;`, 'hl'); add('limit_req_status 429;        # the default would be 503', 'hl'); }
      if (s.cache) add('proxy_cache_path /var/cache/nginx keys_zone=api:10m;', 'hl');
      if (s.rl || s.cache) add('');
      add('server {'); add('    listen 443 ssl;'); add('    http2 on;'); add('    server_name api.example.com;');
      add('    ssl_certificate     /etc/ssl/api.crt;    # TLS ends here'); add('    ssl_certificate_key /etc/ssl/api.key;'); add('');
      add('    location /static/ {           # served from disk'); add('        root /var/www;'); add('        expires 7d;'); add('    }'); add('');
      const guards = () => {
        if (s.auth) add('        auth_request /auth;       # check the JWT first', 'hl');
        if (s.rl) add(`        limit_req zone=per_ip burst=${s.limit} nodelay;`, 'hl');
      };
      add('    location /api/users/ {'); guards();
      if (s.cache) { add('        proxy_cache api;', 'hl'); add(`        proxy_cache_valid 200 ${s.ttl}s;`, 'hl'); }
      add('        proxy_pass http://users_service;'); add('    }'); add('');
      add('    location /api/orders/ {'); guards();
      add(s.retry ? '        proxy_next_upstream error timeout;   # retry (default)' : '        proxy_next_upstream off;  # no retry', 'hl');
      add('        proxy_pass http://orders_service;'); add('    }');
      if (s.auth) { add(''); add('    location = /auth {', 'hl'); add('        internal;', 'hl'); add('        proxy_pass http://auth-service/verify;', 'hl'); add('    }', 'hl'); }
      add('}');
      confText = lines.map(([t]) => t).join('\n');
      pre.innerHTML = lines.map(([t, tag]) => {
        const i = t.indexOf('#');
        const body = i >= 0 ? `${esc(t.slice(0, i))}<span style="color:var(--text-3)">${esc(t.slice(i))}</span>` : esc(t);
        return `<span style="display:block${tag ? ';background:color-mix(in srgb, var(--amber) 14%, transparent);border-left:2px solid var(--amber);margin-left:-12px;padding-left:10px' : ''}">${body || ' '}</span>`;
      }).join('');
    }

    function draw(dt) {
      stage.clear();
      const c = stage.colors, ctx = stage.ctx, w = stage.w, H = stage.h;
      const cw = clamp(w * 0.17, 56, 84), sw = clamp(w * 0.23, 72, 112);
      const clients = { web: { x: cw / 2 + 6, y: H * 0.26, w: cw, h: 40 }, mobile: { x: cw / 2 + 6, y: H * 0.5, w: cw, h: 40 }, bot: { x: cw / 2 + 6, y: H * 0.74, w: cw, h: 40 } };
      const gx0 = cw + 22, gx1 = w - sw - 26, gy0 = H * 0.04, gy1 = H * 0.96, sy0 = gy0 + 38, span = gy1 - 14 - sy0, sh = Math.min(30, span / 5 - 8);
      const stg = STAGES.map((_, i) => ({ x: (gx0 + gx1) / 2, y: sy0 + sh / 2 + (i * (span - sh)) / 4 }));
      const ys = { 'users-1': H * 0.2, 'users-2': H * 0.37, 'orders-1': H * 0.63, 'orders-2': H * 0.8 };
      const instAt = id => ({ x: w - sw - 8, y: ys[id] });
      ctx.save(); ctx.globalAlpha = 0.65; stage.rect(gx0, gy0, gx1 - gx0, gy1 - gy0, { fill: c.surface, r: 12 }); ctx.restore();
      stage.rect(gx0, gy0, gx1 - gx0, gy1 - gy0, { stroke: c.wire, r: 12 });
      stage.text('Gateway (Nginx)', (gx0 + gx1) / 2, gy0 + 18, { size: 13, weight: 700, align: 'center' });
      for (const k in clients) stage.line(clients[k].x + cw / 2, clients[k].y, gx0, clients[k].y, { color: c.wire, alpha: 0.3 });
      for (const id in ys) { const q = instAt(id); stage.line(gx1, stg[4].y, q.x, q.y, { color: c.wire, alpha: 0.3 }); }
      const on = [true, s.auth, s.rl, s.cache, true], l = st.last;
      const badge = [null, s.auth && l ? `401: ${l.c401}/s` : null, s.rl && l ? `429: ${l.c429}/s` : null, s.cache && l && l.hit != null ? `hits ${pct(l.hit)}` : null, null];
      stg.forEach((q, i) => {
        const bw = gx1 - gx0 - 16, name = on[i] ? STAGES[i] : `${STAGES[i]} (off)`;
        stage.rect(q.x - bw / 2, q.y - sh / 2, bw, sh, { fill: on[i] ? c.surface2 : c.surface, stroke: on[i] ? c.wire : c.line, r: 7, dash: on[i] ? null : [4, 3] });
        const fs = bw < 120 ? 10.5 : 11.5, col = on[i] ? c.ink : c.muted;
        if (badge[i] && bw > 150) {
          stage.text(name, q.x - bw / 2 + 9, q.y, { size: fs, weight: 600, color: col });
          stage.text(badge[i], q.x + bw / 2 - 8, q.y, { size: 10.5, weight: 600, color: c.signal, align: 'right' });
        } else if (badge[i] && sh >= 26) {
          stage.text(name, q.x, q.y - 5, { size: fs, weight: 600, color: col, align: 'center' });
          stage.text(badge[i], q.x, q.y + 7, { size: 9.5, weight: 600, color: c.signal, align: 'center' });
        } else stage.text(name, q.x, q.y, { size: fs, weight: 600, color: col, align: 'center' });
      });
      const COL = { ok: c.ok, retry: c.ok, hit: c.teal, static: c.violet, 401: c.signal, 429: c.signal, 502: c.bad };
      st.parts = st.parts.filter(a => {
        const r = a.res, pts = [clients[a.cl]];
        for (let i = 0; i <= r.stop; i++) pts.push(stg[i]);
        if (r.inst) pts.push(instAt(r.inst.id));
        if (r.inst2) pts.push(instAt(r.inst2.id));
        const dur = 0.32 * (pts.length - 1);
        a.t += dt;
        if (a.t >= dur) {
          if (r.kind === '401' || r.kind === '429' || r.kind === '502') {
            const end = pts[pts.length - 1], x = r.inst ? end.x - 14 : end.x + (gx1 - gx0 - 16) / 2 - 18;
            if (!st.codes.some(q => q.txt === r.kind && Math.abs(q.y - end.y) < 2 && q.t < 0.5)) st.codes.push({ x, y: end.y, txt: r.kind, t: 0, col: COL[r.kind] });
          }
          return false;
        }
        const k = a.t / dur, at = along(pts, k);
        const col = r.kind === 'retry' && k < (pts.length - 2) / (pts.length - 1) ? c.signal : COL[r.kind];
        stage.dot(at.x, at.y, 4, col);
        return true;
      });
      st.codes = st.codes.filter(q => {
        q.t += dt;
        if (q.t > 1) return false;
        ctx.save(); ctx.globalAlpha = 1 - q.t; stage.text(q.txt, q.x, q.y - q.t * 14, { size: 12, weight: 700, color: q.col, align: 'center' }); ctx.restore();
        return true;
      });
      cnode(stage, clients.web, 'Web', 'users', { size: 12 });
      cnode(stage, clients.mobile, 'Mobile', 'users', { size: 12 });
      ctx.save(); ctx.globalAlpha = s.attack ? 1 : 0.4;
      cnode(stage, clients.bot, 'Bot', s.attack ? `${BOT_RPS} req/s` : 'idle', { size: 12, stroke: s.attack ? c.bad : c.muted, subColor: s.attack ? c.bad : c.muted });
      ctx.restore();
      const ih = Math.min(40, H * 0.13);
      for (const i of st.inst) {
        const y = ys[i.id], x = w - sw - 8, skipped = i.down > st.t;
        stage.node(x, y - ih / 2, sw, ih, {
          title: i.id, sub: skipped ? `skipped ${Math.ceil(i.down - st.t)}s` : i.alive ? `${i.rate} req/s` : 'crashed',
          fill: i.alive ? clamp(i.rate / 30, 0, 1) : 0, fillColor: i.rate / 30 > 0.8 ? c.signal : c.ok,
          state: i.alive ? undefined : 'dead', dashed: skipped, subColor: i.alive ? c.muted : c.bad, size: 11.5,
        });
      }
      stage.text('users service', w - sw / 2 - 8, ys['users-1'] - ih / 2 - 9, { size: 10, color: c.muted, align: 'center' });
      stage.text('orders service', w - sw / 2 - 8, ys['orders-1'] - ih / 2 - 9, { size: 10, color: c.muted, align: 'center' });
    }

    function apply(set) {
      quiet = true;
      Object.assign(s, set);
      attack.set(s.attack, true); auth.set(s.auth, true); rl.set(s.rl, true); cache.set(s.cache, true); retry.set(s.retry, true); lb.set(s.lb, true);
      quiet = false;
      reset(); conf();
    }
    const focusEl = { conf: confBox, auth: auth.el, rl: rl.el, cache: cache.el, crash: crashBtn };
    no3d(kit);
    kit.loop(dt => { step(dt); draw(dt); });
    reset(); conf();
    addLesson(kit, LESSON, { apply: x => { if (x.set) { apply(x.set); kit.clearLog(); } }, focus: x => focusEl[x.focus] }).go(0);

    return {
      reset() { apply(BASE); kit.clearLog(); },
      guidedRun() {
        rate.set(20, true); s.rate = 20;
        apply(BASE); kit.clearLog();
        unpause();
        setTimeout(() => { toggleCrash(); watch = true; }, 1000);
      },
    };
  },
};
