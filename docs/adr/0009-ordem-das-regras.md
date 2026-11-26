# 0009 — A ordem das regras de destaque é prioridade editável, movida por setas

**Data:** 2026-11-26 · **Situação:** aceita

## Contexto

Quem pinta a linha da tabela é a **primeira** regra de destaque ligada que casa com os fatos dela
(`firstMatch`, em `core/rules/rule-engine.ts`). Isso sempre foi assim, mas não aparecia em lugar
nenhum: a lista de `/settings/highlights` parecia um conjunto de regras independentes, e a ordem
delas, um acidente de quando cada uma foi criada. Com duas regras que casam com o mesmo MR — "a
pipeline falhou" e "está parado há três dias" —, a tela não dizia qual vencia nem dava como trocar.
O único conserto era apagar uma regra e criá-la de novo depois da outra.

Dois caminhos existiam: esconder a precedência (sortear, somar cores, pintar pela mais específica)
ou mostrá-la. Esconder significaria mudar o motor, e o motor tem um gêmeo em `monitor_rules.py` que
decide para o terminal (ADR 0007): toda mudança de semântica é mudança em dois lugares e nos testes
dos dois.

## Decisão

**A ordem da lista é a prioridade, e a tela diz isso.** O motor não muda: `firstMatch` continua
sendo a primeira regra ligada que casa. O que muda é que a ordem passa a ser uma coisa que se edita,
com três partes:

- **Setas de subir e descer** em cada bloco do editor (`shared/monitor/rule-list/`, atrás do
  interruptor `ordered`, no padrão do ADR 0008: capacidade nova nasce no componente único, nunca
  numa cópia). Mover grava na hora (`RowRulesService.move`) e a posição nova é anunciada em voz alta.
- **O selo diz quantos MRs a regra casa que uma regra ligada acima já pinta** ("4 de 12 · 3
  cobertos"), e troca de texto quando todos estão cobertos: a regra está ligada e não pinta nada.
- **Regra nova continua nascendo no fim.** Nascer no topo faria uma regra recém-criada passar por
  cima, em silêncio, das que já funcionavam. Nascer no fim é previsível, e agora tem conserto.

**As setas, e não arrastar.** Um `cdkDropList` do CDK seria a resposta imediata, e foi recusada:

- Arrastar precisa de um teclado alternativo para ser acessível, então são **duas** implementações,
  não uma — e a de teclado é exatamente a das setas.
- O §4 do `CLAUDE.md` limita o CDK ao que for mesmo necessário, e aqui a lista tem punhado de itens,
  não dezenas: o custo de uma seta por clique é baixo.
- A seta tem nome acessível com a posição ("Mover a regra 2 para baixo"), no padrão de
  `settings.rule-enabled` e `settings.rule-remove`, que já interpolam `{{position}}`. Regra de
  destaque não tem nome próprio, e `describeRule` exige um `HighlightRule` com tom — o editor é
  compartilhado com as notificações e não pode depender disso.

**Mostrar todas as regras casadas é texto, e não ícone.** A linha destacada não desenha ícone
nenhum (os ícones por cor foram removidos junto com a preferência `showAllMarks`): o que diz que a
linha casou com mais de uma regra é o texto do leitor de tela, que lista todas, e a legenda, que
nomeia cada regra ligada. A cor e o traço continuam saindo da primeira regra — é ela que pinta.

Alternativas rejeitadas:

- **Pintar pela regra mais específica.** Exigiria uma medida de especificidade que nenhuma das duas
  superfícies tem, e tiraria da pessoa a escolha em vez de dá-la.
- **Somar os tons em um degradê.** Nenhuma das cores sobreviveria à soma, e o canal que não é cor (a
  borda de traço) não se soma de jeito nenhum.
- **Um campo numérico de prioridade por regra.** Guardaria um segundo estado que pode contradizer a
  ordem da lista, e obrigaria a renumerar à mão.

## Consequência

- **Mover uma regra muda a tabela imediatamente**, inclusive o que estava pintado. É o ponto: a
  jornada do painel afirma que descer a regra de pipeline faz a de parado pintar a mesma linha.
- **O selo de cobertas lê os MRs em tela**, então ele muda com o filtro e com a coleta. É
  conferência do que a comparação faz agora, não uma propriedade da regra.
- **Painel e terminal desenham um marcador só, cada um no seu alfabeto**: lá um caractere de borda,
  aqui a cor do fundo e o traço da borda esquerda. O motor não mudou — a paridade do ADR 0007 e o
  `check-rule-engine.test.mjs` seguem válidos sem toque.

## Gatilho de revisão

A lista de regras passar de um punhado de itens, a ponto de subir uma regra do fim ao topo custar
cliques demais (aí arrastar paga as duas implementações); ou alguém precisar que uma linha seja
pintada por mais de uma regra ao mesmo tempo — nesse caso a precedência deixa de ser ordem e vira
composição, e este ADR é o ponto de partida da discussão.
