import type { App } from './app';
import type { TFile } from '../core/vault';
import { Component } from '../core/component';
import { MarkdownRenderer } from './render/renderer';
import { paginate } from './render/pages';
import { Modal, Notice } from './ui/modal';
import { setIcon } from './ui/icons';
import { registerStrings, t } from './i18n';

registerStrings({
  en: { 'pdf.export': 'Export to PDF', 'pdf.exportFolder': 'Export folder to PDF', 'pdf.saved': 'PDF saved', 'pdf.empty': 'No notes to export', 'pdf.pickHint': 'Tick the notes to include and drag them to set the order.', 'pdf.all': 'All' },
  es: { 'pdf.export': 'Exportar a PDF', 'pdf.exportFolder': 'Exportar carpeta a PDF', 'pdf.saved': 'PDF guardado', 'pdf.empty': 'No hay notas para exportar', 'pdf.pickHint': 'Marcá las notas que van y arrastralas para elegir el orden.', 'pdf.all': 'Todas' },
});

type DesktopPdf = { pdf?: { save(name: string): Promise<string | null> } };

/**
 * Exporta notas a un PDF con las mismas hojas que la vista previa lado a lado (cada nota empieza en hoja nueva).
 * Escritorio: guarda el archivo directo (printToPDF) y lo abre. Web/iPhone: diálogo de impresión → "Guardar como PDF".
 */
export async function exportPdf(app: App, files: TFile[], name: string): Promise<void> {
  if (!files.length) { new Notice(t('pdf.empty')); return; }
  const body = document.body;
  const dark = body.hasClass('theme-dark');
  // el papel sale siempre claro. ponytail: la app se ve clara mientras dura el diálogo; si molesta, renderizar en un iframe
  if (dark) { body.removeClass('theme-dark'); body.addClass('theme-light'); }
  const root = body.createDiv('ml-print');
  const component = new Component();
  const title = document.title;
  const cleanup = () => {
    root.remove();
    component.unload();
    body.removeClass('is-printing');
    document.title = title;
    if (dark) { body.removeClass('theme-light'); body.addClass('theme-dark'); }
  };
  try {
    for (const file of files) {
      const el = createDiv();
      await MarkdownRenderer.render(app, await app.vault.cachedRead(file), el, file.path, component);
      await Promise.all(Array.from(el.querySelectorAll('img')).map((img) => img.decode().catch(() => undefined)));
      const pages = root.createDiv('ml-pages');
      paginate(el, pages);
    }
    document.title = name; // nombre sugerido en "Guardar como PDF"
    body.addClass('is-printing');
    const desktop = (window as unknown as { melaniteDesktop?: DesktopPdf }).melaniteDesktop;
    if (desktop?.pdf) {
      try { if (await desktop.pdf.save(name)) new Notice(t('pdf.saved')); } finally { cleanup(); }
    } else {
      window.addEventListener('afterprint', cleanup, { once: true });
      window.print();
    }
  } catch (e) {
    cleanup();
    throw e;
  }
}

/** Selección y orden guardados de una carpeta: `order` = rutas en el orden elegido, `off` = las que no van. */
export interface PdfPick { order: string[]; off: string[] }

/** Junta lo guardado con las notas que hay hoy: primero el orden guardado, después las nuevas (marcadas) en orden de ruta. */
export function arrangeNotes(paths: string[], saved: PdfPick | null): { path: string; on: boolean }[] {
  const exists = new Set(paths);
  const first = (saved?.order ?? []).filter((p) => exists.has(p));
  const seen = new Set(first);
  const off = new Set(saved?.off ?? []);
  return [...first, ...paths.filter((p) => !seen.has(p))].map((path) => ({ path, on: !off.has(path) }));
}

const pickKey = (folder: string) => `melanite:pdf-pick:${folder}`;

/** Elegir qué notas de la carpeta van al PDF (casillas) y en qué orden (arrastrar). Queda guardado por carpeta en este dispositivo. */
export function exportFolderPdf(app: App, folderPath: string, name: string): void {
  const files = notesIn(app, folderPath);
  if (!files.length) { new Notice(t('pdf.empty')); return; }
  let saved: PdfPick | null = null;
  try { saved = JSON.parse(localStorage.getItem(pickKey(folderPath)) ?? 'null'); } catch { /* sin guardar */ }
  const prefix = folderPath ? `${folderPath}/` : '';

  const m = new Modal(app);
  m.modalEl.addClass('ml-pdf-pick');
  m.titleEl.setText(t('pdf.exportFolder'));
  m.contentEl.createDiv({ cls: 'setting-item-description', text: t('pdf.pickHint') });
  const all = m.contentEl.createEl('label', { cls: 'ml-pdf-all' });
  const allBox = all.createEl('input', { type: 'checkbox' });
  all.createSpan({ text: t('pdf.all') });
  const list = m.contentEl.createDiv('ml-pdf-list');
  const btns = m.contentEl.createDiv('modal-button-container');
  const go = btns.createEl('button', { cls: 'mod-cta', text: t('pdf.export') });

  const boxes = () => Array.from(list.querySelectorAll<HTMLInputElement>('input[type=checkbox]'));
  const sync = () => {
    const b = boxes(), n = b.filter((x) => x.checked).length;
    allBox.checked = n === b.length;
    allBox.indeterminate = n > 0 && n < b.length;
    go.disabled = n === 0;
    go.setText(`${t('pdf.export')} (${n})`);
  };
  allBox.addEventListener('change', () => { for (const b of boxes()) b.checked = allBox.checked; sync(); });

  let dragged: HTMLElement | null = null;
  for (const { path, on } of arrangeNotes(files.map((f) => f.path), saved)) {
    const row = list.createDiv({ cls: 'ml-pdf-row', attr: { draggable: 'true', 'data-path': path } });
    setIcon(row.createSpan({ cls: 'ml-pdf-grip', attr: { 'aria-hidden': 'true' } }), 'grip-vertical');
    const label = row.createEl('label');
    const box = label.createEl('input', { type: 'checkbox' });
    box.checked = on;
    box.addEventListener('change', sync);
    label.createSpan({ text: path.slice(prefix.length).replace(/\.md$/, '') });
    row.addEventListener('dragstart', (e) => { dragged = row; row.addClass('is-dragging'); e.dataTransfer?.setData('text/plain', path); });
    row.addEventListener('dragend', () => { row.removeClass('is-dragging'); dragged = null; });
    row.addEventListener('dragover', (e) => {
      if (!dragged || dragged === row) return;
      e.preventDefault();
      const r = row.getBoundingClientRect();
      list.insertBefore(dragged, e.clientY < r.top + r.height / 2 ? row : row.nextSibling);
    });
  }
  sync();

  go.addEventListener('click', () => {
    const rows = Array.from(list.querySelectorAll<HTMLElement>('.ml-pdf-row'));
    const pick: PdfPick = { order: rows.map((r) => r.dataset.path!), off: rows.filter((r) => !r.querySelector('input')!.checked).map((r) => r.dataset.path!) };
    localStorage.setItem(pickKey(folderPath), JSON.stringify(pick));
    const off = new Set(pick.off);
    const chosen = pick.order.filter((p) => !off.has(p)).map((p) => app.vault.getFileByPath(p)).filter((f): f is TFile => !!f);
    m.close();
    void exportPdf(app, chosen, name);
  });
  m.open();
}

/** Notas de una carpeta (y subcarpetas) en orden de ruta, como en el explorador. */
export function notesIn(app: App, folderPath: string): TFile[] {
  const prefix = folderPath ? `${folderPath}/` : '';
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix) && !/(^|\/)\./.test(f.path)).sort((a, b) => coll.compare(a.path, b.path));
}
