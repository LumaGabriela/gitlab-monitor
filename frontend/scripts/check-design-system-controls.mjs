#!/usr/bin/env node
// Gate de reuso: um componente não redesenha um controle que o Design System
// já tem.
//
// Quando cada tela refaz o próprio botão, eles divergem em silêncio — padding
// diferente, foco diferente, estado desabilitado diferente. O gate procura,
// no CSS dos componentes, um bloco que recria um controle já publicado como
// `.ui-*` em src/styles/components/.
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

const CONTROLS = [
  'button',
  'checkbox',
  'input',
  'link',
  'radio',
  'select',
  'switch',
  'textarea',
  'toggle',
];

async function scssFiles(path) {
  const entries = await readdir(join(ROOT, path), { withFileTypes: true });
  const found = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) found.push(...(await scssFiles(child)));
    else if (entry.name.endsWith('.scss')) found.push(child);
  }
  return found;
}

// O que o DS já publica: só reprova quem reinventa algo que existe.
const published = new Set();
for (const file of await scssFiles('src/styles/components')) {
  const content = readFileSync(join(ROOT, file), 'utf8');
  for (const control of CONTROLS) {
    if (new RegExp(`\\.ui-${control}\\b`).test(content)) published.add(control);
  }
}

const problems = [];
let componentStyles = [];
try {
  componentStyles = await scssFiles('src/app');
} catch {
  // Sem SCSS por componente é exatamente o estado esperado aqui.
}

for (const file of componentStyles) {
  const content = readFileSync(join(ROOT, file), 'utf8');
  content.split('\n').forEach((line, index) => {
    for (const control of published) {
      if (new RegExp(`(^|[\\s&.#])&?__?${control}\\s*\\{`).test(line)) {
        problems.push(
          `${file}:${index + 1}  recria o controle "${control}" (já existe .ui-${control})`,
        );
      }
    }
  });
}

if (problems.length) {
  console.error('Controles do Design System redesenhados em componente:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error('\nUse a classe .ui-* correspondente em vez de recriar o controle.');
  process.exit(1);
}

console.log(
  `check-design-system-controls: ${published.size} controle(s) publicado(s), nenhum redesenhado.`,
);
