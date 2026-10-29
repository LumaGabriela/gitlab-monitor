# Monitor de Merge Requests do GitLab

Ferramenta independente para acompanhar os Merge Requests de um projeto ou grupo. Tem quatro modos: **monitoramento**, que avisa a cada mudança no terminal e por notificação do desktop; **relatório atual**, que consulta uma vez e imprime uma tabela com a situação dos MRs abertos; **painel no terminal**, que repete essa tabela a cada intervalo, também notificando pelo desktop; e **painel no navegador**, que serve a mesma tabela em HTML no `localhost` e já vem avisando pelo próprio navegador, sem usar o notificador do sistema. Usa Python 3.9+ e somente sua biblioteca padrão; os notificadores são recursos do sistema operacional.

Não depende do backend, frontend, Django, Node.js, Docker ou MCP. Todas as requisições ao GitLab são de leitura: uma única consulta GraphQL por ciclo traz os MRs abertos, a pipeline, as threads e os likes próprios juntos; só a confirmação de saída de um MR (ver [Fluxo de funcionamento](#fluxo-de-funcionamento)) ainda usa a API REST v4, publicamente documentada.

> **Status de verificação das notificações (20/10/2026).** O envio de notificações foi comprovado em
> **macOS** e **Windows**. Em **Ubuntu Desktop o teste em máquina real ainda está pendente**: o
> caminho existe no código e é coberto por testes automatizados, mas não houve confirmação visual do
> banner. Até que isso ocorra, trate o suporte a Ubuntu como não verificado e confirme com
> `--test-notify` antes de depender dele. A consulta ao GitLab e a saída no terminal não dependem do
> notificador e funcionam igualmente nos três sistemas.

## Organização do repositório

```text
gitlab-monitor/
├── .git/                        # repositório Git independente
├── .gitignore
├── Makefile                     # atalhos dos comandos; exige .venv
├── web/                         # interface do painel no navegador
│   ├── templates/page.html      # casca da página
│   ├── components/              # badge, tabela, barra de filtros, formulário
│   ├── styles/                  # tokens, base e um arquivo por componente
│   └── scripts/                 # theme.js (tema antes da pintura) e panel.js
├── .env                         # criado por você a partir do modelo; ignorado pelo Git
├── .env.example                 # modelo versionável, sem credenciais
├── gitlab-history/              # estado local criado automaticamente; ignorado
├── README.md
├── gitlab_monitor.py
└── tests/
    ├── test_gitlab_monitor.py
    └── test_gitlab_monitor_notifiers.py
```

O script lê o `.env` e grava `gitlab-history/` **na mesma pasta de `gitlab_monitor.py`**, independentemente do diretório atual do terminal. Não procura credenciais na pasta pai, em um repositório vizinho ou no ambiente do shell. A pasta do monitor precisa permitir escrita no histórico.

A ferramenta é distribuída por `git clone`, não como pasta copiada. O clone traz apenas o `.env.example`, com os valores vazios: o `.env` é criado por você a partir dele, fica fora do versionamento e nunca chega pelo clone. Preencha-o antes de consultar o GitLab.

### Clonar o repositório

Clone em qualquer diretório de trabalho e entre na pasta criada:

```bash
git clone https://github.com/LumaGabriela/gitlab-monitor.git
cd gitlab-monitor
```

O clone é a forma de obter e de atualizar a ferramenta. Não copie a pasta de outra máquina: além de carregar `gitlab-history/` e um possível `.env` com o token de outra pessoa, a cópia perde o vínculo com o remoto e deixa de receber correções.

Para atualizar um clone existente:

```bash
git pull
```

Como `.env` e `gitlab-history/` são ignorados pelo Git, atualizar não sobrescreve a sua configuração nem a sua referência de MRs.

Git é necessário para obter e atualizar a ferramenta; a execução do monitor exige apenas Python e o notificador do sistema. Não é necessário instalar dependências com `pip`. Os atalhos do `Makefile` são a única parte que exige um `.venv` — ver [Atalhos com `make`](#atalhos-com-make).

## 1. Preparar as credenciais

O `.env` fica **neste repositório**, ao lado do script. Num clone novo ele ainda não existe: crie-o a partir do modelo e edite o arquivo criado. Os comandos abaixo preservam uma configuração já existente, então servem também depois de um `git pull`.

macOS/Ubuntu, sem sobrescrever uma configuração existente:

```bash
if [ ! -f .env ]; then cp .env.example .env; fi
```

Windows PowerShell:

```powershell
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
notepad .env
```

O monitor exige apenas as duas primeiras variáveis; `PROJECT` e `INTERVAL` são opcionais e definem os valores padrão da execução. Substitua os valores de exemplo pelos seus dados reais:

```dotenv
GITLAB_API_URL=https://gitlab.exemplo.com/api/v4
GITLAB_TOKEN=COLE_SEU_TOKEN_AQUI
PROJECT=https://gitlab.exemplo.com/grupo/projeto
INTERVAL=15
```

| Variável | Conteúdo |
| --- | --- |
| `GITLAB_API_URL` | URL HTTPS da instância GitLab. Pode incluir `/api/v4`; se ausente, o script acrescenta esse sufixo. Exemplo de instância instalada em subcaminho: `https://servidor.exemplo.com/gitlab/api/v4`. |
| `GITLAB_TOKEN` | Token válido, não expirado, com leitura da API e acesso aos projetos monitorados. Informe somente o token, sem `Bearer` ou `PRIVATE-TOKEN:`. |
| `PROJECT` | Opcional. Alvo padrão, nos mesmos formatos aceitos no argumento posicional (URL de projeto, URL de grupo terminada em `/-/merge_requests`, caminho `grupo/projeto` ou ID numérico). **O argumento passado na execução sobrescreve este valor.** |
| `INTERVAL` | Opcional. Intervalo padrão em minutos, positivo e finito. **`--interval` passado na execução sobrescreve este valor.** Sem `INTERVAL` e sem `--interval`, o intervalo é `15`. |

### Precedência entre `.env` e linha de comando

O que é passado na execução sempre vence o `.env`:

| Valor | 1º Linha de comando | 2º `.env` | 3º Padrão interno |
| --- | --- | --- | --- |
| Projeto | argumento posicional | `PROJECT` | nenhum — é erro executar sem os dois |
| Intervalo | `--interval MINUTOS` | `INTERVAL` | `15` minutos |

Com `PROJECT` e `INTERVAL` preenchidos, basta:

```bash
python3 gitlab_monitor.py
```

Para monitorar outro alvo ou outro ritmo sem editar o `.env`, informe os valores na execução; eles valem apenas naquela execução:

```bash
python3 gitlab_monitor.py grupo/outro-projeto --interval 5
```

Variáveis vazias no `.env` (`PROJECT=`) equivalem a ausentes. Um `INTERVAL` não numérico ou não positivo interrompe a execução com erro de argumento.

Para este ambiente, a URL da instância é `https://gitlab.fpf.br/api/v4`. O token é individual e deve ser obtido no GitLab, nunca copiado de outra pessoa.

Para um token de acesso pessoal tradicional, use o escopo `read_api`. A conta associada também precisa conseguir ler os MRs e as discussões dos projetos escolhidos. `read_repository` sozinho não cobre essa API. Tokens de projeto ficam limitados ao próprio projeto; para acompanhar um grupo, use uma credencial com alcance adequado. Consulte os [escopos oficiais do GitLab](https://docs.gitlab.com/security/tokens/access_token_scopes/).

Na interface da sua instância, abra as configurações do perfil, localize os tokens de acesso pessoal, defina nome, validade e escopo e copie o valor gerado para o arquivo local. Os nomes de menus variam por versão; veja o [guia oficial de tokens pessoais](https://docs.gitlab.com/user/profile/personal_access_tokens/).

Detalhes de leitura do arquivo:

- Salve em UTF-8, com ou sem BOM.
- Aspas simples/duplas, prefixo `export` e comentários são aceitos.
- O arquivo é lido como texto; não é executado e não há expansão de `$VAR`, `${VAR}` ou comandos.
- Exportar variáveis no terminal não substitui esse arquivo: a fonte é o `.env` local ao lado do script.
- Não inclua usuário/senha, query string ou fragmento em `GITLAB_API_URL`.
- Não são necessários `BIT_BEARER_TOKEN`, credenciais de banco ou configuração dos repositórios oficiais.

Não versione o token nem o publique em prints. Reinicie o monitor após atualizar o `.env`, pois credenciais, `PROJECT` e `INTERVAL` são carregados na inicialização.

## 2. Preparar o ambiente

Use Python 3.9 ou superior, preferencialmente uma versão ainda mantida. Não é necessário executar `pip install`: o monitor não tem dependências. Um ambiente virtual só é necessário para usar os atalhos do `Makefile`.

### macOS

Tenha Python 3 disponível no terminal e execute na sessão do usuário conectado ao desktop:

```bash
python3 --version
command -v osascript
```

Se Python estiver ausente, baixe um instalador Python 3 no [site oficial para macOS](https://www.python.org/downloads/macos/), execute o pacote e conclua o assistente. Reabra o terminal e repita `python3 --version`. `osascript` é o notificador usado no macOS. Confira as permissões de notificações do remetente nas configurações do sistema se o teste não produzir um banner.

### Windows 11, com Python nativo

Baixe Python 3 no [site oficial para Windows](https://www.python.org/downloads/windows/), execute o instalador e siga o assistente. Mantenha o launcher `py` disponível; se o instalador oferecer a opção de adicionar Python ao `PATH`, habilite-a para também usar `python`. Reabra o PowerShell e confira:

```powershell
py -3 --version
Get-Command powershell.exe
```

O notificador usa Windows PowerShell (`powershell.exe`), Windows Forms e .NET, na sessão do usuário logado. Não é necessário instalar um pacote Python de notificações ou o PowerShell 7. Se o launcher `py` não estiver disponível, use `python` se esse comando apontar para o Python 3 instalado.

Em **Configurações → Sistema → Notificações**, habilite notificações e banners e confira Não perturbe. Políticas corporativas podem restringir o PowerShell ou a compilação do helper; nesse caso, o erro aparecerá no terminal. Não é necessário executar como administrador ou desabilitar políticas para o uso normal.

Os comandos Windows deste README usam PowerShell e Python nativo. WSL usa o caminho Linux do monitor e precisa de uma sessão de notificações Linux própria; não equivale automaticamente ao suporte nativo Windows.

### Ubuntu Desktop

> As notificações em Ubuntu ainda **não foram confirmadas em máquina real** (ver o status no início
> deste README). Execute o teste da seção 3 antes de usar o monitor aqui e, se o banner não
> aparecer, consulte a solução de problemas: a causa costuma estar no ambiente da sessão, não na
> ferramenta.

Em um terminal da sessão gráfica do seu usuário:

```bash
sudo apt-get update
sudo apt-get install python3 libnotify-bin
python3 --version
command -v notify-send
```

Execute o monitor sem `sudo`. Além do pacote, ele precisa acessar o barramento D-Bus da sessão e um servidor `org.freedesktop.Notifications`, normalmente oferecido pelo GNOME. Tanto X11 quanto Wayland podem usar esse mecanismo.

Ubuntu Server sem desktop, SSH, cron, containers e serviços de sistema não oferecem automaticamente esse contexto. Para esse uso, `--no-notify` mantém a saída no terminal. Para iniciar com o desktop, use a inicialização da sessão do usuário, com o caminho absoluto do script e o `.env` ao lado do script.

## 3. Testar a notificação

Execute os comandos abaixo **dentro da pasta `gitlab-monitor/`**, onde estão este README e o script.

macOS ou Ubuntu Desktop:

```bash
python3 gitlab_monitor.py --test-notify
```

Windows PowerShell:

```powershell
py -3 gitlab_monitor.py --test-notify
```

Esse teste não lê `.env`, não consulta o GitLab e não cria histórico. Ele envia uma mensagem com acentos e emoji. Código de saída `0` indica que o helper concluiu; `1` indica falha. O sistema ainda pode ocultar o banner por preferências de notificação. No Windows, o helper pode permanecer ativo por cerca de 30 segundos, até fechamento, clique ou limite de espera.

## 4. Escolher o alvo e verificar o acesso

O argumento do alvo aceita estes formatos para **projetos**:

```text
grupo/projeto
grupo/subgrupo/projeto
123
https://gitlab.exemplo.com/grupo/projeto
https://gitlab.exemplo.com/grupo/projeto.git
https://gitlab.exemplo.com/grupo/projeto/-/merge_requests
```

O número é o ID do projeto. Para **grupos**, use a URL completa da lista de MRs, incluindo `groups/` e `/-/merge_requests`:

```text
https://gitlab.exemplo.com/groups/grupo/subgrupo/-/merge_requests/
```

A consulta de grupo inclui os projetos dos subgrupos que a credencial consegue acessar. Não use somente `grupo` como argumento de grupo; o caminho curto `grupo/projeto` é interpretado como projeto. Links SSH não são aceitos.

As URLs precisam pertencer à mesma instância HTTPS definida no `.env`. Filtros após `?` e fragmentos após `#` são ignorados: o monitor consulta todos os MRs abertos do alvo, com paginação. Coloque URLs com parâmetros entre aspas para proteger caracteres do terminal.

Faça uma consulta de leitura, sem notificação:

```bash
python3 gitlab_monitor.py grupo/projeto --once --no-notify
```

Com `PROJECT` definido no `.env`, o argumento pode ser omitido:

```bash
python3 gitlab_monitor.py --once --no-notify
```

No Windows, substitua `python3` por `py -3`. Se não existir histórico, essa primeira consulta apenas informa quantos MRs estão abertos. Ao encerrar, o snapshot é apagado por padrão; use `--keep-history true` para preservá-lo.

## 5. Escolher o modo

Ao executar o script sem `--mode`, o terminal pergunta qual modo usar:

```text
Modo de execução:
  1 - Monitoramento
  2 - Relatório atual
  3 - Painel no terminal (tabela que se atualiza)
  4 - Painel no navegador (tabela servida em localhost)
Escolha [1]:
```

Enter sem digitar nada escolhe `1`. Para pular a pergunta — em `make`, cron ou qualquer execução não interativa — use `--mode monitorar`, `--mode relatorio`, `--mode painel` ou `--mode web`. **Sem terminal interativo, a pergunta não é feita e o modo é monitoramento**, para que automações existentes continuem funcionando.

Os modos 2, 3 e 4 compartilham a mesma consulta e a mesma tabela; mudam a frequência, para onde a tabela vai e se há comparação. Os painéis (3 e 4) **também avisam as mudanças**. O painel no terminal usa o notificador do sistema e respeita `--no-notify`; o painel no navegador **não usa o notificador do sistema** — quem avisa é o navegador, pela caixa da página.

A diferença em relação ao modo 1 está em onde fica a referência de comparação: os painéis a mantêm **em memória**, enquanto o monitoramento a grava em `gitlab-history/`. Por isso os painéis não usam o histórico em disco nem o lock e podem rodar em paralelo com um monitoramento do mesmo projeto, sem alertas duplicados por disputa de arquivo. Em compensação, reiniciar um painel recomeça a referência do zero: a primeira passagem apenas fotografa o estado, sem emitir eventos.

### 1 — Monitoramento

É o modo contínuo descrito nas seções seguintes: consulta de tempos em tempos, compara com a referência anterior, avisa o que mudou no terminal e por notificação, e segue até `Ctrl+C`.

### 2 — Relatório atual

Consulta **uma única vez** e imprime a situação dos MRs abertos em forma de tabela:

```bash
python3 gitlab_monitor.py --mode relatorio
```

```text
[2026-10-20 11:04:12 -03] Report for flake/siga: 4 open MR(s).
┌───────┬──────────────────────────────────┬──────────────────┬─────────────┬────────────────┬─────────────────┐
│ Likes │ MR                               │ Author           │ Threads     │ Thread openers │ Pipeline Status │
├───────┼──────────────────────────────────┼──────────────────┼─────────────┼────────────────┼─────────────────┤
│ 2 👍  │ BE #199 feat(#ANT-8951):         │ geovana.medeiros │ 7/7 resolved│ heloysa, luma  │ ✅ success      │
│       │ cadastro e lista de candidatos   │                  │             │                │                 │
├───────┼──────────────────────────────────┼──────────────────┼─────────────┼────────────────┼─────────────────┤
│ 1 👍  │ FE #208 feat(#ANT-9057):         │ geovana.medeiros │ 13/13       │ heloysa, luma  │ — no pipeline   │
│       │ document management module       │                  │ resolved    │                │                 │
└───────┴──────────────────────────────────┴──────────────────┴─────────────┴────────────────┴─────────────────┘
```

Todo o conteúdo da coluna **MR** é um link clicável para o próprio Merge Request, inclusive as linhas geradas pela quebra do título. Os links abrem **em nova guia**, com `rel="noopener noreferrer"`, de modo que a guia aberta não ganha referência a esta página e o painel não se perde ao ser clicado. O link usa a sequência OSC 8, aceita por iTerm2, Windows Terminal, GNOME Terminal e pela maioria dos terminais atuais; onde não houver suporte, o texto aparece normalmente e apenas deixa de ser clicável. **Quando a saída não é um terminal** — redirecionada para arquivo ou passada por um pipe — os links são omitidos, para não sujar o texto com códigos de escape.

Como ler as colunas:

| Coluna | Conteúdo |
| --- | --- |
| Likes | Reações 👍 no MR. Não são aprovações. Um ✓ depois do número indica que **o seu like está entre eles**. No painel web, **2 ou mais ganham fundo de destaque** e, abaixo do número, aparecem os nomes de quem reagiu (ver [O seu like entre os demais](#o-seu-like-entre-os-demais)). |
| MR | Rótulo do projeto, número e título, como link para o MR. `BE` para repositórios terminados em `-backend` e `FE` para `-frontend`; qualquer outro repositório aparece com o nome curto. O título vem exatamente como está no GitLab. |
| Author | Quem abriu o MR. |
| Threads | Discussões resolvíveis: resolvidas sobre o total. Comentário avulso, que não tem estado de resolução, não entra na conta e aparece como `no threads` quando o MR só tem comentários desse tipo. |
| Thread openers | Nome de usuário de quem iniciou cada thread, sem repetição. `—` quando não há thread. |
| Mergeable | Se o GitLab permite mesclar o MR agora (`mergeable` da GraphQL): "✅ mergeable" ou "❌ blocked" — pipeline falhando, aprovação pendente ou outro impedimento do próprio GitLab, sem detalhar qual. Só "blocked" ganha destaque (vermelho); "mergeable" é o estado comum e fica neutro. |
| Conflicts | Se a branch de origem está em conflito com a de destino (`conflicts` da GraphQL): "❌ conflict" ou "✅ no conflict". Só "conflict" ganha destaque; é o estado incomum. |
| Pipeline Status | Situação da pipeline associada ao MR, com emoji e o nome do estado. |
| Updated | Data da última atividade no MR (novo commit, comentário, mudança de pipeline...), relativa a agora (`3 hours ago`, `23 minutes ago`), igual ao que a própria página do GitLab mostra. No painel web, a data e hora exatas aparecem ao passar o mouse. Recalculada a cada consulta: o texto muda sozinho entre um ciclo e outro, mesmo sem nada ter mudado no MR. |
| Created | Data de abertura do MR, no formato `dd/mm/aaaa`. `—` quando a data não veio da API. |

Estados de pipeline exibidos:

| Emoji | Estados |
| --- | --- |
| ✅ | `success` |
| ❌ | `failed` |
| 🔄 | `running` |
| ⏳ | `created`, `preparing`, `pending`, `waiting` |
| ⚪ | `canceled`, `canceling` |
| ⏩ | `skipped` |
| ✋ | `manual` |
| ⏰ | `scheduled` |
| — | MR sem pipeline |

Um estado que o GitLab venha a introduzir e que não esteja na lista aparece com `•` e o nome recebido, em vez de sumir da tabela.

O relatório e os painéis trazem também as colunas **Mergeable** e **Conflicts** (ver tabela acima), omitidas do exemplo só para caber na largura deste documento.

As linhas são ordenadas pela data de criação do MR, do mais recente para o mais antigo. MRs criados no mesmo instante são desempatados pelo rótulo.

O relatório **não usa o histórico**: não cria, não lê e não apaga o snapshot em `gitlab-history/`, e não trava o alvo. Por isso pode rodar enquanto um monitoramento do mesmo projeto está ativo, sem interferir nele. Também não envia notificação — o resultado é a tabela no terminal. As opções `--interval`, `--once`, `--keep-history` e `--no-notify` não se aplicam a ele.

### 3 — Painel no terminal

A mesma tabela do relatório, refeita a cada intervalo:

```bash
python3 gitlab_monitor.py --mode painel --interval 5
```

A cada ciclo a tela é limpa e a tabela é redesenhada, de modo que o terminal mostra sempre a situação atual em vez de acumular histórico. As mudanças detectadas aparecem logo abaixo da tabela e também viram notificação do sistema. `Ctrl+C` encerra. Falha de rede em um ciclo é registrada e **a tabela anterior permanece na tela**: a próxima tentativa acontece no intervalo seguinte.

Como a saída é redesenhada, esse modo não serve para registro: para guardar o que foi visto, use `--mode relatorio`, que imprime uma vez e encerra.

### 4 — Painel no navegador

A mesma tabela em HTML, servida localmente:

```bash
python3 gitlab_monitor.py --mode web --port 8765
```

```text
[2026-10-20 15:42:48 -03] Panel at http://127.0.0.1:8765/ (updates every 15 minute(s)). Ctrl+C to stop.
```

Abra o endereço no navegador. Os títulos dos MRs são links para o GitLab, e as mudanças detectadas a cada passagem são registradas no terminal.

**Este modo não usa o notificador do sistema.** Quem avisa na tela é o navegador, com as notificações **ligadas por padrão** (ver adiante): dois avisos para o mesmo evento seriam ruído. Por isso `--no-notify` não tem efeito aqui. Os modos 1 e 3 seguem usando o notificador do sistema normalmente.

**A primeira passagem já preenche a tabela.** Ela não compara com nada e não emite evento: serve de referência. Da segunda em diante, cada passagem compara com a anterior e as mudanças viram avisos. O mesmo vale para o painel no terminal; o relatório, por consultar uma única vez, nunca compara nem notifica.

Consultar leva alguns segundos — cada MR exige detalhes e discussões —, então a página começa mostrando **"Querying GitLab…"** em vez de um número. Com 15 MRs, a tabela costuma aparecer em menos de 20 segundos. "No open MRs for this target" só aparece quando a consulta terminou e o alvo está mesmo vazio.

**A página se atualiza sozinha, sem recarregar.** Ela consulta o próprio monitor a cada 10 segundos e troca apenas a tabela, preservando rolagem e foco. Essa consulta é local e não gera chamada ao GitLab: quem fala com a API é o monitor, no intervalo configurado. Na prática, o que o monitor coleta aparece na tela em até 10 segundos. Se o monitor parar, a página avisa e volta a tentar.

#### O que mudou desde a consulta anterior

Quando um MR muda de uma passagem para a seguinte, a célula correspondente ganha um 🔸 **imediatamente à esquerda do conteúdo**, indicando onde está a novidade sem precisar ler o terminal. O conteúdo de cada célula fica num invólucro flex, de modo que a marca acompanha o item na mesma linha mesmo com a coluna estreita:

| Célula marcada | Significa |
| --- | --- |
| Likes | O número de reações 👍 mudou. |
| Threads | A quantidade de discussões ou o estado de resolução mudou. |
| Thread openers | Alguém novo abriu thread, ou alguém deixou de constar. |
| Pipeline Status | A pipeline mudou de estado ou foi substituída. |

Mergeable e Conflicts não entram nesse rastreamento: são exibidos, mas uma mudança neles não acende o 🔸.

Uma legenda acima da tabela lembra o que as marcas significam — o 🔸 de alteração e o ✓ do like próprio. Só as células que realmente mudaram são marcadas: um MR que só ganhou likes marca apenas a coluna de likes. A marca reflete **a última comparação**, então ela some na passagem seguinte se aquele campo parar de mudar.

Nada é marcado na primeira passagem, que serve de referência, nem em MRs que apareceram agora — não há com o que comparar. Trocar de alvo também recomeça do zero.

#### O seu like entre os demais

A coluna de likes mostra um ✓ depois do número quando você reagiu com 👍 naquele MR:

```text
2 👍 ✓    você está entre os dois likes
2 👍      nenhum dos dois é seu
```

Não há usuário a configurar: quem curtiu é resolvido pelo GitLab a partir do próprio token do `.env`. A mesma consulta GraphQL do ciclo já pede os MRs abertos filtrados por reação própria, numa segunda sub-consulta dentro da mesma requisição — **nenhuma chamada a mais**, nem por ciclo nem por MR.

O ✓ foi escolhido em vez de um emoji por ocupar uma coluna só: emoji de largura ambígua desalinha a tabela do terminal.

A comparação usa as linhas da passagem anterior, não o snapshot em disco: assim ela alcança também quem abriu as threads, que o snapshot não guarda, e o formato do histórico do monitoramento fica intocado. A marca existe só no painel web; a tabela do terminal segue sem ela.

**No painel web**, abaixo do emblema de likes aparecem os nomes de quem reagiu com 👍, por exemplo `bia.sa, cris.me`. Vem da mesma consulta GraphQL do ciclo (`awardEmoji` do MR), filtrado a `thumbsup` — outras reações (❤️, 🎉...) não contam como like aqui e ficam de fora da lista, do mesmo jeito que já ficam de fora da contagem de `upvotes`. MR sem nenhum like não mostra a linha. Esse detalhamento não existe na tabela do terminal, só o ✓ do like próprio.

#### Ordenação e filtros

A barra acima da tabela ordena e filtra o que já foi coletado, sem nova consulta ao GitLab — a resposta é imediata.

| Ordenar por | Critério |
| --- | --- |
| Most recent | Data de criação, da mais nova para a mais antiga. É o padrão. |
| Most likes | Reações 👍, da maior para a menor. |
| MR (A–Z) | Rótulo e título, em ordem alfabética. |
| Author (A–Z) | Nome de quem abriu o MR. |
| Unresolved first | Quantidade de threads em aberto, da maior para a menor. |
| Thread openers | Nomes dos revisores, em ordem alfabética. |
| Pipeline status | Ordem de urgência, não alfabética: `failed`, `canceled`, `manual`, `running`, `pending`, `scheduled`, `skipped`, `success` e, por último, sem pipeline. |

**Todo critério desempata pela data**, do mais recente para o mais antigo. Dois MRs com o mesmo número de likes, por exemplo, aparecem na ordem em que foram abertos.

Os filtros de **Author** e **Pipeline** restringem a tabela a um valor; podem ser combinados, e **Clear filters** devolve a visão completa. As opções saem dos MRs atuais, então não existe filtro que não devolva nada por falta de dados. MRs sem pipeline têm opção própria em vez de sumirem da lista. Com filtro ativo, o cabeçalho mostra `2 of 4 MR(s)`, e uma combinação sem resultado explica que nenhum MR corresponde aos filtros.

Ordenação e filtros vivem só no navegador: a tabela do terminal segue sempre por data.

#### Parâmetros na própria página

O formulário no topo traz `PROJECT` e `INTERVAL` já preenchidos com os valores em vigor. Ao alterar e clicar em **Save**, os novos valores passam a valer imediatamente, com precedência sobre o `.env`:

- **Nada é gravado.** O `.env` não é alterado; encerrar o painel descarta as mudanças.
- Os valores passam pela **mesma validação da linha de comando**: o projeto precisa pertencer à instância do `.env` e o intervalo precisa ser um número positivo. Valor inválido aparece como aviso na página e **mantém o alvo anterior** rodando. O campo vem preenchido na forma canônica (`groups/caminho/do/grupo` para grupos), que é aceita de volta — salvar sem editar nada mantém o mesmo alvo.
- Trocar de alvo **recomeça a referência**: a primeira passagem no projeto novo apenas fotografa o estado, sem emitir eventos, para não comparar projetos diferentes entre si.
- Save não espera o ciclo em andamento terminar: a consulta ao novo alvo começa na hora.

#### Consultar fora do intervalo

O botão **Check now**, imediatamente antes de **Save**, força uma consulta na hora, sem esperar o intervalo terminar. Ele **não abre uma coleta paralela**: apenas adianta o ciclo do próprio painel — o mesmo mecanismo que a troca de alvo usa. Por isso não há risco de duas consultas simultâneas ao GitLab, nem de a comparação com o estado anterior se perder: a passagem adiantada compara com a anterior como qualquer outra, e as mudanças encontradas viram eventos normalmente.

Enquanto a consulta corre, o botão fica desabilitado e marcado como ocupado; ele volta ao normal quando a tabela nova chega. A página reconhece o fim pelo **carimbo da última coleta**, não por tempo estimado, então o botão libera exatamente quando há dados novos. O intervalo normal segue valendo depois — verificar agora não reinicia nem altera a contagem.

#### Notificações do navegador

A caixa **Notify in browser** **vem marcada**: no modo web, as notificações são o comportamento padrão. Cada mudança detectada vira uma notificação do navegador, e desmarcar a caixa as desliga enquanto a página estiver aberta.

Como os navegadores exigem permissão explícita, o painel resolve isso sozinho conforme o estado dela:

| Permissão | O que acontece |
| --- | --- |
| Já concedida | As notificações funcionam desde o carregamento, sem pedir nada. |
| Ainda não decidida | A caixa segue marcada e a página avisa que aguarda a permissão. O pedido só pode partir de um gesto seu, então acontece no seu primeiro clique ou tecla na página. |
| Negada antes | A caixa se desmarca sozinha e a página explica que o site está bloqueado; libere a permissão no navegador para reativar. |

O aviso de permissão tem linha própria na página, separada da linha de erros, para que a atualização da tabela — que acontece a cada poucos segundos — não o apague.

**Como a notificação aparece.** É a notificação nativa do sistema, emitida pelo navegador: o título é a identificação do MR (`!216 — feat(#ANT-9433): ...`) e o corpo traz a mudança e o link, como no terminal.

**Testar sem esperar uma mudança.** O botão **Test notification**, ao lado da caixa, envia um aviso de exemplo imediatamente. Ele existe porque o silêncio do painel é ambíguo: pode ser que nenhum MR tenha mudado, ou que o aviso tenha saído da página e sido suprimido depois. Se o teste aparece, a página está funcionando e o silêncio é só falta de novidade; se não aparece, o bloqueio está no navegador ou no sistema, e a própria página diz onde olhar.

Enquanto a permissão estiver pendente, **os eventos não são descartados**: ficam no monitor e são avisados assim que você concede. Quando muitas mudanças chegam juntas, acima de cinco elas viram **um aviso só**, com a contagem no título e a lista dos MRs no corpo — uma pilha de banners seria pior que a informação que eles trazem.

Mudanças diferentes no mesmo MR aparecem como avisos separados; o mesmo aviso repetido substitui o anterior em vez de empilhar.

No modo web, esse é o **único** aviso de tela: o notificador do sistema fica fora, e os eventos continuam aparecendo no terminal. Se a permissão for negada, ou o navegador não oferecer a API, a caixa se desmarca sozinha e a página explica o motivo. A API exige contexto seguro, e `127.0.0.1` conta como tal — não é preciso HTTPS.

#### Organização da interface

Os arquivos da página ficam em `web/`, ao lado do script, separados por responsabilidade:

```text
web/
├── templates/page.html          # casca: cabeçalho, formulário, barra e tabela
├── components/                  # badge, tabela, estado vazio, barra, formulário, legenda
├── styles/
│   ├── tokens.css               # único arquivo com cor, spacing e radius
│   ├── base.css                 # tipografia e layout da página
│   ├── components/              # um arquivo por componente (card, tabela, badge,
│   │                            #   botão, barra, formulário, feedback)
│   └── responsive.css
└── scripts/
    ├── theme.js                 # resolve o tema no <head>, antes da pintura
    └── panel.js                 # atualização, consulta manual, ordenação, filtros,
                                 #   tema e avisos
```

Os componentes usam marcadores `{{nome}}`, substituídos pelo Python. A sintaxe foi escolhida por não colidir com as chaves do CSS nem com os literais do JavaScript. Cada arquivo é lido **uma vez por execução** e reaproveitado nas consultas seguintes: ao editar algo em `web/`, reinicie o monitor para ver a mudança.

Como os arquivos ficam ao lado do script, **o modo web precisa da pasta `web/` presente**; os demais modos funcionam só com o `gitlab_monitor.py`.

O visual segue o **design system FPF Tech**, nos guias `card`, `feedback`, `button` e `input`:

- **Tokens.** Cor, espaçamento, raio, espessura de borda, altura de controle e tamanho de fonte ficam só em `styles/tokens.css`. Nenhuma regra de componente traz valor literal — nem hex, nem `rgba()`, nem `px`. A única exceção é a condição do `@media`, que por limitação do CSS não aceita variável; há teste cobrindo a regra e a exceção.
- **Tema claro e escuro.** O seletor **Theme**, na barra acima da tabela, oferece *Automatic*, *Light* e *Dark*. No automático a página segue a preferência do sistema e acompanha a troca dela sem recarregar; a escolha manual fica guardada no navegador e sobrevive ao recarregamento. O tema é resolvido ainda no `<head>`, antes da folha de estilo, para a página não piscar clara antes de escurecer.
- Os tokens do tema escuro ficam em **um único bloco**, aplicado por atributo. Manter dois blocos — um por `@media`, outro por atributo — faria os dois saírem de sincronia; há teste garantindo que existe só um.
- **Botões** nas variantes primária (ação de salvar) e ghost (limpar filtros), com os estados obrigatórios: default, hover, active, focus-visible, disabled e loading.
- **Campos** com label associado e os estados default, focus, erro, desabilitado e somente leitura. O erro marca a borda do campo por `aria-invalid`, não apenas a mensagem.
- **Foco** sempre no token `border/focus` (`#B3C50E`), em ambos os temas — não numa cor improvisada.
- **Cards e badges** conforme os guias: card flat sem sombra pesada, badge com tom semântico por intenção.

A fonte DM Sans é declarada com reserva para a fonte do sistema, mas **não é baixada**: um painel local não deveria disparar requisição a servidor externo de fontes só para abrir. Onde a DM Sans estiver instalada, ela é usada; onde não estiver, a página cai na fonte do sistema.

Decisões de segurança deste modo, que valem conhecer antes de usar:

- O servidor escuta **apenas em `127.0.0.1`**, nunca em `0.0.0.0`: a página não fica acessível para outras máquinas da rede.
- **Não há autenticação**, porque não há exposição externa. Qualquer processo da sua própria máquina consegue ler a página, que contém títulos e links internos de MRs. Não use este modo em máquina compartilhada com usuários em quem você não confia.
- **O token nunca entra na página.** Ele é usado só nas chamadas à API, no servidor.
- Todo texto vindo do GitLab — títulos, nomes de usuário, estados — passa por escape antes de entrar no HTML, de modo que um título contendo HTML aparece como texto e não é interpretado pelo navegador.
- Respondem apenas `/` e `/index.html` (a página), `GET /data` (a tabela e os eventos), `POST /settings` (os parâmetros desta execução) e `POST /refresh` (adianta o ciclo). Qualquer outro caminho recebe `404`; o servidor não expõe arquivos do disco.
- `POST /settings` e `POST /refresh` exigem corpo **JSON** e conferem o cabeçalho `Origin`. As duas exigências juntas impedem que outra página aberta no seu navegador troque o alvo do painel, ou dispare consultas ao GitLab em seu nome, sem você saber: um formulário comum de outro site não consegue enviar JSON, e nenhum cabeçalho de CORS é devolvido.

Se a porta já estiver em uso, o monitor encerra com a mensagem de falha ao iniciar; escolha outra com `--port`.

## 6. Iniciar o monitoramento contínuo

macOS ou Ubuntu, preservando o estado para a próxima execução:

```bash
python3 gitlab_monitor.py grupo/projeto --interval 15 --keep-history true
```

Windows PowerShell:

```powershell
py -3 gitlab_monitor.py grupo/projeto --interval 15 --keep-history true
```

Exemplo para um grupo desta instância:

```bash
python3 gitlab_monitor.py "https://gitlab.fpf.br/groups/flake/siga/-/merge_requests/" --interval 15 --keep-history true
```

Com `PROJECT` e `INTERVAL` no `.env`, a mesma execução contínua dispensa os dois valores:

```bash
python3 gitlab_monitor.py --keep-history true
```

O intervalo é em **minutos**; `0.5` equivale a 30 segundos. Intervalos menores aumentam a quantidade de chamadas à API, especialmente em grupos grandes. O computador precisa permanecer acordado e o processo precisa continuar aberto. `Ctrl+C` encerra o monitor.

Também é possível executar de outro diretório, passando o caminho absoluto do script:

```bash
python3 /caminho/para/gitlab-monitor/gitlab_monitor.py grupo/projeto --interval 15
```

Nesse caso, o `.env` e o histórico continuam ao lado do script, e não no diretório atual. No Windows, use `py -3` e coloque o caminho entre aspas se houver espaços.

## Atalhos com `make`

O `Makefile` encurta os comandos mais usados. **Ele exige um `.venv` na pasta do monitor** e falha com instrução quando ele não existe:

```bash
make venv
```

O monitor não tem dependências: o `.venv` existe só para dar aos alvos um interpretador fixo, sem depender de qual `python3` está no `PATH`. Nada é instalado nele.

| Comando | Equivale a |
| --- | --- |
| `make help` | Lista os alvos e as variáveis aceitas. |
| `make venv` | Cria o `.venv` exigido pelos demais alvos. |
| `make monitor` | Monitoramento contínuo (`--mode monitorar`). |
| `make report` | Relatório atual (`--mode relatorio`). |
| `make panel` | Painel no terminal (`--mode painel`). |
| `make web` | Painel no navegador (`--mode web`); a porta vem de `PORT`. |
| `make once` | Uma consulta de monitoramento e encerra (`--mode monitorar --once`). |
| `make test-notify` | Testa só a notificação do sistema. |
| `make test` | Executa a suíte de testes offline. |

As variáveis `PROJECT`, `INTERVAL`, `KEEP_HISTORY` e `PORT` sobrescrevem o `.env` quando informadas:

```bash
make monitor PROJECT=grupo/projeto INTERVAL=5 KEEP_HISTORY=true
make report PROJECT=grupo/outro-projeto
make web PORT=9000 INTERVAL=2
```

Omitidas, valem `PROJECT` e `INTERVAL` do `.env`. Como os alvos passam `--mode` explicitamente, nenhum deles faz a pergunta de modo.

Usar o `make` é opcional: todos os comandos continuam disponíveis chamando `python3 gitlab_monitor.py` diretamente, sem `.venv`.

## Opções disponíveis

| Argumento/opção | Comportamento |
| --- | --- |
| `project` | Projeto ou grupo, aceito como URL, caminho `grupo/projeto`, `groups/caminho/do/grupo` ou ID numérico. Sobrescreve `PROJECT` do `.env`. Obrigatório quando `PROJECT` não está definido, exceto com `--test-notify` ou `--help`. |
| `--mode monitorar\|relatorio` | Escolhe o modo sem perguntar. Sem a opção, o terminal pergunta; sem terminal interativo, vale `monitorar`. |
| `--port PORTA` | Porta do modo web em `127.0.0.1`; padrão `8765`. Ignorada nos demais modos. |
| `--interval MINUTOS` | Intervalo positivo e finito entre consultas. Sobrescreve `INTERVAL` do `.env`; sem ambos, `15`. Nos painéis, é o tempo entre atualizações; ignorado no modo relatório. |
| `--once` | Consulta uma vez e encerra. Se houver histórico, compara com ele. |
| `--no-notify` | Mantém os logs e desativa notificações nativas durante as consultas. Sem efeito nos modos relatório e web, que não usam o notificador do sistema. |
| `--keep-history true` | Preserva o snapshot ao encerrar, para retomar a comparação. |
| `--keep-history false` | Apaga o snapshot ao encerrar; padrão. Também apaga um snapshot reaproveitado de execução anterior. |
| `--test-notify` | Testa somente o notificador, sem projeto, credenciais ou API. |
| `--help` | Exibe a ajuda. |

`--keep-history` recebe um valor explícito `true` ou `false`, sem distinção de maiúsculas. O modo `--test-notify` é independente das opções de monitoramento: use-o sozinho.

## Fluxo de funcionamento

Os modos relatório e painéis fazem a mesma passagem: leem o `.env`, resolvem o alvo, consultam os MRs abertos numa única requisição GraphQL (pipeline, threads e likes próprios já embutidos) e montam a tabela. O relatório imprime uma vez e encerra; os painéis repetem a passagem a cada intervalo, um redesenhando o terminal e o outro atualizando a página servida em `127.0.0.1`. Nenhum deles usa lock ou histórico. O monitoramento segue o ciclo abaixo.

1. Lê o `.env`, resolve o alvo e o intervalo dando precedência ao que veio na execução sobre `PROJECT`/`INTERVAL`, valida os argumentos, define o modo (`--mode`, pergunta no terminal ou monitoramento), lê as credenciais e normaliza a URL da API e o alvo.
2. Gera uma chave a partir da instância e do alvo e obtém um lock local. Apenas um monitor pode acompanhar o mesmo alvo/instância nessa pasta de histórico por vez.
3. Se houver snapshot compatível, carrega a referência anterior. Caso contrário, a primeira consulta cria a referência sem emitir eventos de MRs.
4. Faz uma única consulta GraphQL que lista os MRs abertos com pipeline, threads, likes próprios, `mergeable`, `conflicts` e `awardEmoji` já embutidos — o mesmo mecanismo que a própria página de MRs do GitLab usa para montar a tabela, com threads aninhadas para também trazer quem abriu cada uma. Quando um MR sai da lista, consulta seus detalhes pela REST para confirmar o estado; `403`/`404` não significam merge.
5. Compara os snapshots. Em consultas bem-sucedidas, registra o novo estado em arquivo temporário e substitui o snapshot de forma atômica.
6. Escreve os eventos e a quantidade de alterações no terminal. Se houver eventos e notificações estiverem habilitadas, envia um alerta agregado.
7. Aguarda o restante do intervalo, descontando o tempo gasto na consulta e no notificador. Repete até `Ctrl+C` ou finaliza imediatamente com `--once`.
8. Ao sair do loop, remove o snapshot se `--keep-history false`. O SO libera o lock quando o processo termina.

### Eventos acompanhados

| Evento | Detecção |
| --- | --- |
| Novo MR aberto | MR apareceu depois da referência inicial. |
| MR mesclado ou fechado | MR saiu dos abertos e seu estado foi confirmado. |
| Likes | Mudança no total de reações 👍; não representa aprovações. |
| Pipeline | Mudança de ID, status ou presença da pipeline associada ao MR. |
| Quantidade de discussões | Mudança no total de discussões. |
| Discussão resolvida/reaberta | Mudança do estado de resolução em uma discussão já conhecida. |
| Nova resposta | Aumento no número de notas em uma discussão já conhecida. |

### Formato dos eventos

Cada evento ocupa três linhas: identificação do MR, a mudança e o link. No terminal, as linhas seguintes recuam para não se confundirem com um novo registro.

```text
[2026-10-20 10:17:51 -03] !201 — feat(#ANT-8947): envio de documentos pelo candidato
  PIPELINE #265275 running → #265275 success
  https://gitlab.fpf.br/flake/siga/poc-sdd-backend/-/merge_requests/201
```

O número exibido é o do MR (`!201`). Em alvos de grupo, o identificador do projeto não aparece no texto: a URL já indica a qual projeto o MR pertence. Dois MRs de projetos diferentes podem, portanto, mostrar o mesmo `!número` — o link é o que os distingue.

Na notificação o mesmo conteúdo é usado, com uma linha em branco separando MRs diferentes.

Comentários avulsos contam na quantidade de discussões, mas não têm estado de resolução. Mudanças somente no título, descrição, aprovações ou edição de uma nota não geram, por si só, eventos. Estados intermediários entre consultas podem passar despercebidos.

### Notificadores

- **macOS — verificado.** AppleScript via `osascript`, passando título e mensagem como dados.
- **Windows — verificado.** PowerShell recebe código fixo e JSON separado. O helper Windows Forms mantém o ícone e o loop de mensagens vivos até fechamento, clique ou limite de espera. O texto é resumido para respeitar os limites do balão Win32 sem partir emojis.
- **Linux — pendente de teste em máquina real.** `notify-send` envia ao servidor de notificações do usuário, com nome de aplicação e escape do markup do corpo. A simulação automatizada cobre o transporte e os argumentos, não a exibição do banner.

As notificações repetem o conteúdo dos eventos, separados por linha em branco, e podem ser truncadas pelos limites de cada sistema; o conteúdo completo fica no terminal. Clicar no balão Windows não abre automaticamente o MR. O retorno positivo do helper não garante que o usuário viu o banner.

### Falhas e retomada

Falhas de conexão, HTTP ou coleta impedem a atualização normal da referência. O monitor registra o erro e tenta novamente no próximo intervalo. Uma mensagem de erro diferente da anterior também pode gerar alerta; erros repetidos iguais não notificam a cada consulta. A recuperação é registrada no terminal.

Falhas do notificador mostram executável ausente, exit code, detalhe do helper ou timeout, e não interrompem as consultas. O estado já foi atualizado antes do envio: não há fila persistente ou reenvio automático de um alerta que falhou.

Com `--once`, o código de saída é `0` para consulta bem-sucedida e `1` para falha de inicialização/consulta. Uma falha somente do notificador não muda o sucesso da consulta. Erros de argumentos usam o código `2` do parser.

## Histórico e segurança

`gitlab-history/<chave>.json` contém a versão do formato (`2`), a data da última consulta e os snapshots dos MRs: título, URL, likes, pipeline e resumo das discussões. O token não é salvo. Arquivos `.lock` podem permanecer vazios ou conter um byte; a existência do arquivo não indica que o lock está ativo.

A chave depende da instância e do alvo, não do token. Ao trocar a credencial, o histórico do mesmo alvo pode ser reaproveitado. Para descartar uma referência, encerre primeiro o monitor correspondente e mova o JSON daquele alvo para fora de `gitlab-history/`. Não remova arquivos de lock enquanto houver um monitor ativo.

Se o formato do snapshot for incompatível ou o arquivo estiver inválido, preserve-o fora da pasta de histórico antes de iniciar uma nova referência. O script não tenta migrar automaticamente formatos antigos. Encerramentos forçados podem deixar um snapshot mesmo sem `--keep-history true`.

O token é enviado somente no header `PRIVATE-TOKEN`, por HTTPS, e redirecionamentos são recusados — tanto na REST (`/api/v4`) quanto na GraphQL (`/api/graphql`, um nível acima), já que as duas falam com o mesmo opener e o mesmo header. Os snapshots podem conter nomes e links internos: mantenha-os locais e fora do versionamento. O modo web serve a página apenas em `127.0.0.1`, sem autenticação e sem o token na página; veja as ressalvas na seção do modo 4.

## Solução de problemas

| Sintoma | O que conferir |
| --- | --- |
| Python não encontrado | Instalação e comando: `python3` no macOS/Ubuntu; `py -3` ou `python` no Windows. |
| Falha ao iniciar | `.env` ao lado do script, `GITLAB_API_URL` e `GITLAB_TOKEN` preenchidas, HTTPS, acesso de escrita ao histórico, snapshot válido e outro monitor do mesmo alvo. |
| HTTP `401` | Token inválido, expirado ou com prefixo indevido. |
| HTTP `403` ou `404` | Escopo, acesso ao recurso, caminho/ID e permissões da conta. Recursos privados também podem retornar `404`. Para grupo, confira se o alvo começa com `groups/`: um caminho de grupo sem esse prefixo é lido como projeto e o GitLab responde `404`. |
| Falha de conexão | Rede, VPN, DNS e certificado HTTPS confiável para o Python instalado. |
| Alvo ou intervalo inesperado | O argumento posicional e `--interval` sobrescrevem `PROJECT` e `INTERVAL` do `.env`. Confira a linha executada e o log `Monitorando ... a cada N minuto(s)`. |
| Modo web não abre | Porta já em uso: escolha outra com `--port` ou `make web PORT=9000`. O endereço é sempre `127.0.0.1`, não acessível de outra máquina. |
| Página do painel parada | Ela avisa na própria tela quando não alcança o monitor. Confira se o processo continua rodando no terminal. |
| Painel sem tabela logo ao abrir | É a primeira consulta, que leva alguns segundos; a página mostra "Consultando o GitLab…" até terminar. |
| Notificação do navegador não aparece | Clique em **Test notification** no formulário: ele envia um aviso na hora, sem esperar que algum MR mude, e separa as duas causas possíveis. Se o teste aparece e o painel segue calado, é porque nada mudou — o painel só avisa quando algo muda, e nunca na primeira passagem, que serve de referência. Depois, a caixa marcada e a permissão: se estiver pendente, clique na página para confirmá-la; se foi negada, a página explica. Por fim, confira se o próprio navegador pode notificar no sistema (no macOS, Ajustes do Sistema › Notificações) e se o Não perturbe está desligado. |
| Primeira consulta não notifica | É o comportamento esperado: cria a referência. Teste o notificador com `--test-notify`. |
| `notify-send` ausente | Instale `libnotify-bin` no Ubuntu Desktop. |
| `ServiceUnknown`/erro de D-Bus | Execute no terminal da sessão gráfica do usuário, sem `sudo`, com servidor de notificações ativo. |
| `powershell.exe` ausente | Confira Windows PowerShell no `PATH` e se está usando Python nativo Windows. |
| Erro do helper PowerShell | Consulte o detalhe impresso; confira Windows Forms/.NET e restrições da organização. |
| Helper conclui, banner não aparece | Confira permissões, banners, Não perturbe e a central/lista de notificações. No GNOME, use `Super+V`. |

Para isolar o Ubuntu antes de consultar o GitLab:

```bash
notify-send --app-name='GitLab Monitor' -- 'GitLab Monitor' 'Teste direto'
gdbus call --session \
  --dest org.freedesktop.Notifications \
  --object-path /org/freedesktop/Notifications \
  --method org.freedesktop.Notifications.GetServerInformation
```

## Testes de desenvolvimento

Na pasta do monitor, execute a suíte offline:

```bash
python3 -B -m unittest discover -s tests -v
```

No Windows:

```powershell
py -3 -B -m unittest discover -s tests -v
```

Com o `.venv` criado, `make test` faz o mesmo.

Os testes não leem credenciais reais nem consultam o GitLab. Cobrem comparação de MRs, paginação da consulta GraphQL, resolução de ID numérico de projeto para a GraphQL, `.env` próprio do monitor, precedência da linha de comando sobre `PROJECT`/`INTERVAL`, escrita atômica, escolha de modo, montagem e alinhamento da tabela, destaque de likes, marca do like próprio, lista de quem curtiu, colunas de mesclável/conflitos, coluna de data, ordenações e filtros do painel, notificação dos painéis sem histórico nem lock, escape e rotas do painel web, validação e recusa de origem no `POST /settings` e no `POST /refresh`, preservação do `.env` ao salvar parâmetros, entrega incremental de eventos, conformidade do CSS com os tokens do design guide, argumentos dos notificadores, conteúdo Unicode, falhas e continuidade do monitor. Os testes do servidor sobem portas efêmeras em `127.0.0.1`.

A simulação Linux usa um executável temporário no lugar de `notify-send` e é executada em sistemas POSIX. O teste PowerShell usa `pwsh` quando disponível; se não estiver no `PATH`, indique o caminho de uma instalação existente:

```bash
MONITOR_TEST_PWSH=/caminho/para/pwsh python3 -B -m unittest discover -s tests -v
```

```powershell
$env:MONITOR_TEST_PWSH = 'C:\caminho\pwsh.exe'
py -3 -B -m unittest discover -s tests -v
```

`MONITOR_TEST_PWSH` é uma variável do ambiente de testes, não uma configuração lida do `.env` pelo monitor. O teste compila o C# de produção contra um desktop simulado, verificando fechamento, clique, timer e exceção. É complementar à validação visual com `--test-notify` no sistema de destino. Sem `pwsh`, esse teste é marcado como ignorado; não é necessário instalar PowerShell 7 para executar o monitor no Windows.


## Limitações e decisões de funcionamento

- **Polling:** não usa webhook ou conexão em tempo real. Só observa o estado nas consultas; eventos que surgem e desaparecem entre elas podem não ser detectados.
- **Um alvo por processo:** para projetos/grupos diferentes, abra processos separados. MRs em um grupo são distinguidos pelo par projeto/ID local.
- **Escopo de acesso:** acompanha apenas os recursos visíveis ao token. Um token não ganha acesso a projetos apenas por possuir o escopo de leitura.
- **Volume e limites da API: 1 requisição por ciclo.** Uma única consulta GraphQL traz os MRs abertos, a pipeline, as threads (com quem abriu) e os likes próprios — o mesmo mecanismo que a página de MRs do GitLab usa para montar a tabela, não um atalho inventado. Medido contra `groups/flake/siga` (19 MRs abertos, 3 projetos): 1 requisição, ~8-10s. Antes de existir essa consulta, o mesmo ciclo custava 42 requisições REST (depois reduzidas a 24, buscando a pipeline por projeto em vez de por MR); essas duas versões ficaram só na história do repositório.
  - **De onde veio a consulta.** Não é documentada pela API GraphQL pública do GitLab: é a mesma usada pela própria página de MRs (`app/assets/javascripts/merge_requests/list/queries/group/get_merge_requests.query.graphql`, código aberto em `gitlab-org/gitlab`), descoberta lendo esse código-fonte, não a referência oficial da API. Pode mudar de formato entre versões do GitLab sem aviso em changelog de API, diferente da REST v4, que é versionada e estável. A REST v4 segue em uso na confirmação de saída de um MR (passo 4 do fluxo), por ser rara e não valer a pena mover.
  - **Tetos de uma única página:** até 100 MRs abertos e até 100 threads por MR entram numa passagem só. Acima disso, a tabela fica incompleta nesse ciclo (os MRs/threads além do teto não aparecem) — sem paginação aninhada para cobrir o excesso; não visto em uso real nesta instância. O conjunto de likes próprios (`curtidos`) não pagina de propósito: perder um ✓ em um grupo com mais de 100 MRs curtidos e abertos ao mesmo tempo é cosmético, não motivo para uma segunda consulta.
  - Não há paralelismo, backoff exponencial ou tratamento específico de `Retry-After` para HTTP `429`; a próxima tentativa usa o intervalo normal. A requisição GraphQL tem timeout de 30 segundos; um ciclo pode demorar mais que o intervalo configurado em grupos muito grandes.
- **Disponibilidade:** não executa como serviço automaticamente, não acorda o computador e não monitora enquanto o processo estiver encerrado ou a máquina suspensa. Na retomada, compara os estados observados.
- **Entrega de alertas:** não há confirmação de leitura ou garantia de banner visível. Não perturbe e políticas do desktop continuam valendo; falhas de envio não entram em fila para reenvio.
- **Tamanho do alerta:** mensagens são agregadas por ciclo e limitadas no adaptador; no Windows, título/corpo respeitam os buffers Win32. Consulte o terminal para os eventos completos.
- **Histórico:** guarda somente o snapshot mais recente, não um registro cronológico permanente de todos os eventos. O histórico de uma versão anterior pode exigir reiniciar a referência.
- **Retomada:** `--keep-history true` deve ser informado nas execuções que precisam manter a referência. O padrão `false` apaga o JSON ao sair normalmente, mesmo quando ele veio de uma sessão anterior.
- **Ambientes sem desktop:** o terminal funciona com `--no-notify`; notificações nativas exigem uma sessão gráfica acessível. WSL e serviços de sistema não são cobertos automaticamente pelo suporte ao Windows nativo.
- **Windows:** o helper usa balões Windows Forms, não um aplicativo instalado com ações, identidade própria e histórico garantido na Central de Notificações. Ele pode ocupar até cerca de 30 segundos por envio, além do tempo de inicialização.
- **Mudanças cobertas:** não há alerta específico para aprovação, alteração de descrição, edição de comentário, troca de responsável ou novo commit se isso não modificar um campo acompanhado, como a pipeline.
- **Testes simulados:** as simulações verificam transporte, falhas e ciclo de vida. Não substituem conferir o banner com `--test-notify` no desktop real.

## Configuração anterior na pasta pai

Se usava uma versão que lia o `.env` e `gitlab-history/` da pasta pai, esta versão usa somente os arquivos locais. Preencha as duas variáveis no novo `.env`; os arquivos da pasta pai não são modificados ou importados automaticamente.

Sem copiar um snapshot anterior, a primeira consulta cria uma nova referência silenciosa. Se precisar retomar o estado antigo, encerre os monitores e copie apenas os JSONs compatíveis de histórico para `gitlab-monitor/gitlab-history/`, preservando seus nomes. Os locks antigos não devem ser copiados. Não mantenha simultaneamente a versão antiga e a nova monitorando o mesmo alvo se quiser evitar alertas duplicados.

## Versionamento e publicação

O `.gitignore` local exclui `.env`, variações locais de ambiente, histórico, ambientes virtuais e caches. O `.env.example` é a exceção permitida: deve continuar sem tokens reais.

Confira a exclusão antes de preparar arquivos para um commit:

```bash
git status --short
git check-ignore .env
```

Para preparar somente código, modelo, documentação e testes:

```bash
git add .gitignore .env.example Makefile README.md gitlab_monitor.py tests web
```

Depois revise o conteúdo preparado e crie seu commit conforme as regras de versionamento adotadas. Não use `git add -f .env`. O remoto `origin` já aponta para `https://github.com/LumaGabriela/gitlab-monitor.git`: publique com `git push` na branch escolhida, lembrando que é de lá que os outros clones vão receber a mudança.
