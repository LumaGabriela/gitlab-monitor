# 0004 — `/settings` é lazy; o painel, não

**Data:** 2026-11-18 · **Situação:** aceita

## Contexto

Todas as 9 telas (painel, casca das configurações e 7 seções) entravam no bundle inicial. O
documento de boas práticas pede `loadComponent` em toda rota de feature; o budget `initial` estava
em 2 MB, frouxo demais para que o crescimento aparecesse.

## Decisão

**O painel (`''`) continua eager.** É a tela de entrada: carregá-la sob demanda só adicionaria uma
ida ao servidor antes do primeiro pixel, para economizar um código que vai ser usado em seguida de
qualquer jeito.

**A casca de `/settings` e as 7 seções são `loadComponent`.** São telas que a maioria das sessões
nunca abre — a ferramenta serve para olhar a tabela — e que trazem junto o editor de regras de
destaque, o leitor de arquivo da importação e o `app-modal`.

Com isso vale a regra do documento sobre barrel: **nunca importe por `index.ts` um componente
usado em `loadComponent`**, porque o bundler trata o barrel como um módulo só e o código volta para
o bundle inicial. Aqui não há barrel nenhum (§3), então a armadilha não existe — mas é o motivo de
não haver.

Medido: o bundle inicial caiu de **710,70 kB para 684,50 kB** (de 135,59 kB para 133,05 kB
transferidos), e 38 kB saíram para 10 chunks sob demanda — o maior é o de `highlights` (8,63 kB).
A queda é modesta porque o peso do inicial é o Angular, o CDK e os ícones, compartilhados por
todas as telas; o que muda daqui para frente é que **tela nova de configuração não engorda mais a
entrada**.

## Consequência

- Abrir as configurações pela primeira vez pede um chunk ao servidor. Como o monitor é servido do
  próprio `localhost`, o atraso é desprezível; num servidor remoto, seria um piscar.
- O budget `initial` foi apertado para a medida real, e não para um teto simbólico: crescimento
  acidental agora reprova o build.
- As jornadas cobrem a navegação até cada seção, então um chunk que não carregue reprova em
  `make front-e2e`, não em produção.
- **O roteador só troca a URL depois que o chunk chega**, e no `ng serve` ele ainda é compilado sob
  demanda. Com a suíte em paralelo e a máquina ocupada, o orçamento padrão de 5 s do `expect`
  passou a medir a máquina em vez da tela, e jornadas que entram numa seção falhavam sem nada de
  errado no app. Por isso o `playwright.config.ts` declara `expect: { timeout: 15_000 }`.

## Gatilho de revisão

O painel deixar de ser a tela de entrada, ou as configurações passarem a ser abertas no fluxo
normal de uso (hoje não são).
