# Decisões de arquitetura

Aqui ficam as **decisões**, não as regras. A diferença importa:

- O [`CLAUDE.md`](../../CLAUDE.md) diz **o que fazer** e, na tabela do §4, **quem reprova** quem não
  fizer. É o que se lê antes de escrever código.
- Um ADR diz **por que** este projeto decidiu assim, **o que isso custa** e **quando vale reabrir**.
  É o que se lê antes de propor mudar a regra.

Sem os ADRs, toda divergência em relação ao padrão atual do Angular parece descuido, e a primeira
pessoa que abrir o repositório vai "consertar" uma escolha. Com eles, a discussão começa do ponto em
que parou.

Cada arquivo tem **gatilho de revisão**: a condição que torna a decisão velha. ADR sem gatilho vira
fóssil — ninguém o reabre porque ninguém sabe quando.

| ADR | Decisão | Gatilho de revisão |
| --- | --- | --- |
| [0001](0001-sufixos-de-arquivo.md) | Manter `.component.ts` / `Component` nos nomes | o `fpf-metrics-web` tirar os sufixos |
| [0002](0002-sem-signal-forms.md) | Controles próprios sobre `ControlBase`, sem Signal Forms | precisar de validação por schema ou de formulário com mais de um campo interdependente |
| [0003](0003-sem-apis-novas-da-v22.md) | Sem `httpResource`, sem `@Service()` | o polling deixar de ser polling, ou o `@Injectable` ser deprecado |
| [0004](0004-rotas-lazy.md) | `/settings` é lazy; o painel, não | o painel deixar de ser a tela de entrada |
| [0005](0005-idioma-dos-identificadores.md) | Identificadores em inglês, comentários e textos em pt-BR | nunca (é convenção, não técnica) |
| [0006](0006-contrato-de-data-sem-validacao.md) | `/data` entra sem validação em runtime | o backend deixar de ser deste repositório, ou a tela quebrar por dado inesperado |
