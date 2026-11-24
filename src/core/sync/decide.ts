import './strings';
import { t } from '../../app/i18n';
import { basename, dirname, extname, joinPath, stripExt } from '../path';
import type { Vault } from '../vault';

/**
 * Lógica de decisión de la sync, sin efectos (se testea con tablas).
 *
 * Para cada fila que llega del servidor se compara el estado local con la
 * "base" (lo último en que coincidimos con el servidor):
 *  - contenido: cambió local si `dirty` y el hash difiere de la base; cambió
 *    remoto si su hash difiere de la base. Los dos y distintos = conflicto: el
 *    archivo queda con lo remoto y lo local va a una copia. Hashes iguales no
 *    son conflicto.
 *  - ruta: igual, con la ruta. Renombrado en los dos lados a rutas distintas:
 *    gana el remoto y se avisa.
 *  - borrado: borrado contra cambio = gana el cambio (se resucita).
 *  - `.melanite/` (config, data.json de plugins): un conflicto de contenido no
 *    genera copia; gana el remoto (ver CLAUDE.md, contrato 4).
 */

export interface Base { version: number; hash: string; path: string }

export interface LocalView {
  /** alive = está en el vault; tombstone = se borró y la baja no se confirmó; none = no existe */
  state: 'none' | 'alive' | 'tombstone';
  path: string;
  /** hash del contenido actual ('' en carpetas) */
  hash: string;
  folder: boolean;
  dirty: boolean;
  base: Base | null;
  /** carpeta con algo adentro */
  nonEmpty?: boolean;
}

export interface RemoteView {
  path: string;
  hash: string;
  version: number;
  deleted: boolean;
  folder: boolean;
  /** la última escritura en el servidor la hizo este dispositivo */
  own: boolean;
}

export interface Decision {
  /**
   * nothing: ya está al día.
   * take: lo local pasa a ser exactamente lo remoto (crear/actualizar/borrar), sin pendientes.
   * keep: la base pasa a ser lo remoto pero lo local manda en algo (`path`/`content`): queda pendiente de subir.
   *       Con un tombstone local: la baja sigue pendiente, ahora contra la versión remota.
   * drop: el tombstone local ya no hace falta.
   */
  action: 'nothing' | 'take' | 'keep' | 'drop';
  path?: string;
  content?: 'local' | 'remote';
  /** guardar el contenido local en una copia de conflicto antes de tomar el remoto */
  copy?: boolean;
  /** los dos renombraron a rutas distintas: ganó la remota */
  renamed?: boolean;
}

export const isConfigPath = (path: string) => path.startsWith('.melanite/');

/** Sin base no se sabe qué cambió: todo cuenta como cambiado de los dos lados. */
const NO_BASE: Base = { version: 0, hash: '\0', path: '\0' };

export function decide(l: LocalView, r: RemoteView, config = false): Decision {
  if (l.state === 'none') return { action: r.deleted ? 'nothing' : 'take' };
  if (l.base && l.base.version === r.version) return { action: 'nothing' };

  if (l.state === 'tombstone') {
    if (r.deleted) return { action: 'drop' };
    // nuestro propio push que llegó sin respuesta: la baja sigue; si no, alguien lo cambió: gana el cambio
    return { action: r.own ? 'keep' : 'take' };
  }

  // la última versión del servidor es nuestra (respuesta perdida): lo local desciende de ella, manda lo local
  if (r.own) {
    if (!r.deleted && l.hash === r.hash && l.path === r.path) return { action: 'take' };
    return { action: 'keep', path: l.path, content: 'local' };
  }

  const b = l.base ?? NO_BASE;
  const lc = l.dirty && l.hash !== b.hash;
  const lp = l.dirty && l.path !== b.path;
  if (r.deleted) return lc || lp || l.nonEmpty ? { action: 'keep', path: l.path, content: 'local' } : { action: 'take' };
  if (!lc && !lp) return { action: 'take' };

  const rc = r.hash !== b.hash;
  const rp = r.path !== b.path;
  const content: 'local' | 'remote' = lc && !rc ? 'local' : 'remote';
  const copy = lc && rc && l.hash !== r.hash && !config;
  const path = lp && !rp ? l.path : r.path;
  const renamed = lp && rp && l.path !== r.path;
  const out: Decision = { action: content === 'remote' && path === r.path ? 'take' : 'keep' };
  if (out.action === 'keep') Object.assign(out, { path, content });
  if (copy) out.copy = true;
  if (renamed) out.renamed = true;
  return out;
}

/**
 * Otra entidad local ocupa la ruta de una fila remota (ids distintos).
 * adopt: es "la misma" (nunca se subió y es carpeta, o mismo contenido, o config): toma el id remoto.
 * aside: se aparta con sufijo de conflicto y la remota ocupa la ruta.
 */
export function decideCollision(occupant: LocalView, r: RemoteView, config = false): 'adopt' | 'aside' {
  if (occupant.base || occupant.folder !== r.folder) return 'aside';
  if (occupant.folder || config || occupant.hash === r.hash) return 'adopt';
  return 'aside';
}

const pad = (n: number) => String(n).padStart(2, '0');
export const localDate = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** "dir/Nota (conflict 2026-11-24).md", numerada si ya existe. */
export function conflictPath(vault: Vault, path: string, folder: boolean, date = localDate()): string {
  const ext = folder ? '' : extname(path);
  const name = ext ? stripExt(basename(path)) : basename(path);
  return vault.getAvailablePath(joinPath(dirname(path), `${name} (${t('sync.conflict')} ${date})`), ext);
}
