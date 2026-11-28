// The active buzzer through the speakers: a quiet 2.3 kHz square wave while it is on.

export class Buzzer {
  constructor() { this.ctx = null; this.osc = null; this.gain = null; this.on = false; }

  set(on, enabled) {
    on = !!on && !!enabled;
    if (on === this.on) return;
    this.on = on;
    try {
      if (on) {
        this.ctx ||= new (window.AudioContext || window.webkitAudioContext)();
        if (this.ctx.state === 'suspended') this.ctx.resume();
        this.osc = this.ctx.createOscillator();
        this.gain = this.ctx.createGain();
        this.osc.type = 'square';
        this.osc.frequency.value = 2300;
        this.gain.gain.value = 0.035;
        this.osc.connect(this.gain).connect(this.ctx.destination);
        this.osc.start();
      } else if (this.osc) {
        this.osc.stop();
        this.osc.disconnect();
        this.osc = null;
      }
    } catch { /* audio unavailable */ }
  }

  dispose() { this.set(false, false); try { this.ctx?.close(); } catch { /* ignore */ } this.ctx = null; }
}
