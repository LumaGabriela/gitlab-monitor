# 0003 — Sem `httpResource`, sem `@Service()`

**Data:** 2026-11-18 · **Situação:** aceita

## Contexto

A v22 estabilizou a Resource API (`resource`, `rxResource`, `httpResource`) e criou o decorator
`@Service()`. A recomendação atual é usar `httpResource` para dado assíncrono e `@Service()` no
lugar de `@Injectable({ providedIn: 'root' })`.

O `GitlabMonitorService` faz nem uma coisa nem outra: guarda um `signal<PanelSnapshotModel>` e o
alimenta com `firstValueFrom(this.http.get(...))` dentro de um laço.

## Decisão

Manter os dois como estão.

**`httpResource` não serve ao que este serviço faz.** Um `resource` modela *uma requisição que
segue um input*: o input muda, ele cancela a anterior e busca de novo. O que existe aqui é outra
coisa — um **polling** de dez em dez segundos sobre o mesmo endereço, com `sequence` para
descartar resposta fora de ordem, uma verificação manual que espera o ciclo do servidor terminar
(`REFRESH_TIMEOUT_MS`, `REFRESH_POLL_MS`), um estado anterior que precisa **continuar em pé**
enquanto a coleta seguinte falha, e um limiar (`COLLECTING_HINT_MS`) para não piscar o ícone a cada
volta. Um `httpResource` zera o `value` em cada recarga e não tem onde guardar a sequência; ele
seria envolvido em tanto código de contorno que sobraria menos do que já existe.

**`@Service()` é equivalente ao que já está escrito.** Segundo a Ninja Squad, é "basically the same
as `@Injectable({ providedIn: 'root' })`", com a diferença de exigir `inject()` — que aqui já é
obrigatório e tem lint (`prefer-inject`). Trocar 13 decorators não muda comportamento nem trava
erro nenhum.

## Consequência

- O estado de carregamento, erro e dado é escrito à mão: três signals em vez dos de um `Resource`.
  É mais código, e é código que precisa de teste próprio — tem.
- O projeto fica num dialeto um pouco mais antigo que o das recomendações da v22, e quem chegar
  esperando `httpResource` vai estranhar.
- Em troca, o comportamento que a ferramenta precisa ter (tabela anterior de pé durante a falha,
  resposta fora de ordem descartada) está explícito, e não apoiado no que a API faria por baixo.

## Gatilho de revisão

Uma consulta que seja de verdade *input → requisição* (uma busca, um detalhe por id) — aí
`httpResource` com `parse` é o caminho, e entra ao lado do polling, não no lugar dele. Para
`@Service()`: o `@Injectable` ser deprecado.
