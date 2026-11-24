import './dom';
import { setIcon } from './icons';

/** Fila de ajustes con la API encadenable de Obsidian: new Setting(el).setName().addToggle(…) */
export class Setting {
  settingEl: HTMLDivElement;
  infoEl: HTMLDivElement;
  nameEl: HTMLDivElement;
  descEl: HTMLDivElement;
  controlEl: HTMLDivElement;

  constructor(containerEl: HTMLElement) {
    this.settingEl = containerEl.createDiv('setting-item');
    this.infoEl = this.settingEl.createDiv('setting-item-info');
    this.nameEl = this.infoEl.createDiv('setting-item-name');
    this.descEl = this.infoEl.createDiv('setting-item-description');
    this.controlEl = this.settingEl.createDiv('setting-item-control');
  }

  setName(name: string | DocumentFragment): this { this.nameEl.setText(name); return this; }
  setDesc(desc: string | DocumentFragment): this { this.descEl.setText(desc); return this; }
  setClass(cls: string): this { this.settingEl.addClass(cls); return this; }
  setHeading(): this { this.settingEl.addClass('setting-item-heading'); return this; }
  setDisabled(disabled: boolean): this {
    this.settingEl.toggleClass('is-disabled', disabled);
    this.controlEl.querySelectorAll('input,select,button,textarea').forEach((el) => ((el as HTMLInputElement).disabled = disabled));
    return this;
  }

  addText(cb: (c: TextComponent) => unknown): this { cb(new TextComponent(this.controlEl)); return this; }
  addTextArea(cb: (c: TextAreaComponent) => unknown): this { cb(new TextAreaComponent(this.controlEl)); return this; }
  addToggle(cb: (c: ToggleComponent) => unknown): this { cb(new ToggleComponent(this.controlEl)); return this; }
  addDropdown(cb: (c: DropdownComponent) => unknown): this { cb(new DropdownComponent(this.controlEl)); return this; }
  addSlider(cb: (c: SliderComponent) => unknown): this { cb(new SliderComponent(this.controlEl)); return this; }
  addButton(cb: (c: ButtonComponent) => unknown): this { cb(new ButtonComponent(this.controlEl)); return this; }
  addExtraButton(cb: (c: ExtraButtonComponent) => unknown): this { cb(new ExtraButtonComponent(this.controlEl)); return this; }
  then(cb: (s: this) => unknown): this { cb(this); return this; }
}

abstract class ValueComponent<T, E extends HTMLElement> {
  abstract el: E;
  protected changeCb: ((v: T) => unknown) | null = null;
  abstract getValue(): T;
  abstract setValue(v: T): this;
  onChange(cb: (v: T) => unknown): this { this.changeCb = cb; return this; }
  setDisabled(d: boolean): this { (this.el as unknown as HTMLInputElement).disabled = d; return this; }
}

export class TextComponent extends ValueComponent<string, HTMLInputElement> {
  el: HTMLInputElement;
  get inputEl() { return this.el; }
  constructor(parent: HTMLElement) {
    super();
    this.el = parent.createEl('input', { type: 'text' });
    this.el.addEventListener('input', () => this.changeCb?.(this.el.value));
  }
  getValue() { return this.el.value; }
  setValue(v: string) { this.el.value = v; return this; }
  setPlaceholder(p: string) { this.el.placeholder = p; return this; }
}

export class TextAreaComponent extends ValueComponent<string, HTMLTextAreaElement> {
  el: HTMLTextAreaElement;
  get inputEl() { return this.el; }
  constructor(parent: HTMLElement) {
    super();
    this.el = parent.createEl('textarea');
    this.el.addEventListener('input', () => this.changeCb?.(this.el.value));
  }
  getValue() { return this.el.value; }
  setValue(v: string) { this.el.value = v; return this; }
  setPlaceholder(p: string) { this.el.placeholder = p; return this; }
}

export class ToggleComponent extends ValueComponent<boolean, HTMLDivElement> {
  el: HTMLDivElement;
  get toggleEl() { return this.el; }
  private value = false;
  constructor(parent: HTMLElement) {
    super();
    this.el = parent.createDiv({ cls: 'checkbox-container', attr: { role: 'switch', tabindex: 0 } });
    const flip = () => { this.setValue(!this.value); this.changeCb?.(this.value); };
    this.el.addEventListener('click', flip);
    this.el.addEventListener('keydown', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); flip(); } });
  }
  getValue() { return this.value; }
  setValue(v: boolean) {
    this.value = v;
    this.el.toggleClass('is-enabled', v);
    this.el.setAttr('aria-checked', String(v));
    return this;
  }
}

export class DropdownComponent extends ValueComponent<string, HTMLSelectElement> {
  el: HTMLSelectElement;
  get selectEl() { return this.el; }
  constructor(parent: HTMLElement) {
    super();
    this.el = parent.createEl('select', 'dropdown');
    this.el.addEventListener('change', () => this.changeCb?.(this.el.value));
  }
  addOption(value: string, display: string) { this.el.createEl('option', { value, text: display }); return this; }
  addOptions(opts: Record<string, string>) { for (const [v, d] of Object.entries(opts)) this.addOption(v, d); return this; }
  getValue() { return this.el.value; }
  setValue(v: string) { this.el.value = v; return this; }
}

export class SliderComponent extends ValueComponent<number, HTMLInputElement> {
  el: HTMLInputElement;
  get sliderEl() { return this.el; }
  private valueEl: HTMLSpanElement | null = null;
  constructor(parent: HTMLElement) {
    super();
    this.el = parent.createEl('input', { type: 'range', cls: 'slider' });
    this.el.addEventListener('input', () => { this.showValue(); this.changeCb?.(Number(this.el.value)); });
  }
  setLimits(min: number, max: number, step: number | 'any') {
    this.el.min = String(min); this.el.max = String(max); this.el.step = String(step);
    return this;
  }
  setDynamicTooltip() { this.valueEl = this.el.parentElement!.createSpan('slider-value'); this.showValue(); return this; }
  private showValue() { this.valueEl?.setText(this.el.value); }
  getValue() { return Number(this.el.value); }
  setValue(v: number) { this.el.value = String(v); this.showValue(); return this; }
}

export class ButtonComponent {
  buttonEl: HTMLButtonElement;
  constructor(parent: HTMLElement) { this.buttonEl = parent.createEl('button'); }
  setButtonText(text: string) { this.buttonEl.setText(text); return this; }
  setIcon(icon: string) { setIcon(this.buttonEl, icon); return this; }
  setCta() { this.buttonEl.addClass('mod-cta'); return this; }
  setWarning() { this.buttonEl.addClass('mod-warning'); return this; }
  setTooltip(tip: string) { this.buttonEl.setAttr('aria-label', tip); this.buttonEl.title = tip; return this; }
  setDisabled(d: boolean) { this.buttonEl.disabled = d; return this; }
  onClick(cb: (evt: MouseEvent) => unknown) { this.buttonEl.addEventListener('click', cb); return this; }
}

export class ExtraButtonComponent {
  extraSettingsEl: HTMLDivElement;
  constructor(parent: HTMLElement) { this.extraSettingsEl = parent.createDiv('clickable-icon extra-setting-button'); }
  setIcon(icon: string) { setIcon(this.extraSettingsEl, icon); return this; }
  setTooltip(tip: string) { this.extraSettingsEl.setAttr('aria-label', tip); this.extraSettingsEl.title = tip; return this; }
  setDisabled(d: boolean) { this.extraSettingsEl.toggleClass('is-disabled', d); return this; }
  onClick(cb: () => unknown) { this.extraSettingsEl.addEventListener('click', cb); return this; }
}
