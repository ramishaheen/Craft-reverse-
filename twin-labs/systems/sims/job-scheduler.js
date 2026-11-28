// Job scheduler: a jobs table, three workers, leases, retries with backoff and a dead-letter list.
// Model: new jobs arrive at 0.5–4 per second, each taking the chosen length ±30%. A free, healthy
// worker claims the earliest due waiting job, which starts a lease of 0.5–6 s. When a lease runs out
// before the job finished, the scheduler assumes the worker died: a crashed holder lets go of the
// job, a live holder keeps running it but its result is now a "lost lease" duplicate. The job goes
// back to waiting with exponential backoff (0.8 s × 2^(attempt−1)); after 3 attempts it moves to the
// dead-letter list. Every completed run counts; a job that completes twice counts as "ran twice".

import { stepper, unpause, alpha, clamp } from './_e-util.js';

const WORKERS = 3, MAX_ATTEMPTS = 3, BACKOFF = 0.8;

export default {
  lead: 'Jobs such as “send this email” or “resize that photo” wait in a table until they are due. A free worker claims one and takes a lease: “this is mine for the next few seconds”. If the worker dies, the lease runs out and another worker retries the job. The hard part is picking the lease length.',
  emptyLog: 'Jobs are being scheduled. Crash a worker or shorten the lease.',
  stageHeight: 400,
  tryThis: [
    '<b>Crash a worker</b> while it holds a job. Its lease bar runs down, the job turns amber, and another worker retries it after a short backoff.',
    'Make the <b>lease shorter than the job</b>. Healthy but slow workers lose their lease, the job is handed out again, and it runs twice. Jobs have to be idempotent.',
    'Crash every worker. Jobs pile up, and after 3 failed attempts a job lands on the dead-letter list for a person to look at.',
  ],
  inShort: {
    what: 'A job scheduler stores jobs with a due time; workers claim due jobs under a lease, run them and mark them done.',
    why: 'Emails, reports, billing runs and retries must still happen when individual workers crash or restart.',
    tradeoff: 'Short leases recover quickly from crashes but re-run slow jobs; long leases are safe but leave work stuck for longer, so jobs must be idempotent.',
    interview: 'Jobs live in a table and are claimed with SELECT … FOR UPDATE SKIP LOCKED plus a lease the worker keeps renewing; failures retry with exponential backoff and go to a dead-letter queue after N attempts.',
  },
  quiz: [
    { q: 'Why does a worker take a lease on a job instead of simply marking it “taken”?', o: ['Leases are faster', 'If the worker dies the lease expires and another worker can retry the job', 'To encrypt the job', 'To run the job twice on purpose'], a: 1,
      why: 'A plain “taken” flag stays set forever when its owner crashes; a lease releases the job by itself.' },
    { q: 'The lease is shorter than the job takes. What happens?', o: ['Jobs finish faster', 'The job is handed out again while the first worker is still on it, so it runs twice', 'Nothing', 'The scheduler stops'], a: 1,
      why: 'The scheduler assumes the worker died. Make leases longer than the slowest job, renew them while working, and make jobs idempotent.' },
    { q: 'What is the dead-letter list for?', o: ['Deleted users', 'Jobs that failed too many times, set aside for a person to inspect', 'Finished jobs', 'Jobs not yet due'], a: 1,
      why: 'After a set number of attempts another retry only wastes work, so the job is parked for debugging.' },
  ],
  guided: {
    intro: 'Give every job less lease time than it needs and watch what the scheduler does.',
    example: '“Run the guided example” resets with all workers healthy, a 1 s lease, 2 s jobs and 1 new job per second.',
    question: 'What happens to jobs that take longer than their lease?',
    predictions: ['They are handed to another worker while still running, so some run twice.', 'The workers finish them faster to beat the lease.', 'The scheduler waits patiently until they finish.'],
    correctPrediction: 0,
    running: 'Watch the lease bars run out before the work bars fill, workers marked “lease lost”, and the “Ran twice” counter.',
    observation: 'A worker was still busy when its lease ended; the job was handed out again and both runs completed, so it ran twice.',
    explainQuestion: 'Why did the job run twice?',
    explanations: ['When the lease expired the scheduler assumed the worker was dead and gave the job to another worker, but the first was still working.', 'Workers always run each job twice for safety.', 'The job was added to the table twice.'],
    correctExplanation: 0,
    why: 'A lease can only tell "slow" from "dead" by time, so leases must outlast the slowest job (or be renewed) and jobs must be safe to repeat.',
    retryHint: 'Compare the lease length with the job length, then look for “lease lost” on a worker.',
    nextSlug: 'notification-system',
    nextLabel: 'Next experiment: notifications →',
    waitSeconds: 12,
  },

  setup(kit) {
    const { stage } = kit;
    const fixed = stepper(0.05);
    const o = { lease: 3, work: 1.5, rate: 1.5 };
    let S, st;

    kit.metrics([
      { key: 'done', label: 'Jobs done' }, { key: 'wait', label: 'Waiting' },
      { key: 'dup', label: 'Ran twice' }, { key: 'dead', label: 'Dead letters' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'wait', label: 'Jobs waiting', color: 'signal' }, { key: 'done', label: 'Done per second', color: 'ok' }],
      bars: { key: 'dup', label: 'Ran twice', color: 'bad' },
      format: v => String(Math.round(v)),
    });

    const p = kit.panel;
    p.heading('Workers');
    p.buttons([{ label: 'Crash a worker', kind: 'outline', onClick: crash }, { label: 'Restart all', kind: 'ghost', onClick: restartAll }]);
    const lease = p.slider('Lease length', { min: 0.5, max: 6, step: 0.5, value: 3, format: v => `${v} s`, onInput: v => { o.lease = v; } });
    const work = p.slider('Job length', { min: 0.5, max: 4, step: 0.5, value: 1.5, format: v => `${v} s`, hint: 'Each job takes this long, give or take 30%', onInput: v => { o.work = v; } });
    const rate = p.slider('New jobs per second', { min: 0.5, max: 4, step: 0.5, value: 1.5, format: v => `${v} /s`, onInput: v => { o.rate = v; } });
    p.buttons([{ label: 'Reset', kind: 'outline', onClick: reset }]);

    function model() {
      return { jobs: [], workers: Array.from({ length: WORKERS }, (_, id) => ({ id, up: true, job: null, until: 0, stale: false })), done: 0, dead: [], dupes: 0, nextId: 1 };
    }
    function tick(h) {
      st.t += h; st.acc += o.rate * h;
      const now = st.t;
      while (st.acc >= 1) { st.acc -= 1; S.jobs.push({ id: S.nextId++, due: now, work: o.work * (0.7 + Math.random() * 0.6), attempts: 0, state: 'waiting', ran: 0 }); }
      // 1. runs that finish
      for (const w of S.workers) {
        const j = w.job;
        if (!j || !w.up || now < w.until) continue;
        w.job = null; j.ran++;
        if (j.ran > 1) {
          S.dupes++; st.secDup++;
          kit.log(`Job ${j.id} has now run ${j.ran} times: worker ${w.id + 1} finished it after losing its lease`);
          if (st.guided) { st.guided = false; kit.guided.observe(`Job ${j.id} took longer than its ${o.lease} s lease. The scheduler gave it to another worker while worker ${w.id + 1} was still running it, and both runs finished: it ran twice.`); }
        }
        if (w.stale) { w.stale = false; continue; }
        j.state = 'done'; S.done++; st.secDone++;
        S.jobs = S.jobs.filter(x => x !== j);
        for (const other of S.workers) if (other.job === j && other !== w) other.stale = true;
      }
      // 2. leases that run out
      for (const j of S.jobs) {
        if (j.state !== 'running' || now < j.leaseEnd) continue;
        const holder = S.workers.find(w => w.job === j && !w.stale);
        if (holder) { if (holder.up) holder.stale = true; else holder.job = null; }
        if (j.attempts >= MAX_ATTEMPTS) { j.state = 'dead'; S.dead.push(j); kit.log(`Job ${j.id} failed ${MAX_ATTEMPTS} times and moved to the dead-letter list`); }
        else {
          j.state = 'waiting';
          const wait = BACKOFF * Math.pow(2, j.attempts - 1);
          j.due = now + wait;
          kit.log(`Lease on job ${j.id} ran out${holder && holder.up ? ' while its worker was still busy' : ''}; retry ${j.attempts + 1} in ${wait.toFixed(1)} s`);
        }
      }
      S.jobs = S.jobs.filter(j => j.state !== 'dead');
      // 3. free workers claim due jobs
      for (const w of S.workers) {
        if (!w.up || w.job) continue;
        const j = S.jobs.filter(x => x.state === 'waiting' && x.due <= now).sort((a, b) => a.due - b.due)[0];
        if (!j) break;
        j.state = 'running'; j.attempts++; j.leaseEnd = now + o.lease;
        w.job = j; w.until = now + j.work;
      }
    }
    function crash() {
      const w = S.workers.find(x => x.up && x.job) || S.workers.find(x => x.up);
      if (!w) { kit.log('Every worker is already down'); return; }
      w.up = false;
      kit.log(w.job ? `Worker ${w.id + 1} crashed holding job ${w.job.id}; the job is stuck until its lease runs out` : `Worker ${w.id + 1} crashed while idle`);
    }
    function restartAll() {
      let n = 0;
      for (const w of S.workers) if (!w.up) { w.up = true; n++; if (w.job && w.job.state !== 'running') w.job = null; }
      kit.log(n ? `Restarted ${n} worker${n > 1 ? 's' : ''}` : 'All workers were already running');
    }
    function reset() { S = model(); st = { t: 0, acc: 0, secDup: 0, secDone: 0, guided: false }; kit.resetTime(); chart.reset(); kit.clearLog(); paint(); }
    const waiting = () => S.jobs.filter(j => j.state === 'waiting').length;
    function paint() {
      kit.metric('done', String(S.done));
      const w = waiting();
      kit.metric('wait', String(w), w > 10 ? 'bad' : w > 3 ? 'warn' : 'good');
      kit.metric('dup', String(S.dupes), S.dupes ? 'bad' : 'good');
      kit.metric('dead', String(S.dead.length), S.dead.length ? 'bad' : 'good');
    }

    function draw() {
      stage.clear();
      const c = stage.colors, W = stage.w, H = stage.h, now = st.t;
      const narrow = W < 520, L = 12, tw = narrow ? W * 0.42 : W * 0.36, top = 26, rh = narrow ? 15 : 16;
      stage.text('Jobs table', L, top - 12, { size: 10.5, weight: 600, color: c.muted });
      const rows = Math.max(1, Math.floor((H - top - 20) / rh));
      const list = S.jobs.slice().sort((a, b) => (a.state === 'running' ? -1 : 0) - (b.state === 'running' ? -1 : 0) || a.due - b.due);
      list.slice(0, rows).forEach((j, i) => {
        const y = top + i * rh, retry = j.attempts > 0 && j.state === 'waiting';
        const fill = j.state === 'running' ? alpha(c.wire, 0.35) : retry ? alpha(c.signal, 0.55) : c.surface;
        stage.rect(L, y, tw, rh - 3, { fill, r: 4 });
        stage.text(`job ${j.id}`, L + 6, y + (rh - 3) / 2, { size: 10 });
        const tag = j.state === 'running' ? `running · try ${j.attempts}` : j.due > now ? `retry in ${(j.due - now).toFixed(1)} s` : retry ? `try ${j.attempts + 1} due` : 'due';
        stage.text(tag, L + tw - 6, y + (rh - 3) / 2, { size: 10, align: 'right', color: c.muted });
      });
      if (list.length > rows) stage.text(`+${list.length - rows} more`, L, H - 8, { size: 10, color: c.muted });
      const wx = L + tw + (narrow ? 12 : 28), ww = W - wx - 12, wh = narrow ? 40 : Math.max(44, Math.min(56, (H * 0.62) / WORKERS)), gap = narrow ? 6 : 8;
      stage.text('Workers and their leases', wx, top - 12, { size: 10.5, weight: 600, color: c.muted });
      S.workers.forEach((w, i) => {
        const y = top + i * (wh + gap);
        stage.rect(wx, y, ww, wh, { fill: c.surface, stroke: w.up ? (w.stale ? c.signal : w.job ? c.ok : c.wire) : c.bad, width: w.up ? 1.5 : 2, dash: w.up ? null : [4, 3], r: 8 });
        stage.text(`Worker ${i + 1}`, wx + 8, y + (narrow ? 10 : 12), { size: 11, weight: 600 });
        const status = w.up ? (w.stale ? (narrow ? `job ${w.job.id}, lease lost` : `still on job ${w.job.id}, lease lost`) : w.job ? `job ${w.job.id}` : 'idle')
          : w.job ? (narrow ? `crashed, job ${w.job.id}` : `crashed holding job ${w.job.id}`) : 'crashed';
        stage.text(status, narrow ? wx + 8 : wx + ww - 8, narrow ? y + 23 : y + 12, { size: 10, align: narrow ? 'left' : 'right', color: w.up ? (w.stale ? c.signal : c.muted) : c.bad });
        if (!w.job) return;
        const bx = wx + 8, bw = ww - 16, by = y + wh - (narrow ? 9 : 16);
        const prog = w.up ? clamp(1 - (w.until - now) / w.job.work, 0, 1) : 0;
        if (!narrow) {
          stage.rect(bx, by - 9, bw, 5, { fill: c.surface2, r: 2 });
          stage.rect(bx, by - 9, Math.max(0.5, bw * prog), 5, { fill: c.wire, r: 2 });
        }
        const left = w.stale ? 0 : clamp((w.job.leaseEnd - now) / o.lease, 0, 1);
        stage.rect(bx, by, bw, narrow ? 4 : 6, { fill: c.surface2, r: 2 });
        if (left > 0) stage.rect(bx, by, bw * left, narrow ? 4 : 6, { fill: left < 0.25 ? c.bad : c.signal, r: 2 });
        if (!narrow) { stage.text('work', bx, by - 15, { size: 9.5, color: c.muted }); stage.text('lease', bx + 34, by - 15, { size: 9.5, color: c.muted }); }
      });
      const dy = top + WORKERS * (wh + gap) + 12;
      if (dy < H - 14) {
        const txt = S.dead.length ? `Dead letters: ${S.dead.slice(-6).map(j => `job ${j.id}`).join(', ')}${S.dead.length > 6 ? '…' : ''}` : 'Dead letters: none';
        stage.text(txt, wx, dy, { size: 10.5, weight: 600, color: S.dead.length ? c.bad : c.muted, maxWidth: ww });
      }
    }

    kit.loop(dt => { fixed(dt, tick); paint(); draw(); });
    kit.every(1, () => { chart.push({ wait: waiting(), done: st.secDone, dup: st.secDup }); st.secDup = 0; st.secDone = 0; });
    reset();

    return {
      reset,
      guidedRun() {
        lease.set(1, true); o.lease = 1;
        work.set(2, true); o.work = 2;
        rate.set(1, true); o.rate = 1;
        reset();
        st.guided = true;
        unpause();
      },
    };
  },
};
