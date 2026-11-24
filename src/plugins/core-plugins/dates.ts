/** Formateo de fechas estilo moment, chico y en español (sin dependencias). Puro: se testea en node. */

const MONTHS = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const DAYS = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
const pad = (n: number, w = 2) => String(n).padStart(w, '0');

const TOKENS = /\[([^\]]*)\]|YYYY|YY|MMMM|MMM|MM|M|DD|D|dddd|ddd|HH|H|mm|m|ss/g;

/**
 * Tokens: YYYY YY · MMMM (enero) MMM (ene) MM M · DD D · dddd (lunes) ddd (lun) · HH H · mm m · ss.
 * Texto literal entre corchetes: `[semana] YYYY`.
 */
export function formatDate(d: Date, fmt: string): string {
  return fmt.replace(TOKENS, (tok, lit: string | undefined) => {
    if (lit !== undefined) return lit;
    switch (tok) {
      case 'YYYY': return String(d.getFullYear());
      case 'YY': return pad(d.getFullYear() % 100);
      case 'MMMM': return MONTHS[d.getMonth()];
      case 'MMM': return MONTHS[d.getMonth()].slice(0, 3);
      case 'MM': return pad(d.getMonth() + 1);
      case 'M': return String(d.getMonth() + 1);
      case 'DD': return pad(d.getDate());
      case 'D': return String(d.getDate());
      case 'dddd': return DAYS[d.getDay()];
      case 'ddd': return DAYS[d.getDay()].slice(0, 3);
      case 'HH': return pad(d.getHours());
      case 'H': return String(d.getHours());
      case 'mm': return pad(d.getMinutes());
      case 'm': return String(d.getMinutes());
      case 'ss': return pad(d.getSeconds());
      default: return tok;
    }
  });
}

export interface TemplateVars { title: string; date?: Date; dateFormat?: string; timeFormat?: string }

/** Reemplaza {{title}}, {{date}}, {{time}}, {{date:FORMATO}} y {{time:FORMATO}}. */
export function applyTemplate(text: string, v: TemplateVars): string {
  const date = v.date ?? new Date();
  return text.replace(/\{\{\s*(title|date|time)\s*(?::([^}]*))?\}\}/gi, (_m, name: string, fmt: string | undefined) => {
    const n = name.toLowerCase();
    if (n === 'title') return v.title;
    const f = fmt?.trim() || (n === 'date' ? v.dateFormat ?? 'YYYY-MM-DD' : v.timeFormat ?? 'HH:mm');
    return formatDate(date, f);
  });
}
