// Duas constantes do gitlab_monitor.py têm cópia no painel: o teto de alvos
// (o formulário precisa impedir antes de o backend recusar) e o intervalo
// padrão (a reserva quando a consulta de confirmação não traz um snapshot
// novo). Cópia sem guarda descola: o mock já teve a sua, e por isso ganhou o
// gate de contrato. Este é o mesmo gate, para as cópias que moram em `src/`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const ROOT = new URL('../..', import.meta.url).pathname;
const PYTHON = readFileSync(join(ROOT, 'gitlab_monitor.py'), 'utf8');
const SERVICE = readFileSync(
  join(ROOT, 'frontend/src/app/core/services/gitlab-monitor.service.ts'),
  'utf8',
);

const numero = (fonte, padrao, onde) => {
  const achado = padrao.exec(fonte)?.[1];
  assert.ok(achado, `${padrao} não encontrado em ${onde}`);
  return Number(achado);
};

test('o teto de alvos do painel é o MAX_TARGETS do backend', () => {
  assert.equal(
    numero(SERVICE, /export const MAX_TARGETS = (\d+)/, 'gitlab-monitor.service.ts'),
    numero(PYTHON, /MAX_TARGETS = (\d+)/, 'gitlab_monitor.py'),
  );
});

test('o intervalo padrão do painel é o DEFAULT_INTERVAL do backend', () => {
  assert.equal(
    numero(SERVICE, /const DEFAULT_INTERVAL = ([\d.]+)/, 'gitlab-monitor.service.ts'),
    numero(PYTHON, /DEFAULT_INTERVAL = ([\d.]+)/, 'gitlab_monitor.py'),
  );
});
