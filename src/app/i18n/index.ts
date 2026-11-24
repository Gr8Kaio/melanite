import es from './es';
import en from './en';

export type Lang = 'es' | 'en';
export type I18nKey = keyof typeof es;
const dicts: Record<Lang, Partial<Record<I18nKey, string>>> = { es, en };
let lang: Lang = 'es';

export function setLanguage(l: Lang) { lang = l; document.documentElement.lang = l; }
export function getLanguage(): Lang { return lang; }

/** t('file.untitled') · t('notice.renamed', { name: 'x' }) — cae al español si falta la clave. */
export function t(key: I18nKey, vars?: Record<string, string | number>): string {
  let s = dicts[lang][key] ?? es[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}
