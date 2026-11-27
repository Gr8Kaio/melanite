import { fitWideMath } from './renderer';

/**
 * Reparte los bloques de primer nivel de `src` en hojas A4 (`.ml-page`) dentro de `pages`,
 * que tiene que estar en el DOM y sin zoom (se mide). Lo usan la vista previa lado a lado y el PDF.
 * Un párrafo `.ml-pagebreak` (`\newpage`, lo marca el renderer) fuerza el corte.
 * ponytail: corta entre bloques de primer nivel; un bloque más alto que una hoja estira esa hoja.
 */
export function paginate(src: HTMLElement, pages: HTMLElement): void {
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
  const cs = getComputedStyle(page);
  const limit = page.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
  flow.append(...blocks);
  fitWideMath(flow); // con el ancho real de la hoja, antes de medir alturas
  const cuts = new Set<HTMLElement>();
  let start: number | null = null;
  for (const b of blocks) {
    if (b.hasClass('ml-pagebreak')) { cuts.add(b); start = null; continue; }
    if (start === null) start = b.offsetTop;
    else if (b.offsetTop + b.offsetHeight - start > limit) { cuts.add(b); start = b.offsetTop; }
  }
  pages.empty();
  let body = addPage();
  blocks.forEach((b, i) => { if (i > 0 && cuts.has(b)) body = addPage(); body.appendChild(b); });
}
