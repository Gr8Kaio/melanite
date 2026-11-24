import type { MarkdownConfig, InlineContext, BlockContext, Line } from '@lezer/markdown';
import { tags } from '@lezer/highlight';

/**
 * Sintaxis extra para el parser Markdown de CodeMirror:
 * [[wikilinks]], ![[embeds]], $math$, $$bloques$$, ==resaltado==, #tags,
 * %%comentarios%% y frontmatter YAML al principio del archivo.
 */

const OPEN_BRACKET = 91, BANG = 33, DOLLAR = 36, EQ = 61, HASH = 35, PERCENT = 37;
const TAG_CHAR = /[\p{L}\p{N}_/\-]/u;

function wiki(cx: InlineContext, next: number, pos: number): number {
  const embed = next === BANG;
  const open = embed ? pos + 1 : pos;
  if (cx.char(open) !== OPEN_BRACKET || cx.char(open + 1) !== OPEN_BRACKET) return -1;
  if (!embed && next !== OPEN_BRACKET) return -1;
  const rest = cx.slice(open + 2, cx.end);
  const close = rest.indexOf(']]');
  if (close <= 0) return -1;
  const inner = rest.slice(0, close);
  if (inner.includes('\n') || inner.includes('[[')) return -1;
  const end = open + 2 + close + 2;
  return cx.addElement(cx.elt(embed ? 'Embed' : 'WikiLink', pos, end, [
    cx.elt('WikiMark', pos, open + 2),
    cx.elt('WikiTarget', open + 2, end - 2),
    cx.elt('WikiMark', end - 2, end),
  ]));
}

function inlineMath(cx: InlineContext, next: number, pos: number): number {
  if (next !== DOLLAR) return -1;
  if (cx.char(pos + 1) === DOLLAR) {
    const close = cx.slice(pos + 2, cx.end).indexOf('$$');
    if (close <= 0) return -1;
    const end = pos + 2 + close + 2;
    return cx.addElement(cx.elt('InlineMath', pos, end, [cx.elt('MathMark', pos, pos + 2), cx.elt('MathMark', end - 2, end)]));
  }
  const first = cx.char(pos + 1);
  if (first === -1 || first === 32 || first === 9) return -1;
  const rest = cx.slice(pos + 1, cx.end);
  for (let i = 0; i < rest.length; i++) {
    const c = rest[i];
    if (c === '\n') return -1;
    if (c === '\\') { i++; continue; }
    if (c === '$') {
      if (i === 0 || /\s/.test(rest[i - 1]) || /\d/.test(rest[i + 1] ?? '')) return -1;
      const end = pos + 1 + i + 1;
      return cx.addElement(cx.elt('InlineMath', pos, end, [cx.elt('MathMark', pos, pos + 1), cx.elt('MathMark', end - 1, end)]));
    }
  }
  return -1;
}

function delimited(name: string, mark: string, ch: number, delim: string, allowSpace = false) {
  return (cx: InlineContext, next: number, pos: number): number => {
    if (next !== ch || cx.slice(pos, pos + delim.length) !== delim) return -1;
    const start = pos + delim.length;
    const close = cx.slice(start, cx.end).indexOf(delim);
    if (close <= 0) return -1;
    const inner = cx.slice(start, start + close);
    if (!allowSpace && /^\s|\s$/.test(inner)) return -1;
    const end = start + close + delim.length;
    return cx.addElement(cx.elt(name, pos, end, [cx.elt(mark, pos, start), cx.elt(mark, end - delim.length, end)]));
  };
}

function tag(cx: InlineContext, next: number, pos: number): number {
  if (next !== HASH) return -1;
  const prev = cx.char(pos - 1);
  if (prev !== -1 && !/\s/.test(String.fromCharCode(prev))) return -1;
  let end = pos + 1;
  while (end < cx.end && TAG_CHAR.test(cx.slice(end, end + 1))) end++;
  const body = cx.slice(pos + 1, end);
  if (!body || /^\d+$/.test(body)) return -1;
  return cx.addElement(cx.elt('Tag', pos, end));
}

function frontmatter(cx: BlockContext, line: Line): boolean {
  if (cx.lineStart !== 0 || !/^---\s*$/.test(line.text)) return false;
  const from = 0;
  const children = [cx.elt('FrontmatterMark', 0, line.text.length)];
  let end = line.text.length;
  while (cx.nextLine()) {
    end = cx.lineStart + line.text.length;
    if (/^(---|\.\.\.)\s*$/.test(line.text)) {
      children.push(cx.elt('FrontmatterMark', cx.lineStart, end));
      cx.nextLine();
      break;
    }
  }
  cx.addElement(cx.elt('Frontmatter', from, end, children));
  return true;
}

function blockMath(cx: BlockContext, line: Line): boolean {
  const text = line.text.slice(line.pos);
  if (!text.startsWith('$$')) return false;
  const from = cx.lineStart + line.pos;
  let end = cx.lineStart + line.text.length;
  const singleLine = /\$\$\s*$/.test(text.slice(2)) && text.trim().length > 4;
  if (singleLine) cx.nextLine();
  else {
    while (cx.nextLine()) {
      end = cx.lineStart + line.text.length;
      if (/\$\$\s*$/.test(line.text)) { cx.nextLine(); break; }
    }
  }
  cx.addElement(cx.elt('BlockMath', from, end));
  return true;
}

const LIST_BEGIN = /^\\begin\{(itemize|enumerate|description)\}/;
const LIST_END = /^\\end\{(itemize|enumerate|description)\}/;

/** Bloque `\begin{itemize}` … `\end{itemize}` (anidable); el live preview lo muestra como lista. */
function latexEnv(cx: BlockContext, line: Line): boolean {
  if (!/^\\begin\{(itemize|enumerate|description)\}\s*$/.test(line.text.slice(line.pos))) return false;
  const from = cx.lineStart + line.pos;
  let end = from;
  let depth = 0;
  do {
    const t = line.text.trim();
    if (LIST_BEGIN.test(t)) depth++;
    else if (LIST_END.test(t)) depth--;
    end = cx.lineStart + line.text.length;
    if (depth === 0) { cx.nextLine(); break; }
  } while (cx.nextLine());
  cx.addElement(cx.elt('LatexEnv', from, end));
  return true;
}

export const melaniteSyntax: MarkdownConfig = {
  defineNodes: [
    { name: 'WikiLink', style: tags.link },
    { name: 'Embed', style: tags.link },
    { name: 'WikiMark', style: tags.processingInstruction },
    'WikiTarget',
    { name: 'InlineMath', style: tags.special(tags.content) },
    { name: 'BlockMath', block: true, style: tags.special(tags.content) },
    { name: 'MathMark', style: tags.processingInstruction },
    'Highlight',
    { name: 'HighlightMark', style: tags.processingInstruction },
    { name: 'Comment', style: tags.comment },
    { name: 'CommentMark', style: tags.comment },
    { name: 'Tag', style: tags.labelName },
    { name: 'Frontmatter', block: true, style: tags.meta },
    { name: 'FrontmatterMark', style: tags.processingInstruction },
    { name: 'LatexEnv', block: true, style: tags.special(tags.content) },
  ],
  parseInline: [
    { name: 'WikiLink', parse: wiki, before: 'Link' },
    { name: 'InlineMath', parse: inlineMath, before: 'Escape' },
    { name: 'Highlight', parse: delimited('Highlight', 'HighlightMark', EQ, '=='), before: 'Emphasis' },
    { name: 'Comment', parse: delimited('Comment', 'CommentMark', PERCENT, '%%', true), before: 'Emphasis' },
    { name: 'Tag', parse: tag },
  ],
  parseBlock: [
    { name: 'Frontmatter', parse: frontmatter, before: 'FencedCode' },
    { name: 'BlockMath', parse: blockMath, before: 'FencedCode', endLeaf: (_cx, line) => line.text.slice(line.pos).startsWith('$$') },
    { name: 'LatexEnv', parse: latexEnv, before: 'FencedCode', endLeaf: (_cx, line) => LIST_BEGIN.test(line.text.slice(line.pos)) },
  ],
};
