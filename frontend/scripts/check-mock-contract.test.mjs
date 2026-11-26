// O mock é uma segunda cópia do contrato do backend, e cópia sem guarda
// descola: uma ordenação que faltava já deixou uma funcionalidade sem como ser
// testada até alguém notar à mão. Nada falha quando o mock fica para trás — a
// jornada só deixa de cobrir, em silêncio, o que parece cobrir.
//
// Este gate compara o vocabulário das duas pontas: colunas, ordenações e as
// opções de filtro que o painel guarda.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { after, before, test } from 'node:test';
import {
  COLUMNS,
  DIRECTIONS,
  MAX_TARGETS,
  NO_PIPELINE,
  PIPELINE_OPTIONS,
  REVIEW_FILTERS,
  SORTS,
} from '../mock/monitor-contract.mjs';

const ROOT = new URL('../..', import.meta.url).pathname;
const PYTHON = readFileSync(join(ROOT, 'gitlab_monitor.py'), 'utf8');

/** REPORT_COLUMNS: Column(key, label, largura do terminal, cell, weight). */
function pythonColumns() {
  const pattern = /Column\("(\w+)",\s*"([^"]*)",\s*\d+,\s*"(\w+)",\s*(\d+)\)/g;
  return [...PYTHON.matchAll(pattern)].map(([, key, , cell, weight]) => ({
    key,
    cell,
    weight: Number(weight),
  }));
}

/** SORTS: Sort(key, label, order, column, direction), em várias linhas. */
function pythonSorts() {
  const bloco = PYTHON.slice(PYTHON.indexOf('SORTS = ('));
  return bloco
    .slice(0, bloco.indexOf('\n)'))
    .split('Sort(')
    .slice(1)
    .map((trecho) => {
      const value = /^"(\w+)"/.exec(trecho)?.[1];
      const fim = [...trecho.matchAll(/"(\w+)",\s*"(asc|desc)"\)/g)].at(-1);
      return { value, column: fim?.[1], direction: fim?.[2] };
    });
}

function pythonReviewFilters() {
  const bloco = PYTHON.slice(PYTHON.indexOf('REVIEW_FILTERS = {'));
  return [...bloco.slice(0, bloco.indexOf('\n}')).matchAll(/"(\w+)": lambda/g)].map(
    ([, key]) => key,
  );
}

test('o mock oferece as mesmas colunas do REPORT_COLUMNS, na mesma ordem', () => {
  const esperado = pythonColumns();
  assert.ok(esperado.length > 0, 'nenhuma Column encontrada no gitlab_monitor.py');
  assert.deepEqual(
    COLUMNS.map(({ key, cell, weight }) => ({ key, cell, weight })),
    esperado,
  );
});

test('o mock oferece as mesmas ordenações do SORTS, na mesma ordem', () => {
  // A ordem importa: uma chave guardada que o backend não oferece mais cai na
  // PRIMEIRA da lista, e o painel desenha a seta pela coluna e pelo sentido.
  const esperado = pythonSorts();
  assert.ok(esperado.length > 0, 'nenhum Sort encontrado no gitlab_monitor.py');
  assert.deepEqual(
    SORTS.map(({ value, column, direction }) => ({ value, column, direction })),
    esperado,
  );
});

test('o mock oferece os mesmos valores de revisão do REVIEW_FILTERS', () => {
  const esperado = pythonReviewFilters();
  assert.ok(esperado.length > 0, 'nenhum REVIEW_FILTERS encontrado no gitlab_monitor.py');
  assert.deepEqual(Object.keys(REVIEW_FILTERS).sort(), [...esperado].sort());
});

test('o mock aceita os mesmos sentidos de ordenação do backend', () => {
  // Sem isto, o painel pode mandar `direction` e o mock ignorar em silêncio:
  // a jornada passaria mostrando a ordem que não é a pedida.
  const bloco = /DIRECTIONS = \(([^)]*)\)/.exec(PYTHON)?.[1] ?? '';
  const esperado = [...bloco.matchAll(/"(\w+)"/g)].map(([, valor]) => valor);
  assert.ok(esperado.length > 0, 'nenhum DIRECTIONS encontrado no gitlab_monitor.py');
  assert.deepEqual(DIRECTIONS, esperado);
  assert.match(PYTHON, /params\.get\("direction"/, 'o /data do Python não lê `direction`');
});

test('o mock usa a mesma grafia do MR sem pipeline', () => {
  const esperado = /NO_PIPELINE = "([\w-]+)"/.exec(PYTHON)?.[1];
  assert.equal(NO_PIPELINE, esperado);
  // Sem a opção, a poda de filtro guardado nunca roda de ponta a ponta.
  assert.ok(
    PIPELINE_OPTIONS.some((option) => option.value === esperado),
    'o mock não oferece a opção de MR sem pipeline',
  );
});

test('o mock usa o mesmo teto de alvos do MAX_TARGETS', () => {
  const esperado = Number(/MAX_TARGETS = (\d+)/.exec(PYTHON)?.[1]);
  assert.ok(esperado > 0, 'nenhum MAX_TARGETS encontrado no gitlab_monitor.py');
  assert.equal(MAX_TARGETS, esperado);
});

// Os testes abaixo sobem o mock de verdade, em porta livre: regex sobre o
// fonte não pega `payload['project']` nem `const { project } = payload`, e
// nenhuma jornada alcança os ramos de recusa do POST /settings (o Salvar fica
// desabilitado com a lista vazia).
let mock;
let base;

async function freePort() {
  return new Promise((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

before(async () => {
  const port = await freePort();
  mock = spawn(process.execPath, [join(ROOT, 'frontend/mock/monitor-mock.mjs')], {
    env: { ...process.env, MOCK_PORT: String(port) },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  await new Promise((resolve, reject) => {
    mock.once('error', reject);
    mock.once('exit', () => reject(new Error('o mock encerrou antes de subir')));
    mock.stdout.once('data', resolve);
  });
  base = `http://127.0.0.1:${port}`;
});

after(() => mock?.kill());

const postSettings = (payload) =>
  fetch(`${base}/settings`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
const getData = async () => (await fetch(`${base}/data`)).json();

test('GET /data traz meta.projects e não traz meta.project', async () => {
  const { meta } = await getData();
  assert.ok(Array.isArray(meta.projects), 'meta.projects deve ser uma lista');
  assert.equal('project' in meta, false);
});

test('GET /data traz meta.targets canônico e meta.failed', async () => {
  // O rótulo de meta.projects não volta a ser alvo; é por meta.targets que o
  // painel reconcilia a escolha guardada com o que o monitor consulta.
  await postSettings({ projects: ['groups/grupo'], interval: '15' });
  const { meta } = await getData();
  assert.deepEqual(meta.targets, ['groups/grupo']);
  // O rótulo é o `unquote` do Python: o prefixo groups/ continua nele. O
  // `label` de /projects (o full_path, sem prefixo) é outra coisa.
  assert.deepEqual(meta.projects, ['groups/grupo']);
  assert.deepEqual(meta.failed, []);
  await postSettings({ projects: ['grupo%2Fprojeto'], interval: '15' });
});

test('GET /data devolve a ordem invertida quando a consulta pede o outro sentido', async () => {
  const mrs = async (params) =>
    (await (await fetch(`${base}/data?${params}`)).json()).rows.map((row) => row.cells.mr.label);
  const natural = await mrs('sort=likes');
  const invertida = await mrs('sort=likes&direction=asc');
  assert.deepEqual(invertida, [...natural].reverse());
  // Sentido natural e sentido desconhecido dão a mesma ordem.
  assert.deepEqual(await mrs('sort=likes&direction=desc'), natural);
  assert.deepEqual(await mrs('sort=likes&direction=qualquer'), natural);
});

/** As chaves de RowFactsModel, lidas do modelo do painel. */
function modelFactKeys() {
  const model = readFileSync(
    join(ROOT, 'frontend/src/app/core/models/api/panel-api.model.ts'),
    'utf8',
  );
  const bloco = /export interface RowFactsModel \{([\s\S]*?)\n\}/.exec(model)?.[1] ?? '';
  // Só as propriedades de primeiro nível; o comentário pode citar `chaves`.
  return [...bloco.matchAll(/^ {2}readonly (\w+)\??:/gm)].map(([, key]) => key).sort();
}

test('o evento do mock traz facts com as mesmas chaves de RowFactsModel', async () => {
  const esperado = modelFactKeys();
  assert.ok(esperado.length > 0, 'nenhum RowFactsModel encontrado no modelo do painel');
  const { events, rows } = await getData();
  assert.ok(events.length > 0, 'o mock não entregou nenhum evento');
  // O evento é o espelho do facts da linha: as duas pontas vêm do serialize_row.
  assert.deepEqual(Object.keys(rows[0].facts).sort(), esperado);
  for (const event of events) {
    assert.deepEqual(Object.keys(event.facts ?? {}).sort(), esperado, event.mr);
  }
});

test('GET /projects traz grupos antes de projetos, com value, label e kind', async () => {
  const { targets } = await (await fetch(`${base}/projects`)).json();
  assert.ok(targets.some((t) => t.kind === 'group') && targets.some((t) => t.kind === 'project'));
  assert.equal(targets[0].kind, 'group');
  for (const t of targets) assert.deepEqual(Object.keys(t).sort(), ['kind', 'label', 'value']);
});

test('POST /settings recusa lista vazia, ausente e project singular com 400', async () => {
  for (const payload of [
    { projects: [], interval: '15' },
    { interval: '15' },
    { project: 'grupo/projeto', interval: '15' },
  ]) {
    const response = await postSettings(payload);
    assert.equal(response.status, 400, JSON.stringify(payload));
  }
});

test('POST /settings recusa mais alvos que MAX_TARGETS e aceita exatamente o teto', async () => {
  const alvo = (n) => `grupo%2Fp${n}`;
  const acima = Array.from({ length: MAX_TARGETS + 1 }, (_, n) => alvo(n));
  assert.equal((await postSettings({ projects: acima, interval: '15' })).status, 400);
  assert.equal((await postSettings({ projects: acima.slice(1), interval: '15' })).status, 200);
});

test('POST /settings descarta duplicata preservando a ordem', async () => {
  const lista = ['grupo%2Foutro', 'grupo%2Fprojeto', 'grupo%2Foutro'];
  assert.equal((await postSettings({ projects: lista, interval: '15' })).status, 200);
  assert.deepEqual((await getData()).meta.projects, ['grupo/outro', 'grupo/projeto']);
});
