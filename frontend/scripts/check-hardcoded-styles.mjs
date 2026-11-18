#!/usr/bin/env node
// Gate de estilo: cor e medida só podem existir como token.
//
// Fora dos arquivos de token, um hex, um rgb() ou um "16px" escrito à mão é
// um valor que não acompanha o tema e não aparece quando o Design System
// muda. O gate reprova antes de o padrão se espalhar.
import { readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { join, relative } from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;

// Os únicos arquivos onde um valor cru é a própria razão de existir.
const ALLOWED = new Set([
  'src/styles/_themes.scss',
  'src/styles/_tailwind-theme.scss',
  'src/styles/_breakpoints.scss',
]);

const SCANNED = ['src/app', 'src/styles', 'src/index.html', 'src/styles.scss'];

const RULES = [
  { name: 'hex', pattern: /#[0-9a-fA-F]{3,8}\b/g },
  { name: 'rgb/hsl', pattern: /\b(?:rgba?|hsla?)\s*\(/g },
  { name: 'px', pattern: /\b\d+(?:\.\d+)?px\b/g },
  { name: 'style inline', pattern: /\sstyle\s*=\s*["']/g },
  { name: 'fill com cor', pattern: /fill\s*=\s*["']#/g },
];

async function files(path) {
  const full = join(ROOT, path);
  let entries;
  try {
    entries = await readdir(full, { withFileTypes: true });
  } catch {
    return [path]; // é um arquivo, não um diretório
  }
  const found = [];
  for (const entry of entries) {
    const child = join(path, entry.name);
    if (entry.isDirectory()) found.push(...(await files(child)));
    else if (/\.(ts|html|scss|css)$/.test(entry.name)) found.push(child);
  }
  return found;
}

const problems = [];
for (const base of SCANNED) {
  for (const file of await files(base)) {
    // Spec pode fixar um valor esperado: é asserção, não estilo.
    if (ALLOWED.has(file) || file.endsWith('.spec.ts')) continue;
    const content = readFileSync(join(ROOT, file), 'utf8');
    content.split('\n').forEach((line, index) => {
      // Comentário descreve, não pinta.
      if (/^\s*(\/\/|\*|<!--)/.test(line)) return;
      for (const rule of RULES) {
        rule.pattern.lastIndex = 0;
        const match = rule.pattern.exec(line);
        if (match) {
          problems.push(
            `${relative(ROOT, join(ROOT, file))}:${index + 1}  ${rule.name}: ${match[0]}`,
          );
        }
      }
    });
  }
}

if (problems.length) {
  console.error('Valores fixos fora dos arquivos de token:\n');
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(
    `\n${problems.length} ocorrência(s). Use um token de src/styles/_tailwind-theme.scss,\n` +
      'ou crie a variável nos arquivos de token se ela ainda não existir.',
  );
  process.exit(1);
}

console.log('check-hardcoded-styles: nenhum valor fixo fora dos arquivos de token.');
