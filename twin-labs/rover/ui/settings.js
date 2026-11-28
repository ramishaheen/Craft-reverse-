// The settings dialog: where the drive step connects, display and sound options, quality, and resets.

import { h, modal } from '../../js/core/dom.js';
import { t } from '../i18n/index.js';

export const DEFAULT_SETTINGS = {
  conn: 'sim', url: 'ws://192.168.4.1:81/', sound: true, beam: true, follow: true, labels: true, animate: true, quality: 'high',
};

export function openSettings(current, { onApply, onResetSim, onResetProgress, linkStatus, langs = [], lang = 'en', onLang }) {
  const s = { ...current };
  const seg = (key, options) => {
    const wrap = h('div.seg.rv-seg-wide', { role: 'radiogroup' });
    const paint = () => [...wrap.children].forEach(b => b.setAttribute('aria-pressed', String(b.dataset.v === s[key])));
    for (const [v, label] of options) wrap.append(h('button', { type: 'button', role: 'radio', dataset: { v }, onclick: () => { s[key] = v; paint(); sync(); } }, label));
    paint();
    return wrap;
  };
  const row = (key, label) => {
    const input = h('input', { type: 'checkbox' });
    input.checked = !!s[key];
    input.addEventListener('change', () => { s[key] = input.checked; });
    return h('label.rv-set-row', h('span', label), h('span.toggle', input, h('span')));
  };
  const url = h('input.input.mono', { type: 'text', spellcheck: 'false', autocomplete: 'off', placeholder: DEFAULT_SETTINGS.url, value: s.url });
  url.addEventListener('input', () => { s.url = url.value.trim(); });
  const urlField = h('label.rv-set-field', h('span', t('set.address')), url);
  const hint = h('p.faint.rv-set-hint');
  function sync() {
    urlField.hidden = s.conn !== 'ws';
    let msg = s.conn === 'ws' ? t('set.wsHint') : t('set.simHint');
    if (s.conn === 'ws' && location.protocol === 'https:') msg += ' ' + t('set.httpsWarn');
    if (s.conn === 'ws' && linkStatus) msg += ' ' + t('set.status', { status: linkStatus() });
    hint.textContent = msg;
  }

  let close;
  const langSel = h('select.input', { 'aria-label': t('header.language') }, langs.map(l => h('option', { value: l.code, selected: l.code === lang }, l.native)));
  langSel.addEventListener('change', () => { onLang?.(langSel.value); close(); });
  const body = h('form.rv-settings', { onsubmit: e => { e.preventDefault(); onApply(s); close(); } },
    h('section.rv-set-lang', h('h3.rv-h', h('span', t('header.language'))), langSel),
    h('section', h('h3.rv-h', h('span', t('set.conn'))), seg('conn', [['sim', t('set.sim')], ['ws', t('set.real')]]), urlField, hint),
    h('section', h('h3.rv-h', h('span', t('set.display'))),
      row('sound', t('set.sound')), row('beam', t('set.beam')), row('follow', t('set.follow')), row('labels', t('set.labels')), row('animate', t('set.animate'))),
    h('section', h('h3.rv-h', h('span', t('set.quality'))), seg('quality', [['low', t('set.qLow')], ['high', t('set.qHigh')]]), h('p.faint.rv-set-hint', t('set.qualityHint'))),
    h('footer.rv-set-foot',
      h('button.btn.ghost', { type: 'button', onclick: () => { onResetSim(); close(); } }, t('set.resetSim')),
      h('button.btn.danger', { type: 'button', onclick: () => { if (confirm(t('set.resetProgressAsk'))) { onResetProgress(); close(); } } }, t('set.resetProgress')),
      h('span', { style: { flex: 1 } }),
      h('button.btn.amber', { type: 'submit' }, t('set.apply'))));
  sync();
  close = modal(t('set.title'), body);
  document.querySelector('.modal')?.classList.add('rv-modal');
  return close;
}
