// The ten steps of the Rover Lab build guide.
// A value may be a plain string or { uno, esp32 } when it depends on the chosen board; use pick().
// Part ids name groups of 3D objects (see scene/car.js); a row's ids are what hovering it highlights.

import { SKETCHES } from '../code/index.js';

export const pick = (v, board) =>
  v && typeof v === 'object' && !Array.isArray(v) && ('uno' in v || 'esp32' in v) ? v[board] : v;

export const BOARDS = {
  uno: { id: 'uno', name: 'Arduino UNO', short: 'UNO', mcu: 'ATmega328P · 16 MHz · 5 V logic' },
  esp32: { id: 'esp32', name: 'ESP32', short: 'ESP32', mcu: 'ESP32-WROOM-32 · 240 MHz · Wi-Fi' },
};

export const STEPS = [
  {
    id: 'parts', label: 'Parts', kicker: 'Get ready', title: 'Gather the parts', kit: true, checkBom: true,
    intro: 'This rover has four driven wheels and an ultrasonic “head” on a servo, so it can look left and right before it turns. Lay everything out as on the mat and tick off each line as you find it. Point at a line to light its parts up on the mat; click any part to read what it does.',
    bom: [
      [1, 'Acrylic chassis plates: bottom, middle and top deck', ['deckBottom', 'deckMiddle', 'deckTop']],
      [4, 'TT gear motors (1:48, 3–6 V), each with two T-shaped acrylic brackets and two M3 × 30 bolts with nuts', ['motor', 'bracket', 'bolts']],
      [4, 'Wheels, 65 mm diameter', ['wheel']],
      [1, 'L9110S dual H-bridge motor driver board', ['driver']],
      [1, { uno: 'Arduino UNO R3, Sensor Shield V5 and a USB cable', esp32: 'ESP32 DevKit V1 (30 pins), matching expansion board and a USB cable' }, ['uno', 'shield', 'esp32']],
      [1, 'HC-SR04 ultrasonic sensor with a servo-mount bracket and screws', ['sonar', 'sonarBracket']],
      [1, 'SG90 micro servo with its horns and screws', ['servo']],
      [2, '18650 Li-ion cells (protected type) and a 2-cell series holder with leads', ['battery', 'cells']],
      [1, { uno: 'Slide switch, 10 mm red LED, 220 Ω resistor and a 5 V active buzzer', esp32: 'Slide switch, 10 mm red LED, 5 V active buzzer, an NPN transistor (PN2222A or S8050), one 220 Ω, two 1 kΩ and one 2 kΩ resistor' }, ['switch', 'led', 'resistor', 'buzzer', 'npn', 'divider']],
      [1, '5.5 × 2.1 mm DC barrel plug with screw terminals', ['dcPlug']],
      [1, '20 female–female jumpers (15 cm), red and black hook-up wire, 16 M3 brass standoffs (8 × 25 mm, 4 × 15 mm, 4 × 10 mm), 32 M3 × 6 mm screws, foam tape and heat-shrink sleeving', ['jumpers', 'hookup', 'standoff', 'screws', 'foam']],
    ],
    tools: [
      ['Soldering iron and solder', 'for the motor leads, the switch, the LED and the buzzer'],
      ['Small screwdrivers', 'a cross-head for the M3 screws and a flat blade for the screw terminals'],
      ['Wire strippers / side cutters', 'to cut jumpers and strip hook-up wire'],
      ['Multimeter', 'to confirm polarity before the first power-up'],
      ['Li-ion charger', 'made for 18650 cells'],
      ['Computer with the Arduino IDE', 'to flash the program in step 9'],
    ],
    note: 'Fully charge the 18650 cells in a proper Li-ion charger before you begin, and buy protected cells. A bare cell can push tens of amps through an accidental short — enough to melt wires.',
  },
  {
    id: 'motors', label: 'Motors', kicker: 'Build', title: 'Motors and wheels',
    intro: 'A TT motor is a small brushed DC motor with a 1:48 plastic gearbox on the end. Both motors on the left always run together, and so do both on the right — the car steers like a tank, by giving each side a different speed.',
    need: [
      [1, 'Bottom deck', ['deckBottom']],
      [4, 'TT gear motors', ['motor']],
      [8, 'T-shaped acrylic brackets', ['bracket']],
      [8, 'M3 × 30 bolts with nuts', ['bolts']],
      [4, 'Wheels', ['wheel']],
    ],
    do: [
      { text: 'Place the four motors on the bottom deck in their spots: output shafts facing outwards, motor cans facing the centre. Solder a 15 cm lead to each motor tab — red on the tab closer to the middle of the car, black on the tab closer to the wheel — and gather the eight leads upright in the middle of the deck.', parts: ['motor', 'deckBottom', 'motorLeads'] },
      { text: 'Hold the deck up. From below, push one bracket up through the slot on the inner side of each motor and a second one into the notch on the deck edge beside it. Push two M3 × 30 bolts through bracket, gearbox and bracket (heads on the wheel side) and tighten a nut on each.', parts: ['bracket', 'bolts', 'motor'] },
      { text: 'Press a wheel onto every shaft. The shaft has two flats that lock into the hub, so the wheel cannot spin on it.', parts: ['wheel'] },
    ],
    note: 'Putting red on the inner tab of every motor is what makes the next steps simple: the front and rear motor on one side face each other, so their inner tabs are equivalent and you can twist red to red. Motor tabs snap off easily, so tape each lead pair to its motor. The leads stand in the middle so the slot of the middle deck can drop over them in step 3.',
  },
  {
    id: 'decks', label: 'Decks', kicker: 'Build', title: 'Stack the decks',
    intro: 'Brass standoffs hold the middle deck 25 mm above the bottom deck — just clear of the 22 mm-tall gearboxes — and give the electronics a flat floor. Each standoff is threaded inside at both ends: one screw comes up from below, another holds whatever sits on top.',
    need: [
      [1, 'Middle deck', ['deckMiddle']],
      [8, 'M3 × 25 mm brass standoffs', ['standoff']],
      [4, 'M3 × 10 mm brass standoffs (under the controller)', ['standoff']],
      [4, 'M3 × 15 mm brass standoffs (under the top deck)', ['standoff']],
      [24, 'M3 × 6 mm screws', ['screws']],
    ],
    do: [
      { text: 'Fix the eight 25 mm standoffs to the bottom deck, four down each side, each with a screw from underneath.', parts: ['standoff', 'deckBottom'] },
      { text: 'While the underside of the middle deck is still easy to reach, screw on the four 10 mm standoffs where the controller’s mounting holes will be (lay the board on the deck to see which holes line up), and the four 15 mm standoffs at the corners of the rear half.', parts: ['standoff', 'deckMiddle'] },
      { text: 'Lower the middle deck onto the 25 mm standoffs, threading the motor leads up through its long centre slot, and screw it down.', parts: ['deckMiddle', 'standoff', 'motorLeads'] },
    ],
    note: 'Acrylic cracks when over-tightened: stop at snug. Chassis kits vary — if no hole lines up with the controller, two standoffs plus a pad of foam tape under the other end hold the board just as well.',
  },
  {
    id: 'driver', label: 'Driver', kicker: 'Build', title: 'Fit the motor driver',
    intro: 'A microcontroller pin is good for about 20 mA, yet a TT motor needs a few hundred milliamps when it drives and more than an amp when it stalls. The L9110S board contains two H-bridges that switch battery current through the motors — and can reverse it.',
    need: [
      [1, 'L9110S dual motor driver', ['driver']],
      [1, 'Pad of double-sided foam tape', ['foam']],
    ],
    do: [
      { text: 'Stick the driver onto the middle deck with foam tape, ahead of the controller standoffs and a little left of centre, with its 6-pin header towards the left edge of the car and its screw terminals towards the middle.', parts: ['driver', 'foam'] },
      { text: 'Bring the motor leads forward along the deck to the terminals. Twist the two left motors’ red leads together, then their black leads, and clamp the pairs in MOTOR-A — the terminal nearer the controller. Repeat with the right motors in MOTOR-B.', parts: ['motorLeads', 'driver'] },
    ],
    note: 'It does not matter yet which screw gets which pair: the wiring test in step 9 tells you if a side runs backwards or one wheel fights its partner. Leave the 6-pin header (B-IA, B-IB, GND, VCC, A-IA, A-IB) empty for now — power arrives in step 7 and signals in step 8. Each L9110S channel is rated 800 mA and drives two motors here: fine for normal driving, but never hold the wheels stalled. If the chips run hot, a TB6612FNG board (1.2 A per channel) is a sturdier drop-in.',
  },
  {
    id: 'controller', label: 'Controller', kicker: 'Build', title: { uno: 'Mount the Arduino UNO', esp32: 'Mount the ESP32' },
    intro: {
      uno: 'The Arduino UNO (ATmega328P at 16 MHz, 5 V logic) runs the program. A Sensor Shield V5 sits on top and gives every pin its own three-pin G / V / S header — ground, 5 V and signal — because the UNO itself has just one 5 V pin for the servo and sensor to share.',
      esp32: 'The ESP32 (two cores up to 240 MHz, Wi-Fi and Bluetooth, 3.3 V logic) runs the program and lets this lab drive the real car over Wi-Fi. Its expansion board adds a DC jack with voltage regulators and a G / V / S header for each pin.',
    },
    need: {
      uno: [[1, 'Arduino UNO R3', ['uno']], [1, 'Sensor Shield V5', ['shield']], [4, 'M3 × 6 mm screws', ['screws']]],
      esp32: [[1, 'ESP32 DevKit V1 (30 pins)', ['esp32']], [1, 'ESP32 expansion board (30 pins)', ['esp32']], [4, 'M3 × 6 mm screws', ['screws']]],
    },
    do: {
      uno: [
        { text: 'Screw the UNO to the four 10 mm standoffs behind the driver, its USB and DC sockets facing the left side of the car.', parts: ['uno'] },
        { text: 'Press the Sensor Shield V5 straight down onto the UNO so every pin finds its socket. Keep the SEL jumper on, so the shield’s V pins are fed 5 V by the UNO, and leave the shield’s screw terminal unconnected.', parts: ['shield'] },
      ],
      esp32: [
        { text: 'Screw the expansion board to the four 10 mm standoffs behind the driver, its DC jack facing the left side of the car.', parts: ['esp32'] },
        { text: 'Seat the DevKit in the two socket strips so each pin label on the module matches the label printed beside its socket. One pin out of line puts power where it must not go.', parts: ['esp32'] },
        { text: 'Move the V-pin jumper to 5 V: the servo, the HC-SR04 and the buzzer all need 5 V. Boards differ, so read the markings beside the jumper on yours.', parts: ['esp32'] },
      ],
    },
    note: {
      uno: 'UNO pins work at 5 V, so the sensor and the servo plug straight into the shield with nothing in between.',
      esp32: 'ESP32 pins work at 3.3 V and are not 5 V tolerant. That is why the sensor’s Echo signal will pass through a small voltage divider in step 8.',
    },
  },
  {
    id: 'sensor', label: 'Sensor', kicker: 'Build', title: 'Build the sensor head',
    intro: 'The HC-SR04 sends a short 40 kHz chirp and times its echo: distance in cm ≈ echo time in µs ÷ 58. It sees from about 2 cm to 4 m inside a cone roughly 15° wide. Sitting on an SG90 servo, it can glance left and right before the car commits to a turn.',
    need: [
      [1, 'SG90 micro servo with a single-arm horn and screws', ['servo']],
      [1, 'HC-SR04 servo bracket and its screws', ['sonarBracket']],
      [1, 'HC-SR04 ultrasonic sensor', ['sonar']],
    ],
    do: [
      { text: 'Hold the servo above the rectangular cut-out at the front of the middle deck, shaft up and on the car’s centre line. Pass its plug down through the cut-out, back under the deck and up through the small slot behind it, until the plug rests beside the controller. Drop the servo into the cut-out with its cable in the notch, tuck the slack under the deck away from the motor shafts, and screw the two mounting ears down.', parts: ['servo', 'deckMiddle', 'wireServo'] },
      { text: 'Centre the servo, then push a single-arm horn onto the shaft pointing straight ahead and secure it with the small horn screw.', parts: ['servo'] },
      { text: 'Screw the bracket onto the horn so it stands upright at the front.', parts: ['sonarBracket'] },
      { text: 'Fix the HC-SR04 to the bracket with two screws through the corner holes of one long edge, that edge at the bottom and the pin header at the top, so the wires leave upwards and clear the servo.', parts: ['sonar'] },
    ],
    note: {
      uno: 'To centre the servo, plug it into the shield’s A5 header (brown wire on G) and upload either sketch from step 9 — both park the head at 90°. Never twist the output shaft by hand: the plastic gears strip. Mounted pins-up like this, the sensor’s pins read GND, Echo, Trig, VCC from left to right, seen from the front.',
      esp32: 'To centre the servo, plug it into the GPIO 23 header (brown on G, V jumper on 5 V) and upload the step 9 firmware, which parks the head at 90° in setup(). Never twist the output shaft by hand: the plastic gears strip. Mounted pins-up like this, the sensor’s pins read GND, Echo, Trig, VCC from left to right, seen from the front.',
    },
  },
  {
    id: 'power', label: 'Power', kicker: 'Build', title: 'Add the power',
    intro: {
      uno: 'Two 18650 cells in series make 7.4 V nominal — 8.4 V when full, about 6 V when flat. The slide switch interrupts the battery’s + lead. Everything comes together in a DC plug with screw terminals: the battery leads go in, the plug feeds the UNO’s DC jack (its regulator makes the 5 V for the logic), and a second pair of wires from the same screws feeds the motor driver. The driver must not run off the shield’s 5 V pins — they come from the UNO’s small regulator, which four motors would overload. Solder leads onto parts at the bench, before they go on the car: slide heat-shrink onto the wire first and shrink it over the joint afterwards.',
      esp32: 'Two 18650 cells in series make 7.4 V nominal — 8.4 V when full, about 6 V when flat. The slide switch interrupts the battery’s + lead. Everything comes together in a DC plug with screw terminals: the battery leads go in, the plug feeds the expansion board’s DC jack (its regulators make 5 V and 3.3 V), and a second pair of wires from the same screws feeds the motor driver. The driver must not run off the board’s 5 V pins — they come from a small regulator that four motors would overload. Solder leads onto parts at the bench, before they go on the car: slide heat-shrink onto the wire first and shrink it over the joint afterwards.',
    },
    need: [
      [1, 'Top deck and 4 M3 × 6 mm screws', ['deckTop', 'screws']],
      [1, '2 × 18650 holder with leads, plus 2 cells', ['battery', 'cells']],
      [1, 'Slide switch', ['switch']],
      [1, 'DC barrel plug with screw terminals (centre positive)', ['dcPlug']],
      [1, '10 mm red LED and 220 Ω resistor', ['led', 'resistor']],
      [1, { uno: '5 V active buzzer', esp32: '5 V active buzzer, NPN transistor and a 1 kΩ resistor' }, ['buzzer', 'npn']],
      [1, { uno: 'Foam tape, heat-shrink and 4 jumpers to cut (2 red, 2 black)', esp32: 'Foam tape, heat-shrink and 5 jumpers to cut (2 red, 2 black, 1 orange)' }, ['jumpers', 'foam']],
    ],
    do: [
      { text: 'Set the top deck on the four 15 mm standoffs and screw it down.', parts: ['deckTop'] },
      { text: 'At the bench, cut the holder’s red lead about 2 cm from the holder. Solder the holder side to one outer pin of the switch and a 10 cm length of the cut-off piece to the middle pin.', parts: ['battery', 'switch'] },
      { text: 'Hold the holder over the top deck with its leads towards the left. Drop the black lead down through the hole at the left edge and pull it forward along the middle deck as the holder goes down. Fix the holder with two strips of foam tape, and the switch on its side at the left edge with its lever pointing out. Run the red lead forward off the front corner of the deck: both leads should end next to the controller’s DC jack.', parts: ['battery', 'cells', 'switch', 'wirePower'] },
      { text: { uno: 'Cut one red and one black jumper 12.5 cm from an end. Push the long red piece onto the driver’s VCC pin and the long black piece onto GND, and lay both back along the left edge of the middle deck to the jack.', esp32: 'Cut one red and one black jumper 11 cm from an end. Push the long red piece onto the driver’s VCC pin and the long black piece onto GND, and lay both back along the left edge of the middle deck to the jack.' }, parts: ['wirePower', 'driver'] },
      { text: { uno: 'Strip 5 mm off the four free ends. Clamp both reds under the plug’s + screw and both blacks under −, then push the plug into the UNO’s DC jack with + on top.', esp32: 'Strip 5 mm off the four free ends. Clamp both reds under the plug’s + screw and both blacks under −, then push the plug into the expansion board’s DC jack with + on top.' }, parts: ['dcPlug', 'wirePower'] },
      { text: 'At the bench, solder the 220 Ω resistor to the LED’s long (+) leg. Cut a red and a black jumper in half; solder one red half to the free end of the resistor and one black half to the LED’s short leg.', parts: ['led', 'resistor'] },
      { text: { uno: 'Fold the buzzer’s pins flat. Solder the second red half to + (the longer pin, marked on top) and the second black half to −.', esp32: 'Fold the buzzer’s pins flat and solder the second red half to + (the longer pin, marked on top). Solder the transistor’s collector to the buzzer’s − pin and a 1 kΩ resistor to its base, then half an orange jumper to that resistor and the second black half to the emitter. Shrink one sleeve over transistor and resistor. Transistor pin orders differ: check its datasheet.' }, parts: ['buzzer', 'npn'] },
      { text: 'Make sure no bare joint can touch another and the switch is off. Fit the two cells, each + end where the holder shows +. Flick the switch on briefly: the power LEDs on the controller and on the driver should both light.', parts: ['cells', 'switch'] },
    ],
    note: {
      uno: 'Check polarity twice before the cells go in. The UNO’s jack is centre-positive, and the plug’s + screw connects to its centre pin — confirm with a multimeter. Recharge once the pack drops to about 7 V; below that the UNO’s regulator can no longer hold 5 V. If no LED lights, switch off immediately and recheck the wiring. The LED and buzzer stay on the bench until step 8.',
      esp32: 'Check polarity twice before the cells go in. Most expansion boards are centre-positive, but read the symbol beside the jack, and confirm with a multimeter that the plug’s + screw connects to its centre pin. Recharge once the pack drops to about 7 V. If no LED lights, switch off immediately and recheck the wiring. The LED and buzzer stay on the bench until step 8.',
    },
  },
  {
    id: 'wiring', label: 'Wiring', kicker: 'Build', title: 'Wire it up',
    intro: {
      uno: 'Each sensor and actuator plugs into a G / V / S header on the shield, so they all share the UNO’s ground; the driver gets its ground from the battery, which is the same ground through the DC jack. Pins were picked by where each part sits, so the wires fan out without crossing. With the power off, work in this order: the LED first (low down at the left end of the header) and the sensor’s four wires last, because they arch over everything. Fit a jumper one end at a time — push one socket fully home, bend the wire, push on the other. Point at a row to see its wire on the model.',
      esp32: 'Each sensor and actuator plugs into a G / V / S header on the expansion board, so they all share the ESP32’s ground; the driver gets its ground from the battery, which is the same ground through the DC jack. Pins were picked by where each part sits, so the wires fan out without crossing. With the power off, work in this order: the LED first (low down at the left end of the header) and the sensor’s wires last, because they arch over everything. Fit a jumper one end at a time — push one socket fully home, bend the wire, push on the other. Point at a row to see its wire on the model.',
    },
    pins: {
      uno: [
        ['LED — stick it beside the controller’s front-left corner; red → S, black → G', 'D13', ['wireLed', 'led', 'resistor']],
        ['Driver A-IA / A-IB (left side)', 'D11 / D12', ['wireDriverA']],
        ['Driver B-IA / B-IB (right side)', 'D5 / D6', ['wireDriverB']],
        ['Servo plug (brown G, red V, orange S)', 'A5', ['wireServo']],
        ['Buzzer — stick it to the front of the top deck; red → S, black → G', 'A0', ['wireBuzzer', 'buzzer']],
        ['HC-SR04 Trig → S, VCC → V, GND → G of D2', 'D4', ['wireSonar']],
        ['HC-SR04 Echo', 'D3', ['wireSonar']],
      ],
      esp32: [
        ['LED — stick it beside the controller’s front-left corner; red → S, black → G', 'GPIO 13', ['wireLed', 'led', 'resistor']],
        ['Driver A-IA / A-IB (left side)', 'GPIO 26 / 27', ['wireDriverA']],
        ['Driver B-IA / B-IB (right side)', 'GPIO 33 / 25', ['wireDriverB']],
        ['Servo plug (brown G, red V, orange S)', 'GPIO 23', ['wireServo']],
        ['Buzzer — stick it to the front of the top deck; red → V, orange (base) → S, black (emitter) → G', 'GPIO 21', ['wireBuzzer', 'buzzer', 'npn']],
        ['HC-SR04 Trig → S, VCC → V, GND → G of GPIO 34', 'GPIO 32', ['wireSonar']],
        ['HC-SR04 Echo — cut its jumper 4.5 cm from one end, put the 1 kΩ between the pieces, the 2 kΩ from there to 4.7 cm of black jumper; short ends → S and G', 'GPIO 35', ['wireSonar', 'divider']],
      ],
    },
    note: {
      uno: 'D5 and D11 set each side’s speed. They are PWM pins that keep working while the Servo library runs — the library takes Timer1, which disables PWM on D9 and D10. D6 and D12 set direction. The servo and buzzer use A5 and A0 as plain digital pins. All G pins on the shield are connected together, and so are all V pins, so the sensor’s GND and VCC can use whichever header is closest.',
      esp32: 'The 1 kΩ / 2 kΩ divider brings the 5 V Echo pulse down to about 3.3 V (5 V × 2⁄3). Echo goes to GPIO 35, one of the input-only pins (34–39), which suits a signal that is only ever read. The buzzer runs from the 5 V V pin and the transistor switches it, since 3.3 V is too little for a 5 V buzzer. The outputs avoid GPIO 0, 2, 5, 12, 14 and 15, which are strapping pins or toggle during boot. All G pins are connected together, and so are all V pins.',
    },
  },
  {
    id: 'code', label: 'Code', kicker: 'Program', title: 'Upload the code', code: true,
    intro: {
      uno: 'There are two sketches. The wiring test exercises every part one after another, so you can confirm each is connected and both sides spin the right way. The obstacle avoider is the car’s real program: it drives until something is nearer than 25 cm, glances right and left with the head, and turns towards the side with more space.',
      esp32: 'There are two sketches. The wiring test exercises every part one after another over the serial port. The Wi-Fi firmware turns the ESP32 into its own access point: it carries out the commands this lab sends (drive, speed, mode, servo, LED, buzzer), stops when they stop arriving, reports the distance and motor state ten times a second, and in Auto mode avoids obstacles by itself with the same routine the simulator runs.',
    },
    do: {
      uno: [
        { text: 'In the Arduino IDE pick Tools → Board → Arduino UNO and the correct port. Both sketches use the Servo library, which ships with the IDE.' },
        { text: 'Lift the car so no wheel touches the table. Upload the wiring test, switch the battery on and open the Serial Monitor at 115200 baud. Check each numbered line as it happens: LED and beep, head right–left–centre, then each side forwards and backwards.' },
        { text: 'Fix anything that did not match, using the list below. Then upload the obstacle avoider, unplug the USB cable, set the car on the floor and switch on: it waits two seconds and drives off.' },
        { text: 'Adjust TURN_MS until each turn is roughly a quarter turn on your floor.' },
      ],
      esp32: [
        { text: 'In the Arduino IDE open File → Preferences and add https://espressif.github.io/arduino-esp32/package_esp32_index.json to “Additional boards manager URLs”. Install “esp32 by Espressif Systems” 3.x in the Boards Manager and select ESP32 Dev Module.' },
        { text: 'In the Library Manager install “WebSockets” by Markus Sattler and “ArduinoJson” (version 7) by Benoit Blanchon.' },
        { text: 'Lift the car so no wheel touches the table, upload the wiring test and open the Serial Monitor at 115200 baud. Check each numbered line, and fix anything that did not match using the list below.' },
        { text: 'Upload the Wi-Fi firmware and switch the battery on. Join the “RamiLabs-Rover” network (password rover1234), go to step 10 and choose Settings → Real car (ESP32 Wi-Fi). Try the LED, buzzer and servo, then W A S D; finally put the car down, try Auto, and adjust TURN_MS until each turn is about a quarter turn.' },
      ],
    },
    sketches: {
      uno: [
        { tab: '1 · Wiring test', file: 'rover_test_uno.ino', key: 'unoTest' },
        { tab: '2 · Obstacle avoider', file: 'rover_avoider_uno.ino', key: 'uno' },
      ],
      esp32: [
        { tab: '1 · Wiring test', file: 'rover_test_esp32.ino', key: 'esp32Test' },
        { tab: '2 · Wi-Fi firmware', file: 'rover_wifi_esp32.ino', key: 'esp32' },
      ],
    },
    explain: {
      uno: [
        ['Pins and tuning', 'The constants at the top name every pin and the numbers worth tuning: the speeds, how long a quarter turn takes and the two distances that trigger a stop and a back-up.'],
        ['run() and drive()', 'The L9110S turns a motor while its two inputs differ. IB sets the direction; PWM on IA sets how much of the time the motor gets power. In reverse IB is high, so the PWM value is flipped (255 − speed).'],
        ['readCm()', 'A 10 µs pulse on Trig starts a measurement; pulseIn() times how long Echo stays high. Dividing by 58 gives centimetres. A timeout (no echo) counts as 400 cm — open space, not a wall.'],
        ['Stuck check', 'If the reading has not changed by more than 2 cm for 1.5 s while the wheels are pushing, the car must be caught on something the narrow beam missed, so it backs off.'],
        ['Scan and decide', 'At an obstacle the car stops, beeps, looks right then left, and turns towards the larger distance. If both sides are tight it reverses and looks again. Straight after a turn it keeps turning the same way, which stops it rocking left–right–left in a corner.'],
      ],
      esp32: [
        ['Pins and LEDC', 'arduino-esp32 3.x drives PWM with ledcAttach(pin, frequency, bits) and ledcWrite(pin, duty). The motors use 1 kHz at 8 bits; the servo gets 50 Hz at 14 bits, and servoWrite() turns an angle into a 0.5–2.4 ms pulse.'],
        ['Wi-Fi and commands', 'The ESP32 opens its own access point and a WebSocket server on port 81. Each message is a small JSON object such as {"cmd":"drive","dir":"left"}; onSocket() reads it and updates the car’s state.'],
        ['Dead-man stop', 'The lab repeats the drive command while a key is held. If nothing arrives for 0.7 s in Manual mode the motors stop, so a dropped connection never leaves the car running away.'],
        ['Telemetry', 'Ten times a second the firmware measures the distance and broadcasts the mode, direction, speed, motor outputs, servo angle, LED and buzzer to the lab, which shows them in its readouts.'],
        ['Auto mode', 'autoStep() is a non-blocking state machine — cruise, halt, look right, look left, decide, turn or reverse — so Wi-Fi keeps working while the car thinks. It uses the same distances, stuck check and “keep turning the same way” rule as the simulator.'],
      ],
    },
    fixes: {
      uno: [
        ['Nothing lights up at switch-on', 'Switch off. Check that the cells are charged and fitted the right way round, that the reds are under the plug’s + screw, and that the switch uses its middle pin and one outer pin.'],
        ['One side spins backwards in the test', 'Swap that side’s two wires in its screw terminal. MOTOR-A is the left side, MOTOR-B the right.'],
        ['One wheel turns against its partner', 'Swap that single motor’s two leads where they are twisted to the other motor’s.'],
        ['Line 3 moves the right-hand wheels', 'The jumper pairs are crossed: A-IA / A-IB belong on D11 / D12 and B-IA / B-IB on D5 / D6.'],
        ['The head looks left first', 'Some servos run the other way round: swap the 30 and 150 angles in the sketches.'],
        ['Distance always reads 0.0 cm', 'No echo is arriving. Check Trig is on D4, Echo on D3, and the sensor’s VCC and GND are on a V and a G pin. It also reads 0 when nothing is within about 4 m.'],
        ['The UNO resets when the motors start', 'The battery voltage is sagging: recharge. A 470–1000 µF capacitor across V and G on the shield (watch its polarity) helps the 5 V rail ride out the dips.'],
        ['It hums but will not turn on the spot', 'Spinning drags all four tyres sideways and needs more push than driving straight. Raise SPIN towards MAX_PWM and recharge the cells.'],
        ['It drifts to one side', 'No two motors are identical. Slow the faster side: for a car that drifts right, use drive(CRUISE - 10, CRUISE).'],
      ],
      esp32: [
        ['Upload hangs at “Connecting…”', 'Hold the DevKit’s BOOT button until the upload starts, and use a USB cable that carries data, not just power.'],
        ['The lab will not connect to the car', 'Your computer must be on the “RamiLabs-Rover” network, and this page must be opened over http://, not https:// — browsers block ws:// connections from secure pages. Serve the twin-labs folder from your own computer (for example python3 -m http.server) and open it at http://localhost.'],
        ['One side spins backwards', 'Swap that side’s two wires in its screw terminal. MOTOR-A is the left side, MOTOR-B the right.'],
        ['One wheel turns against its partner', 'Swap that single motor’s two leads where they are twisted to the other motor’s.'],
        ['Left and right are swapped', 'The jumper pairs are crossed: A-IA / A-IB belong on GPIO 26 / 27 and B-IA / B-IB on GPIO 33 / 25.'],
        ['In Auto the head looks left first', 'Some servos run the other way round: swap LOOK_RIGHT and LOOK_LEFT.'],
        ['Distance always reads 400 cm', 'No echo is arriving. Check Trig is on GPIO 32, Echo reaches GPIO 35 through the divider, and the sensor’s VCC is on a 5 V pin. It also reads 400 when nothing is within about 4 m.'],
        ['The buzzer stays quiet', 'Check the transistor’s pins against its datasheet (the order differs between types) and that the buzzer’s + is on a 5 V pin.'],
        ['The ESP32 resets when the motors start', 'The battery voltage is sagging: recharge. A 470–1000 µF capacitor across a 5 V pin and G (watch its polarity) helps the supply ride out the dips.'],
        ['It hums but will not turn on the spot', 'Spinning drags all four tyres sideways and needs more push than driving straight. Raise the speed and recharge the cells.'],
      ],
    },
    note: {
      uno: 'When nothing reflects the chirp, the HC-SR04 holds Echo high for roughly 38 ms — longer than the sketch’s 30 ms timeout — so pulseIn() returns 0. The avoider treats that as 400 cm, “all clear”, never as “touching”. Because the beam is narrow, the car can clip a corner it never saw; a reading that freezes while the wheels push reveals that it is stuck. And when it is blocked again right after a turn it carries on turning the same way, instead of swinging back and forth in a corner forever.',
      esp32: 'ledcAttach() and ledcWrite(pin, duty) belong to the arduino-esp32 3.x API; the 2.x calls ledcSetup() and ledcAttachPin() no longer compile. Because the beam is narrow, the car can clip a corner it never saw; a reading that freezes while the wheels push reveals that it is stuck. And when it is blocked again right after a turn it carries on turning the same way, instead of swinging back and forth in a corner forever.',
    },
  },
  {
    id: 'drive', label: 'Drive', kicker: 'Simulate', title: 'Drive it', drive: true,
    intro: {
      uno: 'The simulated car is built from the same parts as yours. Drive it around the test arena, then switch to Auto: it runs the obstacle avoider’s routine — stop and beep at an obstacle, look right and left, turn towards the open side, and back up when it is stuck.',
      esp32: 'The simulated car understands the same commands this lab sends to your ESP32, and its Auto mode follows the firmware’s routine. Once the real car is built, switch to it under Settings → Real car (ESP32 Wi-Fi).',
    },
  },
];

export const stepIndex = id => STEPS.findIndex(s => s.id === id);

/** Every tickable item of a step, as stable keys. */
export function checkKeys(step, board) {
  const keys = [];
  (pick(step.do, board) || []).forEach((_, i) => keys.push(`${board}/${step.id}/do/${i}`));
  if (step.checkBom) (step.bom || []).forEach((_, i) => keys.push(`${board}/${step.id}/bom/${i}`));
  return keys;
}

export { SKETCHES };
