PYTHON := .venv/bin/python
SCRIPT := gitlab_monitor.py

# Vazios de propósito: o que não for informado aqui vem do .env.
PROJECT ?=
INTERVAL ?=
KEEP_HISTORY ?= false
PORT ?= 8765

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
	@echo "Variáveis: PROJECT, INTERVAL (minutos), KEEP_HISTORY (true|false), PORT (modo web)."
	@echo "Omitidas, valem PROJECT e INTERVAL do .env."

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

web: ## Painel no navegador: serve a tabela em http://127.0.0.1:$(PORT)
	$(require_venv)
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
