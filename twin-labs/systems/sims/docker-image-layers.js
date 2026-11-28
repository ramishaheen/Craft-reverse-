// Docker image layers: one layer per Dockerfile line, cached by its inputs.
// Model: a layer's cache key is the key of the layer before it + its command + the version of its
// inputs (base image, package files, source code). A build reuses each layer whose key it has seen
// and rebuilds from the first miss. Times and sizes per line: base pull = size ÷ 100 s, COPY package
// files 1 s / 0.1 MB, npm ci 45 s / 220 MB, COPY source 2 s / 6 MB, build 25 s / 12 MB. Bases: full
// 400 MB, slim 80 MB, alpine 45 MB. Multi-stage adds a runtime stage (slim when the build base is full)
// with npm ci --omit=dev (20 s, 60 MB) and the built output (1 s, 8 MB); only that stage is shipped.
// Registry and server only transfer layers they do not already hold.

import { fit, fitText, tile, unpause } from './_c-util.js';

const BASES = { full: { label: 'node:22 (full)', mb: 400 }, slim: { label: 'node:22-slim', mb: 80 }, alpine: { label: 'node:22-alpine', mb: 45 } };
const tag = b => BASES[b].label.split(' ')[0];
const LINES = {
  from: b => ({ cmd: `FROM ${tag(b)}`, secs: 0, mb: BASES[b].mb, input: 'base' }),
  wd: () => ({ cmd: 'WORKDIR /app', secs: 0, mb: 0, input: null }),
  pkg: () => ({ cmd: 'COPY package*.json ./', secs: 1, mb: 0.1, input: 'deps' }),
  ci: () => ({ cmd: 'RUN npm ci', secs: 45, mb: 220, input: null }),
  src: () => ({ cmd: 'COPY . .', secs: 2, mb: 6, input: 'code' }),
  build: () => ({ cmd: 'RUN npm run build', secs: 25, mb: 12, input: null }),
  rt: b => ({ cmd: `FROM ${tag(b)} AS runtime`, secs: 0, mb: BASES[b].mb, input: 'base', stage: 2 }),
  prod: () => ({ cmd: 'RUN npm ci --omit=dev', secs: 20, mb: 60, input: 'deps', stage: 2 }),
  dist: () => ({ cmd: 'COPY --from=build /app/dist ./dist', secs: 1, mb: 8, input: 'code', stage: 2 }),
};

function dockerfile({ order, base, multi }) {
  const keys = order === 'good' ? ['from', 'wd', 'pkg', 'ci', 'src', 'build'] : ['from', 'wd', 'src', 'ci', 'build'];
  const lines = keys.map(k => ({ k, ...LINES[k](base) }));
  if (order === 'bad') lines.find(l => l.k === 'src').input = 'code+deps'; // COPY . . also copies package.json
  if (multi) lines.push({ k: 'rt', ...LINES.rt(base === 'full' ? 'slim' : base) }, { k: 'prod', ...LINES.prod() }, { k: 'dist', ...LINES.dist() });
  return lines;
}

function makeBuilder(opts) {
  const B = { opts: { order: 'good', base: 'full', multi: false, ...opts }, ver: { code: 1, deps: 1 }, cache: new Set(), registry: new Set(), node: new Set(), builds: 0, last: null, lastPull: 0 };
  const inputKey = l => !l.input ? '' : l.input === 'base' ? 'b:' + l.cmd : l.input.split('+').map(x => x + B.ver[x]).join('+');
  B.build = () => {
    const prev = { 1: '', 2: '' };
    let secs = 0;
    const layers = [];
    for (const l of dockerfile(B.opts)) {
      const sg = l.stage || 1;
      const key = prev[sg] + '|' + l.cmd + '#' + inputKey(l);
      prev[sg] = key;
      const cached = B.cache.has(key);
      B.cache.add(key);
      const t = cached ? 0 : l.secs + (l.input === 'base' ? l.mb / 100 : 0);
      secs += t;
      layers.push({ ...l, key, cached, t });
    }
    const final = layers.filter(l => (l.stage || 1) === (B.opts.multi ? 2 : 1));
    const size = final.reduce((a, l) => a + l.mb, 0);
    const push = final.filter(l => !B.registry.has(l.key)).reduce((a, l) => a + l.mb, 0);
    final.forEach(l => B.registry.add(l.key));
    B.builds++;
    B.last = { layers, final, secs, size, push };
    return B.last;
  };
  B.pull = () => {
    if (!B.last) return 0;
    const mb = B.last.final.filter(l => !B.node.has(l.key)).reduce((a, l) => a + l.mb, 0);
    B.last.final.forEach(l => B.node.add(l.key));
    return mb;
  };
  return B;
}
const mbText = v => v >= 100 ? Math.round(v) + ' MB' : v >= 1 ? v.toFixed(0) + ' MB' : v > 0 ? '<1 MB' : '0 MB';

export default {
  lead: 'A Docker image is a pile of layers, one for each Dockerfile line. On a rebuild, Docker reuses every layer whose inputs are unchanged, right up to the first one that changed; from there on, everything is built again. Edit your code, add a package, and see which layers rebuild. Then reorder the Dockerfile, choose a smaller base and try a multi-stage build.',
  emptyLog: 'Nothing yet. Edit the code and build.',
  tryThis: [
    'With <b>COPY everything first</b>, press <b>Edit app code + build</b>. A one-line edit reinstalls every package (45 s).',
    'Switch to <b>package.json first</b> and edit the code again. npm ci now comes from the cache and the build takes about half a minute.',
    '<b>Add a package</b>. This time package.json changed, so npm ci must run whichever order you use.',
    'Choose the slim base and turn on multi-stage. The image a server downloads shrinks from more than 600 MB to under 200 MB.',
  ],
  inShort: {
    what: 'A Docker image is a stack of read-only layers, one per Dockerfile line, cached by their inputs and shared between builds and servers.',
    why: 'Layers keep builds fast and pushes small: only changed layers are rebuilt, uploaded and downloaded, so the order of lines in the Dockerfile matters.',
    tradeoff: 'Copy files that rarely change (package.json) before the code to keep the cache warm; slim bases and multi-stage builds shrink images but remove tools.',
    interview: 'A multi-stage build: install dependencies from the lockfile first so they hit the cache, build, then copy only the output into a slim or distroless runtime image.',
  },
  quiz: [
    { q: 'Your Dockerfile copies all the source before RUN npm ci. You change one line of code. What rebuilds?', o: ['Only the code layer', 'The code layer and every layer after it, npm ci included', 'Nothing', 'Only the base image'], a: 1,
      why: 'A changed layer invalidates all the layers after it. Copy package.json and install first, then copy the code.' },
    { q: 'What does a multi-stage build give you?', o: ['Faster CPUs', 'A final image holding only the runtime and built output, without compilers and dev dependencies', 'More layers', 'Automatic tests'], a: 1,
      why: 'Build in a full image, then copy just the output into a slim runtime stage. Smaller images pull faster and expose less.' },
    { q: 'You push a new image after a small code change. How much is uploaded?', o: ['The whole image', 'Only the layers the registry does not have yet', 'Nothing', 'Only the base image'], a: 1,
      why: 'Layers are content-addressed; unchanged ones already sit in the registry and on the servers, so only the changed ones travel.' },
  ],
  guided: {
    intro: 'With the source copied before the install step, change one line of code and rebuild.',
    example: '“Run the guided example” sets COPY everything first, the full base and no multi-stage, starts over, then edits the app code and builds.',
    question: 'Which layers will be rebuilt?',
    predictions: ['COPY . . and every line after it, so npm ci runs again.', 'Only the COPY . . layer.', 'Nothing: Docker spots that only code changed.'],
    correctPrediction: 0,
    running: 'Watch the Dockerfile stack: highlighted rows were rebuilt, grey rows came from the cache.',
    observation: 'The code change invalidated COPY . . and therefore every later layer, so npm ci reinstalled every package.',
    explainQuestion: 'Why did npm ci run again?',
    explanations: ['A layer\'s cache key includes everything before it; once COPY . . changed, every later layer had to be rebuilt, npm ci included.', 'npm ci never uses the cache.', 'The base image changed.'],
    correctExplanation: 0,
    why: 'Order lines from least to most often changed: copy package files and install first, then copy the code.',
    retryHint: 'Look at which row is the first highlighted one in the stack.',
    nextSlug: 'kubernetes-scheduling',
    nextLabel: 'Next experiment: Kubernetes →',
    waitSeconds: 6,
  },

  setup(kit) {
    const { stage } = kit;
    let B, anim = null;

    kit.metrics([
      { key: 'time', label: 'Last build' }, { key: 'size', label: 'Image size' },
      { key: 'push', label: 'Uploaded to registry' }, { key: 'pull', label: 'Downloaded by a server' },
    ]);
    const p = kit.panel;
    p.buttons([
      { label: 'Edit app code + build', kind: 'primary', onClick: () => { B.ver.code++; build('Code edited'); } },
      { label: 'Add a package + build', kind: 'outline', onClick: () => { B.ver.deps++; build('Package added'); } },
      { label: 'Deploy to a new server', kind: 'outline', onClick: freshServer },
      { label: 'Start over', kind: 'outline', onClick: () => reset() },
    ]);
    const order = p.seg('Dockerfile order', { options: [['bad', 'COPY everything first'], ['good', 'package.json first']], value: 'bad',
      onChange: v => { B.opts.order = v; build(v === 'good' ? 'Reordered: package.json first' : 'Reordered: everything copied first'); } });
    const base = p.seg('Base image', { options: Object.entries(BASES).map(([k, b]) => [k, b.label]), value: 'full',
      onChange: v => { B.opts.base = v; build(`Base changed to ${BASES[v].label}`); } });
    const multi = p.toggle('Multi-stage build (ship only what runs)', { value: false, hint: 'Changing these settings starts a new build.',
      onChange: v => { B.opts.multi = v; build(v ? 'Multi-stage on' : 'Multi-stage off'); } });

    function reset() {
      B = makeBuilder({ order: order.get(), base: base.get(), multi: multi.get() });
      B.build(); B.lastPull = B.pull();
      anim = null;
      kit.resetTime();
      kit.clearLog();
      paint();
    }
    function build(why) {
      const r = B.build(), pulled = B.pull();
      B.lastPull = pulled;
      anim = { t: 0 };
      const rebuilt = r.layers.filter(l => !l.cached);
      const ci = rebuilt.some(l => l.k === 'ci');
      kit.log(`${why}: ${rebuilt.length} of ${r.layers.length} layers rebuilt in ${Math.round(r.secs)} s${ci ? ' (npm ci ran again)' : ''}. Pushed ${mbText(r.push)}, server pulled ${mbText(pulled)}.`);
      if (why === 'Code edited') {
        const first = r.layers.find(l => !l.cached);
        kit.guided.observe(ci
          ? `One line of code changed, yet ${rebuilt.length} of ${r.layers.length} layers rebuilt, starting at “${first?.cmd}”, and npm ci reinstalled everything: ${Math.round(r.secs)} s.`
          : `Only ${rebuilt.length} layers rebuilt (from “${first?.cmd}”); npm ci came from the cache: ${Math.round(r.secs)} s.`);
      }
      paint();
    }
    function freshServer() {
      B.node = new Set();
      const mb = B.pull();
      B.lastPull = mb;
      kit.log(`A new server pulled the whole image: ${mbText(mb)}. Smaller images start faster on fresh nodes.`);
      paint();
    }
    function paint() {
      const L = B.last;
      kit.metric('time', Math.round(L.secs) + ' s', L.secs > 60 ? 'bad' : L.secs > 20 ? 'warn' : 'good');
      kit.metric('size', mbText(L.size), L.size > 500 ? 'bad' : L.size > 200 ? 'warn' : 'good');
      kit.metric('push', mbText(L.push));
      kit.metric('pull', mbText(B.lastPull || 0));
    }

    function draw(real) {
      stage.clear();
      const c = stage.colors, w = stage.w, h = stage.h, ctx = stage.ctx;
      if (anim) anim.t += real;
      const L = B.last, layers = L.layers, pad = 14, top = 30;
      const lh = Math.max(10, Math.min(30, (h - top - 50) / layers.length - 4));
      const shipStage = B.opts.multi ? 2 : 1;
      const shown = anim ? anim.t / 0.25 : layers.length;
      fitText(stage, `Dockerfile · build #${B.builds} · grey = reused from cache, coloured = rebuilt`, pad, top - 8, w - 2 * pad, { size: 10, color: c.muted, baseline: 'bottom' });
      const cw = Math.min(300, w * 0.52), bx = pad + cw + 8, bw = w - pad - bx;
      layers.forEach((l, i) => {
        const y = top + i * (lh + 4);
        const ships = (l.stage || 1) === shipStage, seen = i < shown, hot = !l.cached && seen;
        if (B.opts.multi && i > 0 && (l.stage || 1) !== (layers[i - 1].stage || 1)) stage.line(pad, y - 2, w - pad, y - 2, { color: c.line, width: 1, dash: [4, 3] });
        tile(stage, pad, y, cw, lh, { fill: hot ? c.signal : c.surface, fillAlpha: hot ? 0.3 : 1, stroke: ships ? c.violet : c.line, width: ships ? 1.5 : 1, r: 5 });
        ctx.font = `500 ${w < 520 ? 9 : 10}px ui-monospace, monospace`;
        stage.text(fit(ctx, l.cmd, cw - 14), pad + 8, y + lh / 2, { size: w < 520 ? 9 : 10, mono: true, color: seen ? c.ink : c.muted });
        if (!seen) return;
        const half = (lh - 6) / 2;
        tile(stage, bx, y + 2, bw * 0.5 * Math.min(1, l.t / 45), half, { fill: c.signal, fillAlpha: 0.7, r: 1 });
        tile(stage, bx, y + 4 + half, bw * 0.5 * Math.min(1, l.mb / 400), half, { fill: c.violet, fillAlpha: ships ? 0.7 : 0.25, r: 1 });
        fitText(stage, `${l.cached ? 'cached' : Math.round(l.t) + ' s'} · ${mbText(l.mb)}${ships ? '' : ' (build stage only)'}`, bx + bw * 0.52, y + lh / 2, bw * 0.48, { size: 9, color: c.muted });
      });
      const ey = top + layers.length * (lh + 4) + 14;
      fitText(stage, `Shipped image = ${B.opts.multi ? 'the runtime stage only' : 'every layer above'}: ${mbText(L.size)}.`, pad, ey, w - 2 * pad, { size: 10, color: c.ink });
      fitText(stage, 'Amber bar = build time, purple bar = layer size.', pad, ey + 16, w - 2 * pad, { size: 10, color: c.muted });
    }

    kit.loop((dt, real) => draw(real || 0));
    reset();

    return {
      reset,
      guidedRun() {
        order.set('bad', true); base.set('full', true); multi.set(false, true);
        reset();
        unpause();
        setTimeout(() => { B.ver.code++; build('Code edited'); }, 600);
      },
    };
  },
};
