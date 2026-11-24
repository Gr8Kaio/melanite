import { snippetCompletion, startCompletion, type Completion, type CompletionContext, type CompletionResult } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { registerStrings, t } from '../i18n';

/**
 * Autocompletado de LaTeX dentro de $…$ y $$…$$, como en un editor de LaTeX:
 *  - `\` + letras sugiere comandos (los que llevan argumentos se insertan con
 *    campos que se recorren con Tab),
 *  - `\begin{` sugiere entornos y cierra con su `\end{…}`,
 *  - `\end{` sugiere el entorno abierto más cercano.
 */

registerStrings({
  es: {
    'latex.plugin': 'Sugerencias de LaTeX',
    'latex.plugin.desc': 'Sugiere comandos y entornos de LaTeX mientras escribís fórmulas.',
    'latex.env': 'entorno',
    'latex.close': 'cerrar entorno',
    'latex.mathEnv': 'fórmula ($$)',
    'latex.listEnv': 'lista',
  },
  en: {
    'latex.plugin': 'LaTeX suggestions',
    'latex.plugin.desc': 'Suggests LaTeX commands and environments while you type formulas.',
    'latex.env': 'environment',
    'latex.close': 'close environment',
    'latex.mathEnv': 'formula ($$)',
    'latex.listEnv': 'list',
  },
});

const MATH_NODES = /^(InlineMath|BlockMath)$/;

/** ¿La posición está dentro de una fórmula? */
export function inMath(state: EditorState, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (MATH_NODES.test(n.name)) return true;
  }
  // fórmula todavía sin cerrar (el parser no la reconoce): $ impares en la línea, o $$ impares antes del cursor
  const line = state.doc.lineAt(pos);
  const inLine = line.text.slice(0, pos - line.from).replace(/\\\$/g, '').replace(/\$\$/g, '');
  if ((inLine.match(/\$/g) ?? []).length % 2 === 1) return true;
  const before = state.doc.sliceString(Math.max(0, pos - 5000), pos);
  return ((before.match(/\$\$/g) ?? []).length % 2) === 1;
}

// ---------------------------------------------------------------- datos

/** [comando sin barra, plantilla de argumentos (snippet), detalle] */
type Cmd = [string, string, string];

const SYMBOLS: Record<string, string> = {
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ϵ', varepsilon: 'ε', zeta: 'ζ', eta: 'η', theta: 'θ',
  vartheta: 'ϑ', iota: 'ι', kappa: 'κ', lambda: 'λ', mu: 'μ', nu: 'ν', xi: 'ξ', pi: 'π', varpi: 'ϖ', rho: 'ρ',
  varrho: 'ϱ', sigma: 'σ', varsigma: 'ς', tau: 'τ', upsilon: 'υ', phi: 'ϕ', varphi: 'φ', chi: 'χ', psi: 'ψ', omega: 'ω',
  Gamma: 'Γ', Delta: 'Δ', Theta: 'Θ', Lambda: 'Λ', Xi: 'Ξ', Pi: 'Π', Sigma: 'Σ', Upsilon: 'Υ', Phi: 'Φ', Psi: 'Ψ', Omega: 'Ω',
  cdot: '·', times: '×', div: '÷', pm: '±', mp: '∓', ast: '∗', star: '⋆', circ: '∘', bullet: '•',
  leq: '≤', geq: '≥', neq: '≠', approx: '≈', equiv: '≡', sim: '∼', simeq: '≃', cong: '≅', propto: '∝', ll: '≪', gg: '≫',
  le: '≤', ge: '≥', ne: '≠',
  infty: '∞', partial: '∂', nabla: '∇', forall: '∀', exists: '∃', nexists: '∄', emptyset: '∅', varnothing: '∅',
  in: '∈', notin: '∉', ni: '∋', subset: '⊂', subseteq: '⊆', supset: '⊃', supseteq: '⊇', cup: '∪', cap: '∩',
  setminus: '∖', land: '∧', lor: '∨', neg: '¬', lnot: '¬', wedge: '∧', vee: '∨', oplus: '⊕', otimes: '⊗',
  to: '→', rightarrow: '→', leftarrow: '←', leftrightarrow: '↔', Rightarrow: '⇒', Leftarrow: '⇐', Leftrightarrow: '⇔',
  implies: '⟹', iff: '⟺', mapsto: '↦', uparrow: '↑', downarrow: '↓', longrightarrow: '⟶',
  ldots: '…', cdots: '⋯', vdots: '⋮', ddots: '⋱', dots: '…', quad: '␣', qquad: '␣␣',
  angle: '∠', perp: '⊥', parallel: '∥', mid: '∣', hbar: 'ℏ', ell: 'ℓ', Re: 'ℜ', Im: 'ℑ', aleph: 'ℵ', prime: '′',
  langle: '⟨', rangle: '⟩', lfloor: '⌊', rfloor: '⌋', lceil: '⌈', rceil: '⌉', degree: '°',
  sin: 'sin', cos: 'cos', tan: 'tan', cot: 'cot', sec: 'sec', csc: 'csc', arcsin: 'arcsin', arccos: 'arccos', arctan: 'arctan',
  sinh: 'sinh', cosh: 'cosh', tanh: 'tanh', log: 'log', ln: 'ln', exp: 'exp', det: 'det', dim: 'dim', ker: 'ker',
  max: 'max', min: 'min', sup: 'sup', inf: 'inf', arg: 'arg', gcd: 'gcd', deg: 'deg', Pr: 'Pr',
  displaystyle: '', textstyle: '', limits: '', nonumber: '', notag: '',
};

const WITH_ARGS: Cmd[] = [
  ['frac', '{${}}{${}}', 'a/b'],
  ['dfrac', '{${}}{${}}', 'a/b'],
  ['tfrac', '{${}}{${}}', 'a/b'],
  ['sqrt', '{${}}', '√'],
  ['sqrt[]', '[${}]{${}}', 'ⁿ√'],
  ['sum', '_{${}}^{${}}', 'Σ'],
  ['prod', '_{${}}^{${}}', 'Π'],
  ['int', '_{${}}^{${}}', '∫'],
  ['iint', '_{${}}', '∬'],
  ['oint', '_{${}}', '∮'],
  ['lim', '_{${} \\to ${}}', 'lim'],
  ['bigcup', '_{${}}^{${}}', '⋃'],
  ['bigcap', '_{${}}^{${}}', '⋂'],
  ['binom', '{${}}{${}}', '(n k)'],
  ['text', '{${}}', 'texto'],
  ['mathrm', '{${}}', 'roman'],
  ['mathbf', '{${}}', 'negrita'],
  ['mathit', '{${}}', 'cursiva'],
  ['mathbb', '{${}}', 'ℝ ℕ ℤ'],
  ['mathcal', '{${}}', '𝒜'],
  ['mathfrak', '{${}}', '𝔄'],
  ['boldsymbol', '{${}}', 'negrita'],
  ['operatorname', '{${}}', 'op'],
  ['hat', '{${}}', 'â'],
  ['bar', '{${}}', 'ā'],
  ['vec', '{${}}', 'a⃗'],
  ['dot', '{${}}', 'ȧ'],
  ['ddot', '{${}}', 'ä'],
  ['tilde', '{${}}', 'ã'],
  ['widehat', '{${}}', 'âb'],
  ['overline', '{${}}', 'a̅b'],
  ['underline', '{${}}', 'a̲b'],
  ['overbrace', '{${}}^{${}}', '⏞'],
  ['underbrace', '{${}}_{${}}', '⏟'],
  ['overset', '{${}}{${}}', ''],
  ['underset', '{${}}{${}}', ''],
  ['stackrel', '{${}}{${}}', ''],
  ['color', '{${}}{${}}', ''],
  ['boxed', '{${}}', '▭'],
  ['tag', '{${}}', '(n)'],
  ['label', '{${}}', ''],
  ['left(', ' ${} \\right)', '( )'],
  ['left[', ' ${} \\right]', '[ ]'],
  ['left\\{', ' ${} \\right\\}', '{ }'],
  ['left|', ' ${} \\right|', '| |'],
  ['left\\langle', ' ${} \\right\\rangle', '⟨ ⟩'],
];

/** [entorno, plantilla del cuerpo] (el cursor queda en el primer campo) */
const MATRIX = '\t${} & ${} \\\\\n\t${} & ${}';
const ENVS: [string, string][] = [
  ['align*', '\t${} &= ${} \\\\\n\t${} &= ${}'],
  ['align', '\t${} &= ${}'],
  ['aligned', '\t${} &= ${} \\\\\n\t${} &= ${}'],
  ['equation', '\t${}'],
  ['equation*', '\t${}'],
  ['gather', '\t${}'],
  ['gather*', '\t${} \\\\\n\t${}'],
  ['gathered', '\t${}'],
  ['multline', '\t${}'],
  ['multline*', '\t${}'],
  ['split', '\t${} &= ${}'],
  ['cases', '\t${} & \\text{si } ${} \\\\\n\t${} & \\text{si no}'],
  ['dcases', '\t${} & ${} \\\\\n\t${} & ${}'],
  ['matrix', MATRIX],
  ['pmatrix', MATRIX],
  ['bmatrix', MATRIX],
  ['Bmatrix', MATRIX],
  ['vmatrix', MATRIX],
  ['Vmatrix', MATRIX],
  ['smallmatrix', MATRIX],
  ['array', MATRIX],
  ['alignat*', '\t${} &= ${}'],
  ['CD', '\t${}'],
];
/** Entornos que llevan un argumento después de \begin{…} */
const ENV_ARG: Record<string, string> = { array: '{${cc}}', 'alignat*': '{${2}}' };

// ---------------------------------------------------------------- fuentes

const SYMBOL_OPTIONS: Completion[] = Object.entries(SYMBOLS).map(([name, glyph]) => ({ label: `\\${name}`, detail: glyph, type: 'constant' }));
const ARG_OPTIONS: Completion[] = WITH_ARGS.map(([name, args, detail]) => {
  const head = `\\${name.endsWith('[]') ? name.slice(0, -2) : name}`;
  return snippetCompletion(head + args, { label: `\\${name}`, detail, type: 'function', boost: 1 });
});

/** `\begin` se completa como `\begin{` y vuelve a abrir el menú, ahora con entornos. */
const BEGIN_OPTION: Completion = {
  label: '\\begin', detail: '{…}', type: 'keyword', boost: 2,
  apply: (view: EditorView, _c: Completion, from: number, to: number) => {
    const close = view.state.doc.sliceString(to, to + 1) === '}';
    view.dispatch({ changes: { from, to: close ? to + 1 : to, insert: '\\begin{}' }, selection: { anchor: from + 7 } });
    startCompletion(view);
  },
};
const COMMANDS = [BEGIN_OPTION, ...ARG_OPTIONS, ...SYMBOL_OPTIONS];

type ApplyFn = (view: EditorView, c: Completion, from: number, to: number) => void;

/** Al aceptar, también se come la `}` que haya puesto closeBrackets (no va en `to`: CodeMirror filtra con ese rango). */
function absorbBrace(c: Completion, shiftFrom = 0): Completion {
  const base = c.apply;
  return {
    ...c,
    apply: (view: EditorView, comp: Completion, from: number, to: number) => {
      const end = view.state.doc.sliceString(to, to + 1) === '}' ? to + 1 : to;
      if (typeof base === 'function') (base as ApplyFn)(view, comp, from - shiftFrom, end);
      else view.dispatch({ changes: { from: from - shiftFrom, to: end, insert: base ?? comp.label }, selection: { anchor: from - shiftFrom + (base ?? comp.label).length } });
    },
  };
}

/** Entornos de texto (fuera de fórmulas): se renderizan como listas. */
export const TEXT_ENVS: [string, string][] = [
  ['itemize', '\t\\item ${}\n\t\\item ${}'],
  ['enumerate', '\t\\item ${}\n\t\\item ${}'],
  ['description', '\t\\item[${}] ${}\n\t\\item[${}] ${}'],
];

function envOptions(insideMath: boolean): Completion[] {
  const math = ENVS.map(([name, body]) => {
    const env = `\\begin{${name}}${ENV_ARG[name] ?? ''}\n${body}\n\\end{${name}}`;
    // fuera de una fórmula, el entorno de matemática se envuelve en $$ para que KaTeX lo dibuje
    return insideMath
      ? absorbBrace(snippetCompletion(env.slice('\\begin{'.length), { label: name, detail: t('latex.env'), type: 'class' }))
      : absorbBrace(snippetCompletion(`$$\n${env}\n$$`, { label: name, detail: t('latex.mathEnv'), type: 'class' }), '\\begin{'.length);
  });
  if (insideMath) return math;
  const text = TEXT_ENVS.map(([name, body]) => absorbBrace(snippetCompletion(`${name}}\n${body}\n\\end{${name}}`, {
    label: name, detail: t('latex.listEnv'), type: 'class', boost: 3,
  })));
  return [...text, ...math];
}

const CODE_NODES = /^(FencedCode|CodeBlock|InlineCode|CodeText|Comment|Frontmatter)$/;
function inCode(state: EditorState, pos: number): boolean {
  for (let n: ReturnType<ReturnType<typeof syntaxTree>['resolveInner']> | null = syntaxTree(state).resolveInner(pos, -1); n; n = n.parent) {
    if (CODE_NODES.test(n.name)) return true;
  }
  return false;
}

const TEXT_COMMANDS: Completion[] = [
  BEGIN_OPTION,
  snippetCompletion('\\item ${}', { label: '\\item', detail: '•', type: 'keyword' }),
  snippetCompletion('\\item[${}] ${}', { label: '\\item[]', detail: 'description', type: 'keyword' }),
];

/** Entorno abierto más cercano antes de `pos` que todavía no se cerró. */
export function openEnvironment(text: string): string | null {
  const stack: string[] = [];
  for (const m of text.matchAll(/\\(begin|end)\{([^}]*)\}/g)) {
    if (m[1] === 'begin') stack.push(m[2]);
    else {
      const i = stack.lastIndexOf(m[2]);
      if (i >= 0) stack.splice(i, 1);
    }
  }
  return stack.at(-1) ?? null;
}

export function latexSource(ctx: CompletionContext): CompletionResult | null {
  const math = inMath(ctx.state, ctx.pos);
  if (!math && inCode(ctx.state, ctx.pos)) return null;
  const line = ctx.state.doc.lineAt(ctx.pos);
  const before = line.text.slice(0, ctx.pos - line.from);

  const begin = /\\begin\{([A-Za-z*]*)$/.exec(before);
  if (begin) return { from: ctx.pos - begin[1].length, options: envOptions(math), validFor: /^[A-Za-z*]*$/ };

  const end = /\\end\{([A-Za-z*]*)$/.exec(before);
  if (end) {
    const env = openEnvironment(ctx.state.doc.sliceString(Math.max(0, ctx.pos - 20000), ctx.pos - end[0].length));
    const all = [...(math ? [] : TEXT_ENVS.map(([n]) => n)), ...ENVS.map(([n]) => n)];
    const names = env ? [env, ...all.filter((n) => n !== env)] : all;
    return {
      from: ctx.pos - end[1].length, validFor: /^[A-Za-z*]*$/,
      options: names.map((n, i) => absorbBrace({ label: n, apply: `${n}}`, detail: i === 0 && env ? t('latex.close') : t('latex.env'), boost: i === 0 && env ? 5 : 0, type: 'class' })),
    };
  }

  const cmd = /\\([A-Za-z]*)$/.exec(before);
  if (!cmd || (!cmd[1] && !ctx.explicit && before.endsWith('\\\\'))) return null;
  // fuera de fórmulas solo lo de listas (\begin, \item): una barra suelta en texto no debería abrir 200 símbolos
  return { from: ctx.pos - cmd[0].length, options: math ? COMMANDS : TEXT_COMMANDS, validFor: /^\\[A-Za-z]*$/ };
}

