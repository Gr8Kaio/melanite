/**
 * Orden manual del explorador: `{ [rutaDeCarpeta]: nombres en orden }` en `.melanite/explorer-order.json` (se sincroniza).
 * Lo que no está en la lista va después, con el orden por defecto (carpetas primero, alfabético).
 */
export type ExplorerOrder = Record<string, string[]>;

export interface Entry { name: string; isFolder: boolean }

const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });

export function sortEntries<T extends Entry>(entries: T[], order: string[] | undefined): T[] {
  const byDefault = entries.slice().sort((a, b) => (a.isFolder ? 0 : 1) - (b.isFolder ? 0 : 1) || coll.compare(a.name, b.name));
  if (!order?.length) return byDefault;
  const idx = new Map(order.map((n, i) => [n, i]));
  const rank = (e: T) => idx.get(e.name) ?? Infinity;
  return byDefault.sort((a, b) => rank(a) - rank(b)); // sort es estable: los que no están quedan en orden por defecto
}

/** Mueve `name` antes (o después) de `target` dentro de la lista visible `names`. */
export function placeName(names: string[], name: string, target: string, after: boolean): string[] {
  const out = names.filter((n) => n !== name);
  const i = out.indexOf(target);
  if (i < 0) return [...out, name];
  out.splice(after ? i + 1 : i, 0, name);
  return out;
}

const parentOf = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
const nameOf = (p: string) => p.slice(p.lastIndexOf('/') + 1);

/** Renombrar o mover: conserva el lugar si sigue en la misma carpeta y actualiza las claves de las subcarpetas. Devuelve null si no cambió nada. */
export function renameInOrder(order: ExplorerOrder, oldPath: string, newPath: string): ExplorerOrder | null {
  let changed = false;
  const out: ExplorerOrder = {};
  for (const [key, names] of Object.entries(order)) {
    const k = key === oldPath ? newPath : key.startsWith(`${oldPath}/`) ? newPath + key.slice(oldPath.length) : key;
    if (k !== key) changed = true;
    out[k] = names;
  }
  const from = parentOf(oldPath), to = parentOf(newPath), list = out[from];
  if (list?.includes(nameOf(oldPath))) {
    changed = true;
    out[from] = from === to ? list.map((n) => (n === nameOf(oldPath) ? nameOf(newPath) : n)) : list.filter((n) => n !== nameOf(oldPath));
  }
  return changed ? out : null;
}
