# Systems Lab simulation contract

Each topic in `../catalog.js` has a module `../sims/<slug>.js` whose **default export** is:

```js
export default {
  lead: 'One or two sentences shown under the title (HTML allowed).',
  emptyLog: 'Text shown in “What just happened” before any event.',   // optional
  stageHeight: 420,                                                    // optional, px
  tryThis: ['3 experiments, HTML allowed, <b>bold</b> the key action', '…', '…'],
  inShort: { what: '…', why: '…', tradeoff: '…', interview: '… (no quotes, the page adds them)' },
  quiz: [ { q: 'Question?', o: ['A', 'B', 'C', 'D'], a: 2, why: 'Explanation shown after checking.' }, /* exactly 3 */ ],
  guided: {                    // the predict → run → explain experiment
    intro, example,            // what the guided run does and what it resets to
    question, predictions: [3 strings], correctPrediction: 0,
    running,                   // shown while it runs: what to watch
    observation,               // fallback text if the sim never calls kit.guided.observe()
    explainQuestion, explanations: [3 strings], correctExplanation: 0,
    why, retryHint,
    nextSlug: 'caching', nextLabel: 'Next experiment: caching →',
    waitSeconds: 8,            // real seconds before the fallback observation fires
  },
  setup(kit) {
    // build controls, metrics, chart; register kit.loop / kit.every; call reset()
    return { reset() {}, guidedRun() {}, destroy() {} };   // all optional
  },
};
```

## The `kit`

| member | what it does |
| --- | --- |
| `kit.stage` | canvas stage (see `stage.js`): `w`, `h`, `ctx`, `colors` (theme: `ink ink2 muted line line2 surface surface2 surface3 bg bg2 wire accent signal amber teal ok bad warn orange violet pink grid`), `clear()`, `node(x,y,w,h,{title,sub,fill,fillColor,state,right,rightColor,align,size,badge,dashed})`, `rect`, `roundRect`, `line`, `path`, `arrow`, `text`, `dot`, `ring`, `pill`, `bar`, `send(pts|fn,{dur,color,fail,onArrive})` + `drawFlows(dt)` for moving request dots, `isoBox(cam,…)` for 3D view, `onPointer(fn)`, `hit()`. Lay out from `stage.w/stage.h` **every frame**. |
| `kit.stageEl` | the stage's host element (for sims that need their own DOM/WebGL inside the stage) |
| `kit.panel` | controls: `slider(label,{min,max,step,value|values,format,onInput,hint})`, `stepper`, `seg(label,{options:[[v,label]],value,onChange})`, `toggle`, `select`, `buttons([{label,kind,onClick}])`, `heading`, `note`, `custom(el)`. Each returns `{get,set(v,silent)}`. |
| `kit.metrics(defs)` / `kit.metric(key, text, tone)` | the number strip under the stage; tone `'' | 'good' | 'warn' | 'bad'` |
| `kit.chart({lines:[{key,label,color}], bars:{key,label,color}, format})` | 60-sample rolling chart; `.push(sample)` once per simulated second, `.reset()` |
| `kit.log(html)` / `kit.clearLog()` | “What just happened” events, newest first, stamped with sim time |
| `kit.loop(fn(dt))` | per-frame callback; `dt` = simulated seconds (0 while paused, scaled by ½×/1×/2×) |
| `kit.every(sec, fn)` | fixed-step timer on simulated time |
| `kit.time` / `kit.resetTime()` | simulated seconds since reset |
| `kit.enable3d(opts)` / `kit.is3d` / `kit.cam(scale)` | optional “3D view” toggle; when `kit.is3d`, draw with `stage.isoBox(kit.cam(), …)` |
| `kit.guided.observe(text)` | call when the guided run's key moment happens (moves the guided box to “explain”) |
| `kit.fmt(n)` | compact number formatting (1.2k, 3.4M) |
| `kit.onCleanup(fn)` | run on page leave |

Rules: never call `requestAnimationFrame` directly (use `kit.loop`), never hard-code colours (use `stage.colors` / CSS tokens), never throw on any control combination, and keep every number honest to the model you describe in the file's header comment.
The reference implementation is `../sims/load-balancing.js`.
