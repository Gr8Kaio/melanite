import es from './es';
import en from './en';

export type Lang = 'es' | 'en';
export type I18nKey = keyof typeof es;
type Dict = Record<string, string>;
const dicts: Record<Lang, Dict> = { es: { ...es }, en: { ...en } };
let lang: Lang = 'es';

export function setLanguage(l: Lang) { lang = l; document.documentElement.lang = l; }
export function getLanguage(): Lang { return lang; }

/**
 * Cada módulo registra sus propios textos (claves con prefijo del módulo,
 * ej. "search.placeholder") sin tocar es.ts/en.ts.
 */
export function registerStrings(strings: { es: Dict; en?: Dict }): void {
  Object.assign(dicts.es, strings.es);
  if (strings.en) Object.assign(dicts.en, strings.en);
}

/** t('file.untitled') · t('notice.exists', { name: 'x' }) — cae al español si falta la clave. */
export function t(key: I18nKey | (string & {}), vars?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? dicts.es[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
