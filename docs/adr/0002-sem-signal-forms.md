# 0002 — Controles próprios sobre `ControlBase`, sem Signal Forms

**Data:** 2026-11-18 · **Situação:** aceita

## Contexto

Signal Forms (`@angular/forms/signals`) ficaram **estáveis na v22**, e são a recomendação atual
para formulário novo: o modelo é um signal seu, a validação vem de schema (`required`,
`minLength`, `validateHttp` com `debounce`), e `FormValueControl` substitui o
`ControlValueAccessor`.

O `CLAUDE.md` dizia "Formulários com Reactive Forms" — e isso era **falso**: não existe um único
`FormGroup`, `FormControl` ou `ReactiveFormsModule` neste projeto. O que existe é `ControlBase`,
uma diretiva abstrata que implementa `ControlValueAccessor` e expõe o valor como `model()`; as
telas ligam os controles por `[value]`/`(valueChange)`.

## Decisão

Ficar com os controles próprios. Não adotar Signal Forms agora.

O motivo é que **não há formulário aqui**, no sentido que Signal Forms resolve. O que existe são
campos soltos que salvam sozinhos: um intervalo, um limite de likes, uma lista de alvos marcados.
Nenhum tem validação cruzada, nenhum tem submit, e o único Salvar explícito (§3) existe porque
trocar o alvo recomeça a referência do backend — não porque haja um formulário a validar.

Signal Forms traria um schema para descrever o que hoje é uma função de três linhas (`toCount`,
`parseInterval`), e um `FormValueControl` para substituir um `ControlValueAccessor` que já
funciona e já é compatível com Reactive Forms, caso um dia seja preciso.

## Consequência

- Controle novo estende `ControlBase` e lê `FIELD_CONTEXT`. É uma API deste projeto, que alguém de
  fora precisa aprender.
- A validação de cada campo mora em quem lê o valor, espalhada, e não num schema só.
- Em compensação, `app-select`, `app-multi-select`, `app-checkbox` e `app-text-input` compartilham
  uma base só, e o estado inválido e o `id` vêm todos do `app-field`.

## Gatilho de revisão

Aparecer uma tela com validação entre campos (um campo cujo valor válido depende de outro), ou com
submit de verdade, ou com validação contra o servidor. Aí o schema paga o próprio custo.
