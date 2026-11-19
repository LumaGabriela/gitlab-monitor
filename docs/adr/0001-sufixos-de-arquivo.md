# 0001 — Manter os sufixos `.component.ts` e `Component`

**Data:** 2026-11-18 · **Situação:** aceita

## Contexto

O style guide oficial do Angular foi reescrito na v20 e passou a gerar arquivos **sem sufixo**:
`user.ts` com a classe `User`, em vez de `user.component.ts` com `UserComponent`. O angular-eslint
tirou `component-class-suffix` e `directive-class-suffix` do conjunto *recommended* na v20.0.0, com
a nota de que essas regras não são mais recomendadas pelo time do Angular.

Este projeto nasceu depois disso e, ainda assim, usa os sufixos em todos os 40 componentes.

## Decisão

Manter `badge.component.ts` / `BadgeComponent`, `button.directive.ts` / `ButtonDirective`,
`theme.service.ts` / `ThemeService`, `select.model.ts`.

Dois motivos, nesta ordem:

1. **O padrão daqui é o do `fpf-metrics-web`** (§2 do `CLAUDE.md`), que usa sufixos. Divergir no
   nome dos arquivos tornaria mais caro portar um componente de lá para cá — e portar componentes
   de lá é o jeito normal de fazer crescer o `shared/ui/` deste projeto.
2. **O próprio guia oficial diz "when in doubt, prefer consistency".** Trocar metade do repositório
   de nome não entrega nada ao usuário da ferramenta.

Excetuam-se os módulos que não são artefato Angular: `cell-text.ts`, `column-label.ts`,
`rule-engine.ts`, `option-filter.ts`, `collator.ts`. Esses são funções puras e não ganham sufixo
nenhum, porque não há sufixo que os descreva.

## Consequência

- `product.ts` nunca aparece sozinho num resultado de busca sem dizer o que é — que é a crítica
  conhecida ao estilo sem sufixo.
- Em troca, o repositório diverge do que o `ng generate` produz. **Quem usar o CLI precisa
  renomear à mão**, ou configurar `"type": "component"` e `"typeSeparator": "."` nos schematics do
  `angular.json`.
- Nenhuma regra de lint impõe isso hoje (as duas saíram do *recommended*). É revisão.

## Gatilho de revisão

O `fpf-metrics-web` tirar os sufixos. Enquanto ele os mantiver, esta decisão não muda: o custo de
divergir dele é maior que o de divergir do CLI.
