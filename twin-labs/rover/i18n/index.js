// Rover Lab interface language. English is complete; other languages translate the interface chrome and
// fall back to English for anything they lack (including the build guide's long texts).

import EN from './en.js';

export const LANGS = [
  { code: 'en', chip: 'EN', native: 'English' },
  { code: 'es', chip: 'ES', native: 'Español' },
  { code: 'pt', chip: 'PT', native: 'Português' },
  { code: 'fr', chip: 'FR', native: 'Français' },
  { code: 'it', chip: 'IT', native: 'Italiano' },
  { code: 'de', chip: 'DE', native: 'Deutsch' },
  { code: 'nl', chip: 'NL', native: 'Nederlands' },
  { code: 'pl', chip: 'PL', native: 'Polski' },
  { code: 'tr', chip: 'TR', native: 'Türkçe' },
  { code: 'id', chip: 'ID', native: 'Bahasa Indonesia' },
  { code: 'vi', chip: 'VI', native: 'Tiếng Việt' },
  { code: 'el', chip: 'EL', native: 'Ελληνικά' },
  { code: 'uk', chip: 'UA', native: 'Українська' },
  { code: 'ru', chip: 'RU', native: 'Русский' },
  { code: 'zh-Hans', chip: '简', native: '简体中文' },
  { code: 'zh-Hant', chip: '繁', native: '繁體中文' },
  { code: 'ja', chip: 'JA', native: '日本語' },
  { code: 'ko', chip: 'KO', native: '한국어' },
  { code: 'hi', chip: 'HI', native: 'हिन्दी' },
  { code: 'ar', chip: 'AR', native: 'العربية', dir: 'rtl' },
  { code: 'he', chip: 'HE', native: 'עברית', dir: 'rtl' },
];

// Languages with a translation file in this folder.
export const TRANSLATED = new Set(['en', 'es', 'de', 'fr']);

let lang = 'en';
let dict = EN;

export const currentLang = () => lang;
export const langInfo = code => LANGS.find(l => l.code === code) || LANGS[0];

/** Load a language; unknown or untranslated codes fall back to English. */
export async function setLang(code) {
  const info = langInfo(code);
  lang = info.code;
  if (lang === 'en' || !TRANSLATED.has(lang)) { dict = EN; return lang; }
  try {
    const mod = await import(`./${lang}.js`);
    dict = { ...EN, ...mod.default };
  } catch { dict = EN; }
  return lang;
}

/** Translate a key, filling {name} placeholders. */
export function t(key, vars) {
  let s = dict[key] ?? EN[key] ?? key;
  if (vars) s = s.replace(/\{(\w+)\}/g, (m, k) => (vars[k] ?? m));
  return s;
}

/** Pick the browser's preferred language from those offered. */
export function preferredLang() {
  const list = navigator.languages?.length ? navigator.languages : [navigator.language || 'en'];
  for (const l of list) {
    const low = String(l).toLowerCase();
    if (low.startsWith('zh')) return /tw|hk|hant/.test(low) ? 'zh-Hant' : 'zh-Hans';
    const hit = LANGS.find(x => x.code.toLowerCase() === low.split('-')[0]);
    if (hit) return hit.code;
  }
  return 'en';
}
