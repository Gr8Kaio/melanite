import type { EventRef } from './events';

/**
 * Ciclo de vida con limpieza automática: todo lo registrado con register* se
 * deshace en unload(), y los hijos se descargan con el padre.
 */
export class Component {
  private _loaded = false;
  private _children: Component[] = [];
  private _cleanups: (() => unknown)[] = [];

  load(): void {
    if (this._loaded) return;
    this._loaded = true;
    this.onload();
    for (const c of this._children) c.load();
  }

  unload(): void {
    if (!this._loaded) return;
    this._loaded = false;
    for (const c of this._children.splice(0)) c.unload();
    for (const fn of this._cleanups.splice(0).reverse()) {
      try { fn(); } catch (err) { console.error('[melanite] error al limpiar', err); }
    }
    this.onunload();
  }

  onload(): void {}
  onunload(): void {}

  addChild<T extends Component>(c: T): T {
    this._children.push(c);
    if (this._loaded) c.load();
    return c;
  }

  removeChild<T extends Component>(c: T): T {
    const i = this._children.indexOf(c);
    if (i >= 0) { this._children.splice(i, 1); c.unload(); }
    return c;
  }

  register(cb: () => unknown): void { this._cleanups.push(cb); }

  registerEvent(ref: EventRef): void { this.register(() => ref.e.offref(ref)); }

  registerDomEvent<K extends keyof HTMLElementEventMap>(
    el: Window | Document | HTMLElement, type: K | string, cb: (ev: any) => unknown, opts?: boolean | AddEventListenerOptions,
  ): void {
    el.addEventListener(type, cb as EventListener, opts);
    this.register(() => el.removeEventListener(type, cb as EventListener, opts));
  }

  registerInterval(id: number): number {
    this.register(() => clearInterval(id));
    return id;
  }
}
