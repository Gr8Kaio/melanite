/** Lógica pura del módulo mobile (sin DOM), para poder testearla. */

/** `#` cicla: sin encabezado → # → ## … → ###### → sin encabezado. */
export function cycleHeading(line: string): string {
  const m = /^(#{1,6}) (.*)$/.exec(line);
  if (!m) return `# ${line}`;
  return m[1].length >= 6 ? m[2] : `#${m[1]} ${m[2]}`;
}

/** Pone o saca la viñeta `- ` (también saca numeración o casilla de tarea). */
export function toggleList(line: string): string {
  const m = /^(\s*)(?:[-*+] (?:\[.\] )?|\d+[.)] )(.*)$/.exec(line);
  if (m) return m[1] + m[2];
  const indent = /^\s*/.exec(line)![0];
  return `${indent}- ${line.slice(indent.length)}`;
}

/**
 * Al soltar un drawer: ¿queda abierto? `open` = px abiertos (0..width),
 * `velocity` = px/ms en el sentido de abrir (negativo = cerrando).
 */
export function settleDrawer(open: number, width: number, velocity: number): boolean {
  if (Math.abs(velocity) > 0.3) return velocity > 0;
  return open > width / 2;
}
