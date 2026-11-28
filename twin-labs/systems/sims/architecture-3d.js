// A whole web backend in 3D: users → CDN edge / load balancer → three stateless app servers →
// Redis-style cache, primary database with two read replicas, and a queue feeding two workers.
//
// Model (per simulated second, at the chosen traffic T):
//   • 40% of requests are static files. With the CDN on they are answered at the edge and never
//     reach your servers, so origin traffic = T × 0.6; with the CDN off it is the full T.
//   • The other 60% are API calls. A share W of them write: they go to the primary database, which
//     copies each change to both replicas after the replication lag (± 20%). 60% of writes also
//     drop a background job on the queue for a worker.
//   • Reads try the cache first; a fraction (1 − hit rate) misses and is served by a read replica.
//     Replica reads = T × 0.6 × (1 − W) × (1 − hit rate).
//   • Crashing App 2: the balancer keeps sending it one request in three (round robin) until its
//     health check fails 2.5 s later, then only App 1 and App 3 get traffic.
// Each animated dot is one sampled request (≈1.4 + 1.3 × traffic step dots per second, capped at
// 260 on screen); it hops one component every 0.5 s along the path it really takes.

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { h } from '../../js/core/dom.js';

const RPS_STEPS = [200, 500, 1000, 2000, 5000, 10000, 20000];
const HOP_S = 0.5;          // seconds per hop for a request dot
const HEALTH_S = 2.5;       // health-check delay before the balancer drops a crashed server
const MAX_DOTS = 260;
const STATIC_SHARE = 0.4;

// colour role → stage colour key
const ROLE = { users: 'ink2', cdn: 'teal', lb: 'wire', app: 'wire', cache: 'ok', db: 'amber', replica: 'violet', job: 'pink' };
const DOT = { static: 'teal', hit: 'ok', miss: 'signal', write: 'wire', repl: 'violet', job: 'pink', fail: 'bad' };
const LEGEND = [['static', 'Static file'], ['hit', 'Cache hit'], ['miss', 'Cache miss → replica'], ['write', 'Write to primary'], ['repl', 'Replication'], ['job', 'Background job'], ['fail', 'Failed']];

// Scene layout (x across, z depth), sizes in world units.
const PARTS = [
  { id: 'users', info: 'users', x: -13, z: 1, kind: 'crowd', role: 'users', label: 'Users' },
  { id: 'cdn', info: 'cdn', x: -8.5, z: -5, kind: 'box', w: 2.2, h: 0.8, d: 1.6, role: 'cdn', label: 'CDN edge' },
  { id: 'lb', info: 'lb', x: -7, z: 1.5, kind: 'box', w: 1.4, h: 1.1, d: 2.6, role: 'lb', label: 'Load balancer' },
  { id: 'app1', info: 'app', x: -1.5, z: -2.6, kind: 'box', w: 1.3, h: 2, d: 1.3, role: 'app', label: 'App 1' },
  { id: 'app2', info: 'app', x: -1.5, z: 1, kind: 'box', w: 1.3, h: 2, d: 1.3, role: 'app', label: 'App 2' },
  { id: 'app3', info: 'app', x: -1.5, z: 4.6, kind: 'box', w: 1.3, h: 2, d: 1.3, role: 'app', label: 'App 3' },
  { id: 'cache', info: 'cache', x: 4, z: -4.8, kind: 'box', w: 1.9, h: 1, d: 1.4, role: 'cache', label: 'Redis cache' },
  { id: 'db', info: 'db', x: 4.5, z: 0.8, kind: 'cyl', r: 1.1, h: 1.8, role: 'db', label: 'Primary DB' },
  { id: 'rep1', info: 'replica', x: 10, z: -3, kind: 'cyl', r: 0.8, h: 1.4, role: 'replica', label: 'Replica 1' },
  { id: 'rep2', info: 'replica', x: 10, z: 2, kind: 'cyl', r: 0.8, h: 1.4, role: 'replica', label: 'Replica 2' },
  { id: 'queue', info: 'queue', x: 4.5, z: 7.2, kind: 'box', w: 3.4, h: 0.7, d: 1, role: 'job', label: 'Queue' },
  { id: 'work1', info: 'worker', x: 10, z: 6.2, kind: 'box', w: 1.1, h: 1.1, d: 1.1, role: 'job', label: 'Worker 1' },
  { id: 'work2', info: 'worker', x: 10, z: 8.6, kind: 'box', w: 1.1, h: 1.1, d: 1.1, role: 'job', label: 'Worker 2' },
];
const LINKS = [['users', 'cdn'], ['users', 'lb'], ['lb', 'app1'], ['lb', 'app2'], ['lb', 'app3'], ['db', 'rep1'], ['db', 'rep2'], ['queue', 'work1'], ['queue', 'work2']];
for (const a of ['app1', 'app2', 'app3']) for (const b of ['cache', 'db', 'rep1', 'rep2', 'queue']) LINKS.push([a, b]);

const OVERVIEW = {
  title: 'Reading the picture',
  what: 'Requests travel from the users on the left towards the data stores on the right. Every coloured dot is one request, and the boxes it passes through are the components it needed.',
  points: [
    'Static files end at the CDN edge and never touch your own machines.',
    'Reads ask the cache first and drop to a read replica when the cache does not have the answer.',
    'Writes always go to the primary database, which forwards them to the replicas a little later.',
    'Slow side tasks such as emails or image resizing are handed to the queue and picked up by workers.',
  ],
  trade: 'Each extra box buys speed or headroom and costs you something to run and watch. Add one when a measured bottleneck asks for it.',
};
const INFO = {
  users: { title: 'Users', what: 'Phones and browsers all over the world sending requests at the same time.',
    points: ['Distance adds network delay that you can shorten (edges, regional servers) but never remove.', 'Load is bursty: evening peaks, launches and viral moments.'],
    trade: 'Size the system for the busiest hour, not for the daily average.' },
  cdn: { title: 'CDN edge', what: 'Machines placed near users that keep copies of static files such as images, scripts, styles and video.',
    points: ['Round trips get shorter because the copy sits close to the user.', 'Most of the bytes you serve never reach your own servers.', 'Cache-Control headers say how long an edge may keep each file.'],
    trade: 'Removing an outdated file from hundreds of edges is slow, so builds give files versioned names (main.8c1e.js) instead.' },
  lb: { title: 'Load balancer', what: 'One front door that hands each request to a healthy app server.',
    points: ['Common rules: round robin, least connections, or a hash of the user or IP.', 'Health checks take broken servers out of the rotation.', 'Layer 7 balancers understand HTTP and often end TLS; layer 4 balancers only pass TCP along.'],
    trade: 'If there is only one, it is a single point of failure, so it is normally deployed as a pair.' },
  app: { title: 'App servers', what: 'Run the business logic. They keep no user state of their own, so any of them can answer any request.',
    points: ['Session data lives in a shared cache or a signed token, not in one server\'s memory.', 'To scale out, put more of them behind the balancer.', 'Press “Crash App 2” to see the others take over.'],
    trade: 'Adding app servers is easy, which is why the database usually becomes the next limit.' },
  cache: { title: 'Cache (Redis)', what: 'An in-memory key-value store that holds popular data so most reads never reach a database.',
    points: ['Cache-aside: look in the cache, and on a miss read the database and save the answer with an expiry time.', 'When memory fills, an eviction policy such as LRU decides what goes.', 'The hit rate is the figure that matters most.'],
    trade: 'Cached answers can be out of date, and knowing when to invalidate them is notoriously tricky.' },
  db: { title: 'Primary database', what: 'The source of truth: every write lands here.',
    points: ['Transactions keep data consistent even if something fails half way.', 'Indexes make reads faster and writes slower.', 'When one primary cannot absorb the writes, sharding is the usual next step.'],
    trade: 'One primary only scales up so far, and without a standby it is a single point of failure.' },
  replica: { title: 'Read replicas', what: 'Copies of the primary that receive its changes in the background and answer reads.',
    points: ['They share the read load across more machines.', 'Replication lag means a replica can be seconds behind.', 'For read-your-own-writes, send a user\'s reads to the primary for a moment after they write.'],
    trade: 'Eventual consistency: someone may not see their own change straight away.' },
  queue: { title: 'Message queue', what: 'A buffer (Kafka, RabbitMQ, SQS and similar) for work that does not need to finish inside the request.',
    points: ['Senders and receivers no longer depend on each other being up.', 'A burst makes the queue longer instead of knocking servers over.', 'Retries and a dead-letter queue deal with jobs that keep failing (see the Queues topic).'],
    trade: 'The work becomes asynchronous: results arrive later and a bug can span several systems.' },
  worker: { title: 'Workers', what: 'Background processes that take jobs off the queue: emails, thumbnails, reports, payments.',
    points: ['They scale separately from the app servers.', 'A job can arrive twice, so each one must be safe to repeat (idempotent).'],
    trade: 'More services to deploy, monitor and keep in step.' },
};

export default {
  lead: 'A typical web backend, from the people using it down to the databases. Drag to orbit, pinch or scroll to zoom, and tap any part to read what it does.',
  emptyLog: 'Nothing yet. Turn the CDN off or crash App 2.',
  stageHeight: 460,
  tryThis: [
    'Switch the <b>CDN</b> off. The 40% of traffic that was static files now lands on your own servers as well.',
    'Lower the <b>cache hit rate</b> to 20%. Amber dots pour into the read replicas.',
    'Set <b>replication lag</b> to 4 s. Someone who saves a change and reads it back from a replica straight away gets the old version.',
    'Press <b>Crash App 2</b>: red dots are requests lost before the balancer\'s health check gives up on it.',
  ],
  inShort: {
    what: 'A web backend is a chain of layers: DNS and a CDN at the edge, a load balancer, stateless app servers, then caches, queues and databases behind them.',
    why: 'Each layer takes some work off the one behind it, so the slowest and most expensive part, the database, sees as little traffic as possible.',
    tradeoff: 'Every layer adds a network hop, another thing that can fail and another thing to monitor. Add one only when the numbers say you need it.',
    interview: 'I keep the app servers stateless so I can scale them out behind the load balancer, and I put a cache in front of the database for reads.',
  },
  quiz: [
    { q: 'People download the same images and scripts over and over. Which component takes that load off your servers?', o: ['The load balancer', 'A CDN edge', 'A read replica', 'The message queue'], a: 1,
      why: 'A CDN keeps static files at edges near the users, so those requests are answered there and never reach your origin.' },
    { q: 'Why are app servers normally kept stateless?', o: ['To save memory', 'So any server can take any request and servers can be added or removed freely', 'So the database is not needed', 'HTTP demands it'], a: 1,
      why: 'When sessions live in a shared cache or a token, the balancer can route a user anywhere, which makes scaling out simple.' },
    { q: 'Someone updates their profile and immediately reloads it from a read replica, but sees the old values. Why?', o: ['A cache stampede', 'Replication lag', 'DNS failed', 'The write was refused'], a: 1,
      why: 'Replicas apply the primary\'s changes asynchronously; until they catch up they hand out older data.' },
  ],
  guided: {
    intro: 'Switch the CDN off and see how much more traffic reaches your own servers.',
    example: '“Run the guided example” resets to 2k req/s, an 80% cache hit rate, 15% writes and the CDN on, then turns the CDN off after 3 seconds.',
    question: 'What happens to “Reach your servers” when the CDN goes away?',
    predictions: ['It climbs from about 1.2k to the full 2k req/s, because static files now come from your servers.', 'It stays the same, because the cache answers static files instead.', 'It drops, because there is one fewer component in the path.'],
    correctPrediction: 0,
    running: 'Watch the “Reach your servers” number and the teal dots: they stop turning back at the CDN edge and travel through the balancer instead.',
    observation: 'With the CDN off, every static file went through the load balancer and an app server, so traffic reaching your servers rose from 1.2k to 2k req/s.',
    explainQuestion: 'Why did origin traffic jump?',
    explanations: ['The CDN was answering the 40% of requests that are static files at the edge; without it they all travel to the origin.', 'Turning the CDN off empties the Redis cache.', 'The load balancer sends every request twice when the CDN is missing.'],
    correctExplanation: 0,
    why: 'Edges absorb the repetitive, cacheable part of the traffic. Remove them and that load lands on machines that are more expensive to scale.',
    retryHint: 'Look at what the teal “static file” dots did before and after the switch.',
    nextSlug: 'capacity',
    nextLabel: 'Next experiment: capacity planning →',
    waitSeconds: 8,
  },

  setup(kit) {
    const { stage } = kit;
    const reduced = typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;
    const s = { rpsI: 3, hit: 80, writes: 15, lag: 1, cdn: true, rotate: !reduced, crashed: false, crashAt: 0, removed: false, sel: null };
    let destroyed = false;
    let guidedTimers = [];

    // ---------- DOM inside the stage ----------
    stage.canvas.style.display = 'none';
    const wrap = h('div', { style: { position: 'relative', width: '100%', height: '460px', overflow: 'hidden', borderRadius: '12px', touchAction: 'none', background: 'var(--bg-2)' } });
    const labels = h('div', { style: { position: 'absolute', inset: '0', pointerEvents: 'none' } });
    const hint = h('div', { style: { position: 'absolute', left: '10px', bottom: '8px', font: '500 11.5px var(--font)', color: 'var(--text-3)', pointerEvents: 'none' } }, 'Drag to orbit · pinch or scroll to zoom · tap a part to learn');
    const keys = h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: '6px 14px', padding: '10px 4px 2px', font: '500 12.5px var(--font)', color: 'var(--text-2)' } },
      LEGEND.map(([k, l]) => h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: '6px' } },
        h('i', { dataset: { dot: k }, style: { width: '9px', height: '9px', borderRadius: '50%', display: 'inline-block' } }), l)));
    wrap.append(labels, hint);
    kit.stageEl.append(wrap, keys);
    const sizeWrap = () => { const w = wrap.clientWidth || 600; wrap.style.height = Math.round(Math.max(320, Math.min(520, w * 0.66))) + 'px'; };
    sizeWrap();

    // ---------- metrics, chart ----------
    kit.metrics([
      { key: 'origin', label: 'Reach your servers / s' }, { key: 'rep', label: 'Replica reads / s' },
      { key: 'wr', label: 'Primary writes / s' }, { key: 'job', label: 'Background jobs / s' }, { key: 'fail', label: 'Failed / s' },
    ]);
    const chart = kit.chart({
      lines: [{ key: 'origin', label: 'Reach your servers', color: 'wire' }, { key: 'rep', label: 'Replica reads', color: 'signal' }, { key: 'wr', label: 'Primary writes', color: 'violet' }],
      bars: { key: 'fail', label: 'Failed requests', color: 'bad' },
      format: v => `${kit.fmt(v)}/s`,
    });

    // ---------- controls ----------
    const p = kit.panel;
    const rps = p.slider('Traffic', { min: 0, max: RPS_STEPS.length - 1, step: 1, value: s.rpsI, format: i => `${kit.fmt(RPS_STEPS[i])} req/s`, onInput: i => { s.rpsI = i; paint(); } });
    const hit = p.slider('Cache hit rate', { min: 0, max: 100, step: 5, value: s.hit, format: v => `${v}%`, onInput: v => { s.hit = v; paint(); } });
    const writes = p.slider('Share of API calls that write', { min: 0, max: 60, step: 5, value: s.writes, format: v => `${v}%`, onInput: v => { s.writes = v; paint(); } });
    const lag = p.slider('Replication lag', { min: 0, max: 4, step: 0.5, value: s.lag, format: v => (v ? `${v} s` : 'none'), onInput: v => { s.lag = v; } });
    const cdn = p.toggle('CDN serves static files', { value: s.cdn, onChange: v => setCdn(v) });
    const rot = p.toggle('Rotate slowly', { value: s.rotate, onChange: v => { s.rotate = v; } });
    const btns = p.buttons([
      { label: 'Crash App 2', kind: 'primary', onClick: () => setCrash(!s.crashed) },
      { label: 'Reset view', kind: 'outline', onClick: () => resetView() },
      { label: 'Reset', kind: 'outline', onClick: () => resetAll() },
    ]);
    const crashBtn = btns.buttons[0];
    const concept = h('div.card', { style: { padding: '14px', marginTop: '14px', background: 'var(--surface-2)' } });
    p.custom(concept);
    concept.addEventListener('click', e => { if (e.target.closest('[data-overview]')) select(null); });

    function setCdn(v, quiet) {
      s.cdn = v;
      if (!quiet) kit.log(v ? 'CDN on: static files are answered at the edge again' : 'CDN off: static files now travel through the balancer to your app servers');
      paint();
    }
    function setCrash(v) {
      s.crashed = v; s.crashAt = kit.time; s.removed = false;
      crashBtn.textContent = v ? 'Restore App 2' : 'Crash App 2';
      kit.log(v ? 'App 2 crashed. The balancer still sends it every third request until the health check notices' : 'App 2 is back and rejoins the rotation');
      paintMeshes();
      paint();
    }

    // ---------- model numbers ----------
    function model() {
      const T = RPS_STEPS[s.rpsI];
      const origin = T * (s.cdn ? 1 - STATIC_SHARE : 1);
      const api = T * (1 - STATIC_SHARE);
      const wr = api * s.writes / 100;
      const rep = (api - wr) * (1 - s.hit / 100);
      const fail = s.crashed && !s.removed ? origin / 3 : 0;
      return { T, origin, api, wr, rep, job: wr * 0.6, fail };
    }
    function paint() {
      const m = model();
      kit.metric('origin', kit.fmt(m.origin), s.cdn ? '' : 'warn');
      kit.metric('rep', kit.fmt(m.rep), m.rep > 1500 ? 'warn' : '');
      kit.metric('wr', kit.fmt(m.wr));
      kit.metric('job', kit.fmt(m.job));
      kit.metric('fail', m.fail ? kit.fmt(m.fail) : '0', m.fail ? 'bad' : 'good');
      paintConcept();
    }
    function paintConcept() {
      const d = s.sel ? INFO[s.sel] : OVERVIEW;
      concept.replaceChildren(
        h('h3', { style: { fontSize: '16px', marginBottom: '6px' } }, d.title),
        h('p.muted', { style: { fontSize: '14px' } }, d.what),
        h('ul', { style: { margin: '8px 0', paddingLeft: '18px', fontSize: '13.5px', display: 'grid', gap: '4px' } }, d.points.map(x => h('li', x))),
        h('p', { style: { fontSize: '13.5px' } }, h('b', 'Trade-off: '), d.trade),
        ...[s.sel ? h('button.btn.ghost.sm', { type: 'button', dataset: { overview: '1' }, style: { marginTop: '10px' } }, '← Back to the overview') : null].filter(Boolean));
    }

    // ---------- three.js scene ----------
    let G = null; // graphics state
    try { G = buildScene(); } catch (err) {
      console.warn('3D view unavailable', err);
      G = null;
      wrap.append(h('div', { style: { position: 'absolute', inset: '0', display: 'grid', placeItems: 'center', padding: '24px', textAlign: 'center', color: 'var(--text-2)' } },
        h('p', { html: 'This device cannot draw WebGL 3D graphics. The same request flow is animated in 2D in <a href="#/systems/load-balancing">Load balancing</a>, <a href="#/systems/caching">Caching</a> and <a href="#/systems/replication">Replication</a>.' })));
    }

    function colors() { return stage.colors; }
    function col(key) { return new THREE.Color(colors()[key] || '#888888'); }

    function buildScene() {
      const canvas = document.createElement('canvas');
      canvas.setAttribute('aria-label', '3D model of a web backend with requests flowing through it');
      canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;display:block;cursor:grab;outline:none';
      wrap.prepend(canvas);
      const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
      renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 300);
      const hemi = new THREE.HemisphereLight(0xffffff, 0x334455, 0.85);
      const sun = new THREE.DirectionalLight(0xffffff, 0.75);
      sun.position.set(8, 18, 10);
      scene.add(hemi, sun);
      const disposables = [];
      const track = o => { disposables.push(o); return o; };
      const mats = []; // { m, key, emissive }
      const mat = (key, extra = {}) => { const m = track(new THREE.MeshStandardMaterial({ color: col(key), roughness: 0.55, metalness: 0.05, ...extra })); mats.push({ m, key, emissive: !!extra.emissive }); return m; };
      const lineMat = (key, opacity) => { const m = track(new THREE.LineBasicMaterial({ color: col(key), transparent: true, opacity })); mats.push({ m, key }); return m; };

      const floorMat = mat('surface', { roughness: 1 });
      const floor = new THREE.Mesh(track(new THREE.PlaneGeometry(48, 36)), floorMat);
      floor.rotation.x = -Math.PI / 2; floor.position.set(-0.5, -0.02, 2);
      scene.add(floor);
      let grid = null;
      const makeGrid = () => {
        if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); }
        grid = new THREE.GridHelper(48, 48, col('line2'), col('line'));
        grid.position.set(-0.5, 0, 2);
        scene.add(grid);
      };
      makeGrid();

      const nodes = {}, pickables = [];
      const crowdGeo = track(new THREE.SphereGeometry(0.34, 16, 12));
      for (const part of PARTS) {
        const g = new THREE.Group();
        g.position.set(part.x, 0, part.z);
        const n = { ...part, group: g, bump: 0, mesh: null, top: 1 };
        if (part.kind === 'crowd') {
          const m = mat(ROLE.users);
          for (let i = 0; i < 7; i++) {
            const a = (i / 7) * Math.PI * 2;
            const sph = new THREE.Mesh(crowdGeo, m);
            sph.position.set(Math.cos(a) * 1.25, 0.34, Math.sin(a) * 1.25);
            sph.userData.id = part.id;
            g.add(sph); pickables.push(sph);
          }
          n.top = 0.9;
        } else {
          const geo = track(part.kind === 'cyl' ? new THREE.CylinderGeometry(part.r, part.r, part.h, 32) : new THREE.BoxGeometry(part.w, part.h, part.d));
          const mesh = new THREE.Mesh(geo, mat(ROLE[part.role], { emissive: new THREE.Color(0x000000), emissiveIntensity: 0 }));
          mesh.position.y = part.h / 2; mesh.userData.id = part.id;
          g.add(mesh); pickables.push(mesh);
          const edges = new THREE.LineSegments(track(new THREE.EdgesGeometry(geo)), lineMat('ink', 0.3));
          edges.position.y = part.h / 2;
          g.add(edges);
          n.mesh = mesh; n.top = part.h;
        }
        scene.add(g);
        const btn = h('button', { type: 'button', style: labelStyle() }, part.label);
        btn.addEventListener('click', () => select(part.info));
        labels.append(btn);
        n.label = btn;
        nodes[part.id] = n;
      }
      const anchor = id => { const n = nodes[id]; return new THREE.Vector3(n.x, n.kind === 'crowd' ? 0.4 : 0.55, n.z); };
      const linkLineMat = lineMat('wire', 0.28);
      for (const [a, b] of LINKS) scene.add(new THREE.Line(track(new THREE.BufferGeometry().setFromPoints([anchor(a), anchor(b)])), linkLineMat));

      const dotGeo = track(new THREE.SphereGeometry(0.17, 12, 8));
      const dotMat = {};
      for (const k of Object.keys(DOT)) dotMat[k] = mat(DOT[k], { emissive: col(DOT[k]), emissiveIntensity: 0.45 });

      const controls = new OrbitControls(camera, canvas);
      controls.enableDamping = true;
      controls.dampingFactor = 0.12;
      controls.minDistance = 10; controls.maxDistance = 75;
      controls.minPolarAngle = 0.2; controls.maxPolarAngle = 1.42;
      controls.enablePan = false;
      controls.target.set(-1.2, 0, 2);
      controls.addEventListener('start', () => { canvas.style.cursor = 'grabbing'; if (s.rotate) { s.rotate = false; rot.set(false, true); } });
      controls.addEventListener('end', () => { canvas.style.cursor = 'grab'; });

      // tap to select (a press that barely moved)
      let down = null;
      const ray = new THREE.Raycaster();
      const onDown = e => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
      const onUp = e => {
        if (!down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y) > 6 || performance.now() - down.t > 500;
        down = null;
        if (moved) return;
        const r = canvas.getBoundingClientRect();
        ray.setFromCamera(new THREE.Vector2(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1), camera);
        const hitObj = ray.intersectObjects(pickables, false)[0];
        select(hitObj ? nodes[hitObj.object.userData.id].info : null);
      };
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);

      let W = 0, H = 0;
      const resize = () => {
        sizeWrap();
        const w = wrap.clientWidth, hh = wrap.clientHeight;
        if (!w || !hh) return;
        W = w; H = hh;
        renderer.setSize(w, hh, false);
        camera.aspect = w / hh;
        camera.updateProjectionMatrix();
      };
      const ro = new ResizeObserver(resize);
      ro.observe(wrap);
      resize();

      return {
        renderer, scene, camera, controls, nodes, mats, anchor, dotGeo, dotMat, makeGrid, floorMat,
        dots: [], pool: [], tmp: new THREE.Vector3(), acc: 0, rr: -1,
        get W() { return W; }, get H() { return H; },
        dispose() {
          ro.disconnect();
          canvas.removeEventListener('pointerdown', onDown);
          canvas.removeEventListener('pointerup', onUp);
          controls.dispose();
          for (const d of disposables) d.dispose?.();
          if (grid) { grid.geometry.dispose(); grid.material.dispose(); }
          renderer.dispose();
          renderer.forceContextLoss?.();
          canvas.remove();
        },
      };
    }

    function labelStyle() {
      return {
        position: 'absolute', left: '0', top: '0', pointerEvents: 'auto', cursor: 'pointer', whiteSpace: 'nowrap',
        font: '600 11.5px var(--font)', padding: '2px 7px', borderRadius: '6px',
        border: '1px solid var(--line-2)', background: 'color-mix(in srgb, var(--surface) 88%, transparent)', color: 'var(--text)',
      };
    }

    function resetView() {
      if (!G) return;
      const asp = (G.W || 1) / (G.H || 1);
      const theta = asp < 1 ? -1.2 : -0.35, phi = asp < 1 ? 0.78 : 0.85, r = asp < 1 ? 39 : asp < 1.4 ? 34 : 28;
      const t = G.controls.target.set(-1.2, 0, 2);
      G.camera.position.set(t.x + r * Math.sin(phi) * Math.sin(theta), t.y + r * Math.cos(phi), t.z + r * Math.sin(phi) * Math.cos(theta));
      G.camera.lookAt(t);
      G.controls.update();
    }

    function applyTheme() {
      if (!G) return;
      for (const m of G.mats) { m.m.color.set(colors()[m.key] || '#888'); if (m.emissive) m.m.emissive.set(colors()[m.key] || '#888'); }
      G.scene.background = new THREE.Color(colors().bg2);
      G.makeGrid();
      for (const k of Object.keys(DOT)) for (const el of keys.querySelectorAll(`[data-dot="${k}"]`)) el.style.background = colors()[DOT[k]];
      paintMeshes();
    }
    function paintMeshes() {
      if (!G) return;
      for (const n of Object.values(G.nodes)) {
        if (!n.mesh) continue;
        const selected = s.sel === n.info;
        const dead = s.crashed && n.id === 'app2';
        n.mesh.material.color.set(dead ? colors().bad : colors()[ROLE[n.role]]);
        n.mesh.material.emissive.set(selected ? colors()[ROLE[n.role]] : '#000000');
        n.mesh.material.emissiveIntensity = selected ? 0.45 : 0;
      }
      for (const n of Object.values(G.nodes)) {
        const on = s.sel === n.info;
        n.label.style.borderColor = on ? 'var(--accent)' : 'var(--line-2)';
        n.label.style.background = on ? 'var(--accent)' : 'color-mix(in srgb, var(--surface) 88%, transparent)';
        n.label.style.color = on ? 'var(--accent-ink)' : 'var(--text)';
      }
    }
    function select(info) { s.sel = info; paintMeshes(); paintConcept(); }
    const onTheme = () => setTimeout(() => { if (!destroyed) applyTheme(); }, 0);
    window.addEventListener('themechange', onTheme);

    // ---------- request dots ----------
    function spawn(ids, type, delay = 0) {
      if (!G || G.dots.length > MAX_DOTS) return;
      const m = G.pool.pop() || new THREE.Mesh(G.dotGeo, G.dotMat[type]);
      m.material = G.dotMat[type];
      m.visible = false;
      G.scene.add(m);
      G.dots.push({ m, ids, pts: ids.map(G.anchor), t: -delay, seg: -1 });
    }
    const appDown = () => s.crashed && s.removed;
    function pickApp() {
      const pool = ['app1', 'app2', 'app3'].filter(a => !(a === 'app2' && appDown()));
      G.rr = (G.rr + 1) % pool.length;
      return pool[G.rr];
    }
    function oneRequest() {
      if (Math.random() < STATIC_SHARE) {
        if (s.cdn) return spawn(['users', 'cdn', 'users'], 'static');
        const a = pickApp();
        if (s.crashed && a === 'app2') return spawn(['users', 'lb', 'app2'], 'fail');
        return spawn(['users', 'lb', a, 'lb', 'users'], 'static');
      }
      const a = pickApp();
      if (s.crashed && a === 'app2') return spawn(['users', 'lb', 'app2'], 'fail');
      if (Math.random() < s.writes / 100) {
        spawn(['users', 'lb', a, 'db', a, 'lb', 'users'], 'write');
        const base = HOP_S * 3;
        spawn(['db', 'rep1'], 'repl', base + s.lag * (0.8 + Math.random() * 0.4));
        spawn(['db', 'rep2'], 'repl', base + s.lag * (0.8 + Math.random() * 0.4));
        if (Math.random() < 0.6) spawn([a, 'queue', Math.random() < 0.5 ? 'work1' : 'work2'], 'job', HOP_S * 2 + 0.2);
      } else if (Math.random() < s.hit / 100) {
        spawn(['users', 'lb', a, 'cache', a, 'lb', 'users'], 'hit');
      } else {
        spawn(['users', 'lb', a, 'cache', a, Math.random() < 0.5 ? 'rep1' : 'rep2', a, 'lb', 'users'], 'miss');
      }
    }
    function stepDots(dt) {
      G.acc += (1.4 + s.rpsI * 1.3) * (reduced ? 0.5 : 1) * dt;
      while (G.acc >= 1) { G.acc -= 1; oneRequest(); }
      for (let i = G.dots.length - 1; i >= 0; i--) {
        const d = G.dots[i];
        d.t += dt;
        if (d.t < 0) continue;
        d.m.visible = true;
        const last = d.pts.length - 1;
        const k = d.t / HOP_S;
        if (k >= last) {
          G.scene.remove(d.m); G.pool.push(d.m); G.dots.splice(i, 1);
          G.nodes[d.ids[last]].bump = 1;
          continue;
        }
        const seg = Math.floor(k), f = k - seg;
        d.m.position.lerpVectors(d.pts[seg], d.pts[seg + 1], f);
        d.m.position.y += Math.sin(Math.PI * f) * 0.55;
        if (seg !== d.seg) { d.seg = seg; if (seg > 0) G.nodes[d.ids[seg]].bump = 1; }
      }
    }
    function clearDots() {
      if (!G) return;
      for (const d of G.dots) { G.scene.remove(d.m); G.pool.push(d.m); }
      G.dots.length = 0;
    }

    function frame(dt) {
      if (!G || destroyed) return;
      if (!G.W) return;
      stepDots(dt);
      for (const n of Object.values(G.nodes)) {
        n.bump = Math.max(0, n.bump - dt * 4);
        const sc = 1 + n.bump * 0.07;
        n.group.scale.set(sc, sc, sc);
      }
      const a2 = G.nodes.app2.group;
      a2.rotation.z += ((s.crashed ? -0.4 : 0) - a2.rotation.z) * Math.min(1, dt * 5 || 0);
      if (s.rotate && dt > 0) {
        const t = G.controls.target, off = G.camera.position.clone().sub(t);
        off.applyAxisAngle(new THREE.Vector3(0, 1, 0), dt * 0.07);
        G.camera.position.copy(t).add(off);
      }
      G.controls.update();
      G.renderer.render(G.scene, G.camera);
      for (const n of Object.values(G.nodes)) {
        G.tmp.set(n.x, n.top + 0.5, n.z).project(G.camera);
        if (G.tmp.z > 1) { n.label.style.display = 'none'; continue; }
        n.label.style.display = '';
        n.label.style.transform = `translate(${(((G.tmp.x + 1) / 2) * G.W).toFixed(1)}px,${(((1 - G.tmp.y) / 2) * G.H).toFixed(1)}px) translate(-50%,-100%)`;
      }
    }

    function everySecond() {
      if (s.crashed && !s.removed && kit.time - s.crashAt >= HEALTH_S) {
        s.removed = true;
        kit.log('Health check failed for App 2, so the balancer now sends traffic only to App 1 and App 3');
      }
      const m = model();
      chart.push({ origin: m.origin, rep: m.rep, wr: m.wr, fail: m.fail });
      paint();
    }

    function resetAll() {
      for (const t of guidedTimers) clearTimeout(t);
      guidedTimers = [];
      s.rpsI = 3; s.hit = 80; s.writes = 15; s.lag = 1;
      rps.set(3, true); hit.set(80, true); writes.set(15, true); lag.set(1, true);
      setCdn(true, true); cdn.set(true, true);
      s.crashed = false; s.removed = false; crashBtn.textContent = 'Crash App 2';
      kit.resetTime();
      chart.reset();
      kit.clearLog();
      clearDots();
      paintMeshes();
      paint();
    }

    kit.loop(frame);
    kit.every(1, everySecond);
    applyTheme();
    resetView();
    paint();

    kit.onCleanup(() => {
      destroyed = true;
      for (const t of guidedTimers) clearTimeout(t);
      window.removeEventListener('themechange', onTheme);
      clearDots();
      G?.dispose();
      G = null;
      wrap.remove(); keys.remove();
      stage.canvas.style.display = '';
    });

    return {
      reset: resetAll,
      guidedRun() {
        resetAll();
        import('../kit/clock.js').then(m => { if (m.isPaused()) m.setPaused(false); });
        const before = model().origin;
        guidedTimers.push(setTimeout(() => {
          if (destroyed) return;
          setCdn(false); cdn.set(false, true);
          guidedTimers.push(setTimeout(() => {
            if (destroyed) return;
            const after = model().origin;
            kit.guided.observe(`Traffic reaching your servers rose from ${kit.fmt(before)} to ${kit.fmt(after)} req/s the moment the CDN stopped answering static files.`);
          }, 2200));
        }, 3000));
      },
    };
  },
};
