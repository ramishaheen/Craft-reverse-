// Small DOM helpers shared by both labs. No framework.

/** Escape text for safe use inside HTML strings. */
export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/**
 * Create an element. h('div.card#id', {onclick, style:{}, dataset:{}, html:'..'}, ...children)
 * Children may be strings, nodes, arrays, null/false (skipped).
 */
export function h(tag, props, ...kids) {
  const m = /^([a-z0-9-]+)?((?:[.#][\w-]+)*)$/i.exec(tag) || [];
  const el = document.createElement(m[1] || 'div');
  for (const part of (m[2] || '').match(/[.#][\w-]+/g) || []) {
    if (part[0] === '.') el.classList.add(part.slice(1));
    else el.id = part.slice(1);
  }
  if (props && (typeof props !== 'object' || props instanceof Node || Array.isArray(props))) {
    kids.unshift(props);
    props = null;
  }
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'style' && typeof v === 'object') Object.assign(el.style, v);
    else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k === 'html') el.innerHTML = v;
    else if (k === 'text') el.textContent = v;
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v === true) el.setAttribute(k, '');
    else el.setAttribute(k, v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const k of kids) {
    if (k == null || k === false) continue;
    if (Array.isArray(k)) append(el, k);
    else el.append(k instanceof Node ? k : document.createTextNode(String(k)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/** Read a CSS custom property (theme token) as a string. */
export function token(name, el = document.documentElement) {
  return getComputedStyle(el).getPropertyValue(name).trim();
}

/** Show a short message in the corner. */
export function toast(msg, ms = 2600) {
  let box = document.querySelector('.toasts');
  if (!box) { box = h('div.toasts', { role: 'status', 'aria-live': 'polite' }); document.body.append(box); }
  const t = h('div.toast', msg);
  box.append(t);
  setTimeout(() => t.remove(), ms);
}

/** Simple modal. Returns a close function. */
export function modal(title, body, { onClose } = {}) {
  const close = () => { back.remove(); document.removeEventListener('keydown', onKey); onClose?.(); };
  const onKey = e => { if (e.key === 'Escape') close(); };
  const back = h('div.modal-back', { onclick: e => { if (e.target === back) close(); } },
    h('div.modal', { role: 'dialog', 'aria-modal': 'true', 'aria-label': title },
      h('div', { style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' } },
        h('h2', { style: { flex: 1, margin: 0 } }, title),
        h('button.btn.ghost.icon', { 'aria-label': 'Close', onclick: close }, '✕')),
      body));
  document.body.append(back);
  document.addEventListener('keydown', onKey);
  back.querySelector('button')?.focus();
  return close;
}

export const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, t) => a + (b - a) * t;
export const rand = (a = 0, b = 1) => a + Math.random() * (b - a);
export const pick = arr => arr[Math.floor(Math.random() * arr.length)];
