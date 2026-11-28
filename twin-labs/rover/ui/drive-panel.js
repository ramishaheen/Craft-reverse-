// Drive controls for step 10: direction pad, speed, mode, LED / buzzer / servo, and the serial monitor.

import { h } from '../../js/core/dom.js';
import { t } from '../i18n/index.js';

const tri = d => `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="${{ up: 'M12 6l7 11H5z', down: 'M12 18L5 7h14z', left: 'M6 12l11-7v14z', right: 'M18 12L7 19V5z' }[d]}" fill="currentColor"/></svg>`;

export function createDrivePanel({ send, hold }) {
  const pads = {};
  const pad = (dir, cls, icon, label) => {
    const b = h(`button.rv-pad.${cls}`, { type: 'button', 'aria-label': label, title: label, html: icon });
    const start = e => { e.preventDefault(); b.setPointerCapture?.(e.pointerId); hold(dir); };
    const end = () => hold(null, dir);
    b.addEventListener('pointerdown', start);
    b.addEventListener('pointerup', end);
    b.addEventListener('pointercancel', end);
    b.addEventListener('lostpointercapture', end);
    b.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hold(dir); } });
    b.addEventListener('keyup', e => { if (e.key === 'Enter' || e.key === ' ') hold(null, dir); });
    pads[dir] = b;
    return b;
  };
  const stop = h('button.rv-pad.stop', { type: 'button', 'aria-label': t('drive.stop'), title: t('drive.stop'), html: '<svg viewBox="0 0 24 24" width="16" height="16"><rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor"/></svg>', onclick: () => { hold(null); send({ cmd: 'drive', dir: 'stop' }); } });
  const dpad = h('div.rv-dpad', { role: 'group', 'aria-label': t('drive.title') },
    pad('forward', 'up', tri('up'), t('drive.fwd')),
    pad('left', 'left', tri('left'), t('drive.left')),
    stop,
    pad('right', 'right', tri('right'), t('drive.right')),
    pad('backward', 'down', tri('down'), t('drive.back')));

  const speedOut = h('output.rv-big', '70');
  const speed = h('input', { type: 'range', min: '0', max: '100', step: '5', value: '70', 'aria-label': t('drive.speed') });
  const setPct = (el, v, max) => el.style.setProperty('--pct', `${(v / max) * 100}%`);
  speed.addEventListener('input', () => { speedOut.textContent = speed.value; setPct(speed, speed.value, 100); send({ cmd: 'speed', value: +speed.value }); });

  const modeBtns = {};
  const modeSeg = h('div.seg.rv-mode', { role: 'radiogroup', 'aria-label': t('drive.mode') },
    ['manual', 'auto', 'stop'].map((m, i) => (modeBtns[m] = h('button', { type: 'button', role: 'radio', title: `${t('mode.' + m)} (${i + 1})`, onclick: () => send({ cmd: 'mode', value: m }) }, t('mode.' + m)))));

  const toggle = (id, label, cmd, dotCls) => {
    const input = h('input', { type: 'checkbox', id, 'aria-label': label });
    input.addEventListener('change', () => send({ cmd, value: input.checked }));
    const tile = h('label.rv-act', { for: id }, h(`span.rv-dot.${dotCls}`), h('span', label), h('span.toggle', input, h('span')));
    return { tile, input };
  };
  const led = toggle('rv-led', t('drive.led'), 'led', 'led');
  const buz = toggle('rv-buzzer', t('drive.buzzer'), 'buzzer', 'buzzer');
  const servoOut = h('output.rv-big', '90°');
  const servo = h('input', { type: 'range', min: '0', max: '180', step: '1', value: '90', 'aria-label': t('drive.servo') });
  servo.addEventListener('input', () => { servoOut.textContent = `${servo.value}°`; setPct(servo, servo.value, 180); send({ cmd: 'servo', value: +servo.value }); });
  setPct(speed, 70, 100); setPct(servo, 90, 180);

  const log = h('div.rv-serial', { role: 'log', 'aria-label': t('drive.serial'), tabindex: '0' });
  const clear = h('button.btn.sm.ghost', { type: 'button', onclick: () => log.replaceChildren() }, t('drive.clear'));

  const el = h('div.rv-drive',
    h('h3.rv-h', h('span', t('drive.title'))),
    h('div.rv-motor', dpad,
      h('div.rv-motor-side',
        h('div.rv-between', h('span.rv-label', t('drive.speed')), h('span', speedOut, h('small', ' %'))),
        speed,
        h('span.rv-label', t('drive.mode')),
        modeSeg)),
    h('h3.rv-h', h('span', t('drive.actuators'))),
    h('div.rv-acts', led.tile, buz.tile,
      h('div.rv-act.servo', h('span', t('drive.servo')), servo, servoOut)),
    h('p.rv-keys', { html: t('drive.keys') }),
    h('h3.rv-h', h('span', t('drive.serial')), clear),
    log);

  let lastAt = 0;
  return {
    el,
    log(text) {
      const now = new Date();
      const ts = [now.getHours(), now.getMinutes(), now.getSeconds()].map(n => String(n).padStart(2, '0')).join(':');
      const line = h('div.rv-serial-line', h('span.faint', `[${ts}]`), ' ', colorize(text));
      const atBottom = log.scrollTop + log.clientHeight >= log.scrollHeight - 8;
      log.append(line);
      while (log.childElementCount > 300) log.firstElementChild.remove();
      if (atBottom) log.scrollTop = log.scrollHeight;
    },
    update(s) {
      if (!s) return;
      const now = performance.now();
      if (now - lastAt < 60) return;
      lastAt = now;
      for (const [m, b] of Object.entries(modeBtns)) b.setAttribute('aria-pressed', String(s.mode === m));
      if (document.activeElement !== speed && +speed.value !== s.speed) { speed.value = s.speed; speedOut.textContent = s.speed; setPct(speed, s.speed, 100); }
      if (document.activeElement !== servo && Math.abs(+servo.value - s.servo) > 0.5) { servo.value = s.servo; servoOut.textContent = `${s.servo}°`; setPct(servo, s.servo, 180); }
      servo.disabled = s.mode === 'auto';
      led.input.checked = !!s.led;
      buz.input.checked = !!s.buzzer;
      led.tile.classList.toggle('on', !!s.led);
      buz.tile.classList.toggle('on', !!s.buzzer);
      for (const [d, b] of Object.entries(pads)) b.classList.toggle('active', s.drive === d);
    },
  };
}

function colorize(text) {
  const span = h('span');
  const m = /^([A-Za-z][\w ]*?):\s(.*)$/.exec(text);
  if (m && m[1].length < 16) { span.append(h('span.rv-k', m[1] + ': '), h('span.rv-v', m[2])); }
  else span.textContent = text;
  return span;
}
