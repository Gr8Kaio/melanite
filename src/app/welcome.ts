export const WELCOME_NOTE = String.raw`---
tags: [melanite]
---
# Bienvenida a Melanite

Melanite guarda tus notas **en este dispositivo** y funciona sin conexión. Escribí en Markdown: la sintaxis se oculta salvo en la línea donde está el cursor.

## Lo básico

- **Negrita**, *cursiva*, ~~tachado~~, ==resaltado== y \`código\`
- Links a otras notas: [[Una nota nueva]] (si no existe, se crea al tocarla)
- Links con alias: [[Bienvenida#Lo básico|volver arriba]]
- Tags: #ideas #facu
- [Links normales](https://es.wikipedia.org/wiki/Melanita)

## Tareas

- [ ] Una tarea pendiente
- [x] Una tarea hecha

## Matemática

En línea: $e^{i\pi} + 1 = 0$, y en bloque:

$$
\begin{align*}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \times \mathbf{B} &= \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
\end{align*}
$$

## Callouts

> [!tip] Atajos
> **Ctrl+E** alterna entre edición y lectura. **Ctrl+N** crea una nota.

> [!warning]- Plegable
> Este callout arranca cerrado.

## Tablas

| Atajo | Acción |
| --- | --- |
| Ctrl+E | Modo lectura |
| Ctrl+\\ | Sidebar izquierda |

## Diagramas

\`\`\`mermaid
graph LR
  A[Idea] --> B[Nota]
  B --> C[[Link]]
  C --> A
\`\`\`

## Código

\`\`\`ts
function saludar(nombre: string) {
  return \`Hola, \${nombre}\`;
}
\`\`\`

Las notas al pie también funcionan.[^1]

[^1]: Como esta.
`.replace(/\\`/g, '`').replace(/\\\$/g, '$');
