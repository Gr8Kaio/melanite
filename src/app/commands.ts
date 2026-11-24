import type { App } from './app';
import type { Editor } from './editor/editor';
import type { MarkdownView } from './views/markdown-view';

export type Modifier = 'Mod' | 'Ctrl' | 'Meta' | 'Shift' | 'Alt';
export interface Hotkey { modifiers: Modifier[]; key: string }

export interface Command {
  id: string;
  name: string;
  icon?: string;
  hotkeys?: Hotkey[];
  /** se oculta del command palette */
  hidden?: boolean;
  callback?: () => unknown;
  checkCallback?: (checking: boolean) => boolean | void;
  editorCallback?: (editor: Editor, view: MarkdownView) => unknown;
  editorCheckCallback?: (checking: boolean, editor: Editor, view: MarkdownView) => boolean | void;
}

export const isMac = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);

/** "Mod+Shift+E" para mostrar en la UI. */
export function hotkeyLabel(h: Hotkey): string {
  const names: Record<Modifier, string> = { Mod: isMac ? '⌘' : 'Ctrl', Ctrl: 'Ctrl', Meta: isMac ? '⌘' : 'Win', Shift: isMac ? '⇧' : 'Shift', Alt: isMac ? '⌥' : 'Alt' };
  const key = h.key.length === 1 ? h.key.toUpperCase() : h.key;
  return [...h.modifiers.map((m) => names[m]), key].join(isMac ? '' : '+');
}

function matches(h: Hotkey, e: KeyboardEvent): boolean {
  const want = new Set(h.modifiers.map((m) => (m === 'Mod' ? (isMac ? 'Meta' : 'Ctrl') : m)));
  if (want.has('Ctrl') !== e.ctrlKey || want.has('Meta') !== e.metaKey || want.has('Shift') !== e.shiftKey || want.has('Alt') !== e.altKey) return false;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
  // con Shift, e.key cambia ("," → "<"): comparamos también por código físico
  return key === h.key.toLowerCase() || e.code === `Key${h.key.toUpperCase()}` || e.code === `Digit${h.key}`;
}

export class Commands {
  app: App;
  commands: Record<string, Command> = {};
  /** atajos personalizados por el usuario (id → atajos); reemplazan a los de fábrica */
  customKeys: Record<string, Hotkey[]> = {};

  constructor(app: App) { this.app = app; }

  addCommand(cmd: Command): Command {
    this.commands[cmd.id] = cmd;
    return cmd;
  }

  removeCommand(id: string): void { delete this.commands[id]; }

  listCommands(): Command[] {
    return Object.values(this.commands).filter((c) => !c.hidden && this.isAvailable(c));
  }

  hotkeysFor(cmd: Command): Hotkey[] { return this.customKeys[cmd.id] ?? cmd.hotkeys ?? []; }

  /** ¿Se puede ejecutar ahora? (checkCallback / editorCallback necesitan contexto). */
  isAvailable(cmd: Command): boolean {
    const md = this.app.getActiveMarkdownView();
    if (cmd.checkCallback) return !!cmd.checkCallback(true);
    if (cmd.editorCheckCallback) return !!md && !!cmd.editorCheckCallback(true, md.editor, md);
    if (cmd.editorCallback) return !!md;
    return !!cmd.callback;
  }

  executeCommandById(id: string): boolean {
    const cmd = this.commands[id];
    return cmd ? this.executeCommand(cmd) : false;
  }

  executeCommand(cmd: Command): boolean {
    const md = this.app.getActiveMarkdownView();
    try {
      if (cmd.checkCallback) return cmd.checkCallback(true) ? (cmd.checkCallback(false), true) : false;
      if (cmd.editorCheckCallback) {
        if (!md || !cmd.editorCheckCallback(true, md.editor, md)) return false;
        cmd.editorCheckCallback(false, md.editor, md);
        return true;
      }
      if (cmd.editorCallback) { if (!md) return false; void cmd.editorCallback(md.editor, md); return true; }
      if (cmd.callback) { void cmd.callback(); return true; }
    } catch (err) {
      console.error(`[melanite] comando ${cmd.id}`, err);
    }
    return false;
  }

  /** Listener global de teclado. */
  handleKeydown = (e: KeyboardEvent): void => {
    if (e.defaultPrevented || e.isComposing) return;
    if (document.querySelector('.modal-container')) return;
    for (const cmd of Object.values(this.commands)) {
      if (this.hotkeysFor(cmd).some((h) => matches(h, e)) && this.isAvailable(cmd)) {
        e.preventDefault();
        this.executeCommand(cmd);
        return;
      }
    }
  };
}
