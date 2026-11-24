/**
 * Consultas de búsqueda estilo Obsidian (puro, sin DOM):
 *   palabras (AND), "frase exacta", -excluir, a OR b, (grupos),
 *   tag:#x, path:carpeta, file:nombre, line:(a b)
 * Todo sin distinguir mayúsculas.
 */
export type Query =
  | { type: 'and' | 'or'; items: Query[] }
  | { type: 'not'; item: Query }
  | { type: 'text'; value: string }
  | { type: 'tag' | 'path' | 'file'; value: string }
  | { type: 'line'; item: Query };

export interface SearchTarget {
  path: string;
  /** nombre sin extensión */
  name: string;
  /** contenido completo */
  text: string;
  /** tags de la nota, con "#" */
  tags: string[];
  /** @internal texto en minúsculas (se calcula solo) */
  lower?: string;
}

const OPS = ['tag', 'path', 'file', 'line'] as const;

/** Devuelve null si la consulta está vacía. */
export function parseQuery(input: string): Query | null {
  let i = 0;
  const s = input;
  const ws = () => { while (i < s.length && /\s/.test(s[i])) i++; };

  const word = (): string => {
    if (s[i] === '"') {
      const end = s.indexOf('"', i + 1);
      const v = s.slice(i + 1, end < 0 ? s.length : end);
      i = end < 0 ? s.length : end + 1;
      return v;
    }
    const start = i;
    while (i < s.length && !/[\s()]/.test(s[i])) i++;
    return s.slice(start, i);
  };

  const atom = (): Query | null => {
    ws();
    if (i >= s.length || s[i] === ')') return null;
    if (s[i] === '-' && i + 1 < s.length && !/\s/.test(s[i + 1])) {
      i++;
      const inner = atom();
      return inner ? { type: 'not', item: inner } : null;
    }
    if (s[i] === '(') {
      i++;
      const inner = or();
      if (s[i] === ')') i++;
      return inner;
    }
    const m = /^([a-z]+):/i.exec(s.slice(i));
    const op = m && (OPS as readonly string[]).includes(m[1].toLowerCase()) ? (m[1].toLowerCase() as (typeof OPS)[number]) : null;
    if (op) {
      i += m![0].length;
      if (op === 'line') {
        let inner: Query | null;
        if (s[i] === '(') { i++; inner = or(); if (s[i] === ')') i++; } else inner = atom();
        return inner ? { type: 'line', item: inner } : null;
      }
      const v = word().toLowerCase();
      return v ? { type: op, value: op === 'tag' ? v.replace(/^#/, '') : v } : null;
    }
    const quoted = s[i] === '"';
    const v = word();
    if (!v) { if (!quoted) i++; return null; }
    return { type: 'text', value: v.toLowerCase() };
  };

  const and = (): Query | null => {
    const items: Query[] = [];
    for (;;) {
      ws();
      if (i >= s.length || s[i] === ')') break;
      if (/^OR(\s|$)/.test(s.slice(i)) && items.length) break;
      const a = atom();
      if (a) items.push(a);
    }
    return items.length === 0 ? null : items.length === 1 ? items[0] : { type: 'and', items };
  };

  function or(): Query | null {
    const items: Query[] = [];
    for (;;) {
      const a = and();
      if (a) items.push(a);
      ws();
      if (/^OR(\s|$)/.test(s.slice(i))) { i += 2; continue; }
      break;
    }
    return items.length === 0 ? null : items.length === 1 ? items[0] : { type: 'or', items };
  }

  const parts: Query[] = [];
  while (i < s.length) {
    const q = or();
    if (q) parts.push(q);
    if (s[i] === ')') i++; // paréntesis sueltos
    else if (!q) break;
  }
  return parts.length === 0 ? null : parts.length === 1 ? parts[0] : { type: 'and', items: parts };
}

const tagMatches = (tags: string[], want: string) =>
  tags.some((t) => { const x = t.toLowerCase().replace(/^#/, ''); return x === want || x.startsWith(want + '/'); });

/** ¿La nota cumple la consulta? Dentro de line:(…) las palabras se buscan en `line`. */
export function matches(q: Query, target: SearchTarget, line: string | null = null): boolean {
  switch (q.type) {
    case 'and': return q.items.every((x) => matches(x, target, line));
    case 'or': return q.items.some((x) => matches(x, target, line));
    case 'not': return !matches(q.item, target, line);
    case 'text':
      if (line !== null) return line.includes(q.value);
      return (target.lower ??= target.text.toLowerCase()).includes(q.value) || target.name.toLowerCase().includes(q.value);
    case 'tag': return tagMatches(target.tags, q.value);
    case 'path': return target.path.toLowerCase().includes(q.value);
    case 'file': return target.path.toLowerCase().split('/').pop()!.includes(q.value);
    case 'line': return (target.lower ??= target.text.toLowerCase()).split('\n').some((l) => matches(q.item, target, l));
  }
}

/** Palabras a resaltar (las que no están negadas). */
export function highlightTerms(q: Query | null, neg = false): string[] {
  if (!q) return [];
  switch (q.type) {
    case 'and': case 'or': return q.items.flatMap((x) => highlightTerms(x, neg));
    case 'not': return highlightTerms(q.item, !neg);
    case 'line': return highlightTerms(q.item, neg);
    case 'text': return neg ? [] : [q.value];
    default: return [];
  }
}

export interface LineMatch { line: number; text: string; ranges: [number, number][] }

/** Líneas que contienen alguna de las palabras, con los tramos a resaltar. */
export function findMatches(text: string, terms: string[], max = 20): LineMatch[] {
  if (!terms.length) return [];
  const out: LineMatch[] = [];
  const lines = text.split('\n');
  for (let n = 0; n < lines.length && out.length < max; n++) {
    const lower = lines[n].toLowerCase();
    const ranges: [number, number][] = [];
    for (const term of terms) {
      for (let at = lower.indexOf(term); at >= 0 && term; at = lower.indexOf(term, at + term.length)) ranges.push([at, at + term.length]);
    }
    if (!ranges.length) continue;
    ranges.sort((a, b) => a[0] - b[0]);
    const merged: [number, number][] = [];
    for (const r of ranges) {
      const last = merged[merged.length - 1];
      if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1]); else merged.push([...r]);
    }
    out.push({ line: n, text: lines[n], ranges: merged });
  }
  return out;
}
