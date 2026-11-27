import { describe, expect, it } from 'vitest';
import { placeName, renameInOrder, sortEntries } from '../../src/app/views/explorer-order';

const e = (name: string, isFolder = false) => ({ name, isFolder });
const names = (xs: { name: string }[]) => xs.map((x) => x.name);

describe('orden manual del explorador', () => {
  it('sin orden: carpetas primero y alfabético (con números naturales)', () => {
    expect(names(sortEntries([e('b.md'), e('Tema 10'), e('a.md'), e('Tema 2', true)], undefined))).toEqual(['Tema 2', 'a.md', 'b.md', 'Tema 10']);
  });
  it('con orden: primero lo guardado, después lo nuevo en orden por defecto; lo que ya no existe se ignora', () => {
    const r = sortEntries([e('a.md'), e('b.md'), e('c.md'), e('Carpeta', true), e('nueva.md')], ['c.md', 'borrada.md', 'a.md', 'b.md']);
    expect(names(r)).toEqual(['c.md', 'a.md', 'b.md', 'Carpeta', 'nueva.md']);
  });
  it('placeName: antes o después del destino', () => {
    expect(placeName(['a', 'b', 'c'], 'c', 'a', false)).toEqual(['c', 'a', 'b']);
    expect(placeName(['a', 'b', 'c'], 'a', 'c', true)).toEqual(['b', 'c', 'a']);
    expect(placeName(['a', 'b'], 'x', 'b', false)).toEqual(['a', 'x', 'b']); // llega de otra carpeta
  });
  it('renombrar en la misma carpeta conserva el lugar; mover lo saca; las subcarpetas cambian de clave', () => {
    const order = { '': ['Fisica', 'b.md', 'a.md'], Fisica: ['x.md', 'y.md'], 'Fisica/Sub': ['z.md'] };
    expect(renameInOrder(order, 'b.md', 'b2.md')).toEqual({ ...order, '': ['Fisica', 'b2.md', 'a.md'] });
    expect(renameInOrder(order, 'a.md', 'Fisica/a.md')).toEqual({ ...order, '': ['Fisica', 'b.md'] });
    expect(renameInOrder(order, 'Fisica', 'Física I')).toEqual({ '': ['Física I', 'b.md', 'a.md'], 'Física I': ['x.md', 'y.md'], 'Física I/Sub': ['z.md'] });
    expect(renameInOrder(order, 'otra.md', 'otra2.md')).toBeNull();
  });
});
