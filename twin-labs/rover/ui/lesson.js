// The instruction panel's content for one step: parts lists, instructions to tick off, pin maps, code,
// troubleshooting and notes. Hovering a row lights its parts up in 3D.

import { h } from '../../js/core/dom.js';
import { STEPS, pick, BOARDS, SKETCHES } from '../data/steps.js';
import { t } from '../i18n/index.js';
import { codeView } from './code-view.js';

const ICON_PLAY = '<svg viewBox="0 0 24 24" width="12" height="12" aria-hidden="true"><path d="M7 5l12 7-12 7z" fill="currentColor"/></svg>';
const ICON_INFO = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="9"/><path d="M12 11v6M12 7.5v.5" stroke-linecap="round"/></svg>';
const ICON_CHECK = '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="3"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';

/**
 * ctx: { board, step, checks:Set, onToggle(key), onHover(parts|null), onInspect(part), onPlayPhase(i), phase }
 * Returns { el, setPhase(i), codeViews }
 */
export function renderLesson(ctx) {
  const { board, step } = ctx;
  const s = STEPS[step];
  const el = h('div.rv-lesson-content');
  const codeViews = [];
  const doRows = [];

  el.append(h('p.rv-intro', pick(s.intro, board)));

  const hoverable = (row, parts) => {
    if (!parts?.length) return;
    row.addEventListener('pointerenter', () => ctx.onHover(parts));
    row.addEventListener('pointerleave', () => ctx.onHover(null));
    row.addEventListener('focusin', () => ctx.onHover(parts));
    row.addEventListener('focusout', () => ctx.onHover(null));
  };

  const section = (title, count) => {
    const head = h('h3.rv-h', h('span', title), count ? h('span.rv-count', count) : null);
    el.append(head);
    return head;
  };

  // parts lists
  if (s.bom || s.need) {
    const list = s.bom || pick(s.need, board);
    const checkable = !!s.checkBom;
    const keys = list.map((_, i) => `${board}/${s.id}/bom/${i}`);
    const done = () => keys.filter(k => ctx.checks.has(k)).length;
    const head = section(checkable ? t('lesson.bom') : t('lesson.need'), checkable ? `${done()} / ${keys.length}` : null);
    const ul = h('ul.rv-rows');
    list.forEach(([qty, text, parts], i) => {
      const key = keys[i];
      const label = pick(text, board);
      const row = h('li.rv-row' + (checkable ? '.check' : ''), { tabindex: checkable ? null : '0' });
      if (checkable) {
        const cb = h('button.rv-tick', { type: 'button', role: 'checkbox', 'aria-checked': String(ctx.checks.has(key)), 'aria-label': t('lesson.tick', { item: label }), html: ICON_CHECK });
        const toggle = () => {
          const on = ctx.onToggle(key);
          cb.setAttribute('aria-checked', String(on));
          row.classList.toggle('done', on);
          head.querySelector('.rv-count').textContent = `${done()} / ${keys.length}`;
        };
        cb.addEventListener('click', e => { e.stopPropagation(); toggle(); });
        row.addEventListener('click', e => { if (!e.target.closest('.rv-info')) toggle(); });
        row.classList.toggle('done', ctx.checks.has(key));
        row.append(cb);
      }
      row.append(h('span.rv-qty', `${qty}×`), h('span.rv-row-text', label));
      const first = parts?.find(p => p !== 'esp32' || board === 'esp32');
      const inspect = parts && (board === 'uno' ? parts.filter(p => p !== 'esp32' && p !== 'npn' && p !== 'divider') : parts.filter(p => p !== 'uno' && p !== 'shield'))[0];
      if (inspect || first) row.append(h('button.rv-info', { type: 'button', title: t('lesson.details'), 'aria-label': t('lesson.details'), html: ICON_INFO, onclick: e => { e.stopPropagation(); ctx.onInspect(inspect || first); } }));
      hoverable(row, parts);
      ul.append(row);
    });
    el.append(ul);
  }

  // tools
  if (s.tools) {
    section(t('lesson.tools'));
    el.append(h('ul.rv-toollist', s.tools.map(([name, use]) => h('li', h('b', name), h('span', use)))));
  }

  // instructions
  const doList = pick(s.do, board);
  if (doList?.length) {
    const keys = doList.map((_, i) => `${board}/${s.id}/do/${i}`);
    const done = () => keys.filter(k => ctx.checks.has(k)).length;
    const head = section(t('lesson.do'), `${done()} / ${keys.length}`);
    const ol = h('ol.rv-do');
    doList.forEach((d, i) => {
      const key = keys[i];
      const text = pick(d.text, board);
      const num = h('button.rv-num', { type: 'button', role: 'checkbox', 'aria-checked': String(ctx.checks.has(key)), 'aria-label': t('lesson.tick', { item: `${i + 1}` }) }, h('span', String(i + 1)), h('i', { html: ICON_CHECK }));
      const li = h('li.rv-do-item', num, h('p', text));
      li.classList.toggle('done', ctx.checks.has(key));
      num.addEventListener('click', () => {
        const on = ctx.onToggle(key);
        num.setAttribute('aria-checked', String(on));
        li.classList.toggle('done', on);
        head.querySelector('.rv-count').textContent = `${done()} / ${keys.length}`;
      });
      if (!s.code) li.append(h('button.rv-play', { type: 'button', title: t('lesson.playPhase'), 'aria-label': t('lesson.playPhase'), html: ICON_PLAY, onclick: () => ctx.onPlayPhase(i) }));
      hoverable(li, d.parts);
      doRows.push(li);
      ol.append(li);
    });
    el.append(ol);
  }

  // pin map
  if (s.pins) {
    section(t('lesson.pinmap', { board: BOARDS[board].name }));
    const ul = h('ul.rv-rows.pins');
    for (const [text, pin, parts] of pick(s.pins, board)) {
      const row = h('li.rv-row', { tabindex: '0' }, h('span.rv-row-text', text), h('span.rv-pin.mono', pin));
      hoverable(row, parts);
      row.addEventListener('click', () => ctx.onInspect(parts[0]));
      ul.append(row);
    }
    el.append(ul);
  }

  // code
  if (s.code) {
    section(t('lesson.sketches'));
    const list = pick(s.sketches, board).map(x => ({ ...x, code: SKETCHES[x.key] }));
    const cv = codeView(list, { maxHeight: '420px' });
    codeViews.push(cv);
    el.append(cv.el);
    section(t('lesson.explain'));
    el.append(h('dl.rv-explain', pick(s.explain, board).map(([k, v]) => [h('dt', k), h('dd', v)])));
    section(t('lesson.fixes'));
    el.append(h('div.rv-fixes', pick(s.fixes, board).map(([q, a]) => h('details', h('summary', q), h('p', a)))));
  }

  // note
  const note = pick(s.note, board);
  if (note) el.append(h('aside.rv-note', h('b', t('lesson.note')), h('p', note)));

  return {
    el,
    codeViews,
    setPhase(i) { doRows.forEach((r, k) => r.classList.toggle('now', k === i)); },
  };
}

/** The panel that replaces the lesson while a part's details are open. */
export function renderPart(part, info, board, { onBack, onGo, stepIndex }) {
  const what = pick(info.what, board);
  const specs = pick(info.specs, board) || [];
  const si = STEPS.findIndex(s => s.id === info.step);
  return h('section.rv-partview', { 'aria-labelledby': 'rv-part-name' },
    h('header.rv-partview-bar',
      h('button.btn.ghost.sm', { type: 'button', onclick: onBack }, '← ', t('part.back')),
      h('span.kbd', 'Esc')),
    h('div.rv-partview-body',
      h('div.eyebrow.rv-amber', info.group),
      h('h2#rv-part-name', info.name),
      h('p.rv-intro', what),
      h('h3.rv-h', h('span', t('part.specs'))),
      h('dl.rv-specs', specs.map(([k, v]) => [h('dt', k), h('dd', pick(v, board))]))),
    h('footer.rv-partview-foot',
      h('span.muted', t('part.fitted', { n: String(si + 1).padStart(2, '0'), title: pick(STEPS[si]?.title, board) || '' })),
      si !== stepIndex ? h('button.btn.amber', { type: 'button', onclick: () => onGo(si) }, t('part.go')) : null));
}
