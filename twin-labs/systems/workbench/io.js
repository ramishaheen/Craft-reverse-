// Getting designs in: templates (with break-it challenges), import of JSON or a small YAML subset,
// the "describe your system" questionnaire and the plain-text description reader.

import {
  TYPES, ID_RE, WORKLOAD, newDoc, addNode, addEdge, defaultConfig, deriveRoute, deriveRoutes, addRoute,
  svcMean, validate, isEvidence, verifyEvidence, expMs, clone,
} from './engine.js';

// ---------------- templates ----------------
function build(title, parts, links, { times = {}, rate } = {}) {
  const d = newDoc(title);
  const ids = parts.map(([type, x, y, cfg]) => { const n = addNode(d, type, { x: Math.round(x * 1.25), y }); Object.assign(n.config, cfg || {}); return n.id; });
  for (const [a, b] of links) addEdge(d, ids[a], ids[b]);
  d.routes = [deriveRoute(d)];
  const ms = Object.fromEntries(Object.entries(times).map(([i, v]) => [ids[i], v]));
  const set = list => { for (const s of list || []) { const id = s.at ?? s.to; if (id in ms) s.serviceMs = expMs(ms[id]); set(s.calls); } };
  set(d.routes[0].steps);
  if (rate) d.workload.rateRps = rate;
  return d;
}
const chain = n => Array.from({ length: n - 1 }, (_, i) => [i, i + 1]);

function basicStack(title) {
  const d = newDoc(title);
  addNode(d, 'traffic', { x: 50, y: 160 }); addNode(d, 'lb', { x: 300, y: 160 }); addNode(d, 'app', { x: 550, y: 160 }); addNode(d, 'db', { x: 800, y: 260 });
  addEdge(d, 'traffic', 'lb'); addEdge(d, 'lb', 'app'); addEdge(d, 'app', 'db');
  d.routes = [deriveRoute(d)];
  d.routes[0].steps[1].serviceMs = expMs(10);
  d.routes[0].steps[1].calls[0].serviceMs = expMs(10);
  Object.assign(d.workload, { rateRps: 200, durationMs: 60000, warmupMs: 5000 });
  return d;
}
function withCache(d) {
  addNode(d, 'cache', { x: 800, y: 60 });
  addEdge(d, 'app', 'cache');
  const toDb = d.edges.find(e => e.from === 'app' && e.to === 'db');
  d.edges = [...d.edges.filter(e => e !== toDb), toDb]; // the cache is asked before the database
  d.routes = [deriveRoute(d, d.routes[0])];
  d.routes[0].steps[1].calls[0].serviceMs = expMs(1);
  return d;
}

/** Break-it challenges: a design with a fault, and a fix to compare against. */
export const CHALLENGES = [
  { id: 'db_outage', title: 'Break: database outage',
    failure: 'The database is down for 10 s. Every request needs it, so every request in that window fails.',
    fix: 'Add a cache-aside cache with 80% hits: reads answered by the cache no longer need the database.',
    before() { const d = basicStack('Break: database outage'); d.faults = [{ at: 20000, until: 30000, node: 'db', kind: 'down' }]; return d; },
    after() { return withCache(this.before()); } },
  { id: 'slow_dependency', title: 'Break: slow database + retries',
    failure: 'For 20 s the database works 12× slower and can serve less than the 200 req/s arriving. Calls give up after 300 ms and the app retries each failure up to 3 times at once, so the struggling database gets roughly 30% more work and fewer requests finish than with no retries at all.',
    fix: 'Limit retries: one retry after 100 ms and a 10% retry budget. (A circuit breaker as well cut database load further but failed more requests, so it is not the pick here.)',
    before() {
      const d = basicStack('Break: slow database + retries');
      d.nodes.find(n => n.id === 'app').config.concurrency = 50;
      d.nodes.find(n => n.id === 'db').config.timeoutMs = 300;
      d.edges.find(e => e.from === 'app' && e.to === 'db').retry = { max: 3, backoffMs: 0, budgetP: 3 };
      d.faults = [{ at: 20000, until: 40000, node: 'db', kind: 'slow', factor: 12 }];
      return d;
    },
    after() { const d = this.before(); d.edges.find(e => e.from === 'app' && e.to === 'db').retry = { max: 1, backoffMs: 100, budgetP: 0.1 }; return d; } },
  { id: 'traffic_burst', title: 'Break: traffic burst',
    failure: 'Traffic triples for 10 s. The app (2 × 8 at once, about 20 ms a request) fills up, its waiting lines overflow and new requests are refused.',
    fix: 'Double the app instances (2 → 4) behind the load balancer that is already there.',
    before() { const d = basicStack('Break: traffic burst'); d.workload.rateRps = 300; d.faults = [{ at: 20000, until: 30000, node: 'traffic', kind: 'burst', factor: 3 }]; return d; },
    after() { const d = this.before(); d.nodes.find(n => n.id === 'app').config.instances = 4; return d; } },
];

export const TEMPLATES = [
  { id: 'read_api', label: 'Read API', desc: 'Users, a load balancer, two app instances and a database.',
    make: () => build('Read API', [['traffic', 40, 160], ['lb', 240, 160], ['app', 440, 160], ['db', 640, 160]], chain(4), { times: { 2: 20, 3: 10 } }) },
  { id: 'single_server', label: 'One server', desc: 'Users talking straight to a single app instance. Find where it tops out.',
    make: () => build('One server', [['traffic', 40, 160], ['app', 260, 160, { instances: 1, concurrency: 1 }]], chain(2), { times: { 1: 10 } }) },
  { id: 'cached_read', label: 'Cached reads', desc: 'The app looks in a cache first and goes to the database only on a miss.',
    make: () => build('Cached reads', [['traffic', 40, 160], ['lb', 240, 160], ['app', 440, 160], ['cache', 660, 70], ['db', 660, 250]], [[0, 1], [1, 2], [2, 3], [2, 4]], { times: { 2: 10, 3: 1, 4: 15 }, rate: 300 }) },
  { id: 'background_jobs', label: 'Background jobs', desc: 'Slow work goes onto a queue; workers write the results to the database.',
    make: () => build('Background jobs', [['traffic', 40, 160], ['lb', 240, 160], ['app', 440, 160], ['queue', 640, 160], ['worker', 840, 160, { instances: 2 }], ['db', 1040, 160]], chain(6), { times: { 2: 8, 4: 40, 5: 10 } }) },
  { id: 'web_stack', label: 'Full web stack', desc: 'CDN, rate limiter, gateway, auth, app, cache, database, search and file storage.',
    make: () => build('Full web stack', [
      ['traffic', 40, 220], ['cdn', 240, 220], ['ratelimit', 440, 220], ['lb', 640, 220], ['gateway', 840, 220, { timeoutMs: 6000 }],
      ['auth', 1060, 60], ['app', 1060, 220, { timeoutMs: 2000 }], ['cache', 1280, 120], ['db', 1280, 240], ['search', 1280, 360], ['storage', 1060, 400]],
    [[0, 1], [1, 2], [2, 3], [3, 4], [4, 5], [4, 6], [6, 9], [6, 7], [6, 8], [4, 10]],
    { times: { 1: 2, 4: 2, 5: 5, 6: 15, 7: 1, 8: 12, 9: 8, 10: 20 }, rate: 400 }) },
  { id: 'read_write', label: 'Read/write mix', desc: '90% reads go through a cache; 10% writes skip it and take longer at the database.',
    make: () => {
      const d = build('Read/write mix', [['traffic', 40, 160], ['lb', 240, 160], ['app', 440, 160], ['cache', 660, 70], ['db', 660, 250]], [[0, 1], [1, 2], [2, 3], [2, 4]], { times: { 2: 10, 3: 1, 4: 10 }, rate: 300 });
      const read = d.routes[0];
      Object.assign(read, { id: 'read', label: 'Read', share: 0.9 });
      const write = clone(read);
      Object.assign(write, { id: 'write', label: 'Write', share: 0.1 });
      const app = write.steps.find(s => s.at === 'app');
      app.calls.find(c => c.to === 'cache').skip = true;
      app.calls.find(c => c.to === 'db').serviceMs = expMs(30);
      d.routes.push(write);
      return d;
    } },
  ...CHALLENGES.map(c => ({ id: c.id, label: c.title, desc: c.failure.split('. ')[0].replace(/\.$/, '') + '.', make: () => c.before(), challenge: c })),
];

// ---------------- a small YAML reader ----------------
// Supports block mappings and sequences, flow {…} and […], quoted strings, numbers, booleans, null and # comments.
export function parseYaml(text) {
  const lines = [];
  for (const raw of String(text).replace(/\r/g, '').split('\n')) {
    const noComment = stripComment(raw);
    if (!noComment.trim() || noComment.trim() === '---') continue;
    lines.push({ indent: noComment.match(/^ */)[0].length, text: noComment.trim() });
  }
  let i = 0;
  const block = indent => {
    if (i >= lines.length) return null;
    if (lines[i].text.startsWith('- ') || lines[i].text === '-') return seq(lines[i].indent);
    return map(lines[i].indent);
  };
  function seq(indent) {
    const out = [];
    while (i < lines.length && lines[i].indent === indent && (lines[i].text.startsWith('- ') || lines[i].text === '-')) {
      const rest = lines[i].text.slice(1).trim();
      i++;
      if (!rest) { out.push(i < lines.length && lines[i].indent > indent ? block(lines[i].indent) : null); continue; }
      const kv = splitKey(rest);
      if (kv && !rest.startsWith('{') && !rest.startsWith('[') && !/^["']/.test(rest)) {
        // "- key: value" starts an inline mapping; following deeper lines continue it
        const obj = {};
        assign(obj, kv, indent + 2);
        if (i < lines.length && lines[i].indent > indent && !(lines[i].text.startsWith('- ') && lines[i].indent === indent)) Object.assign(obj, map(lines[i].indent));
        out.push(obj);
      } else out.push(scalar(rest));
    }
    return out;
  }
  function map(indent) {
    const out = {};
    while (i < lines.length && lines[i].indent === indent) {
      const kv = splitKey(lines[i].text);
      if (!kv) throw new Error(`line "${lines[i].text}" is not "key: value"`);
      i++;
      assign(out, kv, indent);
    }
    return out;
  }
  function assign(obj, [k, v], indent) {
    if (v === '') obj[k] = i < lines.length && lines[i].indent > indent ? block(lines[i].indent) : (i < lines.length && lines[i].indent === indent && lines[i].text.startsWith('- ') ? seq(indent) : null);
    else obj[k] = scalar(v);
  }
  const result = block(0);
  if (i < lines.length) throw new Error(`could not read line "${lines[i].text}"`);
  return result;
}
function stripComment(s) {
  let q = null;
  for (let k = 0; k < s.length; k++) {
    const c = s[k];
    if (q) { if (c === q) q = null; continue; }
    if (c === '"' || c === "'") q = c;
    else if (c === '#' && (k === 0 || /\s/.test(s[k - 1]))) return s.slice(0, k);
  }
  return s;
}
function splitKey(s) {
  const m = s.match(/^("[^"]*"|'[^']*'|[^:{}[\],]+?)\s*:(\s+|$)(.*)$/);
  if (!m) return null;
  return [m[1].replace(/^["']|["']$/g, '').trim(), m[3].trim()];
}
function scalar(s) {
  s = s.trim();
  if (s.startsWith('{') || s.startsWith('[')) { const p = { s, i: 0 }; const v = flow(p); return v; }
  if (/^".*"$/.test(s)) return s.slice(1, -1).replace(/\\n/g, '\n').replace(/\\"/g, '"');
  if (/^'.*'$/.test(s)) return s.slice(1, -1).replace(/''/g, "'");
  if (/^(true|yes)$/i.test(s)) return true;
  if (/^(false|no)$/i.test(s)) return false;
  if (/^(null|~)$/i.test(s)) return null;
  if (/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return Number(s);
  return s;
}
function flow(p) {
  const ws = () => { while (p.i < p.s.length && /\s/.test(p.s[p.i])) p.i++; };
  ws();
  const c = p.s[p.i];
  if (c === '{') {
    p.i++; const o = {};
    for (;;) {
      ws();
      if (p.s[p.i] === '}') { p.i++; return o; }
      const k = token(p, ':'); if (p.s[p.i] !== ':') throw new Error('expected ":" in {…}');
      p.i++; ws();
      o[String(scalar(k))] = p.s[p.i] === '{' || p.s[p.i] === '[' ? flow(p) : scalar(token(p, ',}'));
      ws();
      if (p.s[p.i] === ',') p.i++;
      else if (p.s[p.i] !== '}') throw new Error('expected "," or "}"');
    }
  }
  if (c === '[') {
    p.i++; const a = [];
    for (;;) {
      ws();
      if (p.s[p.i] === ']') { p.i++; return a; }
      a.push(p.s[p.i] === '{' || p.s[p.i] === '[' ? flow(p) : scalar(token(p, ',]')));
      ws();
      if (p.s[p.i] === ',') p.i++;
      else if (p.s[p.i] !== ']') throw new Error('expected "," or "]"');
    }
  }
  return scalar(token(p, ',}]'));
}
function token(p, stops) {
  let out = '', q = null;
  while (p.i < p.s.length) {
    const c = p.s[p.i];
    if (q) { out += c; p.i++; if (c === q) q = null; continue; }
    if (c === '"' || c === "'") { q = c; out += c; p.i++; continue; }
    if (stops.includes(c)) break;
    out += c; p.i++;
  }
  if (q) throw new Error('unclosed quote');
  return out.trim();
}

// ---------------- normalising an imported object ----------------
const SETTING_NAME = { instances: 'instances', concurrency: 'requests at once', queueLimit: 'waiting line', timeoutMs: 'timeout ms', overheadMs: 'added time ms', strategy: 'strategy', hitP: 'hit ratio', pattern: 'pattern', limitRps: 'allowed req/s', burst: 'burst', capacity: 'capacity', rateRps: 'requests per second', durationMs: 'run length ms', warmupMs: 'warm-up ms' };
const slug = s => String(s || '').toLowerCase().replace(/[^a-z0-9_-]+/g, '-').replace(/^[^a-z]+/, '').slice(0, 32) || 'c';
const NODE_FIELDS = new Set(['id', 'type', 'label', 'config', 'pos', 'ms']);
const EDGE_FIELDS = new Set(['id', 'from', 'to', 'kind', 'retry', 'breaker']);

/** Turn a loosely written object into a full design. Missing values get defaults, each listed. */
export function fromObject(src) {
  const errors = [], ignored = [], filled = [];
  const note = (text, ref, source = 'default') => filled.push({ id: 'a' + (filled.length + 1), text, source, ref });
  if (!src || typeof src !== 'object' || Array.isArray(src)) return { doc: null, assumptions: [], ignored, errors: ['Expected a design with "nodes"'], warnings: [] };
  if (src.schema && !/^twinlabs\.workbench\/1$/.test(src.schema)) return { doc: null, assumptions: [], ignored, errors: [`This design says "${src.schema}"; the workbench reads twinlabs.workbench/1`], warnings: [] };
  const d = newDoc(String(src.title || 'Imported design').slice(0, 80));
  if (typeof src.id === 'string') d.id = src.id;
  if (Number.isInteger(src.seed)) d.seed = src.seed; else note('Seed 42', 'seed');
  const list = Array.isArray(src.nodes) ? src.nodes : [];
  if (!list.length) errors.push('The file has no components ("nodes")');
  const taken = new Set(), alias = new Map(), times = new Map();
  for (const [i, raw] of list.entries()) {
    const x = typeof raw === 'string' ? { type: raw } : raw || {};
    const where = `Component ${i + 1}`, type = String(x.type || '').toLowerCase();
    if (!TYPES[type]) { errors.push(`${where}: "${x.type}" is not a component type (known: ${Object.keys(TYPES).join(', ')})`); continue; }
    let id = typeof x.id === 'string' && ID_RE.test(x.id) ? x.id : slug(x.id || x.label || type);
    if (x.id !== undefined && id !== x.id) note(`${where}: id "${x.id}" became "${id}"`, `nodes.${id}.id`);
    for (let k = 2; taken.has(id); k++) id = slug(x.id || x.label || type).slice(0, 29) + k;
    taken.add(id); alias.set(String(x.id ?? id), id); alias.set(id, id);
    const label = typeof x.label === 'string' && x.label.trim() ? x.label.trim().slice(0, 40) : TYPES[type].label;
    const cfg = defaultConfig(type), given = x.config && typeof x.config === 'object' ? x.config : {};
    for (const k of Object.keys(cfg)) { if (given[k] !== undefined) cfg[k] = given[k]; else note(`${label}: ${SETTING_NAME[k] || k} ${cfg[k]} (default)`, `nodes.${id}.config.${k}`); }
    for (const k of Object.keys(given)) if (!(k in cfg)) ignored.push(`${label}: "${k}" is not a ${TYPES[type].label} setting`);
    for (const k of Object.keys(x)) if (!NODE_FIELDS.has(k)) ignored.push(`${label}: field "${k}"`);
    if (typeof x.ms === 'number') times.set(id, x.ms);
    d.nodes.push({ id, type, label, config: cfg, pos: x.pos && typeof x.pos.x === 'number' ? { x: x.pos.x, y: x.pos.y } : null });
  }
  const resolve = v => alias.get(String(v));
  const links = [];
  for (const [i, e] of (Array.isArray(src.edges) ? src.edges : []).entries()) {
    if (typeof e === 'string') {
      const parts = e.split(/\s*->\s*/).map(s => s.trim()).filter(Boolean);
      if (parts.length < 2) { errors.push(`Connection ${i + 1}: "${e}" should look like "a -> b"`); continue; }
      for (let k = 1; k < parts.length; k++) links.push({ from: parts[k - 1], to: parts[k] });
    } else if (Array.isArray(e) && e.length === 2) links.push({ from: e[0], to: e[1] });
    else if (e && typeof e === 'object') { links.push(e); for (const k of Object.keys(e)) if (!EDGE_FIELDS.has(k)) ignored.push(`Connection ${i + 1}: field "${k}"`); }
    else errors.push(`Connection ${i + 1}: not understood`);
  }
  for (const l of links) {
    const a = resolve(l.from), b = resolve(l.to);
    if (!a || !b) { errors.push(`Connection ${l.from} -> ${l.to}: there is no component "${a ? l.to : l.from}"`); continue; }
    if (d.edges.some(x => x.from === a && x.to === b)) continue;
    const tType = d.nodes.find(n => n.id === b).type;
    const edge = { id: typeof l.id === 'string' && ID_RE.test(l.id) && !taken.has(l.id) ? l.id : 'e' + (d.edges.length + 1), from: a, to: b, kind: l.kind || (tType === 'queue' ? 'async' : 'sync') };
    taken.add(edge.id);
    if (!l.kind && tType === 'queue') note(`${a} -> ${b} does not wait (async into a queue)`, `edges.${edge.id}.kind`);
    if (l.retry) edge.retry = l.retry;
    if (l.breaker) edge.breaker = l.breaker;
    d.edges.push(edge);
  }
  if (!d.nodes.some(n => n.type === 'traffic') && d.nodes.length) {
    const targets = new Set(d.edges.map(e => e.to));
    const entries = d.nodes.filter(n => !targets.has(n.id) && n.type !== 'queue');
    if (entries.length === 1) {
      let id = 'users';
      for (let k = 2; taken.has(id); k++) id = 'users' + k;
      d.nodes.unshift({ id, type: 'traffic', label: 'Users', config: {}, pos: null });
      d.edges.unshift({ id: 'e0', from: id, to: entries[0].id, kind: 'sync' });
      note(`Users added in front of ${entries[0].label}`, `nodes.${id}`);
    } else errors.push(entries.length ? `Add a "traffic" component: requests could start at ${entries.map(n => n.label).join(' or ')}` : 'Add a "traffic" component (Users)');
  }
  // lay out components without positions by distance from Users
  const depth = new Map(), users = d.nodes.find(n => n.type === 'traffic');
  if (users) { const q = [[users.id, 0]]; while (q.length) { const [id, k] = q.shift(); if (depth.has(id)) continue; depth.set(id, k); for (const e of d.edges) if (e.from === id) q.push([e.to, k + 1]); } }
  const rows = new Map();
  for (const n of d.nodes) { if (n.pos) continue; const k = depth.get(n.id) ?? 0, r = rows.get(k) || 0; rows.set(k, r + 1); n.pos = { x: 40 + k * 250, y: 80 + r * 110 }; }
  const w = src.workload && typeof src.workload === 'object' ? { ...src.workload } : {};
  if (w.rate !== undefined && w.rateRps === undefined) w.rateRps = w.rate;
  for (const k of Object.keys(WORKLOAD)) { if (typeof w[k] === 'number') d.workload[k] = w[k]; else note(`Traffic: ${SETTING_NAME[k] || k} ${d.workload[k]} (default)`, `workload.${k}`); }
  if (w.arrivals) d.workload.arrivals = w.arrivals; else note('Arrivals random (Poisson) (default)', 'workload.arrivals');
  for (const k of Object.keys(w)) if (!(k in WORKLOAD) && !['arrivals', 'pattern', 'rate'].includes(k)) ignored.push(`workload: field "${k}"`);
  if (Array.isArray(src.faults)) d.faults = src.faults;
  if (src.calibration && typeof src.calibration === 'object') d.calibration = src.calibration;
  if (src.costs && typeof src.costs === 'object') d.costs = src.costs;
  if (Array.isArray(src.routes) && src.routes.length) d.routes = src.routes;
  else if (!errors.length) {
    const routes = deriveRoutes(d);
    if (!routes) errors.push('Users connect to several components in a row; put one load balancer or gateway in front');
    else {
      d.routes = routes;
      const seen = new Set();
      const walk = list => { for (const s of list || []) { const id = s.at ?? s.to, n = d.nodes.find(x => x.id === id); if (s.serviceMs && !seen.has(id)) { seen.add(id); if (times.has(id)) s.serviceMs = expMs(times.get(id)); else note(`${n.label} work time ${svcMean(s.serviceMs)} ms per request (default)`, `routes.main.${id}.serviceMs`); } walk(s.calls); } };
      if (routes[0]) { walk(routes[0].steps); note('One request type with 100% of the traffic (default)', 'routes'); }
    }
  }
  const kept = Array.isArray(src.assumptions) ? src.assumptions.filter(a => a && typeof a.text === 'string') : [];
  d.assumptions = [...kept, ...filled.map((a, k) => ({ ...a, id: 'a' + (kept.length + k + 1) }))];
  const v = errors.length ? { errors: [], warnings: [] } : validate(d);
  return { doc: errors.length ? null : d, assumptions: filled, ignored, errors: [...errors, ...v.errors], warnings: v.warnings };
}

/** Read text (JSON, YAML or an evidence bundle). */
export function importText(text) {
  const t = String(text || '').trim();
  const empty = msg => ({ doc: null, assumptions: [], ignored: [], errors: [msg], warnings: [] });
  if (!t) return empty('There is nothing to import');
  let obj, format;
  if (t.startsWith('{') || t.startsWith('[')) {
    try { obj = JSON.parse(t); format = 'JSON'; } catch (e) { return empty('This is not valid JSON: ' + e.message); }
  } else {
    try { obj = parseYaml(t); format = 'YAML'; } catch (e) { return empty('This is not YAML the workbench can read: ' + e.message); }
    if (!obj || typeof obj !== 'object') return empty('The text does not describe a design (expected a mapping with nodes)');
  }
  if (isEvidence(obj)) return { ...fromObject(obj.design), format: 'evidence bundle', bundle: { created: obj.created, engine: obj.engine, ...verifyEvidence(obj) } };
  return { ...fromObject(obj), format };
}

// ---------------- questionnaire ----------------
export const GUIDE_TEXT = {
  name: 'What is the system called?', rate: 'Requests per second at a busy moment', readPct: 'Share of requests that only read (%)',
  cdn: 'Are static files and pages served by a CDN?', cdnHitPct: 'CDN hit ratio (%)', rateLimit: 'Is there a rate limiter at the edge?', limitRps: 'Its limit (requests per second)',
  entry: 'What spreads requests across your servers?', appInstances: 'App servers (instances)', appConcurrency: 'Requests one instance handles at once', appMs: 'App work time per request (ms)',
  auth: 'Is a separate auth service called on every request?', cache: 'Is there a cache in front of the database?', cacheHitPct: 'Cache hit ratio (%)',
  dbMs: 'Database time per query (ms)', dbConnections: 'Database connections (queries at once)', search: 'A search index (Elasticsearch, for example)?', storage: 'Object storage for files (S3, for example)?',
  jobs: 'Background jobs through a queue?', workers: 'Worker instances', jobMs: 'Work time per job (ms)', external: 'A third-party API called on every request?', externalMs: 'Third-party API time (ms)',
};
export const GUIDE_FORM = [
  ['Traffic', [['name', 'text'], ['rate', 'num'], ['readPct', 'num']]],
  ['Edge', [['cdn', 'bool'], ['cdnHitPct', 'num', null, 'cdn'], ['rateLimit', 'bool'], ['limitRps', 'num', null, 'rateLimit'],
    ['entry', 'select', [['lb', 'A load balancer (Nginx, ALB…)'], ['gateway', 'An API gateway'], ['none', 'Nothing: a single app server']]]]],
  ['App', [['appInstances', 'num'], ['appConcurrency', 'num'], ['appMs', 'num'], ['auth', 'bool']]],
  ['Data', [['cache', 'select', [['', 'No cache'], ['cache_aside', 'Yes: the app checks the cache, then the database on a miss'], ['read_through', 'Yes: the cache loads from the database itself']]],
    ['cacheHitPct', 'num', null, 'cache'], ['dbMs', 'num'], ['dbConnections', 'num'], ['search', 'bool'], ['storage', 'bool']]],
  ['Background work and third parties', [['jobs', 'bool'], ['workers', 'num', null, 'jobs'], ['jobMs', 'num', null, 'jobs'], ['external', 'bool'], ['externalMs', 'num', null, 'external']]],
];
const num = v => (v === '' || v === undefined || v === null || !Number.isFinite(Number(v)) ? undefined : Number(v));
export function fromAnswers(a = {}) {
  const nodes = [{ id: 'users', type: 'traffic' }], path = ['users'], extra = [];
  const add = (id, type, config = {}, ms) => { const n = { id, type }; const c = Object.fromEntries(Object.entries(config).filter(([, v]) => v !== undefined)); if (Object.keys(c).length) n.config = c; if (ms !== undefined) n.ms = ms; nodes.push(n); return id; };
  const frac = v => (num(v) === undefined ? undefined : Math.max(0, Math.min(1, num(v) / 100)));
  if (a.cdn) path.push(add('cdn', 'cdn', { hitP: frac(a.cdnHitPct) }));
  if (a.rateLimit) path.push(add('ratelimit', 'ratelimit', { limitRps: num(a.limitRps) }));
  if (a.entry === 'lb' || a.entry === undefined || a.entry === '') path.push(add('lb', 'lb'));
  else if (a.entry === 'gateway') path.push(add('gateway', 'gateway'));
  path.push(add('app', 'app', { instances: num(a.appInstances), concurrency: num(a.appConcurrency) }, num(a.appMs)));
  if (a.auth) extra.push(add('auth', 'auth'));
  if (a.search) extra.push(add('search', 'search'));
  if (a.cache) extra.push(add('cache', 'cache', { hitP: frac(a.cacheHitPct), pattern: a.cache === 'read_through' ? 'read_through' : 'cache_aside' }));
  const db = add('db', 'db', { concurrency: num(a.dbConnections) }, num(a.dbMs));
  const edges = [path.join(' -> ')];
  for (const id of extra) edges.push(`app -> ${id}`);
  edges.push(a.cache === 'read_through' ? 'cache -> db' : `app -> ${db}`);
  if (a.storage) { add('storage', 'storage'); edges.push('app -> storage'); }
  if (a.external) { add('external', 'external', {}, num(a.externalMs)); edges.push('app -> external'); }
  if (a.jobs) { add('queue', 'queue'); add('worker', 'worker', { instances: num(a.workers) }, num(a.jobMs)); edges.push('app -> queue', 'queue -> worker', 'worker -> db'); }
  const src = { title: String(a.name || 'My system').slice(0, 80), nodes, edges, workload: {} };
  if (num(a.rate) !== undefined) src.workload.rateRps = num(a.rate);
  const out = fromObject(src);
  const read = frac(a.readPct);
  if (out.doc && read !== undefined && read < 1) {
    const d = out.doc;
    Object.assign(d.routes[0], { id: 'read', label: 'Read' });
    const w = addRoute(d, 'Write');
    w.id = 'write';
    d.routes[0].share = +read.toFixed(4); w.share = +(1 - read).toFixed(4);
    const find = (list, id) => { for (const s of list || []) { if ((s.at ?? s.to) === id) return s; const x = find(s.calls, id); if (x) return x; } return null; };
    const app = find(w.steps, 'app'), cache = app?.calls?.find(c => c.to === 'cache');
    if (cache && a.cache !== 'read_through') cache.skip = true;
    const dbCall = app?.calls?.find(c => c.to === 'db') || cache?.calls?.find(c => c.to === 'db');
    if (dbCall?.serviceMs) {
      dbCall.serviceMs = expMs((dbCall.serviceMs.mean ?? 10) * 3);
      d.assumptions.push({ id: 'a' + (d.assumptions.length + 1), text: `A write takes 3× a read at the database (${dbCall.serviceMs.mean} ms) (default)`, source: 'default', ref: 'routes.write.db.serviceMs' });
    }
    if (cache && a.cache === 'read_through') d.assumptions.push({ id: 'a' + (d.assumptions.length + 1), text: 'Writes pass through the read-through cache like reads (default)', source: 'default', ref: 'routes.write.cache' });
  }
  return out;
}

// ---------------- reading a written description ----------------
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, a: 1, an: 1, single: 1 };
const KNOWN = [
  ['react|vue|angular|svelte|next\\.?js|nuxt|frontend|front-end|browser|web client|spa|mobile app|ios app|android app|clients?|users?', 'traffic', 'Users'],
  ['cloudfront|cloudflare|akamai|fastly|cdn', 'cdn', 'CDN'],
  ['rate[- ]?limit(?:er|ing)?', 'ratelimit', 'Rate limiter'],
  ['nginx|haproxy|traefik|envoy|caddy|alb|elb|nlb|load[- ]?balancer', 'lb', 'Load balancer'],
  ['api[- ]?gateway|kong|apigee|tyk|gateway', 'gateway', 'API gateway'],
  ['keycloak|auth0|cognito|okta|auth(?:entication)?[- ]?service|auth', 'auth', 'Auth service'],
  ['node(?:\\.?js)?|express|nest(?:js)?|django|flask|fastapi|rails|ruby|spring(?: boot)?|java|php|laravel|\\.net|asp\\.net|go(?:lang)? service|api servers?|backend|app servers?|web servers?|services?|api|app', 'app', 'App service'],
  ['redis|memcached|elasticache|valkey|varnish|cache', 'cache', 'Cache'],
  ['postgres(?:ql)?|mysql|mariadb|mongo(?:db)?|dynamodb|aurora|sql server|mssql|oracle|cassandra|cockroach(?:db)?|sqlite|database|db', 'db', 'Database'],
  ['elasticsearch|elastic search|opensearch|solr|algolia|meilisearch|typesense|search', 'search', 'Search index'],
  ['s3|gcs|google cloud storage|azure blob|blob storage|minio|object storage|file storage', 'storage', 'Object storage'],
  ['bullmq|bull|sidekiq|celery|resque|hangfire', 'queue', 'Job queue', 'worker'],
  ['kafka|rabbitmq|sqs|pub/?sub|nats|activemq|kinesis|message queue|queue', 'queue', 'Queue'],
  ['workers?|consumers?|background jobs?|job runners?', 'worker', 'Workers'],
  ['stripe|paypal|twilio|sendgrid|mailgun|openai|third[- ]party(?: api)?|external api|payment provider', 'external', 'External API'],
];
const NOT_MODELED = [
  ['kubernetes|k8s|docker|ecs|containers?|helm|terraform|vms?|ec2', 'a deployment platform: it is how things run, not a step requests pass through'],
  ['read replicas?|replicas?|replication|primary|failover|sharding|shards?|partitions?', 'replication and sharding are not part of this model yet'],
  ['websockets?|grpc|graphql|sse|http/?2', 'protocols are not modelled (there is no network time)'],
  ['regions?|multi-region|availability zones?|az', 'regions and network distance are not modelled'],
  ['logging|logs|monitoring|prometheus|grafana|datadog|tracing|sentry', 'observability tools are not on the request path'],
  ['cron|scheduler|batch', 'scheduled jobs are not modelled'],
];
const PRODUCT = {
  postgres: 'PostgreSQL', postgresql: 'PostgreSQL', mysql: 'MySQL', mariadb: 'MariaDB', mongo: 'MongoDB', mongodb: 'MongoDB', redis: 'Redis', memcached: 'Memcached',
  nginx: 'Nginx', haproxy: 'HAProxy', kafka: 'Kafka', rabbitmq: 'RabbitMQ', sqs: 'SQS', bullmq: 'BullMQ', sidekiq: 'Sidekiq', celery: 'Celery', s3: 'S3',
  elasticsearch: 'Elasticsearch', opensearch: 'OpenSearch', cloudfront: 'CloudFront', cloudflare: 'Cloudflare', node: 'Node', nodejs: 'Node.js', 'node.js': 'Node.js',
  express: 'Express', django: 'Django', rails: 'Rails', spring: 'Spring', 'spring boot': 'Spring Boot', stripe: 'Stripe', keycloak: 'Keycloak', auth0: 'Auth0',
  dynamodb: 'DynamoDB', aurora: 'Aurora', kong: 'Kong', envoy: 'Envoy', traefik: 'Traefik', alb: 'ALB', elb: 'ELB', fastapi: 'FastAPI', flask: 'Flask',
};
const wordRe = s => new RegExp(`(?:^|[^a-z0-9])(${s})(?![a-z0-9])`, 'i');
const KNOWN_RE = KNOWN.map(([re, type, label, extra]) => ({ re: wordRe(re), type, label, extra }));
const NOT_RE = NOT_MODELED.map(([re, reason]) => ({ re: wordRe(re), reason }));
const GENERIC = /^(users?|clients?|frontend|front-end|browser|web client|spa|app|api|services?|backend|app servers?|web servers?|api servers?|cache|database|db|queue|message queue|workers?|consumers?|background jobs?|job runners?|search|gateway|api[- ]?gateway|auth|auth(?:entication)?[- ]?service|cdn|load[- ]?balancer|object storage|file storage|blob storage|third[- ]party(?: api)?|external api|payment provider|rate[- ]?limit(?:er|ing)?)$/i;
const specificity = w => w.length + (GENERIC.test(w) ? 0 : 100);
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
function countBefore(text, word) {
  const t = text.toLowerCase(), w = escRe(word.toLowerCase());
  const m = t.match(new RegExp(`(\\d+|${Object.keys(WORDS).join('|')})\\s*(?:x\\s*)?(?:[a-z.]+\\s+){0,2}?${w}`)) || t.match(new RegExp(`${w}\\s*(?:x|×)\\s*(\\d+)`));
  if (!m) return undefined;
  const n = /^\d+$/.test(m[1]) ? Number(m[1]) : WORDS[m[1]];
  return n > 1 || /^\d+$/.test(m[1]) ? n : undefined;
}
function recognise(part) {
  let hit = null;
  for (const k of KNOWN_RE) { const m = part.match(k.re); if (m && (!hit || specificity(m[1]) > specificity(hit.word))) hit = { ...k, word: m[1] }; }
  return { hit, notModeled: NOT_RE.map(k => ({ m: part.match(k.re), reason: k.reason })).filter(x => x.m) };
}

/** Read a description by fixed rules. Returns what was stated, inferred, not modelled, and questions. */
export function readDescription(input) {
  const text = String(input || '').slice(0, 5000);
  const nodes = [], edges = [], facts = [], inferred = [], unsupported = [], questions = [], byKey = new Map();
  const make = (hit, mention) => {
    const base = hit.word.toLowerCase().replace(/s$/, ''), product = PRODUCT[hit.word.toLowerCase()] || PRODUCT[base];
    const key = hit.type === 'traffic' ? 'traffic' : `${hit.type}:${product || hit.label}`;
    if (byKey.has(key)) return byKey.get(key);
    const idBase = (hit.type === 'traffic' ? 'users' : (product || hit.type).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')).slice(0, 30) || hit.type;
    const n = { id: nodes.some(x => x.id === idBase) ? idBase + (nodes.length + 1) : idBase, type: hit.type,
      label: hit.type === 'traffic' ? 'Users' : product ? (hit.type === 'queue' && hit.extra ? product + ' queue' : product) : hit.label, config: {}, mention: mention.trim() };
    nodes.push(n); byKey.set(key, n);
    if (hit.type === 'traffic' && !/^users?$|^clients?$/i.test(hit.word)) inferred.push({ text: `"${hit.word}" runs on the user's device, so it is modelled as Users`, ref: 'nodes.users' });
    if (hit.extra === 'worker') {
      const w = make({ type: 'worker', label: 'Workers', word: (product || hit.word) + ' workers' }, mention);
      w.label = `${product || 'Job'} workers`;
      edges.push({ from: n.id, to: w.id, stated: false });
      inferred.push({ text: `${n.label} implies a queue with workers taking its jobs`, ref: `nodes.${w.id}` });
    }
    return n;
  };
  const rateM = text.match(/(\d+(?:\.\d+)?)\s*(k)?\s*(?:rps|req(?:uests)?\s*(?:\/|per)\s*s(?:ec(?:ond)?)?|requests per second|qps)/i);
  const rateRps = rateM ? Number(rateM[1]) * (rateM[2] ? 1000 : 1) : undefined;
  if (rateRps !== undefined) facts.push({ text: `${rateRps} requests per second`, ref: 'workload.rateRps' });
  const hitM = text.match(/(\d{1,3})\s*%\s*(?:cache\s*)?hit|hit\s*(?:rate|ratio)\s*(?:of|is|~|=)?\s*(\d{1,3})\s*%/i);
  const hitP = hitM ? Math.min(1, Number(hitM[1] || hitM[2]) / 100) : undefined;
  const goals = [...text.matchAll(/p9[59]\s*(?:latency)?\s*(?:under|below|<|of)?\s*\d+\s*ms|\d+(?:\.\d+)?\s*%\s*(?:uptime|availability)|sla[^.;\n]*/gi)].map(m => m[0]);
  for (const g of goals) unsupported.push({ text: g.trim(), reason: 'a target, not a part of the system: compare it with the results yourself' });
  const sentences = text.split(/[;\n]+|\.(?:\s+|$)/).map(s => s.trim()).filter(Boolean);
  for (const sent of sentences) {
    if (/\b(ignore|disregard|forget)\b.*\b(instructions?|above|previous|rules?)\b|\b(delete|drop|truncate|execute|run|shut ?down|deploy|send|email|curl|rm -rf)\b\s+(the|all|this|it|everything|\/)/i.test(sent)) {
      unsupported.push({ text: sent, reason: 'reads like a command: a description is only read as data, nothing in it is carried out' });
      continue;
    }
    const arrows = /->|→|=>/.test(sent);
    const hops = arrows ? sent.split(/\s*(?:->|→|=>)\s*/) : sent.split(/,|\band\b|\bwith\b|\bplus\b|\busing\b|\bbehind\b/i);
    const groups = arrows ? hops.map(x => x.split(/,|\band\b|\bwith\b|\bplus\b/i)) : hops.map(x => [x]);
    let prev = null;
    for (const group of groups) {
      const from = prev;
      let firstHere = null;
      for (const piece of group) {
        const p = piece.trim();
        if (!p) continue;
        const { hit, notModeled } = recognise(p);
        for (const x of notModeled) if (!unsupported.some(u => u.text.toLowerCase() === x.m[1].toLowerCase())) unsupported.push({ text: x.m[1], reason: x.reason });
        if (!hit) {
          if (goals.some(g => p.includes(g.trim()) || g.includes(p))) continue;
          const rest = p.replace(/\d+(?:\.\d+)?\s*k?\s*(rps|qps|requests? per second|req\/s)|\d+\s*%[^,]*/gi, '')
            .replace(/\b(the|a|an|our|we|use|uses|using|is|are|on|in|for|of|it|at|has|have|running|runs|via|over|about|around|roughly|approximately|some|traffic|peak)\b|~/gi, '').trim();
          if (rest && !notModeled.length && rest.length > 1) unsupported.push({ text: p, reason: 'not recognised: use a known type in the wording, or add it by hand' });
          continue;
        }
        const n = make(hit, p), count = countBefore(p, hit.word);
        if (count !== undefined && 'instances' in (TYPES[n.type].config || {})) { n.config.instances = count; facts.push({ text: `${n.label}: ${count} instances`, ref: `nodes.${n.id}.config.instances` }); }
        if (arrows && from && from.id !== n.id) {
          if (!edges.some(e => e.from === from.id && e.to === n.id)) edges.push({ from: from.id, to: n.id, stated: true });
          facts.push({ text: `${from.label} -> ${n.label}`, ref: `edges.${from.id}.${n.id}` });
        }
        if (!firstHere) firstHere = n;
      }
      if (arrows && firstHere) prev = firstHere;
    }
  }
  if (hitP !== undefined) for (const n of nodes) if (n.type === 'cache' || n.type === 'cdn') { n.config.hitP = hitP; facts.push({ text: `${n.label}: ${Math.round(hitP * 100)}% hits`, ref: `nodes.${n.id}.config.hitP` }); }
  // merge a generic mention ("cache") into a named one of the same type ("Redis")
  for (const n of [...nodes]) {
    const named = nodes.find(o => o !== n && o.type === n.type && n.label === TYPES[n.type].label && o.label !== n.label);
    if (!named || n.type === 'traffic') continue;
    Object.assign(named.config, n.config);
    for (const e of edges) { if (e.from === n.id) e.from = named.id; if (e.to === n.id) e.to = named.id; }
    for (const f of facts) f.text = f.text.replace(n.label + ':', named.label + ':');
    nodes.splice(nodes.indexOf(n), 1);
    for (let k = facts.length - 1; k > 0; k--) if (facts.findIndex(f => f.text === facts[k].text) < k) facts.splice(k, 1);
  }
  const ofType = t => nodes.filter(n => n.type === t), hasIn = id => edges.some(e => e.to === id);
  for (const w of ofType('worker')) if (!hasIn(w.id) && !ofType('queue').length) {
    nodes.push({ id: 'queue', type: 'queue', label: 'Queue', config: {}, mention: '' });
    inferred.push({ text: `${w.label} need a queue to take jobs from, so a Queue was added (not stated)`, ref: 'nodes.queue' });
  }
  let app = ofType('app')[0];
  const DATA = ['auth', 'search', 'cache', 'db', 'storage', 'external', 'queue'];
  const loose = nodes.some(n => ['cache', 'db', 'search', 'storage', 'external', 'auth', 'queue'].includes(n.type) && !hasIn(n.id) && !edges.some(e => e.from === n.id && nodes.find(x => x.id === e.to)?.type !== 'worker'));
  if (!app && loose) {
    app = { id: 'app', type: 'app', label: 'App service', config: {}, mention: '' };
    nodes.push(app);
    inferred.push({ text: 'No application server was named, so an App service sits between the entry and the data stores', ref: 'nodes.app' });
  }
  for (const t of DATA) for (const n of ofType(t)) {
    if (hasIn(n.id) || !app) continue;
    if (n.type === 'db' && ofType('cache').some(c => edges.some(e => e.from === c.id && e.to === n.id))) continue;
    edges.push({ from: app.id, to: n.id, stated: false });
    inferred.push({ text: `${app.label} calls ${n.label} (the connection was not stated)`, ref: `edges.${app.id}.${n.id}` });
  }
  for (const w of ofType('worker')) {
    if (!hasIn(w.id)) { const q = ofType('queue')[0]; if (q) { edges.push({ from: q.id, to: w.id, stated: false }); inferred.push({ text: `${w.label} take jobs from ${q.label} (not stated)`, ref: `edges.${q.id}.${w.id}` }); } }
    const db = ofType('db')[0];
    if (db && !edges.some(e => e.from === w.id)) { edges.push({ from: w.id, to: db.id, stated: false }); inferred.push({ text: `${w.label} write to ${db.label} (not stated)`, ref: `edges.${w.id}.${db.id}` }); }
  }
  const FRONT = ['cdn', 'ratelimit', 'lb', 'gateway'];
  const core = app || ofType('gateway')[0];
  if (core) {
    const fronts = FRONT.flatMap(ofType).filter(n => n !== core && !hasIn(n.id) && !edges.some(e => e.from === n.id));
    if (fronts.length) {
      const into = edges.filter(e => e.to === core.id);
      for (let k = 1; k < fronts.length; k++) edges.push({ from: fronts[k - 1].id, to: fronts[k].id, stated: false });
      for (const e of into) e.to = fronts[0].id;
      edges.push({ from: fronts[fronts.length - 1].id, to: core.id, stated: false });
      inferred.push({ text: `${fronts.map(n => n.label).join(' -> ')} placed in front of ${core.label} (the order was not stated)`, ref: 'edges' });
    }
  }
  // calls run in connection order: check the cache before the database, and so on
  const rank = id => { const k = DATA.indexOf(nodes.find(n => n.id === id)?.type); return k < 0 ? -1 : k; };
  const groupsByFrom = new Map();
  edges.forEach((e, k) => { if (!groupsByFrom.has(e.from)) groupsByFrom.set(e.from, []); groupsByFrom.get(e.from).push(k); });
  const sorted = [...edges];
  for (const idxs of groupsByFrom.values()) { const g = idxs.map(k => edges[k]).sort((a, b) => rank(a.to) - rank(b.to)); idxs.forEach((k, j) => { sorted[k] = g[j]; }); }
  const reordered = sorted.some((e, k) => e !== edges[k]);
  edges.splice(0, edges.length, ...sorted);
  if (reordered) for (const c of ofType('cache')) {
    const caller = edges.find(e => e.to === c.id)?.from, dbE = edges.find(e => e.from === caller && rank(e.to) === DATA.indexOf('db'));
    if (dbE) inferred.push({ text: `${c.label} is checked before ${nodes.find(n => n.id === dbE.to).label} (cache-aside)`, ref: `edges.${caller}` });
  }
  const redis = nodes.find(n => /redis/i.test(n.label));
  if (redis && redis.type === 'cache') {
    inferred.push({ text: 'Redis is treated as a cache (cache-aside); it could also be a queue or a database', ref: `nodes.${redis.id}.type` });
    questions.push({ key: 'redisRole', text: 'Is Redis a cache here? If it holds jobs (BullMQ) or data, change it after creating the draft.' });
  }
  if (rateRps === undefined) questions.push({ key: 'rate', text: 'How many requests per second arrive at a busy moment?' });
  if (app && app.config.instances === undefined) questions.push({ key: 'appInstances', text: `How many ${app.label} instances run?` });
  for (const c of ofType('cache')) if (c.config.hitP === undefined) questions.push({ key: 'cacheHitPct', text: `What share of reads does ${c.label} answer (hit ratio %)?` });
  for (const w of ofType('worker')) questions.push({ key: 'workers', text: `How many ${w.label} run?` });
  if (ofType('db').length > 1) inferred.push({ text: `Several databases were named (${ofType('db').map(n => n.label).join(', ')}); calls go to each one in turn`, ref: 'nodes' });
  return { nodes, edges, facts, inferred, unsupported, questions, rateRps };
}
export const NUMERIC_QUESTIONS = new Set(['rate', 'appInstances', 'cacheHitPct', 'workers']);

/** Combine a read description with the answers to its questions into a design. */
export function draftFromDescription(read, answers = {}, title = 'Described system') {
  const nodes = read.nodes.map(n => ({ id: n.id, type: n.type, label: n.label, config: { ...n.config } })), user = [];
  const app = nodes.find(n => n.type === 'app');
  if (app && num(answers.appInstances) !== undefined) { app.config.instances = num(answers.appInstances); user.push({ text: `${app.label}: ${app.config.instances} instances`, ref: `nodes.${app.id}.config.instances` }); }
  for (const c of nodes.filter(n => n.type === 'cache')) if (num(answers.cacheHitPct) !== undefined) { c.config.hitP = Math.min(1, num(answers.cacheHitPct) / 100); user.push({ text: `${c.label}: ${num(answers.cacheHitPct)}% hits`, ref: `nodes.${c.id}.config.hitP` }); }
  for (const w of nodes.filter(n => n.type === 'worker')) if (num(answers.workers) !== undefined) { w.config.instances = num(answers.workers); user.push({ text: `${w.label}: ${w.config.instances} instances`, ref: `nodes.${w.id}.config.instances` }); }
  const src = { title, nodes, edges: read.edges.map(e => ({ from: e.from, to: e.to })), workload: {} };
  const rate = num(answers.rate) ?? read.rateRps;
  if (rate !== undefined) src.workload.rateRps = rate;
  const out = fromObject(src);
  if (out.doc) {
    let k = out.doc.assumptions.length;
    const tag = (list, source) => list.map(x => ({ id: 'a' + ++k, text: x.text, source, ref: x.ref }));
    out.doc.assumptions = [...tag(read.facts, 'description'), ...tag(user, 'user'), ...tag(read.inferred, 'inferred'), ...out.doc.assumptions];
  }
  return out;
}
