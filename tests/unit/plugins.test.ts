import { describe, expect, it, vi } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { compareVersions, filesFromZip, manifestError, parseGithubSource, sharedModuleSource, wrapPluginSource } from '../../src/plugins/loader';
import { applyTemplate, formatDate } from '../../src/plugins/core-plugins/dates';
import * as T from '../../sample-plugin/src/timer';

// Plugin hereda de SettingTab (DOM); para probar la limpieza alcanza con un stub
vi.mock('../../src/app/views/settings', () => ({ SettingTab: class {} }));
const { Plugin } = await import('../../src/api/plugin');

const dataUrl = (code: string) => `data:text/javascript,${encodeURIComponent(code)}`;

class FakeBase { static tag = 'base'; }
(globalThis as any).__melanite = { require: (n: string) => (n === 'melanite' ? { Plugin: FakeBase, Notice: 1 } : { name: n }) };

describe('loader: shim CJS / ESM', () => {
  it('envuelve un main.js CJS (require + module.exports.default)', async () => {
    const code = '"use strict";\nconst { Plugin } = require("melanite");\nclass P extends Plugin {}\nmodule.exports = { default: P };\nvar import_melanite = {};\nimport_melanite.x;'; // como los bundles de esbuild: no es ESM
    const src = wrapPluginSource(code, {}, 'demo');
    expect(src).toContain('const module={exports:{}}');
    const mod = await import(dataUrl(src));
    expect(mod.default.prototype).toBeInstanceOf(FakeBase);
  });

  it('acepta module.exports = Clase (sin default)', async () => {
    const mod = await import(dataUrl(wrapPluginSource('module.exports = class extends require("melanite").Plugin {};')));
    expect(mod.default.prototype).toBeInstanceOf(FakeBase);
  });

  it('un main.js ESM importa los módulos compartidos desde sus URLs', async () => {
    const shared = dataUrl(sharedModuleSource('melanite', ['Plugin', 'Notice', 'not-an-id', 'default']));
    const code = "import { Plugin } from 'melanite';\nexport default class P extends Plugin {}";
    const src = wrapPluginSource(code, { melanite: shared });
    expect(src).not.toContain('module.exports');
    const mod = await import(dataUrl(src));
    expect(mod.default.prototype).toBeInstanceOf(FakeBase);
  });

  it('valida manifests y versiones', () => {
    expect(manifestError({ id: 'pomodoro', name: 'P', version: '1.0.0' })).toBeNull();
    expect(manifestError({ id: 'Mal Id', name: 'P', version: '1' })).toMatch(/id/);
    expect(manifestError(null)).toBeTruthy();
    expect(compareVersions('0.10.0', '0.9.9')).toBeGreaterThan(0);
    expect(compareVersions('1.0', '1.0.0')).toBe(0);
    expect(compareVersions('0.1.0', '0.2.0')).toBeLessThan(0);
  });

  it('lee zips con los archivos en la raíz o dentro de una carpeta', () => {
    const files = { 'manifest.json': strToU8('{"id":"x"}'), 'main.js': strToU8('code'), 'styles.css': strToU8('.a{}') };
    expect(filesFromZip(zipSync(files))).toEqual({ 'manifest.json': '{"id":"x"}', 'main.js': 'code', 'styles.css': '.a{}' });
    const nested = zipSync({ 'x-1.0/manifest.json': strToU8('{}'), 'x-1.0/main.js': strToU8('m'), '__MACOSX/x-1.0/manifest.json': strToU8('') });
    expect(filesFromZip(nested)).toEqual({ 'manifest.json': '{}', 'main.js': 'm' });
    expect(() => filesFromZip(zipSync({ 'a.txt': strToU8('') }))).toThrow(/manifest/);
  });

  it('entiende URLs de GitHub', () => {
    expect(parseGithubSource('https://github.com/o/r')).toEqual({ owner: 'o', repo: 'r', tag: null });
    expect(parseGithubSource('https://github.com/o/r.git')).toEqual({ owner: 'o', repo: 'r', tag: null });
    expect(parseGithubSource('https://github.com/o/my.repo/releases/tag/v1.2.0')).toEqual({ owner: 'o', repo: 'my.repo', tag: 'v1.2.0' });
    expect(parseGithubSource('o/r')).toEqual({ owner: 'o', repo: 'r', tag: null });
    expect(parseGithubSource('https://example.com/x')).toBeNull();
  });
});

describe('Plugin: limpieza automática al desactivar', () => {
  it('deshace comandos, ribbon, barra de estado, vistas, procesadores, extensiones, eventos e intervalos', async () => {
    const removed: string[] = [];
    const el = (name: string) => ({ detach: () => removed.push(name) });
    const listeners = new Set<unknown>();
    const app: any = {
      commands: { addCommand: vi.fn(), removeCommand: (id: string) => removed.push(`cmd ${id}`) },
      addRibbonIcon: () => el('ribbon'),
      addStatusBarItem: () => el('status'),
      pluginSettingTabs: [],
      registerView: () => () => removed.push('view'),
      workspace: { getLeavesOfType: () => [{ detach: () => removed.push('leaf') }] },
      markdown: { addPostProcessor: () => () => removed.push('pp'), addCodeBlockProcessor: () => () => removed.push('cb') },
      registerEditorExtension: () => () => removed.push('ext'),
    };
    const events = { offref: (ref: unknown) => listeners.delete(ref) };
    const clear = vi.spyOn(globalThis, 'clearInterval');
    class Demo extends Plugin {
      onload() {
        this.addCommand({ id: 'go', name: 'Go', callback() {} });
        this.addRibbonIcon('x', 'x', () => {});
        this.addStatusBarItem();
        this.addSettingTab({ id: '', name: '' } as any);
        this.registerView('demo', () => null as any);
        this.registerMarkdownPostProcessor(() => {});
        this.registerMarkdownCodeBlockProcessor('demo', () => {});
        this.registerEditorExtension([]);
        const ref = { e: events };
        listeners.add(ref);
        this.registerEvent(ref as any);
        this.registerInterval(1234);
      }
    }
    const p = new Demo(app, { id: 'demo', name: 'Demo', version: '1' });
    await p.load();
    expect(app.commands.addCommand).toHaveBeenCalledWith(expect.objectContaining({ id: 'demo:go' }));
    expect(app.pluginSettingTabs).toHaveLength(1);
    p.unload();
    expect(removed.sort()).toEqual(['cb', 'cmd demo:go', 'ext', 'leaf', 'pp', 'ribbon', 'status', 'view'].sort());
    expect(app.pluginSettingTabs).toHaveLength(0);
    expect(listeners.size).toBe(0);
    expect(clear).toHaveBeenCalledWith(1234);
  });
});

describe('fechas y plantillas', () => {
  const d = new Date(2026, 10, 24, 9, 5, 7); // martes 24 de noviembre de 2026, 09:05:07
  it('formatea en español', () => {
    expect(formatDate(d, 'YYYY-MM-DD')).toBe('2026-11-24');
    expect(formatDate(d, 'dddd D [de] MMMM, YY')).toBe('martes 24 de noviembre, 26');
    expect(formatDate(d, 'ddd DD MMM')).toBe('mar 24 nov');
    expect(formatDate(d, 'HH:mm:ss H m')).toBe('09:05:07 9 5');
    expect(formatDate(d, '[YYYY] M')).toBe('YYYY 11');
  });
  it('reemplaza las variables de plantilla', () => {
    const tpl = '# {{title}}\n{{date}} {{time}} · {{date:dddd}} · {{time:HH[h]}} · {{ DATE : YYYY }}';
    expect(applyTemplate(tpl, { title: 'Reunión', date: d })).toBe('# Reunión\n2026-11-24 09:05 · martes · 09h · 2026');
    expect(applyTemplate('{{date}}', { title: '', date: d, dateFormat: 'DD/MM' })).toBe('24/11');
  });
});

describe('Pomodoro: timer por timestamps', () => {
  const s = { ...T.DEFAULT_SETTINGS }; // 25/5/15, largo cada 3
  const MIN = 60_000;

  it('ciclo 25/5/15 con descanso largo cada 3 bloques', () => {
    let st = T.start(T.initialState(s, 'vuelo'), 0);
    let now = 0;
    const seen: string[] = [];
    const logs: T.FinishedBlock[] = [];
    for (let i = 0; i < 7; i++) {
      now = st.endsAt!;
      const r = T.tick(st, s, now);
      if (r.finished!.phase === 'work') logs.push(r.finished!);
      seen.push(`${r.finished!.phase}${r.finished!.minutes}`);
      st = r.state;
      if (!st.running) st = T.start(st, now); // el trabajo no arranca solo por defecto
    }
    expect(seen).toEqual(['work25', 'short5', 'work25', 'short5', 'work25', 'long15', 'work25']);
    expect(st.phase).toBe('short');
    expect(st.done).toBe(1);
    expect(logs).toHaveLength(4);
    expect(logs[0]).toMatchObject({ startedAt: 0, endedAt: 25 * MIN, label: 'vuelo' });
  });

  it('los descansos arrancan solos; el trabajo solo con autoStartWork', () => {
    let st = T.start(T.initialState(s), 0);
    st = T.tick(st, s, 25 * MIN).state;
    expect(st).toMatchObject({ phase: 'short', running: true, endsAt: 30 * MIN });
    expect(T.tick(st, s, 30 * MIN).state).toMatchObject({ phase: 'work', running: false, remainingMs: 25 * MIN });
    expect(T.tick(st, { ...s, autoStartWork: true }, 30 * MIN).state).toMatchObject({ phase: 'work', running: true, endsAt: 55 * MIN });
  });

  it('pausa y sigue sin perder tiempo; no se atrasa aunque el tick llegue tarde', () => {
    let st = T.start(T.initialState(s), 0);
    st = T.pause(st, 10 * MIN);
    expect(T.remaining(st, 999 * MIN)).toBe(15 * MIN);
    st = T.start(st, 100 * MIN);
    expect(st.endsAt).toBe(115 * MIN);
    expect(st.startedAt).toBe(0);
    // tick muy tarde (pestaña dormida o recarga): la fase siguiente arranca cuando terminó la anterior
    const r = T.tick(st, s, 118 * MIN);
    expect(r.finished).toMatchObject({ endedAt: 115 * MIN });
    expect(r.state.endsAt).toBe(120 * MIN);
  });

  it('saltar cuenta para el ciclo y reiniciar vuelve al principio', () => {
    let st = T.initialState(s);
    st = T.skip(st, s, 0);
    expect(st).toMatchObject({ phase: 'short', done: 1 });
    st = T.reset(st, s);
    expect(st).toMatchObject({ phase: 'work', done: 0, running: false, remainingMs: 25 * MIN });
  });

  it('formatea la línea de la nota diaria y el reloj', () => {
    const at = (h: number, m: number) => new Date(2026, 0, 1, h, m).getTime();
    expect(T.logLine({ phase: 'work', startedAt: at(10, 44), endedAt: at(11, 44), minutes: 60, label: 'vuelo' })).toBe('- 10:44–11:44 · 60 min · vuelo');
    expect(T.logLine({ phase: 'work', startedAt: at(9, 0), endedAt: at(9, 25), minutes: 25, label: '' })).toBe('- 09:00–09:25 · 25 min');
    expect(T.clock(25 * MIN)).toBe('25:00');
    expect(T.clock(61_500)).toBe('01:02');
    expect(T.clock(3_600_000)).toBe('1:00:00');
  });
});
