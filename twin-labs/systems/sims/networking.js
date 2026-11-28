// Networking: every packet before the first byte of a web page.
// Model: one request is a list of one-way messages. A message to or from the web server takes half
// the chosen round trip (RTT/2). DNS hops are fixed: 10 ms browser↔resolver, 15 ms per resolver↔root,
// TLD and authoritative server hop. A browser-cache hit skips DNS; a resolver-cache hit is one
// 20 ms round trip; a full lookup walks root → TLD → authoritative.
// Handshakes: HTTP/1.1 + TLS 1.2 = TCP (1 RTT) + TLS (2 RTT); HTTP/2 + TLS 1.3 = TCP (1) + TLS (1);
// HTTP/3 over QUIC = one combined handshake (1). Keep-alive skips all handshakes. Then the request
// (RTT/2), server work, and the response (RTT/2). Time to first byte is the sum.
// Playback stretches real milliseconds so a whole request plays in roughly 6–7 seconds.

import { addCard, addLegend, fmtMs, clamp, ease, curve, along } from './_b-kit.js';
import { h } from '../../js/core/dom.js';

const PHASE_COL = { dns: 'teal', tcp: 'wire', tls: 'violet', http: 'signal' };
const PHASE_CSS = { dns: 'var(--teal)', tcp: 'var(--accent-2)', tls: 'var(--violet)', http: 'var(--amber)' };
const PHASE_NAME = { dns: 'DNS', tcp: 'TCP', tls: 'TLS', http: 'Request + response' };
const LINKS = [['client', 'resolver', 0], ['resolver', 'root', 0], ['resolver', 'tld', -0.45], ['resolver', 'auth', -0.5], ['client', 'server', 0]];
const PLACES = {
  client: [18.52, 73.86, 'Browser · Pune'], resolver: [12.97, 77.59, 'Resolver · Bengaluru'], root: [52.37, 4.9, 'Root · Amsterdam'],
  tld: [38.9, -77.4, '.com · Virginia'], auth: [34.05, -118.24, 'Name server · Los Angeles'],
};
const IP = '93.184.215.14';

export function buildPlan({ rtt, dns, proto, reuse, srv }) {
  const half = rtt / 2, plan = [];
  const add = (phase, from, to, label, ms, note) => plan.push({ phase, from, to, label, ms, note });
  if (dns === 'resolver') {
    add('dns', 'client', 'resolver', 'DNS query', 10, 'The browser cache has nothing, so it asks your ISP’s resolver');
    add('dns', 'resolver', 'client', `Answer: ${IP}`, 10, 'The resolver already had the answer cached');
  } else if (dns === 'full') {
    add('dns', 'client', 'resolver', 'DNS query', 10, 'Nothing in the browser cache, so ask the resolver');
    add('dns', 'resolver', 'root', 'Who handles .com?', 15, 'The resolver’s cache is empty as well, so it starts at a root server');
    add('dns', 'root', 'resolver', 'Ask the .com servers', 15);
    add('dns', 'resolver', 'tld', 'Who handles example.com?', 15);
    add('dns', 'tld', 'resolver', 'Ask its name server', 15);
    add('dns', 'resolver', 'auth', 'Address of example.com?', 15, 'The authoritative name server holds the real record');
    add('dns', 'auth', 'resolver', IP, 15);
    add('dns', 'resolver', 'client', IP, 10, 'Browser and resolver both keep it for the record’s TTL');
  }
  if (!reuse) {
    if (proto !== 'h3') {
      add('tcp', 'client', 'server', 'SYN', half, 'The browser asks to open a TCP connection');
      add('tcp', 'server', 'client', 'SYN-ACK', half, 'The server accepts');
    }
    if (proto === 'h11') {
      add('tls', 'client', 'server', 'ACK + ClientHello', half, 'The ACK completes TCP; ClientHello lists the ciphers it supports');
      add('tls', 'server', 'client', 'ServerHello + certificate', half, 'The server proves its identity');
      add('tls', 'client', 'server', 'Key exchange + Finished', half, 'Both ends work out the session key');
      add('tls', 'server', 'client', 'Finished', half, 'Encryption is ready after two round trips');
    } else if (proto === 'h2') {
      add('tls', 'client', 'server', 'ACK + ClientHello + key share', half, 'TLS 1.3 sends its key share in the first message');
      add('tls', 'server', 'client', 'ServerHello + cert + Finished', half, 'Encrypted after a single round trip');
    } else {
      add('tls', 'client', 'server', 'QUIC Initial + ClientHello', half, 'QUIC runs over UDP, so there is no separate TCP handshake');
      add('tls', 'server', 'client', 'Handshake + certificate', half, 'Transport and encryption are ready at the same moment');
    }
  }
  add('http', 'client', 'server', proto === 'h11' ? 'GET /' : 'GET / (stream 1)', half, 'The request you actually came to send');
  add('http', 'server', 'server', 'Server working', srv, 'Database queries, business logic, rendering');
  add('http', 'server', 'client', '200 OK + first bytes', half, 'Time to first byte stops here');
  let t = 0;
  for (const m of plan) { m.start = t; t += m.ms; }
  const scale = clamp(6500 / Math.max(t, 1), 3, 40);
  for (const m of plan) m.vd = Math.max(m.from === m.to ? 600 : 420, m.ms * scale);
  const byPhase = { dns: 0, tcp: 0, tls: 0, http: 0 };
  let serverMsgs = 0;
  for (const m of plan) { byPhase[m.phase] += m.ms; if ((m.from === 'client' && m.to === 'server') || (m.from === 'server' && m.to === 'client')) serverMsgs++; }
  return { plan, total: t, byPhase, trips: serverMsgs / 2 };
}

export default {
  lead: 'A DNS lookup, a TCP handshake, a TLS handshake, and only then the request. Every arrow below is a packet crossing the network, so the distance to the server multiplies all of it.',
  emptyLog: 'Nothing yet. Press “Send request”.',
  stageHeight: 400,
  tryThis: [
    'Set the distance to <b>250 ms</b> and compare HTTP/1.1 with HTTP/3. Count the round trips each one needs.',
    'Turn on <b>keep-alive</b>: a second request on an open connection skips every handshake.',
    'In many setups a full DNS lookup takes longer than the server’s own work. That is why DNS answers are cached.',
  ],
  inShort: {
    what: 'Before any data flows, the browser performs a DNS lookup, a TCP handshake and a TLS handshake, each costing round trips.',
    why: 'Round trips are bounded by distance and the speed of light, so a far-away server feels slow however powerful it is.',
    tradeoff: 'CDNs and edge servers shorten the distance but cost money and make fresh data harder to serve; keep-alive and HTTP/2 reuse connections instead.',
    interview: 'Latency is mostly round trips multiplied by distance, so I would put static content on a CDN near the users.',
  },
  quiz: [
    { q: 'On a brand-new connection, which option needs the fewest round trips before the first request goes out?', o: ['HTTP/1.1 + TLS 1.2', 'HTTP/2 + TLS 1.3', 'HTTP/3 over QUIC', 'They all need the same'], a: 2,
      why: 'QUIC merges the transport and TLS 1.3 handshakes into a single round trip and runs over UDP, so there is no TCP handshake first.' },
    { q: 'Why is a second request on a keep-alive connection so much quicker?', o: ['The server has cached the response', 'It skips the TCP and TLS handshakes', 'DNS is never needed again', 'Packets move faster'], a: 1,
      why: 'The connection is already open and encrypted, so only the request and response round trip is left.' },
    { q: 'Which chain does a full DNS lookup follow?', o: ['Browser → web server', 'Resolver → root → TLD → authoritative name server', 'CDN → load balancer → app', 'Router → switch → server'], a: 1,
      why: 'The resolver asks a root server for the TLD servers, the TLD servers for the domain’s name servers, and the authoritative server for the address.' },
  ],
  guided: {
    intro: 'Send the same request twice over a long-distance link: first with HTTP/1.1 and TLS 1.2, then with HTTP/3.',
    example: '“Run the guided example” sets 250 ms round trip, a full DNS lookup, no keep-alive and 50 ms of server work, plays HTTP/1.1 + TLS 1.2, then plays HTTP/3.',
    question: 'What happens to the time to first byte when the protocol switches to HTTP/3?',
    predictions: ['It falls by about two round trips, roughly half a second.', 'It stays the same, because the server works just as fast.', 'It rises, because UDP has to resend lost packets.'],
    correctPrediction: 0,
    running: 'Watch the packet list: count the green-and-violet handshake packets in each run. The second run starts automatically.',
    observation: 'HTTP/3 needed two round trips to the server instead of four, so the first byte arrived about 500 ms sooner.',
    explainQuestion: 'Why is HTTP/3 faster to the first byte here?',
    explanations: ['QUIC combines the transport and TLS handshakes into one round trip, and there is no separate TCP handshake.', 'HTTP/3 compresses the response better.', 'HTTP/3 skips the DNS lookup.'],
    correctExplanation: 0,
    why: 'Each handshake round trip costs the full distance to the server, so cutting handshakes matters most on far links.',
    retryHint: 'Compare the “Round trips to server” number after each run.',
    nextSlug: 'load-balancing',
    nextLabel: 'Next experiment: load balancing →',
    waitSeconds: 22,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { rtt: 80, dns: 'full', proto: 'h2', reuse: false, srv: 50 };
    let P = buildPlan(s);
    const play = { on: false, done: false, vt: 0, cur: null, land: null, clock: 0, onDone: null };

    kit.metrics([{ key: 'ttfb', label: 'Time to first byte' }, { key: 'trips', label: 'Round trips to server' }, { key: 'dns', label: 'DNS lookup' }, { key: 'setup', label: 'Connection setup' }]);
    addLegend(kit, Object.keys(PHASE_NAME).map(k => [PHASE_COL[k], PHASE_NAME[k]]));
    kit.enable3d({ yaw: 0.87, pitch: 0.6 }); // faces longitude ≈ 40°E: India, Europe and the US east coast

    // "Where the time goes" waterfall and "Packet by packet" list
    const wfCard = addCard(kit, 'Where the time goes');
    const wf = h('div', { style: { display: 'flex', height: '18px', borderRadius: '5px', overflow: 'hidden', background: 'var(--surface-3)', transition: 'width .3s' } });
    const wfTrack = h('div', { style: { background: 'var(--surface-2)', borderRadius: '5px' } }, wf);
    const wfScale = h('div', { style: { display: 'flex', justifyContent: 'space-between', fontSize: '11.5px', color: 'var(--text-3)', margin: '4px 0 8px' } }, h('span', '0'), h('span', '1.5 s'));
    const wfLegend = h('div.chart-legend', { style: { margin: 0 } });
    wfCard.body.append(wfTrack, wfScale, wfLegend);
    const listCard = addCard(kit, 'Packet by packet');
    const list = h('ol', { style: { margin: 0, padding: 0, listStyle: 'none', display: 'grid', gap: '4px' } });
    listCard.body.append(list);

    const p = kit.panel;
    const hintFor = v => (v <= 20 ? 'Same city (a nearby CDN edge)' : v <= 60 ? 'Same country' : v <= 160 ? 'Another continent, for example Pune to Frankfurt' : 'The other side of the world, for example Pune to California');
    const rttCtl = p.slider('Distance to server (round trip)', { min: 10, max: 300, step: 5, value: s.rtt, format: v => `${v} ms`, onInput: v => { s.rtt = v; hint.textContent = hintFor(v); rebuild(); }, hint: hintFor(s.rtt) });
    const hint = rttCtl.el.querySelector('.ctl-hint');
    const dnsCtl = p.seg('Where DNS finds the address', { options: [['browser', 'Browser cache'], ['resolver', 'Resolver cache'], ['full', 'Full lookup']], value: s.dns, onChange: v => { s.dns = v; rebuild(); } });
    const protoCtl = p.seg('Protocol', { options: [['h11', 'HTTP/1.1 + TLS 1.2'], ['h2', 'HTTP/2 + TLS 1.3'], ['h3', 'HTTP/3 (QUIC)']], value: s.proto, onChange: v => { s.proto = v; rebuild(); } });
    const reuseCtl = p.toggle('Reuse an open connection (keep-alive)', { value: false, onChange: v => { s.reuse = v; rebuild(); } });
    const srvCtl = p.slider('Server processing time', { min: 0, max: 500, step: 10, value: s.srv, format: v => `${v} ms`, onInput: v => { s.srv = v; rebuild(); } });
    const btns = p.buttons([{ label: 'Send request', kind: 'primary', onClick: () => send() }]);
    const goBtn = btns.buttons[0];

    function rebuild() {
      P = buildPlan(s);
      play.on = false; play.done = false; play.vt = 0; play.cur = null; play.land = null; play.onDone = null;
      goBtn.textContent = 'Send request';
      paint();
    }
    function send(onDone) {
      play.on = true; play.done = false; play.vt = 0; play.cur = null; play.land = null; play.onDone = onDone || null;
      goBtn.textContent = 'Replay';
      mark(-1);
    }
    function paint() {
      const b = P.byPhase;
      kit.metric('ttfb', fmtMs(P.total), P.total > 800 ? 'bad' : P.total > 400 ? 'warn' : 'good');
      kit.metric('trips', String(P.trips));
      kit.metric('dns', fmtMs(b.dns));
      kit.metric('setup', fmtMs(b.tcp + b.tls));
      wf.style.width = clamp((P.total / 1500) * 100, 2, 100) + '%';
      wf.replaceChildren(...Object.keys(b).filter(k => b[k] > 0).map(k => h('span', { style: { flex: `${b[k]} 1 0`, background: PHASE_CSS[k] } })));
      wfLegend.replaceChildren(...Object.keys(b).map(k => h('span', h('i', { style: { background: PHASE_CSS[k] } }), `${PHASE_NAME[k]} ${fmtMs(b[k])}`)));
      const info = [];
      if (s.dns === 'browser') info.push('DNS came straight from the browser cache, so no network trip.');
      if (s.reuse) info.push('The connection is already open, so there is no TCP or TLS handshake.');
      list.replaceChildren(
        ...info.map(t => h('li', { style: { fontSize: '13px', color: 'var(--text-3)', fontStyle: 'italic' } }, t)),
        ...P.plan.map((m, i) => h('li', { dataset: { i }, style: { display: 'grid', gridTemplateColumns: 'minmax(0,1fr) auto', gap: '2px 10px', padding: '6px 10px', borderRadius: '6px', border: '1px solid var(--line)', fontSize: '13px', transition: 'opacity .2s, background .2s' } },
          h('span', { style: { fontWeight: 600 } }, h('i', { style: { display: 'inline-block', width: '9px', height: '9px', borderRadius: '50%', background: PHASE_CSS[m.phase], marginRight: '8px' } }), m.label),
          h('span', { style: { fontVariantNumeric: 'tabular-nums', color: 'var(--text-2)' } }, `${m.from === m.to ? '+' : ''}${fmtMs(m.ms)}`),
          m.note && h('span', { style: { gridColumn: '1 / -1', color: 'var(--text-3)', fontSize: '12px', paddingLeft: '17px' } }, m.note))));
      lastMark = -2;
    }
    let lastMark = -2;
    function mark(k) {
      if (k === lastMark) return;
      lastMark = k;
      for (const li of list.querySelectorAll('li[data-i]')) {
        const i = Number(li.dataset.i);
        const now = i === k, done = k >= 0 && i < k;
        li.style.background = now ? 'var(--surface-2)' : '';
        li.style.borderColor = now ? 'var(--accent)' : 'var(--line)';
        li.style.opacity = k >= 0 && !now && !done ? '0.55' : '1';
      }
    }

    // ---- layout (2D) ----
    function layout() {
      const w = stage.w, H = stage.h;
      const big = clamp(w * 0.17, 66, 108), small = clamp(w * 0.155, 56, 90), top = H * 0.32, bot = H * 0.72, edge = Math.max(w * 0.13, big / 2 + 8);
      return {
        client: { x: edge, y: bot, w: big, h: 42 }, server: { x: w - edge, y: bot, w: big, h: 42 },
        resolver: { x: w * 0.3, y: top, w: small, h: 34 }, root: { x: w * 0.515, y: top, w: small, h: 34 },
        tld: { x: w * 0.7, y: top, w: small, h: 34 }, auth: { x: w - Math.max(w * 0.115, small / 2 + 6), y: top, w: small, h: 34 },
      };
    }
    function linkPts(from, to, L) {
      const l = LINKS.find(x => (x[0] === from && x[1] === to) || (x[0] === to && x[1] === from));
      const pts = curve(L[l[0]], L[l[1]], l[2]);
      return l[0] === from ? pts : pts.slice().reverse();
    }
    const used = n => n === 'client' || n === 'server' || (n === 'resolver' ? s.dns !== 'browser' : s.dns === 'full');

    function label(x, y, text, col) {
      const ctx = stage.ctx;
      ctx.font = `600 11px ${stage.font}`;
      const tw = ctx.measureText(text).width + 16;
      const bx = clamp(x - tw / 2, 4, stage.w - tw - 4), by = clamp(y, 4, stage.h - 24);
      stage.rect(bx, by, tw, 20, { fill: stage.colors.surface, stroke: col, r: 10 });
      stage.text(text, bx + tw / 2, by + 10.5, { size: 11, weight: 600, align: 'center' });
    }

    function advance(dt) {
      play.clock += dt;
      let cur = null, frac = 0, ms = 0;
      if (play.on) {
        play.vt += dt * 1000;
        let acc = 0;
        for (let i = 0; i < P.plan.length; i++) {
          const m = P.plan[i];
          if (play.vt < acc + m.vd) { cur = i; frac = (play.vt - acc) / m.vd; break; }
          acc += m.vd;
        }
        if (cur === null) {
          play.on = false; play.done = true; mark(P.plan.length); goBtn.textContent = 'Send again';
          kit.log(`First byte after <b>${fmtMs(P.total)}</b>: ${P.trips} round trip${P.trips === 1 ? '' : 's'} to the server (${{ h11: 'HTTP/1.1 + TLS 1.2', h2: 'HTTP/2 + TLS 1.3', h3: 'HTTP/3' }[s.proto]}, ${s.rtt} ms away), DNS ${fmtMs(P.byPhase.dns)}`);
          const f = play.onDone; play.onDone = null; f?.();
        } else { ms = P.plan[cur].start + P.plan[cur].ms * frac; mark(cur); }
        if (cur !== play.cur) {
          const prev = play.cur == null ? null : P.plan[play.cur];
          if (prev && prev.from !== prev.to) play.land = { from: prev.from, to: prev.to, col: stage.colors[PHASE_COL[prev.phase]], t: play.clock };
          play.cur = cur;
        }
      }
      return { cur, frac, ms };
    }

    function footer(ms, y) {
      const c = stage.colors;
      if (play.on) stage.text(`${Math.round(ms)} ms`, stage.w / 2, y, { size: 22, weight: 700, align: 'center', baseline: 'alphabetic' });
      else stage.text(play.done ? `First byte arrived after ${fmtMs(P.total)}${kit.is3d ? ' · drag to turn the globe' : ''}` : `Press “Send request” to watch it happen${kit.is3d ? ' · drag to turn the globe' : ''}`, stage.w / 2, y, { size: 13, color: c.muted, align: 'center', baseline: 'alphabetic' });
    }

    function draw2d(cur, frac, ms) {
      const c = stage.colors, L = layout();
      for (const l of LINKS) {
        const on = l[1] === 'server' || used(l[1]);
        stage.ctx.save(); stage.ctx.globalAlpha = on ? 0.4 : 0.12;
        stage.path(curve(L[l[0]], L[l[1]], l[2]).map(q => [q.x, q.y]), { color: c.wire, width: 1.5, dash: on ? null : [4, 4] });
        stage.ctx.restore();
      }
      const node = (k, title, sub, o = {}) => { const b = L[k]; stage.ctx.save(); stage.ctx.globalAlpha = o.alpha ?? 1; stage.node(b.x - b.w / 2, b.y - b.h / 2, b.w, b.h, { title, sub, stroke: o.stroke, size: stage.w < 520 ? 10.5 : 12 }); stage.ctx.restore(); };
      node('client', 'Browser', 'your laptop');
      node('server', 'Web server', 'example.com');
      node('resolver', 'Resolver', null, { alpha: s.dns === 'browser' ? 0.4 : 1, stroke: c.teal });
      for (const [k, t] of [['root', 'Root'], ['tld', '.com'], ['auth', 'Auth NS']]) node(k, t, null, { alpha: s.dns === 'full' ? 1 : 0.4, stroke: c.teal });
      if (cur !== null) {
        const m = P.plan[cur], col = c[PHASE_COL[m.phase]];
        let at;
        if (m.from === m.to) {
          const sv = L.server, k = (play.vt / 500) % 1, pad = sv.w / 2 + 6 + 8 * k;
          stage.ctx.save(); stage.ctx.globalAlpha = 1 - k;
          stage.rect(sv.x - pad, sv.y - sv.h / 2 - k * 8, pad * 2, sv.h + k * 16, { stroke: col, width: 2, r: 10 });
          stage.ctx.restore();
          at = { x: sv.x, y: sv.y - sv.h / 2 };
        } else {
          const pts = linkPts(m.from, m.to, L), e = ease(frac);
          at = along(pts, e);
          for (let i = 1; i <= 5; i++) { const q = along(pts, Math.max(0, e - i * 0.03)); stage.dot(q.x, q.y, 4.5 - i * 0.6, col, 0.5 - i * 0.08); }
          stage.dot(at.x, at.y, 5, col);
        }
        label(at.x, at.y - 32, m.label, col);
      }
      if (play.land) {
        const k = (play.clock - play.land.t) / 0.5;
        if (k < 1) { const end = along(linkPts(play.land.from, play.land.to, L), 1); stage.ring(end.x, end.y, 6 + k * 14, { color: play.land.col, width: 2 }); }
        else play.land = null;
      }
      footer(ms, stage.h - 16);
    }

    // ---- 3D globe ----
    const serverPlace = () => (s.rtt <= 20 ? [19.07, 72.87, 'Server · CDN edge, Mumbai'] : s.rtt <= 60 ? [28.61, 77.21, 'Server · Delhi'] : s.rtt <= 160 ? [50.11, 8.68, 'Server · Frankfurt'] : [37.34, -121.89, 'Server · San Jose']);
    const place = k => (k === 'server' ? serverPlace() : PLACES[k]);
    const toV = (lat, lon, r = 1) => { const a = lat * Math.PI / 180, b = lon * Math.PI / 180; return [r * Math.cos(a) * Math.cos(b), r * Math.cos(a) * Math.sin(b), r * Math.sin(a)]; };
    function proj(v, cam) {
      // rotate about the polar axis by yaw, tilt towards the viewer by pitch
      const [x, y, z] = v, cy = Math.cos(cam.yaw), sy = Math.sin(cam.yaw);
      const X = y * sy - x * cy, Y = x * sy + y * cy; // Y points at the viewer before tilt; east is to the right
      const tilt = cam.pitch - 0.2, ct = Math.cos(tilt), st = Math.sin(tilt);
      const depth = Y * ct + z * st, up = z * ct - Y * st;
      return { x: cam.cx + X * cam.scale, y: cam.cy - up * cam.scale, d: depth };
    }
    const hidden = (v, cam) => { const q = proj(v, cam); return q.d < 0 && Math.hypot(q.x - cam.cx, q.y - cam.cy) < cam.scale * 0.98; };
    function arc(a, b, n = 48, lift = 0.18) {
      const A = toV(a[0], a[1]), B = toV(b[0], b[1]);
      const om = Math.acos(clamp(A[0] * B[0] + A[1] * B[1] + A[2] * B[2], -1, 1)), out = [];
      for (let i = 0; i <= n; i++) {
        const t = i / n, so = Math.sin(om) || 1, k1 = om ? Math.sin((1 - t) * om) / so : 1 - t, k2 = om ? Math.sin(t * om) / so : t;
        const r = 1 + lift * Math.sin(Math.PI * t) * Math.min(1, om * 1.4);
        out.push([(A[0] * k1 + B[0] * k2) * r, (A[1] * k1 + B[1] * k2) * r, (A[2] * k1 + B[2] * k2) * r]);
      }
      return out;
    }
    function gline(pts, cam, col, width, dash, alpha = 1) {
      let run = [], prevHidden = null;
      const flush = () => { if (run.length > 1) { stage.ctx.save(); stage.ctx.globalAlpha = prevHidden ? alpha * 0.15 : alpha; stage.path(run.map(q => [q.x, q.y]), { color: col, width, dash }); stage.ctx.restore(); } };
      for (const v of pts) {
        const hd = hidden(v, cam), q = proj(v, cam);
        if (prevHidden !== null && hd !== prevHidden) { run.push(q); flush(); run = [q]; } else run.push(q);
        prevHidden = hd;
      }
      flush();
    }
    function draw3d(cur, frac, ms) {
      const c = stage.colors, ctx = stage.ctx;
      const cam = kit.cam(Math.min(stage.w, stage.h - 40) * 0.4);
      cam.cy = (stage.h - 30) / 2;
      const g = ctx.createRadialGradient(cam.cx - cam.scale * 0.35, cam.cy - cam.scale * 0.4, cam.scale * 0.1, cam.cx, cam.cy, cam.scale);
      g.addColorStop(0, c.surface3); g.addColorStop(0.7, c.surface2); g.addColorStop(1, c.bg);
      ctx.beginPath(); ctx.arc(cam.cx, cam.cy, cam.scale, 0, Math.PI * 2); ctx.fillStyle = g; ctx.fill();
      stage.ring(cam.cx, cam.cy, cam.scale, { color: c.wire, width: 1.2 });
      const grid = pts => { let on = false; ctx.beginPath(); for (const v of pts) { const q = proj(v, cam); if (q.d > -0.05) { on ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y); on = true; } else on = false; } ctx.stroke(); };
      ctx.save(); ctx.strokeStyle = c.line2; ctx.globalAlpha = 0.55; ctx.lineWidth = 1;
      for (let lat = -60; lat <= 60; lat += 30) { const a = []; for (let lon = -180; lon <= 180; lon += 6) a.push(toV(lat, lon)); grid(a); }
      for (let lon = -180; lon < 180; lon += 30) { const a = []; for (let lat = -90; lat <= 90; lat += 6) a.push(toV(lat, lon)); grid(a); }
      ctx.restore();
      for (const k of ['client', 'resolver', 'root', 'tld', 'auth', 'server']) {
        if (!used(k)) continue;
        const pl = place(k), v = toV(pl[0], pl[1]), q = proj(v, cam), front = q.d > -0.05;
        stage.dot(q.x, q.y, k === 'client' || k === 'server' ? 6 : 4.5, k === 'server' ? c.ok : k === 'client' ? c.ink : c.teal, front ? 1 : 0.25);
        if (front) stage.text(pl[2], q.x + 9, q.y + ({ client: -7, resolver: 7, root: -7, server: 8 }[k] || 0), { size: 11, weight: 600 });
      }
      if (cur !== null) {
        const m = P.plan[cur], col = c[PHASE_COL[m.phase]], a = place(m.from);
        if (m.from === m.to) {
          const q = proj(toV(a[0], a[1]), cam), k = (play.vt / 500) % 1;
          ctx.save(); ctx.globalAlpha = 1 - k; stage.ring(q.x, q.y, 8 + k * 16, { color: col, width: 2 }); ctx.restore();
          label(q.x, q.y - 38, m.label, col);
        } else {
          const b = place(m.to), pts = arc(a, b), n = pts.length - 1, i = Math.min(n, Math.floor(ease(frac) * n));
          gline(pts, cam, col, 1.5, [4, 4], 0.5);
          gline(pts.slice(0, i + 1), cam, col, 2.5, null);
          const q = proj(pts[i], cam);
          stage.dot(q.x, q.y, 5, col, hidden(pts[i], cam) ? 0.25 : 1);
          label(q.x, q.y - 32, m.label, col);
        }
      }
      footer(ms, stage.h - 10);
    }

    function draw(dt) {
      stage.clear();
      const { cur, frac, ms } = advance(dt);
      if (kit.is3d) draw3d(cur, frac, ms); else draw2d(cur, frac, ms);
    }
    kit.loop(draw);
    paint();

    function setAll(o) {
      Object.assign(s, o);
      rttCtl.set(s.rtt, true); hint.textContent = hintFor(s.rtt);
      dnsCtl.set(s.dns, true); protoCtl.set(s.proto, true); reuseCtl.set(s.reuse, true); srvCtl.set(s.srv, true);
      rebuild();
    }

    return {
      reset() { setAll({ rtt: 80, dns: 'full', proto: 'h2', reuse: false, srv: 50 }); kit.clearLog(); },
      guidedRun() {
        setAll({ rtt: 250, dns: 'full', proto: 'h11', reuse: false, srv: 50 });
        kit.clearLog();
        import('../kit/clock.js').then(m => { if (m.isPaused()) m.setPaused(false); }).catch(() => {});
        const first = { total: P.total, trips: P.trips };
        send(() => {
          setTimeout(() => {
            protoCtl.set('h3', true); s.proto = 'h3'; rebuild();
            send(() => kit.guided.observe(`HTTP/1.1 + TLS 1.2 needed ${first.trips} round trips to the server and ${fmtMs(first.total)} to the first byte; HTTP/3 needed ${P.trips} and ${fmtMs(P.total)}.`));
          }, 700);
        });
      },
    };
  },
};
