import { EditorView } from '@codemirror/view';
import { indentLess, indentMore } from '@codemirror/commands';
import type { App } from '../app';
import type { Editor } from '../editor/editor';
import type { MarkdownView } from '../views/markdown-view';
import { Platform } from '../platform';
import { Modal } from '../ui/modal';
import { setIcon } from '../ui/icons';
import { t } from '../i18n';
import { cycleHeading, toggleList } from './format';

/** Envuelve la selección; sin selección deja el cursor en el medio. */
function wrap(editor: Editor, before: string, after = before): void {
  const sel = editor.getSelection();
  editor.replaceSelection(before + sel + after);
  if (!sel) { const c = editor.getCursor(); editor.setCursor({ line: c.line, ch: c.ch - after.length }); }
}

function editLine(editor: Editor, fn: (line: string) => string): void {
  const c = editor.getCursor();
  const before = editor.getLine(c.line);
  const next = fn(before);
  editor.setLine(c.line, next);
  editor.setCursor({ line: c.line, ch: Math.max(0, c.ch + next.length - before.length) });
}

/** Barra de formato pegada arriba del teclado (va al final del app-container, que sigue al visualViewport). */
export function installToolbar(app: App, container: HTMLElement): void {
  const bar = container.createDiv({ cls: 'mobile-toolbar', attr: { role: 'toolbar', 'aria-label': t('mobile.toolbar') } });
  // que tocar un botón no le saque el foco al editor (y no se cierre el teclado)
  bar.addEventListener('mousedown', (e) => e.preventDefault());
  const view = () => app.getActiveMarkdownView();
  const cmd = (id: string) => () => app.commands.executeCommandById(id);

  const btn = (icon: string, label: string, run: (v: MarkdownView) => unknown, refocus = true) => {
    const b = bar.createDiv({ cls: 'clickable-icon mobile-toolbar-button', attr: { role: 'button', 'aria-label': label } });
    if (icon.startsWith('text:')) b.createSpan({ cls: 'mobile-toolbar-text', text: icon.slice(5) });
    else setIcon(b, icon);
    b.addEventListener('click', () => {
      const v = view();
      if (!v) return;
      run(v);
      if (!refocus) return;
      v.editor.focus();
      v.cm.dispatch({ effects: EditorView.scrollIntoView(v.cm.state.selection.main.head) });
    });
  };

  btn('undo-2', t('mobile.undo'), (v) => v.editor.undo());
  btn('redo-2', t('mobile.redo'), (v) => v.editor.redo());
  btn('text:[[ ]]', t('cmd.insertWikilink'), cmd('editor:insert-link'));
  btn('heading', t('mobile.heading'), (v) => editLine(v.editor, cycleHeading));
  btn('list', t('mobile.list'), (v) => editLine(v.editor, toggleList));
  btn('square-check', t('cmd.toggleTask'), cmd('editor:toggle-checklist'));
  btn('bold', t('cmd.bold'), cmd('editor:toggle-bold'));
  btn('italic', t('cmd.italic'), cmd('editor:toggle-italics'));
  btn('code', t('mobile.code'), (v) => wrap(v.editor, '`'));
  btn('text:$ $', t('mobile.math'), (v) => wrap(v.editor, '$'));
  btn('link', t('mobile.link'), (v) => {
    const sel = v.editor.getSelection();
    v.editor.replaceSelection(`[${sel}]()`);
    const c = v.editor.getCursor();
    v.editor.setCursor({ line: c.line, ch: c.ch - (sel ? 1 : 3) });
  });
  btn('indent-increase', t('mobile.indent'), (v) => indentMore(v.cm));
  btn('indent-decrease', t('mobile.dedent'), (v) => indentLess(v.cm));
  btn('paperclip', t('cmd.attach'), (v) => openAttachSheet(app, v), false);
  btn('keyboard-off', t('mobile.hideKeyboard'), (v) => v.editor.blur(), false);

  // visible solo mientras el editor tiene foco
  const update = () => {
    const v = view();
    const on = Platform.isPhone && !!v && v.cm.hasFocus;
    if (on === document.body.hasClass('mobile-editing')) return;
    document.body.toggleClass('mobile-editing', on);
    // el editor se achicó: que el cursor siga a la vista
    if (on) requestAnimationFrame(() => v!.cm.dispatch({ effects: EditorView.scrollIntoView(v!.cm.state.selection.main.head) }));
  };
  document.addEventListener('focusin', update);
  // al arrancar el layout le da foco al editor sin teclado (iOS no lo abre sin un toque): no mostrar la barra
  app.workspace.onLayoutReady(() => { if (Platform.isPhone) view()?.editor.blur(); });
  document.addEventListener('focusout', () => setTimeout(update));
}

/** Hoja "Adjuntar": Fotos, Cámara o Archivos. */
export function openAttachSheet(app: App, v: MarkdownView): void {
  const m = new Modal(app);
  m.setTitle(t('mobile.attachTitle'));
  m.modalEl.addClass('mobile-sheet');
  const pick = (icon: string, label: string, attr: Record<string, string | boolean>) => {
    const b = m.contentEl.createEl('button', { cls: 'mobile-sheet-option' });
    setIcon(b.createSpan('mobile-sheet-option-icon'), icon);
    b.createSpan({ text: label });
    b.addEventListener('click', () => {
      // en el DOM: Safari a veces no dispara `change` en inputs sueltos
      const input = document.body.createEl('input', { type: 'file', attr: { ...attr, hidden: true } });
      const done = () => input.detach();
      input.addEventListener('change', () => { void v.insertAttachments(Array.from(input.files ?? [])); done(); });
      input.addEventListener('cancel', done);
      input.click();
      m.close();
    });
  };
  // iOS convierte las HEIC a JPEG con accept="image/*"; si llega HEIC se guarda igual con su extensión
  pick('images', t('mobile.photos'), { accept: 'image/*', multiple: true });
  pick('camera', t('mobile.camera'), { accept: 'image/*', capture: 'environment' });
  pick('folder', t('mobile.files'), { multiple: true });
  m.open();
}
