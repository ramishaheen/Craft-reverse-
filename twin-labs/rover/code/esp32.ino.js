// ESP32 sketches for the Rover Lab car (arduino-esp32 core 3.x).

export const ESP32_TEST = `// RamiLabs rover - wiring test (ESP32 DevKit V1 + expansion board)
// Board package: "esp32" by Espressif Systems, version 3.x
//
// Lift the car so the wheels turn freely, switch the battery on
// and open the Serial Monitor at 115200 baud. Press EN on the
// DevKit to run the test again.

const int LEFT_IA  = 26, LEFT_IB  = 27;   // MOTOR-A, left side
const int RIGHT_IA = 33, RIGHT_IB = 25;   // MOTOR-B, right side
const int TRIG_PIN = 32, ECHO_PIN = 35;   // Echo arrives via the divider
const int SERVO_PIN = 23, LED_PIN = 13, BUZZER_PIN = 21;

// Motor PWM: 1 kHz, 8 bits. Servo: 50 Hz, 14 bits.
const int MOTOR_HZ = 1000, MOTOR_BITS = 8;
const int SERVO_HZ = 50,   SERVO_BITS = 14;

// One side at -255..255: PWM on one input, the other held at 0.
void side(int ia, int ib, int speed) {
  speed = constrain(speed, -255, 255);
  ledcWrite(ia, speed > 0 ? speed : 0);
  ledcWrite(ib, speed < 0 ? -speed : 0);
}

// 0..180 degrees -> 0.5..2.4 ms pulse in a 20 ms frame.
void servoWrite(int deg) {
  long us = map(constrain(deg, 0, 180), 0, 180, 500, 2400);
  ledcWrite(SERVO_PIN, us * ((1 << SERVO_BITS) - 1) / 20000);
}

void testSide(const char *label, int ia, int ib, int speed) {
  Serial.println(label);
  side(ia, ib, speed);
  delay(1000);
  side(ia, ib, 0);
  delay(700);
}

float readCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long echoUs = pulseIn(ECHO_PIN, HIGH, 30000UL);
  return echoUs / 58.0;           // 0 = no echo
}

void setup() {
  Serial.begin(115200);
  delay(300);
  const int motorPins[] = {LEFT_IA, LEFT_IB, RIGHT_IA, RIGHT_IB};
  for (int pin : motorPins) ledcAttach(pin, MOTOR_HZ, MOTOR_BITS);
  ledcAttach(SERVO_PIN, SERVO_HZ, SERVO_BITS);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);
  Serial.println("RamiLabs rover - wiring test");

  Serial.println("1  LED on and one beep");
  digitalWrite(LED_PIN, HIGH);
  digitalWrite(BUZZER_PIN, HIGH);
  delay(150);
  digitalWrite(BUZZER_PIN, LOW);
  delay(850);
  digitalWrite(LED_PIN, LOW);

  Serial.println("2  Head looks right, left, then ahead");
  servoWrite(30);                 // 0 = right, 90 = ahead, 180 = left
  delay(700);
  servoWrite(150);
  delay(900);
  servoWrite(90);
  delay(700);

  testSide("3  Left wheels forwards",   LEFT_IA,  LEFT_IB,   150);
  testSide("4  Left wheels backwards",  LEFT_IA,  LEFT_IB,  -150);
  testSide("5  Right wheels forwards",  RIGHT_IA, RIGHT_IB,  150);
  testSide("6  Right wheels backwards", RIGHT_IA, RIGHT_IB, -150);
  Serial.println("7  Distance, twice a second - wave a hand in front");
}

void loop() {
  Serial.print(readCm(), 1);
  Serial.println(" cm");
  delay(500);
}
`;

export const ESP32_WIFI = `// RamiLabs rover - Wi-Fi firmware (ESP32 DevKit V1 + expansion board)
//
// The ESP32 opens its own Wi-Fi network. The Rover Lab connects to
// ws://192.168.4.1:81/ and sends small JSON commands; the car sends
// its readings back ten times a second. In Auto mode it avoids
// obstacles by itself with the same routine as the simulator.
//
// Board package: "esp32" by Espressif Systems, version 3.x
// Libraries:     "WebSockets" by Markus Sattler, "ArduinoJson" 7
#include <WiFi.h>
#include <WebSocketsServer.h>
#include <ArduinoJson.h>

// ---- pins --------------------------------------------------------
const int LEFT_IA  = 26, LEFT_IB  = 27;   // MOTOR-A, left side
const int RIGHT_IA = 33, RIGHT_IB = 25;   // MOTOR-B, right side
const int TRIG_PIN = 32, ECHO_PIN = 35;   // Echo arrives via the divider
const int SERVO_PIN = 23, LED_PIN = 13, BUZZER_PIN = 21;

// ---- tuning ------------------------------------------------------
const int MAX_PWM    = 180;   // of 255: about 6 V from a full pack
const int TURN_MS    = 600;   // about a quarter turn - tune this
const int CLEAR_CM   = 25;    // closer than this: stop and look
const int BOXED_CM   = 18;    // both sides closer: back up
const int LOOK_RIGHT = 30;    // servo angles (0 = right, 180 = left)
const int LOOK_LEFT  = 150;
const unsigned long STUCK_MS   = 1500;
const unsigned long REPEAT_MS  = 2500;
const unsigned long LINK_MS    = 700;   // no drive command: stop
const unsigned long REPORT_MS  = 100;   // telemetry period

const char *AP_NAME = "RamiLabs-Rover";
const char *AP_PASS = "rover1234";      // at least 8 characters

WebSocketsServer socket(81);

// ---- state -------------------------------------------------------
String mode = "manual";          // "manual", "auto" or "stop"
String dir  = "stop";            // forward, backward, left, right, stop
int speedPct = 70;               // 0..100 % of MAX_PWM
int servoDeg = 90;
int motorL = 0, motorR = 0;      // last outputs, -MAX_PWM..MAX_PWM
bool ledOn = false, buzzerOn = false;
float distanceCm = 400;
unsigned long lastDriveMsg = 0, lastReport = 0;

// Auto mode: a non-blocking state machine, so Wi-Fi keeps running.
enum AutoState { CRUISE, HALT, LOOK_R, LOOK_L, DECIDE, TURN, BACK };
AutoState state = CRUISE;
unsigned long stateSince = 0;
float rightCm = 0, leftCm = 0;
float lastCm = 0;
unsigned long lastMoved = 0;
bool turnLeft = true;            // the turn being made
bool lastTurnLeft = true;        // the previous turn's direction
unsigned long lastTurnEnd = 0;   // 0 = has not turned yet
unsigned long beepUntil = 0;

// ---- outputs -----------------------------------------------------
void side(int ia, int ib, int v) {
  ledcWrite(ia, v > 0 ? v : 0);
  ledcWrite(ib, v < 0 ? -v : 0);
}

// 50 Hz, 14 bits: 0..180 degrees -> 0.5..2.4 ms pulses.
void servoWrite(int deg) {
  servoDeg = constrain(deg, 0, 180);
  long us = map(servoDeg, 0, 180, 500, 2400);
  ledcWrite(SERVO_PIN, us * 16383 / 20000);
}

void setLed(bool on)    { ledOn = on;    digitalWrite(LED_PIN, on); }
void setBuzzer(bool on) { buzzerOn = on; digitalWrite(BUZZER_PIN, on); }

float readCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long echoUs = pulseIn(ECHO_PIN, HIGH, 30000UL);
  return echoUs ? echoUs / 58.0 : 400;   // no echo = open space
}

// ---- auto mode ---------------------------------------------------
void enter(AutoState next) {
  state = next;
  stateSince = millis();
  lastMoved = stateSince;
}

void startAuto() {
  servoWrite(90);
  setLed(false);
  lastTurnEnd = 0;
  lastCm = distanceCm;
  enter(CRUISE);
}

// Returns the direction the wheels should take right now.
String autoStep() {
  unsigned long now = millis();
  unsigned long t = now - stateSince;
  if (beepUntil && now > beepUntil) { setBuzzer(false); beepUntil = 0; }

  switch (state) {
    case CRUISE: {
      if (fabs(distanceCm - lastCm) > 2 || distanceCm >= 400) {
        lastCm = distanceCm;
        lastMoved = now;
      }
      // Readings are up to 100 ms old: ignore the first one after a turn.
      bool blocked = distanceCm < CLEAR_CM && t > REPORT_MS;
      bool stuck = now - lastMoved > STUCK_MS;
      if (blocked || stuck) {
        setLed(true);
        setBuzzer(true);
        beepUntil = now + 80;           // short beep, no delay()
        enter(blocked ? HALT : BACK);
        return "stop";
      }
      return "forward";
    }
    case HALT:
      if (t > 250) { servoWrite(LOOK_RIGHT); enter(LOOK_R); }
      return "stop";
    case LOOK_R:
      if (t > 600) { rightCm = distanceCm; servoWrite(LOOK_LEFT); enter(LOOK_L); }
      return "stop";
    case LOOK_L:
      if (t > 800) { leftCm = distanceCm; servoWrite(90); enter(DECIDE); }
      return "stop";
    case DECIDE:
      if (t > 350) {
        if (leftCm < BOXED_CM && rightCm < BOXED_CM) { enter(BACK); return "backward"; }
        turnLeft = leftCm >= rightCm;
        bool again = lastTurnEnd != 0 && now - lastTurnEnd < REPEAT_MS;
        if (again) turnLeft = lastTurnLeft;      // keep the last direction
        enter(TURN);
        return turnLeft ? "left" : "right";
      }
      return "stop";
    case BACK:
      if (t > 600) { enter(HALT); return "stop"; }
      return "backward";
    case TURN:
      if (t > (unsigned long)TURN_MS) {
        setLed(false);
        lastTurnLeft = turnLeft;
        lastTurnEnd = now;
        enter(CRUISE);
        return "forward";
      }
      return turnLeft ? "left" : "right";
  }
  return "stop";
}

// ---- commands from the lab ---------------------------------------
void setMode(const char *m) {
  bool wasAuto = (mode == "auto");
  mode = m;
  dir = "stop";
  if (mode == "auto") startAuto();
  else if (wasAuto) { servoWrite(90); setLed(false); setBuzzer(false); }
}

void onSocket(uint8_t client, WStype_t type, uint8_t *data, size_t len) {
  if (type != WStype_TEXT) return;
  JsonDocument msg;
  if (deserializeJson(msg, data, len)) return;   // not JSON: ignore
  const char *cmd = msg["cmd"] | "";

  if (!strcmp(cmd, "drive")) {
    if (mode == "stop") return;
    if (mode == "auto") setMode("manual");      // any key ends Auto
    dir = msg["dir"] | "stop";
    lastDriveMsg = millis();
  } else if (!strcmp(cmd, "mode")) {
    const char *m = msg["value"] | "manual";
    if (!strcmp(m, "manual") || !strcmp(m, "auto") || !strcmp(m, "stop")) setMode(m);
  } else if (!strcmp(cmd, "speed")) {
    speedPct = constrain((int)(msg["value"] | 70), 0, 100);
  } else if (!strcmp(cmd, "servo")) {
    if (mode != "auto") servoWrite(msg["value"] | 90);
  } else if (!strcmp(cmd, "led")) {
    setLed(msg["value"] | false);
  } else if (!strcmp(cmd, "buzzer")) {
    setBuzzer(msg["value"] | false);
  } else if (!strcmp(cmd, "ping")) {
    socket.sendTXT(client, "{\\"type\\":\\"pong\\"}");
  }
}

void report() {
  JsonDocument t;
  t["type"] = "telemetry";
  t["board"] = "esp32";
  t["distance"] = round(distanceCm * 10) / 10.0;
  t["mode"] = mode;
  t["drive"] = dir;
  t["speed"] = speedPct;
  t["motorL"] = motorL * 100 / MAX_PWM;   // percent
  t["motorR"] = motorR * 100 / MAX_PWM;
  t["servo"] = servoDeg;
  t["led"] = ledOn;
  t["buzzer"] = buzzerOn;
  String out;
  serializeJson(t, out);
  socket.broadcastTXT(out);
}

// ---- setup and loop ----------------------------------------------
void setup() {
  Serial.begin(115200);
  const int motorPins[] = {LEFT_IA, LEFT_IB, RIGHT_IA, RIGHT_IB};
  for (int pin : motorPins) ledcAttach(pin, 1000, 8);   // 1 kHz, 8 bits
  ledcAttach(SERVO_PIN, 50, 14);                        // 50 Hz, 14 bits
  servoWrite(90);
  pinMode(TRIG_PIN, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  pinMode(LED_PIN, OUTPUT);
  pinMode(BUZZER_PIN, OUTPUT);

  WiFi.softAP(AP_NAME, AP_PASS);
  Serial.print("Join ");
  Serial.print(AP_NAME);
  Serial.print(", then connect to ws://");
  Serial.print(WiFi.softAPIP());
  Serial.println(":81/");
  socket.begin();
  socket.onEvent(onSocket);
}

void loop() {
  socket.loop();
  unsigned long now = millis();
  if (now - lastReport >= REPORT_MS) {
    lastReport = now;
    distanceCm = readCm();
    report();
  }

  if (mode == "auto") dir = autoStep();
  else if (mode == "stop") dir = "stop";
  else if (now - lastDriveMsg > LINK_MS) dir = "stop";   // dead-man stop

  int v = speedPct * MAX_PWM / 100;
  int spin = v * 4 / 5;           // turn on the spot at 80 %
  if (dir == "forward")       { motorL = v;     motorR = v; }
  else if (dir == "backward") { motorL = -v;    motorR = -v; }
  else if (dir == "left")     { motorL = -spin; motorR = spin; }
  else if (dir == "right")    { motorL = spin;  motorR = -spin; }
  else                        { motorL = 0;     motorR = 0; }
  side(LEFT_IA, LEFT_IB, motorL);
  side(RIGHT_IA, RIGHT_IB, motorR);
}
`;
