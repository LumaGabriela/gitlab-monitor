// O tom de uma regra de destaque não é só uma string do motor: ele precisa de
// uma cor de borda, de um fundo de linha, de um ícone (que é também o texto
// para leitor de tela), de uma classe na legenda e de um nome no catálogo. O
// mesmo vale para o traço (`markStyle`), que precisa de uma espessura e de um
// nome. Sem este gate, um tom novo entra em `rule-engine.ts` e em
// `monitor_rules.py`, passa em todos os outros testes e some em silêncio nas
// superfícies abaixo — inclusive no ícone, que é o canal de quem não enxerga
// a cor.
//
// Como o gate do motor, este lê os arquivos como texto, sem importar nenhum, e
// compara o que cada um declara. O terminal (`TONE_CODES` e `ROW_MARKS` de
// `monitor_table.py`) fica de fora de propósito: ele é Python contra Python, e
// quem o prende é `tests/test_monitor_table.py`, que deriva de `RULE_TONES`.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const ROOT = new URL('../..', import.meta.url).pathname;
const ler = (caminho) => readFileSync(join(ROOT, caminho), 'utf8');

const ENGINE = ler('frontend/src/app/core/rules/rule-engine.ts');
const MIXINS = ler('frontend/src/styles/_mixins.scss');
const TABLE = ler('frontend/src/styles/components/_table.scss');
const LEGEND = ler('frontend/src/app/shared/monitor/monitor-legend/monitor-legend.component.ts');
const PT = JSON.parse(ler('frontend/src/assets/i18n/pt.json'));
const EN = JSON.parse(ler('frontend/src/assets/i18n/en.json'));

// O corpo entre os delimitadores da declaração; falha alto se ela sumir.
const corpo = (fonte, padrao, onde) => {
  const achado = padrao.exec(fonte)?.[1];
  assert.ok(achado !== undefined, `${padrao} não encontrado em ${onde}`);
  return achado;
};

const ordenado = (itens) => [...new Set(itens)].sort();

/** As chaves de um mapa SCSS (`tom: var(--x)`) ou de um Record TS (`tom: 'x'`). */
const chaves = (texto, onde) => {
  const lidas = [...texto.matchAll(/^\s*["']?(\w+)["']?\s*:/gm)].map((m) => m[1]);
  assert.ok(lidas.length > 0, `nenhuma chave lida de ${onde}`);
  return ordenado(lidas);
};

const TONS = ordenado(
  [
    ...corpo(ENGINE, /RULE_TONES:[^=]*=\s*\[([^\]]*)\]/, 'rule-engine.ts').matchAll(
      /["'](\w+)["']/g,
    ),
  ].map((m) => m[1]),
);
const TRACOS = ordenado(
  [
    ...corpo(ENGINE, /RULE_MARK_STYLES:[^=]*=\s*\[([^\]]*)\]/, 'rule-engine.ts').matchAll(
      /["'](\w+)["']/g,
    ),
  ].map((m) => m[1]),
);

test('o motor declara tons e traços para comparar', () => {
  assert.ok(TONS.length > 0, 'nenhum tom lido de rule-engine.ts');
  assert.ok(TRACOS.length > 0, 'nenhum traço lido de rule-engine.ts');
});

test('cada tom tem cor de borda em $rule-tone-colors', () => {
  const mapa = corpo(MIXINS, /\$rule-tone-colors:\s*\(([\s\S]*?)\n\);/, '_mixins.scss');
  assert.deepEqual(chaves(mapa, '$rule-tone-colors'), TONS);
});

test('cada tom tem fundo de linha em $row-tones', () => {
  const mapa = corpo(TABLE, /\$row-tones:\s*\(([\s\S]*?)\n\);/, '_table.scss');
  assert.deepEqual(chaves(mapa, '$row-tones'), TONS);
});

test('cada tom e cada traço têm classe na legenda', () => {
  // A legenda liga as classes uma a uma no template: tom que não entrar ali
  // fica sem a borda que repete a da linha destacada.
  const tons = [...LEGEND.matchAll(/ui-legend__rule--tone-(\w+)/g)].map((m) => m[1]);
  const tracos = [...LEGEND.matchAll(/ui-legend__rule--mark-(\w+)/g)].map((m) => m[1]);
  assert.deepEqual(ordenado(tons), TONS);
  assert.deepEqual(ordenado(tracos), TRACOS);
});

test('cada traço tem espessura em $rule-mark-widths', () => {
  const mapa = corpo(MIXINS, /\$rule-mark-widths:\s*\(([\s\S]*?)\n\);/, '_mixins.scss');
  assert.deepEqual(chaves(mapa, '$rule-mark-widths'), TRACOS);
});

test('cada tom e cada traço têm nome nos dois catálogos', () => {
  // Sem a chave, o select de Configurações mostraria o identificador cru.
  for (const [idioma, catalogo] of [
    ['pt', PT],
    ['en', EN],
  ]) {
    for (const tom of TONS) {
      assert.ok(
        catalogo.settings[`rule-tone-${tom}`],
        `falta settings.rule-tone-${tom} em ${idioma}`,
      );
    }
    for (const traco of TRACOS) {
      assert.ok(
        catalogo.settings[`rule-mark-${traco}`],
        `falta settings.rule-mark-${traco} em ${idioma}`,
      );
    }
  }
});
