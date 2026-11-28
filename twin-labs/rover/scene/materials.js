// Shared materials and canvas textures for the rover models. Units are centimetres.
// Everything created here is tracked so destroy() can dispose of it.

import * as THREE from 'three';

const tracked = new Set();
const track = x => { tracked.add(x); return x; };

export function disposeAll() {
  for (const x of tracked) x.dispose?.();
  tracked.clear();
  cache = null;
}

export function std(color, opts = {}) {
  return track(new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0, ...opts }));
}

/** A canvas texture drawn by fn(ctx, w, h). */
export function canvasTex(w, h, fn, { repeat = null, srgb = true } = {}) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  fn(ctx, w, h);
  const t = track(new THREE.CanvasTexture(c));
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
  return t;
}

export const trackGeo = g => track(g);

let cache = null;

/** The palette. Created once per mount. */
export function mats() {
  if (cache) return cache;
  const m = {};
  m.acrylic = track(new THREE.MeshPhysicalMaterial({
    color: 0xe8f4ff, transparent: true, opacity: 0.32, roughness: 0.08, metalness: 0,
    clearcoat: 1, clearcoatRoughness: 0.1, depthWrite: false, side: THREE.DoubleSide,
  }));
  m.acrylicEdge = track(new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.75 }));
  m.brass = std(0xc9a13b, { metalness: 0.85, roughness: 0.32 });
  m.steel = std(0xc8ccd2, { metalness: 0.9, roughness: 0.28 });
  m.darkSteel = std(0x6b7078, { metalness: 0.8, roughness: 0.4 });
  m.gold = std(0xe2b84a, { metalness: 0.9, roughness: 0.25 });
  m.chrome = std(0xe6e9ee, { metalness: 1, roughness: 0.15 });
  m.yellow = std(0xf2b320, { roughness: 0.45 });
  m.rim = std(0xf5c518, { roughness: 0.4 });
  m.tyre = std(0x1c1d21, { roughness: 0.9 });
  m.black = std(0x18191c, { roughness: 0.55 });
  m.blackPlastic = std(0x232428, { roughness: 0.5 });
  m.white = std(0xf4f4f0, { roughness: 0.5 });
  m.cream = std(0xe9dcc0, { roughness: 0.6 });
  m.blue = std(0x2563c9, { roughness: 0.5 });
  m.servoBlue = std(0x2f6fd8, { roughness: 0.35, transparent: true, opacity: 0.92 });
  m.cellBlue = std(0x2f7de1, { roughness: 0.3, metalness: 0.1 });
  m.red = std(0xd8322b, { roughness: 0.5 });
  m.green = std(0x2fae4e, { roughness: 0.5 });
  m.termBlue = std(0x1f6fd1, { roughness: 0.45 });
  m.chip = std(0x15161a, { roughness: 0.35 });
  m.foam = std(0xf1efe8, { roughness: 1 });
  m.ledRed = track(new THREE.MeshPhysicalMaterial({ color: 0xff3b30, roughness: 0.15, transmission: 0, transparent: true, opacity: 0.85, emissive: 0x550000, emissiveIntensity: 0.6 }));
  m.wire = {};
  for (const [k, v] of Object.entries(WIRE_COLORS)) m.wire[k] = std(v, { roughness: 0.5 });
  cache = m;
  return m;
}

export const WIRE_COLORS = {
  red: 0xe53935, black: 0x26272b, brown: 0x7b4a2a, orange: 0xf28c28, yellow: 0xf5c518, green: 0x2fae4e,
  blue: 0x2f6fd8, purple: 0x8e5bd8, grey: 0x9aa0a8, white: 0xf2f2ee,
};

// ---- printed boards ------------------------------------------------------------------------------

function pcbBase(ctx, w, h, color) {
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, w, h);
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = 2;
  for (let i = 0; i < 26; i++) {
    const y = (i * 53) % h;
    ctx.beginPath();
    ctx.moveTo(((i * 97) % w), y);
    ctx.lineTo(((i * 97) % w) + 60 + (i % 5) * 20, y);
    ctx.lineTo(((i * 97) % w) + 80 + (i % 5) * 20, y + 20);
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
}

function text(ctx, s, x, y, size, { color = '#ffffff', weight = 700, align = 'center', rot = 0, font = 'sans-serif' } = {}) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(rot);
  ctx.fillStyle = color;
  ctx.font = `${weight} ${size}px ${font === 'mono' ? 'ui-monospace, Menlo, monospace' : 'system-ui, Arial, sans-serif'}`;
  ctx.textAlign = align;
  ctx.textBaseline = 'middle';
  ctx.fillText(s, 0, 0);
  ctx.restore();
}

export function unoTexture() {
  return canvasTex(686, 533, (c, w, h) => {
    pcbBase(c, w, h, '#0b6aa8');
    c.strokeStyle = 'rgba(255,255,255,.85)';
    c.lineWidth = 3;
    c.strokeRect(150, 140, 330, 120);
    text(c, 'UNO', 330, 215, 92, { weight: 800 });
    text(c, '∞  ARDUINO', 470, 330, 34, { weight: 800 });
    text(c, 'R3', 600, 400, 30);
    text(c, 'DIGITAL (PWM ~)', 360, 40, 20, { weight: 600 });
    text(c, 'ANALOG IN', 520, 500, 20, { weight: 600 });
    text(c, 'POWER', 270, 500, 20, { weight: 600 });
    text(c, 'MADE FOR MAKERS', 120, 420, 16, { weight: 600, rot: -Math.PI / 2 });
  });
}

export function shieldTexture() {
  return canvasTex(560, 680, (c, w, h) => {
    pcbBase(c, w, h, '#1a4fa0');
    text(c, 'Sensor Shield V5.0', w / 2, h / 2, 34, { weight: 800, rot: -Math.PI / 2 });
    c.fillStyle = 'rgba(255,255,255,.9)';
    for (let i = 0; i < 14; i++) text(c, String(13 - i), 470, 90 + i * 34, 16, { font: 'mono', rot: -Math.PI / 2 });
    for (let i = 0; i < 6; i++) text(c, 'A' + i, 70, 440 + i * 34, 16, { font: 'mono', rot: -Math.PI / 2 });
    text(c, 'G V S', 440, 40, 16, { font: 'mono' });
    text(c, 'SEL', 160, 90, 18);
  });
}

export function driverTexture() {
  return canvasTex(290, 230, (c, w, h) => {
    pcbBase(c, w, h, '#c8232c');
    text(c, 'L9110S', 145, 30, 24, { weight: 800 });
    text(c, 'MOTOR-A', 60, 205, 17);
    text(c, 'MOTOR-B', 220, 205, 17);
    const pins = ['B-IA', 'B-IB', 'GND', 'VCC', 'A-IA', 'A-IB'];
    pins.forEach((p, i) => text(c, p, 30 + i * 46, 70, 13, { font: 'mono' }));
  });
}

export function sonarTexture() {
  return canvasTex(450, 200, (c, w, h) => {
    pcbBase(c, w, h, '#1e5fc4');
    text(c, 'HC-SR04', 225, 100, 30, { weight: 800 });
    text(c, 'VCC Trig Echo Gnd', 225, 28, 17, { font: 'mono' });
    text(c, 'T', 60, 175, 18);
    text(c, 'R', 390, 175, 18);
  });
}

export function sonarFaceTexture() {
  return canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#3a3d42';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#23252a';
    for (let y = 0; y < h; y += 6) for (let x = (y / 6) % 2 ? 3 : 0; x < w; x += 6) c.fillRect(x, y, 3, 3);
  });
}

export function espTexture() {
  return canvasTex(640, 560, (c, w, h) => {
    pcbBase(c, w, h, '#17191d');
    text(c, 'ESP32 EXPANSION BOARD', w / 2, 34, 24, { weight: 800 });
    text(c, '5V  3V3', 120, 520, 20, { font: 'mono' });
    text(c, 'G V S', 70, 80, 15, { font: 'mono' });
    text(c, 'G V S', 570, 80, 15, { font: 'mono' });
  });
}

export function devkitTexture() {
  return canvasTex(280, 520, (c, w, h) => {
    pcbBase(c, w, h, '#101114');
    text(c, 'ESP32 DEVKIT V1', w / 2, 470, 20, { weight: 800 });
    text(c, 'EN', 40, 500, 14);
    text(c, 'BOOT', 240, 500, 14);
  });
}

export function moduleTexture() {
  return canvasTex(256, 300, (c, w, h) => {
    const g = c.createLinearGradient(0, 0, w, h);
    g.addColorStop(0, '#d9dde2'); g.addColorStop(1, '#a8aeb6');
    c.fillStyle = g;
    c.fillRect(0, 0, w, h);
    text(c, 'ESP32-WROOM-32', w / 2, 110, 22, { color: '#30343a', weight: 800 });
    text(c, 'Wi-Fi · BT', w / 2, 150, 18, { color: '#30343a' });
    text(c, 'CE  FCC', w / 2, 210, 16, { color: '#30343a' });
  });
}

export function resistorTexture(bands) {
  return canvasTex(32, 128, (c, w, h) => {
    c.fillStyle = '#d9c39a';
    c.fillRect(0, 0, w, h);
    const colors = { brown: '#6b3b1d', black: '#151515', red: '#c62828', orange: '#ef6c00', gold: '#c9a227' };
    bands.forEach((b, i) => { c.fillStyle = colors[b]; c.fillRect(0, 18 + i * 20 + (i === 3 ? 14 : 0), w, 10); });
  });
}

export function tyreTexture() {
  return canvasTex(512, 64, (c, w, h) => {
    c.fillStyle = '#1c1d21';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#2c2e33';
    for (let x = 0; x < w; x += 16) {
      c.fillRect(x, 6, 9, 22);
      c.fillRect(x + 8, 36, 9, 22);
    }
  }, { repeat: [1, 1] });
}

export function buzzerTexture() {
  return canvasTex(128, 128, (c, w, h) => {
    c.fillStyle = '#1b1c20';
    c.fillRect(0, 0, w, h);
    c.fillStyle = '#0c0c0e';
    c.beginPath(); c.arc(64, 64, 14, 0, Math.PI * 2); c.fill();
    text(c, '+', 92, 34, 30, { color: '#e8e8e8' });
  });
}

export function holderTexture() {
  return canvasTex(64, 64, (c, w, h) => {
    c.fillStyle = '#1a1b1e';
    c.fillRect(0, 0, w, h);
    text(c, '+', 16, 32, 26, { color: '#d0d0d0' });
    text(c, '−', 48, 32, 26, { color: '#d0d0d0' });
  });
}
