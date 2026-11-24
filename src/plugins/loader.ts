import { unzipSync, strFromU8 } from 'fflate';

/**
 * Partes puras del loader de plugins de la comunidad (sin DOM: se testean en node).
 */

export type PluginFiles = Record<string, string>;
export const PLUGIN_FILES = ['manifest.json', 'main.js', 'styles.css'] as const;
/** módulos que la app comparte con los plugins (mismas instancias) */
export const SHARED_MODULES = ['melanite', '@codemirror/state', '@codemirror/view', '@codemirror/language'];

// `import\s+\w` y no `import\s*\w`: los bundles CJS de esbuild tienen líneas como `import_melanite.X`
const ESM_RE = /^\s*(import\s*[{*'"]|import\s+[\w$]|export\s*[{*]|export\s+(default|const|let|var|class|function|async)\b)/m;

/**
 * Convierte el main.js de un plugin en un módulo ESM importable desde una blob URL.
 * - CJS (lo normal, estilo Obsidian): se envuelve con el shim del Contrato 3.
 * - ESM: se reescriben los imports de módulos compartidos a `specUrls[nombre]`.
 */
export function wrapPluginSource(code: string, specUrls: Record<string, string> = {}, id = 'plugin'): string {
  const tail = `\n//# sourceURL=melanite-plugin:${id}/main.js`;
  if (ESM_RE.test(code)) {
    // ponytail: detección por regex de import/export al inicio de línea; un CJS minificado que tenga
    // "export " al principio de una línea de un string se tomaría por ESM. Si pasa, mirar el AST.
    const rewritten = code.replace(/(\bfrom\s*|\bimport\s*\(?\s*)(['"])([^'"]+)\2/g, (m, pre: string, q: string, spec: string) =>
      specUrls[spec] ? `${pre}${q}${specUrls[spec]}${q}` : m);
    return rewritten + tail;
  }
  return 'const module={exports:{}}, exports=module.exports, require=(n)=>globalThis.__melanite.require(n);\n'
    + code
    + '\nexport default module.exports.default ?? module.exports;' + tail;
}

/** Módulo ESM que reexporta un módulo compartido (para los plugins ESM que hacen `import { X } from 'melanite'`). */
export function sharedModuleSource(name: string, keys: string[]): string {
  const ids = keys.filter((k) => /^[A-Za-z_$][\w$]*$/.test(k) && k !== 'default');
  return `const m = globalThis.__melanite.require(${JSON.stringify(name)});\nexport default m;\n`
    + (ids.length ? `export const { ${ids.join(', ')} } = m;\n` : '');
}

export interface ManifestLike { id: string; name: string; version: string; minAppVersion?: string }

/** Valida el manifest; devuelve un mensaje de error o null. */
export function manifestError(m: unknown): string | null {
  const x = m as Partial<ManifestLike> | null;
  if (!x || typeof x !== 'object') return 'manifest.json inválido';
  if (typeof x.id !== 'string' || !/^[a-z0-9-]+$/.test(x.id)) return 'id inválido (solo a-z, 0-9 y -)';
  if (typeof x.name !== 'string' || !x.name) return 'falta name';
  if (typeof x.version !== 'string' || !x.version) return 'falta version';
  return null;
}

/** Compara versiones "1.2.3" numéricamente: <0, 0 o >0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  const pb = b.split(/[.-]/).map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d;
  }
  return 0;
}

/** Saca manifest/main/styles de un zip, con los archivos en la raíz o dentro de una carpeta. */
export function filesFromZip(data: Uint8Array): PluginFiles {
  const entries = unzipSync(data);
  const manifests = Object.keys(entries).filter((p) => /(^|\/)manifest\.json$/.test(p) && !p.startsWith('__MACOSX/'));
  if (!manifests.length) throw new Error('el zip no tiene manifest.json');
  const manifest = manifests.sort((a, b) => a.length - b.length)[0];
  const prefix = manifest.slice(0, -'manifest.json'.length);
  const out: PluginFiles = {};
  for (const name of PLUGIN_FILES) {
    const e = entries[prefix + name];
    if (e) out[name] = strFromU8(e);
  }
  if (!out['main.js']) throw new Error('el zip no tiene main.js');
  return out;
}

/** `https://github.com/o/r`, `…/releases`, `…/releases/tag/x` o `o/r` → partes. */
export function parseGithubSource(url: string): { owner: string; repo: string; tag: string | null } | null {
  const m = /^(?:https?:\/\/(?:www\.)?github\.com\/)?([\w.-]+)\/([\w.-]+?)(?:\.git)?(?:\/releases(?:\/(?:tag|download)\/([^/?#]+))?)?\/?(?:[?#].*)?$/.exec(url.trim());
  if (!m) return null;
  return { owner: m[1], repo: m[2], tag: m[3] ? decodeURIComponent(m[3]) : null };
}
