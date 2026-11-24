/** Rutas del vault: siempre con "/", sin "/" inicial ni final, sin segmentos vacíos. */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.').join('/').normalize('NFC');
}
export const basename = (p: string) => p.slice(p.lastIndexOf('/') + 1);
export const dirname = (p: string) => (p.includes('/') ? p.slice(0, p.lastIndexOf('/')) : '');
export function extname(p: string): string {
  const b = basename(p);
  const i = b.lastIndexOf('.');
  return i > 0 ? b.slice(i + 1).toLowerCase() : '';
}
export function stripExt(name: string): string {
  const i = name.lastIndexOf('.');
  return i > 0 ? name.slice(0, i) : name;
}
export const joinPath = (...parts: string[]) => normalizePath(parts.filter(Boolean).join('/'));
export const isHidden = (p: string) => p.split('/').some((s) => s.startsWith('.'));

export const IMAGE_EXTS = ['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'bmp', 'avif', 'heic'];
export const TEXT_EXTS = ['md', 'txt', 'json', 'css', 'js', 'canvas', 'csv'];
export const isTextPath = (p: string) => TEXT_EXTS.includes(extname(p));
