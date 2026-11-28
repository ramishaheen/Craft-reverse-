// Real-time updates: four delivery strategies run side by side on the same random server events.
// Model: server events arrive as a Poisson process (events per minute). One-way network delay = RTT/2.
// - Short polling: a request leaves every `interval` s; it sees events that happened before it reached
//   the server (send + RTT/2) and returns them RTT/2 later; a request that finds nothing is "empty".
// - Long polling: the request waits at the server until an event (or a 30 s hold timeout, an empty
//   response), returns it after RTT/2, and the browser immediately sends the next request (another RTT/2).
// - Server-Sent Events and WebSocket: one open connection; each event arrives RTT/2 after it happens.
// Costs: each HTTP request carries ~800 bytes of headers; an SSE frame ~20 bytes; a WebSocket frame ~6.
// With chat on, users send messages at the same rate: one extra HTTP request each, except over a
// WebSocket, which carries them as frames on the open connection.

import { fixedStep, addCard, addLegend, unpause, no3d, fmtMs, bytes, count, clamp } from './_b-kit.js';
import { h } from '../../js/core/dom.js';

const HEADER_B = 800, SSE_B = 20, WS_B = 6, HOLD_S = 30, VIEW_S = 20;
const EVENTS = [2, 6, 12, 30, 60, 120];
const USERS = [1e3, 1e4, 1e5, 1e6];
const STRATS = [['poll', 'Short polling', 'signal'], ['lp', 'Long polling', 'violet'], ['sse', 'Server-Sent Events', 'teal'], ['ws', 'WebSocket', 'ok']];

function channel(kind, { rtt, poll }) {
  const half = rtt / 2;
  const ch = { kind, pending: [], deliveries: [], requests: kind === 'poll' ? [] : [0], empties: 0, emptyAt: [] };
  if (kind === 'poll') ch.next = 0;
  if (kind === 'lp') ch.at = half; // the first long-poll request is waiting at the server
  const take = (upTo, deliverAt) => {
    const got = ch.pending.filter(t => t <= upTo);
    ch.pending = ch.pending.filter(t => t > upTo);
    for (const t of got) ch.deliveries.push({ te: t, td: deliverAt });
    return got.length;
  };
  ch.event = t => { if (kind === 'sse' || kind === 'ws') ch.deliveries.push({ te: t, td: t + half }); else ch.pending.push(t); };
  ch.advance = now => {
    if (kind === 'poll') {
      while (ch.next + half <= now) {
        const arrive = ch.next + half;
        ch.requests.push(ch.next);
        if (!take(arrive, ch.next + rtt)) { ch.empties++; ch.emptyAt.push(ch.next + rtt); }
        ch.next += poll;
      }
    } else if (kind === 'lp') {
      for (let guard = 0; guard < 1000; guard++) {
        const first = ch.pending.length ? Math.min(...ch.pending) : Infinity;
        const answer = Math.max(ch.at, first);
        if (first !== Infinity && answer <= now) { take(answer, answer + half); ch.at = answer + rtt; ch.requests.push(answer + half); continue; }
        if (first === Infinity && ch.at + HOLD_S <= now) { ch.empties++; ch.emptyAt.push(ch.at + HOLD_S + half); ch.requests.push(ch.at + HOLD_S + half); ch.at += HOLD_S + rtt; continue; }
        break;
      }
    }
  };
  return ch;
}

export default {
  lead: 'A chat message, a price change, a notification: the server has news and the browser wants it right away. Four ways of getting it there run side by side on the very same events, so you can compare the delay each adds and the requests each costs.',
  emptyLog: 'Nothing yet. Change the event rate or the polling interval.',
  stageHeight: 360,
  tryThis: [
    'Make events rare (<b>2 per minute</b>). Polling fires request after request, and most of them come back empty.',
    'Cut the polling interval to <b>1 s</b>: the delay improves, but look at the requests per minute and multiply by your users.',
    'Long polling feels instant, yet every delivery costs a whole new request. With frequent events it starts to behave like polling.',
    'Turn on <b>chat</b>: SSE only goes one way, so each message a user sends is an extra HTTP request. A WebSocket carries both directions on one connection.',
  ],
  inShort: {
    what: 'Four ways to push news to a browser: short polling, long polling, server-sent events (SSE) and WebSockets.',
    why: 'Chat, live prices and notifications must update within a second without the user reloading the page.',
    tradeoff: 'Polling is simple but wastes requests; WebSockets are the fastest but hold one open connection per user, which costs memory and needs sticky routing.',
    interview: 'WebSockets for two-way chat, SSE for one-way live updates, and long polling as the fallback.',
  },
  quiz: [
    { q: 'Events are rare. Which strategy throws away the most requests?', o: ['WebSocket', 'Server-Sent Events', 'Short polling', 'Long polling'], a: 2,
      why: 'Short polling asks on a timer whether there is news or not, so most of its answers are empty.' },
    { q: 'The server must push updates and the client never replies. What is the simplest choice?', o: ['Server-Sent Events', 'Raw TCP', 'Short polling every 100 ms', 'Email'], a: 0,
      why: 'SSE is one-way server push over ordinary HTTP, and browsers reconnect automatically.' },
    { q: 'At scale, what is the main server cost of WebSockets, SSE and long polling?', o: ['CPU for TLS alone', 'Keeping one open connection for every connected user', 'Disk space', 'DNS lookups'], a: 1,
      why: 'Every user holds a connection open, so you plan for millions of concurrent connections and sticky routing.' },
  ],
  guided: {
    intro: 'Let the four strategies deliver the same events for a few seconds, then compare their delays.',
    example: '“Run the guided example” restarts the timelines with 30 events a minute, a 5 s polling interval, a 100 ms round trip and 100k users.',
    question: 'How do the average delays compare?',
    predictions: ['SSE and WebSocket deliver in about half a round trip; short polling waits seconds.', 'All four deliver within the same 50 ms.', 'Short polling is the fastest because it asks most often.'],
    correctPrediction: 0,
    running: 'Watch the green delay lines on each timeline and the “Avg delay” column of the table.',
    observation: 'The push strategies delivered about 50 ms after each event, while short polling made events wait for the next poll.',
    explainQuestion: 'Why is short polling so much slower here?',
    explanations: ['An event waits at the server until the next poll arrives, on average half the polling interval.', 'Polling requests are larger, so they travel more slowly.', 'The server processes polls last.'],
    correctExplanation: 0,
    why: 'Short polling trades delay against wasted requests: a shorter interval cuts the delay but multiplies the requests.',
    retryHint: 'Look at how far the green line stretches from each diamond on the short-polling lane.',
    nextSlug: 'realtime-analytics',
    nextLabel: 'Next experiment: real-time analytics →',
    waitSeconds: 16,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { ev: 30, poll: 5, rtt: 0.1, users: 1e5, up: false };
    let st, watchAt = null;

    kit.metrics(STRATS.map(([k, name]) => ({ key: k, label: `${name} delay` })));
    const chart = kit.chart({ lines: STRATS.map(([k, name, col]) => ({ key: k, label: name, color: col })), format: v => fmtMs(v) });
    addLegend(kit, [['ink', 'Server event', 'box'], ['muted', 'HTTP request'], ['ok', 'Delivered (line = delay)'], ['wire', 'Connection held open'], ['bad', '× Empty response (wasted request)']]);
    const table = h('table', { style: { width: '100%', borderCollapse: 'collapse', fontSize: '13px', minWidth: '560px' } });
    const card = addCard(kit, 'The last 60 seconds, side by side');
    card.body.append(h('div', { style: { overflowX: 'auto' } }, table));

    const p = kit.panel;
    const ev = p.slider('Server events', { values: EVENTS, value: s.ev, format: v => `${v} / min`, onInput: v => { s.ev = v; if (st) st.nextEv = Math.min(st.nextEv, nextGap(st.t)); } });
    const poll = p.slider('Polling interval', { min: 1, max: 30, step: 1, value: s.poll, format: v => `${v} s`, onInput: v => { s.poll = v; restart(); } });
    const rtt = p.slider('Network round trip', { min: 20, max: 400, step: 10, value: 100, format: v => `${v} ms`, onInput: v => { s.rtt = v / 1000; restart(); } });
    const users = p.slider('Connected users', { values: USERS, value: s.users, format: v => count(v), onInput: v => { s.users = v; paintTable(); } });
    const up = p.toggle('Users send messages too (chat)', { value: false, onChange: v => { s.up = v; st.nextUp = st.t; kit.log(v ? 'Chat on: users now send messages at the same rate as server events' : 'Chat off: traffic is one-way again'); } });
    p.buttons([{ label: 'Restart timelines', kind: 'outline', onClick: () => { restart(); kit.log('Timelines restarted'); } }]);

    const nextGap = from => from - Math.log(1 - Math.random()) / (s.ev / 60);
    function restart() {
      st = { t: 0, events: [], ups: [], nextUp: 0, ch: STRATS.map(([k]) => channel(k, { rtt: s.rtt, poll: s.poll })) };
      st.nextEv = nextGap(0);
      kit.resetTime();
      chart.reset();
      paintTable();
    }

    const step = fixedStep(dt => {
      st.t += dt;
      while (st.nextEv <= st.t) { const t = st.nextEv; st.events.push(t); for (const ch of st.ch) ch.event(t); st.nextEv = nextGap(t); }
      if (s.up) { while (st.nextUp <= st.t) { st.ups.push(st.nextUp); st.nextUp = nextGap(st.nextUp); } } else st.nextUp = st.t;
      for (const ch of st.ch) ch.advance(st.t);
      const cut = st.t - 61;
      st.events = st.events.filter(t => t > cut);
      st.ups = st.ups.filter(t => t > cut);
      for (const ch of st.ch) { ch.deliveries = ch.deliveries.filter(d => d.td > cut); ch.requests = ch.requests.filter(t => t > cut); ch.emptyAt = ch.emptyAt.filter(t => t > cut); }
    });

    function stats(ch, kind) {
      const span = Math.min(60, Math.max(1, st.t)), from = st.t - span;
      const got = ch.deliveries.filter(d => d.td > from && d.td <= st.t);
      const avg = got.length ? got.reduce((a, d) => a + d.td - d.te, 0) / got.length : null;
      const ups = st.ups.filter(t => t > from).length;
      const reqs = ch.requests.filter(t => t > from && t <= st.t).length + (kind === 'ws' ? 0 : ups);
      const perMin = (reqs / span) * 60;
      const b = reqs * HEADER_B + got.length * (kind === 'ws' ? WS_B : kind === 'sse' ? SSE_B : 0) + (kind === 'ws' ? ups * WS_B : 0);
      const conns = kind === 'poll' ? s.users * Math.min(1, s.rtt / s.poll) : s.users;
      return { avg, perMin, bytes: (b / span) * 60, srv: (s.users * perMin) / 60, conns, n: got.length };
    }
    function paintTable() {
      const rows = STRATS.map(([k, name], i) => ({ k, name, ...stats(st.ch[i], k) }));
      const best = f => Math.min(...rows.map(f).filter(v => v != null));
      const bestAvg = best(r => r.avg), bestSrv = best(r => r.srv);
      const th = txt => h('th', { style: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)', color: 'var(--text-2)', fontWeight: 600, verticalAlign: 'bottom' }, html: txt });
      const td = (txt, tone) => h('td', { style: { padding: '6px 8px', borderBottom: '1px solid var(--line)', fontVariantNumeric: 'tabular-nums', color: tone === 'good' ? 'var(--green)' : tone === 'bad' ? 'var(--red)' : 'var(--text)', fontWeight: tone ? 700 : 500 } }, txt);
      table.replaceChildren(
        h('thead', h('tr', th('Strategy'), th('Avg delay'), th('Requests / min<br><small>one user</small>'), th('Header bytes / min<br><small>one user</small>'), th(`Server requests / s<br><small>${count(s.users)} users</small>`), th('Open connections'))),
        h('tbody', rows.map(r => h('tr',
          h('th', { scope: 'row', style: { textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--line)' } }, r.name),
          td(r.avg == null ? '–' : fmtMs(r.avg * 1000), r.avg != null && r.avg <= bestAvg * 1.05 ? 'good' : ''),
          td(r.perMin.toFixed(1)), td(bytes(r.bytes)),
          td(count(r.srv), r.srv <= bestSrv * 1.05 ? 'good' : r.srv > bestSrv * 5 ? 'bad' : ''),
          td(count(r.conns))))));
      rows.forEach(r => kit.metric(r.k, r.avg == null ? '–' : fmtMs(r.avg * 1000), r.avg == null ? '' : r.avg < 0.3 ? 'good' : r.avg > 2 ? 'bad' : 'warn'));
      return rows;
    }

    kit.every(1, () => {
      const rows = paintTable();
      chart.push(Object.fromEntries(rows.map(r => [r.k, r.avg == null ? null : r.avg * 1000])));
      if (watchAt != null && st.t >= watchAt && rows[0].n >= 2 && rows[3].n >= 2) {
        watchAt = null;
        kit.guided.observe(`Average delay: short polling ${fmtMs(rows[0].avg * 1000)}, long polling ${fmtMs(rows[1].avg * 1000)}, SSE ${fmtMs(rows[2].avg * 1000)}, WebSocket ${fmtMs(rows[3].avg * 1000)}.`);
      }
    });

    function cross(x, y, col, a = 0.55) {
      const ctx = stage.ctx;
      ctx.save(); ctx.globalAlpha = a; ctx.strokeStyle = col; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(x - 3, y - 3); ctx.lineTo(x + 3, y + 3); ctx.moveTo(x + 3, y - 3); ctx.lineTo(x - 3, y + 3); ctx.stroke(); ctx.restore();
    }
    function draw() {
      stage.clear();
      const c = stage.colors, ctx = stage.ctx, w = stage.w, H = stage.h;
      const lw = clamp(w * 0.2, 84, 150), x0 = lw + 10, x1 = w - 12, top = 34, laneH = (H - top - 10) / 4;
      const X = t => x1 - ((st.t - t) / VIEW_S) * (x1 - x0);
      stage.text('Server events', 10, 14, { size: 11.5, weight: 600 });
      stage.line(x0, 14.5, x1, 14.5, { color: c.line, width: 1 });
      for (const t of st.events) {
        if (t < st.t - VIEW_S) continue;
        ctx.save(); ctx.translate(X(t), 14); ctx.rotate(Math.PI / 4); ctx.fillStyle = c.ink; ctx.fillRect(-3.5, -3.5, 7, 7); ctx.restore();
      }
      if (s.up) for (const t of st.ups) if (t >= st.t - VIEW_S) stage.dot(X(t), 24, 2.5, c.muted);
      STRATS.forEach(([k, name, colKey], i) => {
        const ch = st.ch[i], y0 = top + i * laneH, mid = y0 + laneH / 2, col = c[colKey];
        ctx.save(); ctx.globalAlpha = 0.6; stage.rect(6, y0 + 4, w - 12, laneH - 8, { fill: c.surface, r: 8 }); ctx.restore();
        stage.text(name, 14, mid, { size: 11.5, weight: 700, color: col });
        if (k === 'sse' || k === 'ws') { ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = c.wire; ctx.fillRect(x0, mid - 3, x1 - x0, 6); ctx.restore(); }
        if (k === 'lp') {
          const r = ch.requests;
          for (let j = 0; j < r.length; j++) {
            const a = Math.max(r[j], st.t - VIEW_S), b = j + 1 < r.length ? r[j + 1] : st.t;
            if (b < st.t - VIEW_S) continue;
            ctx.save(); ctx.globalAlpha = 0.25; ctx.fillStyle = c.wire; ctx.fillRect(X(a), mid - 3, Math.max(1, X(b) - X(a) - 2), 6); ctx.restore();
          }
        }
        const ticks = ch.requests.filter(t => t > st.t - VIEW_S && t <= st.t);
        if (k !== 'ws' && s.up) for (const t of st.ups) if (t > st.t - VIEW_S) ticks.push(t);
        for (const t of ticks) { const x = Math.round(X(t)) + 0.5; stage.line(x, mid + 6, x, mid + 14, { color: c.muted, width: 1.5 }); }
        for (const d of ch.deliveries) {
          if (d.td < st.t - VIEW_S || d.td > st.t) continue;
          const xa = Math.max(x0, X(d.te)), xb = X(d.td);
          stage.line(xa, mid - 8, xb, mid - 8, { color: col, width: 2, alpha: 0.45 });
          stage.dot(xb, mid - 8, 4, col);
          const age = st.t - d.td;
          if (age < 0.6) stage.ring(xb, mid - 8, 4 + age * 18, { color: col, width: 1.5 });
        }
        for (const t of ch.emptyAt) {
          if (t < st.t - VIEW_S || t > st.t) continue;
          const age = st.t - t;
          cross(X(t), mid + 22, c.bad, age < 0.6 ? 1 - age * 0.7 : 0.55);
        }
      });
      stage.text(`last ${VIEW_S} s → now`, x1, top - 5, { size: 9.5, color: c.muted, align: 'right' });
    }

    no3d(kit);
    kit.loop(dt => { step(dt); draw(); });
    restart();

    return {
      reset() { restart(); kit.clearLog(); },
      guidedRun() {
        ev.set(30, true); s.ev = 30;
        poll.set(5, true); s.poll = 5;
        rtt.set(100, true); s.rtt = 0.1;
        users.set(1e5, true); s.users = 1e5;
        up.set(false, true); s.up = false;
        restart(); kit.clearLog();
        unpause();
        watchAt = 10;
      },
    };
  },
};
