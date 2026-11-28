// The rover as a list of placed objects: where each sits on the finished car, which step brings it in
// (and during which instruction), where it lies on the parts mat, and how far it lifts in the exploded view.

import * as THREE from 'three';
import * as P from './models.js';
import { Wire, WireSet } from './wires.js';

const V = (x, y, z) => new THREE.Vector3(x, y, z);
const UP = V(0, 1, 0);
const D2R = Math.PI / 180;

// Heights (cm) of the car's levels.
export const Y = {
  deckB: 1.85, deckBTop: 2.15, axle: 3.25, deckM: 4.65, deckMTop: 4.95, ctrl: 5.95, deckT: 6.45, deckTTop: 6.75,
};
export const STAGE = { parts: 0, motors: 1, decks: 2, driver: 3, controller: 4, sensor: 5, power: 6, wiring: 7, code: 8, drive: 9 };

export const HEAD_PIVOT = V(9.75, Y.deckMTop + 1.02, 0);
const CTRL_ORIGIN = V(2.1, Y.ctrl, 0);
const DRIVER_ORIGIN = V(6.45, Y.deckMTop + 0.15, -2.4);

/** Controller frame (rotated −90° about y) to car space. */
function ctrlToCar(v) { return V(CTRL_ORIGIN.x - v.z, CTRL_ORIGIN.y + v.y, CTRL_ORIGIN.z + v.x); }
export function boardPin(board, name, row) {
  return ctrlToCar(board === 'uno' ? P.unoPin(name, row) : P.espPin(name, row));
}
function driverPinCar(name) { return P.driverPin(name).add(DRIVER_ORIGIN); }
/** Sensor pin in car space for a head angle in degrees (90 = ahead). */
export function sonarPinCar(name, angleDeg) {
  const local = P.sonarPin(name).add(P.SONAR_ORIGIN);
  local.applyAxisAngle(UP, (angleDeg - 90) * D2R);
  return local.add(HEAD_PIVOT);
}

/** Pose: position, Euler rotation (radians). */
const pose = (x, y, z, rx = 0, ry = 0, rz = 0) => ({ p: V(x, y, z), r: new THREE.Euler(rx, ry, rz) });

/**
 * Build every object of the car and the mat.
 * Returns { root, head, items, kitLabels } where each item is
 * { obj, part, stage, phase, poses:[{from, pose}], kit, layer, board, until, kitOnly, wire, enter }
 */
export function buildCar() {
  const root = new THREE.Group();
  root.name = 'rover';
  const items = [];
  const add = (part, obj, o) => {
    const it = { obj, part, stage: 1, phase: 0, layer: 0, poses: [], kit: null, board: null, until: 99, ...o };
    if (o.pose) it.poses = [{ from: it.stage, pose: o.pose }];
    obj.traverse(c => { c.userData.part = part; c.userData.item = it; });
    root.add(obj);
    items.push(it);
    return it;
  };

  // ---- step 2: motors ------------------------------------------------------------------------
  add('deckBottom', P.deckBottom(), { stage: 1, phase: 0, pose: pose(0, Y.deckB, 0), kit: pose(-17, 0.1, -13.5), layer: 0, enter: V(0, -6, 0) });
  const motorPos = [[6.5, -1, Math.PI], [6.5, 1, Math.PI], [-6.5, -1, 0], [-6.5, 1, 0]];
  motorPos.forEach(([x, side, ry], i) => {
    add('motor', P.motor(), { stage: 1, phase: 0, delay: i * 0.12, pose: pose(x, Y.axle, side * 3.75, 0, ry, 0), kit: pose(-29 + (i % 2) * 3.4, 1.0, -4 + Math.floor(i / 2) * 7.6, 0, -Math.PI / 2, 0), layer: 0 });
  });
  // brackets (inner in a slot, outer in the edge notch), bolts through both
  motorPos.forEach(([x, side], i) => {
    const bx = x - Math.sign(x) * 2.0;
    [2.75, 4.75].forEach((z, k) => add('bracket', P.bracket(), { stage: 1, phase: 1, delay: i * 0.1 + k * 0.05, pose: pose(bx, Y.deckBTop, side * z), kit: pose(-19.5 + (i * 2 + k) % 4 * 2.4, 0.25, -3.5 + Math.floor((i * 2 + k) / 4) * 4.2, -Math.PI / 2, 0, 0), layer: 0, enter: V(0, -5, 0) }));
    [Y.axle - 0.875, Y.axle + 0.875].forEach((y, k) => add('bolts', P.bolt(), { stage: 1, phase: 1, delay: 0.4 + i * 0.1 + k * 0.05, pose: pose(bx, y, side * 3.75, 0, side < 0 ? Math.PI : 0, 0), layer: 0, enter: V(0, 0, side * 5) }));
  });
  motorPos.forEach(([x, side], i) => {
    add('wheel', P.wheel(), { stage: 1, phase: 2, delay: i * 0.12, pose: pose(x, Y.axle, side * 6.8, 0, side < 0 ? Math.PI : 0, 0), kit: pose(-10.5 + (i % 2) * 7.2, 1.3, -2.6 + Math.floor(i / 2) * 7.2, -Math.PI / 2, 0, 0), layer: 0, enter: V(0, 0, side * 8) });
  });
  // motor leads standing up in the middle (until the driver step bends them over)
  const leadsUp = new WireSet(motorPos.flatMap(([x, side]) => {
    const tabX = x - Math.sign(x) * 5.45;
    return ['red', 'black'].map((c, k) => new Wire(c,
      { p: V(tabX, Y.axle + (k ? -0.5 : 0.5), side * 3.75 + side * 0.45), dir: V(-Math.sign(x), 0, 0), kind: 'solder' },
      { p: V(0.5 + (k ? 0.12 : -0.12) + Math.sign(x) * 0.25, 10.5 + k * 0.4, side * 0.25), dir: V(0, -1, 0), kind: 'bare' },
      [V(tabX - Math.sign(x) * 1.2, Y.axle + 0.2, side * 2.8), V(0.5 + Math.sign(x) * 0.6, 6.5, side * 0.6)]));
  }));
  add('motorLeads', leadsUp.group, { stage: 1, phase: 0, until: 3, pose: pose(0, 0, 0), wire: leadsUp, layer: 0 });

  // ---- step 3: decks -------------------------------------------------------------------------
  P.STANDOFF_XZ.bottom.forEach(([x, z], i) => add('standoff', P.standoff(2.5), { stage: 2, phase: 0, delay: i * 0.06, pose: pose(x, Y.deckBTop, z), layer: 1 }));
  [[-0.3, -2.5], [-0.3, 2.5], [4.4, -2.5], [4.4, 2.5]].forEach(([x, z], i) => add('standoff', P.standoff(1.0), { stage: 2, phase: 1, delay: i * 0.08, pose: pose(x, Y.deckMTop, z), layer: 3 }));
  P.STANDOFF_XZ.top.forEach(([x, z], i) => add('standoff', P.standoff(1.5), { stage: 2, phase: 1, delay: 0.35 + i * 0.08, pose: pose(x, Y.deckMTop, z), layer: 3 }));
  add('deckMiddle', P.deckMiddle(), { stage: 2, phase: 2, pose: pose(0, Y.deckM, 0), kit: pose(5, 0.1, -13.5), layer: 2 });
  P.STANDOFF_XZ.bottom.forEach(([x, z], i) => add('screws', P.screwHead(), { stage: 2, phase: 2, delay: 0.5 + i * 0.04, pose: pose(x, Y.deckMTop, z), layer: 2 }));

  // ---- step 4: driver ------------------------------------------------------------------------
  add('foam', P.foam(2.5, 1.9), { stage: 3, phase: 0, pose: pose(DRIVER_ORIGIN.x, Y.deckMTop, DRIVER_ORIGIN.z), kit: pose(9.5, 0.1, 2.2), layer: 2 });
  add('driver', P.driver(), { stage: 3, phase: 0, delay: 0.25, pose: pose(DRIVER_ORIGIN.x, DRIVER_ORIGIN.y, DRIVER_ORIGIN.z), kit: pose(9.5, 0.1, -2.4), layer: 2 });
  const termA = V(DRIVER_ORIGIN.x - 0.75, DRIVER_ORIGIN.y + 0.6, DRIVER_ORIGIN.z + 1.15);
  const termB = V(DRIVER_ORIGIN.x + 0.75, DRIVER_ORIGIN.y + 0.6, DRIVER_ORIGIN.z + 1.15);
  const leads = new WireSet(motorPos.flatMap(([x, side], mi) => {
    const tabX = x - Math.sign(x) * 5.45;
    const term = side < 0 ? termA : termB;
    return ['red', 'black'].map((c, k) => new Wire(c,
      { p: V(tabX, Y.axle + (k ? -0.5 : 0.5), side * 4.2), dir: V(-Math.sign(x), 0, 0), kind: 'solder' },
      { p: term.clone().add(V(k ? 0.25 : -0.25, 0, 0)), dir: V(0, 0, 1), kind: 'bare' },
      [V(tabX - Math.sign(x) * 1.0, Y.axle + 0.3, side * 2.2), V(0.5 + Math.sign(x) * 1.2 + mi * 0.1, Y.deckM - 0.2, side * 0.25), V(1.8 + mi * 0.15, Y.deckMTop + 0.5, side * 0.3), V(term.x - 0.4 + k * 0.5, term.y + 0.2, term.z + 1.4 + mi * 0.05)]));
  }));
  add('motorLeads', leads.group, { stage: 3, phase: 1, pose: pose(0, 0, 0), wire: leads, layer: 2 });

  // ---- step 5: controller --------------------------------------------------------------------
  const ctrlPose = pose(CTRL_ORIGIN.x, CTRL_ORIGIN.y, CTRL_ORIGIN.z, 0, -Math.PI / 2, 0);
  add('uno', P.uno(), { stage: 4, phase: 0, board: 'uno', pose: ctrlPose, kit: pose(15.2, 0.1, -3.2, 0, 0, 0), layer: 4 });
  add('shield', P.shield(), { stage: 4, phase: 1, board: 'uno', pose: ctrlPose, kit: pose(15.2, -1.05, 4.2, 0, 0, 0), layer: 5 });
  add('esp32', P.esp32(), { stage: 4, phase: 0, board: 'esp32', pose: ctrlPose, kit: pose(15.2, 0.1, -0.5, 0, 0, 0), layer: 4 });
  [[-0.3, -2.5], [-0.3, 2.5], [4.4, -2.5], [4.4, 2.5]].forEach(([x, z], i) => add('screws', P.screwHead(), { stage: 4, phase: 0, delay: 0.5 + i * 0.06, pose: pose(x, Y.ctrl + 0.16, z), layer: 4, board: 'uno' }));

  // ---- step 6: sensor head -------------------------------------------------------------------
  add('servo', P.servo(), { stage: 5, phase: 0, pose: pose(HEAD_PIVOT.x, Y.deckMTop, 0), kit: pose(25.5, 1.25, -4.5, 0, Math.PI / 2, 0), layer: 2 });
  const head = new THREE.Group();
  head.name = 'head';
  const horn = P.horn();
  const sBracket = P.sonarBracket();
  const sensor = P.sonar();
  sensor.position.copy(P.SONAR_ORIGIN);
  // parts of the head are separate items so each can animate in, but they all ride on the head pivot
  const headItems = [
    add('servo', horn, { stage: 5, phase: 1, pose: pose(0, 0, 0), kit: pose(25.5, 0.2, -1.2), layer: 9, inHead: true }),
    add('sonarBracket', sBracket, { stage: 5, phase: 2, pose: pose(0, 0, 0), kit: pose(21.5, 1.4, 0.4, 0, Math.PI / 2, 0), layer: 9, inHead: true }),
    add('sonar', sensor, { stage: 5, phase: 3, pose: { p: P.SONAR_ORIGIN.clone(), r: new THREE.Euler() }, kit: pose(21.5, 0.25, -4.8, -Math.PI / 2, 0, -Math.PI / 2), layer: 9, inHead: true, enter: V(6, 0, 0) }),
  ];
  for (const it of headItems) { root.remove(it.obj); head.add(it.obj); }
  head.position.copy(HEAD_PIVOT);
  root.add(head);
  const servoCable = new WireSet([['brown', -0.1], ['red', 0], ['orange', 0.1]].map(([c, dz]) => new Wire(c,
    { p: V(8.35, Y.deckMTop - 1.4, 0.62 + dz), dir: V(0, 0, 1), kind: 'solder' },
    { p: V(1.0, Y.deckMTop + 0.3, 4.6 + dz), dir: V(0, 0, 1), kind: 'socket' },
    [V(8.0, Y.deckM - 0.5, 1.4 + dz), V(5.5, Y.deckM - 0.4, 3.6 + dz), V(2.0, Y.deckM - 0.3, 4.1 + dz), V(1.6, Y.deckMTop + 0.6, 4.1 + dz)])));
  add('wireServo', servoCable.group, { stage: 5, phase: 0, until: 7, pose: pose(0, 0, 0), wire: servoCable, layer: 2 });

  // ---- step 7: power -------------------------------------------------------------------------
  add('deckTop', P.deckTop(), { stage: 6, phase: 0, pose: pose(-5.75, Y.deckT, 0), kit: pose(23.5, 0.1, -13.5), layer: 6 });
  P.STANDOFF_XZ.top.forEach(([x, z], i) => add('screws', P.screwHead(), { stage: 6, phase: 0, delay: 0.4 + i * 0.06, pose: pose(x, Y.deckTTop, z), layer: 6 }));
  const holderC = V(-5.6, Y.deckTTop, 0.3);
  add('battery', P.holder(), { stage: 6, phase: 2, pose: pose(holderC.x, holderC.y, holderC.z, 0, -Math.PI / 2, 0), kit: pose(29, 0.1, -3.5, 0, Math.PI / 2, 0), layer: 7 });
  [-1, 1].forEach((k, i) => add('cells', P.cell(), { stage: 6, phase: 7, delay: i * 0.2, pose: pose(holderC.x + k, holderC.y + 1.05, holderC.z, 0, -Math.PI / 2, 0), kit: pose(26.5 + i * 2.2, 1.0, 7.5, 0, Math.PI / 2, 0), layer: 8, enter: V(0, 8, 0) }));
  add('switch', P.slideSwitch(), { stage: 6, phase: 2, delay: 0.3, pose: pose(-2.6, Y.deckTTop, -4.75), kit: pose(-29, 0.1, 14.5), layer: 7 });
  // DC plug, in the controller's jack (its position depends on the board)
  add('dcPlug', P.dcPlug(), { stage: 6, phase: 4, board: 'uno', pose: pose(0.35, 6.24, -5.4), kit: pose(-4, 0.1, 13.6), layer: 4 });
  add('dcPlug', P.dcPlug(), { stage: 6, phase: 4, board: 'esp32', pose: pose(3.9, 6.24, -5.15), kit: pose(-4, 0.1, 13.6), layer: 4 });
  // LED + resistor, buzzer (+ transistor): soldered at the bench in step 7, fitted in step 8
  const benchY = 0.1;
  const ledPoses = [{ from: 6, pose: pose(-6, benchY, -13, 0, Math.PI / 2, 0) }, { from: 7, pose: pose(4.65, Y.deckMTop, -4.6) }];
  add('led', P.led(), { stage: 6, phase: 5, movePhase: 0, poses: ledPoses, kit: pose(-22.5, 0.1, 14.5), layer: 2 });
  const resPoses = [{ from: 6, pose: pose(-4.4, benchY + 0.5, -13, 0, 0, 0) }, { from: 7, pose: pose(4.8, Y.deckMTop + 0.5, -3.0, 0, Math.PI / 2, 0) }];
  add('resistor', P.resistor(), { stage: 6, phase: 5, movePhase: 0, poses: resPoses, kit: pose(-17.5, 0.25, 14.5), layer: 2 });
  const buzPoses = [{ from: 6, pose: pose(-6, benchY, -9) }, { from: 7, pose: pose(-1.9, Y.deckTTop, 3.6) }];
  add('buzzer', P.buzzer(), { stage: 6, phase: 6, movePhase: 4, poses: buzPoses, kit: pose(-12, 0.1, 14.5), layer: 7 });
  const npnPoses = [{ from: 6, pose: pose(-4.2, benchY, -9) }, { from: 7, pose: pose(-1.9, Y.deckTTop, 2.4) }];
  add('npn', P.transistor(), { stage: 6, phase: 6, movePhase: 4, board: 'esp32', poses: npnPoses, kit: pose(-7.8, 0.1, 14.5), layer: 7 });
  const divPoses = [{ from: 7, pose: pose(8.5, 10.6, 1.4, 0, 0.3, 0.9) }];
  const divItem = add('divider', P.resistor(['brown', 'black', 'red', 'gold']), { stage: 7, phase: 5, board: 'esp32', poses: divPoses, kit: pose(-17.5, 0.25, 9.0), layer: 9 });

  // power wiring, per board
  for (const board of ['uno', 'esp32']) {
    const plug = board === 'uno' ? V(0.35, 6.24, -5.4) : V(3.9, 6.24, -5.15);
    const plus = plug.clone().add(V(-0.22, 0.83, 0)), minus = plug.clone().add(V(0.22, 0.83, 0));
    const leadEnd = V(holderC.x - 1.0, holderC.y + 1.0, holderC.z - 4.05);
    const sw = V(-2.6, Y.deckTTop + 0.3, -4.75);
    const pw = new WireSet([
      new Wire('red', { p: leadEnd, dir: V(0, 0, -1), kind: 'bare' }, { p: sw.clone().add(V(-0.45, 0, 0)), dir: V(-1, 0, 0), kind: 'solder' }, [V(-4.2, Y.deckTTop + 0.4, -4.6)]),
      new Wire('red', { p: sw.clone().add(V(0, 0, 0.1)), dir: V(1, 0, 0), kind: 'solder' }, { p: plus, dir: UP, kind: 'bare' }, [V(-0.6, Y.deckTTop + 0.4, -5.0), V(plus.x - 0.3, plus.y + 1.0, plus.z - 0.4)]),
      new Wire('black', { p: leadEnd.clone().add(V(0.5, 0, 0)), dir: V(0, 0, -1), kind: 'bare' }, { p: minus, dir: UP, kind: 'bare' }, [V(-7.6, Y.deckTTop - 0.2, -4.4), V(-7.6, Y.deckMTop + 0.3, -4.6), V(-3, Y.deckMTop + 0.25, -4.9), V(minus.x, minus.y + 1.2, minus.z - 0.3)]),
      new Wire('red', { p: driverPinCar('VCC'), dir: V(0, 0, -1), kind: 'socket' }, { p: plus.clone().add(V(0, 0, 0.12)), dir: UP, kind: 'bare' }, [V(6.6, Y.deckMTop + 0.4, -5.2), V(4.2, Y.deckMTop + 0.3, -5.2), V(plus.x + 0.2, plus.y + 1.1, plus.z + 0.4)]),
      new Wire('black', { p: driverPinCar('GND'), dir: V(0, 0, -1), kind: 'socket' }, { p: minus.clone().add(V(0, 0, 0.12)), dir: UP, kind: 'bare' }, [V(6.3, Y.deckMTop + 0.5, -5.35), V(4.0, Y.deckMTop + 0.4, -5.35), V(minus.x + 0.2, minus.y + 1.3, minus.z + 0.45)]),
    ]);
    add('wirePower', pw.group, { stage: 6, phase: 3, board, pose: pose(0, 0, 0), wire: pw, layer: 4 });
  }

  // ---- step 8: wiring ------------------------------------------------------------------------
  for (const board of ['uno', 'esp32']) {
    const pin = (n, r) => boardPin(board, n, r);
    const sock = (n, r) => ({ p: pin(n, r), dir: UP, kind: 'socket' });
    const isUno = board === 'uno';
    // LED: red from the resistor to S, black from the cathode to G
    const ledN = isUno ? 'D13' : '13';
    const led = new WireSet([
      new Wire('red', { p: V(4.8, Y.deckMTop + 0.5, -2.2), dir: V(0, 0, 1), kind: 'solder' }, sock(ledN, 'S'), [V(4.9, Y.deckMTop + 0.9, -1.4)]),
      new Wire('black', { p: V(4.5, Y.deckMTop + 0.5, -3.3), dir: V(0, 0, 1), kind: 'solder' }, sock(ledN, 'G'), [V(4.3, Y.deckMTop + 1.2, -2.1)]),
    ]);
    add('wireLed', led.group, { stage: 7, phase: 0, board, pose: pose(0, 0, 0), wire: led, layer: 5 });
    // driver inputs
    const map = isUno ? { 'A-IA': 'D11', 'A-IB': 'D12', 'B-IA': 'D5', 'B-IB': 'D6' } : { 'A-IA': '26', 'A-IB': '27', 'B-IA': '33', 'B-IB': '25' };
    const colors = { 'A-IA': 'green', 'A-IB': 'blue', 'B-IA': 'purple', 'B-IB': 'grey' };
    for (const side of ['A', 'B']) {
      const ws = [`${side}-IA`, `${side}-IB`].map((n, k) => {
        const dp = driverPinCar(n);
        const bp = pin(map[n], 'S');
        return new Wire(colors[n], { p: dp, dir: V(0, 0, -1), kind: 'socket' }, { p: bp, dir: UP, kind: 'socket' },
          [V(dp.x, dp.y + 1.6, -5.4), V((dp.x + bp.x) / 2 + 0.4, 9.4 + k * 0.25 + (side === 'B' ? 0.5 : 0), (bp.z - 3.2) / 2), V(bp.x + 0.3, bp.y + 2.6, bp.z - 0.4)]);
      });
      const set = new WireSet(ws);
      add(side === 'A' ? 'wireDriverA' : 'wireDriverB', set.group, { stage: 7, phase: side === 'A' ? 1 : 2, board, pose: pose(0, 0, 0), wire: set, layer: 5 });
    }
    // servo cable, now plugged into its header
    const sN = isUno ? 'A5' : '23';
    const servoWires = [['brown', 'G'], ['red', 'V'], ['orange', 'S']].map(([c, row], k) => {
      const dz = (k - 1) * 0.1;
      const end = pin(sN, row);
      return new Wire(c, { p: V(8.35, Y.deckMTop - 1.4, 0.62 + dz), dir: V(0, 0, 1), kind: 'solder' }, { p: end, dir: UP, kind: 'socket' },
        [V(8.0, Y.deckM - 0.5, 1.4 + dz), V(5.5, Y.deckM - 0.4, 3.6 + dz), V(2.0, Y.deckM - 0.3, 4.1 + dz), V(1.4, Y.deckMTop + 1.0, 4.2 + dz), V(end.x - 0.6, end.y + 2.4, end.z + 0.6)]);
    });
    const servoSet = new WireSet(servoWires);
    add('wireServo', servoSet.group, { stage: 7, phase: 3, board, pose: pose(0, 0, 0), wire: servoSet, layer: 5, noGrow: true });
    // buzzer
    const bN = isUno ? 'A0' : '21';
    const bz = V(-1.9, Y.deckTTop + 0.5, 3.6);
    const buzzWires = isUno ? [
      new Wire('red', { p: bz.clone().add(V(0.4, 0, -0.2)), dir: V(1, 0, 0), kind: 'solder' }, sock(bN, 'S'), [V(-0.6, Y.deckTTop + 1.3, 2.6)]),
      new Wire('black', { p: bz.clone().add(V(0.4, 0, 0.2)), dir: V(1, 0, 0), kind: 'solder' }, sock(bN, 'G'), [V(-0.4, Y.deckTTop + 1.6, 2.4)]),
    ] : [
      new Wire('red', { p: bz.clone().add(V(0.4, 0, -0.2)), dir: V(1, 0, 0), kind: 'solder' }, sock(bN, 'V'), [V(-0.9, Y.deckTTop + 1.2, 1.5)]),
      new Wire('orange', { p: V(-1.9, Y.deckTTop + 0.4, 2.2), dir: V(1, 0, 0), kind: 'solder' }, sock(bN, 'S'), [V(-0.9, Y.deckTTop + 1.5, 1.2)]),
      new Wire('black', { p: V(-1.75, Y.deckTTop + 0.4, 2.2), dir: V(1, 0, 0), kind: 'solder' }, sock(bN, 'G'), [V(-0.7, Y.deckTTop + 1.8, 1.0)]),
    ];
    const bset = new WireSet(buzzWires);
    add('wireBuzzer', bset.group, { stage: 7, phase: 4, board, pose: pose(0, 0, 0), wire: bset, layer: 7 });
    // sensor: rebuilt whenever the head turns
    const sonarSpec = isUno
      ? [['VCC', 'red', 'D4', 'V'], ['Trig', 'yellow', 'D4', 'S'], ['Echo', 'white', 'D3', 'S'], ['GND', 'black', 'D2', 'G']]
      : [['VCC', 'red', '32', 'V'], ['Trig', 'yellow', '32', 'S'], ['Echo', 'white', '35', 'S'], ['GND', 'black', '34', 'G']];
    const sonarWires = sonarSpec.map(([sp, c, bn, row]) => new Wire(c, { p: V(0, 0, 0), dir: UP, kind: 'socket' }, { p: V(3, 0, 1), dir: UP, kind: 'socket' }));
    const sonarSet = new WireSet(sonarWires);
    sonarSet.update = angle => {
      sonarSpec.forEach(([sp, c, bn, row], k) => {
        const a = sonarPinCar(sp, angle);
        const b = pin(bn, row);
        const mid = V((a.x + b.x) / 2 + 1.2, Math.max(a.y, b.y) + 3.2 + k * 0.12, (a.z + b.z) / 2);
        sonarWires[k].set({ p: a, dir: UP, kind: 'socket' }, { p: b, dir: UP, kind: 'socket' }, [mid]);
      });
      if (!isUno) {
        // the divider rides in the Echo jumper, under heat-shrink
        const c = sonarWires[2].curve;
        const at = c.getPointAt(0.32), tan = c.getTangentAt(0.32);
        const q = new THREE.Quaternion().setFromUnitVectors(V(1, 0, 0), tan);
        divPoses[0].pose.p.copy(at);
        divPoses[0].pose.r.setFromQuaternion(q);
        if (divItem.cur && divItem.visible) { divItem.cur.p.copy(at); divItem.cur.q.copy(q); }
      }
    };
    sonarSet.update(90);
    add('wireSonar', sonarSet.group, { stage: 7, phase: 5, board, pose: pose(0, 0, 0), wire: sonarSet, layer: 9, sonar: true });
  }

  // ---- loose items that only lie on the mat --------------------------------------------------
  add('jumpers', P.jumperBundle(20), { kitOnly: true, stage: 0, kit: pose(21.5, 0.1, 15) });
  add('hookup', P.hookupCoil(), { kitOnly: true, stage: 0, kit: pose(12, 0.1, 12.5) });
  add('screws', P.screwPile(), { kitOnly: true, stage: 0, kit: pose(-26.5, 0.1, 8.6) });
  add('standoff', P.standoffRow([2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 2.5, 1.5, 1.5, 1.5, 1.5, 1.0, 1.0, 1.0, 1.0]), { kitOnly: true, stage: 0, kit: pose(4, 0.1, 14, 0, Math.PI / 2, 0) });

  const kitLabels = [
    { text: 'bottom deck', parts: ['deckBottom'], at: [-17, -13.5] },
    { text: 'middle deck', parts: ['deckMiddle'], at: [5, -13.5] },
    { text: 'top deck', parts: ['deckTop'], at: [23.5, -13.5] },
    { text: '4× TT motor', parts: ['motor'], at: [-27.3, 3.9] },
    { text: '8× motor bracket', parts: ['bracket'], at: [-15.9, 3.4] },
    { text: '4× wheel, 65 mm', parts: ['wheel'], at: [-6.9, 8.4] },
    { text: 'L9110S driver', parts: ['driver'], at: [9.5, -0.1] },
    { text: 'foam pad', parts: ['foam'], at: [9.5, 4.4] },
    { text: 'Arduino UNO R3', parts: ['uno'], at: [15.2, -6.9], board: 'uno' },
    { text: 'Sensor Shield V5', parts: ['shield'], at: [15.2, 8.0], board: 'uno' },
    { text: 'ESP32 + expansion board', parts: ['esp32'], at: [15.2, 3.9], board: 'esp32' },
    { text: 'HC-SR04', parts: ['sonar'], at: [21.5, -1.9] },
    { text: 'sensor bracket', parts: ['sonarBracket'], at: [21.5, 3.6] },
    { text: 'SG90 servo', parts: ['servo'], at: [25.6, -8.0] },
    { text: '2× 18650 holder', parts: ['battery'], at: [29.3, 1.4] },
    { text: '2× 18650 cell', parts: ['cells'], at: [27.6, 11.6] },
    { text: 'power switch', parts: ['switch'], at: [-29, 17.4] },
    { text: '10 mm LED', parts: ['led'], at: [-22.5, 17.4] },
    { text: '220 Ω', parts: ['resistor'], at: [-17.5, 17.4] },
    { text: '1 kΩ + 2 kΩ', parts: ['divider'], at: [-17.5, 11.0], board: 'esp32' },
    { text: 'active buzzer', parts: ['buzzer'], at: [-12, 17.4] },
    { text: 'NPN', parts: ['npn'], at: [-7.8, 17.4], board: 'esp32' },
    { text: 'DC plug', parts: ['dcPlug'], at: [-3.6, 17.4] },
    { text: 'M3 bolts, nuts, screws', parts: ['screws', 'bolts'], at: [-26.5, 12.0] },
    { text: '16× M3 standoff', parts: ['standoff'], at: [4, 18.6] },
    { text: 'hook-up wire', parts: ['hookup'], at: [12, 15.6] },
    { text: '20× jumper wires (F–F, 15 cm)', parts: ['jumpers'], at: [21.5, 19.8] },
  ];

  return { root, head, items, kitLabels };
}

/** The pose an item takes at a given step, or null if it is not on the car then. */
export function poseAt(it, step) {
  if (it.kitOnly) return null;
  if (step < it.stage || step >= it.until) return null;
  let pz = null;
  for (const p of it.poses) if (p.from <= step) pz = p.pose;
  return pz;
}

/** Did the item arrive, or move, at this step? */
export function changesAt(it, step) {
  if (it.stage === step) return 'enter';
  if (it.poses.some(p => p.from === step && p.from !== it.stage)) return 'move';
  return null;
}
