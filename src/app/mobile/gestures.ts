import type { App } from '../app';
import type { WorkspaceSidedock } from '../workspace';
import { Platform } from '../platform';
import { settleDrawer } from './format';

/**
 * Franja del borde (px) donde arranca el gesto de abrir.
 * ponytail: valor fijo elegido a ojo; en standalone iOS no hay gesto "atrás",
 * en Safari normal el "atrás" usa los primeros ~20 px. Si choca, probar 30-40 en el teléfono.
 */
export const EDGE = 24;
const LOCK = 10;

interface Drag {
  dock: WorkspaceSidedock;
  sign: 1 | -1;
  width: number;
  startX: number;
  startY: number;
  startOpen: number;
  open: number;
  locked: boolean;
  lastX: number;
  lastT: number;
  v: number;
}

/** Drawers con gesto: deslizar desde el borde abre, deslizar el drawer o el fondo cierra. */
export function installDrawerGestures(app: App): void {
  const ws = app.workspace;
  const backdrop = document.querySelector<HTMLElement>('.sidedock-backdrop');
  let drag: Drag | null = null;

  const apply = (d: Drag) => {
    d.dock.containerEl.style.transform = `translateX(${-d.sign * (d.width - d.open)}px)`;
    if (backdrop) { backdrop.style.display = 'block'; backdrop.style.opacity = String(d.open / d.width); }
  };
  const reset = (d: Drag) => {
    d.dock.containerEl.removeClass('is-dragging');
    d.dock.containerEl.style.transform = '';
    if (backdrop) { backdrop.style.display = ''; backdrop.style.opacity = ''; }
  };

  document.addEventListener('touchstart', (e) => {
    drag = null;
    if (!Platform.isPhone || e.touches.length !== 1 || document.querySelector('.modal-container')) return;
    const touch = e.touches[0];
    const x = touch.clientX;
    let dock: WorkspaceSidedock | null = !ws.leftSplit.collapsed ? ws.leftSplit : !ws.rightSplit.collapsed ? ws.rightSplit : null;
    if (!dock) {
      // no robarle el gesto a las manijas de selección del editor
      if ((e.target as Element).closest?.('.cm-content') && !getSelection()?.isCollapsed) return;
      if (x <= EDGE) dock = ws.leftSplit;
      else if (x >= innerWidth - EDGE) dock = ws.rightSplit;
      else return;
    }
    const width = dock.containerEl.getBoundingClientRect().width || 300;
    const startOpen = dock.collapsed ? 0 : width;
    drag = { dock, sign: dock.side === 'left' ? 1 : -1, width, startX: x, startY: touch.clientY, startOpen, open: startOpen, locked: false, lastX: x, lastT: e.timeStamp, v: 0 };
  }, { passive: true });

  document.addEventListener('touchmove', (e) => {
    const d = drag;
    if (!d) return;
    const touch = e.touches[0];
    const dx = touch.clientX - d.startX, dy = touch.clientY - d.startY;
    if (!d.locked) {
      if (Math.hypot(dx, dy) < LOCK) return;
      const towards = d.startOpen ? -1 : 1; // abrir = hacia adentro, cerrar = hacia afuera
      if (Math.abs(dx) < Math.abs(dy) * 1.2 || dx * d.sign * towards <= 0) { drag = null; return; }
      d.locked = true;
      d.dock.containerEl.addClass('is-dragging');
    }
    e.preventDefault();
    d.open = Math.min(d.width, Math.max(0, d.startOpen + dx * d.sign));
    const dt = e.timeStamp - d.lastT;
    if (dt > 0) d.v = 0.6 * (((touch.clientX - d.lastX) * d.sign) / dt) + 0.4 * d.v;
    d.lastX = touch.clientX;
    d.lastT = e.timeStamp;
    apply(d);
  }, { passive: false });

  const end = () => {
    const d = drag;
    drag = null;
    if (!d?.locked) return;
    const open = settleDrawer(d.open, d.width, d.v);
    reset(d);
    if (open === d.dock.collapsed) d.dock.setCollapsed(!open);
  };
  document.addEventListener('touchend', end);
  document.addEventListener('touchcancel', end);
}
