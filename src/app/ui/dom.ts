/**
 * Helpers de DOM con la misma forma que los de Obsidian (createEl, createDiv,
 * empty, setText, addClass…), agregados a HTMLElement para que la app y los
 * plugins armen UI igual.
 */
export interface DomElementInfo {
  cls?: string | string[];
  text?: string | DocumentFragment;
  attr?: Record<string, string | number | boolean | null>;
  title?: string;
  parent?: Node;
  value?: string;
  type?: string;
  placeholder?: string;
  href?: string;
  prepend?: boolean;
}

type Info = DomElementInfo | string;

declare global {
  interface Node {
    empty(): void;
    detach(): void;
  }
  interface Element {
    setText(text: string | DocumentFragment): void;
    addClass(...cls: string[]): void;
    removeClass(...cls: string[]): void;
    toggleClass(cls: string | string[], value: boolean): void;
    hasClass(cls: string): boolean;
    setAttr(name: string, value: string | number | boolean | null): void;
  }
  interface HTMLElement {
    createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: Info, cb?: (el: HTMLElementTagNameMap[K]) => void): HTMLElementTagNameMap[K];
    createDiv(o?: Info, cb?: (el: HTMLDivElement) => void): HTMLDivElement;
    createSpan(o?: Info, cb?: (el: HTMLSpanElement) => void): HTMLSpanElement;
    show(): void;
    hide(): void;
    toggle(show: boolean): void;
  }
  function createEl<K extends keyof HTMLElementTagNameMap>(tag: K, o?: Info, cb?: (el: HTMLElementTagNameMap[K]) => void): HTMLElementTagNameMap[K];
  function createDiv(o?: Info, cb?: (el: HTMLDivElement) => void): HTMLDivElement;
  function createSpan(o?: Info, cb?: (el: HTMLSpanElement) => void): HTMLSpanElement;
  function createFragment(cb?: (el: DocumentFragment) => void): DocumentFragment;
}

function build<K extends keyof HTMLElementTagNameMap>(tag: K, o?: Info, cb?: (el: HTMLElementTagNameMap[K]) => void) {
  const el = document.createElement(tag);
  const info: DomElementInfo = typeof o === 'string' ? { cls: o } : (o ?? {});
  if (info.cls) el.className = Array.isArray(info.cls) ? info.cls.join(' ') : info.cls;
  if (info.text !== undefined) el.setText(info.text);
  if (info.title) el.title = info.title;
  if (info.attr) for (const [k, v] of Object.entries(info.attr)) el.setAttr(k, v);
  if (info.value !== undefined) (el as unknown as HTMLInputElement).value = info.value;
  if (info.type) el.setAttribute('type', info.type);
  if (info.placeholder) el.setAttribute('placeholder', info.placeholder);
  if (info.href) el.setAttribute('href', info.href);
  if (info.parent) {
    if (info.prepend) info.parent.insertBefore(el, info.parent.firstChild);
    else info.parent.appendChild(el);
  }
  cb?.(el);
  return el;
}

const P = HTMLElement.prototype;
const E = Element.prototype;
Node.prototype.empty = function (this: Node) { while (this.firstChild) this.removeChild(this.firstChild); };
Node.prototype.detach = function (this: Node) { this.parentNode?.removeChild(this); };
P.createEl = function (this: HTMLElement, tag: any, o?: Info, cb?: any) {
  const info: DomElementInfo = typeof o === 'string' ? { cls: o } : { ...(o ?? {}) };
  info.parent ??= this;
  return build(tag, info, cb) as any;
};
P.createDiv = function (this: HTMLElement, o?: Info, cb?: (el: HTMLDivElement) => void) { return this.createEl('div', o, cb); };
P.createSpan = function (this: HTMLElement, o?: Info, cb?: (el: HTMLSpanElement) => void) { return this.createEl('span', o, cb); };
E.setText = function (this: Element, text: string | DocumentFragment) {
  if (typeof text === 'string') this.textContent = text;
  else { this.empty(); this.appendChild(text); }
};
E.addClass = function (this: Element, ...cls: string[]) { this.classList.add(...cls.filter(Boolean)); };
E.removeClass = function (this: Element, ...cls: string[]) { this.classList.remove(...cls); };
E.toggleClass = function (this: Element, cls: string | string[], value: boolean) { for (const c of [cls].flat()) this.classList.toggle(c, value); };
E.hasClass = function (this: Element, cls: string) { return this.classList.contains(cls); };
E.setAttr = function (this: Element, name: string, value: string | number | boolean | null) {
  if (value === null || value === false) this.removeAttribute(name);
  else this.setAttribute(name, value === true ? '' : String(value));
};
P.show = function (this: HTMLElement) { this.style.display = ''; };
P.hide = function (this: HTMLElement) { this.style.display = 'none'; };
P.toggle = function (this: HTMLElement, show: boolean) { if (show) this.show(); else this.hide(); };

Object.assign(globalThis, {
  createEl: build,
  createDiv: (o?: Info, cb?: (el: HTMLDivElement) => void) => build('div', o, cb),
  createSpan: (o?: Info, cb?: (el: HTMLSpanElement) => void) => build('span', o, cb),
  createFragment: (cb?: (el: DocumentFragment) => void) => { const f = document.createDocumentFragment(); cb?.(f); return f; },
});

export {};
