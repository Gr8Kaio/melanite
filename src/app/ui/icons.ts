import {
  createElement, type IconNode,
  FilePlus, FolderPlus, Folder, FolderOpen, File, FileText, Image, ChevronRight, ChevronDown, Settings, X, Plus,
  PanelLeft, PanelRight, BookOpen, Pencil, Code, Trash2, Copy, Columns2, Rows2, Search, EllipsisVertical, Paperclip,
  ChevronsDownUp, Info, TriangleAlert, Lightbulb, Flame, Check, CircleQuestionMark, Quote, List, Bug, Star,
  Menu, Link, ExternalLink, FolderInput, Sun, Moon, Monitor, Undo2, CircleX, Clipboard, ListTodo, Bookmark,
} from 'lucide';

/** Íconos que usa la app; el resto del set de Lucide se carga bajo demanda. */
const core: Record<string, IconNode> = {
  'file-plus': FilePlus, 'folder-plus': FolderPlus, folder: Folder, 'folder-open': FolderOpen, file: File,
  'file-text': FileText, image: Image, 'chevron-right': ChevronRight, 'chevron-down': ChevronDown, settings: Settings,
  x: X, plus: Plus, 'panel-left': PanelLeft, 'panel-right': PanelRight, 'book-open': BookOpen, pencil: Pencil,
  code: Code, trash: Trash2, 'trash-2': Trash2, copy: Copy, 'columns-2': Columns2, 'rows-2': Rows2, search: Search,
  'more-vertical': EllipsisVertical, paperclip: Paperclip, 'chevrons-down-up': ChevronsDownUp,
  info: Info, 'alert-triangle': TriangleAlert, lightbulb: Lightbulb, flame: Flame,
  check: Check, 'help-circle': CircleQuestionMark, quote: Quote, list: List, bug: Bug, star: Star,
  menu: Menu, link: Link, 'external-link': ExternalLink, 'folder-input': FolderInput, sun: Sun, moon: Moon,
  monitor: Monitor, undo: Undo2, 'x-circle': CircleX, clipboard: Clipboard, 'list-todo': ListTodo, bookmark: Bookmark,
};

let all: Record<string, IconNode> | null = null;
const pascal = (id: string) => id.replace(/(^|-)(\w)/g, (_m, _d, c: string) => c.toUpperCase());

function svgFor(node: IconNode): SVGElement {
  const svg = createElement(node);
  svg.setAttribute('class', 'svg-icon');
  return svg;
}

/** Pone el ícono Lucide `id` (kebab-case, ej. "file-text") dentro de `el`. */
export function setIcon(el: HTMLElement, id: string): void {
  el.empty();
  const node = core[id] ?? all?.[pascal(id)];
  if (node) { el.appendChild(svgFor(node)); return; }
  void import('lucide').then((m) => {
    all = m.icons as Record<string, IconNode>;
    const n = all[pascal(id)];
    if (n && !el.firstChild) el.appendChild(svgFor(n));
  });
}
