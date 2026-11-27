// localStorage wrapped so a blocked or full store never breaks the page.
const PREFIX = 'twinlabs:';

export function get(key, fallback = null) {
  try {
    const raw = localStorage.getItem(PREFIX + key);
    return raw == null ? fallback : JSON.parse(raw);
  } catch { return fallback; }
}

export function set(key, value) {
  try { localStorage.setItem(PREFIX + key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}

export function update(key, fn, fallback = null) {
  const next = fn(get(key, fallback));
  set(key, next);
  return next;
}
