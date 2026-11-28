// Connection to a real car running the ESP32 Wi-Fi firmware: JSON commands out, telemetry in.

const FIELDS = { distance: 'number', speed: 'number', servo: 'number', led: 'boolean', buzzer: 'boolean', mode: 'string', drive: 'string', motorL: 'number', motorR: 'number' };

export class CarLink {
  constructor({ onStatus = () => {}, onTelemetry = () => {}, onLog = () => {} } = {}) {
    this.onStatus = onStatus;
    this.onTelemetry = onTelemetry;
    this.onLog = onLog;
    this.ws = null;
    this.status = 'idle';
  }

  set(status) { this.status = status; this.onStatus(status); }

  connect(url) {
    this.close();
    let ws;
    try { ws = new WebSocket(url); } catch (e) { this.set('error'); this.onLog(`Cannot open ${url}: ${e.message}`); return; }
    this.ws = ws;
    this.set('connecting');
    ws.onopen = () => {
      this.set('connected');
      this.onLog(`Connected to ${url}`);
      this.ping = setInterval(() => this.send({ cmd: 'ping' }), 2000);
    };
    ws.onclose = () => { if (this.ws === ws) { clearInterval(this.ping); this.set('closed'); this.onLog('Connection closed'); } };
    ws.onerror = () => { if (this.ws === ws) this.set('error'); };
    ws.onmessage = ev => {
      const text = typeof ev.data === 'string' ? ev.data.trim() : '';
      if (!text) return;
      if (text[0] === '{') {
        try {
          const m = JSON.parse(text);
          if (m.type === 'telemetry') {
            const out = {};
            for (const [k, ty] of Object.entries(FIELDS)) if (typeof m[k] === ty && (ty !== 'number' || Number.isFinite(m[k]))) out[k] = m[k];
            this.onTelemetry(out);
            return;
          }
          if (m.type === 'pong') return;
        } catch { /* not JSON after all */ }
      }
      this.onLog(text);
    };
  }

  send(obj) {
    if (this.ws && this.ws.readyState === 1) { this.ws.send(JSON.stringify(obj)); return true; }
    return false;
  }

  close() {
    clearInterval(this.ping);
    if (this.ws) { const ws = this.ws; this.ws = null; try { ws.close(); } catch { /* already closed */ } }
    this.set('idle');
  }
}
