# 0005 — Identificadores em inglês, comentários e textos em pt-BR

**Data:** 2026-11-18 · **Situação:** aceita

## Contexto

Nenhuma regra escrita dizia em que idioma nomear uma variável, e o código divergia **de si mesmo**.
Dois componentes irmãos, com a mesma função:

| `select.component.ts` | `multi-select.component.ts` |
| --- | --- |
| `alternar()` | `toggleOpen()` |
| `fechar()` | `close()` |
| `buscar()` | `onSearch()` |
| `escolher()` | `toggle()` |

Fora isso, locais soltos em pt-BR: `const alvo`, `const chave`, `const opcao`, `let primeira`.

## Decisão

**Identificador em inglês. Comentário, nome de teste, chave de catálogo e texto de tela em pt-BR.**

O inglês nos identificadores não é preferência estética: tudo em volta já está nele — `signal`,
`computed`, `input`, `track`, `HighlightRule`, `RowFactsModel`, `cellText`, `columnLabel`,
`firstMatch` — e misturar os dois idiomas dentro da mesma expressão (`const alvo =
this.targets()[0]`) obriga quem lê a trocar de idioma no meio de uma linha.

O pt-BR fica onde ele é o conteúdo, e não o código: comentários (que explicam decisões a quem
mantém), `describe`/`it` (que descrevem comportamento), e os catálogos.

**Os `id` dos `<section>` das configurações continuam em português** (`consulta`, `notificacoes`,
`exibicao`, `colunas`, `destaques`, `predefinicoes`, `dados`): são contrato com as jornadas, e
trocá-los quebraria os e2e sem entregar nada. O §3 já avisa para não os "consertar".

## Consequência

- O `select.component.ts` foi renomeado inteiro (`aberto` → `open`, `termo` → `term`, `gatilho`
  → `trigger`, `alternar` → `toggleOpen`, `fechar` → `close`, `buscar` → `updateTerm`, `escolher`
  → `choose`, e assim por diante), e com ele os dois handlers com prefixo "on" do
  `multi-select` (`onSearch` → `updateTerm`, `onFocusOut` → `closeOnFocusOut`), que violavam a
  outra regra: handler tem o nome do que faz. Tudo era `protected` e usado só no template inline,
  então nada fora do arquivo mudou.
- Os locais soltos que sobraram (`const alvo` no `tooltip`, `const chave` no `cell-text`) ficam
  para quando o arquivo for tocado por outro motivo: rename em massa suja o histórico sem corrigir
  defeito.
- Nenhuma ferramenta impõe isso — é revisão, e está na linha "só a revisão" da tabela do §4.

## Gatilho de revisão

Nenhum. É convenção, não escolha técnica; o que importa é que seja uma só.
