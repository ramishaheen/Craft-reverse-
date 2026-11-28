// Runs the workbench model off the page's main thread so long runs never freeze the page.
import { simulate, sweep, calibrate } from './engine.js';

self.onmessage = ({ data }) => {
  const { id, kind, doc, opts = {} } = data || {};
  const progress = (a, b) => self.postMessage({ id, progress: [a, b] });
  try {
    if (kind === 'sweep') return self.postMessage({ id, result: sweep(doc, opts.key, opts.values, { onStep: progress }) });
    if (kind === 'calibrate') return self.postMessage({ id, result: calibrate(doc, opts.period, opts.ids, opts.check, { onStep: progress }) });
    self.postMessage({ id, result: simulate(doc, opts) });
  } catch (err) {
    self.postMessage({ id, error: String(err?.message || err) });
  }
};
