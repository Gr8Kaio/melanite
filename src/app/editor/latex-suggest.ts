import { autocompletion } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';
import { Plugin } from '../../api/plugin';
import { t } from '../i18n';
import { latexSource } from './latex-complete';

/** Plugin interno: sugerencias de LaTeX dentro de fórmulas (la lógica está en latex-complete.ts). */
export class LatexSuggestPlugin extends Plugin {
  onload(): void {
    const data = [{ autocomplete: latexSource }];
    this.registerEditorExtension([
      EditorState.languageData.of(() => data),
      autocompletion(),
    ]);
  }
}

export const latexManifest = () => ({
  id: 'latex-suggest', name: t('latex.plugin'), version: '1.0.0', description: t('latex.plugin.desc'), author: 'Melanite',
});
