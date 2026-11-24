# Melanite — guía para agentes

App de notas Markdown local-first (PWA) inspirada en Obsidian, con plugins. Se usa en Windows (Chrome/Edge instalada) y en iPhone (Safari, "Agregar a pantalla de inicio"). Todo gratis: GitHub Pages + Supabase free.

- Repo: `github.com/Gr8Kaio/melanite` · Deploy: `gr8kaio.github.io/melanite/` (base `/melanite/`)
- Stack: TypeScript + Vite 8, **sin framework de UI** (DOM con helpers estilo Obsidian), CodeMirror 6, markdown-it, Dexie, KaTeX y Mermaid lazy, Lucide.
- UI en español; todo texto visible pasa por `t()` (i18n preparada para inglés).

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
- Lo que es **por dispositivo** (no va al vault): layout del workspace (`localStorage['melanite:layout']`), carpetas expandidas, estado de sync.
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

## Contrato 4 — Interfaz de sync (la implementa el dueño de sync, en forma secuencial)

- **Toda escritura pasa por `app.vault`.** Ningún módulo escribe en Dexie directo. La sync se engancha en el vault.
- El esquema Dexie (`src/core/db.ts`) es **del módulo sync**. Los demás no lo cambian. Sync va a agregar en `version(2)`: `files.{baseVersion, baseHash, dirty, deleted}`, tabla `syncQueue`, `kv.lastSeq`.
- Identidad de archivo = `id` (uuid) estable; renombrar = cambiar `path` del mismo id. No crear/borrar para "mover".
- El vault va a ganar `applyRemote(row)`, que escribe sin marcar `dirty` y emite los mismos eventos (`create/modify/rename/delete`). Las vistas ya reaccionan a `modify` reemplazando el texto con diff mínimo (`MarkdownView.replaceDoc`); no rompan eso.
- Conflictos: si cambió local y remoto desde el último sync, gana el remoto en el archivo y lo local se guarda como `nombre (conflicto AAAA-MM-DD).md`. Nunca se pierde texto.
- Supabase (fase 4): tabla `files(id uuid pk, user_id, path, kind, content, storage_key, hash, version, deleted, seq, updated_at, device_id)` con RLS por `auth.uid()`, RPC `push_file` con compare-and-swap sobre `version`, pull por `seq > lastSeq`, Realtime solo como aviso. Adjuntos en Storage `attachments/{user_id}/{id}`.

---

## Módulos y dueños

| Módulo | Carpeta propia | Entrada | Estado |
|---|---|---|---|
| núcleo + shell | `src/core/`, `src/app/*.ts`, `src/app/{ui,views,render,editor,theme,i18n}/` | — | fase 1 hecha (coordinador) |
| **links** (fase 2) | `src/app/links/` | `install()` en `src/app/links/index.ts` | pendiente |
| **plugins** (fase 3) | `src/plugins/`, `src/api/`, `sample-plugin/` | `install()` en `src/plugins/index.ts` | base hecha (`api/plugin.ts`, `plugins/manager.ts`) |
| **mobile** (cliente iPhone) | `src/app/mobile/` | `install()` en `src/app/mobile/index.ts` | pendiente |
| sync (fase 4, secuencial) | `src/core/sync/`, `src/core/db.ts`, `supabase/` | — | pendiente |
| graph, temas, import/export, PDF (fase 5) | a definir | — | pendiente |

**Puntos de extensión compartidos** (se puede agregar, no modificar lo existente):
- Textos: `registerStrings({ es, en })` desde tu módulo, con claves prefijadas por el módulo (`search.*`, `plugins.*`, `mobile.*`). No tocar `es.ts`/`en.ts`.
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
