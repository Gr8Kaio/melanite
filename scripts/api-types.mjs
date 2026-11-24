// Genera melanite-api.d.ts: un solo archivo con `declare module 'melanite'` para los plugins.
// TypeScript 7 sacó `outFile`, así que emitimos los .d.ts por archivo y los envolvemos cada uno en
// `declare module 'melanite/<ruta>'`, con los imports relativos reescritos (como hacía outFile con AMD).
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, relative, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const out = mkdtempSync(join(tmpdir(), 'melanite-dts-'));
try {
  execFileSync(process.execPath, [join(root, 'node_modules/typescript/bin/tsc'), '-p', join(root, 'tsconfig.json'),
    '--declaration', '--emitDeclarationOnly', '--noEmit', 'false', '--rootDir', root, '--outDir', out], { stdio: 'inherit' });

  const srcDir = join(out, 'src');
  const modName = (file) => 'melanite/' + relative(srcDir, file).replaceAll('\\', '/').replace(/(\/index)?\.d\.ts$/, '');
  const resolveSpec = (from, spec) => {
    const base = resolve(dirname(from), spec);
    for (const f of [`${base}.d.ts`, join(base, 'index.d.ts')]) if (existsSync(f)) return f;
    throw new Error(`no encuentro ${spec} desde ${from}`);
  };

  const entry = join(srcDir, 'api/index.d.ts');
  const queue = [entry];
  const seen = new Set(queue);
  const blocks = [];
  const SPEC = /(\bfrom\s*|\bimport\s*\(\s*|\bimport\s+)(['"])(\.{1,2}\/[^'"]+)\2/g;
  while (queue.length) {
    const file = queue.shift();
    let text = readFileSync(file, 'utf8')
      .replace(/^import ['"][^'"]+\.css['"];\n/gm, '')
      .replace(/^\/\/\/ <reference types="vite[^\n]*\n/gm, '')
      .replace(/^export \{\};\n/gm, '');
    text = text.replace(SPEC, (_m, pre, q, spec) => {
      const target = resolveSpec(file, spec);
      if (!seen.has(target)) { seen.add(target); queue.push(target); }
      return `${pre}${q}${modName(target)}${q}`;
    });
    // dentro de `declare module` ya es contexto ambiente: `declare` sobra (y `declare global` pasa a `global`)
    text = text.replace(/^(export )?declare /gm, '$1');
    blocks.push(`declare module '${modName(file)}' {\n${text.trimEnd().replace(/^/gm, '  ')}\n}`);
  }

  const header = `// Generado por \`npm run api:types\` a partir de src/api/index.ts. No editar a mano.\n// Melanite ${JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')).version}\n`;
  const main = `declare module 'melanite' {\n  export * from '${modName(entry)}';\n}\n`;
  writeFileSync(join(root, 'melanite-api.d.ts'), `${header}\n${main}\n${blocks.join('\n\n')}\n`);
  console.log(`melanite-api.d.ts: ${blocks.length} módulos`);
} finally {
  rmSync(out, { recursive: true, force: true });
}
