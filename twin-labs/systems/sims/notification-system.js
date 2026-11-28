// Notifications: events → notifier (per-user cap) → one queue per channel → providers.
// Model: 200 users; each prefers push (50%), email (30%) or SMS (20%). Events arrive at 5–80 per
// second for random users. The notifier drops (holds back) a message when that user already got
// `cap` messages in the last 10 s. Providers drain their own queue: push 40/s, SMS 10/s, email 25/s.
// When the push provider is down its queue only grows; with fallback on, push messages that waited
// more than 2 s move to the SMS queue. "Flash sale" fires 300 events at once.

import { glow, along, stepper, unpause, alpha, clamp, fmtMs } from './_e-util.js';

const CH = ['push', 'sms', 'email'];
const LABEL = { push: 'Push', sms: 'SMS', email: 'Email' };
const RATES = { push: 40, sms: 10, email: 25 };
const USERS = 200, WINDOW = 10, PATIENCE = 2, PART_T = 0.5;
const PREFS = ['push', 'push', 'push', 'push', 'push', 'email', 'email', 'email', 'sms', 'sms'];

export default {
  lead: 'Orders ship, prices drop, friends post. Every event becomes a message on the channel the user prefers: push, SMS or email. Each channel has its own queue and its own provider, so a slow or broken provider does not hold up the others.',
  emptyLog: 'Events are flowing. Take the push provider down or fire a flash sale.',
  stageHeight: 360,
  tryThis: [
    'Set push <b>Down</b> with fallback <b>Off</b>. The push queue climbs while SMS and email keep going untouched: separate queues isolate the failure.',
    'Turn fallback <b>On</b>. Push messages that wait over 2 s move to SMS. SMS is slower and costs money per message, so its queue fills up.',
    'Fire the <b>Flash sale</b>. The per-user cap holds most of it back, so nobody receives ten messages in a row.',
  ],
  inShort: {
    what: 'A notification system turns events into messages on each user\'s preferred channel (push, SMS or email) through outside providers.',
    why: 'Providers fail and slow down independently, and users lose trust in an app that spams them or misses important messages.',
    tradeoff: 'Fallbacks and retries improve delivery but cost money (SMS) and risk duplicates, so messages need ids and per-user limits.',
    interview: 'Event → notification service (preferences, templates, per-user rate limit) → a queue per channel → workers calling the push service, an SMS gateway and an email provider, with retries.',
  },
  quiz: [
    { q: 'Why give push, SMS and email their own queues?', o: ['It is cheaper to store', 'A slow or broken provider then delays only its own channel', 'Push needs encryption', 'To send everything twice'], a: 1,
      why: 'Isolation: when the push provider is down, email and SMS keep flowing instead of waiting behind stuck push messages.' },
    { q: 'What does a per-user cap protect against?', o: ['Server crashes', 'Flooding one user with messages during a burst of events', 'Lost messages', 'Slow databases'], a: 1,
      why: 'A flash sale or a busy group chat can create many events for one person; the cap, or a digest, keeps it bearable.' },
    { q: 'Push is down and fallback to SMS is on. What does it cost?', o: ['Nothing', 'SMS is slower and paid per message, so its queue and the bill grow', 'Emails stop', 'Users get push twice'], a: 1,
      why: 'Fallback keeps users informed, but SMS throughput is lower and every message costs money, so keep it for important ones.' },
  ],
  guided: {
    intro: 'Take the push provider down without any fallback and watch all three queues.',
    example: '“Run the guided example” resets to 25 events per second, a cap of 3, fallback off, then marks the push provider as down.',
    question: 'What happens to the SMS and email channels while push is down?',
    predictions: ['They keep delivering normally; only the push queue grows.', 'They stall too, stuck behind the push messages.', 'They speed up to make up for push.'],
    correctPrediction: 0,
    running: 'Watch the three queue bars: push should turn red while SMS and email stay short.',
    observation: 'The push queue grew steadily while the SMS and email queues stayed short and kept delivering.',
    explainQuestion: 'Why were SMS and email unaffected?',
    explanations: ['Each channel has its own queue and workers, so a dead provider only backs up its own queue.', 'SMS and email have priority over push.', 'The notifier stopped creating push messages.'],
    correctExplanation: 0,
    why: 'Bulkheads (separate queues per dependency) keep one failure from spreading to everything else.',
    retryHint: 'Compare the three “queued” bars with the push provider marked down.',
    nextSlug: 'whatsapp',
    nextLabel: 'Next experiment: chat messenger →',
    waitSeconds: 12,
  },

  setup(kit) {
    const { stage } = kit;
    const fixed = stepper(0.05);
    const e = { rate: 25, cap: 3, fallback: true, pushUp: true };
    let N, st;

    kit.metrics([
      { key: 'sent', label: 'Delivered' }, { key: 'q', label: 'Waiting in queues' },
      { key: 'cap', label: 'Held back by the per-user cap' }, { key: 'fb', label: 'Moved from push to SMS' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'push', label: 'Push queue', color: 'wire' }, { key: 'sms', label: 'SMS queue', color: 'signal' }, { key: 'email', label: 'Email queue', color: 'teal' }],
      bars: { key: 'cap', label: 'Held back by cap', color: 'muted' },
      format: v => String(Math.round(v)),
    });

    const p = kit.panel;
    const push = p.seg('Push provider (FCM / APNs)', { options: [['up', 'Up'], ['down', 'Down']], value: 'up',
      onChange: v => { e.pushUp = v === 'up'; kit.log(e.pushUp ? 'Push provider is back up and drains its queue' : 'Push provider is down: push messages pile up in their queue'); } });
    const fb = p.seg('If push is down, fall back to SMS', { options: [['on', 'On'], ['off', 'Off']], value: 'on',
      onChange: v => { e.fallback = v === 'on'; kit.log(e.fallback ? 'Fallback on: push messages waiting over 2 s move to SMS' : 'Fallback off: push messages wait for the push provider'); } });
    const cap = p.slider('Most messages per user per 10 s', { min: 1, max: 10, step: 1, value: 3, format: v => String(v), onInput: v => { e.cap = v; } });
    const rate = p.slider('Events per second', { min: 5, max: 80, step: 5, value: 25, format: v => `${v} /s`, onInput: v => { e.rate = v; } });
    p.buttons([{ label: 'Flash sale: 300 events at once', kind: 'primary', onClick: burst }, { label: 'Reset', kind: 'outline', onClick: reset }]);

    function model() {
      return { q: { push: [], sms: [], email: [] }, carry: { push: 0, sms: 0, email: 0 }, sentBy: { push: 0, sms: 0, email: 0 }, capped: 0, fellBack: 0, recent: new Map(), delays: [] };
    }
    function send(user, ch, now) {
      const hist = (N.recent.get(user) || []).filter(t => t > now - WINDOW);
      if (hist.length >= e.cap) { N.recent.set(user, hist); N.capped++; st.secCap++; return 'capped'; }
      hist.push(now); N.recent.set(user, hist);
      N.q[ch].push({ user, t: now });
      return ch;
    }
    function event() {
      const u = Math.floor(Math.random() * USERS);
      const k = send(u, st.prefs[u], st.t);
      if (Math.random() < 0.35) st.parts.push({ k, t: 0 });
    }
    function burst() {
      const before = N.capped;
      for (let i = 0; i < 300; i++) event();
      kit.log(`Flash sale: 300 events at once; the per-user cap held back ${N.capped - before}`);
    }
    function tick(h) {
      st.t += h;
      st.acc += e.rate * h;
      while (st.acc >= 1) { st.acc -= 1; event(); }
      const before = { ...N.sentBy };
      for (const ch of CH) {
        const up = ch !== 'push' || e.pushUp;
        if (!up) { N.carry[ch] = 0; continue; }
        N.carry[ch] += RATES[ch] * h;
        while (N.carry[ch] >= 1 && N.q[ch].length) { N.carry[ch] -= 1; const m = N.q[ch].shift(); N.sentBy[ch]++; N.delays.push(st.t - m.t); }
        if (!N.q[ch].length) N.carry[ch] = Math.min(N.carry[ch], 1);
      }
      if (e.fallback && !e.pushUp) while (N.q.push.length && st.t - N.q.push[0].t > PATIENCE) { N.q.sms.push(N.q.push.shift()); N.fellBack++; }
      if (N.delays.length > 500) N.delays.splice(0, N.delays.length - 500);
      for (const ch of CH) if (N.sentBy[ch] > before[ch] && Math.random() < 0.5) st.parts.push({ k: `out-${ch}`, t: 0 });
      st.parts = st.parts.filter(x => (x.t += h) < PART_T);
      for (const ch of CH) {
        const n = N.q[ch].length;
        if (n > 100 && !st.warn[ch]) { st.warn[ch] = true; kit.log(`${LABEL[ch]} queue passed 100 waiting messages`); }
        if (n < 20) st.warn[ch] = false;
      }
    }
    const queued = () => CH.reduce((a, ch) => a + N.q[ch].length, 0);
    const sent = () => CH.reduce((a, ch) => a + N.sentBy[ch], 0);
    function reset() {
      N = model();
      st = { t: 0, acc: 0, parts: [], prefs: Array.from({ length: USERS }, () => PREFS[Math.floor(Math.random() * PREFS.length)]), secCap: 0, warn: {}, guided: null };
      kit.resetTime(); chart.reset(); kit.clearLog(); paint();
    }
    function paint() {
      kit.metric('sent', String(sent()));
      const q = queued();
      kit.metric('q', String(q), q > 100 ? 'bad' : q > 20 ? 'warn' : 'good');
      kit.metric('cap', String(N.capped), N.capped ? 'warn' : '');
      kit.metric('fb', String(N.fellBack), N.fellBack ? 'warn' : '');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h, ctx = stage.ctx;
      const narrow = W < 520, bw = clamp(W * 0.17, 60, 100), bh = narrow ? 34 : 40;
      const ev = { x: Math.max(W * 0.08, bw / 2 + 6), y: H * 0.5 }, nt = { x: W * 0.3, y: H * 0.5 };
      const ys = [H * 0.2, H * 0.5, H * 0.8], qx = W * 0.5, qw = W * 0.2;
      const prov = CH.map((ch, i) => ({ ch, x: W - Math.max(W * 0.09, bw / 2 + 6), y: ys[i] }));
      const wire = alpha(c.wire, 0.3);
      stage.line(ev.x, ev.y, nt.x, nt.y, { color: wire });
      for (const pv of prov) { stage.line(nt.x, nt.y, qx, pv.y, { color: wire }); stage.line(qx + qw, pv.y, pv.x, pv.y, { color: wire }); }
      for (const x of st.parts) {
        const k = x.t / PART_T;
        if (x.k === 'capped') { const [px, py] = along([[ev.x, ev.y], [nt.x, nt.y]], k); stage.dot(px, py, 3, c.muted, 1 - k); }
        else if (x.k.startsWith('out-')) { const pv = prov[CH.indexOf(x.k.slice(4))]; const [px, py] = along([[qx + qw, pv.y], [pv.x, pv.y]], k); stage.dot(px, py, 3.5, c.ok); }
        else { const pv = prov[CH.indexOf(x.k)]; const [px, py] = along([[ev.x, ev.y], [nt.x, nt.y], [qx, pv.y]], k); stage.dot(px, py, 3.5, c.wire); }
      }
      stage.node(ev.x - bw / 2, ev.y - bh / 2, bw, bh, { title: 'Events', sub: `${e.rate}/s` });
      stage.node(nt.x - bw / 2, nt.y - bh / 2, bw, bh, { title: narrow ? 'Notify' : 'Notifier', sub: `cap ${e.cap}/10 s` });
      for (const pv of prov) {
        const n = N.q[pv.ch].length, f = Math.min(1, n / 150);
        stage.rect(qx, pv.y - 9, qw, 18, { fill: c.surface2, stroke: c.line, width: 1, r: 5 });
        if (n) stage.rect(qx, pv.y - 9, Math.max(4, qw * f), 18, { fill: f > 0.6 ? c.bad : f > 0.15 ? c.signal : c.wire, r: 5 });
        stage.text(`${n} queued`, qx + qw / 2, pv.y, { size: 10, weight: 600, align: 'center' });
        const down = pv.ch === 'push' && !e.pushUp;
        stage.node(pv.x - bw / 2, pv.y - bh / 2, bw, bh, { title: LABEL[pv.ch], sub: down ? (narrow ? 'down' : 'provider down') : `${RATES[pv.ch]}/s`, stroke: down ? c.bad : c.wire, dashed: down, subColor: down ? c.bad : undefined });
      }
      stage.text('one queue per channel', qx + qw / 2, ys[0] - 22, { size: 10, align: 'center', color: c.muted });
      if (!e.pushUp && e.fallback) {
        ctx.save(); ctx.strokeStyle = c.signal; ctx.setLineDash([4, 4]); ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(qx - 6, ys[0]); ctx.quadraticCurveTo(qx - 26, (ys[0] + ys[1]) / 2, qx - 6, ys[1]); ctx.stroke(); ctx.restore();
      }
      const avg = N.delays.length ? N.delays.reduce((a, b) => a + b, 0) / N.delays.length : null;
      if (!narrow && avg != null) stage.text(`average wait before delivery: ${fmtMs(avg * 1000)}`, 12, H - 12, { size: 10, color: c.muted });
    }

    kit.loop(dt => { fixed(dt, tick); paint(); draw(); });
    kit.every(1, () => {
      chart.push({ push: N.q.push.length, sms: N.q.sms.length, email: N.q.email.length, cap: st.secCap });
      st.secCap = 0;
      const g = st.guided;
      if (g && kit.time - g.at >= 6) {
        st.guided = null;
        kit.guided.observe(`After ${Math.round(kit.time - g.at)} s with push down, ${N.q.push.length} push messages were waiting, while SMS had ${N.q.sms.length} and email ${N.q.email.length} queued and both kept delivering.`);
      }
    });
    reset();

    return {
      reset,
      guidedRun() {
        rate.set(25, true); e.rate = 25;
        cap.set(3, true); e.cap = 3;
        fb.set('off', true); e.fallback = false;
        push.set('up', true); e.pushUp = true;
        reset();
        unpause();
        push.set('down');
        st.guided = { at: 0 };
      },
    };
  },
};
