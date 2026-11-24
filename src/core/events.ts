export type EventCallback = (...data: any[]) => unknown;
export interface EventRef { e: Events; name: string; fn: EventCallback; ctx?: unknown }

/** Emisor de eventos con la forma de la API de Obsidian (on/off/offref/trigger). */
export class Events {
  private _events: Record<string, EventRef[]> = {};

  on(name: string, fn: EventCallback, ctx?: unknown): EventRef {
    const ref: EventRef = { e: this, name, fn, ctx };
    (this._events[name] ??= []).push(ref);
    return ref;
  }

  off(name: string, fn: EventCallback): void {
    const list = this._events[name];
    if (list) this._events[name] = list.filter((r) => r.fn !== fn);
  }

  offref(ref: EventRef): void {
    const list = this._events[ref.name];
    if (list) this._events[ref.name] = list.filter((r) => r !== ref);
  }

  trigger(name: string, ...data: unknown[]): void {
    for (const ref of (this._events[name] ?? []).slice()) {
      try { ref.fn.apply(ref.ctx, data); } catch (err) { console.error(`[melanite] error en evento ${name}`, err); }
    }
  }
}
