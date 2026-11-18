# Interface do gitlab-monitor

Aplicação Angular do painel no navegador. O Python (`../gitlab_monitor.py`) serve o build desta pasta
e responde às rotas `/data`, `/settings`, `/refresh` e `/preferences`. O guia de uso está no
[`README.md`](../README.md) da raiz, e as regras de código no [`CLAUDE.md`](../CLAUDE.md).

Rode os comandos pela raiz, com o `Makefile`:

| Comando              | Faz                                                                      |
| -------------------- | ------------------------------------------------------------------------ |
| `make front-install` | Instala as dependências (`node_modules/`).                               |
| `make front-build`   | Gera o build em `dist/gitlab-monitor/browser/`, servido pelo `make web`. |
| `make dev`           | Monitor real em `:8766` e `ng serve` em `:4300`, com recarga ao salvar.  |
| `make front-serve`   | Só o `ng serve`, apontado para o monitor em `MONITOR_API`.               |
| `make front-mock`    | Interface contra o mock (`mock/`), em `:4290`, sem GitLab e sem `.env`.  |
| `make front-test`    | Testes unitários (Vitest).                                               |
| `make front-lint`    | ESLint.                                                                  |
| `make front-styles`  | Gates do Design System.                                                  |
| `make front-scripts` | Testes dos scripts em `scripts/`.                                        |
| `make front-e2e`     | Jornadas Playwright em `e2e/`, contra o mock, em 1280 e 375 px.          |
| `make check`         | Toda a validação, Python incluído.                                       |

O `ng serve` sozinho, sem `MONITOR_API`, encaminha as rotas da API para `http://127.0.0.1:8765`
(`proxy.conf.mjs`); sem um monitor ali, a tela não recebe dados.
