# Melanite — guía para agentes

App de notas Markdown local-first (PWA) inspirada en Obsidian, con plugins. Se usa en Windows (Chrome/Edge instalada) y en iPhone (Safari, "Agregar a pantalla de inicio"). Todo gratis: GitHub Pages + Supabase free.

- Repo: `github.com/Gr8Kaio/melanite` · Deploy: `gr8kaio.github.io/melanite/` (base `/melanite/`)
- Stack: TypeScript + Vite 8, **sin framework de UI** (DOM con helpers estilo Obsidian), CodeMirror 6, markdown-it, Dexie, KaTeX y Mermaid lazy, Lucide.
- UI en **inglés por defecto** con español como opción (Ajustes → Appearance → Language). Todo texto visible pasa por `t()`; cada módulo registra sus claves en los dos idiomas (`registerStrings({ es, en })`), sin dejar claves solo en español.

## Comandos

```
npm run dev          # vite
npm test             # vitest (tests/unit)
npm run build        # tsc --noEmit + vite build
npm run test:e2e     # playwright: proyectos "desktop" (chromium) e "iphone" (webkit, iPhone 15). Requiere build.
py scripts/icons.py  # regenera íconos (Pillow)
```

Antes de dar algo por terminado: `npx tsc --noEmit`, `npm test`, `npm run build`, `npx playwright test`, y **mirar las capturas** (`test-results/*.png`) si tocaste UI.

## Reglas de trabajo

- **No reescribir trabajo ajeno.** Cada módulo tiene dueño (tabla abajo). Fuera de tu carpeta solo podés tocar los "puntos de extensión" listados, y solo agregando.
- **Versión:** cada push sube `version` en `package.json` (semver; se muestra en Ajustes → Acerca de).
- Archivos en UTF-8 con LF. **No escribir código con heredocs de bash** (el shell de esta máquina se come las barras invertidas): usar la herramienta de escritura de archivos.
- Lo simple primero: nada de abstracciones especulativas. Si cortás camino a propósito, dejá un comentario `ponytail:` con el límite y cómo escalarlo.
- Accesibilidad mínima: `aria-label` en botones de ícono; targets táctiles de 44 px en mobile (`body.is-mobile`).
- Commits en español, terminando con `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

---

## Contrato 1 — Formato del vault

- Un vault = árbol de archivos. **Ruta** = string normalizado con `normalizePath` (`/` como separador, sin `/` inicial/final, NFC). La raíz es `''`.
- Notas = archivos `.md` en UTF-8. Frontmatter YAML opcional al principio, entre `---` (parsear con `parseYaml` de `src/core/yaml.ts`).
- Sintaxis soportada (igual que Obsidian): `[[nota]]`, `[[nota#encabezado]]`, `[[nota#^bloque]]`, `[[nota|alias]]`, `![[nota]]`, `![[img.png|300]]`, links Markdown, `#tag/anidado`, `==resaltado==`, `%%comentario%%`, callouts `> [!tipo]±`, `$…$`, `$$…$$`, footnotes, GFM.
- Resolución de links: `resolveLinkpath(vault, linkpath, sourcePath)` en `src/core/links.ts` (ruta exacta → relativa a la nota → por nombre sin mayúsculas, la ruta más corta gana). **Nadie reimplementa esto.**
- Carpetas reservadas (ocultas en el explorador porque empiezan con `.`):
  - `.melanite/app.json` — ajustes de la app (se sincroniza)
  - `.melanite/core-plugins.json` — `{ id: boolean }` plugins internos activos
  - `.melanite/community-plugins.json` — `string[]` ids de plugins de la comunidad activos
  - `.melanite/plugins/<id>/{manifest.json, main.js, styles.css, data.json}`
  - `.melanite/hotkeys.json` — `{ commandId: Hotkey[] }` atajos personalizados
  - `.melanite/snippets/*.css` — CSS snippets del usuario
  - `.trash/` — papelera (borrar = mover acá; vaciar = borrado definitivo)
- Lo que es **por dispositivo** (no va al vault): layout del workspace (`localStorage['melanite:layout']`), carpetas expandidas, estado de sync (Dexie `kv`), sesión de Supabase (`localStorage['melanite-auth']`).
- Adjuntos: binarios en la tabla `blobs` (ArrayBuffer, no Blob: Safari). Carpeta según `settings.attachmentFolder` (`adjuntos`, `./`, `./sub`).

## Contrato 2 — Núcleo y API interna

Objetos de `App` (`src/app/app.ts`), con la forma de la API de Obsidian:

| Objeto | Archivo | Qué garantiza |
|---|---|---|
| `app.vault` | `src/core/vault.ts` | **Única vía de escritura** al almacenamiento. `create/createBinary/createFolder/modify/modifyBinary/append/process/rename/delete/trash/read/cachedRead/cachedReadSync/readBinary/getAbstractFileByPath/getFileByPath/getFolderByPath/getFiles/getMarkdownFiles/getAllLoadedFiles/getAvailablePath`. Eventos: `create(file)`, `modify(file)`, `delete(file)`, `rename(file, oldPath)`. |
| `app.metadataCache` | `src/core/metadata.ts` | Tipos `CachedMetadata` y compañía fijos. Eventos `changed(file, data, cache)`, `deleted(file, prev)`, `resolved()`. `resolvedLinks`/`unresolvedLinks`, `getFileCache`, `getFirstLinkpathDest`, `fileToLinktext`, `getTags`. |
| `app.workspace` | `src/app/workspace.ts` | Hojas/pestañas/splits/sidebars. `getLeaf(newLeaf)`, `openLinkText`, `getActiveFile`, `getActiveViewOfType`, `iterateAllLeaves`, `getLeavesOfType`, `ensureSideLeaf`, `revealLeaf`, `onLayoutReady`. Eventos: `file-open`, `active-leaf-change`, `layout-change`, `editor-change(editor, view)`, `editor-selection-change`. |
| `app.fileManager` | `src/app/file-manager.ts` | `renameFile` (**el módulo links lo extiende para actualizar los links entrantes**), `trashFile`, `createNewMarkdownFile`, `saveAttachment`, `generateMarkdownLink`, prompts de UI. |
| `app.commands` | `src/app/commands.ts` | `addCommand/removeCommand/executeCommandById/listCommands/hotkeysFor`, `customKeys` (atajos del usuario). |
| `app.markdown` | `src/app/render/renderer.ts` | Registro de post-processors y code block processors. Render: `MarkdownRenderer.render(app, md, el, sourcePath, component)`. |
| `app.plugins` | `src/plugins/manager.ts` | `registerCore(manifest, Clase)`, `loadCore`, `setCoreEnabled`, `getPlugin`. |
| `app.settings` / `saveSettings()` | `app.ts` | Evento `settings-changed` en `app`. |
| `app.registerView/registerExtensions/addRibbonIcon/addStatusBarItem/registerEditorExtension/readConfig/writeConfig/openSettings/settingTabs/pluginSettingTabs` | `app.ts` | |

UI compartida: `src/app/ui/` (`dom.ts` helpers `createEl/createDiv/empty/setText/addClass…`, `icons.ts` `setIcon`, `modal.ts` `Modal/Notice/Menu/promptText/confirmDialog/onContextMenu`, `setting.ts` `Setting` y componentes). Vistas base: `src/app/views/view.ts` (`View`, `ItemView`, `FileView`). Editor: `MarkdownView` (`views/markdown-view.ts`) expone `editor: Editor` (API de Obsidian, `src/app/editor/editor.ts`) y `cm: EditorView`.

## Contrato 3 — API de plugins

- Base: `Plugin` y `PluginSettingTab` en `src/api/plugin.ts`. `addCommand` prefija el id con `<pluginId>:`. Todo `addX/registerX` se limpia solo en `unload()`. `onload` puede ser async.
- Superficie pública = lo que exporte `src/api/index.ts` (lo crea el módulo plugins) y se publica como `melanite-api.d.ts`. Debe incluir: `Plugin, PluginSettingTab, PluginManifest, Component, Events, App, Vault, TFile, TFolder, TAbstractFile, MetadataCache, Workspace, WorkspaceLeaf, View, ItemView, FileView, MarkdownView, Editor, MarkdownRenderer, Modal, Notice, Menu, MenuItem, Setting` (+ componentes), `setIcon, normalizePath, parseYaml, stringifyYaml, Platform, debounce`.
- Los plugins de la comunidad importan `'melanite'` (ESM) o `require('melanite')` (CJS estilo Obsidian). El loader envuelve `main.js` en un módulo ESM y lo importa desde una blob URL:
  ```js
  const module={exports:{}}, exports=module.exports, require=(n)=>globalThis.__melanite.require(n);
  /* main.js */
  export default module.exports.default ?? module.exports;
  ```
- `manifest.json`: `{ id, name, version, minAppVersion?, description?, author?, authorUrl?, isDesktopOnly? }`. El id es `[a-z0-9-]+` y coincide con la carpeta.
- **Plugins internos:** usan exactamente esta API (sin atajos privados) y se registran desde el `install(app)` de su módulo con `app.plugins.registerCore(manifest, Clase)`. Viven en `src/<módulo>/core-plugins/<id>.ts`.

## Contrato 4 — Sync (`src/core/sync/`, `src/core/db.ts`, `supabase/`)

**Reglas para todos los módulos**
- **Toda escritura pasa por `app.vault`.** Ningún módulo escribe en Dexie directo (el esquema es del módulo sync). Cada escritura local marca la fila `dirty`; `vault.delete` deja un tombstone (vaciar la papelera = baja en el servidor).
- Identidad = `id` (uuid) estable; renombrar/mover = cambiar `path` del mismo id (`vault.rename`). Nunca crear+borrar para "mover".
- El vault actualiza la memoria y emite el evento **en el mismo tick** en que lanza la escritura a IndexedDB (después espera). `vault.applyRemote(change, guard)` escribe lo que llega del servidor sin marcar `dirty` y emite los mismos eventos `create/modify/rename/delete`; las vistas reaccionan a `modify` con `MarkdownView.replaceDoc`. No rompan eso.
- Todo `.melanite/` se sincroniza (no hay nada por dispositivo ahí; lo por dispositivo va en `localStorage`). Un cambio remoto en un archivo de config llega como `modify`: si tu módulo cachea su config, escuchá ese evento.

**Interfaz para la UI: `app.sync` (`SyncEngine`, `src/core/sync/engine.ts`)**
```ts
import { getSupabaseClient } from '../core/sync';           // Promise<SupabaseClient | null> (null si el build no tiene VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY); sesión persistente en localStorage ('melanite-auth')
await app.sync.start(client);   // cliente ya autenticado; arranca y sincroniza en segundo plano
await app.sync.stop();          // al cerrar sesión (lo pendiente queda guardado)
await app.sync.syncNow();       // una ronda ya; nunca rechaza (los errores van al estado)
app.sync.state                  // { enabled, status: 'idle'|'syncing'|'offline'|'error', pending, lastSync: ms|null, lastError: string|null }
app.sync.on('status', (s: SyncState) => …)      // cada cambio de estado
app.sync.conflicts              // SyncConflict[] de esta sesión: { kind: 'edit'|'rename'|'path', path, copyPath?, localPath?, time }
app.sync.on('conflict', (c: SyncConflict) => …) // además el módulo ya muestra un Notice (claves sync.*)
```
- Al arrancar la app, si hay una sesión guardada la sync se retoma sola (`resumeSync` en `src/core/sync/index.ts`); con `SIGNED_OUT` se para. Cambiar de cuenta en el mismo dispositivo = las notas locales se mezclan con la cuenta nueva como en un primer login.
- Rondas: pull → push → bajar adjuntos. Se disparan por cambios locales (1,5 s), aviso de Realtime, `online`, `visibilitychange` y cada 60 s.

**Cómo funciona**
- Servidor (`supabase/schema.sql`): tabla `files` con clave `(user_id, id)`, índice único parcial `(user_id, path) where not deleted`, RLS de solo lectura; **toda escritura va por la RPC `push_file`** (compare-and-swap sobre `version`, `seq` nuevo de una secuencia, un push a la vez por usuario con un advisory lock para que `seq` se confirme en orden). Respuestas: `ok`, `conflict` (otra versión) o `path_taken` (otra fila viva tiene la ruta). El pull trae `seq > lastSeq` en orden (nunca `updated_at`). Realtime solo dispara un pull.
- Local (Dexie v2): `files.{dirty, baseVersion, baseHash, basePath, blobKey}`, tabla `tombstones`, `kv['sync.lastSeq' | 'sync.deviceId' | 'sync.userId']`. `dirty` es un sello creciente: se limpia solo si el servidor confirmó y no hubo otra escritura local en el medio. Hashes SHA-256 (`crypto.subtle`).
- Adjuntos: Storage privado `attachments`, claves `{user_id}/{id}/{hash}` (por contenido: reintentar una subida es idempotente y un CAS fallido no pisa la versión de otro). El binario baja después de aplicar la fila; mientras tanto el archivo existe con el contenido anterior (o vacío).
- Decisiones (funciones puras en `src/core/sync/decide.ts`, comparando contra la base):
  - editado en los dos lados con hashes distintos → el archivo queda con lo remoto y lo local va a `nombre (conflict AAAA-MM-DD).md` (en español "conflicto"; numerada si existe). Hashes iguales no son conflicto.
  - borrado contra edición → gana la edición (se resucita). Carpeta borrada en remoto con algo adentro → la carpeta se resucita; cada archivo se rige por su propia fila.
  - renombrado contra edición → se aplican los dos. Renombrado en los dos lados → gana el remoto y se avisa.
  - dos ids con la misma ruta (dos dispositivos, primer login): carpeta nunca subida → se unifican (toma el id remoto); archivo nunca subido con el mismo contenido → se unifica; si no → lo local se aparta con el sufijo de conflicto.
  - `.melanite/` (config, `data.json` de plugins): un conflicto de contenido **no genera copia, gana lo remoto** (en el primer login gana la nube: así un dispositivo nuevo o viejo no pisa la config buena con la suya). Si el plugin vuelve a guardar, ese guardado sube normalmente.
  - el editor con texto sin guardar se guarda (`flushEditors`) antes de decidir; si mientras tanto se siguió escribiendo, la fila se reintenta.

---

## Módulos y dueños

| Módulo | Carpeta propia | Entrada | Estado |
|---|---|---|---|
| núcleo + shell | `src/core/`, `src/app/*.ts`, `src/app/{ui,views,render,editor,theme,i18n}/` | — | fase 1 hecha (coordinador) |
| **links** (fase 2) | `src/app/links/` | `install()` en `src/app/links/index.ts` | pendiente |
| **plugins** (fase 3) | `src/plugins/`, `src/api/`, `sample-plugin/` | `install()` en `src/plugins/index.ts` | base hecha (`api/plugin.ts`, `plugins/manager.ts`) |
| **mobile** (cliente iPhone) | `src/app/mobile/` | `install()` en `src/app/mobile/index.ts` | pendiente |
| sync (fase 4) | `src/core/sync/`, `src/core/db.ts`, `supabase/` | `app.sync` (`createSync`/`resumeSync` en `src/core/sync/index.ts`) | hecho |
| cuenta / login | `src/app/account/` | `install()` | hecho (pestaña Sync, OTP sin magic links) |
| escritorio (Electron) | `desktop/`, `src/app/desktop/` | `install()` (no hace nada fuera de Electron) | instalador NSIS + updater; **vault como carpeta real**: espejo en los dos sentidos (`folder-mirror.ts`), el disco solo se toca desde `desktop/folder.cjs` y dentro de la carpeta elegida; borrar = papelera de Windows; los ecos de nuestras propias escrituras se ignoran por hash |
| actualizaciones | `src/app/updates.ts` | Ajustes → About | escritorio: electron-updater (IPC `update:*`); web: `registration.update()` del service worker |
| PDF (fase 5) | `src/app/pdf.ts`, `src/app/render/pages.ts` | `exportPdf(app, files, name)` | hecho: hojas A4 compartidas con la vista previa lado a lado; escritorio `printToPDF` (IPC `pdf:save`), web `window.print()` |
| graph, temas, import/export (fase 5) | a definir | — | pendiente |

**Puntos de extensión compartidos** (se puede agregar, no modificar lo existente):
- Textos: `registerStrings({ es, en })` desde tu módulo, con claves prefijadas por el módulo (`search.*`, `plugins.*`, `mobile.*`), completas en los dos idiomas. No tocar `es.ts`/`en.ts`. En tests e2e usá los textos en inglés o selectores que no dependan del idioma.
- Ajustes del núcleo: se editan en un borrador y se aplican con el botón **Apply** (`views/settings.ts`). Las pestañas de plugins pueden aplicar al instante.
- CSS: tu `<módulo>.css` (ya importado por tu `index.ts`). Usá las variables de `src/app/theme/app.css`; no redefinas las existentes.
- Tests: `tests/unit/<módulo>.test.ts` y `tests/e2e/<módulo>.spec.ts`.
- Si necesitás un cambio en un archivo del núcleo, hacé el mínimo (un hook, un evento, un método nuevo), explicalo en el resumen final y no reformatees el archivo.

---

## Cómo escribir un plugin

- Partí de `sample-plugin/` (Pomodoro): `package.json` con esbuild, `tsconfig.json` que incluye `../melanite-api.d.ts`, `manifest.json`, `styles.css`.
- `src/main.ts` exporta por defecto una clase que extiende `Plugin` (`import { Plugin, … } from 'melanite'`). Todo lo que registres con `addX/registerX` se limpia solo al desactivar; la configuración va con `loadData/saveData` (`.melanite/plugins/<id>/data.json`).
- Build: esbuild en CommonJS con `melanite` y `@codemirror/*` como external (`npm run build`). El loader también acepta ESM.
- Instalar: zip o release de GitHub desde Ajustes → Plugins de la comunidad (GitHub no deja bajar assets de releases con CORS; si falla, zip). Se guarda en `.melanite/plugins/<id>/` y se sincroniza.
- Si cambia la API (`src/api/index.ts`): `npm run api:types` regenera `melanite-api.d.ts`. Los plugins internos usan la misma API desde `src/<módulo>/core-plugins/` y se registran con `app.plugins.registerCore`.
- Plugins de ejemplo en la app: `npm run plugin:sample` recompila el Pomodoro y lo copia a `public/plugins/pomodoro/`.
