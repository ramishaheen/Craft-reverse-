// The sketches, a small C++ highlighter, and the program-flow chart's link to the code.

import { UNO_TEST, UNO_AVOIDER } from './uno.ino.js';
import { ESP32_TEST, ESP32_WIFI } from './esp32.ino.js';

export const SKETCHES = { unoTest: UNO_TEST, uno: UNO_AVOIDER, esp32Test: ESP32_TEST, esp32: ESP32_WIFI };

/** Read a tuning constant out of a sketch so the simulator always matches the code it shows. */
export function constant(src, name, fallback) {
  const m = new RegExp(`const\\s+(?:unsigned\\s+long|int|float)\\s+${name}\\s*=\\s*([\\d.]+)`).exec(src);
  return m ? Number(m[1]) : fallback;
}

const KEYWORDS = new Set(('if else for while do switch case break continue return default const static void bool int long unsigned ' +
  'float double char byte uint8_t uint16_t uint32_t size_t String true false enum class struct auto new delete sizeof').split(' '));
const BUILTINS = new Set(('pinMode digitalWrite digitalRead analogWrite analogRead delay delayMicroseconds millis micros pulseIn ' +
  'constrain map min max abs fabs round Serial print println begin attach write ledcAttach ledcWrite WiFi softAP softAPIP ' +
  'deserializeJson serializeJson strcmp loop onEvent broadcastTXT sendTXT F').split(' '));
const CONSTS = new Set('HIGH LOW INPUT OUTPUT A0 A5 WStype_TEXT'.split(' '));

const escHtml = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));

/** Highlight one line of Arduino C++ into HTML spans. */
export function highlightLine(line) {
  let out = '';
  let i = 0;
  const n = line.length;
  while (i < n) {
    const c = line[i];
    if (c === '/' && line[i + 1] === '/') { out += `<span class="tk-c">${escHtml(line.slice(i))}</span>`; break; }
    if (c === '#') { out += `<span class="tk-p">${escHtml(line.slice(i))}</span>`; break; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < n && line[j] !== c) j += line[j] === '\\' ? 2 : 1;
      out += `<span class="tk-s">${escHtml(line.slice(i, j + 1))}</span>`;
      i = j + 1;
      continue;
    }
    if (/[0-9]/.test(c) && !/[\w]/.test(line[i - 1] || '')) {
      const m = /^(0x[0-9a-f]+|\d+(\.\d+)?)(UL|L|U)?/i.exec(line.slice(i));
      out += `<span class="tk-n">${m[0]}</span>`;
      i += m[0].length;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_]\w*/.exec(line.slice(i));
      const w = m[0];
      const cls = KEYWORDS.has(w) ? 'tk-k' : BUILTINS.has(w) ? 'tk-f' : CONSTS.has(w) || /^[A-Z][A-Z0-9_]+$/.test(w) ? 'tk-m' : '';
      out += cls ? `<span class="${cls}">${w}</span>` : w;
      i += w.length;
      continue;
    }
    out += escHtml(c);
    i++;
  }
  return out;
}

/** Find the 1-based line range [from, to] between two snippets (to is inclusive of its line). */
export function lineRange(src, fromSnip, toSnip) {
  const lines = src.split('\n');
  const a = lines.findIndex(l => l.includes(fromSnip));
  if (a < 0) return null;
  let b = a;
  if (toSnip) {
    const k = lines.findIndex((l, idx) => idx >= a && l.includes(toSnip));
    if (k >= 0) b = k;
  }
  return [a + 1, b + 1];
}

// ---- program flow -------------------------------------------------------------------------------
// The avoiding routine as a flow chart. Each box names the code that does it, per board.
// Columns and rows are grid cells; the chart is drawn as SVG in ui/flow.js.

export const FLOW_NODES = [
  { id: 'measure', kind: 'start', col: 0, row: 1, label: 'Measure distance' },
  { id: 'clear', kind: 'ask', col: 1, row: 1, label: 'Way clear?' },
  { id: 'driveOn', kind: 'do', col: 1, row: 0, label: 'Drive on' },
  { id: 'halt', kind: 'do', col: 2, row: 1, label: 'Stop · LED · beep' },
  { id: 'stuck', kind: 'ask', col: 3, row: 1, label: 'Stuck?' },
  { id: 'backOff', kind: 'do', col: 3, row: 2, label: 'Back off' },
  { id: 'look', kind: 'do', col: 4, row: 1, label: 'Look right, left' },
  { id: 'room', kind: 'ask', col: 5, row: 1, label: 'Room to turn?' },
  { id: 'backUp', kind: 'do', col: 5, row: 2, label: 'Back up, look again' },
  { id: 'again', kind: 'ask', col: 6, row: 1, label: 'Just turned?' },
  { id: 'same', kind: 'do', col: 7, row: 0, label: 'Same way again' },
  { id: 'side', kind: 'do', col: 7, row: 1, label: 'Side with more room' },
  { id: 'turn', kind: 'do', col: 8, row: 1, label: 'Turn' },
];

export const FLOW_EDGES = [
  ['measure', 'clear'], ['clear', 'driveOn', 'yes'], ['driveOn', 'measure'], ['clear', 'halt', 'no'],
  ['halt', 'stuck'], ['stuck', 'backOff', 'yes'], ['stuck', 'look', 'no'], ['backOff', 'look'],
  ['look', 'room'], ['room', 'backUp', 'no'], ['backUp', 'look'], ['room', 'again', 'yes'],
  ['again', 'same', 'yes'], ['again', 'side', 'no'], ['same', 'turn'], ['side', 'turn'], ['turn', 'measure'],
];

// What each box does, and which lines of each board's sketch do it.
export const FLOW_INFO = {
  measure: {
    text: 'The sensor is pinged on every pass. The program also remembers when the reading last moved by more than 2 cm — a reading that stays frozen while the wheels push is how it notices the car is stuck.',
    code: { uno: ['float cm = readCm();', 'bool stuck = millis()'], esp32: ['case CRUISE: {', 'bool stuck = now - lastMoved'] },
  },
  clear: {
    text: 'Nothing nearer than CLEAR_CM (25 cm) and not stuck? Then the way ahead is open.',
    code: { uno: ['if (cm >= CLEAR_CM && !stuck)', 'if (cm >= CLEAR_CM && !stuck)'], esp32: ['bool blocked = distanceCm < CLEAR_CM', 'if (blocked || stuck)'] },
  },
  driveOn: {
    text: 'Both sides forward at cruising speed, LED off. The HC-SR04 needs about 60 ms between pings, so the loop pauses briefly before measuring again.',
    code: { uno: ['digitalWrite(LED_PIN, LOW);', 'return;'], esp32: ['return "forward";', 'return "forward";'] },
  },
  halt: {
    text: 'Something is close (or the car is stuck): motors off, LED on and a short 80 ms beep so you can hear it decide.',
    code: { uno: ['halt();', 'beep(80);'], esp32: ['setLed(true);', 'enter(blocked ? HALT : BACK);'] },
  },
  stuck: {
    text: 'Was it the frozen reading rather than an obstacle in view? Then something the beam missed is holding the car.',
    code: { uno: ['if (stuck) {', 'if (stuck) {'], esp32: ['enter(blocked ? HALT : BACK);', 'enter(blocked ? HALT : BACK);'] },
  },
  backOff: {
    text: 'Reverse for 0.6 s to get free of whatever holds it, then look around as usual.',
    code: { uno: ['Serial.println(F("Stuck - backing off"));', 'backUp(600);'], esp32: ['case BACK:', 'return "backward";'] },
  },
  look: {
    text: 'The head turns right (30°), waits for the servo, measures; then left (150°) and measures again; then back to straight ahead.',
    code: { uno: ['right = lookAt(LOOK_RIGHT);', 'left  = lookAt(LOOK_LEFT);'], esp32: ['case HALT:', 'servoWrite(90); enter(DECIDE);'] },
  },
  room: {
    text: 'Is at least one side farther than BOXED_CM (18 cm)? If both are tighter, there is no room to turn.',
    code: { uno: ['if (max(left, right) >= BOXED_CM) break;', 'if (max(left, right) >= BOXED_CM) break;'], esp32: ['if (leftCm < BOXED_CM && rightCm < BOXED_CM)', 'if (leftCm < BOXED_CM && rightCm < BOXED_CM)'] },
  },
  backUp: {
    text: 'Boxed in: reverse for 0.6 s and scan again until one side opens up.',
    code: { uno: ['Serial.println(F("Boxed in - backing up"));', 'backUp(600);'], esp32: ['if (leftCm < BOXED_CM && rightCm < BOXED_CM)', 'if (leftCm < BOXED_CM && rightCm < BOXED_CM)'] },
  },
  again: {
    text: 'Did the last turn end less than 2.5 s ago? Being blocked again so soon means it is probably in a corner.',
    code: { uno: ['if (lastTurnEnd != 0 && millis() - lastTurnEnd < REPEAT_MS)', 'goLeft = lastWasLeft;'], esp32: ['bool again = lastTurnEnd != 0', 'if (again) turnLeft = lastTurnLeft;'] },
  },
  same: {
    text: 'Keep turning the same way as last time. Turning back would lead straight back to the obstacle it just left.',
    code: { uno: ['goLeft = lastWasLeft;', 'goLeft = lastWasLeft;'], esp32: ['if (again) turnLeft = lastTurnLeft;', 'if (again) turnLeft = lastTurnLeft;'] },
  },
  side: {
    text: 'Pick whichever side measured farther; a tie goes left.',
    code: { uno: ['bool goLeft = left >= right;', 'bool goLeft = left >= right;'], esp32: ['turnLeft = leftCm >= rightCm;', 'turnLeft = leftCm >= rightCm;'] },
  },
  turn: {
    text: 'Spin on the spot — one side forwards, the other backwards — for TURN_MS, about a quarter turn. Then LED off and back to cruising.',
    code: { uno: ['if (goLeft) drive(-SPIN, SPIN);', 'lastMoved = lastTurnEnd;'], esp32: ['case TURN:', 'enter(CRUISE);'] },
  },
};
