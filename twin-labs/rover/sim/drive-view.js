// The drive step's 3D side: the arena, its obstacles, the ultrasonic beam, wheels and head following the
// simulator, and the camera modes (orbit, chase, top).

import * as THREE from 'three';
import { token } from '../../js/core/dom.js';
import * as M from '../scene/materials.js';
import { ARENA_HALF, WALLS } from './sim.js';

const D2R = Math.PI / 180;

export class DriveView {
  constructor(bench, sim, opts = {}) {
    this.bench = bench;
    this.sim = sim;
    this.opts = { beam: true, follow: true, ...opts };
    this.camMode = 'orbit';
    this.paused = false;
    this.external = null; // telemetry from a real car
    this.group = new THREE.Group();
    bench.scene.add(this.group);
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA_HALF * 2, ARENA_HALF * 2), new THREE.MeshStandardMaterial({ roughness: 0.95 }));
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = 0.01;
    this.floor.receiveShadow = true;
    this.group.add(this.floor);
    this.obsGroup = new THREE.Group();
    this.group.add(this.obsGroup);
    this.textures = {};
    this.buildWalls();
    this.rebuildObstacles();
    this.applyTheme();

    // beam: a flat cone along the head's +x, from the sensor face
    const beamGeo = new THREE.ConeGeometry(1, 1, 24, 1, true);
    beamGeo.translate(0, -0.5, 0);
    beamGeo.rotateZ(Math.PI / 2);
    this.beamMat = new THREE.MeshBasicMaterial({ color: 0xffb020, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide });
    this.beam = new THREE.Mesh(beamGeo, this.beamMat);
    this.beam.position.set(2.9, 1.75, 0);
    this.beam.renderOrder = 5;
    bench.head.add(this.beam);
    this.dot = new THREE.Mesh(new THREE.SphereGeometry(0.9, 16, 10), new THREE.MeshBasicMaterial({ color: 0xff7a1a }));
    this.group.add(this.dot);

    this.wheels = bench.items.filter(it => it.part === 'wheel');
    this.sonarWire = () => bench.items.find(it => it.sonar && it.boardOk);
    this.lastAngle = 90;
    this.buzzerItem = bench.items.find(it => it.part === 'buzzer');

    bench.controls.maxDistance = 520;
    this.setCamMode('orbit', true);
    bench.setDriveView(this);
  }

  ownsCamera() { return this.camMode === 'chase' || this.camMode === 'top'; }

  setCamMode(mode, instant = false) {
    this.camMode = mode;
    const b = this.bench;
    b.controls.enabled = mode === 'orbit';
    if (mode === 'orbit') {
      const p = this.sim.pose;
      const target = new THREE.Vector3(p.x, 4, p.z);
      const pos = target.clone().add(new THREE.Vector3(-58, 52, -66));
      if (instant) { b.camera.position.copy(pos); b.controls.target.copy(target); }
      else b.flyTo(pos, target, 0.9);
    }
  }

  applyTheme() {
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    const base = token(light ? '--surface' : '--surface-2') || '#14213a';
    const line = light ? 'rgba(30,50,90,.12)' : 'rgba(160,190,240,.12)';
    const bold = light ? 'rgba(30,50,90,.22)' : 'rgba(160,190,240,.22)';
    const old = this.floor.material.map;
    this.floor.material.map = M.canvasTex(1024, 1024, (c, w, h) => {
      c.fillStyle = base; c.fillRect(0, 0, w, h);
      const px = w / (ARENA_HALF * 2);
      c.lineWidth = 1; c.strokeStyle = line;
      for (let i = 0; i <= 30; i++) { const v = i * 10 * px; c.beginPath(); c.moveTo(v, 0); c.lineTo(v, h); c.stroke(); c.beginPath(); c.moveTo(0, v); c.lineTo(w, v); c.stroke(); }
      c.lineWidth = 3; c.strokeStyle = bold;
      for (let i = 0; i <= 6; i++) { const v = i * 50 * px; c.beginPath(); c.moveTo(v, 0); c.lineTo(v, h); c.stroke(); c.beginPath(); c.moveTo(0, v); c.lineTo(w, v); c.stroke(); }
      // start box
      c.strokeStyle = light ? 'rgba(200,140,0,.6)' : 'rgba(251,191,36,.55)';
      c.setLineDash([10, 8]); c.lineWidth = 3;
      c.strokeRect(w / 2 - 13 * px, h / 2 - 10 * px, 27 * px, 20 * px);
    });
    this.floor.material.needsUpdate = true;
    old?.dispose();
  }

  buildWalls() {
    const wallMat = M.std(0xeeeae0, { roughness: 0.8 });
    for (const w of WALLS) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(w.w, w.h, w.d), wallMat);
      m.position.set(w.x, w.h / 2, w.z);
      m.castShadow = m.receiveShadow = true;
      this.group.add(m);
    }
  }

  tex(style) {
    if (this.textures[style]) return this.textures[style];
    const t = {
      cardboard: () => M.canvasTex(256, 256, (c, w, h) => {
        c.fillStyle = '#c99a5b'; c.fillRect(0, 0, w, h);
        c.globalAlpha = 0.18; c.fillStyle = '#7a5223';
        for (let i = 0; i < 40; i++) c.fillRect(0, i * 7, w, 1);
        c.globalAlpha = 1; c.fillStyle = '#d8b47a'; c.fillRect(w * 0.42, 0, w * 0.16, h);
        c.fillStyle = 'rgba(80,50,20,.6)'; c.font = 'bold 26px sans-serif'; c.fillText('↑ ↑', 30, 60);
      }),
      wood: () => M.canvasTex(256, 256, (c, w, h) => {
        c.fillStyle = '#d9b07a'; c.fillRect(0, 0, w, h);
        c.strokeStyle = 'rgba(120,70,30,.35)'; c.lineWidth = 2;
        for (let i = 0; i < 22; i++) { c.beginPath(); c.moveTo(0, i * 12 + 4); c.bezierCurveTo(w * 0.3, i * 12 + 9, w * 0.7, i * 12 - 2, w, i * 12 + 5); c.stroke(); }
        c.fillStyle = 'rgba(100,60,25,.4)'; c.fillRect(0, h / 2, w, 3);
      }),
      can: () => M.canvasTex(256, 128, (c, w, h) => {
        c.fillStyle = '#b8c0c8'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#d83a2e'; c.fillRect(0, h * 0.25, w, h * 0.5);
        c.fillStyle = '#fff'; c.font = 'bold 34px sans-serif'; c.fillText('SODA', 70, h * 0.62);
      }),
      pot: () => M.canvasTex(128, 128, (c, w, h) => {
        c.fillStyle = '#c7643b'; c.fillRect(0, 0, w, h);
        c.fillStyle = '#a84f2c'; c.fillRect(0, 10, w, 14);
      }),
    }[style]();
    this.textures[style] = M.std(0xffffff, { map: t, roughness: 0.85, metalness: style === 'can' ? 0.4 : 0 });
    return this.textures[style];
  }

  rebuildObstacles() {
    for (const c of [...this.obsGroup.children]) { c.geometry.dispose(); this.obsGroup.remove(c); }
    for (const o of this.sim.obstacles) {
      let m;
      if (o.kind === 'box') {
        m = new THREE.Mesh(new THREE.BoxGeometry(o.w, o.h, o.d), this.tex(o.style));
        m.rotation.y = o.rot || 0;
      } else {
        m = new THREE.Mesh(new THREE.CylinderGeometry(o.r, o.style === 'pot' ? o.r * 0.82 : o.r, o.h, 28), this.tex(o.style));
      }
      m.position.set(o.x, o.h / 2, o.z);
      m.castShadow = m.receiveShadow = true;
      m.userData.obstacle = o.id;
      this.obsGroup.add(m);
    }
  }

  setOptions(o) { Object.assign(this.opts, o); }

  update(dt) {
    const sim = this.sim, b = this.bench;
    if (!this.paused && !this.external) sim.tick(dt);
    const p = sim.pose;
    b.root.position.set(p.x, 0, p.z);
    b.root.rotation.set(0, p.h, 0);
    const servo = this.external ? this.external.servo ?? 90 : sim.servo;
    b.setHeadAngle(servo);
    if (Math.abs(servo - this.lastAngle) > 0.8) {
      this.lastAngle = servo;
      this.sonarWire()?.wire.update?.(servo);
    }
    b.setLed(this.external ? !!this.external.led : sim.led);
    // wheels roll with each side's travel
    const tl = this.external ? (this.extTravel ||= { l: 0, r: 0 }) : sim.travel;
    if (this.external) { tl.l += (this.external.motorL || 0) * 0.6 * dt; tl.r += (this.external.motorR || 0) * 0.6 * dt; }
    for (const it of this.wheels) {
      const left = it.cur.p.z < 0;
      const ang = (left ? tl.l : tl.r) / 3.25;
      it.spin = left ? ang : -ang;
    }
    // beam
    const dist = this.external ? this.external.distance ?? 400 : sim.distance;
    const len = Math.min(dist, 400);
    const showBeam = this.opts.beam;
    this.beam.visible = showBeam;
    this.dot.visible = showBeam && len < 399;
    if (showBeam) {
      const rad = Math.tan(7.5 * D2R) * len;
      this.beam.scale.set(len, rad, rad);
      const near = dist < sim.cfg.clear;
      this.beamMat.color.set(near ? 0xff4d3d : 0xffb020);
      this.beamMat.opacity = near ? 0.24 : 0.15;
      const r = sim.sonarRay();
      this.dot.position.set(r.x + Math.cos(r.bearing) * len, 7.7, r.z - Math.sin(r.bearing) * len);
    }
    // buzzer pulse
    const buzz = this.external ? !!this.external.buzzer : sim.buzzer;
    if (this.buzzerItem) this.buzzerItem.pulse = buzz ? 1 + 0.12 * Math.sin(performance.now() / 30) : 1;
    this.updateCamera(dt);
  }

  /** Called by the bench after it places the items, to add wheel spin and buzzer pulse. */
  decorate() {
    for (const it of this.wheels) if (it.obj.visible && it.spin != null) it.obj.rotateZ(it.spin);
    if (this.buzzerItem?.obj.visible) this.buzzerItem.obj.scale.setScalar(this.buzzerItem.pulse || 1);
  }

  updateCamera(dt) {
    const b = this.bench, p = this.sim.pose;
    const k = 1 - Math.exp(-dt * 4);
    if (this.camMode === 'chase') {
      const back = new THREE.Vector3(p.x - Math.cos(p.h) * 42, 24, p.z + Math.sin(p.h) * 42);
      b.camera.position.lerp(back, k);
      const look = new THREE.Vector3(p.x + Math.cos(p.h) * 30, 5, p.z - Math.sin(p.h) * 30);
      this.chaseLook = this.chaseLook ? this.chaseLook.lerp(look, k) : look;
      b.camera.lookAt(this.chaseLook);
    } else if (this.camMode === 'top') {
      const pos = new THREE.Vector3(-1, 580, 0);
      b.camera.position.lerp(pos, k);
      b.camera.lookAt(0, 0, 0);
    } else if (this.opts.follow && !b.camTween) {
      const target = new THREE.Vector3(p.x, 4, p.z);
      const delta = target.clone().sub(b.controls.target).multiplyScalar(k);
      b.controls.target.add(delta);
      b.camera.position.add(delta);
    }
  }

  dispose() {
    this.bench.head.remove(this.beam);
    this.beam.geometry.dispose();
    this.beamMat.dispose();
    this.dot.geometry.dispose();
    this.dot.material.dispose();
    this.group.traverse(o => o.geometry?.dispose());
    this.floor.material.map?.dispose();
    this.floor.material.dispose();
    this.bench.scene.remove(this.group);
    for (const it of this.wheels) it.spin = null;
    if (this.buzzerItem) { this.buzzerItem.pulse = 1; this.buzzerItem.obj.scale.setScalar(1); }
    this.sonarWire()?.wire.update?.(90);
    this.bench.controls.enabled = true;
    this.bench.setDriveView(null);
  }
}
