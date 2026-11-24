/** Mini diccionario propio: los plugins de la comunidad no tienen t(). Sigue el idioma de la app (inglés por defecto). */
const en = {
  work: 'Work', short: 'Short break', long: 'Long break', breakShort: 'Break', paused: '(paused)',
  open: 'Open Pomodoro', toggle: 'Start or pause the block', skip: 'Skip to next block', reset: 'Reset cycle',
  start: 'Start', pause: 'Pause', skipBtn: 'Skip', resetBtn: 'Reset',
  label: 'Label (e.g. flight)', labelAria: 'Block label', block: 'Block {n} of {m}',
  doneWork: 'Pomodoro: block finished. {next}.', doneBreak: 'Pomodoro: break is over.',
  needDaily: 'Pomodoro: enable the "Daily notes" core plugin (Settings → Core plugins) to log your blocks.',
  logFailed: 'Pomodoro: could not write to the daily note ({error})',
  sWork: 'Work block', sMinutes: 'Minutes.', sShort: 'Short break', sShortDesc: 'Minutes. Starts on its own after each block.',
  sLong: 'Long break', sEvery: 'Long break every', sEveryDesc: 'Work blocks per cycle.',
  sAuto: 'Auto-start next block', sAutoDesc: 'When a break ends, the next work block starts without touching anything.',
  sSound: 'Sound when done', sTest: 'Test', sChanges: 'Duration changes', sChangesDesc: 'Apply from the next block. Reset the cycle to apply them now.',
};
const es: typeof en = {
  work: 'Trabajo', short: 'Descanso corto', long: 'Descanso largo', breakShort: 'Descanso', paused: '(pausa)',
  open: 'Abrir Pomodoro', toggle: 'Iniciar o pausar el bloque', skip: 'Saltar al siguiente bloque', reset: 'Reiniciar el ciclo',
  start: 'Iniciar', pause: 'Pausar', skipBtn: 'Saltar', resetBtn: 'Reiniciar',
  label: 'Etiqueta (ej. vuelo)', labelAria: 'Etiqueta del bloque', block: 'Bloque {n} de {m}',
  doneWork: 'Pomodoro: terminó el bloque. {next}.', doneBreak: 'Pomodoro: terminó el descanso.',
  needDaily: 'Pomodoro: activá el plugin interno "Notas diarias" (Ajustes → Plugins internos) para anotar los bloques.',
  logFailed: 'Pomodoro: no se pudo anotar en la nota diaria ({error})',
  sWork: 'Bloque de trabajo', sMinutes: 'Minutos.', sShort: 'Descanso corto', sShortDesc: 'Minutos. Arranca solo después de cada bloque.',
  sLong: 'Descanso largo', sEvery: 'Descanso largo cada', sEveryDesc: 'Cantidad de bloques de trabajo por ciclo.',
  sAuto: 'Arrancar solo el siguiente bloque', sAutoDesc: 'Al terminar un descanso, empieza el próximo bloque de trabajo sin tocar nada.',
  sSound: 'Sonido al terminar', sTest: 'Probar', sChanges: 'Cambios de duración', sChangesDesc: 'Se aplican desde el próximo bloque. Para aplicarlos ya, reiniciá el ciclo.',
};

let dict = en;
export const setLanguage = (lang: string) => { dict = lang === 'es' ? es : en; };
export function tr(key: keyof typeof en, vars: Record<string, string | number> = {}): string {
  return dict[key].replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ''));
}
