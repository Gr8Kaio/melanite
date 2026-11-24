import { describe, expect, it } from 'vitest';
import { cycleHeading, settleDrawer, toggleList } from '../../src/app/mobile/format';

describe('mobile/format', () => {
  it('cycleHeading cicla # a ###### y vuelve a texto', () => {
    expect(cycleHeading('Hola')).toBe('# Hola');
    expect(cycleHeading('# Hola')).toBe('## Hola');
    expect(cycleHeading('##### Hola')).toBe('###### Hola');
    expect(cycleHeading('###### Hola')).toBe('Hola');
    expect(cycleHeading('#tag')).toBe('# #tag');
  });

  it('toggleList pone y saca viñetas respetando la sangría', () => {
    expect(toggleList('item')).toBe('- item');
    expect(toggleList('  item')).toBe('  - item');
    expect(toggleList('  - item')).toBe('  item');
    expect(toggleList('- [x] hecho')).toBe('hecho');
    expect(toggleList('3. tercero')).toBe('tercero');
  });

  it('settleDrawer: la inercia manda, si no el umbral de la mitad', () => {
    expect(settleDrawer(40, 300, 0.8)).toBe(true);
    expect(settleDrawer(260, 300, -0.8)).toBe(false);
    expect(settleDrawer(200, 300, 0)).toBe(true);
    expect(settleDrawer(100, 300, 0.1)).toBe(false);
  });
});
