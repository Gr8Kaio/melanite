import { EditorSelection } from '@codemirror/state';
import { undo, redo } from '@codemirror/commands';
import { EditorView } from '@codemirror/view';

export interface EditorPosition { line: number; ch: number }
export interface EditorRange { from: EditorPosition; to: EditorPosition }

/**
 * Editor con la API de Obsidian (líneas y columnas desde 0) sobre CodeMirror 6.
 * `cm` expone el EditorView para lo que la API no cubra.
 */
export class Editor {
  cm: EditorView;
  constructor(cm: EditorView) { this.cm = cm; }

  private get doc() { return this.cm.state.doc; }

  posToOffset(pos: EditorPosition): number {
    const line = this.doc.line(Math.min(this.doc.lines, Math.max(1, pos.line + 1)));
    return Math.min(line.to, line.from + Math.max(0, pos.ch));
  }
  offsetToPos(offset: number): EditorPosition {
    const line = this.doc.lineAt(Math.min(this.doc.length, Math.max(0, offset)));
    return { line: line.number - 1, ch: offset - line.from };
  }

  getValue(): string { return this.doc.toString(); }
  setValue(text: string): void { this.cm.dispatch({ changes: { from: 0, to: this.doc.length, insert: text } }); }
  getLine(n: number): string { return n >= 0 && n < this.doc.lines ? this.doc.line(n + 1).text : ''; }
  setLine(n: number, text: string): void {
    const line = this.doc.line(n + 1);
    this.cm.dispatch({ changes: { from: line.from, to: line.to, insert: text } });
  }
  lineCount(): number { return this.doc.lines; }
  lastLine(): number { return this.doc.lines - 1; }

  getRange(from: EditorPosition, to: EditorPosition): string { return this.doc.sliceString(this.posToOffset(from), this.posToOffset(to)); }
  replaceRange(text: string, from: EditorPosition, to?: EditorPosition): void {
    const a = this.posToOffset(from);
    this.cm.dispatch({ changes: { from: a, to: to ? this.posToOffset(to) : a, insert: text } });
  }

  getSelection(): string {
    const r = this.cm.state.selection.main;
    return this.doc.sliceString(r.from, r.to);
  }
  somethingSelected(): boolean { return !this.cm.state.selection.main.empty; }
  replaceSelection(text: string): void {
    this.cm.dispatch(this.cm.state.replaceSelection(text));
  }
  listSelections(): { anchor: EditorPosition; head: EditorPosition }[] {
    return this.cm.state.selection.ranges.map((r) => ({ anchor: this.offsetToPos(r.anchor), head: this.offsetToPos(r.head) }));
  }

  getCursor(which: 'from' | 'to' | 'head' | 'anchor' = 'head'): EditorPosition {
    const r = this.cm.state.selection.main;
    return this.offsetToPos(r[which]);
  }
  setCursor(pos: EditorPosition | number, ch?: number): void {
    const p = typeof pos === 'number' ? { line: pos, ch: ch ?? 0 } : pos;
    const off = this.posToOffset(p);
    this.cm.dispatch({ selection: { anchor: off }, scrollIntoView: true });
  }
  setSelection(anchor: EditorPosition, head?: EditorPosition): void {
    this.cm.dispatch({ selection: EditorSelection.single(this.posToOffset(anchor), this.posToOffset(head ?? anchor)), scrollIntoView: true });
  }

  focus(): void { this.cm.focus(); }
  blur(): void { this.cm.contentDOM.blur(); }
  hasFocus(): boolean { return this.cm.hasFocus; }
  undo(): void { undo(this.cm); }
  redo(): void { redo(this.cm); }
  scrollIntoView(range: EditorRange, center = false): void {
    const pos = this.posToOffset(range.from);
    this.cm.dispatch({ effects: EditorView.scrollIntoView(pos, { y: center ? 'center' : 'nearest' }) });
  }
}
