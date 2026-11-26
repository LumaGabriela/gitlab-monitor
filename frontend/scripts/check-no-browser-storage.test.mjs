// Nenhuma preferência vai ao armazenamento do navegador.
//
// As preferências moram em user-data/preferences.json, dono: o backend. Um
// uso esquecido de localStorage ou sessionStorage reabriria um segundo lugar
// onde a escolha da pessoa pode ficar, invisível ao export e ao import.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const ROOT = new URL('..', import.meta.url).pathname;
const EXTENSIONS = ['.ts', '.html', '.mjs'];
const FORBIDDEN = /\b(localStorage|sessionStorage)\b/;

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return EXTENSIONS.some((ext) => entry.endsWith(ext)) ? [full] : [];
  });
}

test('nenhum localStorage ou sessionStorage em .ts, .html e .mjs de src/ e e2e/', () => {
  const offenders = [];
  for (const dir of ['src', 'e2e']) {
    for (const file of sourceFiles(join(ROOT, dir))) {
      readFileSync(file, 'utf8')
        .split('\n')
        .forEach((line, index) => {
          if (FORBIDDEN.test(line)) offenders.push(`${file.replace(ROOT, '')}:${index + 1}`);
        });
    }
  }
  assert.deepEqual(offenders, []);
});
