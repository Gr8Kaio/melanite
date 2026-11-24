import { stringifyYaml } from '../../core/yaml';

const FM_RE = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/;

/** Reemplaza (o agrega, o quita si queda vacío) el frontmatter sin tocar el resto de la nota. */
export function setFrontmatter(text: string, data: Record<string, unknown>): string {
  const m = FM_RE.exec(text);
  const body = m ? text.slice(m[0].length) : text;
  if (!Object.keys(data).length) return body;
  return `---\n${stringifyYaml(data).replace(/\n$/, '')}\n---\n${body}`;
}

export type PropertyType = 'text' | 'number' | 'checkbox' | 'date' | 'datetime' | 'list';

/** Tipo a mostrar según el valor (y el nombre: tags/aliases siempre son listas). */
export function propertyType(key: string, value: unknown): PropertyType {
  if (/^(tags?|aliases|alias|cssclasses)$/.test(key) || Array.isArray(value)) return 'list';
  if (typeof value === 'boolean') return 'checkbox';
  if (typeof value === 'number') return 'number';
  if (value instanceof Date) return value.getUTCHours() || value.getUTCMinutes() ? 'datetime' : 'date';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) return 'date';
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(value)) return 'datetime';
  return 'text';
}

/** Valor vacío para una propiedad nueva de ese tipo. */
export function emptyValue(type: PropertyType): unknown {
  return { text: '', number: 0, checkbox: false, date: new Date().toISOString().slice(0, 10), datetime: new Date().toISOString().slice(0, 16), list: [] }[type];
}
