import type { App } from './app';
import { MarkdownView } from './views/markdown-view';
import { EXPLORER_VIEW, FileExplorerView } from './views/explorer';
import { t } from './i18n';

/** Comandos básicos de la app (los plugins agregan los suyos con addCommand). */
export function registerCoreCommands(app: App): void {
  const ws = app.workspace;
  const add = app.commands.addCommand.bind(app.commands);
  const activeFile = () => ws.getActiveFile();

  add({ id: 'file:new', name: t('cmd.newNote'), icon: 'file-plus', hotkeys: [{ modifiers: ['Mod'], key: 'n' }, { modifiers: ['Alt'], key: 'n' }],
    callback: () => app.fileManager.createAndOpen(app.fileManager.getNewFileParent()) });
  add({ id: 'file:new-tab', name: t('cmd.newNoteTab'), icon: 'file-plus',
    callback: async () => { const leaf = ws.getLeaf('tab'); ws.setActiveLeaf(leaf); await app.fileManager.createAndOpen(app.fileManager.getNewFileParent()); } });
  add({ id: 'file:new-folder', name: t('cmd.newFolder'), icon: 'folder-plus', callback: () => app.fileManager.promptNewFolder(app.fileManager.getNewFileParent()) });
  add({ id: 'file:rename', name: t('file.rename'), icon: 'pencil', hotkeys: [{ modifiers: ['Alt'], key: 'r' }],
    checkCallback: (checking) => { const f = activeFile(); if (f && !checking) void app.fileManager.promptForRename(f); return !!f; } });
  add({ id: 'file:delete', name: t('file.delete'), icon: 'trash',
    checkCallback: (checking) => { const f = activeFile(); if (f && !checking) void app.fileManager.promptForDeletion(f); return !!f; } });
  add({ id: 'file:move', name: t('file.moveTo'), icon: 'folder-input',
    checkCallback: (checking) => { const f = activeFile(); if (f && !checking) void app.fileManager.promptMove(f); return !!f; } });
  add({ id: 'file:reveal', name: t('cmd.reveal'), icon: 'folder-open',
    checkCallback: (checking) => {
      const f = activeFile();
      if (f && !checking) void ws.ensureSideLeaf(EXPLORER_VIEW, 'left', { reveal: true }).then((leaf) => (leaf.view as FileExplorerView).revealFile(f));
      return !!f;
    } });
  add({ id: 'editor:attach', name: t('cmd.attach'), icon: 'paperclip',
    editorCallback: (_e, view) => {
      const input = createEl('input', { type: 'file', attr: { multiple: true, accept: 'image/*,application/pdf,*/*' } });
      input.addEventListener('change', () => void view.insertAttachments(Array.from(input.files ?? [])));
      input.click();
    } });

  add({ id: 'markdown:toggle-preview', name: t('cmd.togglePreview'), icon: 'book-open', hotkeys: [{ modifiers: ['Mod'], key: 'e' }],
    checkCallback: (checking) => { const v = ws.getActiveViewOfType(MarkdownView); if (v && !checking) v.toggleMode(); return !!v; } });
  add({ id: 'markdown:toggle-source', name: t('cmd.toggleSource'), icon: 'code',
    checkCallback: (checking) => { const v = ws.getActiveViewOfType(MarkdownView); if (v && !checking) v.toggleSourceMode(); return !!v && v.mode === 'source'; } });

  add({ id: 'workspace:close', name: t('cmd.closeTab'), icon: 'x', hotkeys: [{ modifiers: ['Mod'], key: 'w' }, { modifiers: ['Alt'], key: 'w' }],
    callback: () => ws.getMostRecentLeaf()?.detach() });
  add({ id: 'workspace:new-tab', name: t('view.newTab'), icon: 'plus', hotkeys: [{ modifiers: ['Mod'], key: 't' }],
    callback: () => { const leaf = ws.getLeaf('tab'); ws.setActiveLeaf(leaf, { focus: true }); } });
  add({ id: 'workspace:split-vertical', name: t('cmd.splitRight'), icon: 'columns-2',
    checkCallback: (checking) => { const l = ws.getMostRecentLeaf(); if (l && !checking) void ws.duplicateLeaf(l, 'vertical'); return !!l; } });
  add({ id: 'workspace:split-horizontal', name: t('cmd.splitDown'), icon: 'rows-2',
    checkCallback: (checking) => { const l = ws.getMostRecentLeaf(); if (l && !checking) void ws.duplicateLeaf(l, 'horizontal'); return !!l; } });
  const cycle = (dir: 1 | -1) => () => {
    const leaf = ws.getMostRecentLeaf();
    if (!leaf) return;
    const tabs = leaf.parent.children;
    const next = tabs[(tabs.indexOf(leaf) + dir + tabs.length) % tabs.length];
    ws.setActiveLeaf(next, { focus: true });
  };
  add({ id: 'workspace:next-tab', name: t('cmd.nextTab'), hotkeys: [{ modifiers: ['Ctrl'], key: 'Tab' }], callback: cycle(1) });
  add({ id: 'workspace:previous-tab', name: t('cmd.prevTab'), hotkeys: [{ modifiers: ['Ctrl', 'Shift'], key: 'Tab' }], callback: cycle(-1) });
  add({ id: 'app:toggle-left-sidebar', name: t('cmd.toggleLeft'), icon: 'panel-left', hotkeys: [{ modifiers: ['Mod'], key: '\\' }], callback: () => ws.leftSplit.toggle() });
  add({ id: 'app:toggle-right-sidebar', name: t('cmd.toggleRight'), icon: 'panel-right', hotkeys: [{ modifiers: ['Mod', 'Shift'], key: '\\' }], callback: () => ws.rightSplit.toggle() });
  add({ id: 'app:open-settings', name: t('cmd.openSettings'), icon: 'settings', hotkeys: [{ modifiers: ['Mod'], key: ',' }], callback: () => app.openSettings() });

  // atajos de formato del editor
  const wrap = (id: string, name: string, key: string, before: string, after = before) => add({
    id: `editor:${id}`, name, hotkeys: [{ modifiers: ['Mod'], key }],
    editorCallback: (editor) => {
      const sel = editor.getSelection();
      editor.replaceSelection(before + sel + after);
      if (!sel) { const c = editor.getCursor(); editor.setCursor({ line: c.line, ch: c.ch - after.length }); }
    },
  });
  wrap('toggle-bold', t('cmd.bold'), 'b', '**');
  wrap('toggle-italics', t('cmd.italic'), 'i', '*');
  wrap('insert-link', t('cmd.insertWikilink'), 'k', '[[', ']]');
  add({ id: 'editor:toggle-checklist', name: t('cmd.toggleTask'), hotkeys: [{ modifiers: ['Mod'], key: 'l' }],
    editorCallback: (editor) => {
      const n = editor.getCursor().line;
      const line = editor.getLine(n);
      const m = /^(\s*)(?:([-*+]) \[(.)\] |([-*+]) )?(.*)$/.exec(line)!;
      const [, indent, taskBullet, state, bullet, rest] = m;
      if (taskBullet) editor.setLine(n, `${indent}${taskBullet} [${state === ' ' ? 'x' : ' '}] ${rest}`);
      else editor.setLine(n, `${indent}${bullet ?? '-'} [ ] ${rest}`);
    } });

}
