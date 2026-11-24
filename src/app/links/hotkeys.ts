import type { App } from '../app';
import { SettingTab } from '../views/settings';
import { hotkeyLabel, isMac, type Command, type Hotkey, type Modifier } from '../commands';
import { setIcon } from '../ui/icons';
import { Notice } from '../ui/modal';
import { t } from '../i18n';

const CONFIG = 'hotkeys.json';

/** Carga .melanite/hotkeys.json en app.commands.customKeys. */
export async function loadHotkeys(app: App): Promise<void> {
  const data = await app.readConfig<Record<string, Hotkey[]>>(CONFIG);
  if (data && typeof data === 'object') app.commands.customKeys = data;
}

/** Tecla apretada → Hotkey (null si es solo un modificador). */
export function hotkeyFromEvent(e: KeyboardEvent): Hotkey | null {
  if (['Control', 'Shift', 'Alt', 'Meta', 'Dead', 'Unidentified'].includes(e.key)) return null;
  const modifiers: Modifier[] = [];
  if (isMac ? e.metaKey : e.ctrlKey) modifiers.push('Mod');
  if (isMac && e.ctrlKey) modifiers.push('Ctrl');
  if (!isMac && e.metaKey) modifiers.push('Meta');
  if (e.altKey) modifiers.push('Alt');
  if (e.shiftKey) modifiers.push('Shift');
  // con Shift/Alt e.key cambia: para letras y números usamos la tecla física
  const code = /^Key([A-Z])$/.exec(e.code)?.[1].toLowerCase() ?? /^Digit(\d)$/.exec(e.code)?.[1];
  const key = code ?? (e.key.length === 1 ? e.key.toLowerCase() : e.key);
  return { modifiers, key };
}

const same = (a: Hotkey, b: Hotkey) => a.key.toLowerCase() === b.key.toLowerCase() && [...a.modifiers].sort().join() === [...b.modifiers].sort().join();

export class HotkeysSettingTab extends SettingTab {
  private filter = '';
  constructor(app: App) {
    super(app);
    this.id = 'hotkeys';
    this.name = t('hotkeys.title');
  }

  display(): void {
    const el = this.containerEl;
    const search = el.createEl('input', { type: 'search', cls: 'ml-hotkey-filter', placeholder: t('hotkeys.filter'), value: this.filter, attr: { 'aria-label': t('hotkeys.filter') } });
    const list = el.createDiv('ml-hotkey-list');
    search.addEventListener('input', () => { this.filter = search.value; this.drawList(list); });
    this.drawList(list);
  }

  private drawList(list: HTMLElement): void {
    list.empty();
    const cmds = this.app.commands;
    const q = this.filter.toLowerCase();
    const all = Object.values(cmds.commands).filter((c) => !q || c.name.toLowerCase().includes(q) || cmds.hotkeysFor(c).some((h) => hotkeyLabel(h).toLowerCase().includes(q)))
      .sort((a, b) => a.name.localeCompare(b.name));
    for (const cmd of all) this.drawRow(list, cmd);
  }

  private drawRow(list: HTMLElement, cmd: Command): void {
    const cmds = this.app.commands;
    const row = list.createDiv({ cls: 'setting-item ml-hotkey-row', attr: { 'data-command': cmd.id } });
    const info = row.createDiv('setting-item-info');
    info.createDiv({ cls: 'setting-item-name', text: cmd.name });
    const custom = cmd.id in cmds.customKeys;
    if (custom) info.createDiv({ cls: 'setting-item-description', text: t('hotkeys.custom') });
    const ctl = row.createDiv('setting-item-control ml-hotkey-control');
    const keys = cmds.hotkeysFor(cmd);
    for (const h of keys) {
      const chip = ctl.createDiv('ml-hotkey');
      chip.createSpan({ text: hotkeyLabel(h) });
      const x = chip.createDiv({ cls: 'clickable-icon ml-hotkey-remove', attr: { 'aria-label': t('hotkeys.remove', { key: hotkeyLabel(h) }) } });
      setIcon(x, 'x');
      x.addEventListener('click', () => this.save(cmd, keys.filter((k) => k !== h)));
    }
    if (!keys.length) ctl.createSpan({ cls: 'ml-hotkey-none', text: t('hotkeys.none') });
    if (custom) {
      const reset = ctl.createDiv({ cls: 'clickable-icon', attr: { 'aria-label': t('hotkeys.reset') } });
      setIcon(reset, 'undo');
      reset.addEventListener('click', () => this.save(cmd, null));
    }
    const add = ctl.createDiv({ cls: 'clickable-icon ml-hotkey-add', attr: { 'aria-label': t('hotkeys.add') } });
    setIcon(add, 'plus');
    add.addEventListener('click', () => this.capture(row, ctl, cmd, keys));
  }

  /** Espera la próxima combinación de teclas (Esc cancela). */
  private capture(row: HTMLElement, ctl: HTMLElement, cmd: Command, keys: Hotkey[]): void {
    ctl.empty();
    ctl.createDiv({ cls: 'ml-hotkey is-capturing', text: t('hotkeys.press') });
    row.addClass('is-capturing');
    const done = () => { window.removeEventListener('keydown', onKey, true); this.redraw(); };
    const onKey = (e: KeyboardEvent) => {
      e.preventDefault();
      e.stopImmediatePropagation();
      if (e.key === 'Escape') { done(); return; }
      const h = hotkeyFromEvent(e);
      if (!h) return;
      window.removeEventListener('keydown', onKey, true);
      const clash = Object.values(this.app.commands.commands).find((c) => c.id !== cmd.id && this.app.commands.hotkeysFor(c).some((x) => same(x, h)));
      if (clash) new Notice(t('hotkeys.clash', { key: hotkeyLabel(h), name: clash.name }));
      void this.save(cmd, keys.some((k) => same(k, h)) ? keys : [...keys, h]);
    };
    window.addEventListener('keydown', onKey, true);
  }

  private redraw(): void {
    const list = this.containerEl.querySelector<HTMLElement>('.ml-hotkey-list');
    if (list) this.drawList(list);
  }

  /** null = volver a los de fábrica. */
  private async save(cmd: Command, keys: Hotkey[] | null): Promise<void> {
    const ck = this.app.commands.customKeys;
    const def = cmd.hotkeys ?? [];
    if (keys === null || (keys.length === def.length && keys.every((k, i) => same(k, def[i])))) delete ck[cmd.id];
    else ck[cmd.id] = keys;
    this.redraw();
    await this.app.writeConfig(CONFIG, ck);
  }
}
