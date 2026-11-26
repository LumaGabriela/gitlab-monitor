# 0007 — As regras de destaque e de aviso existem também em Python

**Data:** 2026-11-23 · **Situação:** aceita, com a duplicação guardada por um gate

## Contexto

O `CLAUDE.md` dizia: "Destaque de linha e notificação são decididos no painel, não no Python,
porque são preferências de quem olha". Era verdade enquanto o terminal era só uma tabela. Deixou
de ser quando o terminal ganhou o mesmo destaque de linha e as mesmas regras de aviso do painel
(`rowRules` e `notifyRules` em `user-data/preferences.json`): quem roda `make monitorar` espera ser
avisado pelo que configurou nas configurações, e quem roda `make report` espera ver a linha
destacada.

O motor do painel é TypeScript (`core/rules/rule-engine.ts`, `notify-rules.service.ts`). O terminal
é Python e só tem a biblioteca padrão. Alguém precisa decidir, em Python, se uma linha casa com uma
regra.

## Decisão

Portar o motor para `monitor_rules.py` e **provar por um gate que os dois decidem igual**. A regra
passa a ser: o painel decide para a página, o terminal decide para o terminal, e
`frontend/scripts/check-rule-engine.test.mjs` compara o que cada motor declara — campos, tipo de
cada campo, operadores por tipo, tons, tipos de evento de aviso e campos das regras de aviso. É a
mesma forma de `check-backend-constants` e `check-mock-contract`: cópia permitida, cópia sem guarda
não.

Duas alternativas foram consideradas e rejeitadas.

**Mover a decisão inteira para o Python.** `/data` devolveria os eventos já filtrados e o tom da
linha pronto, e o painel perderia o filtro local: um só dono para a regra. Rejeitada porque o
filtro do painel é instantâneo e local, e passá-lo ao servidor põe uma ida e volta em cada
alteração de regra; porque obrigaria a reescrever `NotifyRulesService`, `RowRulesService` e as
seções `/settings/highlights` e `/settings/notifications`; e porque contradiz o motivo escrito no
`CLAUDE.md` para a preferência ser de quem olha — o backend não deve conhecer a regra de cada
pessoa.

**Duplicar sem gate.** Mais rápido agora, divergente em silêncio depois: o painel destacaria uma
linha que o terminal não destaca, ou o terminal avisaria o que o painel filtrou, sem que nenhum
teste de nenhum dos dois falhasse. É o mesmo motivo pelo qual o mock ganhou
`check-mock-contract`.

## Consequência

- **Duas implementações para manter.** Operador novo, campo novo ou tipo de evento novo entra nos
  dois motores, e o gate reprova quem esquecer um deles.
- **O gate cobre o vocabulário, não a semântica.** Ele lê os dois arquivos como texto e compara o
  que declaram; não executa os dois motores sobre os mesmos casos. Mudar o que um operador faz, ou
  o horário de silêncio, sem mudar o outro lado passa pelo gate e só é pego pelos testes de cada
  lado — é a lacuna conhecida, parecida com a do ADR 0006.
- A leitura é por expressão regular sobre o código-fonte: reformatar a declaração (`RULE_TONES`,
  `NOTIFY_EVENT_KINDS`, `DEFAULT_NOTIFY_RULES`) de um jeito que a expressão não reconheça faz o
  gate falhar alto, nunca passar calado.
- O backend continua sem decidir nada na rota `/data`: ela segue entregando só os fatos de cada
  linha. A decisão em Python vive no terminal, não no servidor do painel.
- Os textos do terminal moram em `monitor_text.py`, separados do catálogo do painel. O modo
  `--mode web` mantém o log do terminal em inglês de propósito: o `text` dos eventos que o painel
  recebe não pode mudar de idioma.

## Gatilho de revisão

Qualquer um dos dois: o painel precisar de uma regra que o terminal não saiba expressar (um campo
ou operador que não faça sentido fora da página), ou o gate virar manutenção maior que o porte —
quando cada mudança no motor custar mais para manter os dois lados em dia do que custaria ter um
só dono. Na primeira, o certo é decidir se o terminal ignora a regra ou se ela não deve existir; na
segunda, reabrir a alternativa de mover a decisão para o Python.
