"use strict";
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name in all)
    __defProp(target, name, { get: all[name], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/main.ts
var main_exports = {};
__export(main_exports, {
  default: () => PomodoroPlugin
});
module.exports = __toCommonJS(main_exports);
var import_melanite = require("melanite");

// src/timer.ts
var DEFAULT_SETTINGS = { workMin: 25, shortMin: 5, longMin: 15, longEvery: 3, autoStartWork: false, sound: true };
var phaseMs = (phase, s) => Math.round((phase === "work" ? s.workMin : phase === "short" ? s.shortMin : s.longMin) * 6e4);
function enter(st, phase, done, s, startAt) {
  const durationMs = phaseMs(phase, s);
  return {
    ...st,
    phase,
    done,
    durationMs,
    remainingMs: durationMs,
    running: startAt !== null,
    endsAt: startAt !== null ? startAt + durationMs : null,
    startedAt: startAt
  };
}
var initialState = (s, label = "") => enter({ label }, "work", 0, s, null);
var remaining = (st, now) => Math.max(0, st.running && st.endsAt !== null ? st.endsAt - now : st.remainingMs);
var progress = (st, now) => st.durationMs ? 1 - remaining(st, now) / st.durationMs : 0;
function start(st, now) {
  if (st.running) return st;
  return { ...st, running: true, endsAt: now + st.remainingMs, startedAt: st.startedAt ?? now };
}
function pause(st, now) {
  if (!st.running) return st;
  return { ...st, running: false, remainingMs: remaining(st, now), endsAt: null };
}
var reset = (st, s) => enter(st, "work", 0, s, null);
function advance(st, s, at) {
  if (st.phase === "work") {
    const done = st.done + 1;
    return enter(st, done >= Math.max(1, s.longEvery) ? "long" : "short", done, s, at);
  }
  return enter(st, "work", st.phase === "long" ? 0 : st.done, s, s.autoStartWork ? at : null);
}
var skip = (st, s, now) => advance(st, s, now);
function tick(st, s, now) {
  if (!st.running || st.endsAt === null || now < st.endsAt) return { state: st, finished: null };
  const endedAt = st.endsAt;
  const finished = {
    phase: st.phase,
    startedAt: st.startedAt ?? endedAt - st.durationMs,
    endedAt,
    minutes: Math.round(st.durationMs / 6e4),
    label: st.label.trim()
  };
  return { state: advance(st, s, endedAt), finished };
}
var hhmm = (ms) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};
var logLine = (b) => `- ${hhmm(b.startedAt)}\u2013${hhmm(b.endedAt)} \xB7 ${b.minutes} min${b.label ? ` \xB7 ${b.label}` : ""}`;
function clock(ms) {
  const total = Math.ceil(ms / 1e3);
  const h = Math.floor(total / 3600), m = Math.floor(total % 3600 / 60), sec = total % 60;
  const mmss = `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  return h ? `${h}:${mmss}` : mmss;
}

// src/i18n.ts
var en = {
  work: "Work",
  short: "Short break",
  long: "Long break",
  breakShort: "Break",
  paused: "(paused)",
  open: "Open Pomodoro",
  toggle: "Start or pause the block",
  skip: "Skip to next block",
  reset: "Reset cycle",
  start: "Start",
  pause: "Pause",
  skipBtn: "Skip",
  resetBtn: "Reset",
  label: "Label (e.g. flight)",
  labelAria: "Block label",
  block: "Block {n} of {m}",
  doneWork: "Pomodoro: block finished. {next}.",
  doneBreak: "Pomodoro: break is over.",
  needDaily: 'Pomodoro: enable the "Daily notes" core plugin (Settings \u2192 Core plugins) to log your blocks.',
  logFailed: "Pomodoro: could not write to the daily note ({error})",
  sWork: "Work block",
  sMinutes: "Minutes.",
  sShort: "Short break",
  sShortDesc: "Minutes. Starts on its own after each block.",
  sLong: "Long break",
  sEvery: "Long break every",
  sEveryDesc: "Work blocks per cycle.",
  sAuto: "Auto-start next block",
  sAutoDesc: "When a break ends, the next work block starts without touching anything.",
  sSound: "Sound when done",
  sTest: "Test",
  sChanges: "Duration changes",
  sChangesDesc: "Apply from the next block. Reset the cycle to apply them now."
};
var es = {
  work: "Trabajo",
  short: "Descanso corto",
  long: "Descanso largo",
  breakShort: "Descanso",
  paused: "(pausa)",
  open: "Abrir Pomodoro",
  toggle: "Iniciar o pausar el bloque",
  skip: "Saltar al siguiente bloque",
  reset: "Reiniciar el ciclo",
  start: "Iniciar",
  pause: "Pausar",
  skipBtn: "Saltar",
  resetBtn: "Reiniciar",
  label: "Etiqueta (ej. vuelo)",
  labelAria: "Etiqueta del bloque",
  block: "Bloque {n} de {m}",
  doneWork: "Pomodoro: termin\xF3 el bloque. {next}.",
  doneBreak: "Pomodoro: termin\xF3 el descanso.",
  needDaily: 'Pomodoro: activ\xE1 el plugin interno "Notas diarias" (Ajustes \u2192 Plugins internos) para anotar los bloques.',
  logFailed: "Pomodoro: no se pudo anotar en la nota diaria ({error})",
  sWork: "Bloque de trabajo",
  sMinutes: "Minutos.",
  sShort: "Descanso corto",
  sShortDesc: "Minutos. Arranca solo despu\xE9s de cada bloque.",
  sLong: "Descanso largo",
  sEvery: "Descanso largo cada",
  sEveryDesc: "Cantidad de bloques de trabajo por ciclo.",
  sAuto: "Arrancar solo el siguiente bloque",
  sAutoDesc: "Al terminar un descanso, empieza el pr\xF3ximo bloque de trabajo sin tocar nada.",
  sSound: "Sonido al terminar",
  sTest: "Probar",
  sChanges: "Cambios de duraci\xF3n",
  sChangesDesc: "Se aplican desde el pr\xF3ximo bloque. Para aplicarlos ya, reinici\xE1 el ciclo."
};
var dict = en;
var setLanguage = (lang) => {
  dict = lang === "es" ? es : en;
};
function tr(key, vars = {}) {
  return dict[key].replace(/\{(\w+)\}/g, (_m, k) => String(vars[k] ?? ""));
}

// src/main.ts
var VIEW = "pomodoro";
var phaseName = (p) => tr(p);
var PomodoroPlugin = class extends import_melanite.Plugin {
  constructor() {
    super(...arguments);
    this.settings = { ...DEFAULT_SETTINGS };
    this.audio = null;
  }
  async onload() {
    setLanguage(this.app.settings.language);
    this.registerEvent(this.app.on("settings-changed", () => {
      setLanguage(this.app.settings.language);
      this.render();
    }));
    const data = await this.loadData() ?? {};
    this.settings = { ...DEFAULT_SETTINGS, ...data.settings ?? {} };
    this.state = data.state ? { ...initialState(this.settings), ...data.state } : initialState(this.settings);
    this.registerView(VIEW, (leaf) => new PomodoroView(leaf, this));
    this.addRibbonIcon("timer", "Pomodoro", () => void this.reveal());
    this.addCommand({ id: "open", name: tr("open"), icon: "timer", callback: () => void this.reveal() });
    this.addCommand({ id: "toggle", name: tr("toggle"), callback: () => this.toggle() });
    this.addCommand({ id: "skip", name: tr("skip"), callback: () => this.skip() });
    this.addCommand({ id: "reset", name: tr("reset"), callback: () => this.reset() });
    this.statusEl = this.addStatusBarItem();
    this.statusEl.addClass("pomodoro-status");
    this.statusEl.setAttr("aria-label", tr("open"));
    this.registerDomEvent(this.statusEl, "click", () => void this.reveal());
    this.addSettingTab(new PomodoroSettingTab(this.app, this));
    this.registerInterval(window.setInterval(() => void this.tick(), 1e3));
    this.registerDomEvent(document, "visibilitychange", () => void this.tick());
    this.app.workspace.onLayoutReady(() => void this.ensureLeaf());
    await this.tick();
  }
  onunload() {
    void this.audio?.close();
  }
  // ---------------------------------------------------------------- acciones
  toggle() {
    const now = Date.now();
    if (this.state.running) this.update(pause(this.state, now));
    else {
      this.unlockAudio();
      this.update(start(this.state, now));
    }
  }
  skip() {
    this.update(skip(this.state, this.settings, Date.now()));
  }
  reset() {
    this.update(reset(this.state, this.settings));
  }
  setLabel(label) {
    this.update({ ...this.state, label });
  }
  update(next) {
    this.state = next;
    void this.persist();
    this.render();
  }
  async persist() {
    await this.saveData({ settings: this.settings, state: this.state });
  }
  /** Avanza las fases vencidas (pueden ser varias si se recargó la app) y anota los bloques de trabajo. */
  async tick() {
    let changed = false;
    for (let i = 0; i < 50; i++) {
      const r = tick(this.state, this.settings, Date.now());
      if (!r.finished) break;
      this.state = r.state;
      changed = true;
      await this.onFinished(r.finished);
    }
    if (changed) await this.persist();
    this.render();
  }
  async onFinished(b) {
    const fresh = Date.now() - b.endedAt < 6e4;
    if (fresh && this.settings.sound) this.beep();
    if (fresh) new import_melanite.Notice(b.phase === "work" ? tr("doneWork", { next: phaseName(this.state.phase) }) : tr("doneBreak"));
    if (b.phase === "work") await this.logToDailyNote(b);
  }
  async logToDailyNote(b) {
    const daily = this.app.plugins.getPlugin("daily-notes");
    if (!daily?.getDailyNote) {
      new import_melanite.Notice(tr("needDaily"), 8e3);
      return;
    }
    try {
      const file = await daily.getDailyNote(new Date(b.endedAt), true);
      const line = logLine(b);
      await this.app.vault.process(file, (text) => `${text}${text && !text.endsWith("\n") ? "\n" : ""}${line}
`);
    } catch (err) {
      console.error("[pomodoro]", err);
      new import_melanite.Notice(tr("logFailed", { error: err.message }));
    }
  }
  // ---------------------------------------------------------------- UI
  render() {
    const st = this.state;
    const idle = !st.running && st.remainingMs === st.durationMs && st.phase === "work" && st.done === 0;
    const left = clock(remaining(st, Date.now()));
    this.statusEl.setText(idle ? "" : `${st.phase === "work" ? tr("work") : tr("breakShort")} ${left}${st.running ? "" : ` ${tr("paused")}`}`);
    this.statusEl.toggleClass("is-running", st.running);
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) leaf.view.update();
  }
  async reveal() {
    await this.app.workspace.ensureSideLeaf(VIEW, "right", { reveal: true });
  }
  /** Deja la vista en el sidebar derecho sin taparle el frente a la pestaña que estaba. */
  async ensureLeaf() {
    const ws = this.app.workspace;
    if (ws.getLeavesOfType(VIEW).length) return;
    const tabs = ws.rightSplit.tabs;
    const prev = tabs.activeLeaf;
    await ws.ensureSideLeaf(VIEW, "right");
    if (prev) tabs.selectTab(prev);
  }
  /** iOS solo deja sonar audio creado/reanudado dentro de un toque del usuario. */
  unlockAudio() {
    try {
      this.audio ?? (this.audio = new AudioContext());
      void this.audio.resume();
    } catch {
    }
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
      osc.type = "sine";
      osc.frequency.value = freq;
      gain.gain.setValueAtTime(1e-4, at);
      gain.gain.exponentialRampToValueAtTime(0.35, at + 0.02);
      gain.gain.exponentialRampToValueAtTime(1e-4, at + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(at);
      osc.stop(at + 0.27);
    });
  }
};
var SVG = "http://www.w3.org/2000/svg";
var R = 52;
var C = 2 * Math.PI * R;
var PomodoroView = class extends import_melanite.ItemView {
  constructor(leaf, plugin) {
    super(leaf);
    this.plugin = plugin;
    this.icon = "timer";
  }
  getViewType() {
    return VIEW;
  }
  getDisplayText() {
    return "Pomodoro";
  }
  async onOpen() {
    this.titleEl.setText("Pomodoro");
    const wrap = this.contentEl.createDiv("pomodoro");
    this.phaseEl = wrap.createDiv("pomodoro-phase");
    const dial = wrap.createDiv("pomodoro-dial");
    const svg = document.createElementNS(SVG, "svg");
    svg.setAttribute("viewBox", "0 0 120 120");
    svg.setAttribute("aria-hidden", "true");
    const circle = (cls) => {
      const c = document.createElementNS(SVG, "circle");
      c.setAttribute("cx", "60");
      c.setAttribute("cy", "60");
      c.setAttribute("r", String(R));
      c.setAttribute("class", cls);
      svg.appendChild(c);
      return c;
    };
    circle("pomodoro-track");
    this.arc = circle("pomodoro-arc");
    this.arc.setAttribute("stroke-dasharray", String(C));
    dial.appendChild(svg);
    this.timeEl = dial.createDiv({ cls: "pomodoro-time", attr: { role: "timer", "aria-live": "off" } });
    this.labelEl = wrap.createEl("input", { type: "text", cls: "pomodoro-label", placeholder: tr("label"), attr: { "aria-label": tr("labelAria") } });
    this.labelEl.addEventListener("change", () => this.plugin.setLabel(this.labelEl.value));
    this.labelEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter") this.labelEl.blur();
    });
    this.cycleEl = wrap.createDiv("pomodoro-cycle");
    const buttons = wrap.createDiv("pomodoro-buttons");
    const btn = (icon, label, cls, cb) => {
      const b = buttons.createEl("button", { cls: `pomodoro-button ${cls}`, attr: { "aria-label": label, title: label } });
      (0, import_melanite.setIcon)(b, icon);
      b.addEventListener("click", cb);
      return b;
    };
    btn("rotate-ccw", tr("resetBtn"), "pomodoro-reset", () => this.plugin.reset());
    this.toggleBtn = btn("play", tr("start"), "pomodoro-toggle", () => this.plugin.toggle());
    this.toggleBtn.addClass("mod-cta");
    btn("skip-forward", tr("skipBtn"), "pomodoro-skip", () => this.plugin.skip());
    this.update();
  }
  update() {
    if (!this.timeEl) return;
    const st = this.plugin.state;
    const s = this.plugin.settings;
    const now = Date.now();
    this.contentEl.dataset.phase = st.phase;
    this.phaseEl.setText(phaseName(st.phase));
    this.timeEl.setText(clock(remaining(st, now)));
    const p = progress(st, now);
    this.arc.setAttribute("stroke-dashoffset", String(C * (1 - p)));
    this.arc.style.visibility = p > 2e-3 ? "" : "hidden";
    if (document.activeElement !== this.labelEl) this.labelEl.value = st.label;
    const running = st.running;
    if (this.toggleBtn.dataset.running !== String(running)) {
      this.toggleBtn.dataset.running = String(running);
      (0, import_melanite.setIcon)(this.toggleBtn, running ? "pause" : "play");
      this.toggleBtn.setAttr("aria-label", running ? tr("pause") : tr("start"));
      this.toggleBtn.title = running ? tr("pause") : tr("start");
    }
    const every = Math.max(1, s.longEvery);
    const current = st.phase === "work" ? st.done + 1 : st.done;
    this.cycleEl.empty();
    const dots = this.cycleEl.createDiv("pomodoro-dots");
    for (let i = 0; i < every; i++) dots.createSpan({ cls: i < st.done ? "pomodoro-dot is-done" : "pomodoro-dot" });
    this.cycleEl.createDiv({ cls: "pomodoro-count", text: tr("block", { n: Math.min(current, every), m: every }) });
  }
};
var PomodoroSettingTab = class extends import_melanite.PluginSettingTab {
  constructor(app, pomodoro) {
    super(app, pomodoro);
    this.pomodoro = pomodoro;
  }
  display() {
    const el = this.containerEl;
    const s = this.pomodoro.settings;
    const save = () => {
      void this.pomodoro.persist();
      this.pomodoro.render();
    };
    const minutes = (name, desc, key) => new import_melanite.Setting(el).setName(name).setDesc(desc).addText((x) => {
      x.inputEl.type = "number";
      x.inputEl.min = "1";
      x.setValue(String(s[key])).onChange((v) => {
        const n = Number(v);
        if (n > 0) {
          s[key] = key === "longEvery" ? Math.round(n) : n;
          save();
        }
      });
    });
    minutes(tr("sWork"), tr("sMinutes"), "workMin");
    minutes(tr("sShort"), tr("sShortDesc"), "shortMin");
    minutes(tr("sLong"), tr("sMinutes"), "longMin");
    minutes(tr("sEvery"), tr("sEveryDesc"), "longEvery");
    new import_melanite.Setting(el).setName(tr("sAuto")).setDesc(tr("sAutoDesc")).addToggle((x) => x.setValue(s.autoStartWork).onChange((v) => {
      s.autoStartWork = v;
      save();
    }));
    new import_melanite.Setting(el).setName(tr("sSound")).addToggle((x) => x.setValue(s.sound).onChange((v) => {
      s.sound = v;
      save();
    })).addButton((b) => b.setButtonText(tr("sTest")).onClick(() => this.pomodoro.beep()));
    new import_melanite.Setting(el).setName(tr("sChanges")).setDesc(tr("sChangesDesc")).addButton((b) => b.setButtonText(tr("reset")).onClick(() => this.pomodoro.reset()));
  }
};
