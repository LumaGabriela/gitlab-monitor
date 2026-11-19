PYTHON := .venv/bin/python
SCRIPT := gitlab_monitor.py

# Vazios de propósito: o que não for informado aqui vem do .env.
PROJECT ?=
INTERVAL ?=
KEEP_HISTORY ?= false
PORT ?= 8765

# Portas do modo de desenvolvimento (make dev). Separadas de propósito: a
# 8765 pode ter um `make web` aberto, a 4200 costuma ter outro projeto, e a
# 4280/8792 são das jornadas do Playwright, que reaproveitam servidor já no ar
# e passariam a testar contra o GitLab de verdade.
SERVE_PORT ?= 4300
API_PORT ?= 8766

# Para onde o ng serve encaminha /data, /settings, /refresh e /preferences.
MONITOR_API ?= http://127.0.0.1:$(API_PORT)

# Protege valores com espaços e aspas simples ao chegarem no shell.
quote = '$(subst ','"'"',$(1))'

# Todo alvo é uma tarefa, nunca um arquivo.
.PHONY: $(shell grep -hoE '^[a-zA-Z0-9_-]+:' $(MAKEFILE_LIST) | tr -d ':')

# O .venv é pré-requisito de tudo que executa o script.
define require_venv
@test -x $(PYTHON) || { \
	echo 'Ambiente virtual ausente em .venv/. Rode: make venv' >&2; \
	exit 1; \
}
endef

help: ## Mostra os comandos disponíveis
	@echo "Comandos do gitlab-monitor:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Variáveis: PROJECT, INTERVAL (minutos), KEEP_HISTORY (true|false), PORT (modo web),"
	@echo "SERVE_PORT e API_PORT (make dev), MONITOR_API (make front-serve)."
	@echo "PROJECT é obrigatório em monitor, report, panel e once; o painel web (web, dev) usa os alvos guardados nas preferências."

venv: ## Cria o .venv exigido pelos demais alvos
	python3 -m venv .venv
	@echo 'Pronto. O monitor usa apenas a biblioteca padrão: não há pacotes a instalar.'

monitor: ## Monitoramento contínuo até Ctrl+C
	$(require_venv)
	@$(PYTHON) $(SCRIPT) --mode monitorar \
		$(if $(strip $(PROJECT)),$(call quote,$(PROJECT))) \
		$(if $(strip $(INTERVAL)),--interval $(call quote,$(INTERVAL))) \
		--keep-history $(call quote,$(KEEP_HISTORY))

report: ## Relatório atual: consulta uma vez e imprime a tabela dos MRs abertos
	$(require_venv)
	@$(PYTHON) $(SCRIPT) --mode relatorio \
		$(if $(strip $(PROJECT)),$(call quote,$(PROJECT)))

panel: ## Painel no terminal: a tabela do relatório, atualizada a cada intervalo
	$(require_venv)
	@$(PYTHON) $(SCRIPT) --mode painel \
		$(if $(strip $(PROJECT)),$(call quote,$(PROJECT))) \
		$(if $(strip $(INTERVAL)),--interval $(call quote,$(INTERVAL)))

web: ## Painel no navegador em http://127.0.0.1:PORT (padrão 8765); builda o frontend se faltar
	$(require_venv)
	@test -f frontend/dist/gitlab-monitor/browser/index.html || $(MAKE) front-build
	@$(PYTHON) $(SCRIPT) --mode web --port $(call quote,$(PORT)) \
		$(if $(strip $(PROJECT)),$(call quote,$(PROJECT))) \
		$(if $(strip $(INTERVAL)),--interval $(call quote,$(INTERVAL)))

once: ## Uma consulta de monitoramento e encerra, comparando com a referência
	$(require_venv)
	@$(PYTHON) $(SCRIPT) --mode monitorar --once \
		$(if $(strip $(PROJECT)),$(call quote,$(PROJECT))) \
		--keep-history $(call quote,$(KEEP_HISTORY))

test-notify: ## Testa só a notificação do sistema, sem .env e sem API
	$(require_venv)
	@$(PYTHON) $(SCRIPT) --test-notify

test: ## Executa a suíte de testes offline
	$(require_venv)
	@$(PYTHON) -B -m unittest discover -s tests

front-install: ## Instala as dependências do frontend Angular (frontend/node_modules)
	@cd frontend && npm install

front-build: ## Builda o frontend Angular; make web serve o resultado (frontend/dist/gitlab-monitor/browser/)
	@test -d frontend/node_modules || $(MAKE) front-install
	@cd frontend && npm run build

front-test: ## Executa a suíte de testes do frontend Angular
	@test -d frontend/node_modules || $(MAKE) front-install
	@cd frontend && npm test -- --watch=false

dev: ## Monitor real + ng serve, com recarga ao salvar; não usa o build
	$(require_venv)
	@test -d frontend/node_modules || $(MAKE) front-install
	@echo "Monitor em $(MONITOR_API); interface em http://localhost:$(SERVE_PORT)"
	@$(PYTHON) $(SCRIPT) --mode web --port $(call quote,$(API_PORT)) \
		$(if $(strip $(PROJECT)),$(call quote,$(PROJECT))) \
		$(if $(strip $(INTERVAL)),--interval $(call quote,$(INTERVAL))) & \
	monitor=$$!; \
	trap 'kill $$monitor 2>/dev/null' EXIT INT TERM; \
	cd frontend && MONITOR_API=$(call quote,$(MONITOR_API)) \
		npx ng serve --port $(call quote,$(SERVE_PORT))

front-serve: ## Só o ng serve, apontado para um monitor já no ar (MONITOR_API)
	@test -d frontend/node_modules || $(MAKE) front-install
	@cd frontend && MONITOR_API=$(call quote,$(MONITOR_API)) \
		npx ng serve --port $(call quote,$(SERVE_PORT))

front-lint: ## Verifica o frontend com ESLint (TypeScript e templates)
	@test -d frontend/node_modules || $(MAKE) front-install
	@cd frontend && npm run lint

front-styles: ## Gates do Design System: nenhum valor fixo, nenhum controle redesenhado
	@test -d frontend/node_modules || $(MAKE) front-install
	@cd frontend && npm run check:styles

front-scripts: ## Testes dos scripts do frontend: tokens, rotas, contrato do mock, sem storage
	@cd frontend && npm run test:scripts

front-e2e: ## Jornadas no navegador contra o mock, em 1280 e 375 px
	@test -d frontend/node_modules || $(MAKE) front-install
	@cd frontend && npm run e2e

front-mock: ## Interface apontada para o mock, sem GitLab e sem .env
	@test -d frontend/node_modules || $(MAKE) front-install
	@cd frontend && npm run dev:mock

front-format: ## Reformata o frontend com Prettier; ALTERA ARQUIVOS
	@test -d frontend/node_modules || $(MAKE) front-install
	@cd frontend && npx prettier --write "src/**/*.{ts,html,scss,json}" "e2e/**/*.ts" "mock/**/*.mjs" "scripts/**/*.mjs"

check: ## Validação completa: Python, lint, gates, testes e jornadas
	@$(MAKE) test
	@$(MAKE) front-lint
	@$(MAKE) front-styles
	@$(MAKE) front-scripts
	@$(MAKE) front-test
	@$(MAKE) front-build
	@$(MAKE) front-e2e
