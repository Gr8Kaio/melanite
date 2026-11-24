import { describe, expect, it } from 'vitest';
import { EditorState } from '@codemirror/state';
import { CompletionContext } from '@codemirror/autocomplete';
import { ensureSyntaxTree } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { melaniteSyntax } from '../../src/app/editor/syntax';

const markdownExtension = markdown({ base: markdownLanguage, extensions: [melaniteSyntax] });
import { latexSource, openEnvironment, inMath } from '../../src/app/editor/latex-complete';
import { renderHtml } from '../../src/app/render/markdown';

/** `|` marca el cursor */
function complete(docWithCursor: string) {
  const pos = docWithCursor.indexOf('|');
  const doc = docWithCursor.replace('|', '');
  const state = EditorState.create({ doc, extensions: [markdownExtension] });
  ensureSyntaxTree(state, state.doc.length, 5000);
  return latexSource(new CompletionContext(state, pos, false));
}
const labels = (r: ReturnType<typeof complete>) => r?.options.map((o) => o.label) ?? [];

describe('sugerencias de LaTeX', () => {
  it('solo dentro de fórmulas', () => {
    // fuera de fórmulas solo se ofrecen \begin e \item
    expect(labels(complete('texto \\fr|'))).not.toContain('\\frac');
    expect(labels(complete('texto \\it|'))).toContain('\\item');
    expect(labels(complete('$\\fr|$'))).toContain('\\frac');
    expect(labels(complete('$$\n\\al|\n$$'))).toContain('\\alpha');
    // fórmula todavía sin cerrar
    expect(labels(complete('precio $\\sq|'))).toContain('\\sqrt');
  });

  it('\\begin{ sugiere entornos y cierra con \\end', () => {
    const r = complete('$$\n\\begin{al|\n$$')!;
    expect(r.from).toBe('$$\n\\begin{'.length);
    expect(labels(r)).toEqual(expect.arrayContaining(['align*', 'aligned', 'pmatrix', 'cases']));
  });

  it('no mete la llave de closeBrackets en el rango (CodeMirror filtra con ese texto)', () => {
    const r = complete('$$\n\\begin{|}\n$$')!;
    expect(r.to).toBeUndefined();
    expect(typeof r.options[0].apply).toBe('function'); // la llave se absorbe al aceptar
  });

  it('\\end{ sugiere primero el entorno abierto', () => {
    const r = complete('$$\n\\begin{pmatrix}\na & b\n\\end{|\n$$')!;
    expect(r.options[0].label).toBe('pmatrix');
    expect(r.options[0].detail).toMatch(/close environment|cerrar entorno/);
  });

  it('openEnvironment respeta anidamiento', () => {
    expect(openEnvironment('\\begin{align*} \\begin{cases} \\end{cases}')).toBe('align*');
    expect(openEnvironment('\\begin{a}\\end{a}')).toBeNull();
  });

  it('el salto de línea \\\\ no abre el menú', () => {
    expect(complete('$$\na \\\\|\n$$')).toBeNull();
  });

  it('fuera de fórmulas, \\begin{ ofrece listas y entornos de fórmula', () => {
    const r = complete('Notas\n\\begin{|');
    expect(labels(r).slice(0, 3)).toEqual(['itemize', 'enumerate', 'description']);
    expect(labels(r)).toContain('align*');
  });

  it('itemize/enumerate/description se renderizan como listas anidadas', () => {
    const html = renderHtml('\\begin{itemize}\n\\item uno $x^2$\n\\begin{enumerate}\n\\item a\n\\item b\n\\end{enumerate}\n\\item **dos**\n\\end{itemize}\n\n\\begin{description}\n\\item[Término] definición\n\\end{description}');
    expect(html).toContain('<ul><li>uno <span class="math math-inline" data-tex="x^2"></span><ol><li>a</li><li>b</li></ol></li><li><strong>dos</strong></li></ul>');
    expect(html).toContain('<dl><dt>Término</dt><dd>definición</dd></dl>');
  });

  it('inMath ignora el texto común', () => {
    const state = EditorState.create({ doc: 'hola mundo', extensions: [markdownExtension] });
    expect(inMath(state, 4)).toBe(false);
  });
});
