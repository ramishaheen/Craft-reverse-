// Procedural models of every rover part. Units are centimetres; +x is the car's front, +y up, +z its right.
// Each builder returns a THREE.Group whose origin is described in its comment.

import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import * as M from './materials.js';

const geoCache = new Map();
function geo(key, make) {
  let g = geoCache.get(key);
  if (!g) { g = M.trackGeo(make()); geoCache.set(key, g); }
  return g;
}
export function clearGeoCache() { geoCache.clear(); }

export function mesh(g, mat, x = 0, y = 0, z = 0) {
  const m = new THREE.Mesh(g, mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
export const box = (w, h, d, mat, x, y, z) => mesh(geo(`b${w},${h},${d}`, () => new THREE.BoxGeometry(w, h, d)), mat, x, y, z);
export const rbox = (w, h, d, r, mat, x, y, z) => mesh(geo(`rb${w},${h},${d},${r}`, () => new RoundedBoxGeometry(w, h, d, 2, r)), mat, x, y, z);
/** Cylinder along y. */
export const cyl = (r, h, mat, x, y, z, seg = 20, rb = r) => mesh(geo(`c${r},${rb},${h},${seg}`, () => new THREE.CylinderGeometry(r, rb, h, seg)), mat, x, y, z);
/** Cylinder along x. */
export const cylX = (r, h, mat, x, y, z, seg = 20) => { const m = cyl(r, h, mat, x, y, z, seg); m.rotation.z = Math.PI / 2; return m; };
/** Cylinder along z. */
export const cylZ = (r, h, mat, x, y, z, seg = 20) => { const m = cyl(r, h, mat, x, y, z, seg); m.rotation.x = Math.PI / 2; return m; };

const group = (...kids) => { const g = new THREE.Group(); for (const k of kids) if (k) g.add(k); return g; };

// ---- chassis -------------------------------------------------------------------------------------

function roundedRectPath(path, x0, z0, x1, z1, r) {
  path.moveTo(x0 + r, z0);
  path.lineTo(x1 - r, z0);
  path.quadraticCurveTo(x1, z0, x1, z0 + r);
  path.lineTo(x1, z1 - r);
  path.quadraticCurveTo(x1, z1, x1 - r, z1);
  path.lineTo(x0 + r, z1);
  path.quadraticCurveTo(x0, z1, x0, z1 - r);
  path.lineTo(x0, z0 + r);
  path.quadraticCurveTo(x0, z0, x0 + r, z0);
}
function holeCircle(shape, x, z, r) { const p = new THREE.Path(); p.absarc(x, z, r, 0, Math.PI * 2, true); shape.holes.push(p); }
function holeSlot(shape, x, z, w, d) { const p = new THREE.Path(); roundedRectPath(p, x - w / 2, z - d / 2, x + w / 2, z + d / 2, Math.min(w, d) / 2 - 0.001); shape.holes.push(p); }

/** Outline with wheel notches: an array of [x0, x1, depth] cut into both long edges. */
function deckShape(len, wid, { notches = [], r = 1 } = {}) {
  const s = new THREE.Shape();
  const hl = len / 2, hw = wid / 2;
  s.moveTo(-hl + r, -hw);
  const ns = [...notches].sort((a, b) => a[0] - b[0]);
  for (const [a, b, d] of ns) { s.lineTo(a, -hw); s.lineTo(a + 0.3, -hw + d); s.lineTo(b - 0.3, -hw + d); s.lineTo(b, -hw); }
  s.lineTo(hl - r, -hw);
  s.quadraticCurveTo(hl, -hw, hl, -hw + r);
  s.lineTo(hl, hw - r);
  s.quadraticCurveTo(hl, hw, hl - r, hw);
  for (const [a, b, d] of [...ns].reverse()) { s.lineTo(b, hw); s.lineTo(b - 0.3, hw - d); s.lineTo(a + 0.3, hw - d); s.lineTo(a, hw); }
  s.lineTo(-hl + r, hw);
  s.quadraticCurveTo(-hl, hw, -hl, hw - r);
  s.lineTo(-hl, -hw + r);
  s.quadraticCurveTo(-hl, -hw, -hl + r, -hw);
  return s;
}

function acrylicPlate(key, shape, thick = 0.3) {
  const m = M.mats();
  const g = geo(key, () => {
    const eg = new THREE.ExtrudeGeometry(shape, { depth: thick, bevelEnabled: false, curveSegments: 10 });
    eg.rotateX(Math.PI / 2); // shape (x, y) -> (x, z); extrusion goes down: move it back up
    eg.translate(0, thick, 0);
    return eg;
  });
  const e = geo(key + 'e', () => new THREE.EdgesGeometry(g, 25));
  const plate = new THREE.Mesh(g, m.acrylic);
  plate.renderOrder = 2;
  plate.receiveShadow = true;
  const edges = new THREE.LineSegments(e, m.acrylicEdge);
  edges.renderOrder = 3;
  return group(plate, edges);
}

export const STANDOFF_XZ = {
  bottom: [[-10.1, -4.2], [-8.5, -4.2], [8.5, -4.2], [10.1, -4.2], [-10.1, 4.2], [-8.5, 4.2], [8.5, 4.2], [10.1, 4.2]],
  top: [[-9.9, -4.6], [-1.6, -4.6], [-9.9, 4.6], [-1.6, 4.6]],
};

/** Bottom deck. Origin: centre of its lower face. */
export function deckBottom() {
  const s = deckShape(22, 10, { r: 1.2 });
  for (const [x, z] of STANDOFF_XZ.bottom) holeCircle(s, x, z, 0.17);
  for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
    holeSlot(s, sx * 4.5, sz * 2.75, 1.1, 0.32);       // inner bracket slots
    holeSlot(s, sx * 4.5, sz * 4.75, 1.1, 0.3);      // outer bracket slots near the edge
  }
  holeSlot(s, 0, 0, 3.5, 0.9);
  for (const x of [-6, 6]) holeCircle(s, x, 0, 0.4);
  return acrylicPlate('deckB', s);
}

/** Middle deck. Origin: centre of its lower face. */
export function deckMiddle() {
  const s = deckShape(21, 11, { r: 1.2, notches: [[-9.7, -3.3, 0.6], [3.3, 9.7, 0.6]] });
  for (const [x, z] of STANDOFF_XZ.bottom) holeCircle(s, x, z, 0.17);
  for (const [x, z] of STANDOFF_XZ.top) holeCircle(s, x, z, 0.17);
  holeSlot(s, 0.5, 0, 7.5, 1.0);         // long slot for the motor leads
  holeSlot(s, 9.15, 0, 2.4, 1.3);        // servo cut-out
  holeSlot(s, 7.3, 0.9, 0.9, 0.35);      // servo cable slot
  holeSlot(s, 2.0, 4.1, 1.6, 0.35);      // cable slot beside the controller
  for (const [x, z] of [[-0.3, -2.5], [-0.3, 2.5], [4.4, -2.5], [4.4, 2.5]]) holeCircle(s, x, z, 0.17);
  return acrylicPlate('deckM', s);
}

/** Top deck. Origin: centre of its lower face (it spans x −10.5…−1 in the car). */
export function deckTop() {
  const s = deckShape(9.5, 10.6, { r: 1 });
  for (const [x, z] of STANDOFF_XZ.top) holeCircle(s, x + 5.75, z, 0.17);
  holeCircle(s, -1.9, -4.1, 0.45);
  holeSlot(s, 0, 0, 3.0, 0.6);
  return acrylicPlate('deckT', s);
}

/** Brass hex standoff of height h. Origin: centre of its lower end. */
export function standoff(h) {
  const m = M.mats();
  const g = group(cyl(0.3, h, m.brass, 0, h / 2, 0, 6));
  return g;
}

/** Cross-head M3 screw head, seen from above. Origin: under the head. */
export function screwHead() {
  const m = M.mats();
  return group(cyl(0.27, 0.16, m.steel, 0, 0.08, 0, 12, 0.29));
}

/** T-shaped motor bracket standing in the x–y plane. Origin: centre of the stem at the deck's top face. */
export function bracket() {
  const m = M.mats();
  const s = new THREE.Shape();
  s.moveTo(-0.55, -0.3); s.lineTo(-0.55, 2.3); s.lineTo(0.55, 2.3); s.lineTo(0.55, -0.3);
  s.lineTo(1.0, -0.3); s.lineTo(1.0, -0.8); s.lineTo(-1.0, -0.8); s.lineTo(-1.0, -0.3); s.lineTo(-0.55, -0.3);
  holeCircle(s, 0, 0.225, 0.16);
  holeCircle(s, 0, 1.975, 0.16);
  const g = geo('bracket', () => { const e = new THREE.ExtrudeGeometry(s, { depth: 0.3, bevelEnabled: false }); e.translate(0, 0, -0.15); return e; });
  const e = geo('bracketE', () => new THREE.EdgesGeometry(g, 25));
  const plate = new THREE.Mesh(g, m.acrylic);
  plate.renderOrder = 2;
  const edges = new THREE.LineSegments(e, m.acrylicEdge);
  return group(plate, edges);
}

/** M3 × 30 bolt along z with a nut. Origin: the bolt's middle. */
export function bolt() {
  const m = M.mats();
  return group(cylZ(0.15, 3.0, m.steel, 0, 0, 0, 10), cylZ(0.28, 0.22, m.steel, 0, 0, 1.6, 12), cylZ(0.3, 0.24, m.darkSteel, 0, 0, -1.45, 6));
}

// ---- drivetrain ----------------------------------------------------------------------------------

/** TT gear motor. Origin: on the output shaft's axis (along z), centred on the gearbox; the body extends towards +x. */
export function motor() {
  const m = M.mats();
  const g = group(
    rbox(3.75, 2.2, 1.8, 0.18, m.yellow, 0.72, 0, 0),
    cylX(0.98, 2.6, m.chrome, 3.9, 0, 0, 24),
    cylX(0.7, 0.25, m.white, 5.3, 0, 0, 20),
    cylZ(0.27, 4.4, m.white, 0, 0, 0, 12),
    cylZ(0.62, 0.2, m.white, 0, 0, 0.98, 16),
    cylZ(0.62, 0.2, m.white, 0, 0, -0.98, 16),
    box(0.3, 0.5, 0.06, m.steel, 5.45, 0.5, 0.45),
    box(0.3, 0.5, 0.06, m.steel, 5.45, -0.5, 0.45),
  );
  return g;
}

/** 65 mm wheel. Origin: the hub centre; axle along z, rim face towards +z. */
export function wheel() {
  const m = M.mats();
  const tyreGeo = geo('tyre', () => {
    const pts = [];
    const R = 3.25, r = 2.25, W = 1.3, bev = 0.45;
    pts.push(new THREE.Vector2(r, -W));
    for (let i = 0; i <= 6; i++) { const a = -Math.PI / 2 + (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(R - bev + Math.cos(a) * bev, -W + bev + Math.sin(a) * bev)); }
    for (let i = 0; i <= 6; i++) { const a = (i / 6) * Math.PI / 2; pts.push(new THREE.Vector2(R - bev + Math.cos(a) * bev, W - bev + Math.sin(a) * bev)); }
    pts.push(new THREE.Vector2(r, W));
    const lg = new THREE.LatheGeometry(pts, 48);
    lg.rotateX(Math.PI / 2);
    return lg;
  });
  if (!m.tyreTex) { m.tyreTex = M.tyreTexture(); m.tyreTex.repeat.set(1, 1); m.tyreMat = M.std(0xffffff, { map: m.tyreTex, roughness: 0.92 }); }
  const tyre = mesh(tyreGeo, m.tyreMat);
  const rimShape = new THREE.Shape();
  rimShape.absarc(0, 0, 2.3, 0, Math.PI * 2, false);
  for (let i = 0; i < 5; i++) {
    const a = (i / 5) * Math.PI * 2;
    const p = new THREE.Path();
    const c = new THREE.Vector2(Math.cos(a) * 1.35, Math.sin(a) * 1.35);
    p.absellipse(c.x, c.y, 0.55, 0.42, 0, Math.PI * 2, true, a);
    rimShape.holes.push(p);
  }
  const hub = new THREE.Path(); hub.absarc(0, 0, 0.3, 0, Math.PI * 2, true); rimShape.holes.push(hub);
  const rimGeo = geo('rim', () => { const e = new THREE.ExtrudeGeometry(rimShape, { depth: 0.5, bevelEnabled: true, bevelSize: 0.08, bevelThickness: 0.08, bevelSegments: 2, curveSegments: 24 }); e.translate(0, 0, 0.35); return e; });
  const rim = mesh(rimGeo, m.rim);
  const back = cylZ(2.25, 1.6, m.rim, 0, 0, -0.2, 32);
  const hubC = cylZ(0.6, 1.9, m.rim, 0, 0, 0, 16);
  return group(tyre, rim, back, hubC);
}

// ---- electronics ---------------------------------------------------------------------------------

function pcb(w, d, color, tex, t = 0.16) {
  const m = M.mats();
  const side = M.std(color, { roughness: 0.6 });
  const top = tex ? M.std(0xffffff, { map: tex, roughness: 0.55 }) : side;
  const g = geo(`pcb${w},${d},${t}`, () => new THREE.BoxGeometry(w, t, d));
  const mm = new THREE.Mesh(g, [side, side, top, side, side, side]);
  mm.position.y = t / 2;
  mm.castShadow = true; mm.receiveShadow = true;
  return mm;
}

/** A row of header pins: count pins along x starting at x0, pitch 0.254. Returns an InstancedMesh group. */
function pinRow(count, { x0 = 0, z = 0, y = 0, h = 0.6, dir = 'x', base = true, mat } = {}) {
  const m = M.mats();
  const g = group();
  const pg = geo('pin' + h, () => new THREE.BoxGeometry(0.064, h, 0.064));
  const inst = new THREE.InstancedMesh(pg, mat || m.gold, count);
  const o = new THREE.Object3D();
  for (let i = 0; i < count; i++) {
    const p = x0 + i * 0.254;
    o.position.set(dir === 'x' ? p : 0, y + h / 2 + 0.1, dir === 'x' ? z : p);
    o.updateMatrix();
    inst.setMatrixAt(i, o.matrix);
  }
  inst.castShadow = true;
  if (dir !== 'x') inst.position.x = 0;
  g.add(inst);
  if (base) {
    const len = count * 0.254;
    const b = dir === 'x' ? box(len, 0.25, 0.25, m.blackPlastic, x0 + len / 2 - 0.127, y + 0.125, z) : box(0.25, 0.25, len, m.blackPlastic, 0, y + 0.125, x0 + len / 2 - 0.127);
    g.add(b);
  }
  if (dir !== 'x') g.position.x = 0;
  return g;
}

function femaleHeader(count, x0, z, y) {
  const m = M.mats();
  const len = count * 0.254;
  return box(len, 0.85, 0.25, m.blackPlastic, x0 + len / 2 - 0.127, y + 0.425, z);
}

export const UNO = { w: 6.86, d: 5.33, shieldY: 1.15, pinH: 0.6 };
/** Pin position on the Sensor Shield V5, in the UNO's standard frame (USB at −x, digital header at −z). */
export function unoPin(name, row) {
  const k = { S: 0, V: 1, G: 2 }[row] ?? 0;
  const top = UNO.shieldY + 0.16 + UNO.pinH + 0.1;
  if (name[0] === 'A') { const n = +name.slice(1); return new THREE.Vector3(1.55 + n * 0.254, top, 2.42 - k * 0.254); }
  const n = +name.slice(1);
  return new THREE.Vector3(3.2 - n * 0.254, top, -2.42 + k * 0.254);
}

/** Arduino UNO R3. Standard frame: long side along x, USB and DC jack at −x, digital header at −z. Origin: PCB bottom centre. */
export function uno() {
  const m = M.mats();
  if (!m.unoTex) m.unoTex = M.unoTexture();
  const g = group(pcb(UNO.w, UNO.d, 0x0b6aa8, m.unoTex));
  g.add(box(1.6, 1.1, 1.2, m.chrome, -3.0, 0.71, -1.25));
  g.add(box(1.45, 1.1, 0.9, m.black, -3.0, 0.71, 1.75));
  g.add(cylX(0.32, 0.2, m.darkSteel, -3.75, 0.71, 1.75, 16));
  g.add(box(3.5, 0.35, 0.75, m.chip, 1.25, 0.5, 1.0));
  g.add(pinRow(14, { x0: -0.4, z: 0.6, y: 0.16, h: 0.18, base: false, mat: m.steel }));
  g.add(pinRow(14, { x0: -0.4, z: 1.4, y: 0.16, h: 0.18, base: false, mat: m.steel }));
  g.add(femaleHeader(10, -0.75, -2.45, 0.16));
  g.add(femaleHeader(8, 1.95, -2.45, 0.16));
  g.add(femaleHeader(8, -1.2, 2.45, 0.16));
  g.add(femaleHeader(6, 1.55, 2.45, 0.16));
  g.add(box(0.45, 0.2, 0.25, m.chrome, -1.5, 0.26, -0.2));
  g.add(box(0.35, 0.25, 0.35, m.blackPlastic, -3.0, 0.29, -2.3));
  return g;
}

/** Sensor Shield V5, in the UNO's standard frame. Origin: the UNO's PCB bottom centre. */
export function shield() {
  const m = M.mats();
  if (!m.shieldTex) m.shieldTex = M.shieldTexture();
  const g = group();
  const p = pcb(UNO.w, UNO.d - 0.1, 0x1a4fa0, null);
  p.position.y = UNO.shieldY + 0.08;
  // the texture is drawn portrait: put it on a separate top quad rotated to match
  const quad = mesh(geo('shieldQuad', () => { const q = new THREE.PlaneGeometry(UNO.d - 0.1, UNO.w); q.rotateX(-Math.PI / 2); q.rotateY(Math.PI / 2); return q; }), M.std(0xffffff, { map: m.shieldTex, roughness: 0.55 }));
  quad.position.y = UNO.shieldY + 0.161;
  g.add(p, quad);
  const y = UNO.shieldY + 0.16;
  for (let k = 0; k < 3; k++) {
    g.add(pinRow(14, { x0: 3.2 - 13 * 0.254, z: -2.42 + k * 0.254, y, h: UNO.pinH }));
    g.add(pinRow(6, { x0: 1.55, z: 2.42 - k * 0.254, y, h: UNO.pinH }));
  }
  g.add(box(0.5, 0.25, 0.25, m.red, -1.2, y + 0.3, -1.6));
  g.add(box(1.0, 0.8, 0.75, m.termBlue, -2.6, y + 0.4, 1.5));
  for (const zz of [1.3, 1.7]) g.add(cyl(0.12, 0.05, m.steel, -2.6, y + 0.82, zz, 10));
  g.add(pinRow(4, { x0: -1.6, z: 0.9, y, h: 0.55 }));
  g.add(pinRow(4, { x0: -1.6, z: 1.15, y, h: 0.55 }));
  return g;
}

export const ESP = { w: 6.4, d: 5.6, devY: 1.05, pitch: 0.254 };
export const ESP_FRONT = ['EN', '36', '39', '34', '35', '32', '33', '25', '26', '27', '14', '12', '13', 'GND', 'VIN'];
export const ESP_REAR = ['23', '22', 'TX0', 'RX0', '21', '19', '18', '5', 'TX2', 'RX2', '4', '2', '15', 'GND', '3V3'];
/** Pin position on the expansion board's G/V/S headers, standard frame (DC jack at −x, front pin column at −z). */
export function espPin(gpio, row) {
  const k = { S: 0, V: 1, G: 2 }[row] ?? 0;
  let i = ESP_FRONT.indexOf(String(gpio));
  let side = -1;
  if (i < 0) { i = ESP_REAR.indexOf(String(gpio)); side = 1; }
  return new THREE.Vector3(1.78 - i * 0.254, 0.16 + 0.7, side * (1.95 + k * 0.254));
}

/** ESP32 DevKit V1 on its expansion board. Standard frame as espPin(). Origin: expansion PCB bottom centre. */
export function esp32() {
  const m = M.mats();
  if (!m.espTex) { m.espTex = M.espTexture(); m.devTex = M.devkitTexture(); m.modTex = M.moduleTexture(); }
  const g = group(pcb(ESP.w, ESP.d, 0x17191d, m.espTex));
  g.add(box(1.45, 1.1, 0.9, m.black, -2.75, 0.71, -1.8));
  g.add(cylX(0.32, 0.2, m.darkSteel, -3.5, 0.71, -1.8, 16));
  g.add(box(0.8, 0.9, 0.8, m.black, -2.6, 0.61, 1.9));
  g.add(cyl(0.18, 0.5, m.white, -2.6, 1.1, 1.9, 10));
  for (const side of [-1, 1]) {
    for (let k = 0; k < 3; k++) g.add(pinRow(15, { x0: -1.78, z: side * (1.95 + k * 0.254), y: 0.16, h: 0.55 }));
    g.add(femaleHeader(15, -1.78, side * 1.27, 0.16));
  }
  // DevKit: long axis along x, antenna towards +x
  const dk = group();
  const dpcb = pcb(5.2, 2.8, 0x101114, null);
  dk.add(dpcb);
  const dq = mesh(geo('devQuad', () => { const q = new THREE.PlaneGeometry(2.8, 5.2); q.rotateX(-Math.PI / 2); q.rotateY(Math.PI / 2); return q; }), M.std(0xffffff, { map: m.devTex, roughness: 0.55 }));
  dq.position.y = 0.161;
  dk.add(dq);
  const can = box(1.8, 0.32, 1.6, M.std(0xffffff, { map: m.modTex, metalness: 0.7, roughness: 0.35 }), 0.9, 0.32, 0);
  dk.add(can);
  dk.add(box(0.75, 0.1, 1.8, m.blackPlastic, 2.2, 0.21, 0));
  dk.add(box(0.6, 0.3, 0.8, m.chrome, -2.45, 0.31, 0));
  dk.add(box(0.35, 0.2, 0.35, m.white, -1.9, 0.26, -1.0));
  dk.add(box(0.35, 0.2, 0.35, m.white, -1.9, 0.26, 1.0));
  dk.position.y = ESP.devY;
  g.add(dk);
  return g;
}

/** L9110S driver. Standard frame: header at −z (pins pointing −z), terminals at +z, MOTOR-A at −x. Origin: PCB bottom centre. */
export const DRIVER_PINS = ['B-IA', 'B-IB', 'GND', 'VCC', 'A-IA', 'A-IB'];
export function driverPin(name) {
  const i = DRIVER_PINS.indexOf(name);
  return new THREE.Vector3((i - 2.5) * 0.254, 0.29, -1.75);
}
export function driver() {
  const m = M.mats();
  if (!m.drvTex) m.drvTex = M.driverTexture();
  const g = group(pcb(2.9, 2.3, 0xc8232c, m.drvTex));
  g.add(box(0.5, 0.15, 0.4, m.chip, -0.7, 0.24, 0.1));
  g.add(box(0.5, 0.15, 0.4, m.chip, 0.7, 0.24, 0.1));
  for (const x of [-0.75, 0.75]) {
    g.add(box(1.0, 0.85, 0.75, m.termBlue, x, 0.585, 0.72));
    for (const dx of [-0.25, 0.25]) g.add(cyl(0.13, 0.05, m.steel, x + dx, 1.03, 0.72, 10));
  }
  // right-angle header
  g.add(box(6 * 0.254, 0.25, 0.25, m.blackPlastic, 0, 0.285, -1.05));
  const pg = geo('rapin', () => new THREE.BoxGeometry(0.064, 0.064, 0.7));
  const inst = new THREE.InstancedMesh(pg, m.gold, 6);
  const o = new THREE.Object3D();
  for (let i = 0; i < 6; i++) { o.position.set((i - 2.5) * 0.254, 0.29, -1.4); o.updateMatrix(); inst.setMatrixAt(i, o.matrix); }
  g.add(inst);
  g.add(box(0.2, 0.08, 0.12, m.red, 1.2, 0.2, -0.6));
  return g;
}

/** Foam tape pad. Origin: bottom centre. */
export function foam(w = 2.4, d = 1.8) {
  const m = M.mats();
  return group(box(w, 0.15, d, m.foam, 0, 0.075, 0));
}

// ---- sensor head ---------------------------------------------------------------------------------

/** SG90 servo. Origin: on the output shaft axis at the underside of the mounting ears; body extends to −x. */
export function servo() {
  const m = M.mats();
  return group(
    box(2.3, 2.25, 1.22, m.servoBlue, -0.6, -0.95, 0),
    box(3.2, 0.25, 1.22, m.servoBlue, -0.6, 0.12, 0),
    cyl(0.6, 0.45, m.servoBlue, 0, 0.47, 0, 20),
    cyl(0.4, 0.3, m.servoBlue, -0.75, 0.37, 0, 16),
    cyl(0.24, 0.35, m.white, 0, 0.85, 0, 12),
  );
}

/** Head: horn, bracket and HC-SR04 together turn about the servo shaft. Origin: the top of the servo shaft. */
export function horn() {
  const m = M.mats();
  return group(rbox(2.1, 0.18, 0.55, 0.08, m.white, 0.55, 0.09, 0), cyl(0.33, 0.3, m.white, 0, 0.0, 0, 16));
}

export function sonarBracket() {
  const m = M.mats();
  return group(
    box(1.8, 0.18, 1.8, m.blackPlastic, 0.5, 0.27, 0),
    box(0.18, 2.6, 4.2, m.blackPlastic, 1.35, 1.48, 0),
  );
}

export const SONAR_ORIGIN = new THREE.Vector3(1.6, 1.75, 0);
/** HC-SR04 facing +x, pins on top. Origin: PCB centre. */
export function sonarPin(name) {
  const z = { GND: 0.381, Echo: 0.127, Trig: -0.127, VCC: -0.381 }[name];
  return new THREE.Vector3(-0.12, 1.0 + 0.55, z);
}
export function sonar() {
  const m = M.mats();
  if (!m.sonarTex) { m.sonarTex = M.sonarTexture(); m.sonarFace = M.std(0xffffff, { map: M.sonarFaceTexture(), roughness: 0.9 }); }
  const g = group();
  const side = M.std(0x1e5fc4, { roughness: 0.6 });
  const face = M.std(0xffffff, { map: m.sonarTex, roughness: 0.55 });
  const pcbM = new THREE.Mesh(geo('sonarPcb', () => new THREE.BoxGeometry(0.16, 2.0, 4.5)), [face, side, side, side, side, side]);
  pcbM.castShadow = true;
  g.add(pcbM);
  for (const z of [-1.3, 1.3]) {
    g.add(cylX(0.8, 1.2, m.chrome, 0.68, 0, z, 28));
    const f = cylX(0.68, 0.02, m.sonarFace, 1.29, 0, z, 28);
    g.add(f);
  }
  g.add(box(0.15, 0.3, 0.9, m.chrome, 0.12, 0.55, 0));
  const pg = geo('sonarPin', () => new THREE.BoxGeometry(0.064, 0.6, 0.064));
  for (const n of ['GND', 'Echo', 'Trig', 'VCC']) { const p = sonarPin(n); g.add(mesh(pg, m.gold, p.x, 1.25, p.z)); }
  g.add(box(0.25, 0.25, 1.05, m.blackPlastic, -0.12, 1.12, 0));
  return g;
}

// ---- power ---------------------------------------------------------------------------------------

/** 2 × 18650 holder, long side along x, leads leaving at −x. Origin: bottom centre. */
export function holder() {
  const m = M.mats();
  if (!m.holderTex) m.holderTex = M.std(0xffffff, { map: M.holderTexture(), roughness: 0.6 });
  const g = group(
    box(7.8, 0.25, 4.1, m.black, 0, 0.125, 0),
    box(7.8, 1.6, 0.2, m.black, 0, 0.8, -1.95),
    box(7.8, 1.6, 0.2, m.black, 0, 0.8, 1.95),
    box(7.8, 1.0, 0.2, m.black, 0, 0.5, 0),
    box(0.3, 2.0, 4.1, m.black, -3.75, 1.0, 0),
    box(0.3, 2.0, 4.1, m.black, 3.75, 1.0, 0),
  );
  for (const z of [-1.0, 1.0]) { g.add(box(0.05, 0.8, 0.8, m.steel, -3.55, 1.0, z)); g.add(box(0.05, 0.8, 0.8, m.steel, 3.55, 1.0, z)); }
  return g;
}

/** One 18650 cell along x. Origin: its centre. */
export function cell() {
  const m = M.mats();
  return group(cylX(0.9, 6.3, m.cellBlue, 0, 0, 0, 24), cylX(0.85, 0.12, m.steel, 3.2, 0, 0, 20), cylX(0.35, 0.12, m.steel, 3.3, 0, 0, 12), cylX(0.85, 0.1, m.steel, -3.18, 0, 0, 20));
}

/** Slide switch lying on its side, lever towards −z. Origin: bottom centre. */
export function slideSwitch() {
  const m = M.mats();
  return group(box(1.2, 0.55, 0.65, m.black, 0, 0.275, 0), box(0.25, 0.25, 0.45, m.blackPlastic, 0.15, 0.275, -0.5), box(1.3, 0.06, 0.8, m.steel, 0, 0.58, 0));
}

/** DC barrel plug with a green screw terminal; the barrel points +z. Origin: the terminal block's bottom centre. */
export function dcPlug() {
  const m = M.mats();
  return group(
    box(1.0, 0.8, 0.9, m.green, 0, 0.4, 0),
    cyl(0.14, 0.06, m.steel, -0.22, 0.83, 0, 10), cyl(0.14, 0.06, m.steel, 0.22, 0.83, 0, 10),
    cylZ(0.36, 1.0, m.black, 0, 0.42, 0.9, 16),
    cylZ(0.28, 0.9, m.steel, 0, 0.42, 1.6, 16),
  );
}

/** 10 mm LED lying on its side, dome towards −z. Origin: centre of its base. */
export function led() {
  const m = M.mats();
  const dome = mesh(geo('ledDome', () => { const s = new THREE.SphereGeometry(0.5, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2); s.rotateX(-Math.PI / 2); return s; }), m.ledRed, 0, 0.5, -0.9);
  return group(cylZ(0.5, 0.9, m.ledRed, 0, 0.5, -0.45, 20), cylZ(0.56, 0.12, m.ledRed, 0, 0.5, 0, 20), dome,
    cylZ(0.03, 1.4, m.steel, 0.15, 0.5, 0.7, 6), cylZ(0.03, 1.2, m.steel, -0.15, 0.5, 0.6, 6));
}

/** 12 mm active buzzer, upright. Origin: bottom centre. */
export function buzzer() {
  const m = M.mats();
  if (!m.buzzTex) m.buzzTex = M.std(0xffffff, { map: M.buzzerTexture(), roughness: 0.5 });
  const g = group(cyl(0.6, 0.95, m.black, 0, 0.475, 0, 24));
  const top = cyl(0.6, 0.01, m.buzzTex, 0, 0.955, 0, 24);
  top.rotation.y = Math.PI / 2;
  g.add(top);
  return g;
}

/** Resistor along x. Origin: its centre. */
export function resistor(bands = ['red', 'red', 'brown', 'gold']) {
  const m = M.mats();
  const key = 'res' + bands.join();
  if (!m[key]) m[key] = M.std(0xffffff, { map: M.resistorTexture(bands), roughness: 0.6 });
  const body = cylX(0.12, 0.65, m[key], 0, 0, 0, 12);
  return group(body, cylX(0.025, 1.6, m.steel, 0, 0, 0, 6));
}

/** TO-92 NPN transistor, upright. Origin: bottom of the legs. */
export function transistor() {
  const m = M.mats();
  const body = mesh(geo('to92', () => new THREE.CylinderGeometry(0.24, 0.24, 0.5, 16, 1, false, 0, Math.PI)), m.black, 0, 0.75, 0);
  return group(body, box(0.48, 0.5, 0.02, m.black, 0, 0.75, 0), ...[-0.13, 0, 0.13].map(x => box(0.03, 0.5, 0.03, m.steel, x, 0.25, 0)));
}

// ---- loose items on the mat ----------------------------------------------------------------------

/** A bundle of jumper wires lying side by side along x. Origin: centre. */
export function jumperBundle(n = 20) {
  const m = M.mats();
  const colors = ['brown', 'red', 'orange', 'yellow', 'green', 'blue', 'purple', 'grey', 'white', 'black'];
  const g = group();
  for (let i = 0; i < n; i++) {
    const z = (i - n / 2) * 0.22;
    g.add(box(11.5, 0.12, 0.12, m.wire[colors[i % 10]], 0, 0.06, z));
    g.add(box(1.4, 0.25, 0.25, m.blackPlastic, -6.4, 0.125, z));
    g.add(box(1.4, 0.25, 0.25, m.blackPlastic, 6.4, 0.125, z));
  }
  return g;
}

/** A small coil of red and black hook-up wire. Origin: centre. */
export function hookupCoil() {
  const m = M.mats();
  const t = r => mesh(geo('coil' + r, () => { const g = new THREE.TorusGeometry(r, 0.08, 6, 40); g.rotateX(Math.PI / 2); return g; }), null);
  const a = t(1.4); a.material = m.wire.red; a.position.y = 0.1;
  const b = t(1.2); b.material = m.wire.black; b.position.y = 0.1;
  const c = t(1.0); c.material = m.wire.red; c.position.y = 0.26;
  return group(a, b, c);
}

/** A little pile of screws and nuts. Origin: centre. */
export function screwPile() {
  const m = M.mats();
  const g = group();
  for (let i = 0; i < 24; i++) {
    const s = screwHead();
    s.position.set((i % 6) * 0.65 - 1.6, 0, Math.floor(i / 6) * 0.65 - 1);
    g.add(s);
  }
  for (let i = 0; i < 4; i++) {
    const b = cylX(0.15, 3.0, m.steel, 0, 0.15, 1.8 + i * 0.4, 10);
    g.add(b);
  }
  return g;
}

/** A row of standoffs lying down, for the parts mat. Origin: centre. */
export function standoffRow(lengths) {
  const m = M.mats();
  const g = group();
  lengths.forEach((h, i) => { const s = cylX(0.3, h, m.brass, 0, 0.3, (i - lengths.length / 2) * 0.75, 6); g.add(s); });
  return g;
}
