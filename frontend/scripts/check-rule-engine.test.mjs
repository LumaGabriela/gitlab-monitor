// O motor das regras de destaque existe em duas linguagens: `rule-engine.ts`
// (o painel) e `monitor_rules.py` (o terminal). Os dois guardam o mesmo
// contrato — campos, tipo de cada campo, operadores por tipo e tons —, e cópia
// sem guarda descola. Este gate lê os dois arquivos como texto, sem importar
// nenhum, e compara o que cada um declara.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const ROOT = new URL('../..', import.meta.url).pathname;
const PYTHON = readFileSync(join(ROOT, 'monitor_rules.py'), 'utf8');
const TYPESCRIPT = readFileSync(join(ROOT, 'frontend/src/app/core/rules/rule-engine.ts'), 'utf8');

// O corpo entre os delimitadores da declaração; falha alto se ela sumir.
const corpo = (fonte, padrao, onde) => {
  const achado = padrao.exec(fonte)?.[1];
  assert.ok(achado !== undefined, `${padrao} não encontrado em ${onde}`);
  return achado;
};

const aspas = (texto) => [...texto.matchAll(/["']([A-Za-z]+)["']/g)].map((m) => m[1]);

// `chave: valor` ou `"chave": "valor"` -> { chave: valor }, sem perder duplicata.
const mapaDeTexto = (texto, onde) => {
  const mapa = {};
  for (const [, chave, valor] of texto.matchAll(/["']?(\w+)["']?\s*:\s*["'](\w+)["']/g)) {
    assert.ok(!(chave in mapa), `chave repetida em ${onde}: ${chave}`);
    mapa[chave] = valor;
  }
  return mapa;
};

// `chave: [..]` ou `"chave": (..)` -> { chave: [itens] }.
const mapaDeListas = (texto, abre, fecha, onde) => {
  const mapa = {};
  const padrao = new RegExp(`["']?(\\w+)["']?\\s*:\\s*\\${abre}([^\\${fecha}]*)\\${fecha}`, 'g');
  for (const [, chave, itens] of texto.matchAll(padrao)) {
    assert.ok(!(chave in mapa), `chave repetida em ${onde}: ${chave}`);
    mapa[chave] = aspas(itens);
  }
  return mapa;
};

const ordenado = (itens) => [...itens].sort();

const tiposPython = () =>
  mapaDeTexto(
    corpo(PYTHON, /RULE_FIELD_KINDS\s*=\s*\{([^}]*)\}/, 'monitor_rules.py'),
    'monitor_rules.py',
  );
const tiposTs = () =>
  mapaDeTexto(
    corpo(TYPESCRIPT, /RULE_FIELD_KINDS:[^=]*=\s*\{([^}]*)\}/, 'rule-engine.ts'),
    'rule-engine.ts',
  );

test('os campos de regra do Python são os do RULE_FIELD_KINDS do painel', () => {
  const python = Object.keys(tiposPython());
  const painel = Object.keys(tiposTs());
  assert.ok(painel.length > 0, 'nenhum campo lido de rule-engine.ts');
  assert.deepEqual(ordenado(python), ordenado(painel));
});

test('o tipo de cada campo é o mesmo nos dois motores', () => {
  const python = tiposPython();
  const painel = tiposTs();
  assert.ok(Object.keys(painel).length > 0, 'nenhum campo lido de rule-engine.ts');
  assert.deepEqual(python, painel);
  for (const tipo of Object.values(python)) {
    assert.ok(['number', 'boolean', 'text'].includes(tipo), `tipo desconhecido: ${tipo}`);
  }
});

test('os operadores por tipo são os mesmos nos dois motores', () => {
  const python = mapaDeListas(
    corpo(PYTHON, /RULE_OPERATORS_BY_KIND\s*=\s*\{([^}]*)\}/, 'monitor_rules.py'),
    '(',
    ')',
    'monitor_rules.py',
  );
  const painel = mapaDeListas(
    corpo(TYPESCRIPT, /RULE_OPERATORS_BY_KIND:[^=]*=\s*\{([^}]*)\}/, 'rule-engine.ts'),
    '[',
    ']',
    'rule-engine.ts',
  );
  assert.deepEqual(Object.keys(painel).sort(), ['boolean', 'number', 'text']);
  assert.deepEqual(python, painel);

  // A lista geral de operadores também tem de bater.
  const geralPython = aspas(corpo(PYTHON, /RULE_OPERATORS\s*=\s*\(([^)]*)\)/, 'monitor_rules.py'));
  const geralPainel = aspas(
    corpo(TYPESCRIPT, /RULE_OPERATORS:[^=]*=\s*\[([^\]]*)\]/, 'rule-engine.ts'),
  );
  assert.ok(geralPainel.length > 0, 'nenhum operador lido de rule-engine.ts');
  assert.deepEqual(geralPython, geralPainel);
});

test('os tons de regra são os mesmos nos dois motores', () => {
  const python = aspas(corpo(PYTHON, /RULE_TONES\s*=\s*\(([^)]*)\)/, 'monitor_rules.py'));
  const painel = aspas(corpo(TYPESCRIPT, /RULE_TONES:[^=]*=\s*\[([^\]]*)\]/, 'rule-engine.ts'));
  assert.ok(painel.length > 0, 'nenhum tom lido de rule-engine.ts');
  assert.deepEqual(python, painel);
});

test('os traços de marca são os mesmos nos dois motores', () => {
  const python = aspas(corpo(PYTHON, /RULE_MARK_STYLES\s*=\s*\(([^)]*)\)/, 'monitor_rules.py'));
  const painel = aspas(
    corpo(TYPESCRIPT, /RULE_MARK_STYLES:[^=]*=\s*\[([^\]]*)\]/, 'rule-engine.ts'),
  );
  assert.ok(painel.length > 0, 'nenhum traço lido de rule-engine.ts');
  assert.deepEqual(python, painel);
});

test('o traço padrão de cada tom é o mesmo nos dois motores', () => {
  const python = mapaDeTexto(
    corpo(PYTHON, /DEFAULT_MARK_STYLE\s*=\s*\{([^}]*)\}/, 'monitor_rules.py'),
    'monitor_rules.py',
  );
  const painel = mapaDeTexto(
    corpo(TYPESCRIPT, /DEFAULT_MARK_STYLE:[^=]*=\s*\{([^}]*)\}/, 'rule-engine.ts'),
    'rule-engine.ts',
  );
  assert.ok(Object.keys(painel).length > 0, 'nenhum traço padrão lido de rule-engine.ts');
  assert.deepEqual(python, painel);
  const tons = aspas(corpo(TYPESCRIPT, /RULE_TONES:[^=]*=\s*\[([^\]]*)\]/, 'rule-engine.ts'));
  assert.deepEqual(ordenado(Object.keys(painel)), ordenado(tons));
});

test('os modos de regra são os mesmos nos dois motores', () => {
  const python = aspas(corpo(PYTHON, /RULE_MODES\s*=\s*\(([^)]*)\)/, 'monitor_rules.py'));
  const painel = aspas(corpo(TYPESCRIPT, /RULE_MODES:[^=]*=\s*\[([^\]]*)\]/, 'rule-engine.ts'));
  assert.ok(painel.length > 0, 'nenhum modo lido de rule-engine.ts');
  assert.deepEqual(python, painel);
});

const NOTIFY_TS = readFileSync(
  join(ROOT, 'frontend/src/app/core/services/notify-rules.service.ts'),
  'utf8',
);

test('os tipos de evento do Python são os NOTIFY_EVENT_KINDS do painel', () => {
  const python = aspas(corpo(PYTHON, /NOTIFY_EVENT_KINDS\s*=\s*\(([^)]*)\)/, 'monitor_rules.py'));
  const painel = aspas(
    corpo(NOTIFY_TS, /NOTIFY_EVENT_KINDS:[^=]*=\s*\[([^\]]*)\]/, 'notify-rules.service.ts'),
  );
  assert.ok(painel.length > 0, 'nenhum tipo lido de notify-rules.service.ts');
  assert.deepEqual(python, painel);
});

test('os lados que podem decidir o aviso são os mesmos nos dois motores', () => {
  // O valor guardado é lido pelos dois: um lado que só exista aqui faria o
  // terminal e o painel decidirem por critérios diferentes.
  const python = aspas(corpo(PYTHON, /NOTIFY_DECIDERS\s*=\s*\(([^)]*)\)/, 'monitor_rules.py'));
  const painel = aspas(
    corpo(NOTIFY_TS, /NOTIFY_DECIDERS:[^=]*=\s*\[([^\]]*)\]/, 'notify-rules.service.ts'),
  );
  assert.ok(painel.length > 0, 'nenhum lado lido de notify-rules.service.ts');
  assert.deepEqual(python, painel);
});

test('os campos das regras de aviso são os mesmos nos dois lados', () => {
  const python = [
    ...corpo(PYTHON, /DEFAULT_NOTIFY_RULES\s*=\s*\{([\s\S]*?)\n\}/, 'monitor_rules.py').matchAll(
      /^\s*"(\w+)"\s*:/gm,
    ),
  ].map((m) => m[1]);
  const painel = [
    ...corpo(
      NOTIFY_TS,
      /DEFAULT_RULES:[^=]*=\s*\{([\s\S]*?)\n\};/,
      'notify-rules.service.ts',
    ).matchAll(/^\s{2}(\w+)\s*:/gm),
  ].map((m) => m[1]);
  assert.ok(painel.length > 0, 'nenhum campo lido de notify-rules.service.ts');
  assert.deepEqual(ordenado(python), ordenado(painel));
});

test('as chaves de uma regra de aviso são as mesmas nos dois lados', () => {
  const python = [
    ...corpo(
      PYTHON,
      /def _parse_notify_criteria[\s\S]*?parsed\.append\(\s*\{([\s\S]*?)\n\s*\}\s*\)/,
      'monitor_rules.py',
    ).matchAll(/^\s*"(\w+)"\s*:/gm),
  ].map((m) => m[1]);
  const painel = [
    ...corpo(
      NOTIFY_TS,
      /interface NotifyRule\s*\{([\s\S]*?)\n\}/,
      'notify-rules.service.ts',
    ).matchAll(/^\s*readonly\s+(\w+)\s*:/gm),
  ].map((m) => m[1]);
  assert.ok(painel.length > 0, 'nenhuma chave lida de NotifyRule');
  assert.deepEqual(ordenado(python), ordenado(painel));
});
