export const WELCOME_NOTE = String.raw`---
tags: [melanite]
---
# Welcome to Melanite

Melanite keeps your notes **on this device** and works offline. Write in Markdown: the syntax hides except on the line where your cursor is.

## The basics

- **Bold**, *italic*, ~~strikethrough~~, ==highlight== and \`code\`
- Links to other notes: [[A new note]] (tap it and it gets created)
- Links with an alias: [[Welcome#The basics|back to the top]]
- Tags: #ideas #study
- [Regular links](https://en.wikipedia.org/wiki/Melanite)

## Tasks

- [ ] Something to do
- [x] Something done

## Math

Inline: $e^{i\pi} + 1 = 0$, and as a block:

$$
\begin{align*}
\nabla \cdot \mathbf{E} &= \frac{\rho}{\varepsilon_0} \\
\nabla \times \mathbf{B} &= \mu_0 \mathbf{J} + \mu_0 \varepsilon_0 \frac{\partial \mathbf{E}}{\partial t}
\end{align*}
$$

## Callouts

> [!tip] Shortcuts
> **Ctrl+E** toggles editing and reading. **Ctrl+N** creates a note.

> [!warning]- Foldable
> This callout starts collapsed.

## Tables

| Shortcut | Action |
| --- | --- |
| Ctrl+E | Reading view |
| Ctrl+\\ | Left sidebar |

## Diagrams

\`\`\`mermaid
graph LR
  A[Idea] --> B[Note]
  B --> C[[Link]]
  C --> A
\`\`\`

## Code

\`\`\`ts
function greet(name: string) {
  return \`Hello, \${name}\`;
}
\`\`\`

Footnotes work too.[^1]

[^1]: Like this one.
`.replace(/\\`/g, '`').replace(/\\\$/g, '$');
