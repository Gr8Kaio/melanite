import { describe, expect, it } from 'vitest';
import { parser } from '@lezer/markdown';
import { GFM } from '@lezer/markdown';
import { melaniteSyntax } from '../../src/app/editor/syntax';
import { pageStyle, renderHtml, splitFrontmatter } from '../../src/app/render/markdown';

const p = parser.configure([GFM, melaniteSyntax]);
function nodes(src: string): string[] {
  const out: string[] = [];
  p.parse(src).iterate({ enter: (n) => { out.push(`${n.name}:${src.slice(n.from, n.to)}`); } });
  return out;
}

describe('sintaxis del editor', () => {
  it('wikilinks y embeds', () => {
    expect(nodes('ver [[nota|alias]] y ![[img.png]]')).toEqual(expect.arrayContaining(['WikiLink:[[nota|alias]]', 'WikiTarget:nota|alias', 'Embed:![[img.png]]']));
  });
  it('math en línea respeta precios', () => {
    expect(nodes('$x^2$ cuesta $5 y $10')).toEqual(expect.arrayContaining(['InlineMath:$x^2$']));
    expect(nodes('cuesta $5 y $10').some((s) => s.startsWith('InlineMath'))).toBe(false);
  });
  it('bloques de math y frontmatter', () => {
    const src = '---\ntags: [a]\n---\ntexto\n\n$$\n\\begin{align*}a&=b\\end{align*}\n$$\n';
    const ns = nodes(src);
    expect(ns).toContain('Frontmatter:---\ntags: [a]\n---');
    expect(ns.some((s) => s.startsWith('BlockMath:$$\n\\begin'))).toBe(true);
  });
  it('tags, resaltado y comentarios', () => {
    const ns = nodes('un #tag/sub, ==ojo== y %% oculto %% pero no #123');
    expect(ns).toEqual(expect.arrayContaining(['Tag:#tag/sub', 'Highlight:==ojo==', 'Comment:%% oculto %%']));
    expect(ns).not.toContain('Tag:#123');
  });
});

describe('render de lectura', () => {
  it('wikilinks, embeds y tags', () => {
    const html = renderHtml('[[nota#h|alias]] ![[foto.png|200]] ![[otra]] #idea');
    expect(html).toContain('class="internal-link" data-href="nota#h"');
    expect(html).toContain('>alias</a>');
    expect(html).toContain('data-vault-src="foto.png" alt="foto.png" width="200"');
    expect(html).toContain('class="internal-embed markdown-embed" data-src="otra"');
    expect(html).toContain('class="tag" data-tag="idea"');
  });
  it('math en línea y en bloque (align*)', () => {
    const html = renderHtml('$a+b$\n\n$$\n\\begin{align*}x&=1\\end{align*}\n$$');
    expect(html).toContain('class="math math-inline" data-tex="a+b"');
    expect(html).toContain('class="math math-block" data-tex="\\begin{align*}x&amp;=1\\end{align*}"');
  });
  it('tareas con número de línea', () => {
    const html = renderHtml('- [ ] uno\n- [x] dos');
    expect(html).toContain('<input type="checkbox" class="task-list-item-checkbox" data-line="0">uno');
    expect(html).toContain('data-line="1" checked>dos');
  });
  it('resaltado, comentarios, footnotes, mermaid', () => {
    const html = renderHtml('==ojo== %%secreto%% nota[^1]\n\n[^1]: pie\n\n```mermaid\ngraph LR\n```');
    expect(html).toContain('<mark>ojo</mark>');
    expect(html).not.toContain('secreto');
    expect(html).toContain('footnote');
    expect(html).toContain('class="block-language-mermaid" data-code="graph LR');
  });
  it('separa frontmatter', () => {
    const r = splitFrontmatter('---\na: 1\n---\n# Hola');
    expect(r).toEqual({ yaml: 'a: 1', body: '# Hola', lineOffset: 3 });
  });
});

describe('tamaño de imágenes', () => {
  it('![alt|300](url) y ![[img|300x200]]', () => {
    expect(renderHtml('![gato|300](a.png)')).toContain('<img src="a.png" alt="gato" width="300" class="ml-align-center">');
    expect(renderHtml('![300x200](a.png)')).toContain('alt="" width="300" height="200"');
    expect(renderHtml('![gato|300|left](a.png)')).toContain('alt="gato" width="300" class="ml-align-left"');
    expect(renderHtml('![[a.png|right|300]]')).toContain('width="300" class="ml-align-right"');
    expect(renderHtml('![[a.png]]')).toContain('class="ml-align-center"');
    expect(renderHtml('![solo alt](a.png)')).toContain('alt="solo alt"');
    expect(renderHtml('![[a.png|300x200]]')).toContain('width="300" height="200"');
    expect(renderHtml('![[a.png|x200]]')).toContain('<img data-vault-src="a.png" alt="a.png" height="200" class');
    expect(renderHtml('![[a.png|x]]')).toContain('alt="x"');
  });
});

describe('líneas de origen en la vista previa', () => {
  it('ítems de lista y filas de tabla llevan data-line', () => {
    const html = renderHtml('- a\n- b\n\n| x |\n|---|\n| 1 |\n| 2 |');
    expect(html).toContain('<li data-line="1">');
    expect(html).toContain('<tr data-line="6">');
  });
});

describe('formato de hoja por nota (frontmatter)', () => {
  it('valores con y sin unidad', () => {
    expect(pageStyle({ fontsize: 10, margin: 20, lineheight: 1.2 }).vars).toEqual({ '--page-font-size': '10pt', '--page-margin': '20mm', '--page-line-height': '1.2' });
    expect(pageStyle({ fontsize: '12px', margin: '2cm' }).vars).toEqual({ '--page-font-size': '12px', '--page-margin': '2cm' });
    expect(pageStyle({ fontsize: '10,5pt' }).vars['--page-font-size']).toBe('10.5pt');
  });
  it('lo inválido se ignora', () => {
    expect(pageStyle({ fontsize: 'grande', margin: '20em', lineheight: 9, font: 'x; color: red' }).vars).toEqual({});
    expect(pageStyle(null).vars).toEqual({});
    expect(pageStyle('texto').vars).toEqual({});
  });
  it('fuente y números de página', () => {
    expect(pageStyle({ font: 'mono' }).vars['--page-font']).toBe('var(--font-monospace)');
    expect(pageStyle({ font: 'Cambria' }).vars['--page-font']).toBe('"Cambria", var(--font-text)');
    expect(pageStyle({ pagenumbers: false }).numbers).toBe(false);
    expect(pageStyle({ pagenumbers: 'si' }).numbers).toBeUndefined();
  });
});
