# Guia do `gitlab-monitor`

> 🔁 **Este é o guia operacional único deste repositório.** O [`AGENTS.md`](AGENTS.md) apenas aponta
> para cá. Ao alterar uma regra, altere **apenas aqui**; se o `AGENTS.md` voltar a ter conteúdo
> próprio, isso é um defeito a corrigir, não uma precedência a interpretar.

## 1. O que este repositório é

Ferramenta independente para acompanhar os Merge Requests de um projeto ou grupo do GitLab. Tem
Git próprio e **não faz parte** do `poc-sdd-backend` nem do `poc-sdd-frontend`. O
[`CLAUDE.md` da raiz `poc-sdd`](../CLAUDE.md) é um guia de coordenação pessoal e, pela regra de não
extensão dele, nada do que está lá vale aqui — nem o `Makefile` da raiz, nem a porta 5436, nem o
fluxo de cards.

Duas partes, um contrato entre elas:

- **`gitlab_monitor.py`** — Python 3.9+, só biblioteca padrão. Consulta o GitLab, monta a tabela e,
  no modo web, serve `/data`, `/projects`, `/settings`, `/refresh` e `/preferences` além dos estáticos do build Angular.
- **`frontend/`** — Angular 22 standalone, Tailwind v4 e o Design System FPF. Desenha o painel.

**Quebra registrada: o histórico `2` não é migrado.** O monitor acompanha vários alvos, e o snapshot
em disco passou a ser aninhado por alvo (`version: 3`). Com um alvo só, a fórmula da chave do arquivo
dá o **mesmo nome** de antes (`"\n".join(sorted([alvo]))` é o próprio alvo), então o arquivo antigo é
encontrado, **recusado** e mantido: o modo `monitorar` não inicia na primeira execução após a
atualização e diz, no terminal, para movê-lo para fora da pasta. É de propósito — adivinhar a que
alvo pertence cada MR de um formato plano é mais arriscado que recomeçar a referência —, e a
instrução não pode ser engolida pelo `except` de topo, que só sabe dizer "Could not start". A nota
de migração para quem usa está no `README.md`, em *Histórico e segurança*.

**O backend é o dono do que a tabela mostra.** Coluna, rótulo, tom semântico, tipo de célula e peso
de largura saem de `REPORT_COLUMNS` e `serialize_row`; o painel só desenha o que `/data` descreve.
Uma coluna nova é uma linha no Python e **nada** no frontend.

## 2. De onde vêm as regras de estilo

O padrão técnico e visual do frontend é o do
[`fpf-metrics-web`](https://gitlab.fpf.br) — o mesmo Design System FPF, a mesma arquitetura de
tokens, as mesmas convenções de componente. O que está escrito nas seções 4 a 8 é esse padrão
aplicado aqui.

**Adaptações conscientes**, porque o original não cabe neste projeto (as de cópia da casca, do
`IconButtonDirective` e do `PageToolsComponent` incluídas):

| Regra do `fpf-metrics-web` | Aqui | Por quê |
| --- | --- | --- |
| `BaseService` completo (paginação, upload, `AuthStorageService`) | `core/services/base.service.ts` enxuto: `get`, `post` e o catálogo de rotas | Este backend não tem autenticação, paginação nem arquivos; copiar os métodos seria trazer contrato que não existe. |
| Commits `<tipo>(#CARD): …` | `<tipo>: descrição` em português | Repositório pessoal, sem cards no Bit. Os tipos (`feat`, `fix`, `fix!`, `imp`) continuam os mesmos. |
| Chaves de tradução planas (`'skip-to-content'`, `'switch-to-light-mode'`) | Chaves nas namespaces do catálogo: `shell.*`, `nav.*`, `theme.*`, `language.*` | O catálogo daqui é todo aninhado (§6). Só a string da chave muda; o template não. |
| `ShellComponent` lê e grava o trilho no `localStorage` | `rail = signal(false)`, sem leitura nem gravação | Nada de `localStorage`/`sessionStorage` (gate de armazenamento); o sidebar sempre abre expandido. |
| `LanguageSelectorComponent` usa `SupportedLocale` (`'pt-BR' \| 'en-US'`) | Opções com `SupportedLanguage` (`'pt' \| 'en'`) do `LanguageService` daqui | O `LanguageService` não é visual e grava `language` no `preferences.json` com a lista fechada `pt`/`en`. |
| `PageToolsComponent` com `view` e `app-view-toggle` | Sem `view`; depois do tema vem o link da engrenagem para `/settings` | Não há gráfico aqui, e a engrenagem é a entrada das configurações. |
| `standalone: true` no decorator | Sem essa linha | É o padrão do Angular 22; nenhum componente daqui usa a linha. |
| `IconButtonDirective` com seletor `button[appIconButton]` | `button[appIconButton], a[appIconButton]` | A engrenagem do `app-page-tools` é um link; em `<a>`, `disabled` não se aplica. |
| `NavItem` e `app-nav-item` sem `exact` | Entrada `exact` (só fica ativa na própria rota) | Acréscimo daqui: um item que aponta para a raiz de uma seção não pode ficar ativo nas sub-rotas dela. Hoje nenhum item a usa — a raiz `/settings` redireciona —, e a entrada fica como capacidade do item. |
| `app-select` e `app-multi-select` sem busca | Os dois abrem com um campo de busca no painel (`option-filter.ts`) | A lista de alvos do GitLab tem dezenas de projetos, e rolar não é jeito de achar um. A regra é a mesma nos dois para a lista responder igual, e o termo some ao fechar: a escolha é que fica. |
| `SelectComponent` com `ControlValueAccessor` próprio e entradas `invalid` e `controlId` | Estende `ControlBase`: `value` é `model()` (com `valueChange`), e o estado inválido e o id vêm do `app-field` | Os outros controles daqui (`app-multi-select`, `app-text-input`) usam a mesma base, e as telas ligam o select por `[value]`/`(valueChange)`. Gatilho, lista e estilos são os de lá. |

Tudo o mais vale como lá. Se uma regra daqui divergir do `fpf-metrics-web` sem estar nesta tabela,
é defeito a corrigir — não precedência a interpretar.

### Onde ficam as decisões

A tabela acima diz **o que** diverge. O **porquê**, o que cada escolha custa e **quando vale
reabri-la** ficam em [`docs/adr/`](docs/adr/README.md), um arquivo por decisão. São elas:
sufixos de arquivo ([0001](docs/adr/0001-sufixos-de-arquivo.md)), controles próprios em vez de
Signal Forms ([0002](docs/adr/0002-sem-signal-forms.md)), ausência de `httpResource` e de
`@Service()` ([0003](docs/adr/0003-sem-apis-novas-da-v22.md)), o que é lazy e o que não é
([0004](docs/adr/0004-rotas-lazy.md)), o idioma dos identificadores
([0005](docs/adr/0005-idioma-dos-identificadores.md)) e o contrato de `/data` sem validação em
runtime ([0006](docs/adr/0006-contrato-de-data-sem-validacao.md)).

A separação é de propósito: este arquivo é o que se lê **antes de escrever código**; um ADR é o que
se lê **antes de propor mudar a regra**. Sem eles, toda divergência em relação ao Angular atual
parece descuido, e a primeira pessoa que abrir o repositório "conserta" uma escolha.

## 3. Estrutura

```text
gitlab-monitor/
├── gitlab_monitor.py          # o monitor inteiro: coleta, tabela, notificação e servidor web
├── tests/                     # unittest, sem rede
├── Makefile                   # atalhos; `make help` lista tudo
├── user-data/                 # preferences.json do painel; criado no primeiro ajuste, ignorado pelo git
├── .pre-commit-config.yaml    # ganchos de commit e de push
└── frontend/
    ├── src/styles/            # _themes, _tailwind-theme, _breakpoints, _mixins
    │   └── components/        # as classes .ui-*, uma folha por família
    ├── src/assets/i18n/       # pt.json e en.json
    ├── src/testing/           # apoio de teste (catálogo de tradução sem HTTP)
    ├── src/app/
    │   ├── app-navigation.ts  # APP_NAV_SECTIONS: Painel e Configurações no sidebar da casca
    │   ├── core/              # api/ (catálogo de rotas), models/api/, rules/, services/
    │   ├── shared/layout/     # casca (app-shell, sidebar, gaveta), cabeçalho de página e ferramentas
    │   ├── shared/ui/         # primitivos sem domínio
    │   ├── shared/monitor/    # componentes do domínio, só input()/output()
    │   └── features/
    │       ├── monitor/pages/monitor/        # a tela da tabela
    │       └── settings/                     # pages/settings/ e sections/ (a página /settings)
    ├── mock/                  # monitor de mentira para as jornadas (vocabulário em monitor-contract.mjs)
    ├── scripts/               # gates e testes de node
    └── e2e/                   # jornadas Playwright, em 1280 e 375 px
```

Dependência em um sentido só: `features → shared → core`. Nunca importe de `features/**` dentro de
`core/**` ou de `shared/**`, nem de `shared/**` dentro de `core/**`.

**Quem impõe isso é o `no-restricted-imports` do `eslint.config.js`, não a revisão.** Até a regra
existir, dois imports já tinham entrado na contramão: o contrato de `/data` dependia do `BadgeTone`
e do `IconName` do Design System, e dois serviços de `core/` buscavam o motor de regras em
`shared/`. Daí as duas consequências que valem como regra:

- **O contrato da API declara o vocabulário dele.** `CellTone` e `CellIconName` moram em
  `core/models/api/panel-api.model.ts` e repetem, de propósito, a lista do `BadgeTone` e os ícones
  que o `serialize_row` manda. Repetir é mais barato que inverter a camada, e a cópia não escapa:
  `shared/monitor/cell-contract.spec.ts` só compila enquanto as duas listas couberem uma na outra.
- **Módulo puro que `core/` consome mora em `core/`.** O motor de regras (`core/rules/rule-engine.ts`)
  é função pura sobre `RowFactsModel`, sem nada de Angular nem do Design System; quem traduz a regra
  em texto (`shared/monitor/rules/rule-description.ts`) é que é camada de cima.

### Componentes

`shared/ui/` traz os primitivos do DS, portados do `fpf-metrics-web` com a mesma API: `app-alert`,
`app-badge`, `appButton`, `app-card`, `app-checkbox`, `app-data-table` (com `appCellDef` e
`TableColumn`), `app-disclosure`, `app-empty-state`, `app-error-state`, `app-external-link`,
`app-field`, `app-icon`, `appIconButton`, `app-language-selector`, `app-modal`, `app-multi-select`,
`app-select`, `app-skeleton`, `app-stacked-list`, `app-text-input`, `app-theme-toggle`, e o
`FocusTrap` de `ui/overlay/`. O `app-file-picker` é próprio deste projeto. O `app-modal` continua no DS, mas **nenhuma tela o usa**: as
configurações deixaram de ser modal. `shared/layout/` tem o `app-shell` (sidebar fixo a partir de `md`, que recolhe a trilho de ícones sem
guardar a escolha; abaixo de `md`, barra superior e gaveta), o `app-sidebar`, o `app-nav-item`, o
`app-drawer`, o `app-page-header` e o `app-page-tools`. A casca renderiza o único `<main id="conteudo">`
e o link "Pular para o conteúdo"; o `AppComponent` a monta com `APP_NAV_SECTIONS`
(`app-navigation.ts`, na raiz de `app/` porque importa de `features/`). O `--layout-content-max`
segue o `fpf-metrics-web` (1280px). `shared/pipes/` tem o `appCapitalize`.

**Todo select abre com busca.** `app-select` (uma escolha) e `app-multi-select` (várias) trazem um
campo de busca no topo do painel, que é quem recebe o foco ao abrir; no `app-select` a seta para
baixo passa o foco para a lista. A regra do filtro é uma só, em `shared/ui/select/option-filter.ts`:
sem acento, sem caixa e em qualquer parte do rótulo — os alvos são caminhos `grupo/projeto`, e
exigir o começo obrigaria a digitar o grupo inteiro. Filtrar não desmarca nada, o termo some ao
fechar (a escolha é que fica) e, sem resultado, o painel diz que não achou em vez de ficar vazio.
Com a busca em uso o `placeholder` sai da lista: ele não é uma opção procurável.

**Toda tabela é o `app-data-table`.** Ele cuida de legenda, `scope`, região rolável focável,
primeira coluna fixa, ordenação pelo cabeçalho e dos estados vazio, carregando e erro; a coluna diz
o cabeçalho, a largura e o alinhamento, e `<ng-template appCellDef="chave">` desenha a célula.

A ordenação do painel é `external`: quem ordena é o backend, pela consulta. Cada item de `SORTS`
diz a coluna e o **sentido natural** que ordena, e é por isso que a seta aparece no cabeçalho certo
e o clique no cabeçalho escolhe a ordenação correspondente — o select "Ordenar por" e o cabeçalho
são o mesmo estado.

**Clicar de novo no mesmo cabeçalho inverte o sentido**, e a consulta leva `direction` (`asc` ou
`desc`; qualquer outro valor é o natural). As colunas continuam `sortLocked`, mas por outro motivo
que não o antigo: o ciclo do Design System tem um terceiro passo — natural, invertida, **sem
ordenação** — que aqui não existe, porque a lista do backend está sempre ordenada por algo. Quem
decide o que um clique pede é o `app-mr-table`: mesma coluna inverte, outra coluna recomeça no
natural dela. Por isso o rótulo de cada `Sort` nomeia a **coluna** ("Likes", "Autor"), e não um
sentido ("Mais likes") que mentiria metade do tempo.

O sentido é preferência de quem olha: vai na chave `filters` do arquivo, ao lado da ordenação, e
`null` ali quer dizer "o natural". Ele entra também no preset, como parte da opinião sobre `sort` —
inverter à mão desfaz o preset tanto quanto trocar de coluna.

As chaves de ordenação são em inglês e saem de `SORTS`: `recent` (o padrão), `updated`, `likes`,
`mr`, `author`, `threads`, `participants` e `pipeline`. O painel as guarda na chave
`filters` de `user-data/preferences.json`, junto com o sentido, e as manda em `sort` e `direction`; uma chave guardada que o backend não oferece mais cai
na primeira da lista. O texto do select é `sorts.<chave>` no catálogo, com o rótulo do backend como
reserva.

**O mock das jornadas é uma segunda cópia desse contrato, e tem guarda.** Colunas, ordenações,
filtros de revisão e a grafia do MR sem pipeline moram em `frontend/mock/monitor-contract.mjs`, e
`frontend/scripts/check-mock-contract.test.mjs` (em `make front-scripts`) os compara com
`REPORT_COLUMNS`, `SORTS`, `REVIEW_FILTERS` e `NO_PIPELINE` do Python. Sem o gate, um mock atrasado
não quebra nada: a jornada só deixa de cobrir, em silêncio, o que parece cobrir.

O `app-data-table` é o do fpf-metrics-web, com os mesmos estilos e os mesmos tokens — moldura
arredondada, cabeçalho em `--color-bg-subtle`, primeira coluna fixa ao rolar e, abaixo de `md`, cada
linha virando um cartão com o nome da coluna antes do valor. Quatro diferenças, e só elas: não tem
`rowLink` (não há tela de detalhe de um MR; o router existe só para `/settings`), tem `width` e
`minWidth` por coluna, porque aqui a largura sai dos pesos que o backend informa, e tem `rowTone`,
uma função que
devolve o tom da linha — ela ganha a classe `ui-table__row--tone-<tom>` da primeira regra de
destaque que casa. E `rowMatch`, outra função, que devolve o texto de por que a linha foi destacada.

**A tabela é `table-layout: auto`, e isso é decisão, não descuido**: é o único modo em que cada
coluna fica do tamanho exato do que ela contém, e em que um selo maior que a coluna não transborda
por cima da vizinha — a célula não recorta. O preço é que ali a porcentagem do `<colgroup>` vira
sugestão e a coluna de texto longo (MR) é espremida ao mínimo do conteúdo; quem devolve o espaço
prometido pelo peso é o `minWidth`, calculado do mesmo peso em múltiplos de `--spacing-1`
(`MIN_WIDTH_PER_WEIGHT` no `app-mr-table`). Nas colunas estreitas o piso fica abaixo do que o
conteúdo já pede e não muda nada; no modo cartão ele é zerado, senão criaria rolagem lateral.

**O destaque de linha não depende só de cor.** A primeira célula ganha um marcador de borda de traço
próprio por tom (`solid`, `dashed`, `double`, `dotted`), um ícone por tom (`error`, `clock`,
`check`, `likes`) e o texto da regra para leitor de tela; a legenda repete ícone e texto por regra
ligada. A largura do marcador é um múltiplo de `--row-mark-unit`, que **fica fora da escala de
densidade de propósito**: compactar não pode afinar o único canal que não é cor. O recuo da célula
desconta a borda, para o texto não deslizar entre a linha destacada e a comum. O `app-mr-table` só
traduz o que `/data` descreve para essa linguagem.

**O `app-card` é o contêiner de todas as telas.** O que uma tela mostra vai dentro de um card — o
painel inteiro numa, cada seção das configurações na sua. Tela nenhuma desenha caixa própria:
respiro, borda, raio e superfície saem do card, e a classe da tela (`.ui-monitor-panel`,
`.ui-settings-section`) só arruma o conteúdo dentro dele. A seção das configurações já tinha
redesenhado a caixa uma vez, com outro raio, e foi assim que as configurações passaram a ter
cantos diferentes dos do painel.

**Filtros, legenda e tabela moram num card só** (`.ui-monitor-panel`, dentro de um `app-card` sem
padding), como os painéis do fpf-metrics-web: o conteúdo é um bloco de leitura, não três caixas
soltas. Por isso nem a `app-monitor-toolbar` nem o `app-mr-table` trazem card próprio — quem monta o
painel é a tela.

**O cabeçalho da tela é o `app-page-header`**: título (o único `h1`), contador ao lado, a meta da
consulta em `[header-meta]` e, em `[actions]`, o `app-page-tools` — hoje com **idioma**, **tema** e
**configurações**, nessa ordem. Ferramenta nova entra ali.

A meta da consulta é a `.ui-status-line`, com os modificadores `--ok`, `--loading` e `--error`:
ícone, a lista de alvos, o texto do estado quando não é `ok` e a hora da última coleta. **Cada alvo
é um elemento seu** (`.ui-status-line__item`), e não uma string com vírgulas: é o que dá o espaço
entre dois nomes longos e o que deixa a lista empilhar. A hora fica sempre na ponta direita
(`margin-left: auto`), e onde o cabeçalho empilha (`container-down(sm)`) a faixa deixa de abraçar o
conteúdo e toma a largura da página, com um alvo por linha. `loading` aparece em
qualquer coleta, não só na primeira: a do ciclo de dez segundos e a verificação manual. A do
ciclo só conta depois de meio segundo no ar (`COLLECTING_HINT_MS`), porque a volta normal responde
antes disso e piscaria o ícone a cada volta; a manual conta na hora, porque a espera foi pedida por
quem clicou. A faixa usa `--color-surface-default` e borda, e não
`--color-bg-subtle`: este **é** o fundo da página (`styles.scss`) nos dois temas, e a faixa
desapareceria nele.

**A região viva da faixa cobre só o alvo e o estado** (`.ui-status-line__state`), nunca a hora da
última coleta: o tempo relativo muda de minuto em minuto sozinho e seria reanunciado para sempre; a
data e a hora inteiras seguem no `title`. **O detalhe da falha é dito pelo aviso**, um `app-alert`
que fica **sempre no DOM** — uma região viva só anuncia o que muda dentro dela, então criá-la junto
com o texto não anunciaria nada. Sem aviso, o conteúdo é vazio e `.ui-monitor-alert--quiet` tira a
caixa do desenho sem tirá-la da árvore de acessibilidade. Por isso o texto de `status-error` aponta
para o aviso em vez de chamar de falha de coleta todo aviso — inclusive os de salvamento e de
verificação manual demorada.

**Um ciclo em que só alguns alvos falharam não é "ok".** `scan` devolve também os alvos que não
responderam, o laço do `refresh` os carimba no estado e `/data` os manda em `meta.failed` (em
rótulo). O painel vira isso em `monitor.partial-failure`, com os alvos interpolados, pelo mesmo
caminho do erro de coleta: a faixa sai do verde e o aviso diz de quais alvos as linhas estão
faltando. Sem isso, a tabela encolheria em silêncio — pior que o caso de um alvo só, em que a falha
é exceção e a tabela anterior fica de pé. Com a tela quieta, só o terminal saberia.

**As configurações são uma página, não um modal.** A engrenagem do `app-page-tools` é um link para
`/settings` (`app.routes.ts`; `provideRouter` em `app.config.ts`; `<router-outlet>` dentro do
`app-shell`, no `app.component.ts`). Ordem de colunas e duas listas de regras pedem mais espaço do que um modal dá,
e uma página tem endereço próprio e rolagem própria. `/settings` é uma **casca**
(`features/settings/pages/settings/settings.page.ts`: cabeçalho com o `app-page-tools` e
`<router-outlet>`; **não tem menu lateral próprio**: a navegação entre as seções é a do sidebar da
casca da aplicação, em `APP_NAV_SECTIONS`) com **uma rota filha por seção**, todas em `features/settings/sections/` e cada
uma resolvendo o próprio estado por `inject()`: `query` (alvos monitorados e intervalo, e a primeira
da navegação: **a raiz `/settings` não tem tela própria e redireciona para ela**), `notifications`, `display` (tamanho do
texto, densidade e limite de likes), `columns` (visibilidade e ordem), `highlights` (regras de destaque de
linha), `presets` (pacotes nomeados; ver abaixo) e `data` (onde mora o arquivo de preferências,
exportar e importar; é a última da navegação). O `bootstrap.start()` fica na casca, não nas
filhas: trocar de seção não reinicia o monitor. Ao trocar de seção, o foco vai para o elemento
marcado com `data-focus-target` — o `h2` da seção aberta (`tabindex="-1"`),
e não o primeiro título do DOM; a seção aberta é a que leva `aria-current="page"` no `app-nav-item` do sidebar (classe
`ui-nav-item--active`; não há mais `is-active`).
**Cada seção se apresenta em uma frase.** Logo abaixo do `h2` vem a descrição da seção
(`settings.<seção>-summary`, a mesma chave de `SETTINGS_SECTIONS`): o que aquela tela define e como a
ferramenta se comporta com o que é ajustado ali. Era o texto do índice da visão geral; sem o índice,
ele passou para a própria seção, onde a pessoa está quando precisa dele.
**Campo de formulário tem uma medida só, nas duas telas.** Select e campo de texto partem de
`--size-field-base` (11rem) e não crescem, numa linha de campos que quebra: é assim na barra de
filtros do painel (`.ui-toolbar__field`) e nas seções das configurações (`.ui-settings__fields`, a
linha de regra de `highlights` e o nome do preset). Um campo por linha só abaixo de `md` **no
contêiner**, e não em `lg`: ali a conta ficava no fio — um card de 1015px empilhava e o de 1030px
não, e a mesma linha mudava de desenho entre duas telas do mesmo painel. O que não é campo (aviso,
estado vazio) ocupa a linha inteira.
**Campo de número só aceita dígito.** `app-text-input` tem `numeric`: pede o teclado numérico no
celular (`inputmode="numeric"`), declara `pattern="[0-9]*"` e **recusa na digitação e na colagem**
tudo que não for dígito, devolvendo ao campo só o que foi aceito e mantendo o cursor onde estava —
sem isso o caractere recusado ficaria na tela, porque o valor do signal não mudou e o Angular não
repinta. Usam-no o intervalo (`query`), os likes mínimos e a espera (`notifications`), o limite de
likes (`display`) e o valor da regra quando o campo é numérico (`highlights`). **Não é
`type="number"` de propósito**: ali o navegador aceita `e`, `+` e `-`, devolve string vazia quando o
que está escrito não é número — a tela perderia o que a pessoa vê — e desenha setas fora da escala
de densidade. Quem lê o valor continua validando (`toCount`, `parseInt`), porque o arquivo de
preferências pode trazer outra coisa.
**Os dois campos da `query` são o mesmo componente na mesma linha** (`app-field` dentro de
`.ui-settings__fields`): mesma largura e mesmo topo. Largura própria por campo deixava os blocos de
tamanhos diferentes.
**A linha de campos é uma grade com `subgrid`, e não flex**: cada `app-field` ocupa as três faixas
da linha (rótulo, controle e ajuda), então o controle de um campo fica na altura do controle do
vizinho mesmo quando um rótulo ocupa duas linhas e o outro, uma — é o caso de "Espera mínima entre
avisos do mesmo MR (min)", em `notifications`. Alinhar pelo topo deixava os controles em alturas
diferentes; alinhar pelo fim fazia a ajuda de um empurrar o controle do outro. A subgrade declara o
próprio `gap`, senão herdaria o respiro entre campos dentro do campo.

**Sobre o arquivo de preferências, o Python é a autoridade.** A chave `monitoredProjects` tem dois
leitores — `preferred_targets` no backend e o `GitlabMonitorService` no painel — e os dois validam
igual: **tudo-ou-nada**. Item que não é texto, item vazio ou lista acima de `MAX_TARGETS` derrubam a
preferência inteira, nos dois lados. Filtrar item a item no painel mostraria caixas marcadas para
alvos que o monitor não consulta. O teto e o intervalo padrão são cópias das constantes do Python,
com gate em `frontend/scripts/check-backend-constants.test.mjs`.

Na `query`, os alvos são escolhidos por caixas de seleção (`app-multi-select`) alimentadas por
`GET /projects`, e a escolha persiste no arquivo de preferências (chave `monitoredProjects`), junto com o
intervalo (`interval`); o `.env` não é alterado. **Quem manda na marcação é o backend**: a cada
resposta de `/data` o serviço reconcilia a escolha com `meta.targets`, a forma canônica dos alvos. A
preferência só semeia a primeira pintura — em modo web o posicional da linha de comando vence o
arquivo, e sem a reconciliação as caixas mostrariam a lista guardada como se fosse a monitorada, até
o primeiro Salvar impô-la. `meta.projects` continua sendo o **rótulo** (o `unquote` do alvo), e não
volta a ser alvo. A tela da tabela distingue "nenhum alvo escolhido" de
"nenhum MR aberto" por `meta.projects` vazio: no primeiro caso mostra um estado vazio com link para
`/settings/query`. Os `id` dos `<section>` seguem em português (`consulta`, `notificacoes`, `exibicao`,
`colunas`, `destaques`, `predefinicoes`, `dados`) **de propósito**: os e2e dependem deles;
não os "conserte" para inglês. Cada seção é uma rota, então **trocar de seção descarta rascunho não
salvo** (os alvos marcados em `query`, por exemplo): é o comportamento de um formulário por página,
aceito em vez de guardar rascunho num serviço root. Tema e idioma **não** estão na página: ficam no
cabeçalho, no `app-page-tools`. **Só o que vai ao backend tem Salvar explícito** — os alvos e o
intervalo, porque trocar o alvo recomeça a referência. Preferência local salva sozinha, sem botão; a
confirmação em voz alta existe em `highlights` (o `role="status"` "Alteração salva.", reanunciado a
cada alteração e apagado depois de alguns segundos) e no anúncio de posição de `columns` ao
reordenar. As demais seções não anunciam o salvamento.

Como o painel é um único `index.html`, o Python devolve esse arquivo para qualquer caminho **sem
extensão** (`page_fallback`), senão recarregar `/settings` daria 404. Caminho com extensão
(`/assets/i18n/xx.json`) que não existe continua 404.

O preparo comum às páginas — event sink, notificações, `monitor.start()` e o registro das colunas —
mora em `core/services/monitor-bootstrap.service.ts`; a página só chama `bootstrap.start()`. É ele
também que injeta `ThemeService`, `TextSizeService` e `DensityService`: um serviço root só é criado na primeira
injeção, e sem isso quem abre o painel direto nunca teria a classe da preferência guardada aplicada.
Assim a página de configurações abre direto, com o monitor já de pé, sem duplicar nada da tela da
tabela.

**Tudo que é ajuste do painel vive nas configurações**, inclusive quais colunas aparecem e em que
ordem. As preferências ficam num arquivo só, `user-data/preferences.json`, uma chave por preferência, e cada
uma tem um dono só no painel. Valor inválido no arquivo cai no padrão em vez de derrubar a tela. O
backend valida apenas a casca (objeto raiz, `version`, chaves conhecidas, tamanho); o conteúdo de cada
chave é validado por quem a usa, no painel. As quatro chaves de primeira pintura são a exceção, ver abaixo.

| Preferência (chave no arquivo) | Onde mora | Como se aplica |
| --- | --- | --- |
| **Onde as preferências moram** | `PreferencesStore` → `user-data/preferences.json`, via `/preferences` | cada serviço abaixo lê e grava a própria chave no store; ninguém toca em armazenamento do navegador |
| Tema (`theme`) | `ThemeService` | classe `.dark` no `<html>`; `_themes.scss` troca os valores |
| Tamanho do texto (`textSize`) | `TextSizeService` | classe `.text-size-*`; `_themes.scss` redefine a escala inteira |
| Densidade (`density`) | `DensityService` | classe `.density-compact`; `_themes.scss` redefine `--spacing-*` (`comfortable` ou `compact`). O padrão é confortável: compactar é opt-in |
| Idioma (`language`) | `LanguageService` | `translate.use()`; o catálogo decide o texto |
| Colunas ocultas (`hiddenColumns`) | `ColumnVisibilityService` | a coluna não é renderizada, em vez de escondida por CSS |
| Ordem das colunas (`columnOrder`) | `ColumnOrderService` | reordena as colunas que `/data` descreve; coluna nova do backend entra no fim e chave que o backend não informa mais é descartada |
| Alvos monitorados (`monitoredProjects`) | `GitlabMonitorService` | vão ao backend por `POST /settings` (`saveSettings`) e só são gravados como preferência depois que ele aceita; quem lê a lista de volta é a meta de `/data` (`meta.targets`, canônica; `meta.projects` é o rótulo) |
| Intervalo entre coletas (`interval`) | `GitlabMonitorService` | vai ao backend junto com os alvos; vale o valor que o backend ecoa, e não o digitado. O painel **grava** a chave, mas não a lê: quem mostra o intervalo em vigor é `meta.interval`, e um signal guardado em paralelo seria estado morto |
| Filtros e ordenação (`filters`) | `GitlabMonitorService` | vão na consulta (`sort`, `direction`, `author`, `pipeline`, `review`); o backend filtra e ordena |
| Destaque de likes (`likesHighlight`) | `GitlabMonitorService` | vai na consulta como os filtros; **quem decide o tom é o backend** |
| Regras de destaque de linha (`rowRules`) | `RowRulesService` + `core/rules/rule-engine.ts` | o motor puro avalia cada linha; a primeira regra que casa vira o `rowTone` da tabela |
| Regras de notificação (`notifyRules`) | `NotifyRulesService` | filtra os eventos antes de virarem aviso (tipo, só os meus, likes mínimos, rascunhos, autores silenciados, horário de silêncio, espera por MR); ver abaixo |
| Presets (`presets`) | `PresetsService` | pacotes nomeados das preferências acima; ver abaixo |

**A densidade escala `--spacing-*`, e isso é deliberado também para a geometria de layout**: largura
de coluna, de modal e de esqueleto saem de múltiplos dessa escala e encolhem junto. Ficam fixos o
marcador de linha e o ponto de status (`--row-mark-unit`) e o alvo de toque (`--size-touch-min`):
são os canais que não podem encolher, porque não são cor nem espaço.

**Preset é um pacote nomeado de preferências de quem olha**: filtros (ordenação com o seu sentido,
autor, pipeline, revisão), ordem das colunas, colunas ocultas, regras de destaque de linha e regras de notificação.
**Alvos e intervalo não entram**, porque trocar o alvo recomeça a referência do backend. Há três
prontos, que vivem no código e não no arquivo (`need-review`, `my-stuck`, `ready-to-merge`;
só opinam sobre filtros e destaques, para um clique não apagar ordem de colunas nem regras de
aviso), e os da pessoa, guardados na chave `presets`. Aplica-se pelo seletor da barra de
filtros ou em `/settings/presets`, onde também se salva o estado atual, renomeia e apaga. O seletor
mostra o preset cujo conteúdo é exatamente o estado atual, e deixa de mostrá-lo quando a pessoa o
desfaz à mão.

**Aplicar escreve em cinco serviços, cada um dono da sua preferência, e a regra é uma só por parte:
o que não vale mantém o valor atual**, em vez de voltar ao padrão. Não vale ordenação que o backend
não oferece, parte de tipo inesperado e lista que tinha itens e ficou vazia depois de podada (regra
de campo desconhecido, coluna que sumiu, valor de revisão extinto). **Só uma lista guardada como
`[]` limpa** a preferência. Ordem e ocultas pedidas antes de as colunas existirem esperam a primeira
resposta de `/data`.

**O destaque de likes** é a exceção que confirma a regra da seção 1: a preferência é de quem olha, mas o
tom da célula continua saindo do `serialize_row`, que recebe o limite por parâmetro. Zero desliga o
destaque, e é o padrão — o que conta como "muitos likes" muda de time para time.

**A regra de destaque se explica enquanto é escrita.** O bloco de cada regra em
`/settings/highlights` repete a borda que a linha vai ter na tabela (o mesmo `$row-marks`: traço,
espessura e cor por tom), e o selo ao lado do ligar/desligar diz **quantos dos MRs em tela a regra
casa agora** — é o que separa a regra que destaca o que importa da que não casa com nada ou pinta a
tabela inteira. A comparação só oferece o que o tipo do campo sabe comparar (`operatorsFor`): "maior
ou igual" a um autor nunca casaria, e oferecê-lo seria oferecer regra morta. Trocar de campo mantém
o operador quando o tipo novo o aceita e recomeça o valor, porque o anterior comparava outra coisa.
O campo Valor muda de controle com o tipo: sim/não no booleano e, no texto, **a lista do que o
GitLab devolveu agora** — os pipelines, os autores e os estados de revisão das linhas em tela, mais
o valor guardado, que entra mesmo sem casar com nenhuma. Sem linha coletada não há o que sugerir, e
aí ele volta a ser texto livre. Campo numérico é o `app-text-input` em `numeric` — só dígitos —, com a faixa observada na ajuda.

**Destaque de linha e notificação são decididos no painel, não no Python**, porque são preferências
de quem olha: o backend continua dono de coluna, rótulo, tom de célula e peso, e não deve conhecer a
regra de cada pessoa. Para o painel decidir sem reimplementar regra de negócio, `/data` manda
`facts` em cada linha (`likes`, `unresolved`, `participants`, `mergeable`, `conflicts`, `pipeline`,
`author`, `mine` (eu reagi com 👍), `involved` (sou a autora, participei ou curti — é o que o filtro
"só o que é meu" e a regra "Meu ou em que participo" usam), `assignedToMe`, `reviewingMine`,
`myReviewState` (o enum do GitLab em minúsculas, vazio se não sou revisora), `assignees` e
`reviewers` (quantidades), `draft`, `ageHours`, `idleHours`) e eventos estruturados: `kind`
(`opened`, `likes`, `pipeline`, `threads`, `left` ou `review`) mais `text`, `mr`, `title`, `author`,
`url`, `likes`, `mine`, `involved` e `draft`. O `text` do evento continua sendo a mesma string de
três linhas que o terminal imprime.

**O contrato de `/data` em inglês e com `review`.** Além de `sort`, `direction`, `author`, `pipeline` e `likes`,
aceita `review`, **multivalorado com semântica OU**: `assigned` (sou assignee), `reviewing` (sou
revisora) e `unassigned` (sem assignee nem revisor). A linha passa se satisfizer qualquer um dos
valores; valor desconhecido é ignorado, e lista vazia, ou só de desconhecidos, não filtra. O filtro
de pipeline usa `NO_PIPELINE = "no-pipeline"` para o MR sem pipeline. A coluna `review` de
`REPORT_COLUMNS` mostra assignees e revisores; o terminal os junta com ` · `, e o painel recebe a
mesma lista crua em `names` e põe **uma pessoa por linha** (tipo de célula `people`, desenhado com o
`app-stacked-list` na variante `value`) — lado a lado, os nomes viram um texto corrido sem começo
nem fim visível. Por não ser mais um selo, o tom do **meu** estado de revisão (`unreviewed`,
`requested_changes`, `approved`, `reviewed`) continua vindo no `tone` da célula mas **não é
desenhado**; o evento `review` avisa que a revisão foi pedida a mim
(`REVIEW REQUESTED FROM YOU`) ou retirada (`NO LONGER ASSIGNED TO YOU FOR REVIEW`), e não dispara
quando o snapshot anterior não conhecia o campo.

**A espera entre avisos do mesmo MR só começa depois que o aviso foi entregue.** O bootstrap chama
`markNotified` apenas quando `announce` devolve `true`; um evento que não foi entregue (permissão
pendente, por exemplo) volta na consulta seguinte em vez de sumir e ainda gastar a espera.

**O `PreferencesStore`** (`core/services/preferences-store.service.ts`) é o único ponto de contato com
o arquivo. O app initializer o carrega **antes** de restaurar o idioma, para os serviços já nascerem
com o documento. As gravações são agrupadas por microtask e serializadas. Se a carga inicial **falha**,
as mudanças ficam só na memória: nada é enviado, de modo que o arquivo existente nunca é sobrescrito
pelos padrões, e o aviso `preferences.save-failed` já aparece desde o início; uma gravação recusada
mostra o mesmo aviso. O aviso é uma região viva persistente em `app.component.ts`.

**`GET /preferences`** devolve `{version, preferences, file}`. **`POST /preferences`** responde 415 sem
`Content-Type` JSON e 403 quando o `Origin` difere do `Host` (requisição sem `Origin` é aceita), responde 413 acima de 262144 bytes (`PREFERENCES_MAX_BYTES`), 400 para
documento inválido e 500 com `{"error"}` se a gravação em disco falhar. Chave desconhecida é descartada.
A gravação é atômica e serializada por um lock. Arquivo ilegível (JSON quebrado ou não UTF-8) ou com
`version` diferente de 1 **não é sobrescrito**: é renomeado para
`preferences.corrupt-AAAAMMDD-HHMMSS.json` (com `-1`, `-2` se o nome existir), o terminal registra o
nome novo e o painel abre com o padrão. O mesmo vale para JSON aninhado demais e para `NaN`/`Infinity`; o `POST` rejeita esses dois com 400, e o 413 fecha a conexão (descarta até 1 MiB do corpo antes). Arquivo de `version` desconhecida tem JSON válido: recuperar é abri-lo na versão que o gerou, ou trocar `version` para `1` à mão, por conta e risco.

**Primeira pintura.** Ao servir o `index.html`, o Python escreve `lang`, `data-theme-choice`,
`data-language`, `data-text-size` e `data-density` no `<html>`, a partir do arquivo, e o script inline
de `frontend/src/index.html` aplica as classes antes de qualquer pintura. Por escreverem em HTML, essas
quatro chaves só aceitam valor de uma lista fechada (`FIRST_PAINT_CHOICES`); outro valor some do
documento. No `ng serve` (`make dev`, `make front-mock`) o Python não serve a página, então os atributos
não existem: a página começa no automático e corrige quando o store carrega. O piscar ali é aceito.

**A seção `data`** (`/settings/data`, `<section id="dados">`, a última da navegação) mostra onde o
arquivo está e tem **Exportar** (baixa `gitlab-monitor-preferences-AAAA-MM-DD.json`, com
`app: "gitlab-monitor"`; desabilitado, com aviso, quando a leitura inicial falhou, para não exportar padrões como se fossem backup) e **Importar** (confirmação, substituição de tudo, recarga da página). Importar
também aceita o `user-data/preferences.json` cru; os erros são `too-large`, `not-json`,
`not-gitlab-monitor`, `unsupported-version` e `no-preferences`. Se o replace falhar, mostra erro e não
recarrega.

**Nada de armazenamento do navegador.** `frontend/scripts/check-no-browser-storage.test.mjs`, em
`make front-scripts`, reprova qualquer `localStorage` ou `sessionStorage` nos arquivos `.ts`, `.html` e `.mjs` de
`frontend/src` e `frontend/e2e`. Não há migração das chaves antigas: o que estava no navegador não é lido.

Componente que faltar nasce em `shared/`, genérico, com teste que falha antes e estilo `.ui-*` só
com tokens. **Nunca reimplemente um que já existe** — o gate `make front-styles` cobre os controles,
mas o resto é revisão.

## 4. Código do frontend

### Quem verifica cada regra

Regra escrita que nenhuma ferramenta verifica depende de revisão, e revisão deixa passar — foi
assim que o import invertido de `core/` para `shared/` entrou e ficou. Por isso cada regra desta
seção tem um dono declarado, e o que a tabela mostra de mais útil é a **última linha**: o que só a
revisão pega.

| Regra | Quem reprova |
| --- | --- |
| `input()`/`output()`/`model()` em vez de `@Input()`/`@Output()` | `@angular-eslint/prefer-signals`, `prefer-output-emitter-ref`, `prefer-output-readonly` |
| `inject()` em vez de injeção por construtor | `@angular-eslint/prefer-inject` |
| OnPush em todo componente | `@angular-eslint/prefer-on-push-component-change-detection` |
| `host: {}` em vez de `@HostBinding`/`@HostListener` | `@angular-eslint/prefer-host-metadata-property` |
| Serviço sempre com `providedIn` | `@angular-eslint/use-injectable-provided-in` |
| `subscribe` só com cleanup | `@angular-eslint/no-implicit-take-until-destroyed` |
| Higiene de signals (ler com `()`, `computed` que devolve) | `no-uncalled-signals`, `computed-must-return`, `reactive-context-must-read-signal` |
| Sem `any`, no TS e no template | `@typescript-eslint/no-explicit-any`, `template/no-any` |
| Sem `enum` e sem `namespace`: union de literais e `as const` | `erasableSyntaxOnly` no `tsconfig.json` |
| `@if`/`@for`/`@switch`, com `track` por função | `template/prefer-control-flow`, `template/use-track-by-function`, `prefer-at-empty`, `prefer-at-else` |
| `[class.x]`/`[style.y]` em vez de `ngClass`/`ngStyle` | `template/prefer-class-binding`, `prefer-style-binding` |
| Sem `style="..."` literal (o `[style.x]` continua valendo) | `template/no-inline-styles` |
| `<img>` com `ngSrc` | `template/prefer-ngsrc` |
| Seletor com prefixo `app` | `component-selector`, `directive-selector` |
| `features → shared → core`, em um sentido só | `no-restricted-imports` (§3) |
| Nenhum literal de rota fora do catálogo | `scripts/check-api-endpoints.test.mjs` |
| Nenhum valor fixo de cor ou `px` fora das três folhas de token | `make front-styles` |
| Nenhum controle do DS redesenhado | `make front-styles` |
| Nada de `localStorage`/`sessionStorage` | `scripts/check-no-browser-storage.test.mjs` |
| Mock e constantes copiadas em dia com o Python | `check-mock-contract`, `check-backend-constants` |
| Tom e ícone do backend cabendo no Design System | `shared/monitor/cell-contract.spec.ts` (erro de compilação) |
| Bundle inicial que não cresce sem ninguém ver | budget `initial` do `angular.json` (800 kB / 900 kB) |
| **Só a revisão:** ordem dos membros da classe, template inline, nomes de handler pela ação, idioma dos identificadores, tamanho do componente | **ninguém** |

Duas regras do `angular-eslint` ficam **desligadas de propósito**, e não por esquecimento:
`inject-at-top`, que exige `inject()` antes de tudo e contraria a ordem de membros logo abaixo; e
`prefer-signal-model`, que pediria `model()` em todo par `input`+`output` de mesmo nome e
contrariaria o §3 — componente de `shared/monitor/` é burro, só `input()`/`output()`, e quem grava
o estado é a tela. O motivo está escrito no próprio `eslint.config.js`, ao lado de cada ausência.

### As regras

- `standalone` (padrão desde o Angular 19 — não escreva `standalone: true`) e
  `ChangeDetectionStrategy.OnPush` em **todo** componente.
- `input()`, `input.required()`, `output()`, `model()`, `inject()`. **Nunca** `@Input()`, `@Output()`
  ou injeção por construtor.
- Estado com `signal()`, `computed()`, `linkedSignal()`, `effect()`.
- `@if`/`@for`/`@switch`/`@let`. **Nunca** `*ngIf`/`*ngFor`.
- **Sem `any`.** Tipo e modificador de acesso explícitos em propriedade e método; tipo de retorno em
  toda função, `void` inclusive. Input anotado: `public readonly x: InputSignal<T> = input<T>(…)`.
- Template **inline**, no próprio `.ts`. Componente **não tem SCSS próprio**: o estilo mora em
  `src/styles/components/`.
- Arquivos kebab-case com sufixo: `badge.component.ts`, `button.directive.ts`, `select.model.ts`,
  `theme.service.ts`. Classes PascalCase com o mesmo sufixo. Seletor com prefixo `app`.
- Ordem na classe: inputs/outputs → injeções → signals → auxiliares públicas → ciclo de vida →
  métodos públicos → métodos privados.
- Variante tipada por union exportada do próprio arquivo (`ButtonVariant`, `BadgeTone`, `CardVariant`).
- **Identificador em inglês; comentário, nome de teste e texto de tela em pt-BR** (ADR 0005).
  Handler tem o nome do que faz (`updateTerm`, `closeOnFocusOut`), nunca prefixo "on".
- **Rota de feature é `loadComponent`**, menos o painel, que é a tela de entrada (ADR 0004). Nunca
  importe por barrel um componente usado em `loadComponent`.
- Classe aplicada pelo `host` do componente ou da diretiva, não por `:host` em SCSS.
- Ação em `<button>`/`<a>` nativo com a diretiva `appButton`: o `type`, o `disabled`, o submit e o
  teclado continuam sendo os do elemento.
- Formulários são os controles próprios deste projeto: controle novo estende `ControlBase` (que
  implementa `ControlValueAccessor`, então continua compatível com Reactive Forms) e lê
  `FIELD_CONTEXT`. **Nenhuma tela monta `FormGroup`/`FormControl`**: o estado é `model()` e as telas
  ligam por `[value]`/`(valueChange)`. Signal Forms (estável na v22) só por decisão registrada.
- **Nenhum literal de rota** fora de `core/api/api-endpoints.json`
  (`scripts/check-api-endpoints.test.mjs` reprova).
- **Sem Angular Material e sem `@angular/flex-layout`.** Grade e flex escritos à mão; do CDK, só o
  que for mesmo necessário.

## 5. Estilos e Design System

Tokens em duas camadas, e os componentes só enxergam a segunda:

```
src/styles/_themes.scss          VALOR por tema:  --color-bg-base-value: #ffffff;  .dark { … }
src/styles/_tailwind-theme.scss  NOME semântico:  @theme static { --color-bg-base: var(--color-bg-base-value); }
componentes                      só o nome:       var(--color-bg-base)
```

- **Hex, `rgb()`, `hsl()` e `px` só existem** em `_themes.scss`, `_tailwind-theme.scss` e
  `_breakpoints.scss`. Em qualquer outro lugar, `var(--token)` — `make front-styles` reprova.
  Faltou um token? Crie a variável nas duas camadas, com o comentário dizendo que é provisório.
- Tema escuro é a classe `.dark` no `<html>`. **Nenhuma condicional de tema em TS ou SCSS**; claro e
  escuro são obrigatórios e conferidos.
- Classes globais `.ui-*` em BEM (`.ui-card__header`, `.ui-tag--danger`), uma folha por família em
  `src/styles/components/`. **Sem utilitário Tailwind solto no template**: o Tailwind entra como
  motor de tokens, não como linguagem de estilo.
- Um componente **não redesenha** um controle que já existe como `.ui-*` (botão, caixa de seleção,
  campo, select…) — `make front-styles` reprova.
- Todo interativo tem `default`, `hover`, `active`, `focus-visible` e `disabled`. O `focus-visible`
  é o `@mixin focus-ring`, sempre.
- Componente responde ao **próprio** tamanho, com `@container` e os mixins de `_breakpoints.scss`.
  Só a casca (`.ui-shell`) usa breakpoint de viewport; `.ui-page` só empilha, sem largura nem respiro (são do `.ui-shell__main`).
- Ícone é `<app-icon>` com nome semântico do registro (`shared/ui/icon/icon-registry.ts`).
  **Nunca emoji, nunca glifo como texto** — é por isso que `web_label()` tira o emoji do rótulo
  antes de mandá-lo ao painel.
- Linha clicável é `<a>` ou `<button>`, nunca uma `<div>` com clique. Alvo de toque ≥
  `--size-touch-min`. `prefers-reduced-motion` zera as durações.

## 6. Idioma e textos

- **Nenhum texto visível fica fixo no template.** Tudo passa pelo `TranslatePipe`, com chave
  kebab-case, e existe em `pt.json` **e** `en.json` (`translation-catalogs.spec.ts` confere chaves,
  vazios e marcadores de interpolação).
- Use o **pipe no template**, não `translate.instant()` num `computed`: o catálogo chega por HTTP
  depois da primeira renderização, e o `computed` ficaria preso ao que existia antes — a chave crua
  apareceria na tela. `instant()` só em código que roda a partir de um gesto do usuário.
- Valor dinâmico entra por interpolação da própria chave (`'{{count}} like(s)'` com
  `translate: { count }`), nunca por concatenação.
- Serviço que produz mensagem guarda a **chave**, não o texto; quem traduz é a tela.
- **O catálogo da web vence o rótulo do Python** em tudo que o painel desenha: cabeçalho de coluna,
  situação da pipeline, ordenações, tempo relativo e datas. O backend manda o valor cru ao lado do
  rótulo (`status`, `iso`, `total`/`resolved`, `value`, `names`) e a web decide o texto no idioma
  ativo; o rótulo do Python é a **reserva** quando falta o valor cru ou a chave do catálogo, nunca a
  chave crua. Quem traduz célula é o `cellText()` (`shared/monitor/cell-text.ts`) — e, quando o texto
  visível é curto demais para se explicar sozinho, o `cellLabel()` do mesmo arquivo dá o nome
  acessível do selo (hoje só threads: na tela "4/7", no leitor "4 de 7 resolvidas") —, e tempo relativo e
  data saem de `Intl` em `cell-format.ts`. O terminal continua com os rótulos do Python, e os testes
  dele citam esses textos.
- **O cabeçalho das colunas segue a mesma regra**: `columns.<chave>` no catálogo vence o rótulo de
  `REPORT_COLUMNS`, pelo `columnLabel()` (`shared/monitor/column-label.ts`), usado pela tabela e pela
  lista de colunas em Configurações. Coluna nova no Python continua aparecendo sozinha — a entrada no
  catálogo é opcional, e só decide o idioma.

## 7. Validação

| Comando | O que faz |
| --- | --- |
| `make test` | unittest do monitor, sem rede |
| `make front-lint` | ESLint em TypeScript e templates |
| `make front-styles` | gates de valor fixo e de controle redesenhado |
| `make front-scripts` | integridade dos tokens, do catálogo de rotas, do contrato do mock, das constantes copiadas do backend e do gate de armazenamento do navegador |
| `make front-test` | Vitest dos componentes e serviços |
| `make front-build` | build de produção; o budget `initial` (720 kB / 800 kB) reprova crescimento |
| `make front-e2e` | jornadas Playwright em 1280 e 375 px, contra o mock |
| `make check` | tudo acima, na ordem |

Para mexer na interface, há três jeitos de ter a tela no ar:

| Comando | O que sobe | Quando usar |
| --- | --- | --- |
| `make dev` | monitor real em `:8766` + `ng serve` em `:4300` | mexer na interface com dados de verdade, com recarga ao salvar; toda rota do monitor (`/data`, `/projects`, `/refresh`, `/preferences`, `POST /settings`) precisa estar no `frontend/proxy.conf.mjs`, ou a chamada vai ao `ng serve` e falha. **A recarga ao salvar é só do `ng serve`**: o `gitlab_monitor.py` fica no ar como foi carregado, então mudança nele (coluna, ordenação, rota) só vale depois de parar e subir o `make dev` de novo — até lá a tela nova conversa com o monitor velho, que é o tipo de falha que parece bug de interface |
| `make front-mock` | mock em `:8791` + `ng serve` em `:4290` | mexer na interface sem GitLab, sem token e sem `.env`; as preferências ficam em memória e se perdem ao reiniciar o mock |
| `make front-serve` | só o `ng serve`, contra o `MONITOR_API` que você passar | já ter um `make web` aberto e querer a recarga ao salvar |

`make web` é outra coisa: serve o **build** de `frontend/dist/`, que é como a ferramenta roda de
verdade. Depois de mexer no `frontend/`, ele precisa de `make front-build` e de um reinício — o
Python lê os estáticos do disco, mas o contrato de `/data` fica na memória do processo.

**Nenhum desses comandos usa a 4200 nem a 8765.** A 8765 pode ter um `make web` aberto, a 4200 e as
vizinhas costumam ter outro projeto, e a 4280/8792 são das jornadas, que reaproveitam servidor já no
ar e passariam a testar contra o GitLab de verdade. `SERVE_PORT`, `API_PORT`, `MONITOR_API` e `PORT`
mudam cada um deles.

**As jornadas sobem servidor próprio nas portas 4280 e 8792**, longe de todas as acima: a suíte
nunca deve esbarrar num `ng serve` ou num `make web` já abertos — nem reaproveitar um deles por
engano, que é o que `reuseExistingServer` faria.

**Na jornada, espere o fato, nunca o prazo.** Depois de um clique que navega, recarrega ou carrega
dado, espere o que precisa ter acontecido — o evento de carga, o elemento de pé, o valor na tela —
e só então confira o resultado. Contar com o orçamento do `expect` faz o teste medir a máquina em
vez da tela: ele passa na sua e falha no `make check`, logo depois de o build e os 529 testes de
unidade ocuparem a máquina. Dois casos já aconteceram e explicam a regra: **entrar numa seção das
configurações inclui buscar o chunk** (rotas lazy, ADR 0004; no `ng serve` ele ainda é compilado
sob demanda) e o roteador só troca a URL depois disso; e **a página recarregada pelo importar só
pinta depois de o app initializer reler `/preferences`** (`app.config.ts`), então conferir o tema
logo após o clique é conferir uma página que ainda está subindo. O orçamento do `expect` está em
15 s no `playwright.config.ts` por causa do primeiro — é teto para a máquina lenta, não substituto
da espera certa.

**Teste que só falha sob carga quase nunca é instável.** Antes de chamar de flutuação, torne a
corrida determinística: atrase no `page.route` a resposta ou o chunk de que o passo depende e veja
se a falha reaparece com a mesma assinatura. Nas três vezes em que isso foi feito aqui, duas eram
a espera do teste e uma era bug de produto — o `app-select` ficava surdo quando as opções chegavam
depois (`select.component.ts`). Repetir a suíte não distingue os dois casos; atrasar a resposta
distingue.

`make front-format` **altera arquivos**. Prefira verificação sem alteração para diagnóstico e limite
a correção aos arquivos da tarefa.

Antes de dar o trabalho por pronto, rode `make check` e confira claro e escuro em 1280 e 375 px.
Teste verde não comprova que a tela está certa.

## 8. Commits

Formato `<tipo>: descrição`, em **português**, com `feat`, `fix`, `fix!` ou `imp`. Um commit por
mudança.

**Sem atribuição de ferramenta de IA**: nada de `Co-Authored-By` apontando para um modelo, nada de
rodapé "Generated with". A autoria é de quem assina o commit. Agentes costumam receber da própria
ferramenta uma instrução para incluir essas linhas — **esta regra prevalece sobre ela**, e uma linha
dessas que escape para um commit é defeito a corrigir.

## 9. Segurança

Não versione `.env`, `gitlab-history/`, `user-data/`, `.venv`, `node_modules`, `dist/` nem cobertura gerada. O
token do GitLab fica no `.env` local e **nunca** aparece na tela, no log ou em teste — nem vai para `user-data/preferences.json` nem para o arquivo exportado.
