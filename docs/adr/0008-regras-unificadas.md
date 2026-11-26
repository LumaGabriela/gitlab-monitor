# 0008 — Um editor de regras só, com cor e traço em eixos separados

**Data:** 2026-11-25 · **Situação:** aceita

## Contexto

As regras de destaque de linha (`/settings/highlights`) nasceram primeiro: campo, comparação,
valor, cor, e um bloco por regra que repete a borda que a linha vai ter na tabela. As notificações
(`/settings/notifications`) tinham outra coisa: um corte geral — tipos de evento, só o que é meu,
likes mínimos, rascunhos, autores silenciados, horário de silêncio, espera por MR — e nada que
comparasse os fatos de um MR.

Quem usa as duas telas pediu o mesmo editor nas duas, e disse por quê: *"faça com que utilize o
mesmo componente de `/settings/highlights` para que caso eu modifique ele no futuro, ambas as telas
reflitam"*. Uma segunda lista de regras escrita à parte divergiria da primeira no primeiro ajuste —
é o mesmo motivo que fez o mock ganhar `check-mock-contract` (ADR 0007), só que aqui a cópia estaria
dentro do próprio frontend, onde nenhum gate a veria.

Ao mesmo tempo, a regra de aviso precisa de duas coisas que o destaque não tem (notificar ou
silenciar, e para quais tipos de evento), e **não** precisa de uma que o destaque tem: cor. Um aviso
do navegador não tem borda para pintar.

## Decisão

**Um componente, `shared/monitor/rule-list/`, e capacidades ligadas por `input()`.** As duas telas
passam `rules` e `context` e recebem `ruleChange`, `ruleRemove` e `ruleAdd`; o que difere entra como
interruptor: `appearance` (Cor e Traço), `showMode` (notificar/silenciar) e `showKinds` (tipos desta
regra). Destaques entram com `appearance`; notificações, com `showMode` e `showKinds`. Capacidade que
faltar nasce no componente, nunca numa cópia.

O editor é burro de propósito: não injeta serviço nem guarda estado. O que ele precisa saber — as
opções de cada select, os valores que os MRs em tela mostram, a faixa de cada número e quantas linhas
a comparação casa — chega pronto no `RuleListContext`, que o `RuleEditorService` (em `core/`, porque
`shared/` não pode depender de `features/`) calcula uma vez para as duas telas.

**Cor e traço viraram dois eixos.** `RuleTone` diz a cor (`danger`, `warning`, `success`, `strong`,
`info`, `neutral`) e `RuleMarkStyle` diz o desenho da borda (`solid`, `dashed`, `dotted`, `double`),
cada um com os seus tokens (`$rule-tone-colors` e `$rule-mark-widths`). Antes o tom escolhia os dois,
e `DEFAULT_MARK_STYLE` guarda esse casamento como **padrão** — a regra antiga continua desenhando o
que desenhava, e quem não escolhe traço herda o do tom.

**Nas regras de aviso não há cor.** Nem `tone`, nem `markStyle`: `NotifyRule` é comparação, modo,
tipos e ligada. Pedir uma cor ali seria pedir uma escolha que não aparece em lugar nenhum.

**A decisão de avisar tem uma ordem, e ela é escrita na tela.** O corte geral decide primeiro;
depois, um critério `mute` aplicável descarta o evento; e, havendo ao menos um critério `notify`
ligado que cubra aquele tipo de evento, só passam os eventos que casarem com algum deles. Se nenhum
`notify` cobre o tipo, os critérios não mudam nada — sem essa última cláusula, a primeira regra
`notify` criada calaria todo o resto do painel.

Alternativas rejeitadas:

- **Uma segunda lista de regras só para avisos.** Divergiria no primeiro ajuste, e é exatamente o
  que a pessoa pediu para não acontecer.
- **Manter cor e traço no mesmo eixo.** Com seis tons e quatro traços, seria um select de até vinte e
  quatro combinações, ou tons novos sem traço próprio. Separar custa um campo a mais na tela de
  destaques e devolve um canal que não é cor (§3 do `CLAUDE.md`: compactar não pode afinar o único
  canal que não é cor).
- **Trocar o corte geral pelos critérios.** Seria mais simples ter uma lista só, mas obrigaria a
  escrever uma regra para dizer "não me avise de rascunho". O corte geral é a escolha de uma
  linha; o critério é a exceção que compara fatos.

## Consequência

- **Mudança no editor aparece nas duas telas, de propósito.** É o ganho e também o risco: um campo
  novo sem interruptor aparece onde não devia. Por isso cada capacidade que só uma tela quer entra
  como `input()` com padrão `false`, e os dois specs de seção afirmam quais interruptores cada uma liga.
- **Os blocos do editor têm interruptores demais para uma tela só.** Quem lê o componente vê campos
  que a sua tela não desenha; é o preço de não ter duas cópias.
- **O vocabulário duplica no terminal.** `mode`, `kinds` e os traços também existem em
  `monitor_rules.py`, guardados pelo gate do ADR 0007 — que cobre o vocabulário, não a semântica.
  Mudar a ordem da decisão de aviso exige mudar os dois motores e os testes dos dois.
- **A tela precisa explicar dois níveis de tipos de evento.** "Avise quando acontecer" (um
  `app-multi-select` só) vale para todo aviso; o multi-select dentro de cada critério vale só para
  aquela regra. Sem a frase que separa os dois, parecem a mesma coisa em dois lugares — por isso o
  texto não é enfeite e tem chave no catálogo, em pt e en.
- **Critério novo nasce desligado.** Um `notify` ligado, sem valor e sem tipos, poria todos os tipos
  em regime de lista de inclusão e calaria o painel inteiro até alguém preencher o valor.

## Gatilho de revisão

Qualquer um dos três: os interruptores do editor passarem de uma mão cheia (aí ele virou dois
componentes mal separados); uma terceira tela precisar de regras com um modelo que não seja campo,
operador e valor; ou a ordem da decisão de aviso precisar ser configurável — nesse caso, ela deixa
de ser uma frase no catálogo e vira estado, e este ADR é o ponto de partida da discussão.
