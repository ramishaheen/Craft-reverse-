// Infrastructure as code: main.tf on the left, the real cloud on the right, the plan in between.
// Model: the code declares N web servers, a server size, whether the firewall opens SSH (port 22),
// and a database engine. Plan diffs code against the cloud: + create a missing server, ~ update a
// size or firewall rule, - destroy a managed server beyond N, -/+ replace the database when the engine
// changes (its 1,000 rows are lost). Apply works through the plan one change at a time: create 20 s,
// update 8 s, replace 40 s (the database is down meanwhile), destroy 6 s. Console clicks change the
// cloud without changing the code (drift). With the state lock on, a second apply is refused while one
// runs; with it off, two applies of the same plan both create the missing servers, leaving untracked
// duplicates.

import { fixedStep, fit, fitText, tile, unpause } from './_c-util.js';

const COST = { create: 20, update: 8, replace: 40, destroy: 6 };
const SIGN = { create: '+', update: '~', replace: '-/+', destroy: '-' };

function makeInfra() {
  const X = { code: { servers: 3, size: 'small', port22: false, db: 'pg15' }, cloud: [], seq: 0, now: 0, applies: [], lock: true, log: [], dataLost: 0, orphans: 0, drifts: 0 };
  const res = (type, o) => { const r = { id: ++X.seq, type, ...o }; X.cloud.push(r); return r; };
  for (let i = 0; i < 3; i++) res('server', { name: 'web-' + (i + 1), size: 'small', managed: true });
  res('firewall', { name: 'web-fw', port22: false, managed: true });
  res('db', { name: 'main-db', engine: 'pg15', managed: true, rows: 1000 });
  X.byName = n => X.cloud.find(r => r.name === n);
  X.servers = () => X.cloud.filter(r => r.type === 'server');
  X.set = o => Object.assign(X.code, o);
  X.drift = kind => {
    X.drifts++;
    if (kind === 'resize') { const r = X.byName('web-1'); if (r) r.size = r.size === 'large' ? 'small' : 'large'; }
    else if (kind === 'port') { const r = X.byName('web-fw'); if (r) r.port22 = true; }
    else if (kind === 'delete') { const r = X.servers().filter(x => x.managed).slice(-1)[0]; if (r) X.cloud.splice(X.cloud.indexOf(r), 1); }
  };
  X.plan = () => {
    const out = [], c = X.code;
    for (let i = 0; i < c.servers; i++) {
      const name = 'web-' + (i + 1), r = X.byName(name);
      if (!r) out.push({ op: 'create', name, type: 'server', why: 'missing' });
      else if (r.size !== c.size) out.push({ op: 'update', name, type: 'server', why: `size ${r.size} → ${c.size}` });
    }
    for (const r of X.servers()) if (r.managed && +r.name.split('-')[1] > c.servers) out.push({ op: 'destroy', name: r.name, type: 'server', why: 'not in code' });
    const fw = X.byName('web-fw');
    if (fw && fw.port22 !== c.port22) out.push({ op: 'update', name: 'web-fw', type: 'firewall', why: `port 22 ${fw.port22 ? 'open → closed' : 'closed → open'}` });
    const db = X.byName('main-db');
    if (db && db.engine !== c.db) out.push({ op: 'replace', name: 'main-db', type: 'db', why: `${db.engine} → ${c.db} forces a new database` });
    return out;
  };
  X.busy = () => X.applies.some(a => !a.done);
  X.apply = () => {
    if (X.lock && X.busy()) return null;
    const plan = X.plan();
    const a = { id: X.applies.length + 1, plan, i: 0, next: X.now + (plan[0] ? COST[plan[0].op] : 0), done: !plan.length, started: X.now, ended: plan.length ? null : X.now };
    X.applies.push(a);
    return a;
  };
  function perform(ch) {
    const c = X.code;
    if (ch.op === 'create') {
      if (X.byName(ch.name)) { res('server', { name: ch.name + '-dup' + X.seq, size: c.size, managed: false }); X.orphans++; X.log.push({ dup: true, name: ch.name }); }
      else res('server', { name: ch.name, size: c.size, managed: true });
    } else if (ch.op === 'update') {
      const r = X.byName(ch.name);
      if (r) { if (r.type === 'server') r.size = c.size; else r.port22 = c.port22; }
    } else if (ch.op === 'destroy') {
      const r = X.byName(ch.name);
      if (r) X.cloud.splice(X.cloud.indexOf(r), 1);
    } else if (ch.op === 'replace') {
      const r = X.byName(ch.name);
      if (r) { X.dataLost += r.rows; r.engine = c.db; r.rows = 0; X.log.push({ replace: true }); }
    }
  }
  X.current = () => X.applies.filter(a => !a.done).map(a => ({ a, ch: a.plan[a.i], left: a.next - X.now }));
  X.tick = dt => {
    X.now += dt;
    for (const a of X.applies) {
      let g = 0;
      while (!a.done && X.now >= a.next && g++ < 50) {
        perform(a.plan[a.i]);
        a.i++;
        if (a.i >= a.plan.length) { a.done = true; a.ended = X.now; X.log.push({ finished: a }); }
        else a.next = X.now + COST[a.plan[a.i].op];
      }
    }
  };
  return X;
}

export default {
  lead: 'Servers, firewalls and databases are written down as code (Terraform, Pulumi, CloudFormation) and kept in git. <b>Plan</b> compares that code with what actually exists in the cloud and lists the differences. <b>Apply</b> carries them out. Change the code, click around in the cloud console like a rushed teammate, and read the plan before you apply it.',
  emptyLog: 'Nothing yet. Edit the code or the console.',
  stageHeight: 440,
  tryThis: [
    'Set web servers to 5 and read the plan: two <b>+ create</b>. Apply it and watch them appear.',
    'Press <b>Open port 22</b> and <b>Resize web-1</b>. Nobody touched the code, yet the plan now wants to undo both. That is drift.',
    'Switch the database to Postgres 16. The plan says <b>-/+ replace</b>: the old database is destroyed along with its data. Real teams plan this as a migration.',
    'Turn the state lock off, add servers and press <b>Two people apply at once</b>. Both create the missing servers, so you pay for duplicates that nobody tracks.',
  ],
  inShort: {
    what: 'Infrastructure as code describes servers, networks and databases in versioned files; a tool plans the difference from reality and applies it.',
    why: 'Clicking in a console cannot be reviewed or repeated. Code brings review, history and identical environments, and reveals drift.',
    tradeoff: 'Plans must be read: some changes replace resources and lose data. Shared state needs a lock, and console edits get reverted.',
    interview: 'Terraform in git, a plan on every pull request, remote state with locking, applies only from CI, scheduled drift checks, and prevent_destroy on databases.',
  },
  quiz: [
    { q: 'Someone opens port 22 in the cloud console. What does the next plan show?', o: ['Nothing', 'An update closing it again, because the code says closed (drift)', 'A new firewall', 'An error'], a: 1,
      why: 'Plan compares the real state with the code. Manual changes are drift and get reverted unless the code changes too.' },
    { q: 'A plan says -/+ replace for your database. What does that mean?', o: ['A quick restart', 'Destroy the old one and create a new one, losing its data unless you migrate', 'An in-place update', 'Nothing happens'], a: 1,
      why: 'Some attributes cannot be changed in place. Read every plan, and protect stateful resources with prevent_destroy and snapshots.' },
    { q: 'Why does Terraform lock its state during an apply?', o: ['For speed', 'So two applies cannot both act on the same plan and create duplicates or corrupt state', 'To hide passwords', 'It does not'], a: 1,
      why: 'Remote state with locking lets only one apply run at a time.' },
  ],
  guided: {
    intro: 'A teammate opens SSH in the console. Then you apply the unchanged code.',
    example: '“Run the guided example” starts over, opens port 22 in the console, and then applies the plan.',
    question: 'What will the apply do to port 22?',
    predictions: ['Close it again, because the code still says it is closed.', 'Leave it open, because the console change is newer.', 'Fail with an error.'],
    correctPrediction: 0,
    running: 'Watch the plan list (a ~ update for web-fw) and the firewall row in “the real cloud”.',
    observation: 'The plan saw the open port as drift from the code and the apply closed it again.',
    explainQuestion: 'Why was the console change undone?',
    explanations: ['Plan compares reality with the code; the code says port 22 is closed, so the console change is drift and apply reverts it.', 'The console change was never saved.', 'Terraform always closes every port.'],
    correctExplanation: 0,
    why: 'The code is the source of truth. Make changes in code (and review them), or they will be reverted at the next apply.',
    retryHint: 'Read the plan line for web-fw before the apply starts.',
    nextSlug: 'payment-gateway',
    nextLabel: 'Next experiment: payment gateway →',
    waitSeconds: 14,
  },

  setup(kit) {
    const { stage } = kit;
    const clock = fixedStep();
    let X;

    kit.metrics([
      { key: 'plan', label: 'Changes in the plan' }, { key: 'drift', label: 'Console changes made' },
      { key: 'dup', label: 'Duplicate servers' }, { key: 'lost', label: 'Database rows lost' },
    ]);
    const p = kit.panel;
    const btns = p.buttons([
      { label: 'Apply the plan', kind: 'primary', onClick: () => apply(1) },
      { label: 'Two people apply at once', kind: 'outline', onClick: () => apply(2) },
      { label: 'Start over', kind: 'outline', onClick: () => reset() },
    ]).buttons;
    p.heading('Edit the code');
    const n = p.slider('Web servers', { min: 1, max: 6, step: 1, value: 3, format: v => String(v), onInput: v => { X.set({ servers: v }); paint(); } });
    const size = p.seg('Server size', { options: [['small', 'small'], ['large', 'large']], value: 'small', onChange: v => { X.set({ size: v }); paint(); } });
    const db = p.seg('Database engine', { options: [['pg15', 'Postgres 15'], ['pg16', 'Postgres 16']], value: 'pg15', onChange: v => { X.set({ db: v }); paint(); } });
    p.heading('Click around in the cloud console');
    p.buttons([
      { label: 'Resize web-1', kind: 'outline', onClick: () => drift('resize') },
      { label: 'Open port 22', kind: 'outline', onClick: () => drift('port') },
      { label: 'Delete a server', kind: 'outline', onClick: () => drift('delete') },
    ]);
    const lock = p.toggle('State lock (only one apply at a time)', { value: true, onChange: v => { X.lock = v; paint(); } });

    function reset() {
      X = makeInfra();
      n.set(3, true); size.set('small', true); db.set('pg15', true); lock.set(true, true);
      clock.reset();
      kit.resetTime();
      kit.clearLog();
      paint();
    }
    function drift(kind) {
      X.drift(kind);
      kit.log(kind === 'resize' ? 'Someone resized web-1 in the console. The code still has the old size.'
        : kind === 'port' ? 'Someone opened SSH (port 22) to the internet in the console.'
        : 'Someone deleted a server in the console.');
      paint();
    }
    function apply(times) {
      for (let i = 0; i < times; i++) {
        const a = X.apply();
        if (a) kit.log(a.plan.length ? `Apply #${a.id} started: ${a.plan.map(ch => SIGN[ch.op] + ' ' + ch.name).join(', ')}.` : `Apply #${a.id}: nothing to do.`);
        else kit.log('Second apply blocked: the first one holds the state lock. It waits, then finds nothing left to do.');
      }
      paint();
    }
    function step(dt) {
      X.tick(dt);
      for (const e of X.log.splice(0)) {
        if (e.replace) kit.log('Replaced main-db: the old database was destroyed with its data and an empty one created.');
        else if (e.dup) kit.log(`A second ${e.name} was created because both applies thought it was missing.`);
        else if (e.finished) {
          const a = e.finished;
          kit.log(`Apply #${a.id} finished: ${a.plan.length} change${a.plan.length === 1 ? '' : 's'} made.` + (X.orphans ? ` ${X.orphans} duplicate server${X.orphans > 1 ? 's' : ''} the code does not know about.` : ''));
          const fwFix = a.plan.find(ch => ch.name === 'web-fw');
          if (fwFix) kit.guided.observe(`The plan listed “~ web-fw: ${fwFix.why}”. The open port was drift from the code, so the apply closed it again.`);
        }
      }
    }
    function paint() {
      const plan = X.plan();
      kit.metric('plan', String(plan.length), plan.length ? 'warn' : 'good');
      kit.metric('drift', String(X.drifts));
      kit.metric('dup', String(X.orphans), X.orphans ? 'bad' : 'good');
      kit.metric('lost', String(X.dataLost), X.dataLost ? 'bad' : 'good');
      btns[0].disabled = (X.lock && X.busy()) || !plan.length;
      btns[1].disabled = X.busy() || !plan.length;
    }

    function draw() {
      stage.clear();
      const c = stage.colors, w = stage.w, h = stage.h, ctx = stage.ctx, pad = 14, narrow = w < 560;
      const colW = narrow ? (w - 3 * pad) / 2 : w * 0.27, plan = X.plan(), cur = X.current();
      const code = ['resource "server" "web" {', `  count = ${X.code.servers}`, `  size  = "${X.code.size}"`, '}', 'resource "firewall" "web-fw" {', `  ssh_open = ${X.code.port22}`, '}', 'resource "database" "main-db" {', `  engine = "${X.code.db}"`, '}'];
      stage.text('main.tf (in git)', pad, 24, { size: 10, weight: 600, color: c.muted, baseline: 'bottom' });
      tile(stage, pad, 30, colW, code.length * 14 + 14, { fill: c.surface, stroke: c.line, r: 6 });
      const fs = narrow ? 9 : 10;
      ctx.font = `500 ${fs}px ui-monospace, monospace`;
      code.forEach((line, i) => stage.text(fit(ctx, line, colW - 12), pad + 8, 38 + i * 14, { size: fs, mono: true, color: c.ink, baseline: 'top' }));
      const cx = narrow ? pad * 2 + colW : w - pad - colW;
      stage.text('the real cloud', cx, 24, { size: 10, weight: 600, color: c.muted, baseline: 'bottom' });
      X.cloud.forEach((r, i) => {
        const y = 30 + i * 24;
        const off = !r.managed || (r.type === 'server' && r.size !== X.code.size) || (r.type === 'firewall' && r.port22 !== X.code.port22) || (r.type === 'db' && r.engine !== X.code.db);
        tile(stage, cx, y, colW, 20, { fill: r.managed ? (off ? c.signal : c.violet) : c.bad, fillAlpha: 0.25, stroke: r.managed ? c.line : c.bad, r: 5 });
        const txt = r.type === 'server' ? `${r.name} · ${r.size}${r.managed ? '' : ' · not in code'}` : r.type === 'firewall' ? `${r.name} · ssh ${r.port22 ? 'OPEN' : 'closed'}` : `${r.name} · ${r.engine} · ${r.rows} rows`;
        fitText(stage, txt, cx + 8, y + 10, colW - 14, { size: fs, color: c.ink });
      });
      const px = narrow ? pad : pad * 2 + colW, pw = narrow ? w - 2 * pad : w - 4 * pad - 2 * colW;
      const py = narrow ? Math.max(30 + code.length * 14 + 30, 30 + X.cloud.length * 24 + 16) : 30;
      fitText(stage, plan.length ? `plan: ${plan.length} to change` : 'plan: no changes, code and cloud match', px, py - 6, pw, { size: 10, weight: 600, color: c.muted, baseline: 'bottom' });
      plan.forEach((ch, i) => {
        const y = py + i * 22, col = ch.op === 'create' ? c.ok : ch.op === 'update' ? c.signal : c.bad;
        tile(stage, px, y, pw, 18, { fill: col, fillAlpha: 0.14, r: 4 });
        stage.text(SIGN[ch.op], px + 6, y + 9, { size: 10, weight: 700, mono: true, color: col });
        fitText(stage, `${ch.name}: ${ch.why}`, px + 34, y + 9, pw - 40, { size: fs, color: c.ink });
      });
      cur.forEach((x, i) => {
        const y = h - 18 - i * 18;
        fitText(stage, x.ch ? `Apply #${x.a.id}: ${x.ch.op} ${x.ch.name} (${Math.max(0, x.left).toFixed(0)} s left)` : `Apply #${x.a.id}`, pad, y, w - 2 * pad, { size: 10, color: c.ink });
      });
    }

    kit.loop(dt => { clock.run(dt, step); paint(); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        reset();
        unpause();
        setTimeout(() => drift('port'), 500);
        setTimeout(() => apply(1), 1600);
      },
    };
  },
};
