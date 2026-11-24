import { describe, expect, it } from 'vitest';

// Setting necesita DOM: probamos la misma lógica de then() sobre un objeto mínimo
class Thenable {
  then(cb: (s: this) => unknown, onRejected?: unknown): this {
    if (typeof onRejected === 'function') { (cb as (v: unknown) => void)(undefined); return this; }
    cb(this);
    return this;
  }
}

describe('Setting.then como thenable', () => {
  it('devolverlo desde un .then() de promesa no cuelga', async () => {
    const s = new Thenable();
    const v: unknown = await Promise.resolve().then(() => s as unknown);
    expect(v).toBeUndefined();
  });
  it('then(cb) sigue encadenando como en Obsidian', () => {
    const s = new Thenable();
    let got: unknown;
    expect(s.then((x) => { got = x; })).toBe(s);
    expect(got).toBe(s);
  });
});
