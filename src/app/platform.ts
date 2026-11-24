// angosto, o táctil y bajo (iPhone en horizontal mide más de 768 px de ancho)
const phone = matchMedia('(max-width: 768px), (pointer: coarse) and (max-height: 500px)');
const nav = navigator as Navigator & { standalone?: boolean };

export const Platform = {
  /** pantalla angosta: sidebars como drawers */
  get isPhone() { return phone.matches; },
  get isMobile() { return phone.matches; },
  get isDesktop() { return !phone.matches; },
  isIos: /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1),
  isStandalone: matchMedia('(display-mode: standalone)').matches || nav.standalone === true,
  onChange(cb: () => void) { phone.addEventListener('change', cb); },
};
