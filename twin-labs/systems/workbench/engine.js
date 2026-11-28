// Workbench model and simulator. Pure functions, no DOM: used by the page and by worker.js.
//
// A design is a JSON document: components (nodes) with settings, connections (edges, "sync" when
// the caller waits, "async" into a queue), request types (routes) that say which components a
// request visits and how long each one works on it, a traffic workload and a fault schedule.
//
// The simulator is a seeded discrete-event model:
//   • Requests arrive at `rateRps` (random Poisson gaps or evenly spaced), and each picks a request
//     type by its share. A request walks the route's steps; at a component it may call others in
//     the order they were connected, waiting for each answer before the next.
//   • A server component has `instances`, each handling `concurrency` requests at once, with a
//     waiting line of `queueLimit` per instance. A full line rejects; a request waiting or working
//     longer than `timeoutMs` times out. Work time is drawn per request (exponential or fixed).
//   • Caches and CDNs answer a share `hitP` of requests themselves. Cache-aside: a hit lets the
//     caller skip its remaining calls (the database). Read-through: the cache itself calls the
//     database on a miss.
//   • A load balancer adds a fixed time and picks an instance of the next component by round robin
//     or least connections. A rate limiter is a token bucket (steady rate plus a burst).
//   • A queue hands each job to its workers without the sender waiting; its capacity is shared
//     between the worker instances. A full queue rejects the job and the request fails.
//   • Calls a component waits on may have retries (with exponential backoff and a retry budget)
//     and a circuit breaker (opens on an error share over the last N calls, then lets one trial
//     call through after `openMs`).
//   • Faults: a component down (every visit fails), slow (work × factor), or a traffic burst.
// Measurements skip the warm-up; a per-second timeline covers the whole run.

export const SCHEMA = 'twinlabs.workbench/1';
export const ENGINE = '1.0.0';
export const LIMITS = { nodes: 50, edges: 200, routes: 20, faults: 20 };
export const ID_RE = /^[a-z][a-z0-9_-]{0,31}$/;
export const FAULT_KINDS = ['down', 'slow', 'burst'];
// [default, min, max, whole number]
export const RETRY = { max: [2, 0, 5, true], backoffMs: [50, 0, 10000, false], budgetP: [0.2, 0, 10, false] };
export const BREAKER = { errorP: [0.5, 0.01, 1, false], minCalls: [10, 1, 1000, true], window: [20, 5, 1000, true], openMs: [5000, 100, 60000, false] };
export const WORKLOAD = { rateRps: [100, 0.1, 100000, false], durationMs: [60000, 1000, 600000, false], warmupMs: [5000, 0, 600000, false] };
export const MAX_MS = 60000;
export const ERROR_KINDS = ['rejected', 'timeout', 'down', 'limited', 'breaker'];

const srv = (inst, conc, qlim, tmo) => ({ instances: [inst, 1, 50, true], concurrency: [conc, 1, 1000, true], queueLimit: [qlim, 0, 10000, true], timeoutMs: [tmo, 1, 60000, false] });

export const TYPES = {
  traffic: { label: 'Users', kind: 'source', group: 'Users', config: {},
    desc: 'Where the requests start. Their rate is set under Traffic.' },
  cdn: { label: 'CDN', kind: 'server', group: 'Edge', front: true, ms: 2, config: { ...srv(4, 1000, 1000, 1000), hitP: [0.9, 0, 1, false] },
    desc: 'A cache at the edge, close to users. A hit is answered right there; a miss continues to the next component.' },
  ratelimit: { label: 'Rate limiter', kind: 'limiter', group: 'Edge', front: true, config: { limitRps: [500, 0.1, 100000, false], burst: [50, 1, 100000, true] },
    desc: 'Lets through no more than the set rate, with a burst allowance (a token bucket). Anything above it fails as limited.' },
  lb: { label: 'Load balancer', kind: 'pass', group: 'Edge', front: true, config: { overheadMs: [1, 0, 100, false] }, enums: { strategy: ['round_robin', 'least_conn'] },
    desc: 'Shares requests out over the instances of the component behind it.' },
  gateway: { label: 'API gateway', kind: 'server', group: 'Edge', ms: 2, config: srv(2, 200, 200, 3000),
    desc: 'One front door for your APIs: it checks and routes each request and keeps it open until the services behind it reply.' },
  app: { label: 'App service', kind: 'server', group: 'Compute', ms: 10, config: srv(2, 8, 100, 1000),
    desc: 'Your application servers. Every instance can work on a fixed number of requests at the same time.' },
  auth: { label: 'Auth service', kind: 'server', group: 'Compute', ms: 5, config: srv(2, 50, 100, 500),
    desc: 'Confirms who the caller is (tokens, sessions) before the real work starts.' },
  worker: { label: 'Worker', kind: 'server', group: 'Compute', ms: 30, config: { instances: [1, 1, 50, true], concurrency: [4, 1, 1000, true], timeoutMs: [60000, 1, 60000, false] },
    desc: 'Runs background jobs taken from a queue. Nobody waits on them.' },
  cache: { label: 'Cache', kind: 'server', group: 'Data', ms: 1, config: { ...srv(1, 200, 1000, 100), hitP: [0.8, 0, 1, false] }, enums: { pattern: ['cache_aside', 'read_through'] },
    desc: 'A fast in-memory store. Cache-aside: the app looks here first and asks the database only on a miss. Read-through: on a miss the cache asks the database itself.' },
  db: { label: 'Database', kind: 'server', group: 'Data', ms: 10, config: { concurrency: [20, 1, 1000, true], queueLimit: [200, 0, 10000, true], timeoutMs: [500, 1, 60000, false] },
    desc: 'Holds the data. It has a limited number of connections, so slow queries make everyone behind them wait.' },
  search: { label: 'Search index', kind: 'server', group: 'Data', ms: 15, config: srv(1, 20, 200, 1000),
    desc: 'A full-text search engine (Elasticsearch, for example). Its queries are heavier than a key lookup.' },
  storage: { label: 'Object storage', kind: 'server', group: 'Data', ms: 20, config: srv(1, 200, 1000, 5000),
    desc: 'Files and images (S3, for example). Lots of throughput, but each request is slower.' },
  queue: { label: 'Queue', kind: 'queue', group: 'Messaging', config: { capacity: [1000, 1, 1000000, true] },
    desc: 'Keeps jobs for workers. The sender carries on straight away; when the queue is full new jobs are refused.' },
  external: { label: 'External API', kind: 'server', group: 'Other', ms: 50, config: srv(1, 50, 100, 2000),
    desc: 'A service run by someone else that you call (payments, email, maps). You cannot add capacity to it.' },
};
export const GROUPS = ['Users', 'Edge', 'Compute', 'Data', 'Messaging', 'Other'];
export const kindOf = type => TYPES[type]?.kind;
const NO_WORK = new Set(['source', 'pass', 'limiter', 'queue']);
export const doesWork = type => !NO_WORK.has(kindOf(type));

export const FIELD_LABEL = {
  instances: 'Instances', concurrency: 'Requests at once (per instance)', queueLimit: 'Waiting line (per instance)',
  timeoutMs: 'Timeout (ms)', overheadMs: 'Added time (ms)', strategy: 'Strategy', hitP: 'Hit ratio (0 to 1)', pattern: 'Pattern',
  limitRps: 'Allowed requests per second', burst: 'Burst (extra requests at once)', capacity: 'Queue capacity (jobs)',
};
export const ENUM_LABEL = { round_robin: 'Round robin', least_conn: 'Least connections', cache_aside: 'Cache-aside', read_through: 'Read-through' };
export const KIND_NOTE = {
  pass: 'Adds a fixed time and has no capacity limit of its own.',
  limiter: 'A token bucket: a steady rate plus a burst allowance.',
  server: 'Instances × requests at once, a waiting line and a timeout.',
  queue: 'An asynchronous hand-off: the sender carries on and workers pick the jobs up.',
  source: 'Sends requests at the rate set under Traffic.',
};

export const clone = x => JSON.parse(JSON.stringify(x));

export function defaultConfig(type) {
  const t = TYPES[type], c = {};
  for (const [k, [d]] of Object.entries(t.config)) c[k] = d;
  for (const [k, v] of Object.entries(t.enums || {})) c[k] = v[0];
  return c;
}
export function defaultsOf(spec) { return Object.fromEntries(Object.entries(spec).map(([k, [d]]) => [k, d])); }

export function newDoc(title = 'Untitled design') {
  return {
    schema: SCHEMA, engine: ENGINE, id: 'd_' + Date.now().toString(36), title, seed: 42,
    nodes: [], edges: [], routes: [], faults: [], assumptions: [],
    workload: { pattern: 'constant', rateRps: 100, durationMs: 60000, warmupMs: 5000, arrivals: 'poisson' },
  };
}
function freeId(doc, base, start = 2) {
  const used = new Set([...doc.nodes, ...doc.edges].map(x => x.id));
  if (start === 2 && !used.has(base)) return base;
  for (let i = start; ; i++) if (!used.has(base + i)) return base + i;
}
export function addNode(doc, type, pos = { x: 0, y: 0 }) {
  if (!TYPES[type]) throw new Error('Unknown component type: ' + type);
  const n = { id: freeId(doc, type), type, label: TYPES[type].label, config: defaultConfig(type), pos };
  doc.nodes.push(n);
  return n;
}
export function addEdge(doc, from, to, kind) {
  if (doc.edges.some(e => e.from === from && e.to === to)) return null;
  kind = kind || (doc.nodes.find(n => n.id === to)?.type === 'queue' ? 'async' : 'sync');
  const e = { id: freeId(doc, 'e', 1), from, to, kind };
  doc.edges.push(e);
  return e;
}
export function removeNode(doc, id) {
  doc.nodes = doc.nodes.filter(n => n.id !== id);
  doc.edges = doc.edges.filter(e => e.from !== id && e.to !== id);
  doc.faults = (doc.faults || []).filter(f => f.node !== id);
}

export const svcMean = d => (d.dist === 'const' ? d.value : d.dist === 'exp' ? d.mean : (d.min + d.max) / 2);
export const expMs = mean => ({ dist: 'exp', mean });

/** Build one route from the graph, keeping work times and skips of `prev` where they still apply. */
export function deriveRoute(doc, prev) {
  const users = doc.nodes.find(n => n.type === 'traffic');
  if (!users) return null;
  const byId = new Map(doc.nodes.map(n => [n.id, n]));
  const out = id => doc.edges.filter(e => e.from === id && byId.has(e.to));
  const kept = new Map(), skips = new Set();
  (function scan(list) { for (const s of list || []) { if (s.serviceMs) kept.set(s.to ?? s.at, s.serviceMs); if (s.skip) skips.add(s.to); scan(s.calls); } })(prev?.steps);
  const svc = id => kept.get(id) || expMs(TYPES[byId.get(id).type].ms ?? 10);
  const works = id => doesWork(byId.get(id).type);
  function tree(id, seen) {
    const calls = [];
    for (const e of out(id)) {
      if (seen.has(e.to)) continue;
      const c = { to: e.to };
      if (works(e.to)) { c.op = 'call'; c.serviceMs = svc(e.to); }
      if (e.kind === 'async') c.async = true;
      if (skips.has(e.to)) c.skip = true;
      const sub = tree(e.to, new Set([...seen, e.to]));
      if (sub.length) c.calls = sub;
      calls.push(c);
    }
    return calls;
  }
  const steps = [], seen = new Set([users.id]);
  let cur = users.id;
  for (;;) {
    const o = out(cur);
    if (!o.length) break;
    if (o.length > 1) return null;
    const next = o[0].to, node = byId.get(next);
    if (seen.has(next)) return null;
    seen.add(next);
    const step = works(next) ? { at: next, serviceMs: svc(next) } : { at: next };
    steps.push(step);
    if (TYPES[node.type].front) { cur = next; continue; }
    const calls = tree(next, new Set(seen));
    if (calls.length) step.calls = calls;
    break;
  }
  return { id: prev?.id || 'main', label: prev?.label || 'Main request', share: prev?.share ?? 1, steps };
}
/** Rebuild every route after the graph changed. null = the entry path is ambiguous. */
export function deriveRoutes(doc) {
  if (!doc.routes.length) { const r = deriveRoute(doc); return r ? (r.steps.length ? [r] : []) : null; }
  const list = [];
  for (const prev of doc.routes) { const r = deriveRoute(doc, prev); if (!r) return null; if (r.steps.length) list.push(r); }
  return list;
}
export function addRoute(doc, label = 'Write') {
  const first = doc.routes[0];
  if (!first) return null;
  const ids = new Set(doc.routes.map(r => r.id));
  let i = 2;
  while (ids.has('r' + i)) i++;
  const r = clone(first);
  Object.assign(r, { id: 'r' + i, label });
  if (doc.routes.length === 1) { first.share = 0.9; r.share = 0.1; } else r.share = 0;
  doc.routes.push(r);
  return r;
}
const meanTime = c => (c.skip ? 0 : (c.serviceMs ? svcMean(c.serviceMs) : 0) + (c.calls || []).reduce((a, x) => a + (x.async ? 0 : meanTime(x)), 0));

/** Every route spec for a node that carries a work time. */
export function workSpecs(doc, id) {
  const out = [];
  doc.routes.forEach((r, ri) => {
    const find = list => { for (const s of list || []) { if ((s.at ?? s.to) === id && s.serviceMs) return s; const x = find(s.calls); if (x) return x; } return null; };
    const s = find(r.steps);
    if (s) out.push({ ri, spec: s });
  });
  return out;
}
function allWorkSpecs(doc, id) {
  const out = [];
  const walk = list => { for (const s of list || []) { if ((s.at ?? s.to) === id && s.serviceMs) out.push(s); walk(s.calls); } };
  for (const r of doc.routes) walk(r.steps);
  return out;
}
export function workTime(doc, id) { const s = allWorkSpecs(doc, id)[0]; return s ? svcMean(s.serviceMs) : null; }
export function setWorkTime(doc, id, ms) {
  const specs = allWorkSpecs(doc, id);
  if (!specs.length) return;
  const base = svcMean(specs[0].serviceMs) || 1;
  for (const s of specs) {
    const d = s.serviceMs, k = ms / base;
    s.serviceMs = d.dist === 'const' ? { dist: 'const', value: d.value * k } : d.dist === 'exp' ? { dist: 'exp', mean: d.mean * k } : { dist: 'uniform', min: d.min * k, max: d.max * k };
  }
}

// ---------------- validation ----------------
function checkNum(v, [, lo, hi, int], name, errs) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return errs.push(`${name} has to be a number`);
  if (v < lo || v > hi) errs.push(`${name} has to be from ${lo} to ${hi} (it is ${v})`);
  else if (int && !Number.isInteger(v)) errs.push(`${name} has to be a whole number`);
}
function checkDist(d, name, errs) {
  if (!d || typeof d !== 'object') return errs.push(`${name} is missing`);
  const keys = { const: ['value'], exp: ['mean'], uniform: ['min', 'max'] }[d.dist];
  if (!keys) return errs.push(`${name}: "${d.dist}" is not a known distribution`);
  for (const k of keys) checkNum(d[k], [0, 0, MAX_MS], `${name}.${k}`, errs);
  if (d.dist === 'uniform' && d.min > d.max) errs.push(`${name}: min is larger than max`);
}
export function nameOf(doc, n) {
  return n.label && doc.nodes.filter(x => x.label === n.label).length === 1 ? n.label : `${n.label || n.type} (${n.id})`;
}

export function validate(doc) {
  const errors = [], warnings = [];
  if (!doc || typeof doc !== 'object') return { errors: ['This is not a design'], warnings };
  const ver = String(doc.schema || '').split('/')[1];
  if (!String(doc.schema || '').startsWith('twinlabs.workbench/')) errors.push('Not a workbench design (schema field)');
  else if (ver !== '1') errors.push(`The design uses schema version ${ver}; this workbench reads version 1`);
  if (!Number.isInteger(doc.seed) || doc.seed < 0 || doc.seed > 4294967295) errors.push('seed has to be a whole number from 0 to 4294967295');
  const nodes = Array.isArray(doc.nodes) ? doc.nodes : [], edges = Array.isArray(doc.edges) ? doc.edges : [], routes = Array.isArray(doc.routes) ? doc.routes : [];
  if (nodes.length > LIMITS.nodes) errors.push(`No more than ${LIMITS.nodes} components`);
  if (edges.length > LIMITS.edges) errors.push(`No more than ${LIMITS.edges} connections`);
  if (routes.length > LIMITS.routes) errors.push(`No more than ${LIMITS.routes} request types`);
  const byId = new Map(), ids = new Set();
  for (const n of nodes) {
    if (!ID_RE.test(n.id || '')) errors.push(`"${n.id}" is not a valid component id`);
    if (ids.has(n.id)) errors.push(`The id "${n.id}" is used twice`);
    ids.add(n.id); byId.set(n.id, n);
    const t = TYPES[n.type];
    if (!t) { errors.push(`${n.id}: "${n.type}" is not a component type`); continue; }
    const c = n.config || {};
    for (const [k, spec] of Object.entries(t.config)) checkNum(c[k], spec, `${n.id}.${k}`, errors);
    for (const [k, vals] of Object.entries(t.enums || {})) if (!vals.includes(c[k])) errors.push(`${n.id}.${k} has to be one of ${vals.join(', ')}`);
  }
  const users = nodes.filter(n => n.type === 'traffic');
  if (users.length !== 1) errors.push('A design needs exactly one Users component');
  const links = new Set();
  for (const e of edges) {
    if (ids.has(e.id)) errors.push(`The id "${e.id}" is used twice`);
    ids.add(e.id);
    if (!byId.has(e.from) || !byId.has(e.to)) { errors.push(`Connection ${e.id} points at a component that does not exist`); continue; }
    if (e.from === e.to) errors.push(`Connection ${e.id} links ${e.from} to itself`);
    if (!['sync', 'async'].includes(e.kind)) errors.push(`Connection ${e.id}: kind has to be sync or async`);
    if (e.kind === 'async' && byId.get(e.to).type !== 'queue') errors.push(`Connection ${e.id}: only connections into a queue can be async`);
    if (e.kind === 'sync' && byId.get(e.to).type === 'queue') errors.push(`Connection ${e.id}: a connection into a queue has to be async (the sender does not wait)`);
    if (byId.get(e.to).type === 'traffic') errors.push(`Connection ${e.id}: nothing can send requests to Users`);
    if ((e.retry || e.breaker) && (e.kind === 'async' || kindOf(byId.get(e.from).type) === 'source')) errors.push(`Connection ${e.id}: retries and breakers only apply to calls the caller waits for`);
    if (e.retry) for (const [k, spec] of Object.entries(RETRY)) if (e.retry[k] !== undefined || k === 'max') checkNum(e.retry[k], spec, `Connection ${e.id} retry ${k}`, errors);
    if (e.breaker) {
      for (const [k, spec] of Object.entries(BREAKER)) checkNum(e.breaker[k], spec, `Connection ${e.id} breaker ${k}`, errors);
      if (e.breaker.minCalls > e.breaker.window) errors.push(`Connection ${e.id} breaker: minimum calls is larger than the window`);
    }
    links.add(e.from + '>' + e.to);
  }
  if (!routes.length) errors.push('No request types yet: connect Users to a component');
  let shareSum = 0;
  const used = new Set(users.map(n => n.id));
  const walkCalls = (where, from, calls, path) => {
    for (const c of calls || []) {
      const tn = byId.get(c.to);
      if (!tn) { errors.push(`${where}: ${from} calls "${c.to}", which does not exist`); continue; }
      if (!links.has(from + '>' + c.to)) errors.push(`${where}: there is no connection from ${from} to ${c.to}`);
      if (path.has(c.to)) { errors.push(`${where}: ${from} calls ${c.to}, which is already part of this request (a loop)`); continue; }
      if (doesWork(tn.type)) checkDist(c.serviceMs, `${where} ${c.to} work time`, errors);
      used.add(c.to);
      const ft = byId.get(from)?.config?.timeoutMs, tt = tn.config?.timeoutMs;
      if (!c.async && ft && tt && ft <= tt) warnings.push(`${from} gives up after ${ft} ms, before ${c.to} would (${tt} ms)`);
      if (tn.type === 'queue' && !(c.calls || []).length) warnings.push(`${where}: nobody takes jobs from queue ${c.to}`);
      walkCalls(where, c.to, c.calls, new Set([...path, c.to]));
    }
  };
  for (const r of routes) {
    shareSum += typeof r.share === 'number' ? r.share : NaN;
    const where = `Request "${r.label || r.id}"`;
    if (!Array.isArray(r.steps) || !r.steps.length) { errors.push(`${where} has no steps`); continue; }
    let prev = users[0]?.id;
    const path = new Set();
    for (const [i, st] of r.steps.entries()) {
      const n = byId.get(st.at);
      if (!n) { errors.push(`${where} step ${i + 1}: "${st.at}" does not exist`); break; }
      if (!links.has(prev + '>' + st.at)) errors.push(`${where}: there is no connection from ${prev} to ${st.at}`);
      used.add(st.at);
      if (doesWork(n.type)) checkDist(st.serviceMs, `${where} ${st.at} work time`, errors);
      else if (st.serviceMs) warnings.push(`${where}: ${TYPES[n.type].label} does no work, so its work time is ignored`);
      if (path.has(st.at)) errors.push(`${where}: visits ${st.at} twice (a loop)`);
      path.add(st.at);
      walkCalls(where, st.at, st.calls, new Set(path));
      prev = st.at;
    }
  }
  if (routes.length && Math.abs(shareSum - 1) > 0.001) errors.push(`The request shares add up to ${+shareSum.toFixed(3)} instead of 1`);
  for (const n of nodes) if (!used.has(n.id)) warnings.push(`${nameOf(doc, n)} is not used by any request`);
  const w = doc.workload || {};
  if (w.pattern !== 'constant') errors.push('The traffic pattern has to be "constant" in this version');
  if (!['poisson', 'uniform'].includes(w.arrivals)) errors.push('Arrivals have to be poisson or uniform');
  for (const [k, spec] of Object.entries(WORKLOAD)) checkNum(w[k], spec, `workload.${k}`, errors);
  if (w.warmupMs >= w.durationMs) errors.push('The warm-up has to be shorter than the run');
  const faults = doc.faults || [];
  if (faults.length > LIMITS.faults) errors.push(`No more than ${LIMITS.faults} faults`);
  for (const [i, f] of faults.entries()) {
    const n = byId.get(f.node), name = `Fault ${i + 1}`;
    if (!n) errors.push(`${name}: "${f.node}" does not exist`);
    if (!FAULT_KINDS.includes(f.kind)) errors.push(`${name}: kind has to be ${FAULT_KINDS.join(', ')}`);
    else if (n && f.kind === 'burst' && n.type !== 'traffic') errors.push(`${name}: a traffic burst belongs on Users`);
    else if (n && f.kind !== 'burst' && n.type === 'traffic') errors.push(`${name}: Users cannot go down or slow; use a traffic burst`);
    if (typeof f.at === 'number' && typeof f.until === 'number' && f.at >= 0 && f.until > f.at) { if (typeof w.durationMs === 'number' && f.at >= w.durationMs) warnings.push(`${name} starts after the run is over`); }
    else errors.push(`${name}: needs 0 ≤ start < end`);
    if ((f.kind === 'slow' || f.kind === 'burst') && !(typeof f.factor === 'number' && f.factor >= 1 && f.factor <= 100)) errors.push(`${name}: factor has to be from 1 to 100`);
  }
  for (const n of nodes) if (n.type === 'cache') {
    const hasOut = edges.some(e => e.from === n.id);
    if (n.config?.pattern === 'read_through' && !hasOut) warnings.push(`${nameOf(doc, n)} is read-through but has no database to load misses from`);
    if (n.config?.pattern === 'cache_aside' && hasOut) warnings.push(`${nameOf(doc, n)} is cache-aside, so its own connections run only when the caller misses; did you want read-through?`);
  }
  if (!errors.length) {
    // rough offered load per component: rate × mean busy time ÷ slots
    const busy = new Map(), add = (id, v) => busy.set(id, (busy.get(id) || 0) + v);
    const hitOf = id => (typeof byId.get(id)?.config?.hitP === 'number' ? byId.get(id).config.hitP : 0);
    const rt = id => byId.get(id)?.type === 'cache' && byId.get(id).config.pattern === 'read_through';
    const walk = (calls, f) => { for (const c of calls || []) { if (c.skip) continue; add(c.to, f * meanTime(c)); walk(c.calls, rt(c.to) ? f * (1 - hitOf(c.to)) : f); if (!rt(c.to)) f *= 1 - hitOf(c.to); } };
    for (const r of routes) { let f = r.share; for (const st of r.steps) { add(st.at, f * meanTime(st)); walk(st.calls, rt(st.at) ? f * (1 - hitOf(st.at)) : f); f *= 1 - hitOf(st.at); } }
    for (const n of nodes) {
      const c = n.config || {}, slots = (c.instances || 1) * (c.concurrency || 0);
      if (!slots || !busy.get(n.id)) continue;
      const load = (w.rateRps * busy.get(n.id)) / 1000 / slots;
      if (load > 1) warnings.push(`${nameOf(doc, n)} is offered ${Math.round(load * 100)}% of what it can handle: expect waiting and errors`);
    }
  }
  return { errors, warnings };
}

// ---------------- random numbers ----------------
export function hash32(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const stream = (seed, name) => rng((seed ^ hash32(name)) >>> 0);
const draw = (d, r) => (d.dist === 'const' ? d.value : d.dist === 'exp' ? -d.mean * Math.log(1 - r()) : d.min + r() * (d.max - d.min));
const quantile = (sorted, q) => (sorted.length ? sorted[Math.max(0, Math.ceil(q * sorted.length) - 1)] : null);

class Heap {
  constructor() { this.a = []; this.seq = 0; }
  get size() { return this.a.length; }
  peek() { return this.a[0]; }
  less(x, y) { return x.t < y.t || (x.t === y.t && x.s < y.s); }
  push(t, fn) {
    const a = this.a, item = { t, s: this.seq++, fn };
    let i = a.push(item) - 1;
    while (i > 0) { const p = (i - 1) >> 1; if (!this.less(item, a[p])) break; a[i] = a[p]; i = p; }
    a[i] = item;
  }
  pop() {
    const a = this.a, top = a[0], last = a.pop();
    if (a.length) {
      let i = 0;
      for (;;) {
        const l = 2 * i + 1, r = l + 1;
        let m = i, mv = last;
        if (l < a.length && this.less(a[l], mv)) { m = l; mv = a[l]; }
        if (r < a.length && this.less(a[r], mv)) { m = r; mv = a[r]; }
        if (m === i) break;
        a[i] = a[m]; i = m;
      }
      a[i] = last;
    }
    return top;
  }
}

// ---------------- simulation ----------------
const MAX_EVENTS = 2e6;
const BIN = 1000;

export function simulate(doc, { maxEvents = MAX_EVENTS, trace = true } = {}) {
  const v = validate(doc);
  if (v.errors.length) return { ok: false, errors: v.errors, warnings: v.warnings };
  const W = doc.workload, dur = W.durationMs, warm = W.warmupMs, win = dur - warm;
  const measured = t => t >= warm && t <= dur;
  const ev = new Heap();
  const nBins = Math.ceil(dur / BIN);
  const binOf = t => Math.min(nBins - 1, Math.floor(t / BIN));
  const bins = Array.from({ length: nBins }, () => ({ offered: 0, completed: 0, errors: 0, ek: {}, lat: [] }));
  const order = doc.nodes.map(n => n.id);
  const S = new Map();
  const faults = doc.faults || [];
  for (const n of doc.nodes) {
    const c = n.config || {}, kind = TYPES[n.type].kind;
    const count = kind === 'server' ? c.instances || 1 : 0;
    S.set(n.id, {
      n, c, kind, idx: order.indexOf(n.id), rr: 0, starts: 0, arrived: 0, done: 0, errors: 0, hits: 0,
      slots: c.concurrency || 1, queueLimit: c.queueLimit ?? 0, timeoutMs: c.timeoutMs || 0,
      hitP: typeof c.hitP === 'number' ? c.hitP : null, readThrough: n.type === 'cache' && c.pattern === 'read_through',
      tokens: c.burst || 0, tokAt: 0, rWork: stream(doc.seed, 'work:' + n.id), rHit: stream(doc.seed, 'hit:' + n.id),
      faults: faults.filter(f => f.node === n.id),
      inst: Array.from({ length: count }, () => ({ busy: 0, line: [], last: 0, busyMs: 0, lineMs: 0, lineMax: 0, tlBusy: new Float64Array(nBins), tlLine: new Float64Array(nBins) })),
    });
  }
  const faultOn = (st, kind, t) => st.faults.find(f => f.kind === kind && t >= f.at && t < f.until);
  const policies = new Map();
  for (const e of doc.edges) if (e.retry || e.breaker) policies.set(e.from + '>' + e.to, {
    e, retry: e.retry ? { budgetP: 0.2, backoffMs: 0, ...e.retry } : null, breaker: e.breaker || null,
    first: 0, retries: 0, firstAll: 0, retriesAll: 0, denied: 0, fast: 0, opened: 0, state: 'closed', openUntil: 0, trial: false, win: [],
  });

  function account(inst, t) {
    const from = inst.last;
    if (t > from) {
      const a = Math.max(from, warm), b = Math.min(t, dur);
      if (b > a) { inst.busyMs += inst.busy * (b - a); inst.lineMs += inst.line.length * (b - a); }
      if (inst.busy || inst.line.length) {
        for (let k = binOf(from); k <= binOf(Math.min(t, dur)); k++) {
          const x = Math.max(from, k * BIN), y = Math.min(t, (k + 1) * BIN, dur);
          if (y > x) { inst.tlBusy[k] += inst.busy * (y - x); inst.tlLine[k] += inst.line.length * (y - x); }
        }
      }
    }
    inst.last = t;
  }

  const zeroErr = () => Object.fromEntries(ERROR_KINDS.map(k => [k, 0]));
  const tot = { offered: 0, completed: 0, errors: zeroErr(), errorAt: {}, lat: [], wastedMs: 0 };
  const jobs = { enqueued: 0, completed: 0, errors: zeroErr(), lat: [] };
  const live = new Set();
  const r2 = x => Math.round(x * 100) / 100;

  function finish(req, t, err, at) {
    if (req.done) return;
    req.done = true;
    if (req.trace) { req.trace.e = r2(t); req.trace.k = err || ''; }
    if (req.job) { if (!measured(t)) return; if (err) jobs.errors[err]++; else { jobs.completed++; jobs.lat.push(t - req.born); } return; }
    live.delete(req);
    const b = bins[binOf(t)];
    if (err) { b.errors++; b.ek[err] = (b.ek[err] || 0) + 1; if (measured(t)) { tot.errors[err]++; tot.errorAt[at] = (tot.errorAt[at] || 0) + 1; } }
    else { const lat = t - req.born; b.completed++; b.lat.push(lat); if (measured(t)) { tot.completed++; tot.lat.push(lat); } }
  }
  const fail = (st, t, cb, kind) => { if (measured(t)) st.errors++; return cb(t, kind, st.n.id); };
  const ok = (st, t, cb, skipRest) => { if (measured(t)) st.done++; return cb(t, null, null, skipRest); };

  function pickInstance(st, strategy) {
    const n = st.inst.length;
    if (strategy === 'least_conn') { let best = 0, load = Infinity; for (let i = 0; i < n; i++) { const l = st.inst[i].busy + st.inst[i].line.length; if (l < load) { load = l; best = i; } } return best; }
    return st.rr++ % n;
  }

  // visit with optional trace record [nodeIdx, start, end, flag(0 ok,1 short-circuit hit,2 failed here)]
  function visit(t, st, spec, req, cb, strategy, opts) {
    if (!req.trace) return visitRaw(t, st, spec, req, cb, strategy, opts);
    const rec = [st.idx, r2(t), -1, 0];
    req.trace.v.push(rec);
    visitRaw(t, st, spec, req, (te, err, at, skip) => {
      if (rec[2] < 0) { rec[2] = r2(te); rec[3] = err && at === st.n.id ? 2 : skip ? 1 : 0; }
      cb(te, err, at, skip);
    }, strategy, opts);
  }
  function visitRaw(t, st, spec, req, cb, strategy, opts = {}) {
    if (measured(t)) st.arrived++;
    if (faultOn(st, 'down', t)) return fail(st, t, cb, 'down');
    if (st.kind === 'pass') {
      const go = tt => runCalls(tt, spec.calls, req, st.c.strategy, () => true, (te, err, at) => (err ? cb(te, err, at) : ok(st, te, cb)), st.n.id);
      return st.c.overheadMs > 0 ? ev.push(t + st.c.overheadMs, go) : go(t);
    }
    if (st.kind === 'limiter') {
      st.tokens = Math.min(st.c.burst, st.tokens + ((t - st.tokAt) * st.c.limitRps) / 1000);
      st.tokAt = t;
      if (st.tokens < 1) return fail(st, t, cb, 'limited');
      st.tokens -= 1;
      return runCalls(t, spec.calls, req, undefined, () => true, (te, err, at) => (err ? cb(te, err, at) : ok(st, te, cb)), st.n.id);
    }
    if (st.kind === 'queue') return cb(t, null);
    enqueue(t, st, pickInstance(st, strategy), req, spec, cb, opts.queueLimit ?? st.queueLimit);
  }
  function enqueue(t, st, i, req, spec, cb, limit) {
    const inst = st.inst[i];
    const job = { st, inst, req, spec, cb, state: 'new', dur: 0 };
    if (inst.busy < st.slots) start(t, job);
    else if (inst.line.length < limit) {
      account(inst, t);
      inst.line.push(job); job.state = 'queued';
      if (inst.line.length > inst.lineMax && measured(t)) inst.lineMax = inst.line.length;
    } else return fail(st, t, cb, 'rejected');
    if (st.timeoutMs) ev.push(t + st.timeoutMs, tt => {
      if (job.state === 'queued') { account(inst, tt); inst.line.splice(inst.line.indexOf(job), 1); }
      else if (job.state === 'busy') release(tt, job);
      else return;
      job.state = 'failed';
      fail(st, tt, cb, 'timeout');
    });
  }
  function start(t, job) {
    const { st, inst } = job;
    account(inst, t); inst.busy++; job.state = 'busy';
    if (measured(t)) st.starts++;
    const slow = faultOn(st, 'slow', t);
    job.dur = draw(job.spec.serviceMs, st.rWork) * (slow ? slow.factor : 1);
    ev.push(t + job.dur, tt => {
      if (job.req.done) tot.wastedMs += job.dur;
      if (job.state === 'failed') return;
      const hit = st.hitP !== null && st.rHit() < st.hitP;
      if (hit && measured(tt)) st.hits++;
      const end = (te, err, at) => {
        if (job.state !== 'busy') return;
        release(te, job);
        job.state = err ? 'failed' : 'done';
        if (err) return job.cb(te, err, at);
        ok(st, te, job.cb, hit && !st.readThrough);
      };
      if (hit || job.req.done) return end(tt, null);
      runCalls(tt, job.spec.calls, job.req, undefined, () => job.state === 'busy', end, st.n.id);
    });
  }
  function release(t, job) {
    const inst = job.inst;
    account(inst, t); inst.busy--;
    if (inst.line.length) start(t, inst.line.shift());
  }
  function runCalls(t, calls, req, strategy, alive, cb, fromId) {
    const list = calls || [];
    const next = (tt, i) => {
      if (!alive()) return;
      if (i >= list.length || req.done) return cb(tt, null);
      const c = list[i], tgt = S.get(c.to);
      if (c.skip) return next(tt, i + 1);
      if (c.async || tgt.kind === 'queue') { const bad = handOff(tt, tgt, c); return bad ? cb(tt, bad.kind, bad.at) : next(tt, i + 1); }
      const pol = policies.get(fromId + '>' + c.to);
      if (!pol) return visit(tt, tgt, c, req, (te, err, at, skip) => { if (!alive()) return; if (err) return cb(te, err, at); next(te, skip ? list.length : i + 1); }, strategy);
      const attempt = (ta, n) => {
        if (!alive() || req.done) return;
        if (pol.breaker && !breakerAllows(pol, ta)) { if (measured(ta)) pol.fast++; return cb(ta, 'breaker', c.to); }
        if (n === 0) { pol.firstAll++; if (measured(ta)) pol.first++; } else { pol.retriesAll++; if (measured(ta)) pol.retries++; }
        visit(ta, tgt, c, req, (te, err, at, skip) => {
          if (pol.breaker) breakerRecord(pol, te, !err);
          if (!alive()) return;
          if (!err) return next(te, skip ? list.length : i + 1);
          const R = pol.retry;
          if (R && n < R.max) {
            if (pol.retriesAll < R.budgetP * pol.firstAll + 10) {
              const wait = R.backoffMs * 2 ** n;
              return wait > 0 ? ev.push(te + wait, tw => attempt(tw, n + 1)) : attempt(te, n + 1);
            }
            if (measured(te)) pol.denied++;
          }
          cb(te, err, at);
        }, strategy);
      };
      attempt(tt, 0);
    };
    next(t, 0);
  }
  function breakerAllows(p, t) {
    if (p.state === 'open') { if (t < p.openUntil) return false; p.state = 'half'; p.trial = false; }
    if (p.state === 'half') { if (p.trial) return false; p.trial = true; }
    return true;
  }
  function breakerRecord(p, t, success) {
    const B = p.breaker;
    if (p.state === 'half') {
      if (success) { p.state = 'closed'; p.win = []; } else { p.state = 'open'; p.openUntil = t + B.openMs; if (measured(t)) p.opened++; }
      p.trial = false;
      return;
    }
    if (p.state !== 'closed') return;
    p.win.push(success);
    if (p.win.length > B.window) p.win.shift();
    const bad = p.win.filter(x => !x).length;
    if (p.win.length >= B.minCalls && bad / p.win.length >= B.errorP) { p.state = 'open'; p.openUntil = t + B.openMs; p.win = []; if (measured(t)) p.opened++; }
  }
  function handOff(t, q, spec) {
    if (measured(t)) q.arrived++;
    if (faultOn(q, 'down', t)) { if (measured(t)) q.errors++; return { kind: 'down', at: q.n.id }; }
    for (const c of spec.calls || []) {
      const tgt = S.get(c.to), job = { born: t, done: false, job: true };
      let sync = true, early = null;
      const cb = (te, err, at) => { if (sync && err) { early = { kind: err, at }; return; } finish(job, te, err, at); };
      if (tgt.kind === 'server') visit(t, tgt, c, job, cb, undefined, { queueLimit: Math.ceil(q.c.capacity / tgt.inst.length) });
      else visit(t, tgt, c, job, cb);
      sync = false;
      if (early) { if (measured(t)) q.errors++; return { kind: early.kind, at: early.kind === 'rejected' ? q.n.id : early.at }; }
      if (measured(t)) jobs.enqueued++;
    }
    if (measured(t)) q.done++;
    return null;
  }
  function stepRequest(t, req, i, strategy) {
    const steps = req.route.steps;
    if (i >= steps.length) return finish(req, t, null);
    const st = S.get(steps[i].at);
    visit(t, st, steps[i], req, (te, err, at, skip) => {
      if (req.done) return;
      if (err) finish(req, te, err, at);
      else if (skip) finish(req, te, null);
      else stepRequest(te, req, i + 1, st.kind === 'pass' ? st.c.strategy : undefined);
    }, strategy);
  }

  const rArr = stream(doc.seed, 'arrivals'), rRoute = stream(doc.seed, 'route');
  const gap = 1000 / W.rateRps;
  const routes = doc.routes;
  const bursts = faults.filter(f => f.kind === 'burst');
  const expected = ((W.rateRps * dur) / 1000) * bursts.reduce((a, f) => a * f.factor, 1);
  const every = Math.max(1, Math.ceil(expected / 20000));
  const traces = [];
  let count = 0;
  const burstAt = t => bursts.reduce((a, f) => (t >= f.at && t < f.until ? a * f.factor : a), 1);
  function arrive(t) {
    const x = rRoute();
    let acc = 0, route = routes[routes.length - 1];
    for (const r of routes) { acc += r.share; if (x < acc) { route = r; break; } }
    const req = { route, born: t, done: false, trace: null };
    if (trace && count++ % every === 0) { req.trace = { b: r2(t), e: -1, k: null, r: routes.indexOf(route), v: [] }; traces.push(req.trace); }
    live.add(req);
    bins[binOf(t)].offered++;
    if (t >= warm) tot.offered++;
    const g = gap / burstAt(t);
    const nt = t + (W.arrivals === 'uniform' ? g : -g * Math.log(1 - rArr()));
    if (nt < dur) ev.push(nt, arrive);
    stepRequest(t, req, 0);
  }
  ev.push(W.arrivals === 'uniform' ? 0 : -gap * Math.log(1 - rArr()), arrive);
  let events = 0, stopped = null;
  while (ev.size && ev.peek().t <= dur) {
    if (++events > maxEvents) { stopped = `Stopped after ${maxEvents.toLocaleString('en')} events: make the run shorter or the rate lower`; break; }
    const e = ev.pop();
    e.fn(e.t);
  }
  const endT = stopped ? ev.peek()?.t ?? dur : dur;
  const secs = win / 1000;
  const sumErr = e => ERROR_KINDS.reduce((a, k) => a + e[k], 0);
  const errTotal = sumErr(tot.errors);
  tot.lat.sort((a, b) => a - b); jobs.lat.sort((a, b) => a - b);
  const nodes = {};
  for (const [id, st] of S) {
    if (st.kind === 'source') continue;
    for (const inst of st.inst) account(inst, endT);
    const slots = st.slots * st.inst.length;
    nodes[id] = {
      type: st.n.type, kind: st.kind, slots: st.kind === 'server' ? slots : 0,
      arrivedRps: st.arrived / secs, doneRps: st.done / secs, errors: st.errors,
      hitRate: st.hitP === null ? null : st.starts ? st.hits / st.starts : 0,
      util: st.kind === 'server' ? st.inst.reduce((a, x) => a + x.busyMs, 0) / (slots * win) : null,
      instUtil: st.inst.map(x => x.busyMs / (st.slots * win)),
      queueMean: st.inst.reduce((a, x) => a + x.lineMs, 0) / win,
      queueMax: st.inst.reduce((a, x) => a + x.lineMax, 0),
      startsRps: st.starts / secs,
    };
  }
  const timeline = bins.map((b, k) => {
    b.lat.sort((x, y) => x - y);
    const span = Math.min(BIN, dur - k * BIN), util = {}, queue = {};
    for (const [id, st] of S) if (st.kind === 'server') {
      util[id] = st.inst.reduce((a, x) => a + x.tlBusy[k], 0) / (st.slots * st.inst.length * span);
      queue[id] = st.inst.reduce((a, x) => a + x.tlLine[k], 0) / span;
    }
    return { t: k * BIN, span, offered: b.offered, completed: b.completed, errors: b.errors, errorKinds: b.ek, p95Ms: quantile(b.lat, 0.95), util, queue };
  });
  const edges = {};
  for (const p of policies.values()) edges[p.e.id] = {
    from: p.e.from, to: p.e.to, firstRps: p.first / secs, retryRps: p.retries / secs,
    amplification: p.first ? (p.first + p.retries) / p.first : 1, deniedByBudget: p.denied,
    fastFailRps: p.fast / secs, opened: p.opened, endState: p.state,
  };
  const jobErr = sumErr(jobs.errors);
  return {
    ok: true, warnings: v.warnings, engine: ENGINE, seed: doc.seed, label: 'modeled',
    faults: clone(faults), workload: { ...W }, windowMs: win, events, stopped,
    offered: tot.offered, offeredRps: tot.offered / secs, completed: tot.completed, completedRps: tot.completed / secs,
    errors: { ...tot.errors, total: errTotal }, errorAt: tot.errorAt,
    errorRate: tot.completed + errTotal ? errTotal / (tot.completed + errTotal) : 0,
    inFlight: live.size, wastedMs: tot.wastedMs,
    meanMs: tot.lat.length ? tot.lat.reduce((a, b) => a + b, 0) / tot.lat.length : null,
    p50Ms: quantile(tot.lat, 0.5), p95Ms: quantile(tot.lat, 0.95), p99Ms: quantile(tot.lat, 0.99),
    jobs: jobs.enqueued ? { enqueued: jobs.enqueued, completed: jobs.completed, errors: { ...jobs.errors, total: jobErr }, completedRps: jobs.completed / secs, p95Ms: quantile(jobs.lat, 0.95) } : null,
    nodes, edges, timeline, replay: { every, nodes: order, traces },
  };
}

// ---------------- several seeds, sweeps, calibration ----------------
export const SEEDS = 3;
export const seedsFrom = seed => Array.from({ length: SEEDS }, (_, i) => (seed + i) >>> 0);
export const stats = arr => { const x = arr.filter(v => v !== null && Number.isFinite(v)); return x.length ? { mean: x.reduce((a, b) => a + b, 0) / x.length, min: Math.min(...x), max: Math.max(...x), n: x.length } : null; };
export function summarize(runs) {
  return {
    seeds: runs.map(r => r.seed), completedRps: stats(runs.map(r => r.completedRps)), errorRate: stats(runs.map(r => r.errorRate)),
    p95Ms: stats(runs.map(r => r.p95Ms)), p99Ms: stats(runs.map(r => r.p99Ms)), jobsRps: stats(runs.map(r => (r.jobs ? r.jobs.completedRps : null))),
  };
}

/** Settings a "what if" sweep can vary. */
export function sweepParams(doc) {
  const out = [{ key: 'rate', label: 'Requests per second', now: doc.workload.rateRps, min: 0.1, max: 100000 }];
  for (const n of doc.nodes) {
    const c = n.config || {}, spec = TYPES[n.type]?.config || {};
    if ('instances' in spec) out.push({ key: `instances:${n.id}`, label: `${n.label}: instances`, now: c.instances, min: 1, max: 50, int: true });
    if ('concurrency' in spec) out.push({ key: `concurrency:${n.id}`, label: `${n.label}: requests at once`, now: c.concurrency, min: 1, max: 1000, int: true });
    if ('hitP' in spec) out.push({ key: `hitP:${n.id}`, label: `${n.label}: hit ratio %`, now: Math.round(c.hitP * 100), min: 0, max: 100 });
    const wt = workTime(doc, n.id);
    if (wt !== null) out.push({ key: `work:${n.id}`, label: `${n.label}: work time ms`, now: +wt.toFixed(2), min: 0.01, max: 60000 });
  }
  return out;
}
export function sweepValues(from, to, steps, int) {
  const n = Math.max(2, Math.min(9, steps)), out = [];
  for (let i = 0; i < n; i++) { const v = from + ((to - from) * i) / (n - 1); out.push(int ? Math.round(v) : +v.toPrecision(4)); }
  return [...new Set(out)];
}
function applyParam(doc, key, value) {
  const [what, id] = key.split(':'), n = doc.nodes.find(x => x.id === id);
  if (what === 'rate') doc.workload.rateRps = value;
  else if (what === 'instances' || what === 'concurrency') n.config[what] = Math.round(value);
  else if (what === 'hitP') n.config.hitP = Math.max(0, Math.min(1, value / 100));
  else if (what === 'work') setWorkTime(doc, id, value);
}
export function sweep(doc, key, values, { onStep } = {}) {
  const points = [];
  let k = 0;
  for (const value of values) {
    const runs = seedsFrom(doc.seed).map(seed => { const d = clone(doc); d.seed = seed; applyParam(d, key, value); onStep?.(++k, values.length * SEEDS); return simulate(d, { trace: false }); });
    if (runs.some(r => !r.ok)) { points.push({ value, error: runs.find(r => !r.ok).errors[0] }); continue; }
    points.push({ value, ...summarize(runs) });
  }
  const good = points.filter(p => !p.error);
  const best = Math.min(...good.map(p => p.p95Ms?.mean ?? Infinity));
  const slow = p => p.p95Ms && p.p95Ms.mean > 2 * best, failing = p => p.errorRate.mean > 0.01;
  const val = p => (p ? p.value : null);
  return { key, points, slowsAt: val(good.find(slow)), failsAt: val(good.find(failing)), healthyAt: val([...good].reverse().find(p => !slow(p) && !failing(p))) };
}

export const CAL_RUN = { durationMs: 30000, warmupMs: 5000 };
function calRun(doc, period, seed = doc.seed) {
  const d = clone(doc);
  Object.assign(d.workload, { rateRps: period.rateRps, ...CAL_RUN });
  d.faults = []; d.seed = seed;
  const r = simulate(d, { trace: false });
  if (!r.ok) return null;
  const util = {};
  for (const [id, n] of Object.entries(r.nodes)) if (n.util !== null) util[id] = n.util;
  return { completedRps: r.completedRps, p50Ms: r.p50Ms, p95Ms: r.p95Ms, errorRate: r.errorRate, util };
}
function residuals(model, meas) {
  const rows = [];
  const rel = (name, m, x) => { if (typeof x === 'number' && x > 0 && typeof m === 'number') rows.push({ name, measured: x, model: m, err: (m - x) / x, kind: 'rel' }); };
  const abs = (name, m, x) => { if (typeof x === 'number' && typeof m === 'number') rows.push({ name, measured: x, model: m, err: m - x, kind: 'abs' }); };
  rel('completedRps', model.completedRps, meas.completedRps);
  rel('p50Ms', model.p50Ms, meas.p50Ms);
  rel('p95Ms', model.p95Ms, meas.p95Ms);
  abs('errorRate', model.errorRate, meas.errorRate);
  for (const [id, x] of Object.entries(meas.util || {})) (x >= 0.02 ? rel : abs)('util.' + id, model.util[id], x);
  return rows;
}
const meanSq = rows => (rows.length ? rows.reduce((a, r) => a + r.err * r.err, 0) / rows.length : Infinity);
/** Fit work times so the model matches period 1; optionally check the result on period 2. */
export function calibrate(doc, period, ids, check, { rounds = 6, onStep } = {}) {
  const base = clone(doc);
  const start = Object.fromEntries(ids.map(id => [id, workTime(base, id)]));
  const cur = { ...start };
  const score = vals => { const d = clone(base); for (const id of ids) setWorkTime(d, id, vals[id]); const m = calRun(d, period); return m ? meanSq(residuals(m, period.measured)) : Infinity; };
  let best = score(cur), step = 1, runs = 1;
  const total = rounds * ids.length * 4 + 1;
  for (let r = 0; r < rounds; r++) {
    for (const id of ids) for (const dir of [1, -1, 0.5, -0.5]) {
      const cand = { ...cur, [id]: Math.min(60000, Math.max(0.01, cur[id] * Math.exp(dir * step))) };
      const s = score(cand);
      runs++; onStep?.(runs, total);
      if (s < best) { best = s; Object.assign(cur, cand); }
    }
    step *= 0.5;
  }
  const fitted = clone(base);
  for (const id of ids) setWorkTime(fitted, id, cur[id]);
  const rows = residuals(calRun(fitted, period) || {}, period.measured);
  const fit = { values: cur, start, rows, rms: Math.sqrt(meanSq(rows)), runs };
  let chk = null;
  if (check) { const m = calRun(fitted, check); const cr = m ? residuals(m, check.measured) : []; chk = { win: check, rows: cr, rms: Math.sqrt(meanSq(cr)) }; }
  return { fit, check: chk };
}

// ---------------- reading results ----------------
const FULL = 0.9;
function callGraph(doc) {
  const g = new Map();
  const walk = (from, calls) => { for (const c of calls || []) { if (c.skip) continue; (g.get(from) || g.set(from, new Set()).get(from)).add(c.to); walk(c.to, c.calls); } };
  for (const r of doc.routes) for (const st of r.steps) walk(st.at, st.calls);
  const below = (id, acc = new Set()) => { for (const x of g.get(id) || []) if (!acc.has(x)) { acc.add(x); below(x, acc); } return acc; };
  return below;
}
const pctTxt = x => Math.round(x * 100) + '%';

/** Suggestions with the evidence behind each one. */
export function advise(doc, res) {
  if (!res || !res.ok) return [];
  const tips = [], has = t => doc.nodes.some(n => n.type === t), node = id => doc.nodes.find(n => n.id === id), name = id => node(id)?.label || id;
  const secs = res.windowMs / 1000, offered = Math.max(res.offered, 1), errAt = id => res.errorAt[id] || 0;
  const perSec = n => { const v = n / secs; return v >= 10 ? Math.round(v) : +v.toFixed(1); };
  const below = callGraph(doc);
  const hot = Object.entries(res.nodes).filter(([id, n]) => n.util !== null && (n.util >= FULL || errAt(id) / offered > 0.01) && n.kind === 'server').map(([id]) => id);
  const roots = hot.filter(id => ![...below(id)].some(x => hot.includes(x)));
  for (const id of roots) {
    const r = res.nodes[id], n = node(id), type = n.type;
    const evidence = `${name(id)} is busy ${pctTxt(r.util)} of the time` + (errAt(id) ? `, and ${perSec(errAt(id))} errors/s begin there` : '');
    const waiting = hot.filter(x => x !== id && below(x).has(id));
    const also = waiting.length ? ` ${waiting.map(name).join(', ')} ${waiting.length > 1 ? 'look' : 'looks'} full only because ${waiting.length > 1 ? 'they wait' : 'it waits'} on it, so fix ${name(id)} first.` : '';
    let text;
    if (type === 'db') text = has('cache') ? 'Raise the cache hit ratio or give the database more connections (requests at once).' : 'Put a cache-aside cache in front of the database so repeated reads never reach it.';
    else if (type === 'external') text = has('queue') ? 'Move this call behind the queue you already have, so users do not wait for it.' : 'Add a queue and a worker for this call so users stop waiting on the third party.';
    else if (type === 'worker') text = `Run more worker instances (there are ${n.config.instances}) or make each job quicker.`;
    else if (n.config.instances !== undefined && n.config.instances < 50) text = `Give ${name(id)} more instances (it has ${n.config.instances})` + (type === 'app' && !has('lb') ? ' and put a load balancer in front of it' : '') + '.';
    else text = `Let ${name(id)} handle more requests at once, or cut its work time.`;
    tips.push({ evidence, text: text + also });
  }
  for (const [id, n] of Object.entries(res.nodes)) {
    if (n.kind === 'limiter' && n.errors) {
      const calm = Object.values(res.nodes).filter(x => x.util !== null).every(x => x.util < 0.7);
      tips.push({ evidence: `${name(id)} refuses ${perSec(n.errors)} requests/s`, text: calm ? 'Everything behind it is under 70% busy, so the limit could go up.' : 'What sits behind it is busy, so the limiter is doing its job of protecting it.' });
    }
    if (n.kind === 'queue' && n.errors) tips.push({ evidence: `${name(id)} is full and refuses ${perSec(n.errors)} jobs/s`, text: 'Add worker instances or make the queue bigger.' });
  }
  for (const e of Object.values(res.edges || {})) if (e.amplification > 1.2) {
    tips.unshift({ evidence: `Retries multiply the calls from ${name(e.from)} to ${name(e.to)} by ${e.amplification.toFixed(2)}×`,
      text: `Every retry piles more work onto ${name(e.to)} while it is already struggling: allow fewer retries, wait before retrying and keep a small retry budget, then compare` +
        (doc.edges.some(x => x.from === e.from && x.to === e.to && x.breaker) ? '.' : '. A circuit breaker is another option, but measure it: it can also fail requests that would have worked.') });
  }
  if (res.errors.timeout && !roots.length) tips.push({ evidence: `${perSec(res.errors.timeout)} timeouts/s`, text: 'A caller gives up before the component it waits for answers: lengthen that timeout or make the slow component faster.' });
  if (!tips.length) {
    const busiest = Object.entries(res.nodes).filter(([, n]) => n.util !== null).sort((a, b) => b[1].util - a[1].util)[0];
    tips.push({ evidence: busiest ? `The busiest component is ${name(busiest[0])} at ${pctTxt(busiest[1].util)}` : 'No errors', text: 'Nothing is a bottleneck at this load. Raise the requests per second to find where the design breaks.' });
  }
  return tips;
}

/** A short story of the run: faults, their effects, the causes and recovery. */
export function story(doc, res) {
  if (!res || !res.ok || !res.timeline.length) return [];
  const tl = res.timeline, out = [], warm = res.workload?.warmupMs ?? 0, dur = res.workload?.durationMs ?? tl.length * 1000;
  const name = id => doc.nodes.find(n => n.id === id)?.label || id;
  const sec = x => +(x / 1000).toFixed(1);
  const perS = b => v => (v * 1000) / b.span;
  const binAt = t => Math.min(tl.length - 1, Math.max(0, Math.floor(t / 1000)));
  const servers = Object.keys(tl[0].util);
  const below = callGraph(doc);
  const avg = (a, b, f) => { const x = tl.slice(a, b); return x.length ? x.reduce((s, y) => s + f(y), 0) / x.length : null; };
  const median = arr => { const x = arr.filter(v => v !== null).sort((a, b) => a - b); return x.length ? x[Math.floor(x.length / 2)] : null; };
  const errPerS = b => perS(b)(b.errors);
  const kindsIn = (a, b) => { const acc = {}; for (const x of tl.slice(a, b)) for (const [k, v] of Object.entries(x.errorKinds || {})) acc[k] = (acc[k] || 0) + v; return acc; };
  const FULLQ = 0.95;
  function causes(a, b) {
    const list = [];
    for (const id of servers) {
      const i = tl.slice(a, b).findIndex(x => x.util[id] >= FULLQ);
      if (i < 0) continue;
      const k = a + i, q0 = tl[k].queue[id], qmax = Math.max(...tl.slice(k, b).map(x => x.queue[id]));
      list.push({ t: tl[k].t, id, text: `${name(id)} is full (busy ${Math.round(tl[k].util[id] * 100)}%): more work arrives than it can finish` + (qmax > q0 + 1 ? `, and its waiting line grows from ${Math.round(q0)} to ${Math.round(qmax)}` : '') });
    }
    list.sort((x, y) => x.t - y.t);
    for (const c of list) { const waits = list.filter(o => o !== c && below(c.id).has(o.id)); if (waits.length) c.text += ` (mostly because it waits on ${waits.map(o => name(o.id)).join(', ')})`; }
    for (const [k, txt] of [['timeout', 'deadlines pass and requests time out'], ['rejected', 'waiting lines are full and new requests are refused'], ['limited', 'the rate limiter turns requests away'], ['breaker', 'a circuit breaker is open and calls fail at once']]) {
      const i = tl.slice(a, b).findIndex(x => x.errorKinds?.[k]);
      if (i >= 0) { const x = tl[a + i]; list.push({ t: x.t, text: `From ${sec(x.t)} s ${txt} (${Math.round(perS(x)(x.errorKinds[k]))}/s)` }); }
    }
    return list.map(c => ({ t: c.t, kind: 'cause', text: c.text.startsWith('From') ? c.text : `From ${sec(c.t)} s ${c.text}` }));
  }
  const faults = [...(res.faults || [])].sort((a, b) => a.at - b.at);
  for (const f of faults) {
    if (f.at >= dur) continue;
    const a = binAt(f.at), b = Math.max(a + 1, Math.ceil(Math.min(f.until, dur) / 1000)), pre = Math.max(binAt(warm), a - 10);
    const what = f.kind === 'burst' ? `Traffic jumps to ${f.factor}×` : f.kind === 'slow' ? `${name(f.node)} becomes ${f.factor}× slower` : `${name(f.node)} goes down`;
    out.push({ t: f.at, kind: 'fault', text: `${sec(f.at)} s: ${what} (until ${sec(f.until)} s)` });
    const p95Before = a > pre ? median(tl.slice(pre, a).map(x => x.p95Ms)) : null;
    const errBefore = a > pre ? avg(pre, a, errPerS) : 0, errDuring = avg(a, b, errPerS);
    const p95Peak = Math.max(...tl.slice(a, b).map(x => x.p95Ms ?? 0));
    const off = avg(a, b, x => perS(x)(x.offered)), done = avg(a, b, x => perS(x)(x.completed));
    const top = Object.entries(kindsIn(a, b)).sort((x, y) => y[1] - x[1])[0];
    let eff = `Meanwhile ${Math.round(done)} of ${Math.round(off)} requests/s finish`;
    if (errDuring > errBefore + 0.5) eff += `, errors go from ${Math.round(errBefore)} to ${Math.round(errDuring)}/s${top ? ` (mostly ${top[0]})` : ''}`;
    if (p95Before !== null && p95Peak > p95Before * 1.5) eff += `, p95 latency goes from ${Math.round(p95Before)} to ${Math.round(p95Peak)} ms`;
    out.push({ t: f.at, kind: 'effect', text: eff });
    if (f.kind === 'down' && kindsIn(a, b).down) out.push({ t: f.at, kind: 'cause', text: `Every request that needs ${name(f.node)} fails straight away while it is down` });
    out.push(...causes(a, b));
    let back = -1;
    for (let i = b; i < tl.length; i++) {
      const x = tl[i];
      if (!x.errors && (p95Before === null || x.p95Ms === null || x.p95Ms <= p95Before * 1.5) && servers.every(id => x.queue[id] < 1 || x.util[id] < FULLQ)) { back = i; break; }
    }
    if (f.until < dur) out.push(back >= 0 ? { t: tl[back].t, kind: 'recover', text: `${sec(tl[back].t)} s: back to normal, ${sec(Math.max(0, tl[back].t - f.until))} s after the fault ended` } : { t: f.until, kind: 'recover', text: 'Still not back to normal when the run ends: a backlog is draining or errors go on' });
  }
  if (!faults.length) out.push(...causes(binAt(warm), tl.length));
  if (!out.length) out.push({ t: warm, kind: 'effect', text: 'A steady run: nothing was full and nothing failed' });
  const rank = { fault: 0, effect: 1, cause: 2, recover: 3 };
  return out.sort((x, y) => x.t - y.t || rank[x.kind] - rank[y.kind]);
}

// ---------------- comparing with a baseline ----------------
export function designSize(doc) {
  let slots = 0;
  for (const n of doc.nodes) if (kindOf(n.type) === 'server') slots += (n.config.instances || 1) * (n.config.concurrency || 1);
  return { components: doc.nodes.filter(n => n.type !== 'traffic').length, slots };
}
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
export function unfairChanges(base, cur) {
  const out = [], a = base.workload, b = cur.workload, sec = x => +(x / 1000).toFixed(1);
  const fields = { rateRps: ['Requests per second', x => x], durationMs: ['Run length', x => sec(x) + ' s'], warmupMs: ['Warm-up', x => sec(x) + ' s'], arrivals: ['Arrivals', x => x] };
  for (const [k, [label, f]] of Object.entries(fields)) if (a[k] !== b[k]) out.push(`${label} changed: ${f(a[k])} → ${f(b[k])}`);
  if (!same(base.faults || [], cur.faults || [])) out.push('The fault schedule changed');
  if (base.engine !== cur.engine) out.push(`Engine version changed: ${base.engine} → ${cur.engine}`);
  if (base.seed !== cur.seed) out.push(`Seed changed: ${base.seed} → ${cur.seed}`);
  return out;
}
export function designChanges(base, cur) {
  const out = [], A = new Map(base.nodes.map(n => [n.id, n])), B = new Map(cur.nodes.map(n => [n.id, n]));
  for (const [id, n] of B) if (!A.has(id)) out.push(`Added ${n.label}`);
  for (const [id, n] of A) if (!B.has(id)) out.push(`Removed ${n.label}`);
  for (const [id, n] of B) { const o = A.get(id); if (o) for (const k of new Set([...Object.keys(o.config), ...Object.keys(n.config)])) if (!same(o.config[k], n.config[k])) out.push(`${n.label}: ${k} ${o.config[k]} → ${n.config[k]}`); }
  const set = d => new Set(d.edges.map(e => `${e.from}>${e.to}`));
  const ea = set(base), eb = set(cur), added = [...eb].filter(x => !ea.has(x)).length, removed = [...ea].filter(x => !eb.has(x)).length;
  if (added || removed) out.push(`Connections: ${added} added, ${removed} removed`);
  const desc = x => (x ? Object.entries(x).map(([k, v]) => `${k} ${v}`).join(', ') : 'off');
  for (const e of cur.edges) {
    const o = base.edges.find(x => x.from === e.from && x.to === e.to);
    if (!o) continue;
    const lbl = `${B.get(e.from)?.label || e.from} → ${B.get(e.to)?.label || e.to}`;
    for (const k of ['retry', 'breaker']) if (!same(o[k], e[k])) out.push(`${lbl} ${k}: ${desc(o[k])} → ${desc(e[k])}`);
  }
  const steps = d => JSON.stringify(d.routes.map(r => r.steps));
  if (!added && !removed && steps(base) !== steps(cur)) out.push('Work times or the request path changed');
  return out;
}
export function compareRows(baseSum, curSum, baseDoc, curDoc) {
  const rows = [];
  const add = (label, b, c, unit, higherBetter, digits = 1) => {
    if (!b && !c) return;
    let better = null;
    const bm = b?.mean ?? null, cm = c?.mean ?? null;
    if (bm !== null && cm !== null) { const d = cm - bm; if (Math.abs(d) / Math.max(Math.abs(bm), 1e-9) > 0.02 && Math.abs(d) > (unit === '%' ? 0.001 : 0.05)) better = higherBetter ? d > 0 : d < 0; }
    rows.push({ label, unit, digits, base: b, cur: c, better });
  };
  add('Completed', baseSum.completedRps, curSum.completedRps, 'req/s', true);
  add('Error rate', baseSum.errorRate, curSum.errorRate, '%', false);
  add('p95 latency', baseSum.p95Ms, curSum.p95Ms, 'ms', false);
  add('p99 latency', baseSum.p99Ms, curSum.p99Ms, 'ms', false);
  add('Background jobs', baseSum.jobsRps, curSum.jobsRps, 'jobs/s', true);
  const a = designSize(baseDoc), b = designSize(curDoc), one = x => ({ mean: x, min: x, max: x, n: 1 });
  rows.push({ label: 'Components', unit: '', digits: 0, base: one(a.components), cur: one(b.components), better: null, cost: true });
  rows.push({ label: 'Server slots (instances × at once)', unit: '', digits: 0, base: one(a.slots), cur: one(b.slots), better: null, cost: true });
  return rows;
}

// ---------------- evidence bundles ----------------
export const EVIDENCE = 'twinlabs.workbench.evidence/1';
export function stripRun(res) { const { replay, warnings, key, stale, summary, failed, ...rest } = res; return rest; }
export const fingerprint = res => hash32(JSON.stringify(res)).toString(16).padStart(8, '0');
export function makeEvidence(doc, res, limits = []) {
  const results = stripRun(res);
  return { format: EVIDENCE, created: new Date().toISOString(), engine: ENGINE, label: 'modeled', design: clone(doc), run: { seed: doc.seed, workload: doc.workload, faults: doc.faults || [] }, results, fingerprint: fingerprint(results), limits };
}
export const isEvidence = x => !!x && typeof x === 'object' && x.format === EVIDENCE;
export function verifyEvidence(bundle) {
  const r = simulate(bundle.design);
  if (!r.ok) return { identical: false, engineMatches: bundle.engine === ENGINE, error: r.errors.join('; '), diffs: [] };
  const results = stripRun(r), fp = fingerprint(results), diffs = [];
  for (const k of ['offered', 'completed', 'errors', 'p50Ms', 'p95Ms', 'p99Ms', 'nodes', 'edges', 'jobs', 'timeline']) if (JSON.stringify(results[k]) !== JSON.stringify(bundle.results?.[k])) diffs.push(k);
  return { identical: fp === bundle.fingerprint && !diffs.length, engineMatches: bundle.engine === ENGINE, fingerprint: fp, expected: bundle.fingerprint, diffs };
}

// ---------------- cost estimate ----------------
export const PRICE_BASIS = { instance: ['app', 'auth', 'worker', 'gateway', 'cache', 'search'], flat: ['db', 'lb', 'ratelimit'], usage: ['cdn', 'storage', 'external', 'queue'] };
export const BASIS_LABEL = { instance: 'per instance per month', flat: 'per month', usage: 'per million requests' };
export const basisOf = type => Object.keys(PRICE_BASIS).find(k => PRICE_BASIS[k].includes(type)) || null;
const MONTH_S = 720 * 3600;
export const DEFAULT_EXCLUSIONS = ['data transfer', 'storage size and backups', 'support plans', 'taxes', 'discounts and commitments', 'staff time'];
export const newPriceList = (date = new Date().toISOString().slice(0, 10)) => ({ date, currency: 'USD', prices: {}, exclusions: [...DEFAULT_EXCLUSIONS] });
export function estimateCost(doc, prices, res) {
  const rows = [], unpriced = [];
  let total = 0;
  for (const n of doc.nodes) {
    const basis = basisOf(n.type);
    if (!basis) continue;
    const p = prices?.prices?.[n.id];
    if (typeof p !== 'number' || !(p >= 0)) { unpriced.push(n.label); continue; }
    let amount, how;
    if (basis === 'instance') { const k = n.config.instances || 1; amount = k * p; how = `${k} instance${k === 1 ? '' : 's'} × ${p}`; }
    else if (basis === 'flat') { amount = p; how = 'flat, per month'; }
    else {
      const rps = res?.nodes?.[n.id]?.arrivedRps;
      if (typeof rps !== 'number') { unpriced.push(`${n.label} (run first: priced by requests)`); continue; }
      const millions = (rps * MONTH_S) / 1e6;
      amount = millions * p; how = `${rps.toFixed(1)} req/s for a month = ${millions.toFixed(1)} M requests × ${p}`;
    }
    total += amount;
    rows.push({ id: n.id, label: n.label, basis, how, amount });
  }
  return { rows, total, unpriced, currency: prices?.currency || '', date: prices?.date || '', exclusions: prices?.exclusions || [],
    note: 'An estimate from your own prices, not a bill. Usage prices assume the run\'s load lasts all month.' };
}
