// Learner progress for the Systems Lab, kept in localStorage.
import * as store from '../../js/core/store.js';

const KEY = 'systems:progress';
const blank = () => ({ v: 1, visited: {}, quiz: {}, fav: {}, days: {}, notes: {} });

function load() {
  const p = store.get(KEY, null);
  return p && p.v === 1 ? { ...blank(), ...p } : blank();
}
function save(p) { store.set(KEY, p); window.dispatchEvent(new CustomEvent('progresschange')); }

const today = () => new Date().toISOString().slice(0, 10);

export function visit(slug) {
  const p = load();
  p.visited[slug] = Date.now();
  p.days[today()] = true;
  save(p);
}
/** Record a quiz attempt: score of total. A topic is "done" once every question was right. */
export function recordQuiz(slug, score, total) {
  const p = load();
  const prev = p.quiz[slug] || { best: 0, total, attempts: 0 };
  p.quiz[slug] = { best: Math.max(prev.best, score), total, attempts: prev.attempts + 1, last: score };
  p.days[today()] = true;
  save(p);
}
export const isDone = slug => { const q = load().quiz[slug]; return !!q && q.best >= q.total; };
export const isVisited = slug => !!load().visited[slug];
export const doneCount = () => Object.values(load().quiz).filter(q => q.best >= q.total).length;
export const isFav = slug => !!load().fav[slug];
export function toggleFav(slug) { const p = load(); if (p.fav[slug]) delete p.fav[slug]; else p.fav[slug] = true; save(p); return !!p.fav[slug]; }
export const getNote = slug => load().notes[slug] || '';
export function setNote(slug, text) { const p = load(); if (text) p.notes[slug] = text; else delete p.notes[slug]; save(p); }
export const favourites = () => Object.keys(load().fav);

/** Consecutive days (ending today or yesterday) with any activity. */
export function streak() {
  const days = load().days;
  let n = 0;
  const d = new Date();
  if (!days[d.toISOString().slice(0, 10)]) d.setDate(d.getDate() - 1);
  while (days[d.toISOString().slice(0, 10)]) { n++; d.setDate(d.getDate() - 1); }
  return n;
}
export function resetAll() { save(blank()); }
