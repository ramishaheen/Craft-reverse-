// Chat messenger: Alice's phone → chat server (with Bob's offline inbox) → Bob's phone.
// Model: every hop takes 0.35 s. The server stores a message (first time it sees its id) and acks
// Alice (one tick). If Bob is online the message is pushed to his phone, which sends a "delivered"
// receipt back through the server (two ticks). If Bob's chat with Alice is open, his phone sends a
// "read" receipt 0.6 s after the message arrived (blue ticks). If Bob is offline, messages wait in his
// inbox on the server and are pushed when he reconnects. Acks from the server to Alice can be lost
// (0–60%); with no ack within 1 s her phone resends the same id, and the server drops the repeat.
// Alice also sends a new message on her own every 2.4 s. Only the last 40 messages are kept.

import { glow, lost, stepper, fit, unpause, alpha } from './_e-util.js';

const HOP = 0.35;      // seconds per network hop
const RESEND = 1;      // seconds Alice waits for the server's ack before resending
const READ_DELAY = 0.6; // seconds between arrival and the read receipt when the chat is open
const AUTO = 2.4;      // Alice sends a new message every 2.4 s
const TEXTS = ['hey!', 'free tonight?', 'ring me', 'coffee at 4?', 'file is up', 'sure 👍', 'leaving now', 'where r u?', 'congrats 🎉', 'talk later'];
const ORDER = ['sending', 'sent', 'delivered', 'read'];
const LANE = { msg: 0.3, ack: 0.42, delivered: 0.56, read: 0.7 };

export default {
  lead: 'Alice messages Bob. One tick means the chat server has saved the message, two ticks mean it reached Bob\'s phone, blue ticks mean he looked at the chat. While Bob is offline the server parks messages in his inbox; on a lossy network Alice\'s phone sends again, and the server spots the repeated message id so Bob only ever sees one copy.',
  emptyLog: 'Nothing yet. Alice sends a message every few seconds; switch Bob offline or raise the ack loss.',
  stageHeight: 330,
  tryThis: [
    'Switch Bob to <b>Offline</b> and send a few messages. Each one shows a single tick: the server holds it, Bob does not. Bring him back online and the whole backlog lands at once.',
    '<b>Close</b> Bob\'s chat. New messages reach two grey ticks and stop there until he opens it again.',
    'Push <b>Acks lost</b> to 50%. Alice\'s phone keeps resending, yet the server recognises each id, so Bob still receives every message exactly once.',
  ],
  inShort: {
    what: 'A chat service such as WhatsApp saves every message on a server, pushes it to the recipient and turns the acknowledgements into sent, delivered and read ticks.',
    why: 'Phones drop off the network and packets go missing, yet each message has to arrive once, and in order.',
    tradeoff: 'A per-user inbox costs storage until the message is delivered. Retries make sending reliable, but only message ids stop them turning into duplicates.',
    interview: 'Each device keeps a persistent WebSocket; a message is written to the recipient\'s inbox under a client-generated id, pushed right away or queued until the device is online, and delivered and read receipts flow back to the sender.',
  },
  quiz: [
    { q: 'What does a single tick next to a chat message tell the sender?', o: ['The recipient has read it', 'The chat server has saved it', 'The recipient is online', 'Sending failed'], a: 1,
      why: 'The server acknowledges once the message is safely stored. The second tick comes from the recipient\'s phone and the blue ticks from opening the chat.' },
    { q: 'Bob\'s phone is switched off. Where does Alice\'s message wait?', o: ['Only on Alice\'s phone', 'In Bob\'s inbox on the server until his phone reconnects', 'Nowhere, it is dropped', 'In an email'], a: 1,
      why: 'The server keeps a queue of undelivered messages per user and pushes them as soon as the device comes back.' },
    { q: 'An ack was lost, so Alice\'s phone sent the message again. Why doesn\'t Bob get it twice?', o: ['Pure luck', 'The server sees a message id it has already stored and discards the copy', 'Bob deletes the extra one', 'Resent messages are encrypted'], a: 1,
      why: 'Because the client picks the message id, sending becomes idempotent and retrying is harmless.' },
  ],
  guided: {
    intro: 'Take Bob offline, send three messages, then bring him back and watch where the messages were in the meantime.',
    example: '“Run the guided example” resets the chat with no ack loss and Bob\'s chat open, switches Bob offline, sends three messages, and reconnects him about 4 seconds later.',
    question: 'What happens to the three messages while Bob is offline?',
    predictions: ['They wait in Bob\'s inbox on the server with one tick, then all arrive when he reconnects.', 'They are lost, and Alice has to type them again.', 'They stay on Alice\'s phone with a clock icon until Bob is back.'],
    correctPrediction: 0,
    running: 'Watch the server\'s inbox list fill up while Bob is offline, then empty when he reconnects. The ticks on Alice\'s side move from one to two to blue.',
    observation: 'The messages were stored by the server (one tick) and sat in Bob\'s inbox; when he reconnected they were pushed to his phone and the receipts came back.',
    explainQuestion: 'Why did Alice see one tick while Bob was offline?',
    explanations: ['The server had stored the messages and acknowledged them, but Bob\'s phone had not received them yet.', 'Alice\'s phone was offline too.', 'One tick means the message failed and will be retried by Bob.'],
    correctExplanation: 0,
    why: 'Store and forward separates "the server has it" from "the recipient has it": the inbox absorbs any time the recipient is away, and receipts report each step back.',
    retryHint: 'Look at the server\'s inbox and the tick icons on Alice\'s phone while Bob was offline.',
    nextSlug: 'instagram',
    nextLabel: 'Next experiment: photo sharing →',
    waitSeconds: 12,
  },

  setup(kit) {
    const { stage } = kit;
    const fixed = stepper(0.05);
    const s = { loss: 0, online: true, open: true };
    let C;            // chat model
    let ui;           // auto-send timer, guided state
    let win;          // per-second counters for the chart

    kit.metrics([
      { key: 'wait', label: 'Waiting in Bob\'s inbox' }, { key: 'del', label: 'Delivered (two ticks)' },
      { key: 'read', label: 'Read (blue ticks)' }, { key: 'dup', label: 'Resends dropped as repeats' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'wait', label: 'Waiting in inbox', color: 'signal' }, { key: 'unread', label: 'Delivered, not read', color: 'wire' }],
      bars: { key: 'dup', label: 'Repeats dropped', color: 'bad' },
      format: v => String(Math.round(v)),
    });

    const p = kit.panel;
    p.buttons([{ label: 'Send a message', kind: 'primary', onClick: () => send(true), wide: true }]);
    const net = p.seg('Bob\'s phone', { options: [['up', 'Online'], ['down', 'Offline']], value: 'up', onChange: v => setOnline(v === 'up') });
    const open = p.seg('Bob\'s chat with Alice', { options: [['open', 'Open'], ['closed', 'Closed']], value: 'open', onChange: v => setOpen(v === 'open') });
    const loss = p.slider('Acks lost on Alice\'s network', { min: 0, max: 60, step: 5, value: 0, format: v => `${v}%`, hint: 'If no ack arrives within 1 s, Alice\'s phone sends again',
      onInput: v => { s.loss = v / 100; } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    // ---------------- model ----------------
    function model() {
      return { now: 0, msgs: [], inbox: [], seen: new Set(), packets: [], timers: [], dups: 0, next: 1 };
    }
    const later = (sec, fn) => C.timers.push({ at: C.now + sec, fn });
    function hop(from, to, kind, m, onArrive, isLost = false) {
      C.packets.push({ from, to, kind, id: m.id, t0: C.now, t1: C.now + HOP, lost: isLost });
      later(HOP, () => { if (!isLost) onArrive(); });
    }
    const raise = (m, state) => { if (ORDER.indexOf(state) > ORDER.indexOf(m.state)) m.state = state; };

    function transmit(m) {
      m.tries++;
      hop('a', 's', 'msg', m, () => {
        if (C.seen.has(m.id)) {
          C.dups++; win.dup++;
          kit.log(`Server already stored #${m.id}, so the resent copy was dropped`);
        } else {
          C.seen.add(m.id); C.inbox.push(m); m.stored = C.now;
          if (!s.online) kit.log(`Server stored #${m.id} (one tick). Bob is offline, so it waits in his inbox`);
          flush();
        }
        const ackLost = Math.random() < s.loss;
        if (ackLost) kit.log(`The ack for #${m.id} got lost on Alice's network`);
        hop('s', 'a', 'ack', m, () => raise(m, 'sent'), ackLost);
      });
      later(RESEND, () => {
        if (m.state === 'sending') { kit.log(`No ack for #${m.id} after 1 s, so Alice's phone sends it again (same id)`); transmit(m); }
      });
    }
    function flush() {
      if (!s.online) return;
      for (const m of C.inbox.splice(0)) {
        hop('s', 'b', 'msg', m, () => {
          if (!s.online) { C.inbox.push(m); return; }
          m.atBob = C.now;
          hop('b', 's', 'delivered', m, () => hop('s', 'a', 'delivered', m, () => { raise(m, 'delivered'); checkGuided(); }));
          readReceipt(m);
        });
      }
    }
    function readReceipt(m) {
      if (!s.open || !s.online || m.atBob == null || m.readSent) return;
      m.readSent = true;
      later(READ_DELAY, () => hop('b', 's', 'read', m, () => hop('s', 'a', 'read', m, () => raise(m, 'read'))));
    }
    function send(byHand) {
      const m = { id: C.next++, text: TEXTS[(C.next - 2) % TEXTS.length], t: C.now, state: 'sending', tries: 0, stored: null, atBob: null, readSent: false };
      C.msgs.push(m);
      transmit(m);
      if (byHand) ui.auto = 0;
      paintMetrics();
      return m;
    }
    function setOnline(on) {
      s.online = on;
      if (on) {
        const n = C.inbox.length;
        kit.log(n ? `Bob is back online: the server pushes ${n} waiting message${n > 1 ? 's' : ''}` : 'Bob is back online');
        flush(); C.msgs.forEach(readReceipt);
      } else kit.log('Bob went offline. New messages will wait in his inbox on the server');
      paintMetrics();
    }
    function setOpen(on) {
      s.open = on;
      kit.log(on ? 'Bob opened the chat: unread messages get read receipts' : 'Bob closed the chat: messages will stop at two grey ticks');
      if (on) C.msgs.forEach(readReceipt);
      paintMetrics();
    }
    function tick(h) {
      C.now += h;
      let due;
      let guard = 0;
      while ((due = C.timers.filter(t => t.at <= C.now)).length && guard++ < 50) {
        C.timers = C.timers.filter(t => t.at > C.now);
        due.sort((a, b) => a.at - b.at).forEach(t => t.fn());
      }
      C.packets = C.packets.filter(pk => C.now < pk.t1 + 0.3);
      if (C.msgs.length > 40) C.msgs.splice(0, C.msgs.length - 40);
    }
    const count = st => C.msgs.filter(m => m.state === st).length;

    function reset() {
      C = model();
      ui = { auto: 0, guided: null };
      win = { dup: 0 };
      kit.resetTime();
      chart.reset();
      kit.clearLog();
      paintMetrics();
    }
    function checkGuided() {
      const g = ui.guided;
      if (!g || !g.reconnected) return;
      if (g.ids.every(id => { const m = C.msgs.find(x => x.id === id); return !m || ORDER.indexOf(m.state) >= 2; })) {
        ui.guided = null;
        kit.guided.observe(`All three messages waited in Bob's inbox (one tick each) while he was offline, then reached his phone within about a second of reconnecting and turned to two ticks.`);
      }
    }

    function paintMetrics() {
      kit.metric('wait', String(C.inbox.length), C.inbox.length ? 'warn' : 'good');
      kit.metric('del', String(count('delivered') + count('read')));
      kit.metric('read', String(count('read')), 'good');
      kit.metric('dup', String(C.dups), C.dups ? 'warn' : '');
    }

    // ---------------- drawing ----------------
    function tickIcon(x, y, m) {
      const { ctx } = stage, c = stage.colors;
      ctx.save();
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = m.state === 'read' ? c.wire : c.muted;
      if (m.state === 'sending') {
        ctx.beginPath(); ctx.arc(x - 3, y, 3.5, 0, Math.PI * 2);
        ctx.moveTo(x - 3, y - 2); ctx.lineTo(x - 3, y); ctx.lineTo(x - 1.5, y + 1); ctx.stroke();
        ctx.restore(); return;
      }
      const one = off => { ctx.beginPath(); ctx.moveTo(x + off - 6, y); ctx.lineTo(x + off - 3.5, y + 2.5); ctx.lineTo(x + off + 1, y - 3); ctx.stroke(); };
      one(0);
      if (m.state !== 'sent') one(4);
      ctx.restore();
    }

    function draw(dt) {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h;
      const narrow = W < 520;
      const phoneW = narrow ? W * 0.32 : W * 0.28;
      const ax = 10, bx = W - 10 - phoneW;
      const srvW = narrow ? W * 0.22 : W * 0.2, sx = (W - srvW) / 2;
      const top = 20, bot = H - 10;
      const edge = { a: ax + phoneW, s: sx, b: bx };

      const phone = (x, title, sub) => {
        stage.rect(x, top, phoneW, bot - top, { fill: c.surface, stroke: c.line, r: 12, width: 1 });
        stage.text(title, x + phoneW / 2, top + 12, { size: 11, weight: 700, align: 'center' });
        if (sub) stage.text(sub, x + phoneW / 2, top + 25, { size: 9, align: 'center', color: s.online ? c.muted : c.bad });
      };
      phone(ax, 'Alice');
      phone(bx, 'Bob', s.online ? (s.open ? 'chat open' : 'chat closed') : 'offline');

      // server and Bob's inbox
      const sTop = top + 30, sH = bot - top - 60;
      stage.rect(sx, sTop, srvW, sH, { fill: c.surface2, stroke: c.wire, r: 10 });
      stage.text(narrow ? 'server' : 'chat server', W / 2, sTop + 12, { size: 11, weight: 700, align: 'center' });
      stage.text(narrow ? 'Bob\'s inbox' : 'Bob\'s inbox (offline queue)', W / 2, sTop + 26, { size: 9, align: 'center', color: c.muted, maxWidth: srvW - 6 });
      const rows = Math.max(1, Math.min(12, Math.floor((sH - 56) / 15)));
      C.inbox.slice(0, rows).forEach((m, i) => {
        const y = sTop + 40 + i * 15;
        stage.rect(sx + 8, y, srvW - 16, 12, { fill: alpha(c.signal, 0.25), r: 3 });
        stage.ctx.font = `500 9px ${stage.font}`;
        stage.text(fit(stage, `#${m.id}${narrow ? '' : ' ' + m.text}`, srvW - 20), W / 2, y + 6, { size: 9, align: 'center' });
      });
      if (C.inbox.length > rows) stage.text(`+${C.inbox.length - rows} more`, W / 2, sTop + 40 + rows * 15 + 6, { size: 9, align: 'center', color: c.muted });

      // Alice's sent messages with ticks
      const rowH = narrow ? 18 : 20;
      const fitRows = Math.max(1, Math.floor((bot - top - 40) / rowH));
      const bw = phoneW - 16;
      C.msgs.slice(-fitRows).forEach((m, i) => {
        const y = top + 34 + i * rowH;
        stage.rect(ax + 8, y, bw, rowH - 4, { fill: alpha(c.ok, 0.16), r: 5 });
        stage.ctx.font = `500 ${narrow ? 9 : 10}px ${stage.font}`;
        stage.text(fit(stage, narrow ? `#${m.id}` : m.text, bw - 22), ax + 13, y + (rowH - 4) / 2, { size: narrow ? 9 : 10 });
        tickIcon(ax + 8 + bw - 6, y + (rowH - 4) / 2, m);
      });

      // Bob's side
      const atBob = C.msgs.filter(m => m.atBob != null);
      const midY = (top + bot) / 2, bxc = bx + phoneW / 2;
      if (!s.online) stage.text('no connection', bxc, midY, { size: 10, align: 'center', color: c.muted });
      else if (s.open) {
        atBob.slice(-fitRows).forEach((m, i) => {
          const y = top + 34 + i * rowH;
          stage.rect(bx + 8, y, bw, rowH - 4, { fill: c.surface2, r: 5 });
          stage.ctx.font = `500 ${narrow ? 9 : 10}px ${stage.font}`;
          stage.text(fit(stage, narrow ? `#${m.id}` : m.text, bw - 10), bx + 13, y + (rowH - 4) / 2, { size: narrow ? 9 : 10 });
        });
      } else {
        const unread = atBob.filter(m => !m.readSent).length;
        stage.text('Alice', bxc, midY - 8, { size: 10, weight: 600, align: 'center' });
        if (unread) { glow(stage, bxc, midY + 10, 9, c.ok); stage.text(String(unread), bxc, midY + 10, { size: 10, weight: 700, align: 'center', color: c.surface }); }
      }

      // packets in flight
      const col = { msg: c.ink, ack: c.muted, delivered: c.ok, read: c.wire };
      for (const pk of C.packets) {
        const k = Math.min(1, (C.now - pk.t0) / (pk.t1 - pk.t0));
        const x0 = pk.from === 's' ? (pk.to === 'a' ? edge.s : edge.s + srvW) : edge[pk.from];
        const x1 = pk.to === 's' ? (pk.from === 'a' ? edge.s : edge.s + srvW) : edge[pk.to];
        const y = top + (bot - top) * LANE[pk.kind];
        const x = x0 + (x1 - x0) * (pk.lost ? Math.min(k, 0.5) : k);
        if (pk.lost && k >= 0.5) lost(stage, x, y, Math.min(1, (k - 0.5) * 2), c.bad);
        else if (k < 1) glow(stage, x, y, 3, col[pk.kind]);
      }
      if (!narrow) {
        for (const [label, kind] of [['message', 'msg'], ['stored ✓', 'ack'], ['delivered ✓✓', 'delivered'], ['read', 'read']]) {
          const y = top + (bot - top) * LANE[kind] - 8;
          stage.text(label, (edge.a + edge.s) / 2, y, { size: 9, align: 'center', color: col[kind] });
          if (kind !== 'ack') stage.text(label, (edge.s + srvW + edge.b) / 2, y, { size: 9, align: 'center', color: col[kind] });
        }
      }
    }

    kit.loop(dt => {
      fixed(dt, h => {
        ui.auto += h;
        if (ui.auto >= AUTO) { ui.auto = 0; send(false); }
        tick(h);
        const g = ui.guided;
        if (g) {
          g.t += h;
          while (g.queue.length && g.t >= g.queue[0][0]) g.queue.shift()[1]();
        }
      });
      paintMetrics();
      draw(dt);
    });
    kit.every(1, () => {
      const unread = C.msgs.filter(m => m.state === 'delivered').length;
      chart.push({ wait: C.inbox.length, unread, dup: win.dup });
      win.dup = 0;
    });
    reset();

    return {
      reset,
      guidedRun() {
        loss.set(0, true); s.loss = 0;
        open.set('open', true); s.open = true;
        net.set('up', true); s.online = true;
        reset();
        unpause();
        net.set('down', true); setOnline(false);
        const g = { t: 0, ids: [], reconnected: false, queue: [] };
        ui.guided = g;
        ui.auto = -6; // keep the automatic sender quiet so the three messages stand out
        g.queue.push([0.2, () => g.ids.push(send(false).id)], [0.8, () => g.ids.push(send(false).id)], [1.4, () => g.ids.push(send(false).id)],
          [4.2, () => { g.reconnected = true; net.set('up', true); setOnline(true); }]);
      },
    };
  },
};

