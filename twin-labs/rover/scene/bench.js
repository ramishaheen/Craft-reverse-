// The 3D workbench: renderer, camera, parts mat, the car's assembly animation, highlighting, picking,
// mat labels, the exploded view and step thumbnails. The drive step plugs in through setDriveView().

import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from '../vendor/RoomEnvironment.js';
import { token } from '../../js/core/dom.js';
import * as M from './materials.js';
import { clearGeoCache } from './models.js';
import { resetWireGeo } from './wires.js';
import { buildCar, poseAt, changesAt, STAGE } from './car.js';

const PHASE = 1.5;     // seconds per instruction in the assembly animation
const MOVE = 0.95;     // seconds for one part to settle
const EXPLODE_DY = 2.0;
const ease = t => 1 - Math.pow(1 - t, 3);
const easeInOut = t => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

const CAM = {
  kit: { pos: new THREE.Vector3(0, 60, 44), target: new THREE.Vector3(0, 0, 2.5) },
  build: { pos: new THREE.Vector3(16, 29, -37), target: new THREE.Vector3(0.5, 4.5, 0) },
};

export class Bench {
  constructor(container, hooks = {}) {
    this.container = container;
    this.hooks = hooks;
    this.board = 'uno';
    this.step = 0;
    this.explode = 0;
    this.explodeTarget = 0;
    this.playing = true;
    this.speed = 1;
    this.anim = null;
    this.labelsOn = true;
    this.highlighted = null;
    this.quality = 'high';
    this.drive = null;
    this.disposed = false;

    const r = this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.NeutralToneMapping;
    r.toneMappingExposure = 1.05;
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.domElement.className = 'rv-canvas';
    container.append(r.domElement);

    this.scene = new THREE.Scene();
    // soft studio reflections so metal parts (motor cans, pins, transducers) read as metal
    const pmrem = new THREE.PMREMGenerator(r);
    const room = new RoomEnvironment();
    this.envRT = pmrem.fromScene(room, 0.04);
    room.traverse(o => { o.geometry?.dispose(); o.material?.dispose?.(); });
    pmrem.dispose();
    this.scene.environment = this.envRT.texture;
    this.scene.environmentIntensity = 0.55;
    this.camera = new THREE.PerspectiveCamera(32, 1, 0.5, 2000);
    this.camera.position.copy(CAM.kit.pos);
    this.controls = new OrbitControls(this.camera, r.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.09;
    this.controls.minDistance = 10;
    this.controls.maxDistance = 220;
    this.controls.maxPolarAngle = Math.PI * 0.47;
    this.controls.target.copy(CAM.kit.target);
    this.controls.addEventListener('start', () => { this.camTween = null; this.userMoved = true; });

    this.hemi = new THREE.HemisphereLight(0xffffff, 0x8899aa, 1.25);
    this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffffff, 1.9);
    this.sun.position.set(-18, 46, -26);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(2048, 2048);
    const sc = this.sun.shadow.camera;
    sc.left = -42; sc.right = 42; sc.top = 32; sc.bottom = -32; sc.near = 5; sc.far = 140;
    this.sun.shadow.bias = -0.0004;
    this.sun.shadow.normalBias = 0.02;
    this.scene.add(this.sun, this.sun.target);
    const fill = new THREE.DirectionalLight(0xffffff, 0.55);
    fill.position.set(30, 20, 30);
    this.scene.add(fill);

    // ground + mat
    this.bench = new THREE.Group();
    this.scene.add(this.bench);
    this.ground = new THREE.Mesh(new THREE.PlaneGeometry(900, 900), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -0.02;
    this.ground.receiveShadow = true;
    this.scene.add(this.ground);
    this.mat = new THREE.Mesh(new THREE.BoxGeometry(68, 0.1, 46), new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92 }));
    this.mat.position.y = 0.05;
    this.mat.receiveShadow = true;
    this.bench.add(this.mat);

    // the car
    const car = buildCar();
    this.car = car;
    this.root = car.root;
    this.head = car.head;
    this.items = car.items;
    this.scene.add(this.root);
    for (const it of this.items) {
      it.obj.traverse(o => { if (o.isMesh || o.isLineSegments) o.userData.mat0 = o.material; });
      it.cur = { p: new THREE.Vector3(), q: new THREE.Quaternion() };
      it.from = null;
    }
    this.ledLight = new THREE.PointLight(0xff3b30, 0, 14, 2);
    this.root.add(this.ledLight);
    this.ledLight.position.set(4.6, 5.5, -6);

    // labels overlay
    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'rv-labels';
    container.append(this.labelLayer);
    this.labels = car.kitLabels.map(l => {
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'rv-label';
      el.textContent = l.text;
      el.addEventListener('pointerenter', () => this.hooks.onLabelHover?.(l.parts));
      el.addEventListener('pointerleave', () => this.hooks.onLabelHover?.(null));
      el.addEventListener('click', () => this.hooks.onPick?.(l.parts[0]));
      this.labelLayer.append(el);
      return { ...l, el, v: new THREE.Vector3(l.at[0], 0.6, l.at[1]) };
    });

    // picking
    this.ray = new THREE.Raycaster();
    this.pointer = new THREE.Vector2();
    this.hoverPart = null;
    const el = r.domElement;
    this.onMove = e => this.handleMove(e);
    this.onLeave = () => this.setHover(null);
    this.onDown = e => { this.downAt = [e.clientX, e.clientY]; };
    this.onUp = e => {
      if (!this.downAt) return;
      const moved = Math.hypot(e.clientX - this.downAt[0], e.clientY - this.downAt[1]);
      this.downAt = null;
      if (moved < 5 && !this.drive) {
        const part = this.pickAt(e.clientX, e.clientY);
        if (part) this.hooks.onPick?.(part);
      }
    };
    el.addEventListener('pointermove', this.onMove);
    el.addEventListener('pointerleave', this.onLeave);
    el.addEventListener('pointerdown', this.onDown);
    el.addEventListener('pointerup', this.onUp);

    this.ro = new ResizeObserver(() => this.resize());
    this.ro.observe(container);
    this.resize();
    this.applyTheme();
    this.applyBoard();
    this.snapStep(0);

    this.clock = new THREE.Clock();
    this.thumbQueue = [];
    const loop = () => {
      if (this.disposed) return;
      this.raf = requestAnimationFrame(loop);
      this.frame();
    };
    this.raf = requestAnimationFrame(loop);
  }

  // ---- setup ---------------------------------------------------------------------------------

  resize() {
    const w = Math.max(1, this.container.clientWidth), h = Math.max(1, this.container.clientHeight);
    const pr = this.quality === 'low' ? 1 : Math.min(2, window.devicePixelRatio || 1);
    this.renderer.setPixelRatio(pr);
    this.renderer.setSize(w, h, false);
    const before = this.camera.aspect;
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.size = { w, h };
    // until the person moves the camera, keep the step's framing as the panel changes shape
    if (!this.userMoved && !this.drive && this.items && Math.abs(before - this.camera.aspect) > 0.02) {
      const p = this.presetFor(this.step);
      this.camTween = null;
      this.camera.position.copy(p.pos);
      this.controls.target.copy(p.target);
    }
  }

  setQuality(q) {
    this.quality = q;
    this.renderer.shadowMap.enabled = q !== 'low';
    this.sun.castShadow = q !== 'low';
    this.scene.traverse(o => { if (o.material) o.material.needsUpdate = true; });
    this.resize();
  }

  applyTheme() {
    const bg = new THREE.Color(token('--bg') || '#070d1a');
    const light = document.documentElement.getAttribute('data-theme') === 'light';
    this.scene.background = bg;
    this.scene.fog = this.drive ? new THREE.Fog(bg, 700, 1600) : new THREE.Fog(bg, 160, 520);
    const grid = light ? 'rgba(30,50,90,.10)' : 'rgba(150,180,230,.09)';
    const base = token('--bg-2') || '#0b1324';
    const old = this.ground.material.map;
    this.ground.material.map = M.canvasTex(512, 512, (c, w, h) => {
      c.fillStyle = base; c.fillRect(0, 0, w, h);
      c.strokeStyle = grid; c.lineWidth = 3;
      for (let i = 0; i <= 4; i++) { c.beginPath(); c.moveTo(i * 128, 0); c.lineTo(i * 128, h); c.stroke(); c.beginPath(); c.moveTo(0, i * 128); c.lineTo(w, i * 128); c.stroke(); }
    }, { repeat: [900 / 40, 900 / 40] });
    this.ground.material.needsUpdate = true;
    old?.dispose();
    const teal = new THREE.Color(token('--teal') || '#2dd4bf');
    const matCol = new THREE.Color(light ? '#2f7a63' : '#1d5a4c').lerp(teal, 0.12);
    const oldMat = this.mat.material.map;
    this.mat.material.map = matTexture(`#${matCol.getHexString()}`, light);
    this.mat.material.needsUpdate = true;
    oldMat?.dispose();
    this.hemi.groundColor.set(light ? 0xb9b2a0 : 0x334155);
    this.hemi.intensity = light ? 1.35 : 1.15;
    if (this.drive) this.drive.applyTheme?.();
    this.thumbsDirty = true;
  }

  setBoard(board) {
    if (board === this.board) return;
    this.board = board;
    this.applyBoard();
    this.snapStep(this.step);
  }

  applyBoard() {
    for (const it of this.items) it.boardOk = !it.board || it.board === this.board;
    for (const l of this.labels) l.boardOk = !l.board || l.board === this.board;
  }

  // ---- steps and animation -------------------------------------------------------------------

  targetFor(it, step) {
    if (!it.boardOk) return null;
    if (step === STAGE.parts) return it.kit ? this.kitLocal(it) : null;
    if (it.kitOnly) return null;
    const pz = poseAt(it, Math.min(step, STAGE.wiring));
    return pz ? { p: pz.p.clone(), q: new THREE.Quaternion().setFromEuler(pz.r) } : null;
  }

  kitLocal(it) {
    const p = it.kit.p.clone();
    if (it.inHead) p.sub(this.head.position);
    return { p, q: new THREE.Quaternion().setFromEuler(it.kit.r) };
  }

  /** Jump straight to a step's finished state. */
  snapStep(step) {
    this.step = step;
    this.anim = null;
    for (const it of this.items) {
      const t = this.targetFor(it, step);
      it.to = t;
      it.from = null;
      it.visible = !!t;
      it.hidden = false;
      it.grow = 1;
      if (t) { it.cur.p.copy(t.p); it.cur.q.copy(t.q); }
    }
    this.head.rotation.y = 0;
    this.hooks.onPhase?.(-1);
  }

  /** Show a step; animate the parts it brings in when coming from the step before it. */
  showStep(step, { animate = true, only = null } = {}) {
    const prev = this.step;
    const build = step >= STAGE.motors && step <= STAGE.wiring;
    if (!animate || !build || (step !== prev + 1 && only == null && step !== prev)) {
      this.snapStep(step);
      return;
    }
    this.step = step;
    let maxPhase = -1;
    for (const it of this.items) {
      const t = this.targetFor(it, step);
      it.to = t;
      it.visible = !!t;
      it.from = null;
      it.hidden = false;
      it.grow = 1;
      if (!t) continue;
      const ch = changesAt(it, step);
      if (!ch) { it.cur.p.copy(t.p); it.cur.q.copy(t.q); continue; }
      const ph = ch === 'move' ? (it.movePhase ?? it.phase) : it.phase;
      if (only != null && ph !== only) { it.cur.p.copy(t.p); it.cur.q.copy(t.q); continue; }
      const start = (only != null ? 0 : ph * PHASE) + (it.delay || 0);
      maxPhase = Math.max(maxPhase, ph);
      if (it.wire && !it.noGrow) {
        it.from = { t0: start, mode: 'grow' };
        it.grow = 0;
        it.cur.p.copy(t.p); it.cur.q.copy(t.q);
      } else if (ch === 'move') {
        const pz = this.targetFor(it, step - 1) || t;
        it.from = { t0: start, mode: 'move', p: pz.p.clone(), q: pz.q.clone() };
        it.cur.p.copy(pz.p); it.cur.q.copy(pz.q);
      } else {
        const off = it.enter ? it.enter.clone() : new THREE.Vector3(0, 9, 0);
        it.from = { t0: start, mode: 'enter', p: t.p.clone().add(off), q: t.q.clone() };
        it.cur.p.copy(it.from.p); it.cur.q.copy(t.q);
        it.hidden = true;
      }
    }
    if (maxPhase < 0) { this.anim = null; this.hooks.onPhase?.(-1); return; }
    this.anim = { t: 0, end: (only != null ? 0 : maxPhase * PHASE) + MOVE + 0.9, only, phase: -2 };
    this.playing = true;
    this.hooks.onPlayState?.(true);
  }

  replayPhase(k) { this.showStep(this.step, { animate: true, only: k }); }
  replay() {
    const s = this.step;
    this.step = s - 1;
    this.showStep(s, { animate: true });
  }
  isAnimating() { return !!this.anim; }
  setPlaying(p) { this.playing = p; this.hooks.onPlayState?.(p); }
  setSpeed(s) { this.speed = s; }
  setExplode(on) { this.explodeTarget = on ? 1 : 0; }
  setLabels(on) { this.labelsOn = on; }

  updateAnim(dt) {
    const a = this.anim;
    if (!a) return;
    if (this.playing) a.t += dt * this.speed;
    const phase = a.only != null ? a.only : Math.min(Math.floor(a.t / PHASE), 99);
    if (phase !== a.phase) { a.phase = phase; this.hooks.onPhase?.(phase); }
    let busy = false;
    for (const it of this.items) {
      const f = it.from;
      if (!f || !it.to) continue;
      const k = (a.t - f.t0) / MOVE;
      if (k < 1) busy = true;
      const e = ease(Math.max(0, Math.min(1, k)));
      if (f.mode === 'grow') {
        it.grow = Math.max(0, Math.min(1, (a.t - f.t0) / (MOVE * 1.3)));
        if (it.grow < 1) busy = true;
      } else {
        it.cur.p.lerpVectors(f.p, it.to.p, e);
        it.cur.q.slerpQuaternions(f.q, it.to.q, e);
        it.hidden = k < 0;
      }
    }
    if (!busy && a.t >= a.end) {
      this.anim = null;
      for (const it of this.items) { it.from = null; it.hidden = false; }
      this.hooks.onPhase?.(-1);
      this.hooks.onPlayState?.(false);
    }
  }

  applyItems() {
    const ex = this.explode;
    const drive = !!this.drive;
    for (const it of this.items) {
      const o = it.obj;
      const show = it.visible && !it.hidden && !(it.wire && ex > 0.02);
      o.visible = show;
      if (!show) continue;
      o.position.copy(it.cur.p);
      if (ex > 0 && !drive) o.position.y += it.layer * EXPLODE_DY * ex;
      o.quaternion.copy(it.cur.q);
      if (it.wire && it.wire.setGrow && it.lastGrow !== it.grow) { it.wire.setGrow(it.grow); it.lastGrow = it.grow; }
    }
  }

  // ---- highlight and picking -----------------------------------------------------------------

  highlight(parts) {
    const set = parts && parts.length ? new Set(parts) : null;
    const key = set ? [...set].sort().join() : '';
    if (key === this.hlKey) return;
    this.hlKey = key;
    for (const it of this.items) {
      const mode = !set ? 0 : set.has(it.part) ? 1 : 2;
      it.obj.traverse(o => {
        if (!o.userData.mat0) return;
        o.material = mode === 0 ? o.userData.mat0 : variant(o.userData.mat0, mode === 1 ? 'hi' : 'ghost');
      });
    }
    for (const l of this.labels) l.el.classList.toggle('on', !!set && l.parts.some(p => set.has(p)));
  }

  pickAt(cx, cy) {
    const rect = this.renderer.domElement.getBoundingClientRect();
    this.pointer.set(((cx - rect.left) / rect.width) * 2 - 1, -((cy - rect.top) / rect.height) * 2 + 1);
    this.ray.setFromCamera(this.pointer, this.camera);
    const hits = this.ray.intersectObject(this.root, true);
    for (const h of hits) {
      let o = h.object, vis = true;
      for (let p = o; p; p = p.parent) if (!p.visible) { vis = false; break; }
      if (!vis || o.isLineSegments) continue;
      if (o.userData.part) return o.userData.part;
    }
    return null;
  }

  handleMove(e) {
    if (this.drive || e.buttons) return;
    const part = this.pickAt(e.clientX, e.clientY);
    this.setHover(part, e.clientX, e.clientY);
  }

  setHover(part, x, y) {
    this.hoverPart = part;
    this.renderer.domElement.style.cursor = part ? 'pointer' : '';
    this.hooks.onHover?.(part, x, y);
  }

  // ---- camera --------------------------------------------------------------------------------

  presetFor(step) {
    const kit = step === STAGE.parts;
    const c = kit ? CAM.kit : CAM.build;
    const aspect = this.camera.aspect || 1.5;
    const tanH = Math.tan(THREE.MathUtils.degToRad(this.camera.fov / 2));
    // distance that fits the mat (kit) or the car (build) in both directions
    const need = kit ? Math.max(41 / (tanH * aspect), 27 / tanH) : Math.max(19.5 / (tanH * aspect), 13.5 / tanH);
    const dir = c.pos.clone().sub(c.target).normalize();
    return { pos: c.target.clone().addScaledVector(dir, need), target: c.target.clone() };
  }

  flyTo(pos, target, dur = 1.1) {
    this.camTween = { t: 0, dur, p0: this.camera.position.clone(), t0: this.controls.target.clone(), p1: pos, t1: target };
  }

  resetView() { const p = this.presetFor(this.step); this.flyTo(p.pos, p.target, 0.8); }

  zoom(dir) {
    const t = this.controls.target, c = this.camera.position;
    const d = c.clone().sub(t);
    const len = THREE.MathUtils.clamp(d.length() * (dir > 0 ? 0.78 : 1.28), this.controls.minDistance, this.controls.maxDistance);
    this.flyTo(t.clone().add(d.setLength(len)), t.clone(), 0.35);
  }

  updateCam(dt) {
    const tw = this.camTween;
    if (!tw) return;
    tw.t += dt;
    const e = easeInOut(Math.min(1, tw.t / tw.dur));
    this.camera.position.lerpVectors(tw.p0, tw.p1, e);
    this.controls.target.lerpVectors(tw.t0, tw.t1, e);
    if (tw.t >= tw.dur) this.camTween = null;
  }

  // ---- frame ---------------------------------------------------------------------------------

  frame() {
    const dt = Math.min(0.1, this.clock.getDelta());
    this.updateAnim(dt);
    const ex = this.explodeTarget;
    if (Math.abs(this.explode - ex) > 0.001) this.explode += (ex - this.explode) * Math.min(1, dt * 7);
    else this.explode = ex;
    this.drive?.update(dt);
    this.applyItems();
    this.drive?.decorate();
    this.updateCam(dt);
    if (!this.drive || !this.drive.ownsCamera()) this.controls.update();
    this.hooks.onFrame?.(dt);
    if (this.thumbQueue.length) this.renderThumb(this.thumbQueue.shift());
    this.renderer.render(this.scene, this.camera);
    this.updateLabels();
  }

  updateLabels() {
    const show = this.labelsOn && this.step === STAGE.parts && !this.drive;
    this.labelLayer.hidden = !show;
    if (!show) return;
    const { w, h } = this.size;
    const compact = w < 560; // small screens: only the labels of what is lit up
    const v = new THREE.Vector3();
    for (const l of this.labels) {
      if (!l.boardOk || (compact && !l.el.classList.contains('on'))) { l.el.style.display = 'none'; continue; }
      v.copy(l.v).project(this.camera);
      const off = v.z > 1 || v.x < -1.1 || v.x > 1.1 || v.y < -1.1 || v.y > 1.1;
      l.el.style.display = off ? 'none' : '';
      if (!off) l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -50%)`;
    }
  }

  // ---- thumbnails ----------------------------------------------------------------------------

  /** Queue snapshots of every step's finished state; cb(step, dataUrl). */
  makeThumbs(steps, cb) {
    this.thumbCb = cb;
    this.thumbQueue = [...steps];
    this.thumbsDirty = false;
  }

  renderThumb(step) {
    const saved = this.items.map(it => ({ v: it.visible, h: it.hidden, p: it.cur.p.clone(), q: it.cur.q.clone(), g: it.grow }));
    const camP = this.camera.position.clone(), camQ = this.camera.quaternion.clone();
    const ex = this.explode, hl = this.hlKey, savedHl = this.highlighted;
    this.highlight(null);
    this.explode = 0;
    const isDrive = step === STAGE.drive;
    const shown = isDrive ? STAGE.code : step;
    for (const it of this.items) {
      const t = this.targetFor(it, shown);
      it.visible = !!t; it.hidden = false; it.grow = 1;
      if (t) { it.cur.p.copy(t.p); it.cur.q.copy(t.q); }
    }
    const driveWas = this.drive;
    if (driveWas) { driveWas.group.visible = false; this.bench.visible = true; this.root.position.set(0, 0, 0); this.root.rotation.set(0, 0, 0); }
    this.applyItems();
    const p = this.presetFor(step);
    const aspect = this.camera.aspect;
    this.camera.aspect = 1.4;
    this.camera.updateProjectionMatrix();
    const dir = p.pos.clone().sub(p.target);
    const dist = step === STAGE.parts ? 0.86 : isDrive ? 1.1 : 0.9;
    this.camera.position.copy(p.target).add(dir.multiplyScalar(dist));
    if (isDrive) this.camera.position.add(new THREE.Vector3(14, -6, 10));
    this.camera.lookAt(p.target);
    this.renderer.render(this.scene, this.camera);
    const src = this.renderer.domElement;
    const c = document.createElement('canvas');
    c.width = 168; c.height = 120;
    const sw = src.width, sh = src.height;
    const cropW = Math.min(sw, sh * 1.4), cropH = cropW / 1.4;
    c.getContext('2d').drawImage(src, (sw - cropW) / 2, (sh - cropH) / 2, cropW, cropH, 0, 0, c.width, c.height);
    let url = '';
    try { url = c.toDataURL('image/png'); } catch { /* tainted canvas: not expected */ }
    // restore
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
    this.camera.position.copy(camP);
    this.camera.quaternion.copy(camQ);
    this.items.forEach((it, i) => { const s = saved[i]; it.visible = s.v; it.hidden = s.h; it.cur.p.copy(s.p); it.cur.q.copy(s.q); it.grow = s.g; it.lastGrow = -1; });
    this.explode = ex;
    if (driveWas) { driveWas.group.visible = true; this.bench.visible = false; }
    this.hlKey = '__';
    this.highlight(hl ? hl.split(',') : null);
    this.highlighted = savedHl;
    this.applyItems();
    if (url) this.thumbCb?.(step, url);
  }

  // ---- drive ---------------------------------------------------------------------------------

  setDriveView(view) {
    this.drive = view;
    if (this.scene.fog) { this.scene.fog.near = view ? 700 : 160; this.scene.fog.far = view ? 1600 : 520; }
    this.bench.visible = !view;
    if (!view) {
      this.root.position.set(0, 0, 0);
      this.root.rotation.set(0, 0, 0);
      this.head.rotation.y = 0;
      this.setLed(false);
      this.controls.maxDistance = 220;
    }
  }

  setHeadAngle(deg) {
    this.head.rotation.y = (deg - 90) * Math.PI / 180;
  }

  setLed(on) {
    const m = M.mats().ledRed;
    m.emissiveIntensity = on ? 3.2 : 0.6;
    m.emissive.set(on ? 0xff2a1a : 0x550000);
    this.ledLight.intensity = on ? 22 : 0;
  }

  // ---- teardown ------------------------------------------------------------------------------

  dispose() {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    this.ro.disconnect();
    const el = this.renderer.domElement;
    el.removeEventListener('pointermove', this.onMove);
    el.removeEventListener('pointerleave', this.onLeave);
    el.removeEventListener('pointerdown', this.onDown);
    el.removeEventListener('pointerup', this.onUp);
    this.controls.dispose();
    this.drive?.dispose?.();
    for (const it of this.items) it.wire?.dispose?.();
    this.scene.traverse(o => {
      if (o.geometry && !o.geometry.userData?.shared) o.geometry.dispose();
    });
    this.ground.material.map?.dispose();
    this.ground.material.dispose();
    this.mat.material.map?.dispose();
    this.mat.material.dispose();
    for (const v of variants.values()) { v.hi?.dispose(); v.ghost?.dispose(); }
    variants.clear();
    M.disposeAll();
    clearGeoCache();
    resetWireGeo();
    this.envRT?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss?.();
    el.remove();
    this.labelLayer.remove();
  }
}

// highlighted / ghosted copies of a material, made on demand
const variants = new Map();
function variant(mat, kind) {
  if (Array.isArray(mat)) return mat.map(m => variant(m, kind));
  let v = variants.get(mat);
  if (!v) { v = {}; variants.set(mat, v); }
  if (!v[kind]) {
    const c = mat.clone();
    if (kind === 'hi') {
      if (c.emissive) { c.emissive = new THREE.Color(0xffb020); c.emissiveIntensity = 0.55; }
      if (c.isLineBasicMaterial) { c.color = new THREE.Color(0xffc040); c.opacity = 1; }
      if (c.transparent && c.opacity < 0.6) c.opacity = Math.min(0.75, c.opacity + 0.35);
    } else {
      c.transparent = true;
      c.opacity = (mat.opacity ?? 1) * 0.16;
      c.depthWrite = false;
    }
    v[kind] = c;
  }
  return v[kind];
}

/** The green cutting mat with a 1 cm grid, 5 cm lines and edge numbers. */
function matTexture(color, light) {
  return M.canvasTex(1360, 920, (c, w, h) => {
    c.fillStyle = color;
    c.fillRect(0, 0, w, h);
    const px = 20; // pixels per cm (68 × 46 cm)
    c.strokeStyle = 'rgba(255,255,255,.13)';
    c.lineWidth = 1;
    for (let x = 0; x <= w; x += px) { c.beginPath(); c.moveTo(x + 0.5, 0); c.lineTo(x + 0.5, h); c.stroke(); }
    for (let y = 0; y <= h; y += px) { c.beginPath(); c.moveTo(0, y + 0.5); c.lineTo(w, y + 0.5); c.stroke(); }
    c.strokeStyle = 'rgba(255,255,255,.32)';
    c.lineWidth = 2;
    for (let x = 0; x <= w; x += px * 5) { c.beginPath(); c.moveTo(x, 0); c.lineTo(x, h); c.stroke(); }
    for (let y = 0; y <= h; y += px * 5) { c.beginPath(); c.moveTo(0, y); c.lineTo(w, y); c.stroke(); }
    c.strokeStyle = 'rgba(255,255,255,.18)';
    c.lineWidth = 2;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(w * 0.35, h); c.stroke();
    c.fillStyle = 'rgba(255,255,255,.55)';
    c.font = '600 18px system-ui, sans-serif';
    c.textAlign = 'center';
    for (let i = 5; i < 68; i += 5) { c.fillText(String(i), i * px, h - 10); c.fillText(String(i), i * px, 22); }
    c.save(); c.rotate(-Math.PI / 2);
    for (let i = 5; i < 46; i += 5) c.fillText(String(i), -i * px, 22);
    c.restore();
    c.strokeStyle = light ? 'rgba(0,0,0,.18)' : 'rgba(0,0,0,.3)';
    c.lineWidth = 6;
    c.strokeRect(3, 3, w - 6, h - 6);
  });
}
