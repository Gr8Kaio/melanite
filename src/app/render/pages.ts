import { fitWideMath } from './renderer';

/**
 * Cortes de la última vista previa en hojas de cada nota (ruta → texto y bloques donde empieza cada hoja).
 * El PDF los reusa si el texto no cambió: así sale con las mismas hojas que se ven, sin volver a medir
 * (medir de nuevo puede dar unos px distintos, por ejemplo con fórmulas en línea, y mover un corte justo).
 */
export const previewCuts = new Map<string, { text: string; cuts: number[] }>();

/**
 * Reparte los bloques de primer nivel de `src` en hojas A4 (`.ml-page`) dentro de `pages`,
 * que tiene que estar en el DOM y sin zoom (se mide). Lo usan la vista previa lado a lado y el PDF.
 * Un párrafo `.ml-pagebreak` (`\newpage`, lo marca el renderer) fuerza el corte.
 * `given`: índices de los bloques que empiezan hoja (de una vista previa); si vienen, no se mide.
 * Devuelve los índices usados.
 * ponytail: corta entre bloques de primer nivel; un bloque más alto que una hoja estira esa hoja.
 */
export function paginate(src: HTMLElement, pages: HTMLElement, given?: number[]): number[] {
  pages.empty();
  // cada hoja lleva una copia vacía de la raíz (clase y data-source-path/line-offset para links, tareas y doble click)
  const addPage = () => {
    const page = pages.createDiv('ml-page');
    // formato de la nota (frontmatter): las variables --page-* y los números de página van en la hoja
    for (const p of Array.from(src.style)) if (p.startsWith('--page-')) page.style.setProperty(p, src.style.getPropertyValue(p));
    if (src.style.getPropertyValue('--page-font')) page.addClass('has-font');
    if (src.dataset.pageNumbers) page.dataset.numbers = src.dataset.pageNumbers;
    return page.appendChild(src.cloneNode(false)) as HTMLElement;
  };
  const blocks = Array.from(src.children) as HTMLElement[];

  // medir: la altura útil de una hoja vacía, después todo en una sola hoja larga
  const flow = addPage();
  const page = flow.parentElement!;
  const full = page.offsetHeight;
  const cs = getComputedStyle(page);
  const limit = page.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  flow.append(...blocks);
  fitWideMath(flow); // con el ancho real de la hoja, antes de medir alturas
  let cuts: number[];
  if (given && given.every((i) => i > 0 && i < blocks.length)) cuts = given;
  else {
    cuts = [];
    let start: number | null = null;
    blocks.forEach((b, i) => {
      if (b.hasClass('ml-pagebreak')) { if (i > 0) cuts.push(i); start = null; return; }
      if (start === null) start = b.offsetTop;
      // el margen de abajo del último bloque se sale del contenedor y estira la hoja: si no se cuenta, al imprimir sobra una hoja en blanco
      else if (b.offsetTop + b.offsetHeight + parseFloat(getComputedStyle(b).marginBottom) - start > limit) { cuts.push(i); start = b.offsetTop; }
    });
  }
  pages.empty();
  const at = new Set(cuts);
  let body = addPage();
  blocks.forEach((b, i) => { if (at.has(i)) body = addPage(); body.appendChild(b); });
  // una hoja que se pasa de A4 solo puede ser por un bloque más alto que una hoja: esa se deja estirar al imprimir;
  // las demás quedan clavadas en una hoja de papel (si al imprimir miden unos px más, no se corre nada a otra hoja)
  for (const p of Array.from(pages.children) as HTMLElement[]) {
    p.toggleClass('is-tall', p.offsetHeight > full + 1 && Array.from(p.firstElementChild!.children).some((b) => (b as HTMLElement).offsetHeight > limit));
  }
  return cuts;
}
