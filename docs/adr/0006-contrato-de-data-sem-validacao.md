# 0006 — `/data` entra sem validação em runtime

**Data:** 2026-11-18 · **Situação:** aceita, com risco conhecido

## Contexto

`this.get<PanelSnapshotModel>('panelData')` é uma **afirmação de tipo, não uma verificação**. Se o
Python mandar outra forma, o TypeScript não percebe: o erro aparece na tela, como `undefined` onde
deveria haver texto. O documento de boas práticas pede validação na borda (`httpResource` com
`parse`, ou `map(schema.parse)`), e este projeto não faz nenhuma das duas.

Vale notar o que **é** validado: as preferências (`storedTargets`, `parseInterval`,
`parseLikesHighlight`, `parseThemeChoice`) passam por função que recusa o que não serve. Elas vêm
de um arquivo que a pessoa pode editar à mão. A resposta de `/data`, não.

## Decisão

Não validar a resposta de `/data` em runtime, por enquanto.

O risco que a validação cobre é **o backend e o frontend discordarem**, e aqui os dois são o mesmo
repositório, versionados no mesmo commit, com três travas já no lugar:

- `check-mock-contract.test.mjs` compara as colunas, ordenações, filtros de revisão e a grafia do
  MR sem pipeline do mock com `REPORT_COLUMNS`, `SORTS`, `REVIEW_FILTERS` e `NO_PIPELINE` do Python;
- `check-backend-constants.test.mjs` trava as constantes copiadas (`MAX_TARGETS`,
  `DEFAULT_INTERVAL`);
- `cell-contract.spec.ts` trava o vocabulário de tom e ícone contra o Design System.

Zod ou um `parse` manual sobre um snapshot de ~15 campos aninhados custaria mais do que esse
conjunto, para cobrir uma discordância que o commit único já torna improvável.

## Consequência

- **É a lacuna conhecida do projeto.** Um campo renomeado no Python que escape aos três gates
  chega à tela como célula vazia, sem erro no console e sem estado de erro no painel.
- Os gates cobrem o *vocabulário* (quais colunas, quais filtros), não a *forma* (que `facts.likes`
  é número). Uma mudança de tipo passa.
- Em troca, não há schema para manter em dia a cada coluna nova — e coluna nova é uma linha no
  Python e nada no frontend (§1), que é a propriedade mais valiosa deste contrato.

## Gatilho de revisão

Qualquer um dos dois: o backend deixar de ser deste repositório (um monitor remoto, outra versão
no ar), ou a primeira vez que a tela quebrar por dado inesperado. Na segunda, o `parse` entra pela
borda do `GitlabMonitorService`, não espalhado pelos componentes.
