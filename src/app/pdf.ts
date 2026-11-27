import type { App } from './app';
import type { TFile } from '../core/vault';
import { Component } from '../core/component';
import { MarkdownRenderer } from './render/renderer';
import { paginate } from './render/pages';
import { Notice } from './ui/modal';
import { registerStrings, t } from './i18n';

registerStrings({
  en: { 'pdf.export': 'Export to PDF', 'pdf.exportFolder': 'Export folder to PDF', 'pdf.saved': 'PDF saved', 'pdf.empty': 'No notes to export' },
  es: { 'pdf.export': 'Exportar a PDF', 'pdf.exportFolder': 'Exportar carpeta a PDF', 'pdf.saved': 'PDF guardado', 'pdf.empty': 'No hay notas para exportar' },
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

/** Notas de una carpeta (y subcarpetas) en orden de ruta, como en el explorador. */
export function notesIn(app: App, folderPath: string): TFile[] {
  const prefix = folderPath ? `${folderPath}/` : '';
  const coll = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
  return app.vault.getMarkdownFiles().filter((f) => f.path.startsWith(prefix) && !/(^|\/)\./.test(f.path)).sort((a, b) => coll.compare(a.path, b.path));
}
