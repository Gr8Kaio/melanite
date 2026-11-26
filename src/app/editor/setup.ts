import { Compartment, EditorState, type Extension } from '@codemirror/state';
import { EditorView, drawSelection, dropCursor, keymap, placeholder } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { HighlightStyle, indentOnInput, syntaxHighlighting } from '@codemirror/language';
import { markdown, markdownLanguage } from '@codemirror/lang-markdown';
import { languages } from '@codemirror/language-data';
import { closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { highlightSelectionMatches, searchKeymap } from '@codemirror/search';
import { classHighlighter, tags } from '@lezer/highlight';
import { melaniteSyntax } from './syntax';
import { livePreview } from './live-preview';

const markdownStyle = HighlightStyle.define([
  { tag: tags.heading, class: 'ml-heading' },
  ...[1, 2, 3, 4, 5, 6].map((n) => ({ tag: tags[`heading${n}` as 'heading1'], class: `ml-heading${n}` })),
  { tag: tags.emphasis, class: 'ml-em' },
  { tag: tags.strong, class: 'ml-strong' },
  { tag: tags.strikethrough, class: 'ml-strike' },
  { tag: tags.link, class: 'ml-link-text' },
  { tag: tags.url, class: 'ml-url' },
  { tag: tags.monospace, class: 'ml-code' },
  { tag: tags.quote, class: 'ml-quote-text' },
  { tag: tags.processingInstruction, class: 'ml-formatting' },
  { tag: tags.meta, class: 'ml-meta' },
  { tag: tags.comment, class: 'ml-comment' },
  { tag: tags.labelName, class: 'ml-tag-text' },
  { tag: tags.special(tags.content), class: 'ml-math-src' },
]);

/** Compartimentos que la vista cambia en caliente. */
export const modeCompartment = new Compartment();
export const pluginCompartment = new Compartment();
export const optionsCompartment = new Compartment();

export const markdownExtension = markdown({ base: markdownLanguage, codeLanguages: languages, extensions: [melaniteSyntax] });

export function editorOptions(opts: { spellcheck: boolean; placeholder: string }): Extension {
  return [
    EditorView.contentAttributes.of({ spellcheck: String(opts.spellcheck), autocorrect: opts.spellcheck ? 'on' : 'off', autocapitalize: 'sentences' }),
    placeholder(opts.placeholder),
  ];
}

export function createEditorState(doc: string, opts: {
  live: boolean;
  context: Extension;
  options: Extension;
  plugins: Extension;
  extra: Extension;
}): EditorState {
  return EditorState.create({
    doc,
    extensions: [
      history(),
      drawSelection(),
      dropCursor(),
      indentOnInput(),
      closeBrackets(),
      highlightSelectionMatches(),
      EditorState.allowMultipleSelections.of(true),
      EditorView.lineWrapping,
      markdownExtension,
      syntaxHighlighting(markdownStyle),
      syntaxHighlighting(classHighlighter),
      keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, indentWithTab]),
      opts.context,
      opts.extra,
      optionsCompartment.of(opts.options),
      modeCompartment.of(opts.live ? livePreview() : []),
      pluginCompartment.of(opts.plugins),
    ],
  });
}

export { livePreview };
