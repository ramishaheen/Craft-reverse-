// Kubernetes scheduling: a Deployment of N replicas placed on nodes of 4 CPUs each.
// Model: every pod requests `cpu` CPUs. The scheduler puts a pending pod on a ready node with enough
// free CPU: the emptiest such node ("spread") or the fullest one that still fits ("bin-pack"). A pod
// takes 3 s to start. A crashed pod is restarted in place (3 s). A dead node's pods stop serving at
// once, but the control plane only marks the node NotReady and evicts its pods after `grace` seconds;
// then replacements are created and scheduled like any pending pod. Lost capacity integrates
// (wanted − serving) over time, in pod-seconds.

import { fixedStep, fit, fitText, tile, unpause } from './_c-util.js';

const NODE_CPU = 4;
const START_S = 3;

function makeCluster({ nodes = 4, replicas = 6, cpu = 1, strategy = 'spread', grace = 8 } = {}) {
  const K = { replicas, cpu, strategy, start: START_S, grace, now: 0, nodes: [], pods: [], seq: 0, nodeSeq: 0, restarts: 0, evicted: 0, downSecs: 0, log: [] };
  const addNode = () => K.nodes.push({ id: ++K.nodeSeq, up: true, downAt: null, gone: false });
  for (let i = 0; i < nodes; i++) addNode();
  const alive = () => K.pods.filter(p => p.state !== 'gone');
  K.onNode = n => K.pods.filter(p => p.node === n.id && p.state !== 'gone' && p.state !== 'pending');
  K.used = n => K.onNode(n).reduce((a, p) => a + p.cpu, 0);
  K.free = n => NODE_CPU - K.used(n);
  K.serving = () => K.pods.filter(p => p.state === 'running' && K.nodes.find(n => n.id === p.node)?.up).length;
  K.pending = () => K.pods.filter(p => p.state === 'pending').length;
  K.readyNodes = () => K.nodes.filter(n => n.up && !n.gone);
  K.addNode = () => { addNode(); K.log.push(`Node ${K.nodeSeq} joined the cluster.`); };
  K.killBusiest = () => {
    const ready = K.readyNodes();
    if (!ready.length) return null;
    const n = ready.reduce((a, b) => (K.onNode(b).length > K.onNode(a).length ? b : a));
    n.up = false; n.downAt = K.now;
    K.log.push(`Node ${n.id} died with ${K.onNode(n).length} pods on it. Nothing is replaced until the control plane notices.`);
    return n;
  };
  K.crashPod = () => {
    const p = K.pods.find(x => x.state === 'running');
    if (!p) return null;
    p.state = 'starting'; p.readyAt = K.now + K.start; K.restarts++;
    K.log.push(`Pod ${p.id} crashed; the kubelet restarts it on node ${p.node}.`);
    return p;
  };
  function pick(pod) {
    const fits = K.readyNodes().filter(n => K.free(n) >= pod.cpu - 1e-9);
    if (!fits.length) return null;
    return fits.reduce((a, b) => {
      const fa = K.free(a), fb = K.free(b);
      return K.strategy === 'spread' ? (fb > fa ? b : a) : (fb < fa ? b : a);
    });
  }
  function reconcile() {
    for (const n of K.nodes) {
      if (!n.up && !n.gone && K.now >= n.downAt + K.grace) {
        n.gone = true;
        const lost = K.onNode(n);
        lost.forEach(p => { p.state = 'gone'; });
        K.evicted += lost.length;
        K.log.push({ evict: true, msg: `Control plane marked node ${n.id} NotReady after ${K.grace} s and evicted ${lost.length} pods; replacements are being scheduled.`, n: lost.length });
      }
    }
    let list = alive();
    while (list.length < K.replicas) { K.pods.push({ id: ++K.seq, state: 'pending', node: null, cpu: K.cpu, readyAt: null }); list = alive(); }
    if (list.length > K.replicas) {
      list.sort((a, b) => ((a.state === 'pending' ? -1 : 0) - (b.state === 'pending' ? -1 : 0)) || b.id - a.id)
        .slice(0, list.length - K.replicas).forEach(p => { p.state = 'gone'; });
    }
    for (const p of K.pods.filter(x => x.state === 'pending')) {
      const n = pick(p);
      if (n) { p.node = n.id; p.state = 'starting'; p.readyAt = K.now + K.start; }
    }
    for (const p of K.pods) if (p.state === 'starting' && K.now >= p.readyAt) p.state = 'running';
    K.pods = K.pods.filter(p => p.state !== 'gone');
  }
  K.tick = dt => {
    K.now += dt;
    reconcile();
    const up = K.serving();
    if (up < K.replicas) K.downSecs += dt * (K.replicas - up);
  };
  reconcile();
  K.pods.forEach(p => { if (p.state === 'starting') p.state = 'running'; });
  return K;
}

export default {
  lead: 'You tell Kubernetes what you want: 6 copies (pods) of your app, each needing 1 CPU. The scheduler finds a node with room for every pod. A crashed pod is restarted. When a whole node dies, its pods are recreated elsewhere, but only once the control plane has noticed. Watch where pods land, what happens when nothing has room, and how placement changes the cost of one failure.',
  emptyLog: 'Nothing yet. Try killing a node.',
  tryThis: [
    `Set replicas to 20. Each node has ${NODE_CPU} CPUs, so the extra pods stay <b>Pending</b> until you add a node.`,
    'Press <b>Kill the busiest node</b> with Spread, then with Bin-pack. Bin-pack crams pods together to save nodes, so one failure takes out more of them.',
    'Raise the failure-detection time to 40 s and kill a node. Those pods are gone, but nothing replaces them until the control plane notices.',
    'Set the CPU request to 2. Bigger pods leave gaps that smaller ones could have used.',
  ],
  inShort: {
    what: 'Kubernetes runs containers as pods on a cluster of nodes; you declare how many replicas you want, and controllers keep it that way.',
    why: 'Machines fail and load shifts. A scheduler places pods by their CPU and memory requests, and controllers replace pods that die.',
    tradeoff: 'Bin-packing saves nodes, but one failure takes out more pods; spreading costs more but limits the blast radius. Detection adds delay either way.',
    interview: 'A Deployment with resource requests, topology spread across nodes and zones, readiness probes, a PodDisruptionBudget, plus the HPA and the cluster autoscaler.',
  },
  quiz: [
    { q: 'A pod requests 2 CPUs and no node has 2 CPUs free. What happens?', o: ['It runs slowly', 'It stays Pending until room appears or a node is added', 'It is deleted', 'It takes CPU from other pods'], a: 1,
      why: 'The scheduler only places a pod where its requests fit. The cluster autoscaler watches for Pending pods and adds nodes.' },
    { q: 'A node dies. Why are its pods not replaced at once?', o: ['Kubernetes ignores failures', 'The control plane first waits to be sure the node is gone, then evicts and recreates the pods', 'Pods never move', 'DNS is slow'], a: 1,
      why: 'Missed heartbeats must exceed a timeout before the node becomes NotReady, which avoids moving pods over a brief network blip.' },
    { q: 'Why might you prefer spreading pods to bin-packing them?', o: ['It uses fewer nodes', 'A single node failure then takes out fewer of your replicas', 'It schedules faster', 'Bin-packing is not allowed'], a: 1,
      why: 'Bin-packing saves money but concentrates risk. Topology spread constraints and anti-affinity keep replicas apart.' },
  ],
  guided: {
    intro: 'Kill the busiest node and watch when its pods come back.',
    example: '“Run the guided example” starts over with 6 replicas of 1 CPU, Spread placement and an 8 s failure-detection time, then kills the busiest node.',
    question: 'What happens to the pods on the dead node?',
    predictions: ['They stop serving at once, and are only recreated elsewhere once the control plane notices the node is gone.', 'They move to another node instantly with no lost capacity.', 'They are lost for good and never replaced.'],
    correctPrediction: 0,
    running: 'Watch the dead node’s countdown and the “Pods serving” number. Replacements appear after the node is marked NotReady.',
    observation: 'The dead node’s pods stopped serving immediately, but they were only evicted and rescheduled after the detection timeout.',
    explainQuestion: 'Why was capacity lost for several seconds?',
    explanations: ['The control plane waits out a timeout of missed heartbeats before evicting, so nothing replaces the pods until then, and new pods also need time to start.', 'The scheduler was turned off.', 'Pods can only run on their original node.'],
    correctExplanation: 0,
    why: 'Detection time plus start time is the hole in capacity; keep spare replicas spread out so one node failure costs little.',
    retryHint: 'Compare the time of the node death with the eviction event in the log.',
    nextSlug: 'autoscaling',
    nextLabel: 'Next experiment: autoscaling →',
    waitSeconds: 12,
  },

  setup(kit) {
    const { stage } = kit;
    const s = { replicas: 6, cpu: 1, strategy: 'spread', grace: 8 };
    const clock = fixedStep();
    let K, wasPending = 0;

    kit.metrics([
      { key: 'up', label: 'Pods serving' }, { key: 'pend', label: 'Pending (no room)' },
      { key: 'down', label: 'Lost capacity (pod-seconds)' }, { key: 'ev', label: 'Pods evicted' },
    ]);
    const p = kit.panel;
    const btns = p.buttons([
      { label: 'Kill the busiest node', kind: 'primary', onClick: () => { K.killBusiest(); flush(); paint(); } },
      { label: 'Crash a pod', kind: 'outline', onClick: () => { K.crashPod(); flush(); paint(); } },
      { label: 'Add a node', kind: 'outline', onClick: () => { K.addNode(); flush(); paint(); } },
      { label: 'Start over', kind: 'outline', onClick: () => reset() },
    ]).buttons;
    const rep = p.slider('Replicas', { min: 1, max: 20, step: 1, value: 6, format: v => v + (v > 1 ? ' pods' : ' pod'), hint: 'kubectl scale deployment web --replicas=N',
      onInput: v => { s.replicas = v; const more = v > K.pods.length; K.replicas = v; if (more) kit.log(`Scaled to ${v} replicas.`); } });
    const cpu = p.seg('CPU request per pod', { options: [['0.5', '0.5'], ['1', '1'], ['2', '2']], value: '1', onChange: v => { s.cpu = +v; reset(); } });
    const strat = p.seg('Scheduler placement', { options: [['spread', 'Spread out'], ['binpack', 'Bin-pack']], value: 'spread', onChange: v => { s.strategy = v; reset(); } });
    const grace = p.slider('Node failure noticed after', { min: 2, max: 40, step: 2, value: 8, format: v => `${v} s`, hint: 'Real clusters wait about 40 s, then evict pods (around 5 min by default in older versions).',
      onInput: v => { s.grace = v; K.grace = v; } });

    function reset() {
      K = makeCluster({ ...s });
      wasPending = 0;
      clock.reset();
      kit.resetTime();
      kit.clearLog();
      paint();
    }
    function flush() {
      for (const e of K.log.splice(0)) {
        if (typeof e === 'string') kit.log(e);
        else { kit.log(e.msg); kit.guided.observe(`The node’s ${e.n} pods stopped serving the moment it died, but they were only evicted and recreated after the ${K.grace} s detection timeout; the new pods then need ${START_S} s to start.`); }
      }
    }
    function step(dt) {
      K.tick(dt);
      flush();
      const pend = K.pending();
      if (pend && !wasPending) kit.log(`${pend} pod${pend > 1 ? 's' : ''} Pending: no node has ${K.cpu} CPU free.`);
      wasPending = pend;
    }
    function paint() {
      const up = K.serving();
      kit.metric('up', `${up} / ${K.replicas}`, up < K.replicas ? 'bad' : 'good');
      kit.metric('pend', String(K.pending()), K.pending() ? 'warn' : 'good');
      kit.metric('down', K.downSecs.toFixed(0), K.downSecs ? 'bad' : 'good');
      kit.metric('ev', String(K.evicted));
      btns[0].disabled = !K.readyNodes().length;
    }

    function draw() {
      stage.clear();
      const c = stage.colors, w = stage.w, h = stage.h, ctx = stage.ctx;
      const pad = 14, nodes = K.nodes.filter(n => !n.gone);
      const cols = w < 560 ? 2 : Math.min(4, Math.max(3, nodes.length));
      const rows = Math.max(1, Math.ceil(nodes.length / cols)), gap = 10;
      const nw = (w - 2 * pad - gap * (cols - 1)) / cols, top = 30;
      const nh = Math.max(44, Math.min(110, (h - top - 70) / rows - gap));
      fitText(stage, `control plane: want ${K.replicas} pods × ${K.cpu} CPU · scheduler: ${K.strategy === 'spread' ? 'emptiest node first' : 'fullest node that fits'}`, pad, top - 8, w - 2 * pad, { size: 10, color: c.muted, baseline: 'bottom' });
      nodes.forEach((n, i) => {
        const x = pad + (i % cols) * (nw + gap), y = top + Math.floor(i / cols) * (nh + gap), dead = !n.up;
        tile(stage, x, y, nw, nh, { fill: c.surface, fillAlpha: dead ? 0.4 : 1, stroke: dead ? c.bad : c.line, width: dead ? 1.5 : 1, dash: dead ? [4, 3] : null, r: 8 });
        const title = `node ${n.id}` + (dead ? (K.now < n.downAt + K.grace ? ` · down, noticed in ${Math.ceil(n.downAt + K.grace - K.now)} s` : '') : ` · ${K.free(n)} of ${NODE_CPU} CPU free`);
        fitText(stage, title, x + 8, y + 7, nw - 16, { size: 10, weight: 600, color: dead ? c.bad : c.ink, baseline: 'top' });
        const slots = NODE_CPU * 2, sg = 3, sx = x + 8, sy = y + 24;
        const sw = (nw - 16 - sg * (slots - 1)) / slots, sh = nh - 32;
        for (let k = 0; k < slots; k++) tile(stage, sx + k * (sw + sg), sy, sw, sh, { stroke: c.grid, r: 3 });
        let used = 0;
        for (const pod of K.onNode(n)) {
          const span = Math.round(pod.cpu * 2), px = sx + used * (sw + sg), pw = span * sw + (span - 1) * sg;
          used += span;
          const run = pod.state === 'running', col = dead ? c.bad : run ? c.violet : c.signal;
          tile(stage, px, sy, pw, sh, { fill: col, fillAlpha: dead ? 0.2 : run ? 0.45 : 0.2, stroke: col, dash: run ? null : [3, 3], r: 4 });
          const lab = dead ? 'lost' : run ? (pw > 34 ? 'pod ' + pod.id : String(pod.id)) : 'start';
          ctx.font = `600 9px ${stage.font}`;
          if (ctx.measureText(lab).width < pw - 2) stage.text(lab, px + pw / 2, sy + sh / 2, { size: 9, weight: 600, color: c.ink, align: 'center' });
        }
      });
      const py = top + rows * (nh + gap) + 14, pend = K.pods.filter(x => x.state === 'pending');
      fitText(stage, pend.length ? `Pending (${pend.length}): waiting for a node with ${K.cpu} CPU free` : 'Pending: none', pad, py, w - 2 * pad, { size: 10, color: pend.length ? c.signal : c.muted });
      pend.slice(0, Math.floor((w - 2 * pad) / 22)).forEach((x, i) => tile(stage, pad + i * 22, py + 10, 18, 18, { stroke: c.signal, dash: [3, 2], r: 4 }));
    }

    kit.loop(dt => { clock.run(dt, step); paint(); draw(); });
    reset();

    return {
      reset,
      guidedRun() {
        rep.set(6, true); cpu.set('1', true); strat.set('spread', true); grace.set(8, true);
        Object.assign(s, { replicas: 6, cpu: 1, strategy: 'spread', grace: 8 });
        reset();
        unpause();
        setTimeout(() => { K.killBusiest(); flush(); paint(); }, 700);
      },
    };
  },
};
