/**
 * API pública de Melanite: lo que ven los plugins (`import { … } from 'melanite'`).
 * Se publica como melanite-api.d.ts (`npm run api:types`).
 */
export { Plugin, PluginSettingTab, type PluginManifest } from './plugin';
export { Component } from '../core/component';
export { Events, type EventRef, type EventCallback } from '../core/events';
export { App, type AppSettings, type ViewCreator } from '../app/app';
export { Vault, TFile, TFolder, TAbstractFile, type FileStats } from '../core/vault';
export {
  MetadataCache, type CachedMetadata, type LinkCache, type EmbedCache, type TagCache, type HeadingCache,
  type BlockCache, type ListItemCache, type SectionCache, type FrontMatterCache, type Loc, type Pos,
} from '../core/metadata';
export { Workspace, WorkspaceLeaf, WorkspaceTabs, WorkspaceSplit, WorkspaceSidedock, type PaneType, type OpenViewState } from '../app/workspace';
export { View, ItemView, FileView, type ViewState } from '../app/views/view';
export { MarkdownView } from '../app/views/markdown-view';
export { SettingTab } from '../app/views/settings';
export { Editor, type EditorPosition, type EditorRange } from '../app/editor/editor';
export { MarkdownRenderer, type MarkdownPostProcessor, type MarkdownPostProcessorContext, type CodeBlockProcessor } from '../app/render/renderer';
export { Modal, Notice, Menu, MenuItem, promptText, confirmDialog } from '../app/ui/modal';
export {
  Setting, TextComponent, TextAreaComponent, ToggleComponent, DropdownComponent, SliderComponent,
  ButtonComponent, ExtraButtonComponent,
} from '../app/ui/setting';
export type { Command, Hotkey, Modifier } from '../app/commands';
export { setIcon } from '../app/ui/icons';
export { normalizePath } from '../core/path';
export { parseYaml, stringifyYaml } from '../core/yaml';
export { Platform } from '../app/platform';

/** Versión de la app que corre el plugin. */
export const apiVersion: string = __APP_VERSION__;

export interface Debouncer<T extends unknown[]> { (...args: T): void; cancel(): void }

/** Como el de Obsidian: con `resetTimer` cada llamada reinicia la espera. */
export function debounce<T extends unknown[]>(cb: (...args: T) => unknown, timeout = 0, resetTimer = false): Debouncer<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  let last: T;
  const fn = ((...args: T) => {
    last = args;
    if (timer && !resetTimer) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => { timer = null; cb(...last); }, timeout);
  }) as Debouncer<T>;
  fn.cancel = () => { if (timer) clearTimeout(timer); timer = null; };
  return fn;
}

export interface RequestUrlParam { url: string; method?: string; contentType?: string; body?: string | ArrayBuffer; headers?: Record<string, string>; throw?: boolean }
export interface RequestUrlResponse { status: number; headers: Record<string, string>; text: string; json: any; arrayBuffer: ArrayBuffer }

/**
 * fetch con la forma de requestUrl de Obsidian. Ojo: en el navegador SÍ aplica CORS
 * (no hay proceso nativo que lo saltee).
 */
export async function requestUrl(req: string | RequestUrlParam): Promise<RequestUrlResponse> {
  const r = typeof req === 'string' ? { url: req } : req;
  const headers = { ...(r.headers ?? {}) };
  if (r.contentType) headers['Content-Type'] = r.contentType;
  const res = await fetch(r.url, { method: r.method ?? 'GET', headers, body: r.body });
  const arrayBuffer = await res.arrayBuffer();
  const text = new TextDecoder().decode(arrayBuffer);
  if (!res.ok && r.throw !== false) throw new Error(`requestUrl ${res.status}: ${r.url}`);
  let json: any = null;
  try { json = JSON.parse(text); } catch { /* no es JSON */ }
  return { status: res.status, headers: Object.fromEntries(res.headers.entries()), text, json, arrayBuffer };
}
