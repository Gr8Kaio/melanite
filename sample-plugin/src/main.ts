import { Plugin, ItemView, PluginSettingTab, Setting, Notice, setIcon, type App, type TFile, type WorkspaceLeaf } from 'melanite';
import * as T from './timer';
import { setLanguage, tr } from './i18n';

const VIEW = 'pomodoro';
const phaseName = (p: T.Phase) => tr(p);

interface DailyNotes { getDailyNote(date?: Date, create?: boolean): Promise<TFile> }

export default class PomodoroPlugin extends Plugin {
  settings: T.TimerSettings = { ...T.DEFAULT_SETTINGS };
  state!: T.TimerState;
  private statusEl!: HTMLElement;
  private audio: AudioContext | null = null;

  async onload() {
    setLanguage(this.app.settings.language);
    this.registerEvent(this.app.on('settings-changed', () => { setLanguage(this.app.settings.language); this.render(); }));
    const data = (await this.loadData()) ?? {};
    this.settings = { ...T.DEFAULT_SETTINGS, ...(data.settings ?? {}) };
    this.state = data.state ? { ...T.initialState(this.settings), ...data.state } : T.initialState(this.settings);

    this.registerView(VIEW, (leaf) => new PomodoroView(leaf, this));
    this.addRibbonIcon('timer', 'Pomodoro', () => void this.reveal());
    this.addCommand({ id: 'open', name: tr('open'), icon: 'timer', callback: () => void this.reveal() });
    this.addCommand({ id: 'toggle', name: tr('toggle'), callback: () => this.toggle() });
    this.addCommand({ id: 'skip', name: tr('skip'), callback: () => this.skip() });
    this.addCommand({ id: 'reset', name: tr('reset'), callback: () => this.reset() });

    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass('pomodoro-status');
    this.statusEl.setAttr('aria-label', tr('open'));
    this.registerDomEvent(this.statusEl, 'click', () => void this.reveal());

    this.addSettingTab(new PomodoroSettingTab(this.app, this));
    this.registerInterval(window.setInterval(() => void this.tick(), 1000));
    // al volver a la pestaña, ponerse al día enseguida (los intervalos se frenan en segundo plano)
    this.registerDomEvent(document, 'visibilitychange', () => void this.tick());
    this.app.workspace.onLayoutReady(() => void this.ensureLeaf());
    await this.tick();
  }

  onunload() { void this.audio?.close(); }

  // ---------------------------------------------------------------- acciones

  toggle() {
    const now = Date.now();
    if (this.state.running) this.update(T.pause(this.state, now));
    else { this.unlockAudio(); this.update(T.start(this.state, now)); }
  }
  skip() { this.update(T.skip(this.state, this.settings, Date.now())); }
  reset() { this.update(T.reset(this.state, this.settings)); }
  setLabel(label: string) { this.update({ ...this.state, label }); }

  private update(next: T.TimerState) {
    this.state = next;
    void this.persist();
    this.render();
  }

  async persist() { await this.saveData({ settings: this.settings, state: this.state }); }

  /** Avanza las fases vencidas (pueden ser varias si se recargó la app) y anota los bloques de trabajo. */
  async tick() {
    let changed = false;
    for (let i = 0; i < 50; i++) {
      const r = T.tick(this.state, this.settings, Date.now());
      if (!r.finished) break;
      this.state = r.state; // antes del await: otro tick no vuelve a terminar el mismo bloque
      changed = true;
      await this.onFinished(r.finished);
    }
    if (changed) await this.persist();
    this.render();
  }

  private async onFinished(b: T.FinishedBlock) {
    const fresh = Date.now() - b.endedAt < 60_000;
    if (fresh && this.settings.sound) this.beep();
    if (fresh) new Notice(b.phase === 'work' ? tr('doneWork', { next: phaseName(this.state.phase) }) : tr('doneBreak'));
    if (b.phase === 'work') await this.logToDailyNote(b);
  }

  private async logToDailyNote(b: T.FinishedBlock) {
    const daily = this.app.plugins.getPlugin('daily-notes') as unknown as Partial<DailyNotes> | null;
    if (!daily?.getDailyNote) {
      new Notice(tr('needDaily'), 8000);
      return;
    }
    try {
      const file = await daily.getDailyNote(new Date(b.endedAt), true);
      const line = T.logLine(b);
      await this.app.vault.process(file, (text) => `${text}${text && !text.endsWith('\n') ? '\n' : ''}${line}\n`);
    } catch (err) {
      console.error('[pomodoro]', err);
      new Notice(tr('logFailed', { error: (err as Error).message }));
    }
  }

  // ---------------------------------------------------------------- UI

  render() {
    const st = this.state;
    const idle = !st.running && st.remainingMs === st.durationMs && st.phase === 'work' && st.done === 0;
    const left = T.clock(T.remaining(st, Date.now()));
    this.statusEl.setText(idle ? '' : `${st.phase === 'work' ? tr('work') : tr('breakShort')} ${left}${st.running ? '' : ` ${tr('paused')}`}`);
    this.statusEl.toggleClass('is-running', st.running);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as PomodoroView).update();
  }

  async reveal() {
    await this.app.workspace.ensureSideLeaf(VIEW, 'right', { reveal: true });
  }

  /** Deja la vista en el sidebar derecho sin taparle el frente a la pestaña que estaba. */
  private async ensureLeaf() {
    const ws = this.app.workspace;
    if (ws.getLeavesOfType(VIEW).length) return;
    const tabs = ws.rightSplit.tabs;
    const prev = tabs.activeLeaf;
    await ws.ensureSideLeaf(VIEW, 'right');
    if (prev) tabs.selectTab(prev);
  }

  /** iOS solo deja sonar audio creado/reanudado dentro de un toque del usuario. */
  private unlockAudio() {
    try {
      this.audio ??= new AudioContext();
      void this.audio.resume();
    } catch { /* sin WebAudio */ }
  }

  beep() {
    this.unlockAudio();
    const ctx = this.audio;
    if (!ctx) return;
    const t0 = ctx.currentTime + 0.05;
    [880, 660, 990].forEach((freq, i) => {
      const at = t0 + i * 0.28;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(0.0001, at);
      gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.27);
    });
  }
}

// ---------------------------------------------------------------- vista

const SVG = 'http://www.w3.org/2000/svg';
const R = 52;
const C = 2 * Math.PI * R;

class PomodoroView extends ItemView {
  icon = 'timer';
  private phaseEl!: HTMLElement;
  private timeEl!: HTMLElement;
  private arc!: SVGCircleElement;
  private labelEl!: HTMLInputElement;
  private cycleEl!: HTMLElement;
  private toggleBtn!: HTMLElement;

  constructor(leaf: WorkspaceLeaf, private plugin: PomodoroPlugin) { super(leaf); }
  getViewType() { return VIEW; }
  getDisplayText() { return 'Pomodoro'; }

  async onOpen() {
    this.titleEl.setText('Pomodoro');
    const wrap = this.contentEl.createDiv('pomodoro');
    this.phaseEl = wrap.createDiv('pomodoro-phase');

    const dial = wrap.createDiv('pomodoro-dial');
    const svg = document.createElementNS(SVG, 'svg');
    svg.setAttribute('viewBox', '0 0 120 120');
    svg.setAttribute('aria-hidden', 'true');
    const circle = (cls: string) => {
      const c = document.createElementNS(SVG, 'circle');
      c.setAttribute('cx', '60'); c.setAttribute('cy', '60'); c.setAttribute('r', String(R));
      c.setAttribute('class', cls);
      svg.appendChild(c);
      return c;
    };
    circle('pomodoro-track');
    this.arc = circle('pomodoro-arc');
    this.arc.setAttribute('stroke-dasharray', String(C));
    dial.appendChild(svg);
    this.timeEl = dial.createDiv({ cls: 'pomodoro-time', attr: { role: 'timer', 'aria-live': 'off' } });

    this.labelEl = wrap.createEl('input', { type: 'text', cls: 'pomodoro-label', placeholder: tr('label'), attr: { 'aria-label': tr('labelAria') } });
    this.labelEl.addEventListener('change', () => this.plugin.setLabel(this.labelEl.value));
    this.labelEl.addEventListener('keydown', (e) => { if (e.key === 'Enter') this.labelEl.blur(); });

    this.cycleEl = wrap.createDiv('pomodoro-cycle');

    const buttons = wrap.createDiv('pomodoro-buttons');
    const btn = (icon: string, label: string, cls: string, cb: () => void) => {
      const b = buttons.createEl('button', { cls: `pomodoro-button ${cls}`, attr: { 'aria-label': label, title: label } });
      setIcon(b, icon);
      b.addEventListener('click', cb);
      return b;
    };
    btn('rotate-ccw', tr('resetBtn'), 'pomodoro-reset', () => this.plugin.reset());
    this.toggleBtn = btn('play', tr('start'), 'pomodoro-toggle', () => this.plugin.toggle());
    this.toggleBtn.addClass('mod-cta');
    btn('skip-forward', tr('skipBtn'), 'pomodoro-skip', () => this.plugin.skip());
    this.update();
  }

  update() {
    if (!this.timeEl) return;
    const st = this.plugin.state;
    const s = this.plugin.settings;
    const now = Date.now();
    this.contentEl.dataset.phase = st.phase;
    this.phaseEl.setText(phaseName(st.phase));
    this.timeEl.setText(T.clock(T.remaining(st, now)));
    const p = T.progress(st, now);
    this.arc.setAttribute('stroke-dashoffset', String(C * (1 - p)));
    this.arc.style.visibility = p > 0.002 ? '' : 'hidden'; // sin esto, el extremo redondeado deja un punto en 0
    if (document.activeElement !== this.labelEl) this.labelEl.value = st.label;

    const running = st.running;
    if (this.toggleBtn.dataset.running !== String(running)) {
      this.toggleBtn.dataset.running = String(running);
      setIcon(this.toggleBtn, running ? 'pause' : 'play');
      this.toggleBtn.setAttr('aria-label', running ? tr('pause') : tr('start'));
      this.toggleBtn.title = running ? tr('pause') : tr('start');
    }

    const every = Math.max(1, s.longEvery);
    const current = st.phase === 'work' ? st.done + 1 : st.done;
    this.cycleEl.empty();
    const dots = this.cycleEl.createDiv('pomodoro-dots');
    for (let i = 0; i < every; i++) dots.createSpan({ cls: i < st.done ? 'pomodoro-dot is-done' : 'pomodoro-dot' });
    this.cycleEl.createDiv({ cls: 'pomodoro-count', text: tr('block', { n: Math.min(current, every), m: every }) });
  }
}

// ---------------------------------------------------------------- ajustes

class PomodoroSettingTab extends PluginSettingTab {
  constructor(app: App, private pomodoro: PomodoroPlugin) { super(app, pomodoro); }

  display() {
    const el = this.containerEl;
    const s = this.pomodoro.settings;
    const save = () => { void this.pomodoro.persist(); this.pomodoro.render(); };
    const minutes = (name: string, desc: string, key: 'workMin' | 'shortMin' | 'longMin' | 'longEvery') =>
      new Setting(el).setName(name).setDesc(desc).addText((x) => {
        x.inputEl.type = 'number';
        x.inputEl.min = '1';
        x.setValue(String(s[key])).onChange((v) => {
          const n = Number(v);
          if (n > 0) { s[key] = key === 'longEvery' ? Math.round(n) : n; save(); }
        });
      });
    minutes(tr('sWork'), tr('sMinutes'), 'workMin');
    minutes(tr('sShort'), tr('sShortDesc'), 'shortMin');
    minutes(tr('sLong'), tr('sMinutes'), 'longMin');
    minutes(tr('sEvery'), tr('sEveryDesc'), 'longEvery');
    new Setting(el).setName(tr('sAuto')).setDesc(tr('sAutoDesc'))
      .addToggle((x) => x.setValue(s.autoStartWork).onChange((v) => { s.autoStartWork = v; save(); }));
    new Setting(el).setName(tr('sSound'))
      .addToggle((x) => x.setValue(s.sound).onChange((v) => { s.sound = v; save(); }))
      .addButton((b) => b.setButtonText(tr('sTest')).onClick(() => this.pomodoro.beep()));
    new Setting(el).setName(tr('sChanges')).setDesc(tr('sChangesDesc'))
      .addButton((b) => b.setButtonText(tr('reset')).onClick(() => this.pomodoro.reset()));
  }
}
