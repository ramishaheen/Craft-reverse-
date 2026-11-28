// Every Rover Lab interface string, in English. Other languages override what they translate.

export default {
  'header.board': 'Board',
  'header.language': 'Language',
  'header.langFallback': 'English text',
  'header.help': 'Keyboard shortcuts',
  'header.settings': 'Settings',

  'step.parts': 'Parts', 'step.motors': 'Motors', 'step.decks': 'Decks', 'step.driver': 'Driver', 'step.controller': 'Controller',
  'step.sensor': 'Sensor', 'step.power': 'Power', 'step.wiring': 'Wiring', 'step.code': 'Code', 'step.drive': 'Drive',
  'kicker.get ready': 'Get ready', 'kicker.build': 'Build', 'kicker.program': 'Program', 'kicker.simulate': 'Simulate',

  'strip.aria': 'Build steps', 'strip.prev': 'Earlier steps', 'strip.next': 'Later steps', 'strip.done': 'Everything ticked off',

  'bench.title': 'Workbench', 'bench.sub': 'Step {n} · {title}', 'bench.arena': 'Test arena',
  'bench.arenaSub': 'Drive with W A S D or the controls on the right', 'bench.inspect': 'Click for details',
  'bench.noGl': 'The 3D view needs WebGL, which this browser could not start.',

  'tools.pause': 'Pause the animation (Space)', 'tools.play': 'Play the animation (Space)', 'tools.replay': 'Play this step’s assembly again (Space)',
  'tools.speed': 'Animation speed', 'tools.zoomIn': 'Zoom in (+)', 'tools.zoomOut': 'Zoom out (−)', 'tools.explode': 'Exploded view (E)',
  'tools.camera': 'Camera view (C chase, T top)', 'tools.reset': 'Reset the view (0)',
  'tools.cam.orbit': 'Orbit camera', 'tools.cam.chase': 'Chase camera: riding behind the car', 'tools.cam.top': 'Top view of the whole arena',

  'lesson.kicker': '{kind} · Step {n} of {total}', 'lesson.bom': 'Bill of materials', 'lesson.need': 'You will need', 'lesson.tools': 'Tools',
  'lesson.do': 'Do this', 'lesson.note': 'Note', 'lesson.pinmap': 'Pin map · {board}', 'lesson.sketches': 'Sketches',
  'lesson.explain': 'How the code works', 'lesson.fixes': 'If something is off', 'lesson.tick': 'Tick off: {item}', 'lesson.details': 'Show details',
  'lesson.playPhase': 'Show this instruction in 3D', 'lesson.back': 'Back', 'lesson.next': 'Next: {label}', 'lesson.restart': 'Start over', 'lesson.steps': 'steps',

  'part.back': 'Back to the step', 'part.specs': 'Specs', 'part.fitted': 'Fitted in step {n} · {title}', 'part.go': 'Go to that step',

  'code.copy': 'Copy', 'code.download': 'Download', 'code.copied': '{file} copied to the clipboard', 'code.copyFailed': 'Copying is blocked here: select the code and copy it by hand',

  'flow.title': 'How the program decides', 'flow.tip': 'Pick a box to see its code', 'flow.label': 'Program flow', 'flow.open': 'Open the flow chart (F)',
  'flow.auto': 'Auto', 'flow.live': 'Live', 'flow.off': 'Auto is off · ', 'flow.offWhy': 'switch to Auto to watch the car decide',
  'flow.yes': 'yes', 'flow.no': 'no', 'flow.kind.start': 'Every loop', 'flow.kind.do': 'Action', 'flow.kind.ask': 'Question',
  'flow.node.measure': 'Measure distance', 'flow.node.clear': 'Way clear?', 'flow.node.driveOn': 'Drive on', 'flow.node.halt': 'Stop · LED · beep',
  'flow.node.stuck': 'Stuck?', 'flow.node.backOff': 'Back off', 'flow.node.look': 'Look right, then left', 'flow.node.room': 'Room to turn?',
  'flow.node.backUp': 'Back up, look again', 'flow.node.again': 'Just turned?', 'flow.node.same': 'Same way again', 'flow.node.side': 'Side with more room',
  'flow.node.turn': 'Turn',

  'live.cruise': 'Driving on', 'live.cruiseWhy': 'nearest thing ahead {d}; it stops below {stop} cm',
  'live.halt': 'Stopped', 'live.haltWhy': 'something {d} ahead', 'live.stuckWhy': 'the reading has not moved for {s} s while the wheels push',
  'live.lookRight': 'Looking right', 'live.lookWhy': 'head at {a}°', 'live.lookLeft': 'Looking left', 'live.lookLeftWhy': 'head at {a}° · right side measured {r}',
  'live.centre': 'Deciding', 'live.centreWhy': 'left {l}, right {r}', 'live.reverse': 'Backing up', 'live.boxedWhy': 'left {l} and right {r} are both under {min} cm',
  'live.turnLeft': 'Turning left', 'live.turnRight': 'Turning right', 'live.sideWhy': 'left {l} vs right {r}: towards the open side',
  'live.againWhy': 'it just turned this way and is blocked again, so it keeps going round instead of rocking back',

  'drive.title': 'Drive', 'drive.fwd': 'Forward (W / ↑)', 'drive.back': 'Reverse (S / ↓)', 'drive.left': 'Turn left (A / ←)', 'drive.right': 'Turn right (D / →)',
  'drive.stop': 'Stop (Space)', 'drive.speed': 'Speed', 'drive.mode': 'Mode', 'drive.actuators': 'Actuators', 'drive.led': 'LED', 'drive.buzzer': 'Buzzer',
  'drive.servo': 'Servo', 'drive.serial': 'Serial monitor', 'drive.clear': 'Clear',
  'drive.keys': '<span class="kbd">WASD</span> drive · <span class="kbd">Space</span> stop · <span class="kbd">1–3</span> mode · <span class="kbd">L</span> LED · <span class="kbd">B</span> buzzer · <span class="kbd">C</span> chase · <span class="kbd">T</span> top',
  'mode.manual': 'Manual', 'mode.auto': 'Auto', 'mode.stop': 'Stop',
  'hud.distance': 'Distance', 'hud.speed': 'Speed', 'hud.mode': 'Mode', 'hud.servo': 'Servo',
  'pill.sim': 'Simulator', 'pill.connected': 'Real car connected', 'pill.connecting': 'Connecting…', 'pill.closed': 'Real car: not connected', 'pill.error': 'Real car: cannot connect',

  'map.aria': 'Top-down map of the test arena', 'map.label': 'Arena · 3 × 3 m', 'map.edit': 'Edit the arena', 'map.editTip': 'Edit the arena: move, turn and resize obstacles',
  'map.paused': 'Simulation paused', 'map.none': 'Click an obstacle to select it, or drag it to move it.', 'map.size': 'Size', 'map.length': 'Length', 'map.width': 'Width',
  'map.diameter': 'Diameter', 'map.height': 'Height', 'map.turned': 'Turned', 'map.place': 'Position, from the start',
  'map.placeTip': 'Where the obstacle’s middle is, measured from the middle of the arena, where the car starts facing up the map',
  'map.ahead': 'Ahead', 'map.right': 'To the right', 'map.remove': 'Remove', 'map.addBox': '+ Box', 'map.addCan': '+ Can',
  'map.keys': '<div><dt><span class="kbd">Shift</span></dt><dd>steps of 5 cm, 15°</dd></div><div><dt><span class="kbd">←↑↓→</span></dt><dd>move</dd></div><div><dt><span class="kbd">R</span></dt><dd>turn</dd></div><div><dt><span class="kbd">Del</span></dt><dd>remove</dd></div>',
  'map.undo': 'Undo', 'map.undoTip': 'Undo the last change (Ctrl+Z; Ctrl+Shift+Z redoes it)', 'map.reset': 'Reset', 'map.resetTip': 'The arena as it came',
  'map.cancelTip': 'Leave the arena as it was (Esc)', 'map.saveTip': 'Use this arena: the 3D view is rebuilt and the simulation carries on',
  'map.blocked': 'An obstacle (outlined in red) covers the start spot: move it before saving.', 'map.invalid': 'This arena cannot be used.',
  'map.style.cardboard': 'Cardboard box', 'map.style.wood': 'Wooden block', 'map.style.can': 'Drinks can', 'map.style.pot': 'Flower pot',

  'set.title': 'Settings', 'set.conn': 'The drive step controls', 'set.sim': 'Simulator', 'set.real': 'Real car (ESP32 Wi-Fi)', 'set.address': 'Car address',
  'set.simHint': 'The simulated car runs in your browser.',
  'set.wsHint': 'Join the car’s “RamiLabs-Rover” Wi-Fi network first; the ESP32 firmware from step 9 listens on ws://192.168.4.1:81/.',
  'set.httpsWarn': 'This page is served over https, and browsers block ws:// from secure pages: open a local copy over http:// to reach the car.',
  'set.status': 'Status: {status}.', 'set.display': 'Display and sound', 'set.sound': 'Play the buzzer through the speakers', 'set.beam': 'Show the ultrasonic beam',
  'set.follow': 'Camera follows the car', 'set.labels': 'Labels on the parts mat', 'set.animate': 'Animate each build step',
  'set.quality': '3D quality', 'set.qLow': 'Fast', 'set.qHigh': 'Detailed', 'set.qualityHint': 'Fast turns off shadows and renders at normal resolution — try it on older laptops and phones.',
  'set.resetSim': 'Reset simulation', 'set.resetProgress': 'Clear all ticks', 'set.resetProgressAsk': 'Clear every ticked item on every step, for both boards?', 'set.apply': 'Apply',

  'help.title': 'Keyboard shortcuts', 'help.intro': 'The 3D view also answers to the mouse: drag to orbit, right-drag to pan, scroll to zoom, click a part for details.',
  'help.steps': 'Previous / next step', 'help.explode': 'Exploded view on / off', 'help.play': 'Pause, resume or replay the assembly', 'help.zoom': 'Zoom in / out',
  'help.reset': 'Reset the camera', 'help.flow': 'Open the program flow chart (code and drive steps)', 'help.drive': 'Drive (step 10; hold the key)',
  'help.stop': 'Stop (step 10)', 'help.mode': 'Manual / Auto / Stop mode', 'help.ledBuzzer': 'LED / buzzer on or off', 'help.camera': 'Chase camera / top view',
  'help.stepsDrive': 'Previous / next step while driving', 'help.help': 'This list', 'help.esc': 'Close a panel, the flow chart or part details',

  'toast.board': 'Showing the build for the {board}', 'toast.langFallback': '{lang}: interface translation coming; showing English for now',
  'toast.stepDone': 'All done: {title}', 'toast.arenaSaved': 'Arena saved', 'toast.settings': 'Settings applied', 'toast.simReset': 'Simulation reset',
  'toast.progressReset': 'All ticks cleared', 'toast.linkError': 'Could not reach the car — check the Wi-Fi network and the address in Settings',

  'common.close': 'Close', 'common.cancel': 'Cancel', 'common.save': 'Save',
};
