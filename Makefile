PYTHON := .venv/bin/python
SCRIPT := gitlab_monitor.py

# Vazios de propósito: o que não for informado aqui vem do .env. KEEP_HISTORY
# vazio é o default do próprio script (false, histórico apagado ao sair).
PROJECT ?=
INTERVAL ?=
KEEP_HISTORY ?=
PORT ?= 8765

# Portas do modo de desenvolvimento (make dev). Separadas de propósito: a
# 8765 pode ter um `make web` aberto, a 4200 costuma ter outro projeto, e a
# 4280/8792 são das jornadas do Playwright, que reaproveitam servidor já no ar
# e passariam a testar contra o GitLab de verdade.
SERVE_PORT ?= 4300
API_PORT ?= 8766

# Para onde o ng serve encaminha /data, /settings, /refresh e /preferences.
# O padrão é o monitor do `make web` (PORT), que é o alvo do `make front-serve`;
# o `make dev`, que sobe o próprio monitor, o troca pela API_PORT logo abaixo.
MONITOR_API ?= http://127.0.0.1:$(PORT)

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

# O mesmo para o frontend: nenhum alvo de `frontend/` roda sem as dependências.
define require_node_modules
@test -d frontend/node_modules || $(MAKE) front-install
endef

help: ## Mostra os comandos disponíveis
	@echo "Comandos do gitlab-monitor:"
	@grep -E '^[a-zA-Z0-9_-]+:.*?## .*$$' $(MAKEFILE_LIST) | sort | \
		awk 'BEGIN {FS = ":.*?## "}; {printf "\033[36m%-14s\033[0m %s\n", $$1, $$2}'
	@echo ""
	@echo "Variáveis: PROJECT, INTERVAL (minutos), KEEP_HISTORY (true|false), PORT (modo web),"
	@echo "SERVE_PORT e API_PORT (make dev), MONITOR_API (make front-serve; padrão: PORT)."
	@echo "PROJECT só é obrigatório em monitor, report, panel e once quando não há alvos guardados nas preferências; havendo, vale o do arquivo, e PROJECT o substitui. No painel web (web, dev) os guardados são o padrão, e PROJECT também os substitui."

venv: ## Cria o .venv exigido pelos demais alvos
	python3 -m venv .venv
	@echo 'Pronto. O monitor usa apenas a biblioteca padrão: não há pacotes a instalar.'

monitor: ## Monitoramento contínuo até Ctrl+C
	$(require_venv)
	@$(PYTHON) $(SCRIPT) --mode monitorar \
		$(if $(strip $(PROJECT)),$(call quote,$(PROJECT))) \
		$(if $(strip $(INTERVAL)),--interval $(call quote,$(INTERVAL))) \
		$(if $(strip $(KEEP_HISTORY)),--keep-history $(call quote,$(KEEP_HISTORY)))

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
		$(if $(strip $(KEEP_HISTORY)),--keep-history $(call quote,$(KEEP_HISTORY)))

test-notify: ## Testa só a notificação do sistema, sem .env e sem API
	$(require_venv)
	@$(PYTHON) $(SCRIPT) --test-notify

test: ## Executa a suíte de testes offline
	$(require_venv)
	@$(PYTHON) -B -m unittest discover -s tests

front-install: ## Instala as dependências do frontend Angular (frontend/node_modules)
	@cd frontend && npm install

front-build: ## Builda o frontend Angular; make web serve o resultado (frontend/dist/gitlab-monitor/browser/)
	$(require_node_modules)
	@cd frontend && npm run build

front-test: ## Executa a suíte de testes do frontend Angular
	$(require_node_modules)
	@cd frontend && npm test -- --watch=false

dev: MONITOR_API := http://127.0.0.1:$(API_PORT)
dev: ## Monitor real + ng serve, com recarga ao salvar; não usa o build
	$(require_venv)
	$(require_node_modules)
	@echo "Monitor em $(MONITOR_API); interface em http://localhost:$(SERVE_PORT)"
	@$(PYTHON) $(SCRIPT) --mode web --port $(call quote,$(API_PORT)) \
		$(if $(strip $(PROJECT)),$(call quote,$(PROJECT))) \
		$(if $(strip $(INTERVAL)),--interval $(call quote,$(INTERVAL))) & \
	monitor=$$!; \
	trap 'kill $$monitor 2>/dev/null' EXIT INT TERM; \
	cd frontend && MONITOR_API=$(call quote,$(MONITOR_API)) \
		npx ng serve --port $(call quote,$(SERVE_PORT))

front-serve: ## Só o ng serve, apontado para um monitor já no ar (MONITOR_API)
	$(require_node_modules)
	@cd frontend && MONITOR_API=$(call quote,$(MONITOR_API)) \
		npx ng serve --port $(call quote,$(SERVE_PORT))

front-lint: ## Verifica o frontend com ESLint (TypeScript e templates)
	$(require_node_modules)
	@cd frontend && npm run lint

front-styles: ## Gates do Design System: nenhum valor fixo, nenhum controle redesenhado
	$(require_node_modules)
	@cd frontend && npm run check:styles

# Sem require_node_modules de propósito: os gates só importam builtins do Node
# (node:test, node:fs) e o mock/monitor-contract.mjs. Exigir node_modules aqui
# dispararia um npm install do qual eles não dependem.
front-scripts: ## Testes dos scripts do frontend: tokens, rotas, contrato do mock, motor de regras, sem storage
	@cd frontend && npm run test:scripts

front-e2e: ## Jornadas no navegador contra o mock, em 1280 e 375 px
	$(require_node_modules)
	@cd frontend && npm run e2e

front-mock: ## Interface apontada para o mock, sem GitLab e sem .env
	$(require_node_modules)
	@cd frontend && npm run dev:mock

front-format: ## Reformata o frontend com Prettier; ALTERA ARQUIVOS
	$(require_node_modules)
	@cd frontend && npm run format

check: ## Validação completa: Python, lint, gates, testes e jornadas
	@$(MAKE) test
	@$(MAKE) front-lint
	@$(MAKE) front-styles
	@$(MAKE) front-scripts
	@$(MAKE) front-test
	@$(MAKE) front-build
	@$(MAKE) front-e2e
