// Arduino UNO sketches for the Rover Lab car. Plain strings so the page can show, copy and download them.

export const UNO_TEST = `// Twin Labs rover - wiring test (Arduino UNO + Sensor Shield V5)
//
// Lift the car so the wheels turn freely, switch the battery on
// and open the Serial Monitor at 115200 baud. Opening the monitor
// resets the UNO, so the test starts again from line 1.
#include <Servo.h>

// L9110S inputs: IA = speed (PWM), IB = direction.
const uint8_t LEFT_IA  = 11, LEFT_IB  = 12;   // MOTOR-A, left side
const uint8_t RIGHT_IA = 5,  RIGHT_IB = 6;    // MOTOR-B, right side
const uint8_t TRIG_PIN = 4,  ECHO_PIN = 3;    // HC-SR04
const uint8_t SERVO_PIN = A5;                 // SG90 signal
const uint8_t LED_PIN = 13, BUZZER_PIN = A0;

Servo head;

// Run one side at -255..255. Forward: IB low, PWM on IA.
// Reverse: IB high, so the motor runs while IA is LOW - the
// PWM value is inverted to keep the same speed.
void side(uint8_t ia, uint8_t ib, int speed) {
  speed = constrain(speed, -255, 255);
  if (speed >= 0) {
    digitalWrite(ib, LOW);
    analogWrite(ia, speed);
  } else {
    digitalWrite(ib, HIGH);
    analogWrite(ia, 255 + speed);
  }
}

// Print a numbered line, run one side for a second, then rest.
void testSide(const char *label, uint8_t ia, uint8_t ib, int speed) {
  Serial.println(label);
  side(ia, ib, speed);      // 150 of 255 is roughly 5 V average
  delay(1000);
  side(ia, ib, 0);
  delay(700);
}

// One HC-SR04 reading in cm; 0 if no echo came back in 30 ms.
float readCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);   // 10 us start pulse
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long echoUs = pulseIn(ECHO_PIN, HIGH, 30000UL);
  return echoUs / 58.0;           // round trip at 343 m/s
}

void setup() {
  const uint8_t outputs[] = {LEFT_IA, LEFT_IB, RIGHT_IA, RIGHT_IB,
                             TRIG_PIN, LED_PIN, BUZZER_PIN};
  for (uint8_t pin : outputs) pinMode(pin, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  Serial.begin(115200);
  Serial.println(F("Twin Labs rover - wiring test"));

  Serial.println(F("1  LED on and one beep"));
  digitalWrite(LED_PIN, HIGH);
  digitalWrite(BUZZER_PIN, HIGH);
  delay(150);
  digitalWrite(BUZZER_PIN, LOW);
  delay(850);
  digitalWrite(LED_PIN, LOW);

  Serial.println(F("2  Head looks right, left, then ahead"));
  head.attach(SERVO_PIN);
  head.write(30);                 // 0 = right, 90 = ahead, 180 = left
  delay(700);
  head.write(150);
  delay(900);
  head.write(90);
  delay(700);

  testSide("3  Left wheels forwards",   LEFT_IA,  LEFT_IB,   150);
  testSide("4  Left wheels backwards",  LEFT_IA,  LEFT_IB,  -150);
  testSide("5  Right wheels forwards",  RIGHT_IA, RIGHT_IB,  150);
  testSide("6  Right wheels backwards", RIGHT_IA, RIGHT_IB, -150);
  Serial.println(F("7  Distance, twice a second - wave a hand in front"));
}

void loop() {
  Serial.print(readCm(), 1);
  Serial.println(F(" cm"));
  delay(500);
}
`;

export const UNO_AVOIDER = `// Twin Labs rover - obstacle avoider (Arduino UNO + Sensor Shield V5)
//
// Drives forwards. When something is near it stops, beeps, looks
// right and left with the sensor head and turns towards the side
// with more room. If it is boxed in or stuck it backs up first,
// and right after a turn it keeps turning the same way so it
// cannot rock back and forth in a corner.
#include <Servo.h>

// ---- pins --------------------------------------------------------
const uint8_t LEFT_IA  = 11, LEFT_IB  = 12;   // MOTOR-A, left side
const uint8_t RIGHT_IA = 5,  RIGHT_IB = 6;    // MOTOR-B, right side
const uint8_t TRIG_PIN = 4,  ECHO_PIN = 3;    // HC-SR04
const uint8_t SERVO_PIN = A5;                 // SG90 signal
const uint8_t LED_PIN = 13, BUZZER_PIN = A0;

// ---- tuning ------------------------------------------------------
// TT motors are 3-6 V parts: 180/255 of a full 8.4 V pack is ~6 V.
const int MAX_PWM    = 180;
const int CRUISE     = 130;   // straight-line speed (of 255)
const int SPIN       = 160;   // turning on the spot needs more push
const int TURN_MS    = 400;   // about a quarter turn - tune this
const int CLEAR_CM   = 25;    // closer than this: stop and look
const int BOXED_CM   = 18;    // both sides closer: back up
const int LOOK_RIGHT = 30;    // servo angles (0 = right, 180 = left)
const int LOOK_LEFT  = 150;
const unsigned long STUCK_MS  = 1500;  // reading frozen this long = stuck
const unsigned long REPEAT_MS = 2500;  // "just turned" window

Servo head;
float lastCm = 0;                 // stuck check: last reading ...
unsigned long lastMoved = 0;      // ... and when it last changed
bool lastWasLeft = true;          // direction of the previous turn
unsigned long lastTurnEnd = 0;    // when that turn finished (0 = never)

// ---- motors ------------------------------------------------------
// One side at -255..255. Forward: IB low, PWM on IA.
// Reverse: IB high, PWM inverted so the speed stays the same.
void side(uint8_t ia, uint8_t ib, int speed) {
  if (speed >= 0) {
    digitalWrite(ib, LOW);
    analogWrite(ia, speed);
  } else {
    digitalWrite(ib, HIGH);
    analogWrite(ia, 255 + speed);
  }
}

void drive(int left, int right) {
  side(LEFT_IA,  LEFT_IB,  constrain(left,  -MAX_PWM, MAX_PWM));
  side(RIGHT_IA, RIGHT_IB, constrain(right, -MAX_PWM, MAX_PWM));
}

void halt() { drive(0, 0); }

void backUp(unsigned long ms) {
  drive(-CRUISE, -CRUISE);
  delay(ms);
  halt();
}

// ---- sensing -----------------------------------------------------
// Distance in cm. No echo within 30 ms means open space: 400 cm.
float readCm() {
  digitalWrite(TRIG_PIN, LOW);
  delayMicroseconds(2);
  digitalWrite(TRIG_PIN, HIGH);   // 10 us start pulse
  delayMicroseconds(10);
  digitalWrite(TRIG_PIN, LOW);
  unsigned long echoUs = pulseIn(ECHO_PIN, HIGH, 30000UL);
  if (echoUs == 0) return 400;
  return echoUs / 58.0;           // round trip at 343 m/s
}

// Point the head, wait for the servo, then measure.
float lookAt(int angle) {
  head.write(angle);
  delay(500);
  return readCm();
}

void beep(int ms) {
  digitalWrite(BUZZER_PIN, HIGH);
  delay(ms);
  digitalWrite(BUZZER_PIN, LOW);
}

// ---- program -----------------------------------------------------
void setup() {
  const uint8_t outputs[] = {LEFT_IA, LEFT_IB, RIGHT_IA, RIGHT_IB,
                             TRIG_PIN, LED_PIN, BUZZER_PIN};
  for (uint8_t pin : outputs) pinMode(pin, OUTPUT);
  pinMode(ECHO_PIN, INPUT);
  head.attach(SERVO_PIN);
  head.write(90);                 // look straight ahead
  Serial.begin(115200);
  Serial.println(F("Twin Labs rover - obstacle avoider"));
  delay(2000);                    // time to set the car down
  lastMoved = millis();
}

void loop() {
  // 1. Measure, and note when the reading last really changed.
  float cm = readCm();
  if (fabs(cm - lastCm) > 2 || cm >= 400) {
    lastCm = cm;
    lastMoved = millis();
  }
  // Wheels pushing but the distance frozen: caught on something
  // the narrow beam cannot see.
  bool stuck = millis() - lastMoved > STUCK_MS;

  // 2. Way clear? Keep driving.
  if (cm >= CLEAR_CM && !stuck) {
    digitalWrite(LED_PIN, LOW);
    drive(CRUISE, CRUISE);
    delay(60);                    // HC-SR04 wants >= 60 ms between pings
    return;
  }

  // 3. Blocked (or stuck): stop, LED on, short beep.
  halt();
  digitalWrite(LED_PIN, HIGH);
  beep(80);
  if (stuck) {
    Serial.println(F("Stuck - backing off"));
    backUp(600);
  } else {
    Serial.print(F("Obstacle at "));
    Serial.print(cm, 1);
    Serial.println(F(" cm"));
  }

  // 4. Look right, then left. No room either side: back up, look again.
  float right, left;
  for (;;) {
    right = lookAt(LOOK_RIGHT);
    left  = lookAt(LOOK_LEFT);
    Serial.print(F("Left "));
    Serial.print(left, 0);
    Serial.print(F(" cm, right "));
    Serial.print(right, 0);
    Serial.println(F(" cm"));
    if (max(left, right) >= BOXED_CM) break;
    Serial.println(F("Boxed in - backing up"));
    backUp(600);
  }
  head.write(90);
  delay(350);

  // 5. Pick a side. Blocked again just after a turn? Turning back
  //    would lead straight back here, so keep the same direction.
  bool goLeft = left >= right;
  if (lastTurnEnd != 0 && millis() - lastTurnEnd < REPEAT_MS) {
    goLeft = lastWasLeft;
  }

  // 6. Turn on the spot for about a quarter turn.
  Serial.println(goLeft ? F("Turning left") : F("Turning right"));
  if (goLeft) drive(-SPIN, SPIN);
  else        drive(SPIN, -SPIN);
  delay(TURN_MS);
  halt();
  digitalWrite(LED_PIN, LOW);
  lastWasLeft = goLeft;
  lastTurnEnd = millis();
  lastMoved = lastTurnEnd;
}
`;
