// Jumper wires and leads as tubes along smooth curves, with Dupont housings or solder sleeves at the ends.
// A wire can "grow" along its path (drawRange) for the wiring animation, and can be rebuilt when an end moves.

import * as THREE from 'three';
import * as M from './materials.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);

/**
 * end: { p: Vector3 pin tip, dir: Vector3 pointing out of the pin (the way the wire leaves), kind: 'socket' | 'solder' | 'bare' }
 * via: Vector3[] points the wire passes through.
 */
export class Wire {
  constructor(color, a, b, via = [], { radius = 0.065, segments = null } = {}) {
    this.color = color;
    this.radius = radius;
    this.segments = segments;
    this.group = new THREE.Group();
    this.mat = M.mats().wire[color] || M.mats().wire.grey;
    this.tube = new THREE.Mesh(new THREE.BufferGeometry(), this.mat);
    this.tube.castShadow = true;
    this.group.add(this.tube);
    this.ends = [];
    this.grow = 1;
    this.set(a, b, via);
  }

  set(a, b, via = []) {
    this.a = a; this.b = b; this.via = via;
    const da = (a.dir || UP).clone().normalize();
    const db = (b.dir || UP).clone().normalize();
    const lenA = a.kind === 'socket' ? 1.45 : 0.25;
    const lenB = b.kind === 'socket' ? 1.45 : 0.25;
    const pts = [
      a.p.clone().addScaledVector(da, lenA - 0.6),
      a.p.clone().addScaledVector(da, lenA + 0.6),
      ...via,
      b.p.clone().addScaledVector(db, lenB + 0.6),
      b.p.clone().addScaledVector(db, lenB - 0.6),
    ];
    const curve = new THREE.CatmullRomCurve3(pts, false, 'centripetal');
    this.curve = curve;
    const length = curve.getLength();
    const seg = this.segments || Math.max(16, Math.round(length * 3));
    const g = new THREE.TubeGeometry(curve, seg, this.radius, 6, false);
    this.tube.geometry.dispose();
    this.tube.geometry = g;
    this.indexCount = g.index.count;
    this.applyGrow();
    // ends
    for (const e of this.ends) { this.group.remove(e); }
    this.ends = [this.endPiece(a, da, lenA), this.endPiece(b, db, lenB)].filter(Boolean);
    for (const e of this.ends) this.group.add(e);
    this.ends[1] && (this.ends[1].visible = this.grow >= 0.999);
  }

  endPiece(end, dir, len) {
    const m = M.mats();
    let mesh;
    if (end.kind === 'socket') {
      mesh = new THREE.Mesh(socketGeo(), m.blackPlastic);
      mesh.position.copy(end.p).addScaledVector(dir, len / 2 - 0.55);
    } else if (end.kind === 'solder') {
      mesh = new THREE.Mesh(sleeveGeo(), m.black);
      mesh.position.copy(end.p).addScaledVector(dir, 0.35);
    } else return null;
    mesh.quaternion.setFromUnitVectors(UP, dir);
    mesh.castShadow = true;
    return mesh;
  }

  setGrow(t) {
    this.grow = Math.max(0, Math.min(1, t));
    this.applyGrow();
  }

  applyGrow() {
    const g = this.tube.geometry;
    if (!g.index) return;
    const n = Math.floor((this.indexCount / 6) * this.grow) * 6;
    g.setDrawRange(0, this.grow >= 0.999 ? Infinity : n);
    if (this.ends[0]) this.ends[0].visible = this.grow > 0.001;
    if (this.ends[1]) this.ends[1].visible = this.grow >= 0.999;
  }

  dispose() { this.tube.geometry.dispose(); }
}

let _socket = null, _sleeve = null;
function socketGeo() { if (!_socket) { _socket = M.trackGeo(new THREE.BoxGeometry(0.26, 1.4, 0.26)); } return _socket; }
function sleeveGeo() { if (!_sleeve) { _sleeve = M.trackGeo(new THREE.CylinderGeometry(0.12, 0.12, 0.7, 8)); } return _sleeve; }
export function resetWireGeo() { _socket = null; _sleeve = null; }

/** A group of wires that behaves as one part (e.g. the four sensor jumpers). */
export class WireSet {
  constructor(wires) {
    this.wires = wires;
    this.group = new THREE.Group();
    for (const w of wires) this.group.add(w.group);
  }
  setGrow(t) { for (const w of this.wires) w.setGrow(t); }
  dispose() { for (const w of this.wires) w.dispose(); }
}
