import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { MelaniteDB } from '../../src/core/db';
import { Vault } from '../../src/core/vault';
import { MetadataCache, getAllTags, getAliases, parseMetadata } from '../../src/core/metadata';
import { renameWithLinks, shortestLinktext } from '../../src/app/links/link-updater';
import { findMatches, highlightTerms, matches, parseQuery, type SearchTarget } from '../../src/app/links/search-query';
import { setFrontmatter, propertyType } from '../../src/app/links/frontmatter';
import { fuzzyMatch } from '../../src/app/links/fuzzy';

let n = 0;
const freshVault = () => Vault.open(new MelaniteDB(`links-${++n}`));
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const read = (v: Vault, p: string) => v.cachedReadSync(v.getFileByPath(p)!);

describe('parseMetadata', () => {
  const text = [
    '---',
    'tags: [proyecto, idea/nueva]',
    'aliases: Otro nombre',
    'fecha: 2026-01-02',
    '---',
    '# Título',
    'Texto con [[Nota A]] y [[B#Sección|alias]] y ![[img.png|300]] #tag1 y [md](carpeta/C%20D.md#h).',
    '`[[en código]]` %%[[comentado]] #nocuenta%% http://x.com/#ancla',
    '```',
    '[[dentro de fence]] #nada',
    '```',
    '## Sub ##',
    '- [ ] tarea ^bloque1',
    '  - hijo',
    '- [x] hecha',
    '',
    'párrafo con id ^p-2',
  ].join('\n');
  const c = parseMetadata(text);

  it('frontmatter y su posición', () => {
    expect(c.frontmatter).toEqual({ tags: ['proyecto', 'idea/nueva'], aliases: 'Otro nombre', fecha: '2026-01-02' });
    expect(c.frontmatterPosition!.start.offset).toBe(0);
    expect(c.frontmatterPosition!.end.line).toBe(4);
    expect(getAliases(c)).toEqual(['Otro nombre']);
  });

  it('links, embeds y links markdown; ignora código y comentarios', () => {
    expect(c.links!.map((l) => [l.link, l.displayText])).toEqual([['Nota A', 'Nota A'], ['B#Sección', 'alias'], ['carpeta/C D.md#h', 'md']]);
    expect(c.embeds!.map((l) => l.link)).toEqual(['img.png']);
    const a = c.links![0];
    expect(text.slice(a.position.start.offset, a.position.end.offset)).toBe('[[Nota A]]');
    expect(a.position.start.line).toBe(6);
  });

  it('tags inline y del frontmatter', () => {
    expect(c.tags!.map((t) => t.tag)).toEqual(['#tag1']);
    expect(getAllTags(c)).toEqual(['#proyecto', '#idea/nueva', '#tag1']);
  });

  it('encabezados, bloques, listas y secciones', () => {
    expect(c.headings!.map((h) => [h.heading, h.level])).toEqual([['Título', 1], ['Sub', 2]]);
    expect(Object.keys(c.blocks!)).toEqual(['bloque1', 'p-2']);
    expect(c.listItems!.map((l) => [l.position.start.line, l.parent, l.task])).toEqual([[12, -12, ' '], [13, 12, undefined], [14, -12, 'x']]);
    expect(c.sections!.map((s) => s.type)).toEqual(['yaml', 'heading', 'paragraph', 'code', 'heading', 'list', 'paragraph']);
    expect(c.sections![6].id).toBe('p-2');
  });
});

describe('MetadataCache', () => {
  let v: Vault;
  let mc: MetadataCache;
  beforeEach(async () => {
    v = await freshVault();
    await v.create('a.md', 'link a [[b]] y [[falta]] #x');
    await v.create('dir/b.md', '# B\n#x #y/z');
    mc = new MetadataCache(v);
    mc.initialize();
  });

  it('indexa al arrancar y resuelve links', () => {
    expect(mc.resolvedLinks['a.md']).toEqual({ 'dir/b.md': 1 });
    expect(mc.unresolvedLinks['a.md']).toEqual({ falta: 1 });
    expect(mc.getTags()).toEqual({ '#x': 2, '#y/z': 1 });
    expect(Object.keys(mc.getBacklinksForFile(v.getFileByPath('dir/b.md')!))).toEqual(['a.md']);
  });

  it('se actualiza con create, modify, rename y delete', async () => {
    const events: string[] = [];
    mc.on('changed', (f) => events.push(`changed:${f.path}`));
    mc.on('deleted', (f) => events.push(`deleted:${f.path}`));
    await v.create('falta.md', '');
    await wait(80);
    expect(mc.resolvedLinks['a.md']).toEqual({ 'dir/b.md': 1, 'falta.md': 1 });
    await v.modify(v.getFileByPath('a.md')!, 'ahora [[dir/b]] [[dir/b]]');
    // getFileCache reindexa al toque aunque el debounce no haya corrido
    expect(mc.getFileCache(v.getFileByPath('a.md')!)!.links!.length).toBe(2);
    await wait(300);
    expect(mc.resolvedLinks['a.md']).toEqual({ 'dir/b.md': 2 });
    await v.rename(v.getFolderByPath('dir')!, 'otra');
    await wait(80);
    expect(mc.resolvedLinks['a.md']).toEqual({});
    expect(mc.unresolvedLinks['a.md']).toEqual({ 'dir/b': 2 });
    await v.delete(v.getFileByPath('otra/b.md')!);
    await wait(80);
    expect(events).toContain('deleted:otra/b.md');
    expect(mc.getTags()).toEqual({});
  });
});

describe('renombrar actualiza links', () => {
  let v: Vault;
  beforeEach(async () => { v = await freshVault(); });

  it('wikilinks con alias, subpath y embeds', async () => {
    await v.create('Vieja.md', '# H\ntexto');
    await v.create('otra.md', 'Ver [[Vieja]], [[Vieja#H|el alias]], [[vieja#^b]] y ![[Vieja]] y [[No toca]].');
    await renameWithLinks(v, v.getFileByPath('Vieja.md')!, 'Nueva.md');
    expect(read(v, 'otra.md')).toBe('Ver [[Nueva]], [[Nueva#H|el alias]], [[Nueva#^b]] y ![[Nueva]] y [[No toca]].');
  });

  it('elige el linktext más corto que resuelve (y desambigua con la ruta)', async () => {
    await v.create('a/nota.md', '');
    await v.create('b/x.md', '');
    await v.create('src.md', '[[nota]] [[a/nota]]');
    // mover a/nota → c/x: "x" ya existe en b/, entonces hace falta "c/x"
    await renameWithLinks(v, v.getFileByPath('a/nota.md')!, 'c/x.md');
    expect(read(v, 'src.md')).toBe('[[c/x]] [[c/x]]');
    // empate de largo: 'x' resuelve a b/x (el primero), así que b/x queda con el nombre corto
    expect(shortestLinktext(v, v.getFileByPath('b/x.md')!, 'src.md')).toBe('x');
  });

  it('links markdown y adjuntos', async () => {
    await v.create('Mi Nota.md', '');
    await v.createBinary('img/foto.png', new ArrayBuffer(4));
    await v.create('src.md', '[t](Mi%20Nota.md#sec) [t2](<Mi Nota.md>) ![](img/foto.png) ![[foto.png|200]]');
    await renameWithLinks(v, v.getFileByPath('Mi Nota.md')!, 'Otra Nota.md');
    await renameWithLinks(v, v.getFileByPath('img/foto.png')!, 'img/perro.png');
    expect(read(v, 'src.md')).toBe('[t](Otra%20Nota.md#sec) [t2](<Otra Nota.md>) ![](perro.png) ![[perro.png|200]]');
  });

  it('carpetas renombradas y links relativos de las notas movidas', async () => {
    await v.create('proyectos/plan.md', 'ver [a](../raiz.md) y [[proyectos/tareas]]');
    await v.create('proyectos/tareas.md', '');
    await v.create('raiz.md', '[[proyectos/plan|Plan]] y [p](proyectos/plan.md)');
    await renameWithLinks(v, v.getFolderByPath('proyectos')!, 'archivo/2026');
    expect(read(v, 'raiz.md')).toBe('[[plan|Plan]] y [p](plan.md)');
    expect(read(v, 'archivo/2026/plan.md')).toBe('ver [a](../raiz.md) y [[tareas]]'.replace('../raiz.md', 'raiz.md'));
  });

  it('no toca links que siguen resolviendo', async () => {
    await v.create('x.md', '');
    await v.create('src.md', '[[x]]');
    const r = await renameWithLinks(v, v.getFileByPath('x.md')!, 'sub/x.md');
    expect(r.links).toBe(0);
    expect(read(v, 'src.md')).toBe('[[x]]');
  });
});

describe('búsqueda', () => {
  const note = (text: string, extra: Partial<SearchTarget> = {}): SearchTarget => ({ path: 'carpeta/Nota.md', name: 'Nota', text, tags: [], ...extra });
  const q = (s: string) => parseQuery(s)!;

  it('parsea términos, frases, exclusiones, OR y operadores', () => {
    expect(parseQuery('')).toBeNull();
    expect(q('hola mundo')).toEqual({ type: 'and', items: [{ type: 'text', value: 'hola' }, { type: 'text', value: 'mundo' }] });
    expect(q('"frase exacta" -no')).toEqual({ type: 'and', items: [{ type: 'text', value: 'frase exacta' }, { type: 'not', item: { type: 'text', value: 'no' } }] });
    expect(q('a OR b c')).toEqual({ type: 'or', items: [{ type: 'text', value: 'a' }, { type: 'and', items: [{ type: 'text', value: 'b' }, { type: 'text', value: 'c' }] }] });
    expect(q('tag:#Idea path:carpeta file:"mi nota"')).toEqual({ type: 'and', items: [{ type: 'tag', value: 'idea' }, { type: 'path', value: 'carpeta' }, { type: 'file', value: 'mi nota' }] });
    expect(q('line:(uno dos)')).toEqual({ type: 'line', item: { type: 'and', items: [{ type: 'text', value: 'uno' }, { type: 'text', value: 'dos' }] } });
    expect(q('(a OR b) -(c)')).toEqual({ type: 'and', items: [{ type: 'or', items: [{ type: 'text', value: 'a' }, { type: 'text', value: 'b' }] }, { type: 'not', item: { type: 'text', value: 'c' } }] });
  });

  it('evalúa contra una nota', () => {
    const n1 = note('Hola mundo\nuno\ndos', { tags: ['#idea/nueva'] });
    expect(matches(q('hola MUNDO'), n1)).toBe(true);
    expect(matches(q('"mundo uno"'), n1)).toBe(false);
    expect(matches(q('hola -dos'), n1)).toBe(false);
    expect(matches(q('xyz OR uno'), n1)).toBe(true);
    expect(matches(q('tag:idea'), n1)).toBe(true);
    expect(matches(q('tag:#ide'), n1)).toBe(false);
    expect(matches(q('path:carpeta file:nota'), n1)).toBe(true);
    expect(matches(q('line:(uno dos)'), n1)).toBe(false);
    expect(matches(q('line:(hola mundo)'), n1)).toBe(true);
    expect(matches(q('nota'), n1)).toBe(true); // el nombre también cuenta
  });

  it('resalta las coincidencias', () => {
    expect(highlightTerms(q('a -b "c d" line:(e)'))).toEqual(['a', 'c d', 'e']);
    expect(findMatches('xx Hola\nnada\nhola hola', ['hola'])).toEqual([
      { line: 0, text: 'xx Hola', ranges: [[3, 7]] },
      { line: 2, text: 'hola hola', ranges: [[0, 4], [5, 9]] },
    ]);
  });
});

describe('frontmatter y fuzzy', () => {
  it('reemplaza, agrega y quita el frontmatter sin tocar el cuerpo', () => {
    expect(setFrontmatter('---\na: 1\n---\ncuerpo', { a: 2, b: [1] })).toBe('---\na: 2\nb:\n  - 1\n---\ncuerpo');
    expect(setFrontmatter('cuerpo', { x: true })).toBe('---\nx: true\n---\ncuerpo');
    expect(setFrontmatter('---\na: 1\n---\ncuerpo', {})).toBe('cuerpo');
    expect(propertyType('tags', 'a')).toBe('list');
    expect(propertyType('fecha', '2026-01-02')).toBe('date');
    expect(propertyType('n', 3)).toBe('number');
  });

  it('fuzzy en orden, sin tildes, prefiere coincidencias seguidas', () => {
    expect(fuzzyMatch('nvn', 'Nueva nota')).not.toBeNull();
    expect(fuzzyMatch('xyz', 'Nueva nota')).toBeNull();
    expect(fuzzyMatch('cancion', 'Canción')!.matches).toEqual([[0, 7]]);
    expect(fuzzyMatch('nota', 'Nota')!.score).toBeGreaterThan(fuzzyMatch('nota', 'Nueva otra cosa larga')?.score ?? -Infinity);
  });
});
