# Monitor de Merge Requests do GitLab

Ferramenta independente para acompanhar os Merge Requests de um projeto ou grupo. Tem quatro modos: **monitoramento**, que avisa a cada mudança no terminal e por notificação do desktop; **relatório atual**, que consulta uma vez e imprime uma tabela com a situação dos MRs abertos; **painel no terminal**, que repete essa tabela a cada intervalo, também notificando pelo desktop; e **painel no navegador**, que serve a mesma tabela numa interface Angular no `localhost` e já vem avisando pelo próprio navegador, sem usar o notificador do sistema. Usa Python 3.9+ e somente sua biblioteca padrão; os notificadores são recursos do sistema operacional.

Não depende do backend, do frontend oficial, de Django, Docker ou MCP. **Node.js e npm só são necessários para o painel no navegador**, que serve o build do Angular em `frontend/` (gerado uma vez com `make front-build`), e para desenvolver essa interface; os outros três modos usam só Python. Todas as requisições ao GitLab são de leitura: uma única consulta GraphQL por ciclo traz os MRs abertos, a pipeline, as threads e os likes próprios juntos; só a confirmação de saída de um MR (ver [Fluxo de funcionamento](#fluxo-de-funcionamento)) ainda usa a API REST v4, publicamente documentada.

> **Status de verificação das notificações (20/10/2026).** O envio de notificações foi comprovado em
> **macOS** e **Windows**. Em **Ubuntu Desktop o teste em máquina real ainda está pendente**: o
> caminho existe no código e é coberto por testes automatizados, mas não houve confirmação visual do
> banner. Até que isso ocorra, trate o suporte a Ubuntu como não verificado e confirme com
> `--test-notify` antes de depender dele. A consulta ao GitLab e a saída no terminal não dependem do
> notificador e funcionam igualmente nos três sistemas.

## O que a ferramenta faz

Resumo do que existe hoje; cada item tem a sua seção adiante, com o detalhe.

- **Painel** — a tabela dos MRs abertos, com Likes, MR, Autor, Threads, Participantes, Revisão,
  Mergeável, Conflitos, Pipeline, Atualizado e Criado. Marca o que mudou desde a passagem anterior,
  ordena por coluna, filtra por autor, pipeline e revisão, aplica um preset e tem o "Verificar
  agora" ao lado da hora da última coleta.
- **Consulta** — os projetos ou grupos monitorados (até 20) e de quantos em quantos minutos o
  monitor coleta. É a única tela que fala com o servidor, e salvar nela recomeça a referência usada
  para detectar novidades.
- **Notificações** — o que vira aviso do navegador. Um select escolhe quem decide: o **Geral**
  (tipos de evento, só o que é meu, ignorar rascunhos, likes mínimos, autores silenciados) ou os
  **critérios**, que comparam os fatos do MR como as regras de destaque. Só um lado vale por vez, e
  o outro aparece desabilitado. O horário silencioso e a espera entre avisos do mesmo MR valem nos
  dois. O que é calado é descartado, não guardado para depois.
- **Destaques de linha** — regras suas que pintam a linha inteira na tabela, com cor e traço
  escolhidos à parte, mais o texto das regras casadas para quem não distingue a cor.
- **Exibição** — densidade do espaçamento, tamanho do texto e a partir de quantos likes a célula é
  destacada.
- **Colunas da tabela** — quais colunas aparecem e em que ordem. A lista vem do servidor; coluna
  nova entra no fim.
- **Presets** — pacotes nomeados aplicados num clique: filtros, ordenação, ordem e colunas ocultas,
  regras de destaque e de notificação. Três vêm prontos, e os seus ficam ao lado. Alvos e intervalo
  não entram, porque trocar o alvo recomeça a referência.
- **Dados** — onde o `user-data/preferences.json` fica no disco, e os botões de exportar e importar.

Tema e idioma ficam no cabeçalho do painel, não nas configurações. O terminal mostra a mesma tabela
e aplica as mesmas regras de destaque e de aviso, decididas por um porte em Python do motor do
painel.

## Organização do repositório

```text
gitlab-monitor/
├── .git/                        # repositório Git independente
├── .gitignore
├── Makefile                     # atalhos dos comandos; exige .venv
├── CLAUDE.md                    # guia operacional único
├── AGENTS.md                    # só aponta para o CLAUDE.md
├── .pre-commit-config.yaml      # ganchos de commit e de push
├── docs/adr/                    # as decisões de arquitetura, uma por arquivo
├── frontend/                    # painel no navegador (Angular + Design System FPF)
│   ├── src/styles/              # tokens em duas camadas e as classes .ui-*
│   ├── src/assets/i18n/         # pt.json e en.json
│   ├── src/app/                 # core/ (rotas e serviços), shared/, features/
│   ├── mock/ e scripts/         # monitor de mentira, gates e testes dos scripts
│   ├── e2e/                     # jornadas Playwright, em 1280 e 375 px
│   └── dist/                    # build servido pelo modo web; ignorado
├── .env                         # criado por você a partir do modelo; ignorado pelo Git
├── .env.example                 # modelo versionável, sem credenciais
├── gitlab-history/              # estado local criado automaticamente; ignorado
├── user-data/                   # preferências do painel (preferences.json); ignorado
├── README.md
├── gitlab_monitor.py            # coleta, flags, preferências do terminal, notificação e servidor web
├── monitor_rules.py             # regras de destaque e de aviso (porte das do painel)
├── monitor_table.py             # a tabela do terminal: largura, cor, marcador de linha, resumo
├── monitor_text.py              # textos do terminal em pt e en
└── tests/
    ├── test_gitlab_monitor.py
    ├── test_gitlab_monitor_notifiers.py
    ├── test_monitor_rules.py
    ├── test_monitor_table.py
    └── test_monitor_text.py
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

Git é necessário para obter e atualizar a ferramenta; a execução do monitor exige apenas Python e o notificador do sistema. Não é necessário instalar dependências com `pip`. Os atalhos Python do `Makefile` exigem um `.venv`, e o painel no navegador exige Node.js e npm para gerar o build — ver [Atalhos com `make`](#atalhos-com-make).

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

O `.env` guarda só as credenciais: a URL da instância e o token. O alvo e o intervalo não moram aqui — no painel web eles são escolhidos na página de configurações e ficam em `user-data/preferences.json`; nos modos de terminal, vêm da linha de comando. Substitua os valores de exemplo pelos seus dados reais:

```dotenv
GITLAB_API_URL=https://gitlab.exemplo.com/api/v4
GITLAB_TOKEN=COLE_SEU_TOKEN_AQUI
```

| Variável | Conteúdo |
| --- | --- |
| `GITLAB_API_URL` | URL HTTPS da instância GitLab. Pode incluir `/api/v4`; se ausente, o script acrescenta esse sufixo. Exemplo de instância instalada em subcaminho: `https://servidor.exemplo.com/gitlab/api/v4`. |
| `GITLAB_TOKEN` | Token válido, não expirado, com leitura da API e acesso aos projetos monitorados. Informe somente o token, sem `Bearer` ou `PRIVATE-TOKEN:`. |

### De onde vêm o alvo e o intervalo

Nenhum dos dois vem do `.env`. Uma linha `PROJECT=` ou `INTERVAL=` que sobrou num `.env` antigo é ignorada sem aviso: apague-a.

| Valor | Modos de terminal (`monitorar`, `relatorio`, `painel`) | Modo web |
| --- | --- | --- |
| Alvo | argumento posicional e `--project` (repetível); sem nenhum dos dois, os alvos guardados em `user-data/preferences.json`; sem eles, é erro de argumento | os alvos guardados em `user-data/preferences.json`; o argumento posicional, quando informado, vence o arquivo |
| Intervalo | `--interval MINUTOS`; sem ele, `15` minutos | o intervalo guardado no arquivo; `--interval`, quando informado, vence o arquivo; sem nenhum dos dois, `15` |

Abrir o painel web sem nenhum alvo guardado é um estado válido: a tabela fica vazia, a faixa de estado diz que nenhum alvo foi escolhido e nada é consultado até você escolher os alvos na página de configurações.

Com vários alvos, a tabela é a **união** dos MRs abertos deles, sem repetir o MR que aparece em dois (num projeto e no grupo que o contém). Se um alvo falhar numa coleta, os outros continuam: a coleta não é dada como perdida, mas a faixa de estado **sai do verde** e um aviso nomeia os alvos cujos MRs ficaram de fora até a próxima coleta bem-sucedida. Só quando **nenhum** alvo responde a tabela anterior é preservada inteira, com o erro da coleta.

Nos modos de terminal, o alvo na linha de comando vence o arquivo e vale apenas naquela execução. Para ignorar o arquivo por completo, use `--no-prefs` (ver [O terminal e as suas preferências](#o-terminal-e-as-suas-preferências)):

```bash
python3 gitlab_monitor.py grupo/outro-projeto --interval 5
```

Um `--interval` não numérico ou não positivo interrompe a execução com erro de argumento.

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

Não versione o token nem o publique em prints. Reinicie o monitor após atualizar o `.env`, pois as credenciais são carregadas na inicialização.

## 2. Preparar o ambiente

Use Python 3.9 ou superior, preferencialmente uma versão ainda mantida. Não é necessário executar `pip install`: o monitor não tem dependências Python. Um ambiente virtual só é necessário para usar os atalhos do `Makefile`. Para o painel no navegador, instale também Node.js e npm.

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

No Windows, substitua `python3` por `py -3`. Se não existir histórico, essa primeira consulta apenas informa quantos MRs estão abertos. Ao encerrar, o snapshot é apagado por padrão; use `--keep-history true` para preservá-lo.

## 5. Escolher o modo

Ao executar o script sem `--mode`, o terminal pergunta qual modo usar:

```text
Execution mode:
  1 - Monitoring
  2 - Current report
  3 - Terminal panel (self-refreshing table)
  4 - Browser panel (table served on localhost)
Choose [1]:
```

Enter sem digitar nada escolhe `1`. Para pular a pergunta — em `make`, cron ou qualquer execução não interativa — use `--mode monitorar`, `--mode relatorio`, `--mode painel` ou `--mode web`. **Sem terminal interativo, a pergunta não é feita e o modo é monitoramento**, para que automações existentes continuem funcionando.

Os modos 2, 3 e 4 compartilham a mesma consulta e a mesma tabela; mudam a frequência, para onde a tabela vai e se há comparação. Os painéis (3 e 4) **também avisam as mudanças**. O painel no terminal usa o notificador do sistema e respeita `--no-notify`; o painel no navegador **não usa o notificador do sistema** — quem avisa é o navegador, pela caixa da página.

A diferença em relação ao modo 1 está em onde fica a referência de comparação: os painéis a mantêm **em memória**, enquanto o monitoramento a grava em `gitlab-history/`. Por isso os painéis não usam o histórico em disco nem o lock e podem rodar em paralelo com um monitoramento do mesmo projeto, sem alertas duplicados por disputa de arquivo. Em compensação, reiniciar um painel recomeça a referência do zero: a primeira passagem apenas fotografa o estado, sem emitir eventos.

### 1 — Monitoramento

É o modo contínuo descrito nas seções seguintes: consulta de tempos em tempos, compara com a referência anterior, avisa o que mudou no terminal e por notificação, e segue até `Ctrl+C`.

### 2 — Relatório atual

Consulta **uma única vez** e imprime a situação dos MRs abertos em forma de tabela:

```bash
python3 gitlab_monitor.py grupo/projeto --mode relatorio
```

```text
2 aberto(s)
┌───────┬──────────────────────────────────────────────┬──────────────────┬────────────────┬───────────────┬─────────┬────────────────┐
│ Likes │ MR                                           │ Autor            │ Threads        │ Participantes │ Revisão │ Pipeline       │
├───────┼──────────────────────────────────────────────┼──────────────────┼────────────────┼───────────────┼─────────┼────────────────┤
│ 2 👍  │ BE #199 feat(#ANT-8951): cadastro e lista de │ geovana.medeiros │ 7/7 resolvidas │ heloysa, luma │ luma    │ ✅ sucesso     │
│       │ candidatos                                   │                  │                │               │         │                │
│ 1 👍  │ FE #208 feat(#ANT-9057): document management │ geovana.medeiros │ 13/13          │ heloysa, luma │ —       │ — sem pipeline │
│       │ module                                       │                  │ resolvidas     │               │         │                │
└───────┴──────────────────────────────────────────────┴──────────────────┴────────────────┴───────────────┴─────────┴────────────────┘
```

A primeira linha é o resumo; a tabela não tem régua entre uma linha de MR e a seguinte, e sim entre
o cabeçalho e o corpo. O exemplo acima é estreito e esconde **Mergeável**, **Conflitos**,
**Atualizado** e **Criado**, que aparecem na saída real.

Todo o conteúdo da coluna **MR** é um link clicável para o próprio Merge Request, inclusive as linhas geradas pela quebra do título. O link usa a sequência OSC 8, aceita por iTerm2, Windows Terminal, GNOME Terminal e pela maioria dos terminais atuais; onde não houver suporte, o texto aparece normalmente e apenas deixa de ser clicável. **Quando a saída não é um terminal** — redirecionada para arquivo ou passada por um pipe — os links são omitidos, para não sujar o texto com códigos de escape.

Como ler as colunas:

| Coluna | Conteúdo |
| --- | --- |
| Likes | Reações 👍 no MR. Não são aprovações. Um ✓ depois do número indica que **o seu like está entre eles**. No painel web, abaixo do número aparecem os nomes de quem reagiu, e o selo pode ganhar destaque a partir de um número de likes escolhido em Configurações > Exibição (desligado por padrão) (ver [O seu like entre os demais](#o-seu-like-entre-os-demais)). |
| MR | Rótulo do projeto, número e título, como link para o MR. `BE` para repositórios terminados em `-backend` e `FE` para `-frontend`; qualquer outro repositório aparece com o nome curto. O título vem exatamente como está no GitLab. |
| Autor | Quem abriu o MR. |
| Threads | Discussões resolvíveis: resolvidas sobre o total. Comentário avulso, que não tem estado de resolução, não entra na conta e aparece como `sem threads` quando o MR só tem comentários desse tipo. |
| Participantes | Nome de usuário de quem iniciou cada thread, sem repetição, exceto o autor do MR. `—` quando não há thread. |
| Revisão | Quem é assignee e quem revisa o MR, sem repetir quem é os dois; `—` quando não há ninguém. O terminal junta os nomes com ` · `; o painel web põe uma pessoa por linha. A célula mostra só os nomes: o **seu** estado de revisão (pendente, mudanças pedidas, aprovado) continua vindo no tom da célula, mas desde que ela deixou de ser um selo nenhuma das duas tabelas o desenha — quem avisa que a revisão foi pedida a você, ou retirada, é o evento de revisão. |
| Mergeável | Se o GitLab permite mesclar o MR agora (`mergeable` da GraphQL): "✅ mergeável" ou "❌ bloqueado" — pipeline falhando, aprovação pendente ou outro impedimento do próprio GitLab, sem detalhar qual. "bloqueado" ganha destaque vermelho e "mergeável", verde: é o estado bom, não um neutro. |
| Conflitos | Se a branch de origem está em conflito com a de destino (`conflicts` da GraphQL): "❌ conflito" ou "✅ sem conflito". Só "conflito" ganha destaque; é o estado incomum. |
| Pipeline | Situação da pipeline associada ao MR, com emoji e o nome do estado. |
| Atualizado | Data da última atividade no MR (novo commit, comentário, mudança de pipeline...), relativa a agora (`há 3 horas`, `há 23 minutos`), igual ao que a própria página do GitLab mostra. No painel web, a data e hora exatas aparecem ao passar o mouse. Recalculada a cada consulta: o texto muda sozinho entre um ciclo e outro, mesmo sem nada ter mudado no MR. |
| Criado | Data de abertura do MR, no formato `dd/mm/aaaa`. `—` quando a data não veio da API. |

Estados de pipeline exibidos:

| Emoji | Estados (rótulo no terminal) |
| --- | --- |
| ✅ | `success` (sucesso) |
| ❌ | `failed` (falhou) |
| 🔄 | `running` (rodando) |
| ⏳ | `created` (criada), `preparing` (preparando), `pending` (pendente), `waiting_for_resource` (aguardando) |
| ⚪ | `canceled` (cancelada), `canceling` (cancelando) |
| ⏩ | `skipped` (pulada) |
| ✋ | `manual` (manual) |
| ⏰ | `scheduled` (agendada) |
| — | MR sem pipeline (`sem pipeline`) |

Um estado que o GitLab venha a introduzir e que não esteja na lista aparece com `•` e o nome recebido, em vez de sumir da tabela.

O relatório e os painéis trazem também as colunas **Mergeável** e **Conflitos** (ver tabela acima), omitidas do exemplo, junto com **Atualizado** e **Criado**, só para caber na largura deste documento.

Por padrão (`--sort recent`) as linhas são ordenadas pela data de criação do MR, do mais recente para o mais antigo; MRs criados no mesmo instante são desempatados pelo rótulo. `--sort` e `--direction` mudam isso (ver abaixo).

O relatório **não usa o histórico**: não cria, não lê e não apaga o snapshot em `gitlab-history/`, e não trava o alvo. Por isso pode rodar enquanto um monitoramento do mesmo projeto está ativo, sem interferir nele. Também não envia notificação — o resultado é a tabela no terminal. As opções `--interval`, `--once`, `--keep-history` e `--no-notify` não se aplicam a ele.

### 3 — Painel no terminal

A mesma tabela do relatório, refeita a cada intervalo:

```bash
python3 gitlab_monitor.py grupo/projeto --mode painel --interval 5
```

A cada ciclo a tela é limpa e a tabela é redesenhada, de modo que o terminal mostra sempre a situação atual em vez de acumular histórico. As mudanças detectadas aparecem logo abaixo da tabela e também viram notificação do sistema. `Ctrl+C` encerra. Falha de rede em um ciclo é registrada e **a tabela anterior permanece na tela**: a próxima tentativa acontece no intervalo seguinte.

Como a saída é redesenhada, esse modo não serve para registro: para guardar o que foi visto, use `--mode relatorio`, que imprime uma vez e encerra.

### O terminal e as suas preferências

Os três modos de terminal (`monitorar`, `relatorio` e `painel`) leem `user-data/preferences.json`, o mesmo arquivo do painel no navegador, e por isso mostram a tabela e avisam como o painel foi configurado. Cada valor segue **flag, depois arquivo, depois o padrão do código**, campo a campo: uma chave inválida no arquivo cai no padrão sem afetar as vizinhas, e só a lista de alvos é tudo-ou-nada, como no painel. `--no-prefs` ignora o arquivo inteiro.

O que vem do arquivo: os alvos (`monitoredProjects`), o intervalo, a ordenação, os filtros, a ordem e a visibilidade das colunas, o limite de destaque de likes, as regras de destaque de linha (`rowRules`), as regras de aviso (`notifyRules`) e o idioma. O terminal só lê esse arquivo — a única escrita é a
de defesa: arquivo ilegível ou de `version` desconhecida é **renomeado** para
`preferences.corrupt-AAAAMMDD-HHMMSS.json`, com o nome novo registrado na tela, e a execução segue
com os padrões (ver [Se der errado](#se-der-errado)).

Flags novas, todas opcionais:

| Opção | Efeito |
| --- | --- |
| `--project ALVO` | Alvo adicional, repetível; junto com o posicional, até 20. Qualquer alvo na linha de comando substitui os guardados. |
| `--sort CHAVE` | `recent` (padrão), `updated`, `likes`, `mr`, `author`, `threads`, `participants` ou `pipeline`. |
| `--direction asc\|desc` | Sentido da ordenação; sem ele, o natural da chave. |
| `--author USUARIO` | Só MRs desse autor; repetível. |
| `--pipeline ESTADO` | Só MRs com essa situação de pipeline (`no-pipeline` para MR sem pipeline); repetível. |
| `--review assigned\|reviewing\|unassigned` | Filtro de revisão, repetível, com semântica OU como no painel. |
| `--language pt\|en` | Idioma dos textos do terminal; sem a flag, o do painel, e sem ele, `pt`. |
| `--color` / `--no-color` | Força ou desliga a cor; sem nenhuma, só há cor num terminal e sem `NO_COLOR` no ambiente. |
| `--no-prefs` | Ignora `user-data/preferences.json` nos modos de terminal. |

```bash
python3 gitlab_monitor.py --mode relatorio --sort likes --direction desc --review reviewing
python3 gitlab_monitor.py --mode relatorio --no-prefs grupo/projeto --project grupo/outro
```

**Com vários alvos**, os modos de terminal consultam todos, juntam os MRs sem repetir o que aparece em dois e, se um alvo falhar, seguem com os outros, como no painel. Sem posicional e sem `--project`, os alvos vêm de `monitoredProjects`.

**O que só muda num terminal de verdade.** Só nele a tabela se adapta à largura da janela (colunas e títulos longos quebram para caber), pinta as células com o tom da coluna e liga o texto da coluna MR ao link.

**Redirecionar não ignora as preferências.** Sem terminal (`make report | cat`, arquivo, cron) a tabela continua com a largura fixa de 250 colunas e sem nenhum código de escape — nem cor, nem link OSC 8, a menos que você force `--color` —, mas **o resto vale igual**: a ordenação, os filtros, a ordem e as colunas ocultas do arquivo, a coluna do marcador quando há regras de destaque ligadas e a **linha de resumo que vem antes da tabela** (quantos MRs estão abertos, quantos aparecem depois dos filtros e quantos têm pipeline falha, estão bloqueados ou esperam você). Quem tem um script lendo `make report` deve saber que esconder uma coluna ou criar uma regra de destaque no painel passa a mudar o que o script lê, que a linha de resumo é uma primeira linha a mais que a saída antiga não tinha e que **a régua `├───┼───┤` entre duas linhas de MR deixou de existir** — hoje ela só separa o cabeçalho do corpo, então script que conta ou divide registros por ela passa a ver uma linha só.

**O `make` não consegue ignorar o arquivo.** `make report` não repassa `--no-prefs` (nem nenhuma flag nova). Um script que precise de uma forma estável deve chamar `python3 gitlab_monitor.py --mode relatorio --no-prefs ALVO` diretamente: isso devolve a tabela completa de sempre, com todas as colunas e sem marcador, mas **a linha de resumo continua**.

**Destaque de linha não depende de cor.** Havendo regras de destaque ligadas, a tabela ganha uma coluna estreita à esquerda com um marcador por tom: `!` (`danger`), `~` (`warning`), `+` (`success`), `*` (`strong`), `=` (`info`) e `-` (`neutral`) — os seis tons que uma regra pode escolher —, na cor do tom quando há cor. Por ser texto, o marcador sobrevive a um pipe. Os códigos dos tons foram escolhidos para evitar branco, preto e amarelo puro, que somem num fundo claro ou escuro, e `strong` é negrito, sem cor; a legibilidade ainda não foi conferida a olho em terminal.

**O `monitorar` e o painel aplicam as regras de aviso do painel** (tipos de evento, só os meus, likes mínimos, rascunhos, autores silenciados, horário de silêncio e espera por MR) **e falam o idioma escolhido**. A espera entre avisos do mesmo MR só começa depois que o aviso foi de fato entregue; um aviso que não saiu volta no ciclo seguinte.

**O modo web mantém o log do terminal em inglês, de propósito.** O texto de cada evento é o mesmo que o painel recebe em `/data`, e ele não pode mudar de idioma conforme o terminal. Assim, `make monitor` fala pt-BR (ou o idioma das preferências) e `make web` não: não é defeito.

As regras de destaque e de aviso existem em dois motores, um no painel (TypeScript) e outro em `monitor_rules.py`; `make front-scripts` falha se os dois deixarem de declarar o mesmo vocabulário (ver `docs/adr/0007-regras-de-terminal-em-python.md`).

### 4 — Painel no navegador

A mesma tabela numa interface Angular, servida localmente. O Python serve o build em `frontend/dist/gitlab-monitor/browser/`, que não vem no clone: gere-o uma vez, e de novo depois de cada `git pull` que mexa em `frontend/`, com:

```bash
make front-build
```

`make web` gera o build sozinho quando ele falta. Sem o build, a página responde `404`.


```bash
python3 gitlab_monitor.py --mode web --port 8765
```

```text
[2026-10-20 15:42:48 -03] Panel at http://127.0.0.1:8765/ (updates every 15 minute(s)). Ctrl+C to stop.
```

Abra o endereço no navegador. Os títulos dos MRs são links para o GitLab, abertos em nova guia com `rel="noopener noreferrer"`, e as mudanças detectadas a cada passagem são registradas no terminal.

**Este modo não usa o notificador do sistema.** Quem avisa na tela é o navegador, com as notificações **ligadas por padrão** (ver adiante): dois avisos para o mesmo evento seriam ruído. Por isso `--no-notify` não tem efeito aqui. Os modos 1 e 3 seguem usando o notificador do sistema normalmente.

**A primeira passagem já preenche a tabela.** Ela não compara com nada e não emite evento: serve de referência. Da segunda em diante, cada passagem compara com a anterior e as mudanças viram avisos. O mesmo vale para o painel no terminal; o relatório, por consultar uma única vez, nunca compara nem notifica.

Consultar leva alguns segundos — cada MR exige detalhes e discussões —, então a página começa mostrando **"Consultando o GitLab…"** em vez de um número. Com 15 MRs, a tabela costuma aparecer em menos de 20 segundos. "Nenhum MR aberto para este alvo." só aparece quando a consulta terminou e o alvo está mesmo vazio.

**A página se atualiza sozinha, sem recarregar.** Ela consulta o próprio monitor a cada 10 segundos e troca apenas a tabela, preservando rolagem e foco. Essa consulta é local e não gera chamada ao GitLab: quem fala com a API é o monitor, no intervalo configurado. Na prática, o que o monitor coleta aparece na tela em até 10 segundos. Se o monitor parar, a página avisa e volta a tentar.

#### O que mudou desde a consulta anterior

Quando um MR muda de uma passagem para a seguinte, a célula correspondente ganha uma marca de alteração (um pequeno círculo) **imediatamente à esquerda do conteúdo**, indicando onde está a novidade sem precisar ler o terminal. O conteúdo de cada célula fica num invólucro flex, de modo que a marca acompanha o item na mesma linha mesmo com a coluna estreita:

| Célula marcada | Significa |
| --- | --- |
| Likes | O número de reações 👍 mudou. |
| Threads | A quantidade de discussões ou o estado de resolução mudou. |
| Participantes | Alguém novo abriu thread, ou alguém deixou de constar. |
| Revisão | Mudou quem é assignee ou revisor (a célula mostra só os nomes). Mudança no estado de revisão com as mesmas pessoas não acende a marca. |
| Pipeline | A pipeline mudou de estado ou foi substituída. |

Os campos rastreados são exatamente estes cinco. Mergeável, Conflitos, Atualizado e Criado são exibidos, mas uma mudança neles não acende a marca.

Uma legenda acima da tabela explica a marca de alteração e as regras de destaque de linha que estiverem ligadas. Só as células que realmente mudaram são marcadas: um MR que só ganhou likes marca apenas a coluna de likes. A marca reflete **a última comparação**, então ela some na passagem seguinte se aquele campo parar de mudar.

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

| Chave (`sort`) | Rótulo | Critério, no sentido natural |
| --- | --- | --- |
| `recent` | Criado | Data de criação, da mais nova para a mais antiga. É o padrão. |
| `updated` | Atualizado | Última atividade, da mais recente para a mais antiga. |
| `likes` | Likes | Reações 👍, da maior para a menor. |
| `mr` | MR | Rótulo e título, em ordem alfabética. |
| `author` | Autor | Nome de quem abriu o MR. |
| `threads` | Threads | Quantidade de threads em aberto, da maior para a menor. |
| `participants` | Participantes | Nomes de quem abriu thread, em ordem alfabética. |
| `pipeline` | Pipeline | Ordem de urgência, não alfabética: `failed`, `canceled`, `manual`, `running`, `pending`, `scheduled`, `skipped`, `success` e, por último, sem pipeline. |

As chaves são em inglês e idênticas no parâmetro `sort` de `GET /data`; o painel traduz o rótulo pelo catálogo do idioma ativo.

O rótulo nomeia a **coluna**, não um sentido: o critério acima é o sentido natural, o que vale sem ninguém pedir outro. **Clicar de novo no cabeçalho inverte** (mais likes ↔ menos likes, A–Z ↔ Z–A), e aí a consulta leva `direction=asc` ou `direction=desc`; sem o parâmetro, ou com um valor que não seja esses dois, vale o natural. Trocar de coluna recomeça no natural dela, e o cabeçalho nunca fica sem ordenação — a lista que o monitor devolve está sempre ordenada por alguma coisa.

**Todo critério desempata pela data**, do mais recente para o mais antigo, **nos dois sentidos**: inverter a ordenação não vira o desempate junto. Dois MRs com o mesmo número de likes, por exemplo, aparecem na ordem em que foram abertos.

Os filtros de **Autor**, **Pipeline** e **Revisão** aceitam vários valores e podem ser combinados; dentro de cada filtro vale o **OU**. `GET /data` recebe cada um como parâmetro repetido (`author`, `pipeline`, `review`), além de `sort`, `direction` (o sentido, quando não é o natural), `likes` (limite do destaque do selo) e `since` (só eventos novos). Os valores de `review` são `assigned` (atribuídos a mim), `reviewing` (para eu revisar) e `unassigned` (sem assignee nem revisor); valor desconhecido é ignorado. MR sem pipeline usa o valor `no-pipeline`. **Limpar filtros** devolve a visão completa: zera os três filtros **e** volta a ordenação à primeira da lista, no sentido natural dela — como a ordenação faz parte do que um preset define, limpar sem ela não desfazia um preset que só muda a ordem. Escolher **Nenhum preset** no seletor faz o mesmo: é o primeiro item da lista e o que ele mostra enquanto nenhum preset corresponde ao estado atual. As opções saem dos MRs atuais, então não existe filtro que não devolva nada por falta de dados. MRs sem pipeline têm opção própria em vez de sumirem da lista. Com filtro ativo, o cabeçalho mostra `2/4`, e uma combinação sem resultado explica que nenhum MR corresponde aos filtros.

Clicar no cabeçalho de uma coluna escolhe a ordenação correspondente, a mesma do seletor da barra; clicar de novo inverte o sentido. Ordenação, sentido e filtros ficam gravados no arquivo de preferências (`filters`) e voltam na próxima abertura. Ordenação e filtros vivem só no painel web: a tabela do terminal segue sempre por data.

#### Configurações

O painel tem um menu lateral (sidebar) com **Painel** e **Configurações**, esta com as sete seções; o botão do topo o recolhe a uma trilha de ícones (ao recarregar, ele volta aberto). Abaixo de 768 px o menu vira uma gaveta aberta pelo botão da barra superior. Idioma, tema e a engrenagem ficam no topo direito do painel e das configurações. A engrenagem leva às configurações, uma página própria (o Python devolve o `index.html` para qualquer caminho sem extensão, então recarregá-la funciona). Além do alvo e do intervalo, descritos abaixo, ela traz preferências que ficam no arquivo `user-data/preferences.json` (ver [Onde ficam os seus dados](#onde-ficam-os-seus-dados)):

As configurações não têm menu lateral próprio: a navegação entre as seções é a do sidebar. Cada seção é uma rota própria: `query`, `notifications`, `display`, `columns`, `highlights`, `presets` e `data`; a raiz `/settings` redireciona para `query`.

- **Exibição:** tamanho do texto (pequeno, médio ou grande); densidade, confortável (padrão) ou compacta, que reduz o espaçamento da página inteira (o marcador de destaque da linha, o ponto de status e o alvo de toque não encolhem); a partir de quantos likes o selo ganha destaque (zero, o padrão, desliga).
- **Presets:** pacotes nomeados com filtros, ordem e colunas ocultas, regras de destaque e regras de notificação. Há três prontos (Preciso revisar, Dependem de mim e parados, Prontos para merge) e você salva os seus; aplique pelo seletor da barra ou em `/settings/presets`. Projeto e intervalo não entram. Parte inválida de um preset mantém o valor atual; só uma lista guardada vazia limpa a preferência.
- **Colunas:** escolha quais aparecem e mova cada uma para cima ou para baixo; coluna nova do monitor entra no fim.
- **Regras de destaque de linha:** pinte a linha inteira quando uma condição for verdadeira (likes, threads em aberto, pipeline, tempo parado etc.); vale a primeira regra que casa, e por isso a ordem da lista é a precedência: cada regra mostra a sua posição, as setas a movem para cima ou para baixo, e um selo diz quantos dos MRs que ela casa já são pintados por uma regra acima. Cada regra mostra a borda que a linha vai ganhar na tabela e quantos dos MRs em tela ela casa agora, e o valor é escolhido numa lista do que o GitLab devolveu nesta coleta — os pipelines, os autores e os estados de revisão existentes — em vez de digitado. A comparação só oferece o que o campo sabe comparar; campo numérico continua digitado, com a faixa observada logo abaixo — e aceita só dígitos, como todo campo de número da ferramenta (intervalo entre coletas, likes mínimos, espera entre avisos e limite de likes).
- **Regras de notificação:** o select "Quem decide o que avisar" escolhe entre o **Geral** (que tipos de mudança avisam, só os meus MRs, likes mínimos, ignorar rascunhos, silenciar autores) e os **critérios de notificação**, em que só passa o evento que casa com alguma regra. Um lado só vale por vez; o outro fica desabilitado, com um aviso dizendo por quê. O horário de silêncio e a espera entre avisos do mesmo MR ficam num bloco à parte e valem nos dois — a espera só começa depois que o aviso foi de fato entregue.
- **Dados:** onde as preferências ficam, e os botões para exportá-las e importá-las. Detalhado em [Onde ficam os seus dados](#onde-ficam-os-seus-dados).

#### Parâmetros na página de configurações

A seção de consulta lista os **seus próprios projetos e grupos** (os que o dono do token alcança): você escolhe daí os alvos a monitorar e o intervalo entre consultas. Ao clicar em **Salvar**, a escolha passa a valer imediatamente e **persiste em `user-data/preferences.json`**, de modo que o painel abre com os mesmos alvos na próxima vez:

- **O `.env` não é alterado.** Ele guarda só as credenciais; a escolha de alvos vive no arquivo de preferências.
- Os valores passam pela **mesma validação da linha de comando**: cada alvo precisa pertencer à instância do `.env` e o intervalo precisa ser um número positivo. Valor inválido aparece como aviso **na própria seção de consulta**, onde você clicou em Salvar, e **mantém os alvos anteriores** rodando. A lista tem um teto de **20 alvos**: a dica do campo diz o limite e, passando dele, a página avisa e desabilita o Salvar, em vez de esperar a recusa do monitor.
- Trocar de alvo **recomeça a referência**: a primeira passagem no projeto novo apenas fotografa o estado, sem emitir eventos, para não comparar projetos diferentes entre si.
- Salvar não espera o ciclo em andamento terminar: a consulta ao novo alvo começa na hora.

#### Consultar fora do intervalo

O botão **Verificar agora** — no fim da faixa de estado do painel, ao lado da hora da última coleta, e também na seção de notificações das configurações (ao lado de **Testar notificação**; o **Salvar** fica na seção de consulta) — força uma consulta na hora, sem esperar o intervalo terminar. Ele **não abre uma coleta paralela**: apenas adianta o ciclo do próprio painel — o mesmo mecanismo que a troca de alvo usa. Por isso não há risco de duas consultas simultâneas ao GitLab, nem de a comparação com o estado anterior se perder: a passagem adiantada compara com a anterior como qualquer outra, e as mudanças encontradas viram eventos normalmente.

Enquanto a consulta corre, o botão fica desabilitado e marcado como ocupado; ele volta ao normal quando a tabela nova chega. A página reconhece o fim pelo **carimbo da última coleta**, não por tempo estimado, então o botão libera exatamente quando há dados novos. O intervalo normal segue valendo depois — verificar agora não reinicia nem altera a contagem.

#### Notificações do navegador

A caixa **Avisar no navegador** (*Notify in browser* em inglês), em Configurações > Notificações, **vem marcada**: no modo web, as notificações são o comportamento padrão. Cada mudança detectada vira uma notificação do navegador, e desmarcar a caixa as desliga enquanto a página estiver aberta.

Como os navegadores exigem permissão explícita, o painel resolve isso sozinho conforme o estado dela:

| Permissão | O que acontece |
| --- | --- |
| Já concedida | As notificações funcionam desde o carregamento, sem pedir nada. |
| Ainda não decidida | A caixa segue marcada e a página avisa que aguarda a permissão. O pedido só pode partir de um gesto seu, então acontece no seu primeiro clique ou tecla na página. |
| Negada antes | A caixa se desmarca sozinha e a página explica que o site está bloqueado; libere a permissão no navegador para reativar. |

O aviso de permissão tem linha própria na página, separada da linha de erros, para que a atualização da tabela — que acontece a cada poucos segundos — não o apague.

**Como a notificação aparece.** É a notificação nativa do sistema, emitida pelo navegador: o título é a identificação do MR (`!216 — feat(#ANT-9433): ...`) e o corpo traz a mudança e o link, como no terminal.

**Testar sem esperar uma mudança.** O botão **Testar notificação**, ao lado da caixa, envia um aviso de exemplo imediatamente. Ele existe porque o silêncio do painel é ambíguo: pode ser que nenhum MR tenha mudado, ou que o aviso tenha saído da página e sido suprimido depois. Se o teste aparece, a página está funcionando e o silêncio é só falta de novidade; se não aparece, o bloqueio está no navegador ou no sistema, e a própria página diz onde olhar.

Enquanto a permissão estiver pendente, **os eventos não são descartados**: ficam no monitor e são avisados assim que você concede. Quando muitas mudanças chegam juntas, acima de cinco elas viram **um aviso só**, com a contagem no título e a lista dos MRs no corpo — uma pilha de banners seria pior que a informação que eles trazem.

Mudanças diferentes no mesmo MR aparecem como avisos separados; o mesmo aviso repetido substitui o anterior em vez de empilhar.

No modo web, esse é o **único** aviso de tela: o notificador do sistema fica fora, e os eventos continuam aparecendo no terminal. Se a permissão for negada, ou o navegador não oferecer a API, a caixa se desmarca sozinha e a página explica o motivo. A API exige contexto seguro, e `127.0.0.1` conta como tal — não é preciso HTTPS.

#### Organização da interface

A interface é uma aplicação **Angular** em `frontend/`, e o Python só serve os arquivos estáticos
que o `ng build` gera — ele não monta HTML. As regras de código, de estilo e de idioma do painel
estão no [`CLAUDE.md`](CLAUDE.md); o resumo é:

```text
frontend/src/
├── styles/                      # _themes (valor por tema), _tailwind-theme (nome
│   └── components/              #   semântico) e as classes .ui-* em BEM
├── assets/i18n/                 # pt.json e en.json; nenhum texto fixo no template
├── testing/                     # dublês para os testes (FakePreferencesStore)
└── app/
    ├── core/                    # catálogo de rotas da API, modelos, serviços
    ├── shared/ui/               # primitivos sem domínio (selo, cartão, campo, ícone…)
    ├── shared/monitor/          # componentes do domínio, só input()/output()
    ├── features/monitor/        # a tela da tabela, que só posiciona componentes
    └── features/settings/       # a página de configurações e suas seções
```

**O backend é o dono do que a tabela mostra.** Coluna, rótulo, tom semântico, tipo de célula e peso
de largura saem de `REPORT_COLUMNS` e `serialize_row`: uma coluna nova é uma linha no Python e nada
no frontend.

Depois de mexer no `frontend/`, rode `make front-build` e **reinicie o modo web** — o Python lê os
estáticos do disco, mas o contrato de `/data` fica na memória do processo. Para mexer na interface
sem GitLab e sem `.env`, use `make front-mock`.

O visual segue o **design system FPF Tech**, nos guias `card`, `feedback`, `button` e `input`:

- **Tokens.** Cor, espaçamento, raio, espessura de borda, altura de controle e tamanho de fonte ficam em `styles/_themes.scss` (valor por tema) e `styles/_tailwind-theme.scss` (nome semântico). Nenhuma regra de componente traz valor literal — nem hex, nem `rgba()`, nem `px`; a exceção são as condições de `@media` em `_breakpoints.scss`, que por limitação do CSS não aceitam variável. `make front-styles` e `make front-scripts` cobrem a regra e a exceção.
- **Tema claro e escuro.** Sem escolha manual, a página segue a preferência do sistema e acompanha a troca dela sem recarregar. O botão de tema, no cabeçalho, alterna entre claro e escuro e, a partir daí, deixa de seguir o sistema; para voltar ao automático, ponha `"theme": "auto"` no arquivo de preferências e importe-o. A escolha fica guardada em `user-data/preferences.json` e sobrevive ao recarregamento. O tema é resolvido antes da primeira pintura: o Python escreve a escolha no `<html>` ao servir a página e um script do `<head>` aplica a classe, para a página não piscar clara antes de escurecer. Isso só acontece pelo `make web`; no `make dev` e no `make front-mock` a página começa no automático e corrige quando as preferências chegam.
- Os tokens do tema escuro ficam em **um único bloco**, `.dark`, aplicado pela classe no `<html>`. Manter dois blocos — um por `@media`, outro por classe — faria os dois saírem de sincronia; há teste garantindo que existe só um.
- **Botões** nas variantes primária (ação de salvar) e outline (limpar filtros), com os estados obrigatórios: default, hover, active, focus-visible, disabled e loading.
- **Campos** com label associado e os estados default, focus, erro, desabilitado e somente leitura. O erro marca a borda do campo por `aria-invalid`, não apenas a mensagem.
- **Foco** sempre no token `border/focus` (`#B3C50E`), em ambos os temas — não numa cor improvisada.
- **Cards e badges** conforme os guias: card flat sem sombra pesada, badge com tom semântico por intenção.

A fonte DM Sans vem do **Google Fonts** (`index.html`), com reserva para a fonte do sistema: é a única requisição da página a um servidor externo, e sem rede a página cai na fonte do sistema.

Decisões de segurança deste modo, que valem conhecer antes de usar:

- O servidor escuta **apenas em `127.0.0.1`**, nunca em `0.0.0.0`: a página não fica acessível para outras máquinas da rede.
- **Não há autenticação**, porque não há exposição externa. Qualquer processo da sua própria máquina consegue ler a página, que contém títulos e links internos de MRs. Não use este modo em máquina compartilhada com usuários em quem você não confia.
- **O token nunca entra na página.** Ele é usado só nas chamadas à API, no servidor.
- Todo texto vindo do GitLab — títulos, nomes de usuário, estados — passa por escape antes de entrar no HTML, de modo que um título contendo HTML aparece como texto e não é interpretado pelo navegador.
- Respondem apenas a página (`/`, `/index.html` e qualquer caminho sem extensão, que devolve o mesmo `index.html` para as rotas do Angular), os arquivos do build, `GET /data` (a tabela e os eventos), `GET /projects` (os projetos e grupos que o dono do token alcança, para a seção de consulta escolher os alvos), `GET /preferences` e `POST /preferences` (as preferências do painel), `POST /settings` (os parâmetros desta execução) e `POST /refresh` (adianta o ciclo). Arquivo que não existe no build recebe `404`; o servidor só expõe o que está em `frontend/dist/`.
- `POST /settings`, `POST /refresh` e `POST /preferences` exigem corpo **JSON** e conferem o cabeçalho `Origin`. As duas exigências juntas impedem que outra página aberta no seu navegador troque o alvo do painel, sobrescreva as suas preferências ou dispare consultas ao GitLab em seu nome, sem você saber: um formulário comum de outro site não consegue enviar JSON, e nenhum cabeçalho de CORS é devolvido.

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
| `make test` | Executa a suíte de testes Python, offline. |

Os alvos do frontend exigem Node.js e npm; os que precisam de `frontend/node_modules` rodam `make front-install` sozinhos quando a pasta falta:

| Comando | Faz |
| --- | --- |
| `make front-install` | Instala as dependências do frontend. |
| `make front-build` | Gera o build que o `make web` serve, em `frontend/dist/gitlab-monitor/browser/`. |
| `make dev` | Monitor real em `:8766` (`API_PORT`) e `ng serve` em `:4300` (`SERVE_PORT`), com recarga ao salvar; não usa o build. |
| `make front-serve` | Só o `ng serve`, apontado para um monitor já no ar em `MONITOR_API` (padrão: o `make web`, em `PORT`). |
| `make front-mock` | Interface contra o mock (`:4290`, mock em `:8791`), sem GitLab e sem `.env`. |
| `make front-test` | Testes unitários do frontend (Vitest). |
| `make front-lint` | ESLint em TypeScript e templates. |
| `make front-styles` | Gates do Design System: nenhum valor fixo, nenhum controle redesenhado. |
| `make front-scripts` | Testes dos scripts: tokens, catálogo de rotas, contrato do mock, constantes do backend, motor de regras (Python contra TypeScript) e ausência de armazenamento do navegador. |
| `make front-e2e` | Jornadas Playwright contra o mock, em 1280 e 375 px (`:4280`, mock em `:8792`). |
| `make front-format` | Reformata o frontend com Prettier (`npm run format`). **Altera arquivos.** |
| `make check` | Validação completa: `test`, `front-lint`, `front-styles`, `front-scripts`, `front-test`, `front-build` e `front-e2e`. |

O `.pre-commit-config.yaml` roda lint, gates e testes Python no commit e o `make check` no push; instale com `pre-commit install` e `pre-commit install --hook-type pre-push`.

As variáveis `PROJECT`, `INTERVAL`, `KEEP_HISTORY` e `PORT` do `make` viram os argumentos do monitor (nenhuma é lida do `.env`); `SERVE_PORT`, `API_PORT` e `MONITOR_API` mudam as portas do `make dev` e do `make front-serve` — `MONITOR_API` vale `http://127.0.0.1:$(PORT)` por padrão, e o `make dev` o troca pela `API_PORT` do monitor que ele mesmo sobe:

```bash
make monitor PROJECT=grupo/projeto INTERVAL=5 KEEP_HISTORY=true
make report PROJECT=grupo/outro-projeto
make web PORT=9000 INTERVAL=2
```

`PROJECT` só é obrigatório em `make monitor`, `make report`, `make panel` e `make once` quando **não há alvos guardados** em `user-data/preferences.json`: havendo, os modos de terminal os usam, e `PROJECT`, se informado, vence o arquivo, como em `make web` e `make dev`. O `make` não repassa as flags novas (`--sort`, `--color`, `--no-prefs` e as demais); para elas, chame `python3 gitlab_monitor.py` diretamente. `INTERVAL` omitido vale `15` nos modos de terminal e o do arquivo no painel web. Como os alvos passam `--mode` explicitamente, nenhum deles faz a pergunta de modo.

Usar o `make` é opcional: todos os comandos continuam disponíveis chamando `python3 gitlab_monitor.py` diretamente, sem `.venv`.

## Opções disponíveis

| Argumento/opção | Comportamento |
| --- | --- |
| `project` | Projeto ou grupo, aceito como URL, caminho `grupo/projeto`, `groups/caminho/do/grupo` ou ID numérico. Nos modos de terminal é obrigatório só quando nem `--project` nem os alvos guardados em `user-data/preferences.json` existem (ou com `--no-prefs`), exceto com `--test-notify` ou `--help`. No modo web é opcional: informado, vence os alvos guardados. |
| `--project ALVO` | Alvo adicional, repetível, no mesmo formato do posicional. |
| `--sort`, `--direction`, `--author`, `--pipeline`, `--review` | Ordenação e filtros da tabela nos modos de terminal; ver [O terminal e as suas preferências](#o-terminal-e-as-suas-preferências). |
| `--language pt\|en` | Idioma dos textos do terminal. |
| `--color`, `--no-color` | Força ou desliga a cor da tabela; por padrão, só num terminal e sem `NO_COLOR`. |
| `--no-prefs` | Ignora `user-data/preferences.json` nos modos de terminal. |
| `--mode monitorar\|relatorio\|painel\|web` | Escolhe o modo sem perguntar. Sem a opção, o terminal pergunta; sem terminal interativo, vale `monitorar`. |
| `--port PORTA` | Porta do modo web em `127.0.0.1`; padrão `8765`. Ignorada nos demais modos. |
| `--interval MINUTOS` | Intervalo positivo e finito entre consultas. Sem a opção, `15` nos modos de terminal e o intervalo guardado em `user-data/preferences.json` no modo web. Nos painéis, é o tempo entre atualizações; ignorado no modo relatório. |
| `--once` | Só no monitoramento: consulta uma vez e encerra. Se houver histórico, compara com ele. |
| `--no-notify` | Mantém os logs e desativa notificações nativas durante as consultas. Sem efeito nos modos relatório e web, que não usam o notificador do sistema. |
| `--keep-history true` | Só no monitoramento: preserva o snapshot ao encerrar, para retomar a comparação. |
| `--keep-history false` | Apaga o snapshot ao encerrar; padrão. Também apaga um snapshot reaproveitado de execução anterior. |
| `--test-notify` | Testa somente o notificador, sem projeto, credenciais ou API. |
| `--help` | Exibe a ajuda. |

`--keep-history` recebe um valor explícito `true` ou `false`, sem distinção de maiúsculas. O modo `--test-notify` é independente das opções de monitoramento: use-o sozinho.

## Fluxo de funcionamento

Os modos relatório e painéis fazem a mesma passagem: leem as credenciais do `.env`, resolvem o alvo, consultam os MRs abertos numa única requisição GraphQL (pipeline, threads e likes próprios já embutidos) e montam a tabela. O relatório imprime uma vez e encerra; os painéis repetem a passagem a cada intervalo, um redesenhando o terminal e o outro atualizando a página servida em `127.0.0.1`. Nenhum deles usa lock ou histórico. O monitoramento segue o ciclo abaixo.

1. Valida os argumentos, resolve o alvo e o intervalo (posicional e `--interval` na linha de comando; no modo web, o que está em `user-data/preferences.json` quando não vêm na execução), define o modo (`--mode`, pergunta no terminal ou monitoramento), lê as credenciais e normaliza a URL da API e o alvo.
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
| Revisão | Só se você passou a ser (ou deixou de ser) assignee ou revisor, não o estado de revisão de ninguém: o pedido de revisão a você foi feito ("revisão pedida a você") ou retirado ("você não é mais revisora deste MR"); no modo web, `REVIEW REQUESTED FROM YOU` e `NO LONGER ASSIGNED TO YOU FOR REVIEW`. Snapshot anterior que não conhecia o campo não gera aviso. |
| Quantidade de discussões | Mudança no total de discussões. |
| Discussão resolvida/reaberta | Mudança do estado de resolução em uma discussão já conhecida. |
| Nova resposta | Aumento no número de notas em uma discussão já conhecida. |

### Formato dos eventos

Cada bloco começa pela identificação do MR, traz **uma linha por mudança** e termina no link. Duas mudanças no mesmo MR, na mesma passagem, dividem um bloco só — não repetem o cabeçalho. No terminal, as linhas seguintes recuam para não se confundirem com um novo registro, e o texto da mudança sai no idioma do terminal (`--language`, ou o do painel).

```text
[2026-10-20 10:17:51 -03] !201 — feat(#ANT-8947): envio de documentos pelo candidato
  pipeline #265275 running → #265275 success
  likes 1 → 2
  https://gitlab.fpf.br/flake/siga/poc-sdd-backend/-/merge_requests/201
```

No modo web o mesmo evento segue em inglês e em maiúsculas (`PIPELINE #265275 running → #265275 success`): esse texto é o que o painel recebe em `/data` e não muda de idioma — ver [O terminal e as suas preferências](#o-terminal-e-as-suas-preferências).

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

## Onde ficam os seus dados

### O que é guardado

As **treze preferências** do painel, num único arquivo. A coluna da esquerda é o nome da chave dentro do arquivo:

| Chave | O que é | Onde se muda na tela |
| --- | --- | --- |
| `theme` | Tema: `auto`, `light` ou `dark` | Botão de tema, no cabeçalho (`auto` só pelo arquivo) |
| `language` | Idioma: `pt` ou `en` | Seletor de idioma, no cabeçalho |
| `textSize` | Tamanho do texto: `sm`, `md` ou `lg` | Configurações > Exibição |
| `density` | Densidade: `comfortable` ou `compact` | Configurações > Exibição |
| `likesHighlight` | A partir de quantos likes o selo é destacado | Configurações > Exibição |
| `hiddenColumns` | Colunas que não aparecem | Configurações > Colunas da tabela |
| `columnOrder` | Ordem das colunas | Configurações > Colunas da tabela |
| `filters` | Ordenação e filtros da tabela | Barra de filtros, acima da tabela |
| `rowRules` | Regras de destaque de linha | Configurações > Destaques de linha |
| `notifyRules` | Regras de notificação | Configurações > Notificações |
| `presets` | Os presets que você salvou | Configurações > Presets |
| `monitoredProjects` | Os projetos e grupos monitorados | Configurações > Consulta |
| `interval` | Intervalo entre consultas, em minutos | Configurações > Consulta |

**O que não é guardado ali:** o token do GitLab (só no `.env`) e o histórico de MRs (`gitlab-history/`).

### Onde

Em `gitlab-monitor/user-data/preferences.json`, ao lado de `gitlab-history/`. O arquivo é criado no primeiro ajuste que você faz. A pasta `user-data/` é ignorada pelo git: não entra em commit, e o `git clean` só a apaga com `-x`.

```json
{
  "version": 1,
  "preferences": {
    "theme": "dark",
    "density": "compact"
  }
}
```

Chave ausente significa o padrão. O monitor descarta chave desconhecida, e `theme`, `language`, `textSize` e `density` só aceitam os valores da tabela acima — o Python escreve esses quatro no HTML da página, então não confia em outro valor. O conteúdo das demais chaves é validado pelo painel, que usa o padrão para o que não entender.

### Quando

O painel grava a cada mudança, e quem escreve o arquivo é o monitor em modo web (`make web`); a gravação é atômica, então uma queda no meio dela não deixa o arquivo pela metade. Duas abas abertas ao mesmo tempo escrevem no mesmo arquivo, e a última gravação vence.

**Só o modo web grava as suas escolhas**, mas o arquivo não é só dele: os modos de terminal o **leem** para mostrar a tabela e avisar como o painel foi configurado (ver [O terminal e as suas preferências](#o-terminal-e-as-suas-preferências)), e `--no-prefs` é o que os faz ignorá-lo. A única escrita que o terminal faz é a de defesa — renomear um arquivo ilegível ou de `version` desconhecida para `preferences.corrupt-AAAAMMDD-HHMMSS.json`, descrita em [Se der errado](#se-der-errado).

### Exportar

**Configurações > Dados > Exportar** baixa `gitlab-monitor-preferences-AAAA-MM-DD.json` para a pasta de downloads do navegador. O export traz as preferências e o nome da ferramenta; nunca o token. Se o painel não conseguiu ler as preferências ao abrir, o botão fica desabilitado, com um aviso: exportar agora baixaria só os padrões, e não o seu arquivo.

### Importar

**Configurações > Dados > Importar** aceita um arquivo exportado por esta tela **ou** um `preferences.json` copiado de outra instalação. O painel mostra o que o arquivo traz e pede confirmação; ao confirmar, **substitui todas** as preferências atuais e recarrega a página. O limite é de 256 KiB (262144 bytes), e um arquivo que não serve — que não é JSON, não é desta ferramenta, tem outra `version` ou não traz `preferences` — é recusado com uma mensagem, sem mudar nada. Se a substituição falhar, a tela mostra o erro e não recarrega.

Sem a tela: com o monitor parado, copie o arquivo para `user-data/preferences.json` e inicie o `make web`.

### Levar para outra máquina

Duas formas: exporte na tela e importe na outra, ou copie o `preferences.json` para o `user-data/` da outra instalação, com o monitor parado.

### Se der errado

- **Arquivo ilegível** (JSON quebrado ou texto que não é UTF-8) **ou de `version` desconhecida**: o monitor não o sobrescreve. Renomeia para `user-data/preferences.corrupt-AAAAMMDD-HHMMSS.json` (com `-1`, `-2`... se o nome já existir), diz o novo nome no terminal e o painel abre com o padrão. Para recuperar: se o JSON estava quebrado, corrija-o no arquivo renomeado e importe-o em Configurações > Dados. Se era uma `version` desconhecida, o arquivo veio de outra versão do monitor: abra-o com essa versão ou, por sua conta e risco, troque `version` para `1` à mão e importe. O importador recusa qualquer `version` diferente de 1 (`unsupported-version`), mesmo com JSON válido.
- **Painel não consegue ler as preferências ao abrir** (com `make dev` ou `ng serve`, o painel abre mesmo com o monitor fora do ar; com `make web` parado a página nem abre): o painel abre com o padrão, as mudanças valem só até recarregar, nada é gravado — o arquivo existente não é substituído por padrões — e um aviso no topo da página diz isso.
- **Gravação recusada** (disco cheio, sem permissão): o mesmo aviso aparece, e a mudança vale até recarregar a página.

### Desenvolvimento

`make dev` usa o monitor real em `:8766`, então grava no mesmo `user-data/`. `make front-mock` guarda as preferências em memória e as perde ao reiniciar. Nos dois, o `ng serve` não passa pelo Python, então o tema não é escrito no HTML e pode piscar na abertura.

## Histórico e segurança

`gitlab-history/<chave>.json` contém a versão do formato (`3`), a data da última consulta e os snapshots dos MRs **aninhados por alvo**: título, URL, likes, pipeline e resumo das discussões. O token não é salvo. Arquivos `.lock` podem permanecer vazios ou conter um byte; a existência do arquivo não indica que o lock está ativo.

A chave depende da instância e dos alvos (ordenados, para a ordem em que você os escreveu não mudar o nome do arquivo), não do token. Ao trocar a credencial, o histórico dos mesmos alvos pode ser reaproveitado. Para descartar uma referência, encerre primeiro o monitor correspondente e mova o JSON daquele alvo para fora de `gitlab-history/`. Não remova arquivos de lock enquanto houver um monitor ativo.

Se o formato do snapshot for incompatível ou o arquivo estiver inválido, preserve-o fora da pasta de histórico antes de iniciar uma nova referência. O script não tenta migrar automaticamente formatos antigos.

> **Atualizando de uma versão anterior ao histórico `3`:** o nome do arquivo **não muda** quando há um alvo só, então o `gitlab-history/<chave>.json` que você já tem é encontrado e **recusado** na primeira execução do modo `monitorar` — o monitor não inicia e explica, no terminal, que o arquivo foi mantido. Mova-o para fora da pasta (ou apague-o) e rode de novo: o ciclo seguinte grava a referência inicial, sem avisos, e a comparação recomeça dali. Nada é sobrescrito, e nenhum evento antigo é reemitido. A migração automática não existe de propósito: adivinhar a que alvo pertence cada MR de um formato plano é mais arriscado do que recomeçar a referência.

Encerramentos forçados podem deixar um snapshot mesmo sem `--keep-history true`.

O token é enviado somente no header `PRIVATE-TOKEN`, por HTTPS, e redirecionamentos são recusados — tanto na REST (`/api/v4`) quanto na GraphQL (`/api/graphql`, um nível acima), já que as duas falam com o mesmo opener e o mesmo header. Os snapshots podem conter nomes e links internos: mantenha-os locais e fora do versionamento. O modo web serve a página apenas em `127.0.0.1`, sem autenticação e sem o token na página; veja as ressalvas na seção do modo 4.

## Solução de problemas

| Sintoma | O que conferir |
| --- | --- |
| Python não encontrado | Instalação e comando: `python3` no macOS/Ubuntu; `py -3` ou `python` no Windows. |
| Falha ao iniciar | `.env` ao lado do script, `GITLAB_API_URL` e `GITLAB_TOKEN` preenchidas, HTTPS, acesso de escrita ao histórico, snapshot válido e outro monitor do mesmo alvo. |
| HTTP `401` | Token inválido, expirado ou com prefixo indevido. |
| HTTP `403` ou `404` | Escopo, acesso ao recurso, caminho/ID e permissões da conta. Recursos privados também podem retornar `404`. Para grupo, confira se o alvo começa com `groups/`: um caminho de grupo sem esse prefixo é lido como projeto e o GitLab responde `404`. |
| Falha de conexão | Rede, VPN, DNS e certificado HTTPS confiável para o Python instalado. |
| Alvo ou intervalo inesperado | No terminal, vale o que foi passado na linha executada. No modo web, valem os alvos de `user-data/preferences.json`, a menos que a linha traga o posicional ou `--interval`. Um `PROJECT=`/`INTERVAL=` esquecido no `.env` é ignorado. Confira a linha executada e o log `Monitorando ... a cada N minuto(s)`. |
| Modo web responde `404` | Falta o build da interface: rode `make front-build` (ou use `make web`, que o gera quando falta). |
| Modo web não abre | Porta já em uso: escolha outra com `--port` ou `make web PORT=9000`. O endereço é sempre `127.0.0.1`, não acessível de outra máquina. |
| Página do painel parada | Ela avisa na própria tela quando não alcança o monitor. Confira se o processo continua rodando no terminal. |
| Painel sem tabela logo ao abrir | É a primeira consulta, que leva alguns segundos; a página mostra "Consultando o GitLab…" até terminar. |
| Notificação do navegador não aparece | Clique em **Testar notificação** no formulário: ele envia um aviso na hora, sem esperar que algum MR mude, e separa as duas causas possíveis. Se o teste aparece e o painel segue calado, é porque nada mudou — o painel só avisa quando algo muda, e nunca na primeira passagem, que serve de referência. Depois, a caixa marcada e a permissão: se estiver pendente, clique na página para confirmá-la; se foi negada, a página explica. Por fim, confira se o próprio navegador pode notificar no sistema (no macOS, Ajustes do Sistema › Notificações) e se o Não perturbe está desligado. |
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

Os testes não leem credenciais reais nem consultam o GitLab. Cobrem comparação de MRs, paginação da consulta GraphQL, resolução de ID numérico de projeto para a GraphQL, `.env` próprio do monitor (só credenciais), origem do alvo e do intervalo em cada modo (posicional obrigatório no terminal, preferências no modo web), escrita atômica, escolha de modo, montagem e alinhamento da tabela, destaque de likes, marca do like próprio, lista de quem curtiu, colunas de mesclável/conflitos, coluna de data, ordenações e filtros do painel, notificação dos painéis sem histórico nem lock, rotas do painel web e o build servido, validação e recusa de origem no `POST /settings`, no `POST /refresh` e no `POST /preferences`, leitura, gravação e quarentena do arquivo de preferências, preservação do `.env` ao salvar parâmetros, entrega incremental de eventos, argumentos dos notificadores, conteúdo Unicode, falhas e continuidade do monitor. Os módulos separados têm arquivo próprio: `test_monitor_rules.py` cobre o motor de destaque e de aviso (comparações, ordem das regras, horário de silêncio, espera por MR), `test_monitor_table.py` a tabela do terminal (largura, cor, marcador de linha e resumo, com os tons derivados de `RULE_TONES` em vez de fixados à mão) e `test_monitor_text.py` o catálogo pt/en. Os testes do servidor sobem portas efêmeras em `127.0.0.1`; os que dependem do build da interface são pulados quando ele não existe.

A interface tem as próprias suítes — testes unitários, lint, gates do Design System, testes dos scripts e jornadas Playwright —, descritas em [Atalhos com `make`](#atalhos-com-make). `make check` roda todas, incluindo a suíte Python.

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
- **Vários alvos por processo:** os modos de terminal aceitam o posicional mais `--project` repetido (até 20) ou os alvos guardados nas preferências, e o painel web, os escolhidos na página. MRs em um grupo são distinguidos pelo par projeto/ID local.
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
git add .gitignore .env.example .pre-commit-config.yaml Makefile README.md CLAUDE.md AGENTS.md docs gitlab_monitor.py monitor_rules.py monitor_table.py monitor_text.py tests frontend
```

Depois revise o conteúdo preparado e crie seu commit conforme as regras de versionamento adotadas. Não use `git add -f .env`. O remoto `origin` já aponta para `https://github.com/LumaGabriela/gitlab-monitor.git`: publique com `git push` na branch escolhida, lembrando que é de lá que os outros clones vão receber a mudança.
