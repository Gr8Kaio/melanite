import './dom';
import { setIcon } from './icons';
import { t } from '../i18n';
import type { App } from '../app';

// ---------------------------------------------------------------- Modal

const modalStack: Modal[] = [];
document.addEventListener('keydown', (e) => {
  const top = modalStack[modalStack.length - 1];
  if (top && e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); top.close(); }
}, true);

export class Modal {
  app: App;
  containerEl: HTMLDivElement;
  modalEl: HTMLDivElement;
  titleEl: HTMLDivElement;
  contentEl: HTMLDivElement;
  private isOpen = false;

  constructor(app: App) {
    this.app = app;
    this.containerEl = createDiv('modal-container');
    this.containerEl.createDiv('modal-bg').addEventListener('click', () => this.close());
    this.modalEl = this.containerEl.createDiv('modal');
    const close = this.modalEl.createDiv({ cls: 'modal-close-button clickable-icon', attr: { 'aria-label': t('common.close') } });
    setIcon(close, 'x');
    close.addEventListener('click', () => this.close());
    this.titleEl = this.modalEl.createDiv('modal-title');
    this.contentEl = this.modalEl.createDiv('modal-content');
  }

  open(): void {
    if (this.isOpen) return;
    this.isOpen = true;
    document.body.appendChild(this.containerEl);
    modalStack.push(this);
    this.onOpen();
  }

  close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    modalStack.splice(modalStack.indexOf(this), 1);
    this.containerEl.detach();
    this.onClose();
  }

  setTitle(title: string): this { this.titleEl.setText(title); return this; }
  setContent(content: string | DocumentFragment): this { this.contentEl.setText(content); return this; }

  onOpen(): void {}
  onClose(): void {}
}

/** Pide un texto. Resuelve null si se cancela. */
export function promptText(app: App, opts: { title: string; value?: string; placeholder?: string; cta?: string; selectUntil?: number }): Promise<string | null> {
  return new Promise((resolve) => {
    let result: string | null = null;
    const m = new Modal(app);
    m.setTitle(opts.title);
    const input = m.contentEl.createEl('input', { type: 'text', cls: 'prompt-input', value: opts.value ?? '', placeholder: opts.placeholder });
    const btns = m.contentEl.createDiv('modal-button-container');
    const ok = btns.createEl('button', { cls: 'mod-cta', text: opts.cta ?? t('common.ok') });
    btns.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => m.close());
    const submit = () => { result = input.value.trim(); m.close(); };
    ok.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); submit(); } });
    m.onClose = () => resolve(result || null);
    m.open();
    input.focus();
    input.setSelectionRange(0, opts.selectUntil ?? input.value.length);
  });
}

export function confirmDialog(app: App, opts: { title: string; message: string; cta: string; warning?: boolean }): Promise<boolean> {
  return new Promise((resolve) => {
    let ok = false;
    const m = new Modal(app);
    m.setTitle(opts.title);
    m.contentEl.createEl('p', { text: opts.message });
    const btns = m.contentEl.createDiv('modal-button-container');
    const yes = btns.createEl('button', { cls: opts.warning ? 'mod-warning' : 'mod-cta', text: opts.cta });
    btns.createEl('button', { text: t('common.cancel') }).addEventListener('click', () => m.close());
    yes.addEventListener('click', () => { ok = true; m.close(); });
    m.onClose = () => resolve(ok);
    m.open();
    yes.focus();
  });
}

// ---------------------------------------------------------------- Notice

let noticeContainer: HTMLElement | null = null;

export class Notice {
  noticeEl: HTMLDivElement;
  constructor(message: string | DocumentFragment, duration = 4500) {
    noticeContainer ??= document.body.createDiv('notice-container');
    this.noticeEl = noticeContainer.createDiv('notice');
    this.setMessage(message);
    this.noticeEl.addEventListener('click', () => this.hide());
    if (duration > 0) setTimeout(() => this.hide(), duration);
  }
  setMessage(message: string | DocumentFragment): this { this.noticeEl.setText(message); return this; }
  hide(): void { this.noticeEl.detach(); }
}

// ---------------------------------------------------------------- Menu

export class MenuItem {
  dom: HTMLDivElement;
  private iconEl: HTMLDivElement;
  private titleEl: HTMLDivElement;
  /** @internal */ callback: ((evt: MouseEvent | KeyboardEvent) => unknown) | null = null;
  /** @internal */ disabled = false;
  constructor() {
    this.dom = createDiv('menu-item');
    this.iconEl = this.dom.createDiv('menu-item-icon');
    this.titleEl = this.dom.createDiv('menu-item-title');
  }
  setTitle(title: string | DocumentFragment): this { this.titleEl.setText(title); return this; }
  setIcon(icon: string | null): this { if (icon) setIcon(this.iconEl, icon); else this.iconEl.empty(); return this; }
  setChecked(checked: boolean | null): this { this.dom.toggleClass('mod-checked', !!checked); if (checked) setIcon(this.iconEl, 'check'); return this; }
  setDisabled(disabled: boolean): this { this.disabled = disabled; this.dom.toggleClass('is-disabled', disabled); return this; }
  setWarning(warning: boolean): this { this.dom.toggleClass('mod-warning', warning); return this; }
  setSection(_section: string): this { return this; }
  /** Atajo de teclado a la derecha del título (vacío: nada). */
  setShortcut(text: string): this { if (text) this.dom.createDiv({ cls: 'menu-item-shortcut', text }); return this; }
  onClick(cb: (evt: MouseEvent | KeyboardEvent) => unknown): this { this.callback = cb; return this; }
}

export class Menu {
  dom: HTMLDivElement;
  private items: MenuItem[] = [];
  private hideCbs: (() => unknown)[] = [];
  private outside = (e: PointerEvent) => { if (!this.dom.contains(e.target as Node)) this.hide(); };
  private keys = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); this.hide(); } };

  constructor() {
    this.dom = createDiv('menu');
    this.dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  addItem(cb: (item: MenuItem) => unknown): this {
    const item = new MenuItem();
    cb(item);
    item.dom.addEventListener('click', (e) => {
      if (item.disabled) return;
      this.hide();
      item.callback?.(e);
    });
    this.items.push(item);
    this.dom.appendChild(item.dom);
    return this;
  }

  addSeparator(): this { this.dom.createDiv('menu-separator'); return this; }

  showAtMouseEvent(e: MouseEvent): this {
    e.preventDefault();
    return this.showAtPosition({ x: e.clientX, y: e.clientY });
  }

  showAtPosition(pos: { x: number; y: number }): this {
    if (!this.items.length) return this;
    document.body.appendChild(this.dom);
    const { innerWidth: w, innerHeight: h } = window;
    const r = this.dom.getBoundingClientRect();
    const x = Number.isFinite(pos.x) ? pos.x : (w - r.width) / 2;
    const y = Number.isFinite(pos.y) ? pos.y : (h - r.height) / 2;
    this.dom.style.left = `${Math.max(4, Math.min(x, w - r.width - 4))}px`;
    this.dom.style.top = `${Math.max(4, Math.min(y, h - r.height - 4))}px`;
    setTimeout(() => {
      document.addEventListener('pointerdown', this.outside, true);
      document.addEventListener('keydown', this.keys, true);
    });
    return this;
  }

  hide(): void {
    if (!this.dom.isConnected) return;
    this.dom.detach();
    document.removeEventListener('pointerdown', this.outside, true);
    document.removeEventListener('keydown', this.keys, true);
    for (const cb of this.hideCbs) cb();
  }

  onHide(cb: () => unknown): void { this.hideCbs.push(cb); }
}

/**
 * Menú contextual que también funciona en iOS (Safari no dispara `contextmenu`
 * con el toque largo): llama a `cb` con la posición del click derecho o del toque largo.
 */
export function onContextMenu(el: HTMLElement, cb: (pos: { x: number; y: number }, target: EventTarget | null) => void): void {
  el.addEventListener('contextmenu', (e) => { e.preventDefault(); cb({ x: e.clientX, y: e.clientY }, e.target); });
  let timer = 0;
  let start: { x: number; y: number } | null = null;
  el.addEventListener('touchstart', (e) => {
    if (e.touches.length !== 1) return;
    const touch = e.touches[0];
    start = { x: touch.clientX, y: touch.clientY };
    const target = e.target;
    timer = window.setTimeout(() => {
      timer = 0;
      navigator.vibrate?.(10);
      cb(start!, target);
    }, 500);
  }, { passive: true });
  const cancel = () => { if (timer) clearTimeout(timer); timer = 0; };
  el.addEventListener('touchmove', (e) => {
    const touch = e.touches[0];
    if (start && Math.hypot(touch.clientX - start.x, touch.clientY - start.y) > 10) cancel();
  }, { passive: true });
  el.addEventListener('touchend', (e) => { if (!timer && start) e.preventDefault(); cancel(); start = null; });
  el.addEventListener('touchcancel', cancel);
}
