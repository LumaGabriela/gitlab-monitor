// Integridade da camada de tokens: o que a camada de nomes promete tem que
// existir na camada de valores, nos dois temas, e os breakpoints do SCSS têm
// que ser os mesmos do @theme.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import assert from 'node:assert/strict';
import { test } from 'node:test';

const ROOT = new URL('..', import.meta.url).pathname;
const read = (file) => readFileSync(join(ROOT, 'src/styles', file), 'utf8');

const themes = read('_themes.scss');
const theme = read('_tailwind-theme.scss');
const breakpoints = read('_breakpoints.scss');

function block(content, selector) {
  const start = content.indexOf(selector);
  assert.notEqual(start, -1, `bloco ${selector} não encontrado`);
  const open = content.indexOf('{', start);
  const close = content.indexOf('\n}', open);
  return content.slice(open, close);
}

function declaredNames(content) {
  return [...content.matchAll(/^\s*(--[\w-]+):/gm)].map((match) => match[1]);
}

test('todo nome semântico aponta para um valor que existe', () => {
  const values = new Set(declaredNames(block(themes, ':root')));
  const referenced = [...theme.matchAll(/var\((--[\w-]+-value)\)/g)].map((match) => match[1]);
  assert.ok(referenced.length > 0, 'nenhum token de cor mapeado');
  for (const name of referenced) {
    assert.ok(values.has(name), `${name} é citado em _tailwind-theme.scss mas não existe em :root`);
  }
});

test('o tema escuro redefine toda cor, e nada além de cor', () => {
  const light = declaredNames(block(themes, ':root'));
  const dark = new Set(declaredNames(block(themes, '.dark')));
  const colors = light.filter((name) => name.startsWith('--color-'));
  for (const name of colors) {
    assert.ok(dark.has(name), `${name} não tem valor no tema escuro`);
  }
  for (const name of dark) {
    assert.ok(
      light.includes(name),
      `${name} só existe no tema escuro: um token sem par no claro some quando o tema troca`,
    );
  }
});

test('cada escala de texto redefine exatamente a escala inteira', () => {
  // Uma classe que esquece um degrau deixaria aquele texto no tamanho
  // padrão, desalinhado do resto da página.
  const base = declaredNames(block(themes, ':root')).filter((n) => n.startsWith('--font-size-'));
  for (const classe of ['.text-size-sm', '.text-size-lg']) {
    assert.deepEqual(declaredNames(block(themes, classe)).sort(), [...base].sort(), classe);
  }
});

test('os breakpoints do SCSS são os mesmos do @theme', () => {
  const fromTheme = Object.fromEntries(
    [...theme.matchAll(/--breakpoint-(\w+):\s*(\d+)px/g)].map((m) => [m[1], m[2]]),
  );
  const fromScss = Object.fromEntries(
    [...breakpoints.matchAll(/'(\w+)':\s*(\d+)px/g)].map((m) => [m[1], m[2]]),
  );
  assert.deepEqual(fromScss, fromTheme);
});

test('as escalas obrigatórias do DS estão completas', () => {
  const declared = new Set(declaredNames(block(theme, '@theme static')));
  const required = [
    '--font-family-sans',
    '--font-size-xs',
    '--font-size-4xl',
    '--font-weight-regular',
    '--line-height-normal',
    '--spacing-1',
    '--spacing-16',
    '--radius-xs',
    '--radius-full',
    '--shadow-sm',
    '--focus-ring-width',
    '--focus-ring-offset',
    '--duration-fast',
    '--easing-standard',
    '--size-control-md',
    '--size-icon-md',
    '--size-touch-min',
    '--z-index-sticky',
  ];
  for (const name of required) {
    assert.ok(declared.has(name), `escala do DS incompleta: falta ${name}`);
  }
});
