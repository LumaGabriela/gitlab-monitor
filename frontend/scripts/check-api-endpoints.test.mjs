// Nenhum literal de rota fora do catálogo.
//
// Com um lugar só, uma rota renomeada no gitlab_monitor.py é uma linha a
// mudar; espalhada pelos serviços, é uma caçada por string — e o que escapa
// só aparece em produção, como um 404.
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const ROOT = new URL('..', import.meta.url).pathname;
const CATALOG = join(ROOT, 'src/app/core/api/api-endpoints.json');
const routes = Object.values(JSON.parse(readFileSync(CATALOG, 'utf8')));

function sourceFiles(dir) {
  return readdirSync(dir).flatMap((entry) => {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) return sourceFiles(full);
    return entry.endsWith('.ts') && !entry.endsWith('.spec.ts') ? [full] : [];
  });
}

test('nenhum literal de rota fora do catálogo', () => {
  const offenders = [];
  for (const file of sourceFiles(join(ROOT, 'src/app'))) {
    if (file.endsWith('api-endpoints.ts')) continue;
    const content = readFileSync(file, 'utf8');
    for (const route of routes) {
      if (content.includes(`'${route}'`) || content.includes(`"${route}"`)) {
        offenders.push(`${file.replace(ROOT, '')}: ${route}`);
      }
    }
  }
  assert.deepEqual(offenders, []);
});

test('o catálogo não tem rota repetida', () => {
  assert.equal(new Set(routes).size, routes.length);
});
