export interface FuzzyMatch { score: number; matches: [number, number][] }

/**
 * Búsqueda difusa estilo Obsidian: las letras de la consulta tienen que aparecer
 * en orden. Puntúa más las coincidencias seguidas, al inicio de palabra y al principio.
 * Ignora mayúsculas, tildes y espacios de la consulta.
 */
export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = fold(query).replace(/\s+/g, '');
  if (!q) return { score: 0, matches: [] };
  const s = fold(text);
  const matches: [number, number][] = [];
  let score = 0, qi = 0, prev = -2;
  for (let i = 0; i < s.length && qi < q.length; i++) {
    if (s[i] !== q[qi]) continue;
    const wordStart = i === 0 || /[\s/_\-.(]/.test(s[i - 1]) || (text[i] !== s[i] && text[i] === text[i].toUpperCase() && text[i - 1] !== text[i - 1].toUpperCase());
    score += 1 + (i === prev + 1 ? 3 : 0) + (wordStart ? 2 : 0) - i * 0.01;
    if (i === prev + 1 && matches.length) matches[matches.length - 1][1] = i + 1;
    else matches.push([i, i + 1]);
    prev = i;
    qi++;
  }
  if (qi < q.length) return null;
  // contiene la consulta entera: bien arriba; textos cortos primero
  const at = s.indexOf(q);
  if (at >= 0) score += 10 + (at === 0 ? 5 : 0);
  return { score: score - s.length * 0.02, matches };
}

/** Minúsculas y sin tildes, conservando la longitud (para que los índices coincidan). */
function fold(s: string): string {
  let out = '';
  for (const ch of s.toLowerCase()) {
    const base = ch.normalize('NFD')[0];
    out += ch.length === 1 && base.length === 1 ? base : ch;
  }
  return out;
}
