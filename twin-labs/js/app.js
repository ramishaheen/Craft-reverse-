// Twin Labs shell: theme, routing and the lab chooser.
// Routes:  #/            home with the two lab buttons
//          #/rover...    Rover Lab   (rover/index.js)
//          #/systems...  Systems Lab (systems/index.js)
// Each lab module exports mount(el, rest, ctx) -> { update(rest), destroy() }.

import { h, $, $$ } from './core/dom.js';
import * as store from './core/store.js';

const main = $('#main');
const headerSlot = $('#header-slot');
let current = null; // { lab, view }

// ---------- theme ----------
const mql = matchMedia('(prefers-color-scheme: light)');
function applyTheme(choice) {
  const t = choice === 'auto' ? (mql.matches ? 'light' : 'dark') : choice;
  document.documentElement.setAttribute('data-theme', t);
  for (const b of $$('#theme-seg button')) b.setAttribute('aria-pressed', String(b.dataset.themeChoice === choice));
  window.dispatchEvent(new CustomEvent('themechange', { detail: { theme: t } }));
}
let themeChoice = store.get('theme', 'dark');
applyTheme(themeChoice);
$('#theme-seg').addEventListener('click', e => {
  const b = e.target.closest('button[data-theme-choice]');
  if (!b) return;
  // On narrow screens only the active choice is visible, so pressing it cycles to the next one.
  const order = ['auto', 'light', 'dark'];
  themeChoice = b.dataset.themeChoice === themeChoice && matchMedia('(max-width: 560px)').matches
    ? order[(order.indexOf(themeChoice) + 1) % order.length]
    : b.dataset.themeChoice;
  store.set('theme', themeChoice);
  applyTheme(themeChoice);
});
mql.addEventListener('change', () => { if (themeChoice === 'auto') applyTheme('auto'); });

// ---------- routing ----------
const LABS = {
  rover: () => import('../rover/index.js'),
  systems: () => import('../systems/index.js'),
};

function parse() {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query = ''] = raw.split('?');
  const parts = path.split('/').filter(Boolean);
  return { lab: parts[0] || '', rest: parts.slice(1), query: new URLSearchParams(query) };
}

async function route() {
  const { lab, rest, query } = parse();
  for (const t of $$('.lab-tab')) t.setAttribute('aria-current', t.dataset.lab === lab ? 'page' : 'false');
  document.body.dataset.lab = lab || 'home';

  if (current && current.lab === lab && current.view?.update) {
    current.view.update(rest, query);
    return;
  }
  current?.view?.destroy?.();
  current = null;
  headerSlot.replaceChildren();
  main.replaceChildren();

  if (!LABS[lab]) {
    renderHome();
    current = { lab: '', view: null };
    document.title = 'Twin Labs — Rover Lab & Systems Lab';
    return;
  }
  main.append(h('div.loading', h('div.spinner', { 'aria-label': 'Loading' })));
  try {
    const mod = await LABS[lab]();
    if (parse().lab !== lab) return; // navigated away while loading
    main.replaceChildren();
    const view = mod.mount(main, rest, { query, headerSlot, navigate });
    current = { lab, view };
  } catch (err) {
    console.error(err);
    main.replaceChildren(h('div.error-box', h('h2', 'This lab could not load'), h('p.muted', String(err?.message || err))));
  }
}

export function navigate(hash) {
  if (location.hash === hash) route(); else location.hash = hash;
}

window.addEventListener('hashchange', route);
queueMicrotask(route); // after the rest of this module (art constants) has been evaluated

// ---------- home ----------
function renderHome() {
  const card = (lab, title, eyebrow, blurb, points, art, cls) =>
    h('a.lab-card', { href: `#/${lab}`, dataset: { lab } },
      h('div.art', { html: art }),
      h('div', h('div.eyebrow', { style: { color: lab === 'rover' ? 'var(--amber)' : 'var(--teal)' } }, eyebrow)),
      h('h2', title),
      h('p.muted', blurb),
      h('ul', points.map(p => h('li', p))),
      h(`span.btn.lg.go.${cls}`, `Open ${title} →`));

  main.append(h('section.home',
    h('div.home-hero',
      h('h1', 'Two labs. ', h('span.grad', 'Build it, then break it.')),
      h('p', 'Assemble a robot car part by part in 3D and drive it, or push traffic through live models of the systems behind big websites and watch what fails.')),
    h('div.lab-cards',
      card('rover', 'Rover Lab', 'Hardware · Build & drive',
        'Build a four-wheel robot car with an Arduino UNO or an ESP32, one step at a time in 3D, then drive it in the simulator.',
        ['10 guided steps, from the parts mat to the first drive', 'Every part in 3D: rotate, zoom, explode, inspect', 'Wiring diagrams and ready-to-flash code for both boards', 'Driving simulator with obstacle avoidance'],
        ROVER_ART, 'amber'),
      card('systems', 'Systems Lab', 'Software · Simulate & break',
        '56 live simulations of caching, load balancing, queues, payments and famous system designs, with numbers that react.',
        ['Push traffic, crash servers, flush caches', 'Guided predict–run–explain experiments', '168 quiz questions with explanations', 'Learning paths and a build-your-own-system canvas'],
        SYSTEMS_ART, 'primary')),
    h('p.home-foot', 'Everything runs in your browser. Simulated numbers are simplified models chosen to make behaviour visible.')));
}

const ROVER_ART = `<svg viewBox="0 0 400 190" aria-hidden="true">
  <defs><pattern id="hg" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="var(--grid)" stroke-width="1"/></pattern></defs>
  <rect width="400" height="190" fill="url(#hg)"/>
  <rect x="95" y="78" width="210" height="48" rx="10" fill="var(--surface-3)" stroke="var(--line-2)" stroke-width="2"/>
  <rect x="110" y="62" width="180" height="18" rx="6" fill="none" stroke="var(--teal)" stroke-width="2" opacity=".8"/>
  <rect x="150" y="84" width="70" height="30" rx="4" fill="var(--accent)" opacity=".85"/>
  <rect x="232" y="86" width="40" height="26" rx="3" fill="var(--red)" opacity=".8"/>
  <rect x="180" y="40" width="44" height="18" rx="4" fill="var(--surface-2)" stroke="var(--text-3)" stroke-width="2"/>
  <circle cx="192" cy="49" r="6" fill="none" stroke="var(--text-2)" stroke-width="2"/><circle cx="212" cy="49" r="6" fill="none" stroke="var(--text-2)" stroke-width="2"/>
  <g fill="#1d2433" stroke="var(--text-3)" stroke-width="2"><circle cx="120" cy="132" r="24"/><circle cx="280" cy="132" r="24"/></g>
  <g fill="var(--amber)"><circle cx="120" cy="132" r="11"/><circle cx="280" cy="132" r="11"/></g>
  <path d="M232 38c10-8 22-8 32 0M240 28c8-5 16-5 24 0" fill="none" stroke="var(--teal)" stroke-width="2.5" stroke-linecap="round"/>
</svg>`;

const SYSTEMS_ART = `<svg viewBox="0 0 400 190" aria-hidden="true">
  <defs><pattern id="sg" width="20" height="20" patternUnits="userSpaceOnUse"><path d="M20 0H0V20" fill="none" stroke="var(--grid)" stroke-width="1"/></pattern></defs>
  <rect width="400" height="190" fill="url(#sg)"/>
  <g fill="var(--surface-2)" stroke="var(--accent-2)" stroke-width="2">
    <rect x="18" y="76" width="74" height="38" rx="7"/><rect x="140" y="76" width="86" height="38" rx="7"/>
    <rect x="280" y="22" width="100" height="32" rx="6"/><rect x="280" y="79" width="100" height="32" rx="6"/><rect x="280" y="136" width="100" height="32" rx="6"/>
  </g>
  <g stroke="var(--line-2)" stroke-width="2"><path d="M92 95h48"/><path d="M226 95L280 38M226 95h54M226 95l54 57"/></g>
  <rect x="281" y="23" width="62" height="30" rx="5" fill="var(--green)" opacity=".25"/>
  <rect x="281" y="80" width="92" height="30" rx="5" fill="var(--red)" opacity=".3"/>
  <rect x="281" y="137" width="40" height="30" rx="5" fill="var(--green)" opacity=".25"/>
  <g fill="var(--green)"><circle cx="112" cy="95" r="4"/><circle cx="252" cy="66" r="4"/><circle cx="262" cy="123" r="4"/></g><circle cx="250" cy="95" r="4" fill="var(--red)"/>
  <g fill="var(--text)" font-family="system-ui" font-size="12" font-weight="700" text-anchor="middle">
    <text x="55" y="99">Users</text><text x="183" y="99">Balancer</text><text x="312" y="42">web-1</text><text x="312" y="99">web-2</text><text x="312" y="156">web-3</text>
  </g>
</svg>`;
