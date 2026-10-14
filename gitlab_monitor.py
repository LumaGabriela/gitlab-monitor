#!/usr/bin/env python3
"""Monitora MRs via GET, sem pacotes Python externos (Python 3.9+).

Quatro modos. Sem --mode, o modo é perguntado no terminal:
  1 - Monitoramento: acompanha os MRs e avisa a cada mudança, até Ctrl+C.
  2 - Relatório atual: consulta uma vez e imprime a tabela dos MRs abertos,
      com likes, autor, threads, quem abriu as threads e o status da
      pipeline. O texto da coluna MR é link para o MR.
  3 - Painel no terminal: a tabela do relatório, redesenhada a cada intervalo.
  4 - Painel no navegador: a mesma tabela em HTML, servida em 127.0.0.1.
      A página se atualiza sozinha, ordena e filtra a tabela (por autor e
      por status de pipeline), traz os parâmetros em formulário (valem só
      nesta execução, sem gravar no .env) e pode notificar pelo navegador.
      Exige a pasta web/, ao lado deste script.
Os painéis também avisam as mudanças, mas guardam a referência em memória:
não usam o histórico em disco nem o lock, e por isso convivem com um
monitoramento do mesmo projeto. O painel 3 usa o notificador do sistema e
respeita --no-notify; o painel 4 não usa o notificador do sistema — quem
avisa é o navegador, com as notificações ligadas por padrão na página.
O modo 2 consulta uma vez e não compara nada.
Sem terminal interativo (make, cron, pipe), o modo é monitoramento.

Uso a partir da pasta do monitor:
     python3 gitlab_monitor.py https://gitlab.exemplo/grupo/projeto
     python3 gitlab_monitor.py grupo/projeto --once --no-notify
     python3 gitlab_monitor.py --mode relatorio
     python3 gitlab_monitor.py --mode web --port 8765
     python3 gitlab_monitor.py          # usa PROJECT e INTERVAL do .env
Atalhos equivalentes: make monitor, make report, make panel, make web
(exigem .venv).

O projeto e o intervalo podem vir do .env (PROJECT e INTERVAL) ou da linha de
comando. O que for passado na execução sobrescreve o .env: o argumento
posicional sobrescreve PROJECT e --interval sobrescreve INTERVAL. Sem nenhum
dos dois, o intervalo é 15 minutos e o projeto é obrigatório no comando.

Formatos aceitos para PROJETOS:
  https://gitlab.exemplo/grupo/projeto
  https://gitlab.exemplo/grupo/subgrupo/projeto
  https://gitlab.exemplo/grupo/projeto.git
  https://gitlab.exemplo/grupo/projeto/-/merge_requests
  grupo/subgrupo/projeto
  123  (ID numérico do projeto)
  groups/grupo/subgrupo  (forma canônica de grupo, a mesma que o monitor imprime)

URLs devem usar HTTPS e a mesma instância de GITLAB_API_URL no .env.
Parâmetros após ? e fragmentos após # são ignorados: o monitor consulta
TODOS os MRs abertos do projeto ou grupo, percorrendo todas as páginas. Coloque URLs
com parâmetros entre aspas no terminal para proteger caracteres como &.

Formato aceito para GRUPOS (inclui projetos dos subgrupos acessíveis ao token):
  https://gitlab.fpf.br/groups/flake/siga/-/merge_requests/
Para grupos, a URL deve terminar em /-/merge_requests, com barra final opcional.
Exemplo: python3 gitlab_monitor.py https://gitlab.fpf.br/groups/flake/siga/-/merge_requests/
Links SSH (git@gitlab.exemplo:grupo/projeto.git) também não são suportados.

Lê GITLAB_API_URL, GITLAB_TOKEN e, opcionalmente, PROJECT e INTERVAL do .env
ao lado deste script (sem executar seu conteúdo). Likes são reações 👍, não aprovações. Discussões são contadas,
identificadas por id entre consultas e checadas quanto a resolução e novas
respostas; comentário avulso (sem thread resolvível) conta na quantidade mas
não tem estado de resolução. A primeira consulta cria
a referência; as seguintes avisam mudanças. Ctrl+C encerra o monitor.
A referência é salva em gitlab-history/, na mesma pasta do .env, e por padrão
é apagada ao encerrar a sessão — use --keep-history true para preservá-la e
retomar a comparação na próxima execução.
O computador precisa estar acordado e o processo em execução para consultar.
Estados intermediários entre consultas podem não ser observados.
Notificações exigem uma sessão gráfica do usuário: osascript no macOS,
Windows PowerShell com Windows Forms no Windows e libnotify-bin com servidor
de notificações no D-Bus da sessão no Ubuntu Desktop. Não execute com sudo.
No Windows: py -3 gitlab_monitor.py grupo/projeto --interval 15
Teste isolado: python3 gitlab_monitor.py --test-notify
API: https://docs.gitlab.com/api/merge_requests/
"""

import argparse
import base64
import hashlib
from html import escape
import json
import math
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tempfile
import textwrap
import threading
import time
import unicodedata
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlencode, urlsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener


# .env e histórico ficam na pasta do script, independentemente
# do diretório de trabalho usado para executar o comando.
ROOT = Path(__file__).resolve().parent

# O helper mantém o ícone e o loop de mensagens vivos até fechamento/clique
# ou 30 s após o pedido. O timeout Python deixa margem para iniciar/compilar.
WINDOWS_NOTIFY_SOURCE = r"""
using System;
using System.Drawing;
using System.Windows.Forms;

public static class GitLabBalloon
{
    public static void Show(string title, string message)
    {
        Application.SetUnhandledExceptionMode(UnhandledExceptionMode.ThrowException);
        using (var context = new ApplicationContext())
        using (var icon = new NotifyIcon())
        using (var timer = new Timer())
        {
            icon.Icon = SystemIcons.Information;
            icon.BalloonTipTitle = title;
            icon.BalloonTipText = message;
            icon.BalloonTipClosed += delegate { context.ExitThread(); };
            icon.BalloonTipClicked += delegate { context.ExitThread(); };
            bool requested = false;
            timer.Interval = 100;
            timer.Tick += delegate {
                if (!requested)
                {
                    requested = true;
                    icon.ShowBalloonTip(10000);
                    timer.Interval = 30000;
                }
                else
                {
                    context.ExitThread();
                }
            };
            icon.Visible = true;
            timer.Start();
            Application.Run(context);
        }
    }
}
"""

WINDOWS_NOTIFY_SCRIPT = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
try {
    $payload = [Console]::In.ReadToEnd() | ConvertFrom-Json
    Add-Type -TypeDefinition @'
""" + WINDOWS_NOTIFY_SOURCE + r"""
'@ -ReferencedAssemblies System.Windows.Forms,System.Drawing
    [GitLabBalloon]::Show([string]$payload.title, [string]$payload.message)
    exit 0
} catch {
    [Console]::Error.WriteLine($_.Exception.Message)
    exit 1
}
"""


def read_env(path, keys):
    """Aceita export, aspas e comentários; nunca expande variáveis ou comandos."""
    values = {}
    pattern = re.compile(r"^\s*(?:export\s+)?(" + "|".join(keys) + r")\s*=\s*(.*)$")
    for line in path.read_text(encoding="utf-8-sig").splitlines():
        match = pattern.match(line)
        if not match:
            continue
        key, raw = match.groups()
        if raw.startswith(("'", '"')):
            try:
                parts = shlex.split(raw, comments=True)
            except ValueError:
                raise ValueError(f"Valor inválido de {key} no .env.") from None
            if len(parts) != 1:
                raise ValueError(f"Valor inválido de {key} no .env.")
            values[key] = parts[0]
        else:
            values[key] = re.split(r"\s+#", raw, maxsplit=1)[0].strip()
    return values


def env_defaults(path):
    """PROJECT e INTERVAL do .env; o que vier na execução sobrescreve estes valores."""
    try:
        values = read_env(path, ("PROJECT", "INTERVAL"))
    except OSError:
        return {}
    return {key: value for key, value in values.items() if value}


def credentials(path):
    values = read_env(path, ("GITLAB_API_URL", "GITLAB_TOKEN"))
    if not all(values.get(key) for key in ("GITLAB_API_URL", "GITLAB_TOKEN")):
        raise ValueError("Defina GITLAB_API_URL e GITLAB_TOKEN no .env da raiz.")
    base = values["GITLAB_API_URL"].rstrip("/")
    url = urlsplit(base)
    if url.scheme != "https" or not url.netloc or url.username or url.password or url.query or url.fragment:
        raise ValueError("GITLAB_API_URL deve ser uma URL HTTPS, sem credenciais ou query.")
    if not base.endswith("/api/v4"):
        base += "/api/v4"
    return base, values["GITLAB_TOKEN"]


def project_path(value, base):
    if "://" in value:
        url, api = urlsplit(value), urlsplit(base)
        if url.scheme != "https" or url.netloc != api.netloc or url.username:
            raise ValueError("O link do projeto deve pertencer ao GitLab definido no .env.")
        prefix = api.path.removesuffix("/api/v4")
        if not url.path.startswith(prefix + "/"):
            raise ValueError("Link fora do caminho da instância GitLab.")
        relative = unquote(url.path[len(prefix):]).strip("/")
        if relative.startswith("groups/"):
            match = re.fullmatch(r"groups/(.+)/-/merge_requests", relative)
            if not match or any(part in ("", ".", "..", "-") for part in match[1].split("/")):
                raise ValueError("URL de grupo deve terminar em /-/merge_requests/.")
            return "groups/" + quote(match[1], safe="")
        value = relative.split("/-/", 1)[0]
    value = value.strip("/").removesuffix(".git")
    # Forma canônica de grupo, a mesma que o monitor imprime e que o painel
    # devolve no formulário: precisa voltar a ser aceita sem virar projeto.
    if value.startswith("groups/"):
        group = value[len("groups/"):].strip("/")
        if not group or any(part in ("", ".", "..", "-") for part in group.split("/")):
            raise ValueError("Informe o grupo como groups/caminho ou pela URL de MRs.")
        return "groups/" + quote(group, safe="")
    if not value or (not value.isdigit() and "/" not in value):
        raise ValueError("Informe o link, grupo/projeto ou ID numérico do projeto.")
    return quote(value, safe="")


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        # Impede encaminhar o token a outro destino via redirecionamento.
        return None


class GitLab:
    def __init__(self, base, token):
        self.base = base
        self.token = token
        self.opener = build_opener(NoRedirect())

    def get(self, path, **params):
        url = self.base + path
        if params:
            url += "?" + urlencode(params)
        request = Request(url, headers={"PRIVATE-TOKEN": self.token, "Accept": "application/json"})
        try:
            with self.opener.open(request, timeout=30) as response:
                return json.load(response), response.headers
        except HTTPError as exc:
            # Não inclui corpo de resposta, headers ou credenciais na mensagem.
            raise RuntimeError(f"GitLab retornou HTTP {exc.code}; estado anterior preservado.") from None
        except (URLError, TimeoutError, OSError):
            raise RuntimeError("Falha de conexão com o GitLab; estado anterior preservado.") from None

    def pages(self, path, **params):
        page = 1
        while True:
            batch, headers = self.get(path, per_page=100, page=page, **params)
            if not isinstance(batch, list):
                raise ValueError("Resposta inesperada na listagem do GitLab.")
            yield from batch
            next_page = headers.get("X-Next-Page")
            if next_page:
                following = int(next_page)
                if following <= page:
                    raise ValueError("Paginação inválida na resposta do GitLab.")
                page = following
            elif next_page is not None or len(batch) < 100:
                return
            else:
                page += 1

    def opened(self, project):
        rows = {}
        is_group = project.startswith("groups/")
        endpoint = project if is_group else f"projects/{project}"
        for row in self.pages(
            f"/{endpoint}/merge_requests", state="opened", scope="all",
            order_by="created_at", sort="asc",
        ):
            key = f'{row["project_id"]}:{row["iid"]}' if is_group else str(row["iid"])
            rows[key] = row
        return rows

    def target(self, project, iid):
        # project_id e iid vêm da resposta do GitLab: escapa antes de montar o
        # path, para que a resposta não escolha o endpoint que recebe o token.
        # No modo projeto, project já vem escapado de project_path.
        if project.startswith("groups/"):
            project, iid = (quote(part, safe="") for part in iid.split(":", 1))
        else:
            iid = quote(str(iid), safe="")
        return f"/projects/{project}/merge_requests/{iid}"

    def detail(self, project, iid):
        row, _ = self.get(self.target(project, iid))
        return row

    def discussions(self, project, iid):
        return list(self.pages(self.target(project, iid) + "/discussions"))


def snapshot(row, discussions):
    pipeline = row["head_pipeline"]
    return {
        "title": row["title"], "url": row["web_url"], "likes": row["upvotes"],
        "pipeline": None if pipeline is None else {
            "id": pipeline["id"], "status": pipeline["status"],
        },
        "discussions": {d["id"]: discussion_snapshot(d) for d in discussions},
    }


def discussion_snapshot(discussion):
    notes = discussion["notes"]
    resolvable = any(note.get("resolvable") for note in notes)
    resolved = bool(notes[0].get("resolved")) if resolvable and notes else None
    return {"notes_count": len(notes), "resolved": resolved}


def pipeline_label(value):
    return "sem pipeline" if value is None else f'#{value["id"]} {value["status"]}'


REPORT_COLUMNS = (("likes", "Likes", 8), ("mr", "MR", 54), ("author", "Autor", 18),
                  ("threads", "Threads", 15), ("openers", "Devs que abriram threads", 30),
                  ("pipeline", "Pipeline Status", 16), ("created_label", "Criado em", 12))

# Só emoji de largura leste-asiática W: os de largura ambígua são desenhados
# com duas colunas por muitos terminais e desalinhariam a tabela.
PIPELINE_STATUS = {
    "success": "\N{WHITE HEAVY CHECK MARK} success",
    "failed": "\N{CROSS MARK} failed",
    "running": "\N{ANTICLOCKWISE DOWNWARDS AND UPWARDS OPEN CIRCLE ARROWS} running",
    "created": "\N{HOURGLASS WITH FLOWING SAND} created",
    "preparing": "\N{HOURGLASS WITH FLOWING SAND} preparing",
    "pending": "\N{HOURGLASS WITH FLOWING SAND} pending",
    "waiting_for_resource": "\N{HOURGLASS WITH FLOWING SAND} waiting",
    "canceled": "\N{MEDIUM WHITE CIRCLE} canceled",
    "canceling": "\N{MEDIUM WHITE CIRCLE} canceling",
    "skipped": "\N{BLACK RIGHT-POINTING DOUBLE TRIANGLE} skipped",
    "manual": "\N{RAISED HAND} manual",
    "scheduled": "\N{ALARM CLOCK} scheduled",
}


# A partir de quantos 👍 o MR ganha destaque visual na tabela.
LIKES_HIGHLIGHT = 2

# Tom semântico por intenção, conforme o guia de feedback.
PIPELINE_TONES = {"success": "success", "failed": "danger", "running": "info",
                  "created": "warning", "preparing": "warning", "pending": "warning",
                  "waiting_for_resource": "warning"}


def project_label(web_url):
    """BE/FE para os repositórios do time; nome curto para qualquer outro."""
    name = urlsplit(web_url).path.split("/-/", 1)[0].strip("/").rsplit("/", 1)[-1]
    for suffix, label in (("-backend", "BE"), ("-frontend", "FE")):
        if name.endswith(suffix):
            return label
    return name


def thread_summary(discussions):
    """Conta apenas threads resolvíveis; comentário avulso não é thread."""
    total = resolved = 0
    openers = []
    for discussion in discussions:
        notes = discussion["notes"]
        if not notes or not any(note.get("resolvable") for note in notes):
            continue
        total += 1
        if notes[0].get("resolved"):
            resolved += 1
        opener = notes[0]["author"]["username"]
        if opener not in openers:
            openers.append(opener)
    return total, resolved, openers


def pipeline_status(pipeline):
    """Status da pipeline do MR; estado desconhecido aparece como veio da API."""
    if pipeline is None:
        return "— sem pipeline"
    return PIPELINE_STATUS.get(pipeline["status"], f'\N{BULLET} {pipeline["status"]}')


EPOCH = datetime.min.replace(tzinfo=timezone.utc)


def created_at(value):
    """ISO 8601 do GitLab; data ausente ou ilegível vai para o fim da lista."""
    try:
        return datetime.fromisoformat(value.replace("Z", "+00:00"))
    except (AttributeError, TypeError, ValueError):
        return EPOCH


def report_row(row, discussions):
    total, resolved, openers = thread_summary(discussions)
    created = created_at(row.get("created_at"))
    return {
        "likes": f'{row["upvotes"]} \N{THUMBS UP SIGN}',
        "mr": f'{project_label(row["web_url"])} #{row["iid"]} {row["title"]}',
        # Campos que o monitoramento não exigia: ausência não derruba o ciclo.
        "author": (row.get("author") or {}).get("username", "—"),
        "threads": f"{resolved}/{total} resolvidas" if total else "sem threads",
        "openers": ", ".join(openers) or "—",
        "pipeline": pipeline_status(row["head_pipeline"]),
        # Tons só são usados pelo HTML; o terminal ignora estes campos.
        "pipeline_tone": PIPELINE_TONES.get((row["head_pipeline"] or {}).get("status")),
        "threads_tone": ("success" if total and resolved == total
                         else "warning" if total else None),
        # Dois ou mais 👍: destaque, para o MR pronto saltar aos olhos.
        "likes_tone": "strong" if row["upvotes"] >= LIKES_HIGHLIGHT else None,
        "url": row["web_url"],
        "created": created,
        "created_label": f"{created:%d/%m/%Y}" if created > EPOCH else "—",
        # Valores crus, usados só para ordenar e filtrar no painel.
        "upvotes": row["upvotes"],
        "unresolved": total - resolved,
        "status": (row["head_pipeline"] or {}).get("status") or "",
    }


def report(client, project):
    """Uma única passagem pelos MRs abertos, sem histórico e sem notificação."""
    return scan(client, project)[2]


def text_width(value):
    # Emoji e caracteres largos ocupam duas colunas no terminal.
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1 for c in value)


def hyperlink(text, url):
    """OSC 8: o terminal mostra só o texto, e os códigos não ocupam colunas."""
    return f"\033]8;;{url}\033\\{text}\033]8;;\033\\"


def render_table(rows, links=None):
    # Redirecionado para arquivo ou pipe, o link viraria lixo no meio do texto.
    if links is None:
        links = sys.stdout.isatty()
    # O cabeçalho também quebra, para que um título longo não alargue a coluna.
    head = [textwrap.wrap(header, limit) for _, header, limit in REPORT_COLUMNS]
    body = [[textwrap.wrap(row[key], limit) or [""] for key, _, limit in REPORT_COLUMNS]
            for row in rows]
    widths = [max(text_width(line) for cells in [head, *body] for line in cells[index])
              for index in range(len(REPORT_COLUMNS))]

    def rule(left, middle, right):
        return left + middle.join("─" * (width + 2) for width in widths) + right

    def cell(value, width, url):
        # O recuo fica fora do link: só o texto da coluna MR é clicável.
        padding = " " * (width - text_width(value))
        if url and value:
            return hyperlink(value, url) + padding
        return value + padding

    def block(cells, url=None):
        return ["│ " + " │ ".join(
            cell(line[index] if index < len(line) else "", width,
                 url if key == "mr" else None)
            for (key, _, _), line, width in zip(REPORT_COLUMNS, cells, widths)) + " │"
            for index in range(max(len(line) for line in cells))]

    lines = [rule("┌", "┬", "┐"), *block(head), rule("├", "┼", "┤")]
    for position, (cells, row) in enumerate(zip(body, rows)):
        if position:
            lines.append(rule("├", "┼", "┤"))
        lines.extend(block(cells, row.get("url") if links else None))
    lines.append(rule("└", "┴", "┘"))
    return "\n".join(lines)


def discussion_changes(old, new):
    # Identifica discussões pelo id: as que só existem de um lado já são
    # cobertas pela diferença de quantidade, não geram evento duplicado.
    changes = []
    if len(old) != len(new):
        changes.append(f'DISCUSSÕES {len(old)} → {len(new)}')
    resolved = reopened = replied = 0
    for discussion_id, current in new.items():
        previous = old.get(discussion_id)
        if previous is None:
            continue
        if previous["resolved"] != current["resolved"]:
            if current["resolved"]:
                resolved += 1
            else:
                reopened += 1
        if current["notes_count"] > previous["notes_count"]:
            replied += 1
    if resolved:
        changes.append(f'{resolved} DISCUSSÃO(ÕES) RESOLVIDA(S)')
    if reopened:
        changes.append(f'{reopened} DISCUSSÃO(ÕES) REABERTA(S)')
    if replied:
        changes.append(f'{replied} DISCUSSÃO(ÕES) COM NOVA RESPOSTA')
    return changes


def scan(client, project, previous=None):
    """Uma passagem: snapshots para comparação, eventos e linhas da tabela.

    Monitoramento e painéis partilham esta função para que a tabela e os
    eventos venham do mesmo conjunto de requisições, sem consultar duas vezes.
    """
    current, removed, rows = {}, {}, []
    # A própria listagem de abertos já traz o objeto completo do MR
    # (mesmos campos do detail); reaproveitar evita 1 GET por MR a cada poll.
    for iid in client.opened(project):
        # A listagem de abertos (principalmente a de grupo) não garante os
        # mesmos campos do detail de um MR; busca o objeto completo por MR.
        row = client.detail(project, iid)
        if row["state"] == "opened":
            discussions = client.discussions(project, iid)
            current[iid] = snapshot(row, discussions)
            rows.append(report_row(row, discussions))
        else:
            removed[iid] = row["state"]
    # Confirma saídas individualmente; 403/404 nunca significam "mesclado".
    for iid in (previous or {}).keys() - current.keys():
        if iid not in removed:
            row = client.detail(project, iid)
            if row["state"] == "opened":
                current[iid] = snapshot(row, client.discussions(project, iid))
            else:
                removed[iid] = row["state"]
    # Mais recentes primeiro; o rótulo só desempata datas idênticas.
    rows.sort(key=lambda item: item["mr"])
    rows.sort(key=lambda item: item["created"], reverse=True)
    events = []
    if previous is None:
        return current, events, rows
    for iid in sorted(current.keys() | previous.keys(), key=lambda key: tuple(map(int, key.split(":")))):
        new, old = current.get(iid), previous.get(iid)
        row = new or old
        # A chave de grupo é "project_id:iid"; só o número do MR é exibido,
        # já que a URL do evento identifica o projeto sem ambiguidade.
        header = f'!{iid.split(":")[-1]} — {row["title"]}'
        changes = []
        if old is None:
            changes.append("NOVO MR ABERTO")
        elif new is None:
            changes.append({"merged": "MESCLADO", "closed": "FECHADO"}.get(
                removed[iid], f"SAIU DOS ABERTOS ({removed[iid]})"))
        else:
            if old["likes"] != new["likes"]:
                changes.append(f'LIKES {old["likes"]} → {new["likes"]}')
            if old["pipeline"] != new["pipeline"]:
                changes.append(f'PIPELINE {pipeline_label(old["pipeline"])} → {pipeline_label(new["pipeline"])}')
            changes.extend(discussion_changes(old["discussions"], new["discussions"]))
        for change in changes:
            # Uma informação por linha: identificação, mudança e link.
            events.append(f'{header}\n{change}\n{row["url"]}')
    return current, events, rows


def collect(client, project, previous):
    current, events, _ = scan(client, project, previous)
    return current, events


def log(message):
    # Remove caracteres de controle de títulos vindos do GitLab.
    message = "".join(c if c.isprintable() or c == "\n" else " " for c in message)
    # Linhas seguintes recuam para não se confundirem com um novo registro.
    stamp = f'[{datetime.now().astimezone():%Y-%m-%d %H:%M:%S %Z}] '
    print(stamp + message.replace("\n", "\n  "), flush=True)


def windows_text(value, limit):
    """Limita unidades UTF-16 do balão Win32 sem partir um emoji."""
    encoded = value.encode("utf-16-le")
    if len(encoded) <= limit * 2:
        return value
    return encoded[:(limit - 1) * 2].decode("utf-16-le", errors="ignore") + "…"


def notification_error_detail(value):
    if isinstance(value, bytes):
        value = value.decode("utf-8", errors="replace")
    return " ".join((value or "").split())[:500]


def notify(title, message):
    """True indica helper concluído; o SO ainda pode suprimir o banner."""
    message = message[:1000]
    options = {"timeout": 15}
    if sys.platform == "darwin":
        script = ('on run argv\n'
                  'display notification (item 2 of argv) with title (item 1 of argv) sound name "Glass"\n'
                  'end run')
        command = ["osascript", "-e", script, title, message]
    elif sys.platform.startswith("linux"):
        command = ["notify-send", "--app-name=GitLab Monitor", "--", title, escape(message, quote=False)]
    elif sys.platform == "win32":
        # Apenas código fixo em -EncodedCommand; dados ASCII/JSON em stdin.
        # ensure_ascii evita depender da página de código do PowerShell 5.1.
        encoded = base64.b64encode(WINDOWS_NOTIFY_SCRIPT.encode("utf-16-le")).decode("ascii")
        command = ["powershell.exe", "-NoProfile", "-NonInteractive", "-Sta", "-WindowStyle", "Hidden",
                   "-EncodedCommand", encoded]
        options.update(timeout=45, input=json.dumps({
            "title": windows_text(title, 63),
            "message": windows_text(message or "Atualização no monitor GitLab.", 255),
        }, ensure_ascii=True), text=True, encoding="utf-8", errors="replace")
    else:
        log(f"Notificações nativas indisponíveis nesta plataforma: {sys.platform}.")
        return False
    executable = shutil.which(command[0])
    if not executable:
        hint = " Instale libnotify-bin no Ubuntu Desktop." if sys.platform.startswith("linux") else ""
        log(f"Notificação indisponível: executável {command[0]} não encontrado.{hint}")
        return False
    command[0] = executable
    try:
        subprocess.run(command, check=True, capture_output=True, **options)
        return True
    except subprocess.TimeoutExpired:
        log(f"Falha de notificação ({Path(executable).name}): tempo limite de {options['timeout']} s excedido.")
    except subprocess.CalledProcessError as exc:
        detail = notification_error_detail(exc.stderr)
        log(f"Falha de notificação ({Path(executable).name}): código {exc.returncode}. {detail}")
    except OSError as exc:
        log(f"Falha ao iniciar notificador ({Path(executable).name}): {notification_error_detail(str(exc))}")
    return False


def save(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=path.parent,
                                         delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(data, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def acquire_lock(path):
    # Um monitor por alvo e instância; o SO libera o lock
    # sozinho quando o processo termina (normal, erro ou Ctrl+C).
    if sys.platform == "win32":
        import msvcrt
        handle = path.open("a+b")
        handle.seek(0, os.SEEK_END)
        if handle.tell() == 0:
            handle.write(b"\0")
            handle.flush()
        handle.seek(0)
        try:
            msvcrt.locking(handle.fileno(), msvcrt.LK_NBLCK, 1)
        except OSError:
            handle.close()
            raise ValueError("Já existe um monitor ativo para este projeto.") from None
    else:
        import fcntl
        handle = path.open("a")
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            handle.close()
            raise ValueError("Já existe um monitor ativo para este projeto.") from None
    return handle


# Tokens do design guide FPF Tech (guias card e feedback). Nenhum valor de cor,
# spacing ou radius aparece fora deste bloco; o tema escuro troca só as variáveis.
# Interface do painel: templates, componentes e estilos vivem em web/, ao lado
# do script. Separar o HTML/CSS/JS do Python mantém cada peça reutilizável.
ASSETS = Path(__file__).resolve().parent / "web"

STYLE_FILES = ("styles/tokens.css", "styles/base.css", "styles/components/card.css",
               "styles/components/table.css", "styles/components/badge.css",
               "styles/components/button.css", "styles/components/toolbar.css",
               "styles/components/form.css", "styles/components/feedback.css",
               "styles/responsive.css")

PLACEHOLDER = re.compile(r"\{\{\s*(\w+)\s*\}\}")

_assets = {}


def asset(name):
    """Lê uma vez e guarda: a página é remontada a cada consulta do navegador."""
    if name not in _assets:
        _assets[name] = (ASSETS / name).read_text(encoding="utf-8")
    return _assets[name]


def fill(template, **values):
    """Substitui {{chave}}; não colide com as chaves do CSS nem do JavaScript."""
    return PLACEHOLDER.sub(lambda found: str(values[found.group(1)]), template)


def component(name, **values):
    return fill(asset(f"components/{name}.html"), **values)


def stylesheet():
    return "\n".join(asset(name) for name in STYLE_FILES)


# Ordenações oferecidas na barra da tabela. A lista já vem por data decrescente,
# e a ordenação do Python é estável: cada critério abaixo desempata por data.
SORTS = (
    ("recente", "Mais recentes", None),
    ("likes", "Mais likes", lambda row: -row["upvotes"]),
    ("mr", "MR (A–Z)", lambda row: row["mr"].casefold()),
    ("autor", "Autor (A–Z)", lambda row: row["author"].casefold()),
    ("threads", "Não resolvidas primeiro", lambda row: -row["unresolved"]),
    ("revisores", "Devs que abriram threads", lambda row: row["openers"].casefold()),
    ("pipeline", "Status da pipeline", lambda row: PIPELINE_ORDER.get(row["status"], 50)),
)

SORT_KEYS = {name: key for name, _, key in SORTS}

# Ordem útil, não alfabética: o que exige ação primeiro.
PIPELINE_ORDER = {"failed": 0, "canceled": 1, "canceling": 1, "manual": 2, "running": 3,
                  "pending": 4, "created": 4, "preparing": 4, "waiting_for_resource": 4,
                  "scheduled": 5, "skipped": 6, "success": 7, "": 8}

NO_PIPELINE = "sem-pipeline"


def filter_options(rows):
    """Opções vindas das linhas atuais, para não oferecer filtro vazio."""
    authors = sorted({row["author"] for row in rows}, key=str.casefold)
    statuses = sorted({row["status"] for row in rows},
                      key=lambda status: PIPELINE_ORDER.get(status, 50))
    return {
        "authors": [{"value": author, "label": author} for author in authors],
        "pipelines": [{"value": status or NO_PIPELINE,
                       "label": pipeline_status({"status": status}) if status
                       else "sem pipeline"}
                      for status in statuses],
    }


def arrange(rows, sort="recente", author="", pipeline=""):
    """Filtra e ordena as linhas já coletadas; nenhuma consulta nova ao GitLab."""
    chosen = [row for row in rows
              if (not author or row["author"] == author)
              and (not pipeline or (row["status"] or NO_PIPELINE) == pipeline)]
    # A data é a base, não uma suposição sobre a ordem recebida: como a
    # ordenação do Python é estável, ela vira o desempate de todo critério.
    chosen.sort(key=lambda row: row["created"], reverse=True)
    key = SORT_KEYS.get(sort)
    if key:
        chosen.sort(key=key)
    return chosen


def badge(text, tone=None):
    mark, _, rest = text.partition(" ")
    return component("badge", variant=f" badge--{tone}" if tone else "",
                     mark=escape(mark), text=escape(rest))


# Campos marcados na tabela quando mudam de uma passagem para a seguinte.
TRACKED_FIELDS = ("likes", "threads", "openers", "pipeline")

CHANGE_MARK = "\N{SMALL ORANGE DIAMOND}"


def mark_changes(rows, previous):
    """Compara com as linhas da passagem anterior, não com o snapshot.

    O snapshot guardado não tem quem abriu cada thread; as linhas da tabela
    têm tudo que a página mostra, então a comparação sai exata e o formato
    do histórico em disco fica intocado.
    """
    before = {row["url"]: row for row in previous or ()}
    for row in rows:
        earlier = before.get(row["url"])
        # MR novo não tem o que comparar: nenhuma célula é marcada.
        row["changed"] = frozenset(
            field for field in TRACKED_FIELDS
            if earlier is not None and row[field] != earlier[field])
    return rows


def change_mark(row, key):
    if key not in row.get("changed", ()):
        return ""
    return (f'<span class="changed" role="img" aria-label="alterado desde a '
            f'consulta anterior" title="Alterado desde a consulta anterior">'
            f"{CHANGE_MARK}</span>")


def cell_value(row, key):
    if key == "mr":
        # noopener/noreferrer: a guia nova não ganha acesso a esta página.
        return (f'<a href="{escape(row["url"], quote=True)}" target="_blank" '
                f'rel="noopener noreferrer">{escape(str(row["mr"]))}</a>')
    if key == "pipeline":
        return badge(str(row["pipeline"]), row.get("pipeline_tone"))
    if key == "threads":
        return badge(f'\N{SPEECH BALLOON} {row["threads"]}', row.get("threads_tone"))
    if key == "likes":
        count, _, mark = str(row["likes"]).rpartition(" ")
        return badge(f"{mark} {count}", row.get("likes_tone"))
    return escape(str(row[key]))


def render_cell(row, key):
    # O invólucro é uma linha flex: a marca fica sempre à esquerda do item,
    # qualquer que seja a largura da coluna, em vez de cair para cima dele.
    return (f'<span class="cell">{change_mark(row, key)}'
            f"{cell_value(row, key)}</span>")


LOADING_MESSAGE = "Consultando o GitLab…"
EMPTY_TARGET_MESSAGE = "Nenhum MR aberto no alvo."
EMPTY_FILTER_MESSAGE = "Nenhum MR corresponde aos filtros."


def empty_message(collected, filtered):
    """Três situações distintas; dizer a errada faz a página parecer quebrada."""
    if not collected:
        return LOADING_MESSAGE
    return EMPTY_FILTER_MESSAGE if filtered else EMPTY_TARGET_MESSAGE


def render_fragment(rows, collected=True, filtered=False):
    """Todo texto vindo do GitLab passa por escape antes de entrar na página."""
    if not rows:
        return component("empty", message=empty_message(collected, filtered))
    headers = "".join(f"<th>{escape(header)}</th>" for _, header, _ in REPORT_COLUMNS)
    body = "".join(
        "<tr>" + "".join(f'<td class="{key}">{render_cell(row, key)}</td>'
                         for key, _, _ in REPORT_COLUMNS) + "</tr>"
        for row in rows)
    return component("table", headers=headers, rows=body)


def sort_options(selected="recente"):
    return "".join(
        f'<option value="{name}"{" selected" if name == selected else ""}>'
        f"{escape(label)}</option>" for name, label, _ in SORTS)


def page_meta(project, shown, total, updated):
    count = f"{shown} MR(s)" if shown == total else f"{shown} de {total} MR(s)"
    return (f"{project} · {count} · atualizado em {updated:%d/%m/%Y %H:%M:%S}" if updated
            else f"{project} · primeira consulta em andamento")


def render_html(rows, project, interval, updated=None):
    """Casca da página; a tabela é trocada pelo JS a cada consulta."""
    return fill(
        asset("templates/page.html"),
        project=escape(project),
        styles=stylesheet(),
        script=asset("scripts/panel.js"),
        theme_script=asset("scripts/theme.js"),
        meta=escape(page_meta(project, len(rows), len(rows), updated)),
        settings=component("settings", project=escape(project, quote=True),
                           interval=f"{interval:g}"),
        toolbar=component("toolbar", sort_options=sort_options()),
        legend=component("legend", mark=CHANGE_MARK),
        # Sem consulta concluída, a tabela está carregando, não vazia.
        table=render_fragment(rows, collected=updated is not None),
    )


# De quanto em quanto tempo a página busca o que o servidor já tem.
POLL_SECONDS = 10


def panel_state(project, interval):
    return {"lock": threading.Lock(), "project": project, "interval": interval,
            "rows": [], "updated": None, "error": None, "events": [], "sequence": 0}


def panel_snapshot(state, since, sort="recente", author="", pipeline=""):
    with state["lock"]:
        rows, project, updated = state["rows"], state["project"], state["updated"]
        events = [item["text"] for item in state["events"] if item["id"] > since]
        sequence = state["sequence"]
        error = state["error"]
    chosen = arrange(rows, sort, author, pipeline)
    return {
        "table": render_fragment(chosen, collected=updated is not None,
                                 filtered=bool(rows)),
        "meta": page_meta(unquote(project), len(chosen), len(rows), updated),
        # As opções saem de todas as linhas, não das filtradas: filtrar por um
        # autor não pode apagar os demais da lista de escolhas.
        "filters": filter_options(rows),
        "error": error,
        "events": events,
        "sequence": sequence,
        # Consulta local e barata: a página não fica esperando o ciclo
        # do servidor para mostrar o que já foi coletado.
        "poll": POLL_SECONDS,
    }


def apply_settings(state, payload, base, wake):
    """Validação igual à da linha de comando; nada é gravado no .env."""
    project = str(payload.get("project", "")).strip()
    interval = str(payload.get("interval", "")).strip()
    if not project:
        raise ValueError("Informe o projeto ou grupo.")
    target = project_path(project, base)
    try:
        minutes = float(interval)
    except ValueError:
        raise ValueError("Intervalo deve ser um número de minutos.") from None
    if not math.isfinite(minutes) or minutes <= 0:
        raise ValueError("Intervalo deve ser um número positivo e finito.")
    with state["lock"]:
        changed = target != state["project"]
        state["project"], state["interval"] = target, minutes
        if changed:
            state["rows"], state["updated"], state["events"] = [], None, []
    log(f"Painel: alvo {unquote(target)} a cada {minutes:g} minuto(s), "
        "só nesta execução.")
    wake.set()


def panel_handler(state, base, wake):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def reply(self, status, payload, kind="application/json"):
            body = (payload if isinstance(payload, bytes)
                    else json.dumps(payload, ensure_ascii=False).encode("utf-8"))
            self.send_response(status)
            self.send_header("Content-Type", f"{kind}; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            self.end_headers()
            self.wfile.write(body)

        def same_origin(self):
            # Sem CORS e com Origin conferido, outra página não altera o alvo.
            origin = self.headers.get("Origin")
            return origin is None or urlsplit(origin).netloc == self.headers.get("Host")

        def do_GET(self):
            path, _, query = self.path.partition("?")
            if path in ("/", "/index.html"):
                with state["lock"]:
                    rows, project = state["rows"], unquote(state["project"])
                    interval, updated = state["interval"], state["updated"]
                page = render_html(rows, project, interval, updated)
                self.reply(200, page.encode("utf-8"), "text/html")
                return
            if path == "/data":
                params = parse_qs(query)
                since = params.get("since", ["0"])[0]
                sort = params.get("sort", ["recente"])[0]
                self.reply(200, panel_snapshot(
                    state, int(since) if since.isdigit() else 0,
                    sort if sort in SORT_KEYS else "recente",
                    params.get("author", [""])[0], params.get("pipeline", [""])[0]))
                return
            self.send_error(404)

        def do_POST(self):
            if self.path.split("?", 1)[0] != "/settings":
                self.send_error(404)
                return
            if not self.same_origin():
                self.reply(403, {"error": "Origem não permitida."})
                return
            if "application/json" not in (self.headers.get("Content-Type") or ""):
                self.reply(415, {"error": "Envie JSON."})
                return
            length = int(self.headers.get("Content-Length") or 0)
            if length > 4096:
                self.reply(413, {"error": "Requisição grande demais."})
                return
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                apply_settings(state, payload, base, wake)
            except (ValueError, AttributeError, TypeError) as exc:
                self.reply(400, {"error": str(exc) or "Valores inválidos."})
                return
            self.reply(200, {"ok": True})

        def log_message(self, *args):
            # O acesso do próprio navegador não interessa no terminal.
            pass

    return Handler


def announce(events, notifications=True):
    """Mesmos eventos do monitoramento, a partir da passagem já feita."""
    for event in events:
        log(event)
    if events and notifications:
        notify("GitLab: atualizações nos MRs", "\n\n".join(events))


def serve_panel(client, project, interval, port, base=""):
    """Serve a tabela só em 127.0.0.1; o token nunca entra na página.

    Este modo não usa o notificador do sistema: quem avisa é o navegador, pela
    caixa da página, e dois avisos para o mesmo evento seriam ruído. Os eventos
    continuam saindo no terminal.
    """
    state = panel_state(project, interval)
    wake = threading.Event()
    stop = threading.Event()

    def refresh():
        # A referência vive na memória deste processo: o painel não usa o
        # histórico em disco nem o lock, e por isso convive com um monitor.
        previous, target, shown = None, project, None
        while True:
            with state["lock"]:
                current_target, seconds = state["project"], max(1, int(state["interval"] * 60))
            if current_target != target:
                # Alvo novo recomeça a referência: a primeira passagem só
                # fotografa, e nada é marcado como alterado.
                previous, target, shown = None, current_target, None
            try:
                snapshots, events, rows = scan(client, target, previous)
                previous = snapshots
                mark_changes(rows, shown)
                shown = rows
                with state["lock"]:
                    if state["project"] == target:
                        state["rows"], state["error"] = rows, None
                        state["updated"] = datetime.now().astimezone()
                        for event in events:
                            state["sequence"] += 1
                            state["events"].append({"id": state["sequence"], "text": event})
                        del state["events"][:-50]
                log(f"Painel atualizado: {len(rows)} MR(s) aberto(s)."
                    if not events else
                    f"Painel atualizado: {len(rows)} MR(s) aberto(s). "
                    f"{len(events)} alteração(ões).")
                announce(events, notifications=False)
            except (RuntimeError, KeyError, TypeError) as exc:
                message = (str(exc) if isinstance(exc, RuntimeError)
                           else "Resposta inesperada do GitLab; tabela anterior preservada.")
                with state["lock"]:
                    state["error"] = message
                log(message)
            # wake encurta a espera quando o painel troca de alvo ou intervalo.
            if stop.wait(0):
                return
            wake.wait(seconds)
            wake.clear()
            if stop.wait(0):
                return

    worker = threading.Thread(target=refresh, daemon=True)
    worker.start()
    server = ThreadingHTTPServer(("127.0.0.1", port), panel_handler(state, base, wake))
    log(f"Painel em http://127.0.0.1:{server.server_port}/ "
        f"(atualiza a cada {interval:g} minuto(s)). Ctrl+C encerra.")
    log("As mudanças saem aqui no terminal e, na tela, pelo navegador: a página "
        "já vem com as notificações ligadas e pede a permissão na primeira vez.")
    try:
        server.serve_forever()
    finally:
        stop.set()
        wake.set()
        server.server_close()


def show_panel(client, project, interval, notifications=True):
    """Mesma tabela do relatório, redesenhada a cada intervalo."""
    seconds = max(1, interval * 60)
    # Referência em memória: sem histórico em disco e sem lock.
    previous = None
    while True:
        started = time.monotonic()
        try:
            current, events, rows = scan(client, project, previous)
        except (RuntimeError, KeyError, TypeError) as exc:
            log(str(exc) if isinstance(exc, RuntimeError)
                else "Resposta inesperada do GitLab; tabela anterior preservada.")
        else:
            if sys.stdout.isatty():
                print("\033[H\033[J", end="")
            log(f"{len(rows)} MR(s) aberto(s). Atualiza a cada {interval:g} minuto(s). "
                "Ctrl+C encerra.")
            if rows:
                print(render_table(rows))
            # Os eventos ficam abaixo da tabela, até o próximo redesenho.
            announce(events, notifications)
            previous = current
        time.sleep(max(1, seconds - (time.monotonic() - started)))


MODES = (("1", "monitorar", "Monitoramento"),
         ("2", "relatorio", "Relatório atual"),
         ("3", "painel", "Painel no terminal (tabela que se atualiza)"),
         ("4", "web", "Painel no navegador (tabela servida em localhost)"))


def choose_mode():
    """Sem terminal interativo (make, cron, pipe), segue em monitoramento."""
    if not sys.stdin.isatty():
        return "monitorar"
    print("Modo de execução:")
    for number, _, description in MODES:
        print(f"  {number} - {description}")
    options = {number: name for number, name, _ in MODES}
    while True:
        try:
            answer = input("Escolha [1]: ").strip() or "1"
        except EOFError:
            return "monitorar"
        if answer in options:
            return options[answer]
        numbers = list(options)
        print(f"Opção inválida: digite {', '.join(numbers[:-1])} ou {numbers[-1]}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("project", nargs="?",
                         help="URL de projeto ou grupo (/-/merge_requests); caminho ou ID de projeto. "
                              "Sobrescreve PROJECT do .env; sem ele, vale PROJECT")
    parser.add_argument("--test-notify", action="store_true", help="Testa a notificação nativa sem .env nem API")
    parser.add_argument("--mode", choices=[name for _, name, _ in MODES],
                         help="monitorar acompanha e avisa cada mudança; relatorio consulta uma "
                              "vez e imprime a tabela; painel repete a tabela no terminal; web "
                              "serve a tabela em localhost. Sem a opção, é perguntado no terminal")
    parser.add_argument("--port", type=int, default=8765, metavar="PORTA",
                         help="Porta do modo web em 127.0.0.1 (padrão: 8765)")
    parser.add_argument("--interval", type=float, default=None, metavar="MINUTOS",
                         help="Intervalo em minutos. Sobrescreve INTERVAL do .env; sem ambos, 15")
    parser.add_argument("--once", action="store_true", help="Consulta uma vez e encerra")
    parser.add_argument("--no-notify", action="store_true",
                         help="Desativa notificações nativas (macOS, Linux via notify-send, Windows via PowerShell)")
    parser.add_argument("--keep-history", default="false", metavar="TRUE|FALSE",
                         help="Preserva a referência desta sessão em gitlab-history/ ao encerrar "
                              "(padrão: false, apaga ao sair)")
    args = parser.parse_args()
    if args.test_notify:
        return 0 if notify("GitLab Monitor", "Teste de notificação: acentos, seta → e emoji 👍.") else 1
    try:
        defaults = env_defaults(ROOT / ".env")
    except ValueError as exc:
        parser.error(str(exc))
    project_arg = args.project or defaults.get("PROJECT")
    if not project_arg:
        parser.error("Informe o projeto no comando, defina PROJECT no .env ou use --test-notify.")
    interval = args.interval
    if interval is None:
        raw = defaults.get("INTERVAL")
        if raw is None:
            interval = 15
        else:
            try:
                interval = float(raw)
            except ValueError:
                parser.error("INTERVAL do .env deve ser um número positivo e finito.")
            if not math.isfinite(interval) or interval <= 0:
                parser.error("INTERVAL do .env deve ser um número positivo e finito.")
    elif not math.isfinite(interval) or interval <= 0:
        parser.error("--interval deve ser um número positivo e finito.")
    keep_history = args.keep_history.strip().lower()
    if keep_history not in ("true", "false"):
        parser.error("--keep-history deve ser TRUE ou FALSE.")
    keep_history = keep_history == "true"
    mode = args.mode or choose_mode()
    lock = None
    try:
        base, token = credentials(ROOT / ".env")
        try:
            project = project_path(project_arg, base)
        except ValueError as exc:
            parser.error(str(exc))
        client = GitLab(base, token)
        if mode == "relatorio":
            try:
                rows = report(client, project)
            except (RuntimeError, KeyError, TypeError) as exc:
                log(str(exc) if isinstance(exc, RuntimeError) else "Resposta inesperada do GitLab.")
                return 1
            log(f"Relatório de {unquote(project)}: {len(rows)} MR(s) aberto(s).")
            if rows:
                print(render_table(rows))
            return 0
        if mode == "painel":
            show_panel(client, project, interval, not args.no_notify)
            return 0
        if mode == "web":
            serve_panel(client, project, interval, args.port, base)
            return 0
        key = hashlib.sha256(f"{base}/{project}".encode()).hexdigest()[:24]
        path = ROOT / "gitlab-history" / f"{key}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        lock = acquire_lock(path.with_suffix(".lock"))
        previous = None
        if path.exists():
            stored = json.loads(path.read_text(encoding="utf-8"))
            if stored["version"] != 2 or not isinstance(stored["mrs"], dict):
                raise ValueError("Arquivo de estado incompatível; preserve-o e mova-o para reiniciar a referência.")
            previous = stored["mrs"]
        log(f"Monitorando {unquote(project)} a cada {interval:g} minuto(s). Ctrl+C encerra.")
        last_error = None
        try:
            while True:
                started = time.monotonic()
                try:
                    current, events = collect(client, project, previous)
                    save(path, {"version": 2, "checked_at": datetime.now().astimezone().isoformat(), "mrs": current})
                    if previous is None:
                        log(f"Referência inicial salva: {len(current)} MR(s) aberto(s).")
                    else:
                        for event in events:
                            log(event)
                        log(f"MRs abertos: {len(previous)} → {len(current)}. {len(events)} alteração(ões).")
                    previous = current
                    if events and not args.no_notify:
                        notify("GitLab: atualizações nos MRs", "\n\n".join(events))
                    if last_error:
                        log("Conexão e comparação restabelecidas.")
                    last_error = None
                except (RuntimeError, ValueError, KeyError, TypeError, OSError) as exc:
                    message = str(exc) if isinstance(exc, RuntimeError) else "Falha ao ler resposta ou salvar estado; referência anterior preservada."
                    log(message)
                    if not args.no_notify and message != last_error:
                        notify("GitLab: falha no monitor", message)
                    last_error = message
                    if args.once:
                        return 1
                if args.once:
                    return 0
                time.sleep(max(1, interval * 60 - (time.monotonic() - started)))
        finally:
            if not keep_history:
                path.unlink(missing_ok=True)
    except KeyboardInterrupt:
        log("Monitor encerrado.")
        return 0
    except (ValueError, KeyError, TypeError, OSError):
        log("Não foi possível iniciar. Confira o .env, o projeto, a porta do modo web, as permissões e o estado em gitlab-history/; verifique se outro monitor já está ativo.")
        return 1
    finally:
        if lock is not None:
            lock.close()


if __name__ == "__main__":
    sys.exit(main())
