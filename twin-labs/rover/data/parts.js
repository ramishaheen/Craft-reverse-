// What each part is, its key specs, and the step that fits it. Shown when a part is clicked.
// Values may be { uno, esp32 } like in steps.js.

export const PARTS = {
  wheel: {
    name: 'Wheel, 65 mm', group: 'Drivetrain', step: 'motors',
    what: 'A rubber tyre on a plastic rim. The hub’s socket has two flats that match the TT motor shaft, so the wheel is locked to it. Turning on the spot drags the tyres sideways, so grip matters.',
    specs: [['Diameter', '65 mm'], ['Width', 'about 26 mm'], ['Hub', 'double-flat socket for the TT shaft'], ['Travel per turn', 'about 20.4 cm (π × 6.5 cm)']],
  },
  motor: {
    name: 'TT gear motor', group: 'Drivetrain', step: 'motors',
    what: 'A small brushed DC motor driving a 1:48 plastic gearbox. Reverse the current and the wheel reverses; reduce the average voltage with PWM and it slows down.',
    specs: [['Voltage', '3–6 V'], ['Gear ratio', '1:48'], ['Speed', 'about 200 rpm at 6 V, unloaded'], ['Current', 'about 150 mA unloaded, up to about 1.5 A stalled at 6 V'], ['Stall torque', 'about 0.8 kg·cm at 6 V'], ['Body', '70 × 22 × 18 mm'], ['Shaft', 'Ø 5.5 mm, two flats 3.7 mm apart, out of both sides'], ['Mounting', 'two Ø 3 mm holes 17.5 mm apart']],
  },
  bracket: {
    name: 'Motor bracket', group: 'Chassis', step: 'motors',
    what: 'A T-shaped acrylic piece. The stem rises through the bottom deck next to the gearbox while the wide head stays underneath, so it cannot pull through. A motor sits between two of them, clamped by two long bolts.',
    specs: [['Material', 'acrylic'], ['Per motor', '2 brackets, 2 × M3 × 30 bolts and nuts'], ['Fitted', 'from below: inner one in a slot, outer one in the deck-edge notch']],
  },
  bolts: {
    name: 'M3 × 30 bolts and nuts', group: 'Chassis', step: 'motors',
    what: 'Long machine screws that pass through both brackets and the gearbox’s two mounting holes, with a nut on the far side.',
    specs: [['Thread', 'M3'], ['Length', '30 mm'], ['Count', '8 bolts, 8 nuts']],
  },
  deckBottom: {
    name: 'Bottom deck', group: 'Chassis', step: 'motors',
    what: 'Holds the four motors and the eight tall standoffs. Beside every motor there is a slot and an edge notch for its two brackets.',
    specs: [['Material', 'acrylic, 3 mm'], ['Size (this model)', 'about 22 × 10 cm']],
  },
  deckMiddle: {
    name: 'Middle deck', group: 'Chassis', step: 'decks',
    what: 'The floor for the electronics. Its long centre slot lets the motor leads up from below; the rectangular cut-out at the front takes the servo, with a notch for the servo cable.',
    specs: [['Material', 'acrylic, 3 mm'], ['Size (this model)', 'about 21 × 11 cm'], ['Height', '25 mm above the bottom deck']],
  },
  deckTop: {
    name: 'Top deck', group: 'Chassis', step: 'power',
    what: 'A half-length plate over the rear that carries the battery holder, the switch and the buzzer, above the electronics.',
    specs: [['Material', 'acrylic, 3 mm'], ['Size (this model)', 'about 9.5 × 11 cm'], ['Height', '15 mm above the middle deck']],
  },
  standoff: {
    name: 'Brass standoff, M3', group: 'Chassis', step: 'decks',
    what: 'Hexagonal spacers with a thread inside each end. They keep the decks apart and lift circuit boards off the acrylic so nothing underneath touches.',
    specs: [['Thread', 'M3 female–female'], ['25 mm × 8', 'bottom to middle deck (clears the 22 mm gearboxes)'], ['15 mm × 4', 'middle to top deck'], ['10 mm × 4', 'under the controller board'], ['Screws', 'one M3 × 6 mm at each end']],
  },
  screws: {
    name: 'M3 × 6 mm screws', group: 'Chassis', step: 'decks',
    what: 'Short cross-head screws that hold every standoff to a deck or a board.',
    specs: [['Thread', 'M3'], ['Length', '6 mm'], ['Count', '32']],
  },
  motorLeads: {
    name: 'Motor leads', group: 'Wiring', step: 'motors',
    what: 'One red and one black wire per motor: red on the tab nearer the middle of the car, black on the tab nearer the wheel. The two motors on a side are wired in parallel — red to red, black to black — into one driver channel, so they always turn together.',
    specs: [['Length', 'about 15 cm each'], ['Left pair', 'MOTOR-A'], ['Right pair', 'MOTOR-B'], ['Side runs backwards?', 'swap its two pairs in the terminal'], ['Wheel fights its partner?', 'swap that motor’s two leads']],
  },
  driver: {
    name: 'L9110S motor driver', group: 'Electronics', step: 'driver',
    what: 'Two L9110S H-bridge chips, one per channel. Each channel has two inputs: IA high and IB low turns the motor one way, IA low and IB high turns it the other way, and equal inputs stop it. PWM on an input sets the speed.',
    specs: [['Supply (VCC)', '2.5–12 V'], ['Current', '800 mA per channel (1.5–2 A peak)'], ['Inputs', 'A-IA, A-IB, B-IA, B-IB; 3.3 V or 5 V logic'], ['Header', 'B-IA · B-IB · GND · VCC · A-IA · A-IB'], ['Board', 'about 29 × 23 mm (varies by seller)']],
  },
  foam: {
    name: 'Foam tape', group: 'Chassis', step: 'driver',
    what: 'Double-sided foam pads. They hold the driver, the battery holder, the switch, the LED and the buzzer, and insulate them from screws underneath.',
    specs: [['Thickness', 'about 1–2 mm'], ['Tip', 'clean the acrylic first so it sticks']],
  },
  uno: {
    name: 'Arduino UNO R3', group: 'Electronics', step: 'controller',
    what: 'A microcontroller board built around the ATmega328P. It runs your sketch, reads the sensor and decides what the motors should do.',
    specs: [['MCU', 'ATmega328P @ 16 MHz'], ['Logic level', '5 V'], ['PWM pins', '3, 5, 6, 9, 10, 11'], ['Memory', '32 KB flash, 2 KB RAM'], ['Power in', '7–12 V on the DC jack (recommended)'], ['Pin current', '20 mA recommended, 40 mA absolute maximum']],
  },
  shield: {
    name: 'Sensor Shield V5', group: 'Electronics', step: 'controller',
    what: 'Plugs onto the UNO and brings every pin out to a three-pin G / V / S header (ground, 5 V, signal), so a servo or a sensor plugs in with its own supply and ground.',
    specs: [['Headers', 'D0–D13 and A0–A5, each G · V · S'], ['V pins', '5 V from the UNO while SEL is fitted'], ['SEL removed', 'V comes from the screw terminal'], ['Caution', 'never feed the screw terminal with SEL fitted'], ['Extras', 'I²C and serial headers']],
  },
  esp32: {
    name: 'ESP32 DevKit + expansion board', group: 'Electronics', step: 'controller',
    what: 'A dual-core microcontroller with Wi-Fi and Bluetooth, plugged into an expansion board that adds a DC jack, regulators and a G / V / S header for every pin.',
    specs: [['Module', 'ESP32-WROOM-32, up to 240 MHz'], ['Logic level', '3.3 V — not 5 V tolerant'], ['PWM', 'on any output pin (LEDC)'], ['Wireless', 'Wi-Fi 802.11 b/g/n, Bluetooth'], ['Power in', 'about 6.5–12 V on the DC jack (check yours)'], ['V pins', '3.3 V or 5 V, chosen by a jumper']],
  },
  servo: {
    name: 'SG90 micro servo', group: 'Sensor head', step: 'sensor',
    what: 'A tiny motor, gearbox and position sensor in one case. It wants a pulse every 20 ms (50 Hz); the pulse width is the angle — 1.5 ms is centre, and roughly 0.5–2.4 ms spans 0° to 180°.',
    specs: [['Torque', 'about 1.2–1.8 kg·cm'], ['Speed', 'about 0.1 s per 60°'], ['Voltage', '4.8–6 V'], ['Size, weight', '23 × 12 × 29 mm, 9 g'], ['Wires', 'brown GND, red V+, orange signal']],
  },
  sonarBracket: {
    name: 'HC-SR04 servo bracket', group: 'Sensor head', step: 'sensor',
    what: 'Screws onto the servo horn and holds the HC-SR04 by two corner holes, so the sensor turns with the servo and its beam stays level.',
    specs: [['Fixing', 'servo horn screws'], ['Holds', 'the HC-SR04 by two corner holes'], ['Other designs', 'some brackets clamp the two transducers instead']],
  },
  sonar: {
    name: 'HC-SR04 ultrasonic sensor', group: 'Sensor head', step: 'sensor',
    what: 'A 10 µs pulse on Trig makes one transducer send eight cycles at 40 kHz while the other listens. Echo then stays high for the round trip, so cm = µs ÷ 58 (sound at 343 m/s, there and back).',
    specs: [['Range', '2–400 cm'], ['Beam', 'under 15°'], ['Supply', '5 V, about 15 mA'], ['Ping rate', 'at most one every 60 ms'], ['Pins seen from the front', 'VCC · Trig · Echo · GND with pins at the bottom; mounted pins-up as here: GND · Echo · Trig · VCC']],
  },
  battery: {
    name: '2 × 18650 holder', group: 'Power', step: 'power',
    what: 'A two-slot holder that connects the cells in series, with a red (+) and a black (−) lead.',
    specs: [['Voltage', '7.4 V nominal (6–8.4 V)'], ['Holder', '2 slots in series'], ['Leads', 'red +, black −'], ['Note', 'protected cells are a few mm longer; check they fit']],
  },
  cells: {
    name: '18650 Li-ion cells', group: 'Power', step: 'power',
    what: 'Rechargeable lithium-ion cells, 18 mm across and 65 mm long. Use protected cells, never short them, and only charge them in a proper Li-ion charger.',
    specs: [['Voltage', '3.7 V nominal, 4.2 V full'], ['Capacity', '2000–3500 mAh (genuine cells)'], ['Size', 'Ø 18 × 65 mm']],
  },
  switch: {
    name: 'Power switch', group: 'Power', step: 'power',
    what: 'Cuts the battery’s + lead, turning the whole car off. It is wired between its middle pin and one outer pin, and lies on its side at the top deck’s left edge with the lever pointing out, where a finger can reach it.',
    specs: [['Type', 'SPDT slide switch used as on/off'], ['Pins', 'three in a row: outer · common · outer'], ['Rating', 'choose one rated for 2 A DC or more']],
  },
  dcPlug: {
    name: 'DC barrel plug with screw terminals', group: 'Power', step: 'power',
    what: 'The meeting point for all power wiring. Its two screws take the battery leads and the driver’s supply wires; the plug goes into the controller’s DC jack.',
    specs: [['Size', '5.5 × 2.1 mm'], ['Polarity', 'centre positive'], ['Under each screw', 'two wires: one from the battery, one to the driver']],
  },
  buzzer: {
    name: 'Active buzzer, 5 V', group: 'Signals', step: 'power',
    what: {
      uno: 'It contains its own oscillator: set the pin HIGH and it beeps at a fixed pitch, no tone() needed. It can draw 25–30 mA — within the pin’s 40 mA absolute limit but above the recommended 20 mA, so a transistor is the gentler choice if you want one.',
      esp32: 'It contains its own oscillator: give it power and it beeps at a fixed pitch. A 5 V active buzzer needs at least 3.5–4 V, more than a 3.3 V pin can give, so it runs from the 5 V V pin and an NPN transistor driven by GPIO 21 switches it.',
    },
    specs: [['Size', '12 mm'], ['Tone', 'about 2.3 kHz'], ['Rated voltage', '5 V (works from about 3.5–4 V up)'], ['Current', 'about 25–30 mA at 5 V'], ['Polarity', 'longer pin / “+” on top = positive']],
  },
  led: {
    name: '10 mm red LED', group: 'Signals', step: 'power',
    what: 'Current flows from the long leg (anode, +) to the short leg (cathode, −, next to the flat on the rim), and always through a series resistor. It lies on its side beside the controller’s front-left corner, shining out to the left.',
    specs: [['Forward voltage', 'about 1.8–2.2 V'], ['Current', '20 mA maximum']],
  },
  resistor: {
    name: '220 Ω resistor', group: 'Signals', step: 'power',
    what: {
      uno: 'Sets the LED current: (5 V − 2 V) ÷ 220 Ω ≈ 14 mA. The bands read red, red, brown: 2, 2, × 10 = 220 Ω.',
      esp32: 'Sets the LED current: (3.3 V − 2 V) ÷ 220 Ω ≈ 6 mA. The bands read red, red, brown: 2, 2, × 10 = 220 Ω.',
    },
    specs: [['Bands', 'red · red · brown · gold'], ['Tolerance', '± 5 %']],
  },
  divider: {
    name: 'Echo divider, 1 kΩ + 2 kΩ', group: 'Signals', step: 'wiring',
    what: 'The HC-SR04’s Echo output rises to 5 V but an ESP32 pin takes at most 3.3 V. Two resistors in series from Echo to ground form a divider; the GPIO reads the voltage across the 2 kΩ: 5 V × 2 ÷ 3 ≈ 3.3 V.',
    specs: [['1 kΩ bands', 'brown · black · red · gold'], ['2 kΩ bands', 'red · black · red · gold'], ['Wiring', 'Echo → 1 kΩ → GPIO 35; 2 kΩ from GPIO 35 to G'], ['Needed for', 'ESP32 only']],
  },
  npn: {
    name: 'Buzzer transistor, NPN + 1 kΩ', group: 'Signals', step: 'power',
    what: 'An NPN transistor used as a switch: a small base current lets a bigger current flow from collector to emitter. GPIO 21 feeds the base through 1 kΩ — (3.3 V − 0.7 V) ÷ 1 kΩ ≈ 2.6 mA — plenty to switch the buzzer’s 30 mA from the 5 V pin.',
    specs: [['Transistor', 'PN2222A, S8050 or another small NPN'], ['Collector', 'buzzer −'], ['Base', '1 kΩ → S of GPIO 21'], ['Emitter', 'G of GPIO 21'], ['Needed for', 'ESP32 only']],
  },
  hookup: {
    name: 'Hook-up wire', group: 'Wiring', step: 'motors',
    what: 'Stranded red and black wire for the motor leads. Cut it to length as you go.',
    specs: [['Red', 'the inner tab of every motor'], ['Black', 'the tab nearer the wheel']],
  },
  jumpers: {
    name: 'Female–female jumper wires', group: 'Wiring', step: 'wiring',
    what: 'Dupont leads with a socket at both ends that push onto 2.54 mm header pins. The driver inputs and the sensor take whole jumpers; cut ones give leads with a socket on one end for the soldered parts and for the driver supply.',
    specs: [['Pitch', '2.54 mm (0.1″)'], ['Length', '15 cm (20 cm also works, with bigger loops)'], ['Used whole', { uno: '8: four driver inputs, four sensor pins', esp32: '7: four driver inputs, three sensor pins' }], ['Cut', { uno: '4: red and black halves for the LED and buzzer; red and black cut 12.5 cm for the driver supply', esp32: '6: red and black halves for the LED and buzzer, orange half for the transistor base, red and black cut 11 cm for the driver supply, and the Echo wire for its divider' }]],
  },
  wireSonar: {
    name: 'Sensor jumpers', group: 'Wiring', step: 'wiring',
    what: { uno: 'Four jumpers from the sensor header (at the top) arching back to the shield. Any V and any G pin works for VCC and GND, so the nearest are used and the four wires run side by side.', esp32: 'Four leads from the sensor header (at the top) arching back to the expansion board. Echo is a 5 V signal, so it passes through the 1 kΩ / 2 kΩ divider soldered into its jumper before it reaches the 3.3 V GPIO.' },
    specs: { uno: [['VCC', 'V of D4'], ['Trig', 'S of D4'], ['Echo', 'S of D3'], ['GND', 'G of D2']], esp32: [['VCC', 'V of GPIO 32 (5 V)'], ['Trig', 'S of GPIO 32'], ['Echo', '1 kΩ → S of GPIO 35, 2 kΩ to its G'], ['GND', 'G of GPIO 34']] },
  },
  wireDriverA: {
    name: 'Driver jumpers, left side', group: 'Wiring', step: 'wiring',
    what: { uno: 'A-IA and A-IB control the left motors. IA carries the speed on a PWM pin, IB the direction.', esp32: 'A-IA and A-IB control the left motors; both are PWM-capable pins.' },
    specs: { uno: [['A-IA', 'D11 (PWM)'], ['A-IB', 'D12']], esp32: [['A-IA', 'GPIO 26'], ['A-IB', 'GPIO 27']] },
  },
  wireDriverB: {
    name: 'Driver jumpers, right side', group: 'Wiring', step: 'wiring',
    what: { uno: 'B-IA and B-IB control the right motors. IA carries the speed on a PWM pin, IB the direction.', esp32: 'B-IA and B-IB control the right motors; both are PWM-capable pins.' },
    specs: { uno: [['B-IA', 'D5 (PWM)'], ['B-IB', 'D6']], esp32: [['B-IA', 'GPIO 33'], ['B-IB', 'GPIO 25']] },
  },
  wireServo: {
    name: 'Servo cable', group: 'Wiring', step: 'sensor',
    what: { uno: 'The servo’s own three-wire lead. It runs down through the cut-out, up through the slot behind it and back beside the controller to the rear header; the slack folds under the deck. The plug fits a G / V / S header in one go, brown on G.', esp32: 'The servo’s own three-wire lead. It runs down through the cut-out, up through the slot behind it and back beside the controller to the rear header; the slack folds under the deck. The plug fits a G / V / S header in one go, brown on G, with the V row set to 5 V.' },
    specs: { uno: [['Brown', 'G'], ['Red', 'V (5 V)'], ['Orange (signal)', 'S of A5']], esp32: [['Brown', 'G'], ['Red', 'V (5 V)'], ['Orange (signal)', 'S of GPIO 23']] },
  },
  wireLed: {
    name: 'LED leads', group: 'Wiring', step: 'wiring',
    what: 'Half a red and half a black jumper soldered at the LED, with a socket at the other end. The anode reaches a signal pin through the 220 Ω resistor; the cathode goes to ground.',
    specs: { uno: [['Anode (via 220 Ω)', 'S of D13'], ['Cathode', 'G of D13']], esp32: [['Anode (via 220 Ω)', 'S of GPIO 13'], ['Cathode', 'G of GPIO 13']] },
  },
  wireBuzzer: {
    name: 'Buzzer leads', group: 'Wiring', step: 'wiring',
    what: { uno: 'Half a red and half a black jumper soldered to the buzzer. Set the + lead HIGH to beep.', esp32: 'The buzzer sits between the 5 V V pin and the transistor. Set GPIO 21 HIGH and the transistor grounds the buzzer’s −, so it beeps.' },
    specs: { uno: [['+', 'S of A0'], ['−', 'G of A0']], esp32: [['+', 'V of GPIO 21 (5 V)'], ['−', 'transistor collector'], ['Base (via 1 kΩ)', 'S of GPIO 21'], ['Emitter', 'G of GPIO 21']] },
  },
  wirePower: {
    name: 'Power wiring', group: 'Wiring', step: 'power',
    what: { uno: 'All power meets at the DC plug in the UNO’s jack. Battery + reaches the + screw through the switch; battery − goes straight to the − screw. A second red and black pair under the same screws takes the battery voltage to the driver’s VCC and GND. The shield’s 5 V pins cannot feed the driver: they come from the UNO’s regulator, good for a few hundred mA at most.', esp32: 'All power meets at the DC plug in the expansion board’s jack. Battery + reaches the + screw through the switch; battery − goes straight to the − screw. A second red and black pair under the same screws takes the battery voltage to the driver’s VCC and GND. The board’s 5 V pins cannot feed the driver: they come from a regulator good for a few hundred mA at most.' },
    specs: [['Red', 'battery + (switched)'], ['Black', 'battery − = GND'], ['Plug', '5.5 × 2.1 mm barrel, centre +']],
  },
};
