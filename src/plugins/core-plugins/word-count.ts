import { Plugin, MarkdownView } from '../../api';
import { t } from '../../app/i18n';

export const manifest = () => ({ id: 'word-count', name: t('plugins.wordCount.name'), description: t('plugins.wordCount.desc'), version: '1.0.0' });

export const countWords = (text: string) => (text.match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? []).length;

/** Palabras y caracteres de la nota activa (o de la selección) en la barra de estado. */
export default class WordCountPlugin extends Plugin {
  onload() {
    const el = this.addStatusBarItem();
    el.addClass('plugin-word-count');
    const update = () => {
      const md = this.app.workspace.getActiveViewOfType(MarkdownView);
      if (!md) { el.setText(''); return; }
      const text = md.editor.getSelection() || md.getViewData();
      el.setText(t('status.count', { words: countWords(text), chars: text.length }));
    };
    for (const ev of ['editor-change', 'editor-selection-change', 'active-leaf-change', 'file-open']) {
      this.registerEvent(this.app.workspace.on(ev, update));
    }
    this.app.workspace.onLayoutReady(update);
  }
}
