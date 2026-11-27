// Control panel builder for simulations. Every control returns a handle { el, get(), set(v, silent) }.
// set(v, true) changes the value without firing the callback (used by guided experiments and reset).

import { h } from '../../js/core/dom.js';

let uid = 0;
const nextId = p => `${p}-${++uid}`;

export function createPanel(host) {
  const panel = h('div.ctl-panel');
  host.append(panel);
  const touchHandlers = new Set(); // called on any user change (guided experiments reset on manual input)
  const touched = () => { for (const f of touchHandlers) f(); };

  const api = {
    el: panel,
    onUserChange(fn) { touchHandlers.add(fn); return () => touchHandlers.delete(fn); },

    heading(text) { const el = h('div.ctl-heading', text); panel.append(el); return { el }; },
    note(text) { const el = h('p.ctl-note', { html: text }); panel.append(el); return { el, set: t => { el.innerHTML = t; } }; },

    /**
     * Slider. Either numeric (min,max,step) or over a list of `values` (the slider moves an index).
     * format(value) -> label shown on the right.
     */
    slider(label, { min = 0, max = 100, step = 1, value = 50, values, format = v => String(v), onInput, hint } = {}) {
      const id = nextId('rng');
      const out = h('output', { for: id });
      const input = h('input', { type: 'range', id });
      if (values) { input.min = 0; input.max = values.length - 1; input.step = 1; }
      else { input.min = min; input.max = max; input.step = step; }
      const toVal = () => values ? values[Number(input.value)] : Number(input.value);
      const paint = () => {
        const p = (Number(input.value) - Number(input.min)) / ((Number(input.max) - Number(input.min)) || 1) * 100;
        input.style.setProperty('--pct', p + '%');
        out.textContent = format(toVal());
      };
      const set = (v, silent) => {
        if (values) { let best = 0; values.forEach((x, i) => { if (Math.abs(x - v) < Math.abs(values[best] - v)) best = i; }); input.value = best; }
        else input.value = v;
        paint();
        if (!silent) onInput?.(toVal());
      };
      input.addEventListener('input', () => { paint(); onInput?.(toVal()); touched(); });
      const el = h('div.ctl', h('div.ctl-head', h('label', { for: id }, label), out), input, hint && h('p.ctl-hint', hint));
      panel.append(el);
      set(value, true);
      return { el, input, get: toVal, set };
    },

    stepper(label, { min = 0, max = 10, value = 1, step = 1, onChange, hint, format = v => String(v) } = {}) {
      let v = value;
      const out = h('output');
      const minus = h('button.btn', { type: 'button', 'aria-label': `Fewer: ${label}` }, '−');
      const plus = h('button.btn', { type: 'button', 'aria-label': `More: ${label}` }, '+');
      const paint = () => { out.textContent = format(v); minus.disabled = v <= min; plus.disabled = v >= max; };
      const set = (n, silent) => { v = Math.max(min, Math.min(max, n)); paint(); if (!silent) onChange?.(v); };
      minus.onclick = () => { if (v > min) { set(v - step); touched(); } };
      plus.onclick = () => { if (v < max) { set(v + step); touched(); } };
      const el = h('div.ctl', h('div.ctl-head', h('label', label)),
        h('div.ctl-row', h('div.stepper', minus, out, plus), hint && h('span.ctl-hint', hint)));
      panel.append(el);
      paint();
      return { el, get: () => v, set, setLimits(a, b) { min = a; max = b; paint(); }, minus, plus };
    },

    /** Segmented buttons. options: [[value, label], ...] */
    seg(label, { options, value, onChange, hint } = {}) {
      let v = value ?? options[0][0];
      const seg = h('div.seg', { role: 'group', 'aria-label': label });
      const btns = options.map(([val, lab]) => {
        const b = h('button', { type: 'button', 'aria-pressed': String(val === v) }, lab);
        b.onclick = () => { set(val); touched(); };
        seg.append(b);
        return [val, b];
      });
      const set = (val, silent) => {
        v = val;
        for (const [x, b] of btns) b.setAttribute('aria-pressed', String(x === val));
        if (!silent) onChange?.(val);
      };
      const el = h('div.ctl', label && h('div.ctl-head', h('label', label)), seg, hint && h('p.ctl-hint', hint));
      panel.append(el);
      return { el, get: () => v, set };
    },

    toggle(label, { value = false, onChange, hint } = {}) {
      const id = nextId('tg');
      const input = h('input', { type: 'checkbox', id, role: 'switch' });
      input.checked = value;
      input.addEventListener('change', () => { onChange?.(input.checked); touched(); });
      const el = h('div.ctl.ctl-toggle', h('div.ctl-row', h('label', { for: id }, label), h('span.toggle', input, h('span'))), hint && h('p.ctl-hint', hint));
      panel.append(el);
      return { el, get: () => input.checked, set: (b, silent) => { input.checked = b; if (!silent) onChange?.(b); } };
    },

    select(label, { options, value, onChange } = {}) {
      const id = nextId('sel');
      const sel = h('select.input', { id }, options.map(([v, l]) => h('option', { value: v }, l)));
      sel.value = value ?? options[0][0];
      sel.addEventListener('change', () => { onChange?.(sel.value); touched(); });
      const el = h('div.ctl', h('div.ctl-head', h('label', { for: id }, label)), sel);
      panel.append(el);
      return { el, get: () => sel.value, set: (v, silent) => { sel.value = v; if (!silent) onChange?.(v); } };
    },

    /** A row of action buttons. items: [{ label, kind: 'primary'|'outline'|'ghost'|'danger', onClick, wide }] */
    buttons(items) {
      const row = h('div.ctl-buttons');
      const handles = items.map(it => {
        const b = h(`button.btn${it.kind ? '.' + it.kind : ''}`, { type: 'button' }, it.label);
        if (it.wide) b.classList.add('wide');
        b.onclick = () => { it.onClick?.(); touched(); };
        row.append(b);
        return b;
      });
      panel.append(row);
      return { el: row, buttons: handles };
    },

    /** Free-form element appended to the panel. */
    custom(el) { panel.append(el); return { el }; },
  };
  return api;
}
