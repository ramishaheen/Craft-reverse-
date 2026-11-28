// A sketch viewer: tabs, file name, copy and download, line numbers, highlighting, and marked lines.

import { h, toast } from '../../js/core/dom.js';
import { highlightLine } from '../code/index.js';
import { t } from '../i18n/index.js';

/**
 * sketches: [{ tab, file, code }]
 * Returns { el, mark(from, to), select(i) }
 */
export function codeView(sketches, { compact = false, maxHeight = null, onSelect } = {}) {
  let cur = 0;
  const tabs = h('div.rv-code-tabs', { role: 'tablist' });
  const file = h('span.rv-code-file.mono');
  const copyBtn = h('button.btn.sm.ghost', { type: 'button', onclick: () => copy() }, t('code.copy'));
  const dlBtn = h('button.btn.sm.ghost', { type: 'button', onclick: () => download() }, t('code.download'));
  const pre = h('pre.rv-pre', { tabindex: '0' });
  if (maxHeight) pre.style.maxHeight = maxHeight;
  const el = h('div.rv-code' + (compact ? '.compact' : ''),
    sketches.length > 1 || !compact ? tabs : null,
    h('div.rv-code-head', file, h('span', { style: { flex: 1 } }), copyBtn, dlBtn),
    pre);

  sketches.forEach((s, i) => tabs.append(h('button.rv-code-tab', { type: 'button', role: 'tab', 'aria-selected': String(i === 0), onclick: () => select(i) }, s.tab)));

  function render(markFrom = 0, markTo = -1) {
    const s = sketches[cur];
    file.textContent = s.file;
    const lines = s.code.replace(/\n$/, '').split('\n');
    pre.innerHTML = lines.map((l, i) => {
      const n = i + 1;
      const on = n >= markFrom && n <= markTo;
      return `<span class="rv-ln${on ? ' on' : ''}" data-n="${n}"><i>${n}</i>${highlightLine(l) || ' '}</span>`;
    }).join('');
  }

  function select(i) {
    cur = i;
    [...tabs.children].forEach((b, k) => b.setAttribute('aria-selected', String(k === i)));
    render();
    onSelect?.(i);
  }

  function mark(from, to) {
    render(from, to);
    const first = pre.querySelector('.rv-ln.on');
    if (first) pre.scrollTop = Math.max(0, first.offsetTop - pre.clientHeight / 3);
  }

  async function copy() {
    const text = sketches[cur].code;
    try { await navigator.clipboard.writeText(text); toast(t('code.copied', { file: sketches[cur].file })); }
    catch {
      const ta = h('textarea', { style: { position: 'fixed', opacity: '0' } }, text);
      document.body.append(ta); ta.select();
      try { document.execCommand('copy'); toast(t('code.copied', { file: sketches[cur].file })); } catch { toast(t('code.copyFailed')); }
      ta.remove();
    }
  }

  function download() {
    const s = sketches[cur];
    const url = URL.createObjectURL(new Blob([s.code], { type: 'text/plain' }));
    const a = h('a', { href: url, download: s.file });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  render();
  return { el, mark, select, current: () => cur };
}
