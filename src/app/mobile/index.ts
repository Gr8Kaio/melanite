import type { App } from '../app';
import { FileView, ItemView } from '../views/view';
import { Platform } from '../platform';
import { Modal } from '../ui/modal';
import { setIcon } from '../ui/icons';
import { registerStrings, t } from '../i18n';
import { installDrawerGestures } from './gestures';
import { installToolbar } from './toolbar';
import './mobile.css';

registerStrings({
  es: {
    'mobile.tabs': 'Pestañas',
    'mobile.palette': 'Paleta de comandos',
    'mobile.tabsCount': '{n} pestañas abiertas',
    'mobile.toolbar': 'Formato',
    'mobile.undo': 'Deshacer',
    'mobile.redo': 'Rehacer',
    'mobile.heading': 'Encabezado',
    'mobile.list': 'Lista',
    'mobile.code': 'Código',
    'mobile.math': 'Fórmula',
    'mobile.link': 'Link Markdown',
    'mobile.indent': 'Indentar',
    'mobile.dedent': 'Desindentar',
    'mobile.hideKeyboard': 'Ocultar teclado',
    'mobile.attachTitle': 'Adjuntar',
    'mobile.photos': 'Fotos',
    'mobile.camera': 'Cámara',
    'mobile.files': 'Archivos',
  },
  en: {
    'mobile.tabs': 'Tabs',
    'mobile.palette': 'Command palette',
    'mobile.tabsCount': '{n} open tabs',
    'mobile.toolbar': 'Formatting',
    'mobile.undo': 'Undo',
    'mobile.redo': 'Redo',
    'mobile.heading': 'Heading',
    'mobile.list': 'List',
    'mobile.code': 'Code',
    'mobile.math': 'Math',
    'mobile.link': 'Markdown link',
    'mobile.indent': 'Indent',
    'mobile.dedent': 'Unindent',
    'mobile.hideKeyboard': 'Hide keyboard',
    'mobile.attachTitle': 'Attach',
    'mobile.photos': 'Photos',
    'mobile.camera': 'Camera',
    'mobile.files': 'Files',
  },
});

/** Módulo cliente iPhone: barra única, drawers con gesto, toolbar sobre el teclado, adjuntar, viewport iOS. */
export async function install(app: App): Promise<void> {
  const container = document.querySelector<HTMLElement>('.app-container');
  const navbar = container?.querySelector<HTMLElement>('.mobile-navbar');
  if (!container || !navbar) return;
  installNavbar(app, navbar);
  installDrawerGestures(app);
  // en el teléfono no hay ribbon: los ajustes quedan al pie del drawer izquierdo
  const settings = app.workspace.leftSplit.containerEl.createDiv({ cls: 'mobile-drawer-footer' })
    .createDiv({ cls: 'mobile-sheet-option', attr: { role: 'button' } });
  setIcon(settings.createSpan('mobile-sheet-option-icon'), 'settings');
  settings.createSpan({ text: t('cmd.openSettings') });
  settings.addEventListener('click', () => { app.workspace.leftSplit.collapse(); app.openSettings(); });
  installToolbar(app, container);
  installViewport();
}

// ---------------------------------------------------------------- barra única

/**
 * Reusa la barra de app.ts (☰, título, nueva nota) y le mete las acciones de la
 * vista activa: se mueve el `actionsEl` de la vista (así siguen andando sus
 * handlers y las acciones que agreguen plugins) y vuelve a su encabezado al cambiar.
 */
function installNavbar(app: App, navbar: HTMLElement): void {
  const ws = app.workspace;
  const title = navbar.querySelector<HTMLElement>('.mobile-navbar-title')!;
  const actions = navbar.querySelectorAll<HTMLElement>('.mobile-navbar-action');
  const newNote = actions[1];
  actions[2]?.detach(); // panel derecho: ahora se abre con el gesto desde el borde

  const slot = createDiv('mobile-navbar-view-actions');
  const tabsBtn = createDiv({ cls: 'clickable-icon mobile-navbar-action mobile-tabs-button', attr: { role: 'button' } });
  const tabsCount = tabsBtn.createSpan('mobile-tabs-count');
  tabsBtn.addEventListener('click', () => openTabSwitcher(app));
  // sin ribbon en el teléfono: acceso directo a la paleta de comandos (desde ahí, búsqueda y quick switcher)
  const paletteBtn = createDiv({ cls: 'clickable-icon mobile-navbar-action mobile-palette-button', attr: { role: 'button', 'aria-label': t('mobile.palette') } });
  setIcon(paletteBtn, 'command');
  paletteBtn.addEventListener('click', () => app.commands.executeCommandById('command-palette:open'));
  navbar.insertBefore(slot, newNote ?? null);
  navbar.insertBefore(paletteBtn, newNote ?? null);
  navbar.insertBefore(tabsBtn, newNote ?? null);
  title.setAttr('role', 'button');
  title.addEventListener('click', () => {
    const v = ws.getMostRecentLeaf()?.view;
    if (v instanceof FileView && v.file) void app.fileManager.promptForRename(v.file);
  });

  let moved: ItemView | null = null;
  const sync = () => {
    const leaf = ws.getMostRecentLeaf();
    const view = Platform.isPhone && leaf?.view instanceof ItemView ? leaf.view : null;
    if (moved && moved !== view) { moved.headerEl.appendChild(moved.actionsEl); moved = null; }
    if (view && moved !== view) { slot.appendChild(view.actionsEl); moved = view; }
    title.setText(leaf?.getDisplayText() ?? '');
    let n = 0;
    ws.iterateRootLeaves(() => { n++; });
    tabsCount.setText(String(n));
    tabsBtn.setAttr('aria-label', t('mobile.tabsCount', { n }));
  };
  // después de los handlers de app.ts (que también escriben el título)
  const later = () => queueMicrotask(sync);
  for (const ev of ['file-open', 'active-leaf-change', 'layout-change', 'layout-ready']) ws.on(ev, later);
  app.vault.on('rename', later);
  Platform.onChange(later);
  sync();
}

function openTabSwitcher(app: App): void {
  const ws = app.workspace;
  const m = new Modal(app);
  m.setTitle(t('mobile.tabs'));
  m.modalEl.addClass('mobile-sheet', 'mobile-tab-switcher');
  const list = m.contentEl.createDiv('mobile-tab-list');
  const render = () => {
    list.empty();
    const current = ws.getMostRecentLeaf();
    ws.iterateRootLeaves((leaf) => {
      const row = list.createDiv({ cls: 'mobile-tab-item', attr: { role: 'button' } });
      row.toggleClass('is-active', leaf === current);
      setIcon(row.createDiv('mobile-tab-item-icon'), leaf.view.getIcon());
      row.createDiv({ cls: 'mobile-tab-item-title', text: leaf.getDisplayText() });
      const close = row.createDiv({ cls: 'clickable-icon mobile-tab-item-close', attr: { role: 'button', 'aria-label': t('cmd.closeTab') } });
      setIcon(close, 'x');
      close.addEventListener('click', (e) => { e.stopPropagation(); leaf.detach(); });
      row.addEventListener('click', () => { ws.setActiveLeaf(leaf); m.close(); });
    });
  };
  const ref = ws.on('layout-change', render);
  const add = m.contentEl.createEl('button', { cls: 'mobile-sheet-option mobile-tab-new' });
  setIcon(add.createSpan('mobile-sheet-option-icon'), 'plus');
  add.createSpan({ text: t('view.newTab') });
  add.addEventListener('click', () => { m.close(); app.commands.executeCommandById('workspace:new-tab'); });
  m.onClose = () => ws.offref(ref);
  render();
  m.open();
}

// ---------------------------------------------------------------- viewport iOS

/**
 * Con el teclado abierto iOS no achica el layout viewport: lo corre (offsetTop) y
 * tapa la parte de abajo. Fijamos el app-container y los modales al visualViewport
 * para que la barra superior no se vaya de pantalla y la toolbar quede pegada al teclado.
 * En Chrome Android (`interactive-widget=resizes-content`) el layout ya se achica y esto no hace nada.
 */
function installViewport(): void {
  const vv = window.visualViewport;
  if (!vv) return;
  const root = document.documentElement;
  const update = () => {
    // ponytail: "teclado abierto" = el visual viewport perdió >120 px; con zoom (scale ≠ 1) no tocamos nada
    const open = Platform.isPhone && Math.abs(vv.scale - 1) < 0.01 && window.innerHeight - vv.height > 120;
    document.body.toggleClass('mobile-keyboard-open', open);
    if (open) {
      root.style.setProperty('--mobile-vvh', `${vv.height}px`);
      root.style.setProperty('--mobile-vvtop', `${vv.offsetTop}px`);
    } else {
      root.style.removeProperty('--mobile-vvh');
      root.style.removeProperty('--mobile-vvtop');
    }
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}
