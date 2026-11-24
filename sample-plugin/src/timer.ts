/**
 * Lógica pura del timer (sin DOM): se testea sola. Todo va por timestamps
 * (`endsAt`), así no se atrasa con la pestaña en segundo plano ni al recargar.
 */

export type Phase = 'work' | 'short' | 'long';

export interface TimerSettings {
  workMin: number;
  shortMin: number;
  longMin: number;
  /** descanso largo cada N bloques de trabajo */
  longEvery: number;
  /** arrancar solo el bloque de trabajo que sigue a un descanso (los descansos arrancan siempre solos) */
  autoStartWork: boolean;
  sound: boolean;
}

export const DEFAULT_SETTINGS: TimerSettings = { workMin: 25, shortMin: 5, longMin: 15, longEvery: 3, autoStartWork: false, sound: true };

export interface TimerState {
  phase: Phase;
  running: boolean;
  /** cuándo termina la fase (solo si running) */
  endsAt: number | null;
  /** lo que falta (si está en pausa o sin arrancar) */
  remainingMs: number;
  /** duración de la fase actual */
  durationMs: number;
  /** bloques de trabajo terminados en el ciclo actual */
  done: number;
  label: string;
  /** primer arranque de la fase actual (para anotar la hora de inicio) */
  startedAt: number | null;
}

export interface FinishedBlock { phase: Phase; startedAt: number; endedAt: number; minutes: number; label: string }

export const phaseMs = (phase: Phase, s: TimerSettings) =>
  Math.round((phase === 'work' ? s.workMin : phase === 'short' ? s.shortMin : s.longMin) * 60_000);

function enter(st: TimerState, phase: Phase, done: number, s: TimerSettings, startAt: number | null): TimerState {
  const durationMs = phaseMs(phase, s);
  return {
    ...st, phase, done, durationMs, remainingMs: durationMs,
    running: startAt !== null, endsAt: startAt !== null ? startAt + durationMs : null, startedAt: startAt,
  };
}

export const initialState = (s: TimerSettings, label = ''): TimerState =>
  enter({ label } as TimerState, 'work', 0, s, null);

export const remaining = (st: TimerState, now: number) =>
  Math.max(0, st.running && st.endsAt !== null ? st.endsAt - now : st.remainingMs);

export const progress = (st: TimerState, now: number) =>
  st.durationMs ? 1 - remaining(st, now) / st.durationMs : 0;

export function start(st: TimerState, now: number): TimerState {
  if (st.running) return st;
  return { ...st, running: true, endsAt: now + st.remainingMs, startedAt: st.startedAt ?? now };
}

export function pause(st: TimerState, now: number): TimerState {
  if (!st.running) return st;
  return { ...st, running: false, remainingMs: remaining(st, now), endsAt: null };
}

/** Vuelve al primer bloque de trabajo del ciclo, sin arrancar. */
export const reset = (st: TimerState, s: TimerSettings): TimerState => enter(st, 'work', 0, s, null);

/** Fase que sigue. Los descansos arrancan solos; el trabajo solo si autoStartWork. */
function advance(st: TimerState, s: TimerSettings, at: number): TimerState {
  if (st.phase === 'work') {
    const done = st.done + 1;
    return enter(st, done >= Math.max(1, s.longEvery) ? 'long' : 'short', done, s, at);
  }
  return enter(st, 'work', st.phase === 'long' ? 0 : st.done, s, s.autoStartWork ? at : null);
}

/** Termina la fase ahora sin anotarla (cuenta para el ciclo). */
export const skip = (st: TimerState, s: TimerSettings, now: number): TimerState => advance(st, s, now);

/**
 * Si la fase en curso ya venció, pasa a la siguiente (la nueva arranca en el `endsAt` viejo, así
 * se pueden encadenar varias al volver de una recarga) y devuelve el bloque terminado.
 */
export function tick(st: TimerState, s: TimerSettings, now: number): { state: TimerState; finished: FinishedBlock | null } {
  if (!st.running || st.endsAt === null || now < st.endsAt) return { state: st, finished: null };
  const endedAt = st.endsAt;
  const finished: FinishedBlock = {
    phase: st.phase, startedAt: st.startedAt ?? endedAt - st.durationMs, endedAt,
    minutes: Math.round(st.durationMs / 60_000), label: st.label.trim(),
  };
  return { state: advance(st, s, endedAt), finished };
}

const hhmm = (ms: number) => {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
};

/** `- 10:44–11:44 · 60 min · vuelo` */
export const logLine = (b: FinishedBlock) =>
  `- ${hhmm(b.startedAt)}–${hhmm(b.endedAt)} · ${b.minutes} min${b.label ? ` · ${b.label}` : ''}`;

/** mm:ss (o h:mm:ss) */
export function clock(ms: number): string {
  const total = Math.ceil(ms / 1000);
  const h = Math.floor(total / 3600), m = Math.floor((total % 3600) / 60), sec = total % 60;
  const mmss = `${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
  return h ? `${h}:${mmss}` : mmss;
}
