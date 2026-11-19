// @ts-check
const eslint = require('@eslint/js');
const { defineConfig } = require('eslint/config');
const tseslint = require('typescript-eslint');
const angular = require('angular-eslint');

/**
 * Cada regra aqui é uma regra do CLAUDE.md §4–§6 que passou a ter dono.
 * Regra escrita que o lint não pega depende de revisão, e revisão deixa
 * passar — foi assim que o import invertido de core/ para shared/ entrou.
 *
 * A fronteira de dependência é a última seção: `features → shared → core`,
 * em um sentido só. É `no-restricted-imports` em vez de Sheriff porque o
 * projeto tem três camadas e nenhuma lib, e uma dependência a mais custaria
 * mais do que as quatro regras de caminho abaixo.
 */
module.exports = defineConfig([
  {
    files: ['**/*.ts'],
    extends: [
      eslint.configs.recommended,
      tseslint.configs.recommended,
      tseslint.configs.stylistic,
      angular.configs.tsRecommended,
    ],
    processor: angular.processInlineTemplates,
    // Lint com informação de tipo: é o que habilita `no-uncalled-signals`
    // (signal lido sem `()` no template ou no TS) e as demais regras tipadas.
    languageOptions: {
      parserOptions: {
        projectService: true,
        tsconfigRootDir: __dirname,
      },
    },
    rules: {
      '@angular-eslint/directive-selector': [
        'error',
        {
          type: 'attribute',
          prefix: 'app',
          style: 'camelCase',
        },
      ],
      '@angular-eslint/component-selector': [
        'error',
        {
          type: 'element',
          prefix: 'app',
          style: 'kebab-case',
        },
      ],
      '@angular-eslint/prefer-signals': 'error',
      '@angular-eslint/prefer-output-emitter-ref': 'error',
      '@angular-eslint/prefer-output-readonly': 'error',
      '@angular-eslint/prefer-inject': 'error',
      // Duas regras deste pacote ficam DE FORA de propósito, e não por
      // esquecimento:
      //   `inject-at-top` exige inject() antes de tudo, contra a ordem de
      //   membros do §4 (inputs/outputs → injeções → signals), que é a do
      //   fpf-metrics-web.
      //   `prefer-signal-model` pede model() em todo par input+output de
      //   mesmo nome, contra o §3: componente de `shared/monitor/` é burro,
      //   só input()/output(), e quem grava o estado é a tela.
      '@angular-eslint/no-input-rename': 'error',
      '@angular-eslint/no-output-rename': 'error',
      '@angular-eslint/use-component-view-encapsulation': 'error',
      '@angular-eslint/prefer-on-push-component-change-detection': 'error',
      // `host: {}` em vez de @HostBinding/@HostListener (§4).
      '@angular-eslint/prefer-host-metadata-property': 'error',
      // Serviço é sempre `providedIn`, nunca provider solto em componente.
      '@angular-eslint/use-injectable-provided-in': 'error',
      // Todo `subscribe` de produção precisa de cleanup explícito (§7 do doc).
      '@angular-eslint/no-implicit-take-until-destroyed': 'error',
      // Higiene de signals: `computed` que não devolve, signal lido sem `()`,
      // e escrita de signal dentro de contexto reativo.
      '@angular-eslint/computed-must-return': 'error',
      '@angular-eslint/no-uncalled-signals': 'error',
      '@angular-eslint/reactive-context-must-read-signal': 'error',
      // `any` é proibido; o caminho é `unknown` + narrowing (§4).
      '@typescript-eslint/no-explicit-any': 'error',
    },
  },
  {
    files: ['**/*.html'],
    extends: [angular.configs.templateRecommended, angular.configs.templateAccessibility],
    rules: {
      '@angular-eslint/template/prefer-control-flow': 'error',
      '@angular-eslint/template/no-any': 'error',
      '@angular-eslint/template/prefer-self-closing-tags': 'error',
      '@angular-eslint/template/prefer-at-empty': 'error',
      '@angular-eslint/template/prefer-at-else': 'error',
      // `[class.x]`/`[style.y]` em vez de ngClass/ngStyle (§4).
      '@angular-eslint/template/prefer-class-binding': 'error',
      '@angular-eslint/template/prefer-style-binding': 'error',
      '@angular-eslint/template/prefer-ngsrc': 'error',
      // `style="..."` literal é proibido; `[style.x]` continua valendo,
      // porque a largura das colunas sai dos pesos que o backend informa
      // (§3) e não existe como classe.
      '@angular-eslint/template/no-inline-styles': ['error', { allowBindToStyle: true }],
      '@angular-eslint/template/no-duplicate-attributes': 'error',
      '@angular-eslint/template/require-switch-default': 'error',
      '@angular-eslint/template/use-track-by-function': 'error',
    },
  },
  // Fronteira de camadas: `features → shared → core`, nunca o contrário.
  {
    files: ['src/app/core/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/shared/**', '**/features/**'],
              message:
                'core/ não importa de shared/ nem de features/. A dependência vai em um sentido só (CLAUDE.md §3).',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['src/app/shared/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/features/**'],
              message: 'shared/ não importa de features/ (CLAUDE.md §3).',
            },
          ],
        },
      ],
    },
  },
]);
