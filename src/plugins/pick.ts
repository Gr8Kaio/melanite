import { Modal, type App } from '../api';
import { t } from '../app/i18n';

/**
 * Modal con filtro para elegir un ítem (los core plugins lo usan mientras no haya SuggestModal en la API).
 * Resuelve null si se cancela.
 */
export function pickItem<T>(app: App, items: T[], label: (item: T) => string, placeholder = ''): Promise<T | null> {
  return new Promise((resolve) => {
    let chosen: T | null = null;
    let selected = 0;
    let shown: T[] = [];
    const m = new Modal(app);
    m.modalEl.addClass('mod-pick');
    const input = m.contentEl.createEl('input', { type: 'text', cls: 'prompt-input', placeholder });
    const list = m.contentEl.createDiv('suggestion-list');
    const choose = (item: T | undefined) => { if (item === undefined) return; chosen = item; m.close(); };
    const draw = () => {
      const q = input.value.trim().toLowerCase();
      shown = items.filter((i) => label(i).toLowerCase().includes(q));
      selected = Math.min(selected, Math.max(0, shown.length - 1));
      list.empty();
      if (!shown.length) list.createDiv({ cls: 'suggestion-empty', text: t('plugins.pick.empty') });
      shown.forEach((item, i) => {
        const el = list.createDiv({ cls: 'suggestion-item', text: label(item) });
        el.toggleClass('is-selected', i === selected);
        el.addEventListener('click', () => choose(item));
      });
    };
    input.addEventListener('input', () => { selected = 0; draw(); });
    input.addEventListener('keydown', (e) => {
      if (e.isComposing) return;
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        selected = (selected + (e.key === 'ArrowDown' ? 1 : -1) + shown.length) % Math.max(1, shown.length);
        draw();
        list.querySelector('.is-selected')?.scrollIntoView({ block: 'nearest' });
      } else if (e.key === 'Enter') { e.preventDefault(); choose(shown[selected]); }
    });
    m.onClose = () => resolve(chosen);
    draw();
    m.open();
    input.focus();
  });
}
