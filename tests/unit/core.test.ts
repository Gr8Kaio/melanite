import 'fake-indexeddb/auto';
import { describe, expect, it, beforeEach } from 'vitest';
import { MelaniteDB } from '../../src/core/db';
import { Vault, TFile, TFolder } from '../../src/core/vault';
import { normalizePath } from '../../src/core/path';
import { parseWikilink, resolveLinkpath, wikilinkDisplay } from '../../src/core/links';

let n = 0;
async function freshVault() {
  return Vault.open(new MelaniteDB(`test-${++n}`));
}

describe('path', () => {
  it('normaliza', () => {
    expect(normalizePath('/a//b\\c/./d/')).toBe('a/b/c/d');
    expect(normalizePath('')).toBe('');
  });
});

describe('wikilinks', () => {
  it('parsea destino, subpath y alias', () => {
    expect(parseWikilink('nota#Encabezado|alias')).toEqual({ path: 'nota', subpath: '#Encabezado', alias: 'alias' });
    expect(parseWikilink('carpeta/nota')).toEqual({ path: 'carpeta/nota', subpath: '', alias: '' });
    expect(parseWikilink('#^bloque')).toEqual({ path: '', subpath: '#^bloque', alias: '' });
    expect(wikilinkDisplay('nota|otro texto')).toBe('otro texto');
    expect(wikilinkDisplay('nota#h')).toBe('nota > h');
  });
});

describe('vault', () => {
  let v: Vault;
  beforeEach(async () => { v = await freshVault(); });

  it('crea archivos con sus carpetas y persiste', async () => {
    await v.create('a/b/nota.md', 'hola');
    expect(v.getAbstractFileByPath('a/b')).toBeInstanceOf(TFolder);
    const again = await Vault.open(v.db);
    const f = again.getFileByPath('a/b/nota.md')!;
    expect(f).toBeInstanceOf(TFile);
    expect(await again.read(f)).toBe('hola');
    expect(f.parent?.path).toBe('a/b');
  });

  it('no deja crear duplicados', async () => {
    await v.create('x.md', '');
    await expect(v.create('x.md', '')).rejects.toThrow();
  });

  it('renombra carpetas con todo su contenido', async () => {
    await v.create('a/uno.md', '1');
    await v.create('a/sub/dos.md', '2');
    const events: string[] = [];
    v.on('rename', (_f, old: string) => events.push(old));
    await v.rename(v.getFolderByPath('a')!, 'b/a2');
    expect(v.getFileByPath('b/a2/uno.md')).toBeTruthy();
    expect(v.getFileByPath('b/a2/sub/dos.md')).toBeTruthy();
    expect(v.getAbstractFileByPath('a')).toBeNull();
    expect(events).toEqual(['a']);
    const again = await Vault.open(v.db);
    expect(await again.read(again.getFileByPath('b/a2/sub/dos.md')!)).toBe('2');
  });

  it('no mueve una carpeta dentro de sí misma', async () => {
    await v.createFolder('a/b');
    await expect(v.rename(v.getFolderByPath('a')!, 'a/b/c')).rejects.toThrow();
  });

  it('papelera y borrado definitivo', async () => {
    const f = await v.create('nota.md', 'x');
    await v.trash(f);
    expect(f.path).toBe('.trash/nota.md');
    await v.trash(f);
    expect(v.getAbstractFileByPath('.trash/nota.md')).toBeNull();
    expect(await v.db.files.where('path').equals('.trash/nota.md').count()).toBe(0);
  });

  it('binarios', async () => {
    const data = new Uint8Array([1, 2, 3]).buffer;
    const f = await v.createBinary('img/a.png', data);
    expect(new Uint8Array(await v.readBinary(f))).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('getAvailablePath numera', async () => {
    await v.create('Sin título.md', '');
    expect(v.getAvailablePath('Sin título', 'md')).toBe('Sin título 1.md');
  });

  it('resuelve links como Obsidian', async () => {
    const a = await v.create('proyectos/Idea.md', '');
    const b = await v.create('archivo/viejo/Idea.md', '');
    const img = await v.create('adjuntos/foto.png', '');
    expect(resolveLinkpath(v, 'Idea')).toBe(a); // ruta más corta
    expect(resolveLinkpath(v, 'viejo/Idea')).toBe(b);
    expect(resolveLinkpath(v, 'idea')).toBe(a); // sin distinguir mayúsculas
    expect(resolveLinkpath(v, 'foto.png')).toBe(img);
    expect(resolveLinkpath(v, 'Idea', 'archivo/viejo/otra.md')).toBe(b); // relativo a la nota
    expect(resolveLinkpath(v, 'no existe')).toBeNull();
  });
});
