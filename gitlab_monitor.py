#!/usr/bin/env python3
"""Monitors MRs via GET, with no external Python packages (Python 3.9+).

Four modes. Without --mode, the mode is asked in the terminal:
  1 - Monitoring: tracks the MRs and alerts on every change, until Ctrl+C.
  2 - Current report: queries once and prints the table of open MRs,
      with likes, author, threads, who opened the threads and the pipeline
      status. The MR column's text links to the MR.
  3 - Terminal panel: the report's table, redrawn on every interval.
  4 - Browser panel: the same table in the Angular interface, served on
      127.0.0.1. The page refreshes itself, sorts and filters the table,
      changes project and interval in Settings (valid only for this run,
      never written to .env) and can notify through the browser. The
      panel's preferences live in user-data/preferences.json.
      Requires the Angular build in frontend/dist/gitlab-monitor/browser
      (make front-build; make web builds it when missing).
The panels also alert on changes, but keep the reference in memory: they
don't use the on-disk history or the lock, so they coexist with a monitor
of the same project. Panel 3 uses the system notifier and respects
--no-notify; panel 4 doesn't use the system notifier — the browser does the
alerting, with notifications on by default on the page.
Mode 2 queries once and compares nothing.
Without an interactive terminal (make, cron, pipe), the mode is monitoring.

Usage from the monitor's folder:
     python3 gitlab_monitor.py https://gitlab.example/group/project
     python3 gitlab_monitor.py group/project --once --no-notify
     python3 gitlab_monitor.py group/project --mode relatorio
     python3 gitlab_monitor.py --mode web --port 8765
     python3 gitlab_monitor.py --mode web   # targets and interval come from the panel
Equivalent shortcuts: make monitor, make report, make panel, make web
(require .venv).

In the terminal modes (monitorar, relatorio and painel) the project is a
required positional argument and --interval is optional (15 minutes by
default). In web mode the targets and the interval are chosen on the panel
and saved in user-data/preferences.json; opening it with no targets is valid.
A positional argument given in web mode overrides the saved targets, and
--interval overrides the saved interval.

Accepted formats for PROJECTS:
  https://gitlab.example/group/project
  https://gitlab.example/group/subgroup/project
  https://gitlab.example/group/project.git
  https://gitlab.example/group/project/-/merge_requests
  group/subgroup/project
  123  (numeric project ID)
  groups/group/subgroup  (canonical group form, the same the monitor prints)

URLs must use HTTPS and the same instance as GITLAB_API_URL in .env.
Parameters after ? and fragments after # are ignored: the monitor queries
ALL open MRs of the project or group, walking through every page. Quote URLs
with parameters in the terminal to protect characters like &.

Accepted format for GROUPS (includes projects from subgroups the token can access):
  https://gitlab.fpf.br/groups/flake/siga/-/merge_requests/
For groups, the URL must end in /-/merge_requests, with an optional trailing slash.
Example: python3 gitlab_monitor.py https://gitlab.fpf.br/groups/flake/siga/-/merge_requests/
SSH links (git@gitlab.example:group/project.git) are also not supported.

Reads GITLAB_API_URL and GITLAB_TOKEN from the .env file next to this script
(without executing its contents). Likes are 👍 reactions, not approvals. Discussions are counted,
identified by id across queries and checked for resolution and new replies;
a standalone comment (without a resolvable thread) counts toward the total
but has no resolution state. The first query creates
the reference; the following ones alert on changes. Ctrl+C stops the monitor.
The reference is saved in gitlab-history/, next to .env, and by default is
deleted when the session ends — use --keep-history true to preserve it and
resume the comparison on the next run.
The computer needs to be awake and the process running to query. Intermediate
states between queries may not be observed.
Notifications require a graphical user session: osascript on macOS,
Windows PowerShell with Windows Forms on Windows, and libnotify-bin with a
notification server on the session's D-Bus on Ubuntu Desktop. Do not run with sudo.
On Windows: py -3 gitlab_monitor.py group/project --interval 15
Standalone test: python3 gitlab_monitor.py --test-notify
API: https://docs.gitlab.com/api/merge_requests/
"""

import argparse
import base64
import collections
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

# Preferências do painel: um arquivo só, ignorado pelo git, dono de tudo o que
# o painel guarda. O backend valida a casca; o conteúdo de cada chave é
# validado por quem o usa, no painel — exceto as de primeira pintura.
USER_DATA_DIR = ROOT / "user-data"
PREFERENCES_FILE = USER_DATA_DIR / "preferences.json"
PREFERENCES_VERSION = 1
PREFERENCES_MAX_BYTES = 262144
PREFERENCE_KEYS = ("theme", "language", "textSize", "density", "hiddenColumns",
                   "columnOrder", "likesHighlight", "filters", "rowRules",
                   "notifyRules", "presets", "monitoredProjects", "interval")
# Estas quatro vão para o HTML: só valor de lista fechada.
FIRST_PAINT_CHOICES = {
    "theme": ("auto", "light", "dark"),
    "language": ("pt", "en"),
    "textSize": ("sm", "md", "lg"),
    "density": ("comfortable", "compact"),
}
PREFERENCES_LOCK = threading.Lock()

# Quantos alvos o painel monitora de uma vez e de quantos em quantos minutos.
MAX_TARGETS = 20
DEFAULT_INTERVAL = 15

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
                raise ValueError(f"Invalid value for {key} in .env.") from None
            if len(parts) != 1:
                raise ValueError(f"Invalid value for {key} in .env.")
            values[key] = parts[0]
        else:
            values[key] = re.split(r"\s+#", raw, maxsplit=1)[0].strip()
    return values


def credentials(path):
    values = read_env(path, ("GITLAB_API_URL", "GITLAB_TOKEN"))
    if not all(values.get(key) for key in ("GITLAB_API_URL", "GITLAB_TOKEN")):
        raise ValueError("Set GITLAB_API_URL and GITLAB_TOKEN in the .env file.")
    base = values["GITLAB_API_URL"].rstrip("/")
    url = urlsplit(base)
    if url.scheme != "https" or not url.netloc or url.username or url.password or url.query or url.fragment:
        raise ValueError("GITLAB_API_URL must be an HTTPS URL, without credentials or a query string.")
    if not base.endswith("/api/v4"):
        base += "/api/v4"
    return base, values["GITLAB_TOKEN"]


def project_path(value, base):
    if "://" in value:
        url, api = urlsplit(value), urlsplit(base)
        if url.scheme != "https" or url.netloc != api.netloc or url.username:
            raise ValueError("The project link must belong to the GitLab instance set in .env.")
        prefix = api.path.removesuffix("/api/v4")
        if not url.path.startswith(prefix + "/"):
            raise ValueError("Link outside the GitLab instance path.")
        relative = unquote(url.path[len(prefix):]).strip("/")
        if relative.startswith("groups/"):
            match = re.fullmatch(r"groups/(.+)/-/merge_requests", relative)
            if not match or any(part in ("", ".", "..", "-") for part in match[1].split("/")):
                raise ValueError("Group URL must end in /-/merge_requests/.")
            return "groups/" + quote(match[1], safe="")
        value = relative.split("/-/", 1)[0]
    value = value.strip("/").removesuffix(".git")
    # Forma canônica de grupo, a mesma que o monitor imprime e que o painel
    # devolve no formulário: precisa voltar a ser aceita sem virar projeto.
    if value.startswith("groups/"):
        group = value[len("groups/"):].strip("/")
        if not group or any(part in ("", ".", "..", "-") for part in group.split("/")):
            raise ValueError("Provide the group as groups/path or via the MRs URL.")
        return "groups/" + quote(group, safe="")
    if not value or (not value.isdigit() and "/" not in value):
        raise ValueError("Provide the link, group/project path, or numeric project ID.")
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
        # Raiz web (sem "/api/v4"): serve tanto o GraphQL quanto os webPath
        # relativos que ele devolve, que a REST sempre mandava já absolutos.
        self.web_root = base.rsplit("/api/v4", 1)[0]
        self._namespace_cache = {}

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
            raise RuntimeError(f"GitLab returned HTTP {exc.code}; previous state preserved.") from None
        except (URLError, TimeoutError, OSError):
            raise RuntimeError("Connection to GitLab failed; previous state preserved.") from None

    def pages(self, path, **params):
        page = 1
        while True:
            batch, headers = self.get(path, per_page=100, page=page, **params)
            if not isinstance(batch, list):
                raise ValueError("Unexpected response while listing from GitLab.")
            yield from batch
            next_page = headers.get("X-Next-Page")
            if next_page:
                following = int(next_page)
                if following <= page:
                    raise ValueError("Invalid pagination in GitLab's response.")
                page = following
            elif next_page is not None or len(batch) < 100:
                return
            else:
                page += 1

    def memberships(self):
        """Projetos e grupos do dono do token, na forma que o painel devolve.

        `value` é a forma canônica de `project_path`, a que o POST /settings
        aceita de volta. Grupos primeiro; dentro de cada tipo, pelo `label`.
        """
        groups = sorted(
            ({"value": "groups/" + quote(row["full_path"], safe=""),
              "label": row["full_path"], "kind": "group"}
             for row in self.pages("/groups", min_access_level=10)),
            key=lambda item: item["label"])
        projects = sorted(
            ({"value": quote(row["path_with_namespace"], safe=""),
              "label": row["path_with_namespace"], "kind": "project"}
             for row in self.pages("/projects", membership="true", simple="true", archived="false")),
            key=lambda item: item["label"])
        return groups + projects

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

    def graphql(self, operation, query, variables):
        # Mesmo endereço base da REST, um nível acima: /api/v4 → /api/graphql.
        url = self.web_root + "/api/graphql"
        payload = json.dumps({"operationName": operation, "query": query,
                             "variables": variables}).encode("utf-8")
        request = Request(url, data=payload, headers={
            "PRIVATE-TOKEN": self.token, "Content-Type": "application/json",
            "Accept": "application/json"})
        try:
            with self.opener.open(request, timeout=30) as response:
                body = json.load(response)
        except HTTPError as exc:
            raise RuntimeError(f"GitLab returned HTTP {exc.code}; previous state preserved.") from None
        except (URLError, TimeoutError, OSError):
            raise RuntimeError("Connection to GitLab failed; previous state preserved.") from None
        if body.get("errors"):
            # Não repete a query nem variáveis na mensagem: evita vazar o
            # alvo (e, em tese, filtros) em logs externos.
            raise RuntimeError("GitLab rejected the GraphQL query; previous state preserved.")
        return body["data"]

    def namespace(self, project):
        """("group"|"project", caminho completo sem escape) para a GraphQL.

        Resolvido uma vez por alvo e guardado: um ID numérico de projeto
        exige 1 chamada REST para descobrir o caminho (fullPath), já que a
        GraphQL só aceita grupo/projeto pelo caminho, nunca pelo ID simples.
        """
        if project not in self._namespace_cache:
            if project.startswith("groups/"):
                self._namespace_cache[project] = ("group", unquote(project[len("groups/"):]))
            else:
                path = unquote(project)
                if path.isdigit():
                    row, _ = self.get(f"/projects/{path}")
                    path = row["path_with_namespace"]
                self._namespace_cache[project] = ("project", path)
        return self._namespace_cache[project]

    def track(self, project):
        """MRs abertos do alvo, com pipeline, threads e likes — 1 requisição.

        Troca os antigos N+1 (listagem + 1 detail/discussions por MR + 1
        pipelines por projeto) por uma única consulta GraphQL: o mesmo
        mecanismo que a própria página de MRs do GitLab usa, com threads
        aninhadas para também trazer quem abriu cada uma (a página não
        precisa disso, mas o campo existe e cabe na mesma consulta).

        Devolve (nós, chave → nó, curtidos): nós na ordem da API, um dict
        pela chave que o resto do script usa ("project_id:iid" em grupo,
        só o iid em projeto) e o conjunto de chaves que o dono do token
        curtiu. Limite de 100 threads por MR e 100 MRs por página: acima
        disso, a tabela fica incompleta nesta passagem — caso extremo não
        visto em uso real, documentado no README em vez de resolvido com
        paginação aninhada.
        """
        kind, path = self.namespace(project)
        is_group = kind == "group"
        scope_filter = "includeSubgroups: true, " if is_group else ""
        query = f"""
            query acompanhamento($fullPath: ID!, $pageSize: Int, $reaction: String, $after: String) {{
              target: {kind}(fullPath: $fullPath) {{
                id
                mergeRequests(state: opened, {scope_filter}first: $pageSize, after: $after) {{
                  pageInfo {{ hasNextPage endCursor }}
                  nodes {{
                    iid
                    title
                    createdAt
                    updatedAt
                    upvotes
                    webPath
                    mergeable
                    conflicts
                    author {{ username }}
                    headPipeline {{ id status }}
                    project {{ id }}
                    assignees {{ nodes {{ username }} }}
                    reviewers {{ nodes {{ username mergeRequestInteraction {{ reviewState }} }} }}
                    awardEmoji(first: 100) {{
                      nodes {{
                        name
                        user {{ username }}
                      }}
                    }}
                    discussions(first: 100) {{
                      nodes {{
                        id
                        resolvable
                        resolved
                        notes(first: 100) {{ nodes {{ author {{ username }} }} }}
                      }}
                    }}
                  }}
                }}
              }}
              liked: {kind}(fullPath: $fullPath) {{
                mergeRequests(state: opened, {scope_filter}myReactionEmoji: $reaction, first: $pageSize) {{
                  nodes {{ iid project {{ id }} }}
                }}
              }}
              eu: currentUser {{ username }}
            }}
        """
        nos, mine, me, cursor = [], set(), None, None
        while True:
            dados = self.graphql("acompanhamento", query, {
                "fullPath": path, "pageSize": 100, "reaction": "thumbsup",
                "after": cursor,
            })
            batch = dados["target"]["mergeRequests"]
            nos.extend(batch["nodes"])
            if cursor is None:
                for item in dados["liked"]["mergeRequests"]["nodes"]:
                    mine.add(self._chave(item, is_group))
                # Quem sou eu, pela mesma consulta: usado para não contar como
                # "thread" uma discussão onde só eu mesma comentei, no meu
                # próprio MR (ver report_row/thread_summary).
                me = (dados.get("eu") or {}).get("username")
            if not batch["pageInfo"]["hasNextPage"]:
                break
            cursor = batch["pageInfo"]["endCursor"]
        por_chave = {self._chave(no, is_group): no for no in nos}
        return nos, por_chave, mine, me

    @staticmethod
    def _chave(node, is_group):
        if not is_group:
            return str(node["iid"])
        projeto = node["project"]["id"].rsplit("/", 1)[-1]
        return f'{projeto}:{node["iid"]}'


def graphql_row(node, web_root):
    """Nó do GraphQL.track() no formato que snapshot()/report_row() esperam.

    O mesmo formato que a REST já usava: author/head_pipeline como dict,
    web_url absoluta (o GraphQL só devolve o caminho), status em minúsculas
    (o GraphQL devolve o enum em maiúsculas, ex. "SUCCESS").
    """
    pipeline = node["headPipeline"]
    # "thumbsup" é a mesma reação que upvotes conta; outros emojis (❤️, 🎉...)
    # não são "like" para o monitor e ficam de fora da lista de quem curtiu.
    likers = [item["user"]["username"] for item in node["awardEmoji"]["nodes"]
              if item["name"] == "thumbsup" and item.get("user")]
    return {
        "iid": node["iid"], "title": node["title"], "upvotes": node["upvotes"],
        "created_at": node["createdAt"], "updated_at": node["updatedAt"],
        "author": node["author"] or {},
        "web_url": web_root + node["webPath"],
        "head_pipeline": None if pipeline is None else {
            "id": pipeline["id"], "status": pipeline["status"].lower()},
        "mergeable": node["mergeable"], "conflicts": node["conflicts"],
        "likers": likers,
        "assignees": graphql_assignees(node),
        "reviewers": graphql_reviewers(node),
    }


def graphql_assignees(node):
    """Usernames dos assignees; campo ausente ou null vira lista vazia."""
    return [item["username"] for item in (node.get("assignees") or {}).get("nodes") or []]


def graphql_reviewers(node):
    """[(username, estado)] com o estado em minúsculas (ex. "requested_changes").

    O GraphQL costuma omitir o campo, e a interação pode vir nula: nos dois
    casos o revisor continua na lista e o estado é "" (desconhecido)."""
    return [(item["username"],
             ((item.get("mergeRequestInteraction") or {}).get("reviewState") or "").lower())
            for item in (node.get("reviewers") or {}).get("nodes") or []]


def graphql_discussions(node):
    """Threads do nó no formato que thread_summary()/discussion_snapshot() esperam.

    resolvable/resolved vêm por discussão no GraphQL; o formato REST original
    os trazia por nota. Replicamos essas duas chaves só na primeira nota (o
    bastante para o que discussion_snapshot()/thread_summary() leem), mas
    mantemos TODAS as notas — não só a primeira — para que thread_summary()
    enxergue também quem respondeu ou deixou um comentário avulso, não só
    quem abriu a thread.
    """
    discussoes = []
    for discussion in node["discussions"]["nodes"]:
        brutas = discussion["notes"]["nodes"]
        notas = [{"author": nota["author"] or {"username": "—"}} for nota in brutas]
        if not notas:
            notas = [{"author": {"username": "—"}}]
        notas[0] = {**notas[0], "resolvable": discussion["resolvable"],
                   "resolved": discussion["resolved"]}
        discussoes.append({"id": discussion["id"], "notes": notas})
    return discussoes


def snapshot(row, discussions, mine=False, involved=False, reviewing=False):
    pipeline = row["head_pipeline"]
    return {
        "title": row["title"], "url": row["web_url"], "likes": row["upvotes"],
        # Autoria e "meu" ficam no snapshot para o evento de um MR que saiu da
        # lista ainda dizer de quem era, sem outra consulta ao GitLab.
        "author": (row.get("author") or {}).get("username", "—"), "mine": mine,
        "involved": involved,
        # Se EU sou assignee ou revisora: é o que dispara o evento "review".
        "reviewing": reviewing,
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


# width é a largura da coluna na tabela de terminal; cell e weight descrevem
# a mesma coluna no painel web (que tipo de célula desenhar e quanto da
# largura ela recebe). Ficam aqui, e não no frontend, para que a lista de
# colunas tenha um dono só — o painel apenas desenha o que /data descreve.
Column = collections.namedtuple("Column", "key label width cell weight")

REPORT_COLUMNS = (Column("likes", "Likes", 8, "likes", 10),
                  Column("mr", "MR", 54, "link", 50),
                  Column("author", "Autor", 18, "text", 18),
                  Column("threads", "Threads", 15, "badge", 13),
                  Column("openers", "Participantes", 30, "text", 20),
                  Column("review", "Revisão", 24, "people", 16),
                  Column("mergeable", "Mergeável", 15, "badge", 13),
                  Column("conflicts", "Conflitos", 15, "badge", 13),
                  Column("pipeline", "Pipeline", 16, "badge", 13),
                  Column("updated_label", "Atualizado", 13, "time", 18),
                  Column("created_label", "Criado", 12, "text", 14))

# Só emoji de largura leste-asiática W: os de largura ambígua são desenhados
# com duas colunas por muitos terminais e desalinhariam a tabela.
PIPELINE_STATUS = {
    "success": "\N{WHITE HEAVY CHECK MARK} sucesso",
    "failed": "\N{CROSS MARK} falhou",
    "running": "\N{ANTICLOCKWISE DOWNWARDS AND UPWARDS OPEN CIRCLE ARROWS} rodando",
    "created": "\N{HOURGLASS WITH FLOWING SAND} criada",
    "preparing": "\N{HOURGLASS WITH FLOWING SAND} preparando",
    "pending": "\N{HOURGLASS WITH FLOWING SAND} pendente",
    "waiting_for_resource": "\N{HOURGLASS WITH FLOWING SAND} aguardando",
    "canceled": "\N{MEDIUM WHITE CIRCLE} cancelada",
    "canceling": "\N{MEDIUM WHITE CIRCLE} cancelando",
    "skipped": "\N{BLACK RIGHT-POINTING DOUBLE TRIANGLE} pulada",
    "manual": "\N{RAISED HAND} manual",
    "scheduled": "\N{ALARM CLOCK} agendada",
}


# A partir de quantos 👍 o MR ganha destaque visual na tabela.
LIKES_HIGHLIGHT = 2

# Marca o MR cujos likes incluem o seu. Um sinal estreito, e não um emoji: de
# largura previsível em uma coluna, sem desalinhar a tabela do terminal.
MINE_MARK = "\N{CHECK MARK}"

# Tom semântico por intenção, conforme o guia de feedback.
PIPELINE_TONES = {"success": "success", "failed": "danger", "running": "info",
                  "created": "warning", "preparing": "warning", "pending": "warning",
                  "waiting_for_resource": "warning"}

# mergeable/conflicts vêm da GraphQL (ver GitLab.track); ausentes em dados
# de teste mais antigos, daí o rótulo de "desconhecido" para None.
UNKNOWN_LABEL = "— desconhecido"
MERGEABLE_LABEL = {True: "\N{WHITE HEAVY CHECK MARK} mergeável", False: "\N{CROSS MARK} bloqueado"}
CONFLICT_LABEL = {True: "\N{CROSS MARK} conflito", False: "\N{WHITE HEAVY CHECK MARK} sem conflito"}


def project_label(web_url):
    """BE/FE para os repositórios do time; nome curto para qualquer outro."""
    name = urlsplit(web_url).path.split("/-/", 1)[0].strip("/").rsplit("/", 1)[-1]
    for suffix, label in (("-backend", "BE"), ("-frontend", "FE")):
        if name.endswith(suffix):
            return label
    return name


def thread_summary(discussions, skip_self_only=None):
    """Conta apenas threads resolvíveis (comentário avulso não é thread), mas
    reúne TODOS os participantes: quem abriu uma thread, quem respondeu nela
    e quem só deixou um comentário avulso — não só quem abriu.

    skip_self_only: usuário cujas threads "sozinhas" (só notas dele mesmo,
    ninguém mais participou) não contam para o total/resolved — pensado para
    quando o usuário é o autor do MR e comenta com ele mesmo (nota solta, sem
    revisor envolvido). Continua valendo para participants."""
    total = resolved = 0
    participants = []
    for discussion in discussions:
        notes = discussion["notes"]
        resolvable = bool(notes) and any(note.get("resolvable") for note in notes)
        if resolvable and skip_self_only:
            authors = {note["author"]["username"] for note in notes}
            if authors == {skip_self_only}:
                resolvable = False
        if resolvable:
            total += 1
            if notes[0].get("resolved"):
                resolved += 1
        for note in notes:
            author = note["author"]["username"]
            if author not in participants:
                participants.append(author)
    return total, resolved, participants


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


# Limiar, singular e plural de cada unidade, da mais larga para a mais
# estreita: a primeira que caiba na diferença decide a unidade exibida,
# como o GitLab faz na própria página ("3 hours ago", "23 minutes ago").
RELATIVE_UNITS = (
    (365 * 86400, "ano", "anos"), (30 * 86400, "mês", "meses"),
    (86400, "dia", "dias"), (3600, "hora", "horas"), (60, "minuto", "minutos"),
)


def relative_time(moment, now=None):
    """"3 hours ago", "23 minutes ago": mesma granularidade da página do GitLab.

    now é parâmetro só para teste determinístico; na operação normal é
    sempre o instante da própria consulta, recalculado a cada ciclo.
    """
    if moment <= EPOCH:
        return "—"
    seconds = ((now or datetime.now(timezone.utc)) - moment).total_seconds()
    if seconds < 60:
        return "agora mesmo"
    for duration, singular, plural in RELATIVE_UNITS:
        amount = int(seconds // duration)
        if amount >= 1:
            return f"há {amount} {singular if amount == 1 else plural}"
    return "agora mesmo"  # inalcançável: minuto já cobriu segundos >= 60


# O GitLab considera rascunho o título que começa assim, sem diferenciar caixa.
DRAFT_TITLE = re.compile(r"^\s*(draft|wip):", re.IGNORECASE)


# Tom da célula "review" pelo MEU estado de revisão; os demais ficam neutros.
REVIEW_TONES = {"unreviewed": "warning", "requested_changes": "danger",
                "approved": "success", "reviewed": "success"}


def report_row(row, discussions, mine=False, me=None):
    author = (row.get("author") or {}).get("username", "—")
    # Só ignora thread "comigo mesma sozinha" no MEU próprio MR: como
    # revisora, minhas threads nos MRs de outra pessoa continuam contando.
    total, resolved, openers = thread_summary(
        discussions, skip_self_only=me if me and me == author else None)
    # O autor do MR não é um "participante" nesse sentido: comentar no
    # próprio MR não é a mesma coisa que outra pessoa ter se envolvido.
    openers = [name for name in openers if name != author]
    # "Envolvida" é mais largo que "curti": o GitLab em geral não deixa curtir
    # o próprio MR, então só o 👍 calaria justamente os MRs de quem olha.
    involved = bool(mine or (me and (me == author or me in openers)))
    # `openers` já tira o autor, então "participei" no MR alheio é estar nele.
    created = created_at(row.get("created_at"))
    updated = created_at(row.get("updated_at"))
    mergeable = row.get("mergeable")
    conflicts = row.get("conflicts")
    # Campo ausente ou null é lista vazia, o caminho comum na GraphQL.
    assignees = list(row.get("assignees") or [])
    reviewers = list(row.get("reviewers") or [])
    my_review_state = next((state for name, state in reviewers if me and name == me), "")
    # Uma pessoa que é assignee e revisora aparece uma vez só no rótulo.
    people = list(dict.fromkeys(assignees + [name for name, _ in reviewers]))
    return {
        "likes": f'{row["upvotes"]} \N{THUMBS UP SIGN}' + (f" {MINE_MARK}" if mine else ""),
        "mine": mine,
        "involved": involved,
        # Quem reagiu com 👍, pelo awardEmoji da mesma consulta; mostrado
        # abaixo da contagem no painel web, sem chamada extra ao GitLab.
        "likers": list(row.get("likers") or []),
        "mr": f'{project_label(row["web_url"])} #{row["iid"]} {row["title"]}',
        # Campos que o monitoramento não exigia: ausência não derruba o ciclo.
        "author": (row.get("author") or {}).get("username", "—"),
        "threads": f"{resolved}/{total} resolvidas" if total else "sem threads",
        # Contagem crua e lista de nomes: o painel monta o texto no idioma
        # ativo, e o rótulo acima continua sendo o do terminal.
        "threads_resolved": resolved,
        "threads_total": total,
        "openers_names": list(openers),
        "openers": ", ".join(openers) or "—",
        # Rótulo do terminal; os valores crus vão ao lado para o painel.
        "review": " · ".join(people) or "—",
        # A mesma lista do rótulo, crua: no painel cada pessoa ocupa uma
        # linha, e juntar nomes num texto só obrigaria a tela a parti-lo.
        "review_names": people,
        "assignees_names": assignees,
        "reviewers_list": reviewers,
        "assigned_to_me": bool(me and me in assignees),
        "reviewing_mine": bool(me and any(name == me for name, _ in reviewers)),
        "my_review_state": my_review_state,
        "review_tone": REVIEW_TONES.get(my_review_state),
        "mergeable": MERGEABLE_LABEL.get(mergeable, UNKNOWN_LABEL),
        # Valores crus (o rótulo "—" não diz quantos são nem se é rascunho):
        # alimentam os "facts" que o painel compara em vez de ler o texto.
        "participants": len(openers),
        "mergeable_value": mergeable,
        "conflicts_value": conflicts,
        "draft": bool(DRAFT_TITLE.match(row.get("title") or "")),
        # Mesmo tom do pipeline "success": mesclável é o estado bom, não neutro.
        "mergeable_tone": "success" if mergeable is True else "danger" if mergeable is False else None,
        "conflicts": CONFLICT_LABEL.get(conflicts, UNKNOWN_LABEL),
        "conflicts_tone": "danger" if conflicts else None,
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
        # Relativo, como a própria página do GitLab mostra ("3 hours ago");
        # a data e hora exatas ficam só no título do elemento, na web.
        "updated": updated,
        "updated_label": relative_time(updated),
        "updated_title": f"{updated:%d/%m/%Y %H:%M}" if updated > EPOCH else "",
        # Valores crus, usados só para ordenar e filtrar no painel.
        "upvotes": row["upvotes"],
        "unresolved": total - resolved,
        "status": (row["head_pipeline"] or {}).get("status") or "",
    }


def report(client, targets):
    """Uma única passagem pelos MRs abertos, sem histórico e sem notificação."""
    return scan(client, targets)[2]


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
    head = [textwrap.wrap(column.label, column.width) for column in REPORT_COLUMNS]
    body = [[textwrap.wrap(row[column.key], column.width) or [""] for column in REPORT_COLUMNS]
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
                 url if column.key == "mr" else None)
            for column, line, width in zip(REPORT_COLUMNS, cells, widths)) + " │"
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
        changes.append(f'DISCUSSIONS {len(old)} → {len(new)}')
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
        changes.append(f'{resolved} DISCUSSION(S) RESOLVED')
    if reopened:
        changes.append(f'{reopened} DISCUSSION(S) REOPENED')
    if replied:
        changes.append(f'{replied} DISCUSSION(S) WITH NEW REPLY')
    return changes


def scan_target(client, project, previous):
    """Uma passagem por um único alvo: snapshots, eventos e linhas da tabela.

    `previous` são os snapshots deste alvo (ou None na primeira passagem).
    """
    current, removed, rows = {}, {}, []
    # Um único GraphQL por ciclo: MRs, pipeline, threads (com quem abriu),
    # likes próprios e usuário atual juntos. Ver GitLab.track.
    _, por_chave, mine, me = client.track(project)
    for key, node in por_chave.items():
        row = graphql_row(node, client.web_root)
        discussions = graphql_discussions(node)
        table_row = report_row(row, discussions, key in mine, me=me)
        current[key] = snapshot(row, discussions, key in mine, table_row["involved"],
                                table_row["assigned_to_me"] or table_row["reviewing_mine"])
        rows.append(table_row)
    # Confirma saídas individualmente; 403/404 nunca significam "mesclado".
    # A listagem já filtra por "opened": o que sumiu de um ciclo para o
    # outro é o único caso que ainda precisa de confirmação por MR.
    for iid in (previous or {}).keys() - current.keys():
        row = client.detail(project, iid)
        if row["state"] == "opened":
            # O REST não diz nada sobre a minha revisão: herda o que já havia
            # (e, se não havia nada, também não afirma nada).
            current[iid] = snapshot(row, client.discussions(project, iid))
            if "reviewing" in previous[iid]:
                current[iid]["reviewing"] = previous[iid]["reviewing"]
            else:
                del current[iid]["reviewing"]
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
        # O tipo é o que o painel filtra; o texto continua sendo o do terminal.
        changes = []
        if old is None:
            changes.append(("opened", "NEW MR OPENED"))
        elif new is None:
            changes.append(("left", {"merged": "MERGED", "closed": "CLOSED"}.get(
                removed[iid], f"LEFT THE OPEN LIST ({removed[iid]})")))
        else:
            if old["likes"] != new["likes"]:
                changes.append(("likes", f'LIKES {old["likes"]} → {new["likes"]}'))
            # Snapshot anterior à existência do campo (histórico em disco) não
            # diz nada sobre a minha revisão: sem comparação, sem aviso falso.
            if "reviewing" in old and old["reviewing"] != new.get("reviewing", old["reviewing"]):
                changes.append(("review", "REVIEW REQUESTED FROM YOU" if new["reviewing"]
                                else "NO LONGER ASSIGNED TO YOU FOR REVIEW"))
            if old["pipeline"] != new["pipeline"]:
                changes.append(("pipeline", f'PIPELINE {pipeline_label(old["pipeline"])} → {pipeline_label(new["pipeline"])}'))
            changes.extend(("threads", text)
                           for text in discussion_changes(old["discussions"], new["discussions"]))
        for kind, change in changes:
            # Uma informação por linha: identificação, mudança e link.
            events.append({
                "kind": kind, "text": f'{header}\n{change}\n{row["url"]}',
                "mr": iid, "title": row["title"], "author": row.get("author", "—"),
                "url": row["url"], "likes": row["likes"], "mine": row.get("mine", False),
                "involved": row.get("involved", False),
                "draft": bool(DRAFT_TITLE.match(row["title"] or "")),
            })
    return current, events, rows


def scan(client, targets, previous=None):
    """Uma passagem por todos os alvos: {alvo: snapshots}, eventos, linhas e falhas.

    A chave de um MR (`iid` ou `project_id:iid`) só é única dentro do alvo, por
    isso o snapshot é aninhado por alvo e cada um é comparado com o próprio
    anterior. Monitoramento e painéis partilham esta função para que a tabela e
    os eventos venham do mesmo conjunto de requisições, sem consultar duas vezes.
    """
    current, events, rows, seen, failures = {}, [], [], set(), []
    for target in targets:
        before = (previous or {}).get(target)
        try:
            snapshots, target_events, target_rows = scan_target(client, target, before)
        except (RuntimeError, KeyError, TypeError) as exc:
            # Um alvo com falha não derruba os outros: mantém a referência
            # anterior e não contribui com linhas nem eventos neste ciclo.
            failures.append((target, exc))
            if before is not None:
                current[target] = before
            continue
        current[target] = snapshots
        # O mesmo MR pode aparecer em dois alvos (projeto e grupo que o contém):
        # vale a primeira ocorrência, na ordem dos alvos. A URL de linhas e de
        # eventos já vistos em alvos anteriores vale para os dois, porque um MR
        # que saiu da lista (merged/closed) emite evento sem ter linha.
        rows.extend(item for item in target_rows if item["url"] not in seen)
        events.extend(item for item in target_events if item["url"] not in seen)
        seen.update(item["url"] for item in target_rows)
        seen.update(item["url"] for item in target_events)
    if failures and len(failures) == len(targets):
        # Nada foi coletado: quem chamou precisa saber, como com um alvo só.
        raise failures[-1][1] from None
    for target, exc in failures:
        log(str(exc) if isinstance(exc, RuntimeError)
            else f"Unexpected response from GitLab for {unquote(target)}; previous snapshot preserved.")
    # Mais recentes primeiro, sobre a união; o rótulo só desempata datas idênticas.
    rows.sort(key=lambda item: item["mr"])
    rows.sort(key=lambda item: item["created"], reverse=True)
    return current, events, rows, [target for target, _ in failures]


def count_snapshots(snapshots):
    """Quantos MRs há num snapshot aninhado por alvo."""
    return sum(len(item) for item in snapshots.values())


def collect(client, targets, previous):
    current, events, _, _ = scan(client, targets, previous)
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
            "message": windows_text(message or "Update in GitLab Monitor.", 255),
        }, ensure_ascii=True), text=True, encoding="utf-8", errors="replace")
    else:
        log(f"Native notifications aren't available on this platform: {sys.platform}.")
        return False
    executable = shutil.which(command[0])
    if not executable:
        hint = " Install libnotify-bin on Ubuntu Desktop." if sys.platform.startswith("linux") else ""
        log(f"Notification unavailable: executable {command[0]} not found.{hint}")
        return False
    command[0] = executable
    try:
        subprocess.run(command, check=True, capture_output=True, **options)
        return True
    except subprocess.TimeoutExpired:
        log(f"Notification failed ({Path(executable).name}): timeout of {options['timeout']}s exceeded.")
    except subprocess.CalledProcessError as exc:
        detail = notification_error_detail(exc.stderr)
        log(f"Notification failed ({Path(executable).name}): exit code {exc.returncode}. {detail}")
    except OSError as exc:
        log(f"Failed to start notifier ({Path(executable).name}): {notification_error_detail(str(exc))}")
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
            raise ValueError("A monitor is already running for this project.") from None
    else:
        import fcntl
        handle = path.open("a")
        try:
            fcntl.flock(handle, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            handle.close()
            raise ValueError("A monitor is already running for this project.") from None
    return handle


# Build do Angular (ng build); ver frontend/angular.json (outputPath). O Python só serve os arquivos estáticos gerados,
# nunca monta HTML para o painel: quem renderiza a página é o Angular.
FRONTEND_DIST = Path(__file__).resolve().parent / "frontend" / "dist" / "gitlab-monitor" / "browser"

FRONTEND_MIME = {
    ".html": "text/html", ".js": "text/javascript", ".mjs": "text/javascript",
    ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml",
    ".ico": "image/x-icon", ".png": "image/png", ".woff": "font/woff",
    ".woff2": "font/woff2", ".map": "application/json", ".txt": "text/plain",
}


def frontend_asset(path):
    """Arquivo do build Angular para `path`; None se não existir ou se o
    caminho tentar escapar de FRONTEND_DIST (ex.: "../../.env")."""
    try:
        target = (FRONTEND_DIST / path.lstrip("/")).resolve()
    except (OSError, ValueError):
        return None
    if target != FRONTEND_DIST and FRONTEND_DIST not in target.parents:
        return None
    return target if target.is_file() else None


def page_fallback(path):
    """Alvo servido para `path`: o arquivo do build, ou o index.html quando o
    caminho é uma rota do Angular (ex.: /settings). Recarregar uma página
    não pode dar 404; já um arquivo que falta (último segmento com ponto,
    como /assets/i18n/xx.json) continua sendo 404."""
    target = frontend_asset(path)
    if target is None and "." not in path.rsplit("/", 1)[-1]:
        return frontend_asset("/index.html")
    return target


# Ordenações oferecidas na barra da tabela. A lista já vem por data decrescente,
# e a ordenação do Python é estável: cada critério abaixo desempata por data.
# column e direction ligam a ordenação à coluna que ela ordena: é o que
# deixa a seta aparecer no cabeçalho certo, e o clique no cabeçalho escolher
# a ordenação correspondente. Ficam aqui, e não no painel, pelo mesmo motivo
# do rótulo e do peso — a lista de colunas tem um dono só.
Sort = collections.namedtuple("Sort", "key label order column direction")

# O rótulo nomeia a COLUNA, não um sentido: quem escolhe o sentido é quem
# olha, clicando de novo no cabeçalho. "Mais likes" mentiria metade do tempo.
# `direction` continua sendo o sentido natural, o que vale sem ninguém pedir
# outro, e `order` é a chave nesse sentido — invertê-lo é reordenar com
# reverse=True, nunca negar a chave de novo.
SORTS = (
    Sort("recent", "Criado", None, "created_label", "desc"),
    Sort("updated", "Atualizado",
         lambda row: -row["updated"].timestamp(), "updated_label", "desc"),
    Sort("likes", "Likes", lambda row: -row["upvotes"], "likes", "desc"),
    Sort("mr", "MR", lambda row: row["mr"].casefold(), "mr", "asc"),
    Sort("author", "Autor", lambda row: row["author"].casefold(), "author", "asc"),
    Sort("threads", "Threads", lambda row: -row["unresolved"],
         "threads", "desc"),
    Sort("participants", "Participantes", lambda row: row["openers"].casefold(),
         "openers", "asc"),
    Sort("pipeline", "Pipeline",
         lambda row: PIPELINE_ORDER.get(row["status"], 50), "pipeline", "asc"),
)

SORT_KEYS = {item.key: item for item in SORTS}

# Os dois sentidos que a consulta aceita; qualquer outro valor é o natural.
DIRECTIONS = ("asc", "desc")

# Ordem útil, não alfabética: o que exige ação primeiro.
PIPELINE_ORDER = {"failed": 0, "canceled": 1, "canceling": 1, "manual": 2, "running": 3,
                  "pending": 4, "created": 4, "preparing": 4, "waiting_for_resource": 4,
                  "scheduled": 5, "skipped": 6, "success": 7, "": 8}

NO_PIPELINE = "no-pipeline"


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


REVIEW_FILTERS = {
    "assigned": lambda row: row["assigned_to_me"],
    "reviewing": lambda row: row["reviewing_mine"],
    # Sem ninguém: nem assignee, nem revisor.
    "unassigned": lambda row: not row["assignees_names"] and not row["reviewers_list"],
}


def arrange(rows, sort="recent", authors=(), pipelines=(), review=(), direction=""):
    """Filtra e ordena as linhas já coletadas; nenhuma consulta nova ao GitLab.

    authors/pipelines: listas de valores aceitos (vazia = sem filtro nesse
    campo); uma linha passa se o seu valor estiver em QUALQUER uma delas.
    review: lista de assigned, reviewing e/ou unassigned; a linha passa se
    satisfizer QUALQUER um (OU). Valor desconhecido é ignorado; lista vazia, ou
    só de desconhecidos, não filtra.
    direction: "asc" ou "desc"; diferente do sentido natural da ordenação, ela
    sai invertida. Qualquer outro valor é o sentido natural."""
    keeps = [REVIEW_FILTERS[value] for value in review if value in REVIEW_FILTERS]
    chosen = [row for row in rows
              if (not authors or row["author"] in authors)
              and (not pipelines or (row["status"] or NO_PIPELINE) in pipelines)
              and (not keeps or any(keep(row) for keep in keeps))]
    # A data é a base, não uma suposição sobre a ordem recebida: como a
    # ordenação do Python é estável, ela vira o desempate de todo critério.
    chosen.sort(key=lambda row: row["created"], reverse=True)
    item = SORT_KEYS.get(sort)
    if item is None:
        return chosen
    # A ordenação do Python é estável também com reverse=True: o empate
    # continua saindo do mais novo para o mais antigo nos dois sentidos.
    invert = direction in DIRECTIONS and direction != item.direction
    if item.order:
        chosen.sort(key=item.order, reverse=invert)
    elif invert:
        # "recent" não tem chave própria: o sentido natural já é a base.
        chosen.sort(key=lambda row: row["created"])
    return chosen


# Campos marcados na tabela quando mudam de uma passagem para a seguinte.
TRACKED_FIELDS = ("likes", "threads", "openers", "review", "pipeline")


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


LOADING_MESSAGE = "Consultando o GitLab…"
EMPTY_TARGET_MESSAGE = "Nenhum MR aberto para este alvo."
EMPTY_FILTER_MESSAGE = "Nenhum MR corresponde aos filtros."


def empty_message(collected, filtered):
    """Três situações distintas; dizer a errada faz a página parecer quebrada."""
    if not collected:
        return {"key": "loading", "label": LOADING_MESSAGE}
    if filtered:
        return {"key": "empty-filter", "label": EMPTY_FILTER_MESSAGE}
    return {"key": "empty-target", "label": EMPTY_TARGET_MESSAGE}


# De quanto em quanto tempo a página busca o que o servidor já tem.
POLL_SECONDS = 10


def panel_state(targets, interval):
    return {"lock": threading.Lock(), "targets": list(targets), "interval": interval,
            "rows": [], "updated": None, "error": None, "events": [], "sequence": 0,
            # Alvos que não responderam no último ciclo; o painel avisa.
            "failed": []}


def web_label(text):
    """O mesmo rótulo sem o glifo da frente.

    Na tabela do terminal o emoji é o único recurso visual disponível, mas no
    painel o selo já diz o estado pela cor do tom semântico: repetir o glifo
    ali seria ícone como texto, que o Design System não aceita."""
    primeiro, _, resto = str(text).partition(" ")
    return resto if resto and not any(c.isalnum() for c in primeiro) else text


def hours_since(moment, now):
    """Horas inteiras desde `moment`; data desconhecida (EPOCH) vira 0, para
    não ser lida como "parado há milhões de horas" por uma regra de destaque."""
    if moment <= EPOCH:
        return 0
    return max(0, int((now - moment).total_seconds() // 3600))


def serialize_row(row, likes_highlight=LIKES_HIGHLIGHT):
    """Linha pronta para JSON: uma célula por chave de REPORT_COLUMNS, já
    formatada por report_row() (texto e tom semântico). O painel desenha cada
    célula pelo "cell" da coluna, sem saber o que cada chave significa.

    likes_highlight é a preferência de quem está olhando o painel: a partir de
    quantos likes o selo ganha destaque. Zero desliga o destaque. Vem por
    parâmetro, e não do frontend decidindo sozinho, para o tom de uma célula
    continuar tendo um dono só."""
    likes_tone = "strong" if likes_highlight and row["upvotes"] >= likes_highlight else None
    now = datetime.now(timezone.utc)
    return {
        "cells": {
            "mr": {"label": row["mr"], "url": row["url"]},
            "author": {"label": row["author"]},
            # O ícone vem daqui, e não do painel, pelo mesmo motivo do rótulo
            # e do tom: a coluna é descrita em um lugar só.
            "likes": {"label": str(row["upvotes"]), "tone": likes_tone,
                      "icon": "likes", "mine": bool(row.get("mine")),
                      "likers": list(row.get("likers") or [])},
            "threads": {"label": row["threads"], "tone": row.get("threads_tone"),
                        "icon": "threads", "resolved": row["threads_resolved"],
                        "total": row["threads_total"]},
            "openers": {"label": row["openers"], "names": row["openers_names"]},
            "review": {"label": row["review"], "tone": row.get("review_tone"),
                       "names": list(row["review_names"]),
                       "assignees": list(row["assignees_names"]),
                       "reviewers": [{"username": name, "state": state}
                                     for name, state in row["reviewers_list"]],
                       "state": row["my_review_state"]},
            "mergeable": {"label": web_label(row["mergeable"]), "tone": row.get("mergeable_tone"),
                          "value": row["mergeable_value"]},
            "conflicts": {"label": web_label(row["conflicts"]), "tone": row.get("conflicts_tone"),
                          "value": row["conflicts_value"]},
            "pipeline": {"label": web_label(row["pipeline"]), "tone": row.get("pipeline_tone"),
                         "status": row["status"]},
            # Data ausente ("—") não tem ISO: o painel mantém o rótulo.
            "updated_label": {"label": row["updated_label"],
                              "title": row.get("updated_title") or None,
                              "iso": row["updated"].isoformat() if row["updated"] > EPOCH else None},
            "created_label": {"label": row["created_label"],
                              "iso": row["created"].isoformat() if row["created"] > EPOCH else None},
        },
        # Chaves de TRACKED_FIELDS que mudaram desde a última coleta.
        "changed": sorted(row.get("changed") or ()),
        # Os números e estados crus, que o texto das células não permite
        # comparar ("2 👍" não é 2). As horas saem daqui, e não da coleta,
        # para não envelhecerem entre uma consulta e outra do painel.
        "facts": {
            "likes": row["upvotes"],
            "unresolved": row["unresolved"],
            "participants": row["participants"],
            "mergeable": row["mergeable_value"],
            "conflicts": row["conflicts_value"],
            "pipeline": row["status"],
            "author": row["author"],
            "mine": bool(row.get("mine")),
            "involved": bool(row.get("involved")),
            # myReviewState é o enum do GitLab, cru, em minúsculas; só os quatro
            # valores nomeados em REVIEW_TONES ganham tom.
            "assignedToMe": row["assigned_to_me"],
            "reviewingMine": row["reviewing_mine"],
            "myReviewState": row["my_review_state"],
            "assignees": len(row["assignees_names"]),
            "reviewers": len(row["reviewers_list"]),
            "draft": row["draft"],
            "ageHours": hours_since(row["created"], now),
            "idleHours": hours_since(row["updated"], now),
        },
    }


def panel_snapshot(state, since, sort="recent", authors=(), pipelines=(),
                   likes_highlight=LIKES_HIGHLIGHT, review=(), direction=""):
    with state["lock"]:
        rows, targets, updated = state["rows"], list(state["targets"]), state["updated"]
        failed = [target for target in state["failed"] if target in targets]
        interval = state["interval"]
        # O id só serve ao `since`; o painel recebe o evento sem ele.
        events = [{key: value for key, value in item.items() if key != "id"}
                  for item in state["events"] if item["id"] > since]
        sequence = state["sequence"]
        error = state["error"]
    chosen = arrange(rows, sort, authors, pipelines, review, direction)
    collected = updated is not None
    return {
        "rows": [serialize_row(item, likes_highlight) for item in chosen],
        "collected": collected,
        "emptyMessage": None if chosen else empty_message(collected, bool(rows)),
        # Colunas e ordenações saem do backend para o frontend não duplicar
        # os rótulos: REPORT_COLUMNS/SORTS continuam a fonte única.
        "columns": [{"key": column.key, "label": column.label, "cell": column.cell,
                     "weight": column.weight} for column in REPORT_COLUMNS],
        "sorts": [{"value": item.key, "label": item.label, "column": item.column,
                   "direction": item.direction} for item in SORTS],
        "meta": {"projects": [unquote(target) for target in targets],
                 # O rótulo acima não volta a ser alvo: o `unquote` desfaz o
                 # escape, e é a forma canônica que o POST /settings aceita de
                 # volta. É com ela que o painel reconcilia a escolha guardada.
                 "targets": targets,
                 # Alvos que falharam no último ciclo, em rótulo: as linhas
                 # deles faltam na tabela.
                 "failed": [unquote(target) for target in failed],
                 "interval": interval, "shown": len(chosen),
                 "total": len(rows), "updated": updated.isoformat() if updated else None},
        # As opções saem de todas as linhas, não das filtradas: filtrar por um
        # autor não pode apagar os demais da lista de escolhas.
        "filters": filter_options(rows),
        "error": error,
        "events": events,
        "sequence": sequence,
        # Carimbo da última coleta: é por ele que a página sabe que a consulta
        # manual terminou, em vez de adivinhar pelo tempo.
        "updated": updated.isoformat() if updated else None,
        # Consulta local e barata: a página não fica esperando o ciclo
        # do servidor para mostrar o que já foi coletado.
        "poll": POLL_SECONDS,
    }


class SettingsError(ValueError):
    """Recusa do POST /settings, com um `code` ao lado da mensagem.

    A mensagem é inglês de servidor e o painel é traduzido: quem decide o
    texto na tela é o catálogo, pelo `code`, e a mensagem daqui fica como
    reserva — a mesma regra dos rótulos de coluna.
    """

    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


def apply_settings(state, payload, base, wake):
    """Validação igual à da linha de comando; nada é gravado no .env."""
    projects = payload.get("projects")
    interval = str(payload.get("interval", "")).strip()
    if not isinstance(projects, list) or not projects:
        raise SettingsError("no-targets", "Provide at least one project or group.")
    targets = []
    for value in projects:
        if not isinstance(value, str) or not value.strip():
            raise SettingsError("invalid-target", "Each project must be a non-empty string.")
        value = value.strip()
        # O painel devolve o `value` de /projects (e o `meta.targets` de /data),
        # que já é a forma canônica, escapada. Escapá-la de novo quebraria tudo:
        # "g%2Fp" não tem mais barra e seria recusado, e "groups/g%2Fsub" viraria
        # "groups/g%252Fsub", um alvo que não existe.
        if canonical_target(value):
            target = value
        else:
            try:
                target = project_path(value, base)
            except ValueError as exc:
                raise SettingsError("invalid-target", str(exc)) from None
        # Duplicata some, e a ordem escolhida se mantém.
        if target not in targets:
            targets.append(target)
    if len(targets) > MAX_TARGETS:
        raise SettingsError("too-many-targets",
                            f"Choose at most {MAX_TARGETS} projects or groups.")
    try:
        minutes = float(interval)
    except ValueError:
        raise SettingsError("invalid-interval", "Interval must be a number of minutes.") from None
    if not math.isfinite(minutes) or minutes <= 0:
        raise SettingsError("interval-not-positive",
                            "Interval must be a positive, finite number.")
    with state["lock"]:
        changed = targets != state["targets"]
        state["targets"], state["interval"] = targets, minutes
        if changed:
            state["rows"], state["updated"], state["events"] = [], None, []
            state["failed"] = []
    log(f"Panel: {len(targets)} target(s) every {minutes:g} minute(s), "
        "this run only.")
    wake.set()


def canonical_target(item):
    """O item guardado já na forma canônica (a que project_path devolve)?"""
    if not isinstance(item, str) or not item or "\n" in item:
        return False
    try:
        return project_path(unquote(item), "") == item
    except ValueError:
        return False


def preferred_targets(preferences):
    """(alvos, intervalo) guardados nas preferências, ou ([], padrão).

    O arquivo é editável à mão: valor inválido faz a preferência inteira cair
    no padrão, nunca numa meia lista."""
    raw = preferences.get("monitoredProjects")
    targets = []
    if (isinstance(raw, list) and len(raw) <= MAX_TARGETS
            and all(canonical_target(item) for item in raw)):
        targets = list(dict.fromkeys(raw))
    interval = preferences.get("interval")
    try:
        # Inteiro enorme (10**400) estoura no float; cai no padrão como os demais.
        valid = (not isinstance(interval, bool) and isinstance(interval, (int, float))
                 and math.isfinite(float(interval)) and interval > 0)
    except OverflowError:
        valid = False
    return targets, float(interval) if valid else float(DEFAULT_INTERVAL)


HTML_OPEN_TAG = re.compile(rb"<html\b[^>]*>", re.IGNORECASE)
FIRST_PAINT_ATTRIBUTES = (("theme", "data-theme-choice"), ("language", "data-language"),
                          ("textSize", "data-text-size"), ("density", "data-density"))
HTML_LANGUAGES = {"pt": "pt-BR", "en": "en"}


def inject_first_paint(html, preferences):
    """Escreve no <html> as preferências de primeira pintura, para o script do
    index.html aplicá-las antes de qualquer pintura. Só valor da lista fechada
    entra (reaplicada aqui, sem confiar em quem chama); sem nenhum válido, o
    HTML volta intacto. Atributos que não são nossos (ex.: do build) ficam."""
    if not isinstance(preferences, dict):
        return html
    written = []
    for key, attribute in FIRST_PAINT_ATTRIBUTES:
        value = preferences.get(key)
        if isinstance(value, str) and value in FIRST_PAINT_CHOICES[key]:
            written.append((key, attribute, value))
    match = HTML_OPEN_TAG.search(html)
    if not written or match is None:
        return html
    ours = {attribute for _, attribute, _ in written}
    language = next((v for k, _, v in written if k == "language"), None)
    kept = []
    lang = None
    attributes = re.findall(
        r"""([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'>]+)))?""",
        match.group(0)[len(b"<html"):-1].decode("utf-8", "replace"))
    for name, double, single, bare in attributes:
        value = double or single or bare
        if name.lower() == "lang":
            lang = value
        elif name.lower() not in ours:
            kept.append(f' {name}="{escape(value, quote=True)}"' if (double or single or bare)
                        else f" {name}")
    if language is not None:
        lang = HTML_LANGUAGES[language]
    parts = ["<html"]
    if lang is not None:
        parts.append(f' lang="{escape(lang, quote=True)}"')
    parts += [f' {attribute}="{value}"' for _, attribute, value in written]
    parts += kept
    parts.append(">")
    tag = "".join(parts).encode("utf-8")
    return html[:match.start()] + tag + html[match.end():]


def clean_preferences(raw):
    """Só as chaves conhecidas; nas de primeira pintura, só valor da lista."""
    if not isinstance(raw, dict):
        raise ValueError("Preferences must be an object.")
    cleaned = {}
    for key in PREFERENCE_KEYS:
        if key not in raw:
            continue
        choices = FIRST_PAINT_CHOICES.get(key)
        if choices is not None and not (
                isinstance(raw[key], str) and raw[key] in choices):
            continue
        cleaned[key] = raw[key]
    return cleaned


def set_preferences_aside(path):
    """Renomeia o arquivo que não se conseguiu ler; nunca o sobrescreve."""
    stamp = datetime.now().strftime("%Y%m%d-%H%M%S")
    target = path.with_name(f"{path.stem}.corrupt-{stamp}{path.suffix}")
    attempt = 0
    while target.exists():
        attempt += 1
        target = path.with_name(f"{path.stem}.corrupt-{stamp}-{attempt}{path.suffix}")
    path.replace(target)
    log(f"Unreadable preferences moved to {target.name}; using defaults.")


def reject_json_constant(name):
    raise ValueError(f"Non-finite number not allowed: {name}")


def parse_json_strict(text):
    """JSON sem NaN/Infinity, que o navegador não consegue ler de volta."""
    return json.loads(text, parse_constant=reject_json_constant)


def load_preferences(path=None):
    path = PREFERENCES_FILE if path is None else path
    empty = {"version": PREFERENCES_VERSION, "preferences": {}}
    try:
        raw = path.read_bytes()
    except FileNotFoundError:
        return empty
    except OSError as exc:
        log(f"Could not read preferences ({type(exc).__name__}); using defaults.")
        return empty
    try:
        document = parse_json_strict(raw.decode("utf-8"))
        if (not isinstance(document, dict)
                or document.get("version") != PREFERENCES_VERSION):
            raise ValueError("Unsupported preferences document.")
        return {"version": PREFERENCES_VERSION,
                "preferences": clean_preferences(document.get("preferences"))}
    except (ValueError, RecursionError):
        try:
            set_preferences_aside(path)
        except OSError as exc:
            log(f"Could not move preferences aside ({type(exc).__name__}).")
        return empty


def store_preferences(payload, path=None):
    path = PREFERENCES_FILE if path is None else path
    if (not isinstance(payload, dict)
            or payload.get("version") != PREFERENCES_VERSION
            or not isinstance(payload.get("preferences"), dict)):
        raise ValueError("Invalid preferences document.")
    document = {"version": PREFERENCES_VERSION,
                "preferences": clean_preferences(payload["preferences"])}
    json.dumps(document, allow_nan=False)
    with PREFERENCES_LOCK:
        save(path, document)
    return document


def panel_handler(state, base, wake, client=None):
    class Handler(BaseHTTPRequestHandler):
        protocol_version = "HTTP/1.1"

        def reply(self, status, payload, kind="application/json"):
            body = (payload if isinstance(payload, bytes)
                    else json.dumps(payload, ensure_ascii=False).encode("utf-8"))
            self.send_response(status)
            self.send_header("Content-Type", f"{kind}; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.send_header("Cache-Control", "no-store")
            if self.close_connection:
                self.send_header("Connection", "close")
            self.end_headers()
            self.wfile.write(body)

        def same_origin(self):
            # Sem CORS e com Origin conferido, outra página não altera o alvo.
            origin = self.headers.get("Origin")
            return origin is None or urlsplit(origin).netloc == self.headers.get("Host")

        def do_GET(self):
            path, _, query = self.path.partition("?")
            if path == "/data":
                params = parse_qs(query)
                since = params.get("since", ["0"])[0]
                sort = params.get("sort", ["recent"])[0]
                direction = params.get("direction", [""])[0]
                likes = params.get("likes", [""])[0]
                self.reply(200, panel_snapshot(
                    state, int(since) if since.isdigit() else 0,
                    sort if sort in SORT_KEYS else "recent",
                    params.get("author", []), params.get("pipeline", []),
                    int(likes) if likes.isdigit() else LIKES_HIGHLIGHT,
                    params.get("review", []),
                    direction if direction in DIRECTIONS else ""))
                return
            if path == "/projects":
                if client is None:
                    self.reply(503, {"error": "Listing unavailable."})
                    return
                try:
                    self.reply(200, {"targets": client.memberships()})
                except RuntimeError as exc:
                    # A mensagem é a do cliente, que nunca carrega o token.
                    self.reply(502, {"error": str(exc)})
                except (ValueError, KeyError, TypeError):
                    # Resposta fora do formato (uma linha que não é dict levanta
                    # TypeError): texto fixo, sem eco do conteúdo.
                    self.reply(502, {"error": "Unexpected response from GitLab."})
                return
            if path == "/preferences":
                self.reply(200, {**load_preferences(),
                                 "file": (USER_DATA_DIR.relative_to(ROOT) / PREFERENCES_FILE.name).as_posix()})
                return
            # Página e assets: build do Angular (frontend/), servido tal como
            # `ng build` o gera. Quem monta a página é o Angular, não o Python.
            target = page_fallback("/index.html" if path in ("", "/") else path)
            if target is None:
                self.send_error(404)
                return
            content = target.read_bytes()
            if target == frontend_asset("/index.html"):
                content = inject_first_paint(content, load_preferences()["preferences"])
            self.reply(200, content,
                       FRONTEND_MIME.get(target.suffix, "application/octet-stream"))

        def do_POST(self):
            path = self.path.split("?", 1)[0]
            if path not in ("/settings", "/refresh", "/preferences"):
                self.send_error(404)
                return
            if not self.same_origin():
                self.reply(403, {"error": "Origin not allowed."})
                return
            if "application/json" not in (self.headers.get("Content-Type") or ""):
                self.reply(415, {"error": "Send JSON."})
                return
            if path == "/refresh":
                # Consulta manual: encurta a espera do ciclo em curso, sem
                # tocar no alvo nem abrir uma segunda coleta em paralelo.
                wake.set()
                self.reply(200, {"ok": True})
                return
            length = int(self.headers.get("Content-Length") or 0)
            limit = PREFERENCES_MAX_BYTES if path == "/preferences" else 4096
            if length > limit:
                # O corpo não é aceito: fechar evita que o excedente vire a próxima
                # requisição. Descarta até 1 MiB antes, para o fechamento não virar
                # um reset no cliente que ainda está enviando.
                self.rfile.read(min(length, 1 << 20))
                self.close_connection = True
                self.reply(413, {"error": "Request too large."})
                return
            try:
                text = self.rfile.read(length).decode("utf-8")
                payload = (parse_json_strict(text) if path == "/preferences"
                           else json.loads(text))
                if path == "/preferences":
                    try:
                        document = store_preferences(payload)
                    except OSError as exc:
                        log(f"Could not save preferences ({type(exc).__name__}).")
                        self.reply(500, {"error": "Could not save preferences."})
                        return
                    self.reply(200, document)
                    return
                apply_settings(state, payload, base, wake)
            except (ValueError, AttributeError, TypeError, RecursionError) as exc:
                # O `code`, quando há, deixa o painel escolher o texto no
                # catálogo em vez de mostrar inglês cru numa tela pt-BR.
                self.reply(400, {"error": str(exc) or "Invalid values.",
                                 "code": getattr(exc, "code", "")})
                return
            self.reply(200, {"ok": True})

        def log_message(self, *args):
            # O acesso do próprio navegador não interessa no terminal.
            pass

    return Handler


def announce(events, notifications=True):
    """Mesmos eventos do monitoramento, a partir da passagem já feita."""
    for event in events:
        log(event["text"])
    if events and notifications:
        notify("GitLab: MR updates", "\n\n".join(event["text"] for event in events))


def serve_panel(client, targets, interval, port, base=""):
    """Serve a tabela só em 127.0.0.1; o token nunca entra na página.

    Este modo não usa o notificador do sistema: quem avisa é o navegador, pela
    caixa da página, e dois avisos para o mesmo evento seriam ruído. Os eventos
    continuam saindo no terminal.
    """
    state = panel_state(targets, interval)
    wake = threading.Event()
    stop = threading.Event()

    def refresh():
        # A referência vive na memória deste processo: o painel não usa o
        # histórico em disco nem o lock, e por isso convive com um monitor.
        previous, scanning, shown = None, list(targets), None
        while True:
            with state["lock"]:
                # Cópia: mutar a lista do estado não muda o que este ciclo varre.
                current, seconds = list(state["targets"]), max(1, int(state["interval"] * 60))
            if current != scanning:
                # Lista nova (comparada por valor) recomeça a referência: a
                # primeira passagem só fotografa, e nada é marcado como alterado.
                previous, scanning, shown = None, current, None
            try:
                snapshots, events, rows, failed = scan(client, scanning, previous)
                previous = snapshots
                mark_changes(rows, shown)
                shown = rows
                with state["lock"]:
                    if state["targets"] == scanning:
                        state["rows"], state["error"] = rows, None
                        # Ciclo parcial: as linhas do alvo que falhou não vêm, e
                        # quem olha o painel precisa saber disso.
                        state["failed"] = list(failed)
                        state["updated"] = datetime.now().astimezone()
                        for event in events:
                            state["sequence"] += 1
                            state["events"].append({"id": state["sequence"], **event})
                        del state["events"][:-50]
                log(f"Panel updated: {len(rows)} open MR(s)."
                    if not events else
                    f"Panel updated: {len(rows)} open MR(s). "
                    f"{len(events)} change(s).")
                announce(events, notifications=False)
            except (RuntimeError, KeyError, TypeError) as exc:
                message = (str(exc) if isinstance(exc, RuntimeError)
                           else "Unexpected response from GitLab; previous table preserved.")
                with state["lock"]:
                    state["error"] = message
                    state["failed"] = list(scanning)
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
    server = ThreadingHTTPServer(("127.0.0.1", port), panel_handler(state, base, wake, client))
    log(f"Panel at http://127.0.0.1:{server.server_port}/ "
        f"(updates every {interval:g} minute(s)). Ctrl+C to stop.")
    log("Changes are logged here in the terminal and, on screen, through the "
        "browser: the page ships with notifications on and asks for permission "
        "the first time.")
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
            current, events, rows, _ = scan(client, [project], previous)
        except (RuntimeError, KeyError, TypeError) as exc:
            log(str(exc) if isinstance(exc, RuntimeError)
                else "Unexpected response from GitLab; previous table preserved.")
        else:
            if sys.stdout.isatty():
                print("\033[H\033[J", end="")
            log(f"{len(rows)} open MR(s). Updates every {interval:g} minute(s). "
                "Ctrl+C to stop.")
            if rows:
                print(render_table(rows))
            # Os eventos ficam abaixo da tabela, até o próximo redesenho.
            announce(events, notifications)
            previous = current
        time.sleep(max(1, seconds - (time.monotonic() - started)))


MODES = (("1", "monitorar", "Monitoring"),
         ("2", "relatorio", "Current report"),
         ("3", "painel", "Terminal panel (self-refreshing table)"),
         ("4", "web", "Browser panel (table served on localhost)"))


def choose_mode():
    """Sem terminal interativo (make, cron, pipe), segue em monitoramento."""
    if not sys.stdin.isatty():
        return "monitorar"
    print("Execution mode:")
    for number, _, description in MODES:
        print(f"  {number} - {description}")
    options = {number: name for number, name, _ in MODES}
    while True:
        try:
            answer = input("Choose [1]: ").strip() or "1"
        except EOFError:
            return "monitorar"
        if answer in options:
            return options[answer]
        numbers = list(options)
        print(f"Invalid option: type {', '.join(numbers[:-1])} or {numbers[-1]}.")


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("project", nargs="?",
                         help="Project or group URL (/-/merge_requests); project path or ID. "
                              "Required in the terminal modes; in web mode it overrides the "
                              "targets saved by the panel")
    parser.add_argument("--test-notify", action="store_true", help="Test the native notification without .env or API")
    parser.add_argument("--mode", choices=[name for _, name, _ in MODES],
                         help="monitorar tracks and alerts on every change; relatorio queries once "
                              "and prints the table; painel repeats the table in the terminal; web "
                              "serves the table on localhost. Without this option, you're prompted in the terminal")
    parser.add_argument("--port", type=int, default=8765, metavar="PORT",
                         help="Port for web mode on 127.0.0.1 (default: 8765)")
    parser.add_argument("--interval", type=float, default=None, metavar="MINUTES",
                         help="Interval in minutes (default: 15; in web mode, the one saved by the panel)")
    parser.add_argument("--once", action="store_true", help="Monitoring mode only: query once and exit")
    parser.add_argument("--no-notify", action="store_true",
                         help="Disable native notifications (macOS, Linux via notify-send, Windows via PowerShell); "
                              "monitorar and painel modes only")
    parser.add_argument("--keep-history", default="false", metavar="TRUE|FALSE",
                         help="Monitoring mode only: preserve this session's reference in gitlab-history/ on exit "
                              "(default: false, deleted on exit)")
    args = parser.parse_args()
    if args.test_notify:
        return 0 if notify("GitLab Monitor", "Notification test: accents, arrow → and emoji 👍.") else 1
    if args.interval is not None and (not math.isfinite(args.interval) or args.interval <= 0):
        parser.error("--interval must be a positive, finite number.")
    keep_history = args.keep_history.strip().lower()
    if keep_history not in ("true", "false"):
        parser.error("--keep-history must be TRUE or FALSE.")
    keep_history = keep_history == "true"
    mode = args.mode or choose_mode()
    if mode != "web" and not args.project:
        # Quem atualiza vem do .env, onde PROJECT bastava: a saída precisa dizer
        # as duas formas de seguir, e o painel escolhe os alvos sem posicional.
        parser.error("Provide the project on the command line, or use --mode web to choose the "
                     "targets in the panel; --test-notify needs neither.")
    interval = args.interval
    if mode == "web":
        saved_targets, saved_interval = preferred_targets(load_preferences()["preferences"])
        if interval is None:
            interval = saved_interval
    elif interval is None:
        interval = DEFAULT_INTERVAL
    lock = None
    try:
        base, token = credentials(ROOT / ".env")
        project = None
        if args.project:
            try:
                project = project_path(args.project, base)
            except ValueError as exc:
                parser.error(str(exc))
        client = GitLab(base, token)
        if mode == "relatorio":
            try:
                rows = report(client, [project])
            except (RuntimeError, KeyError, TypeError) as exc:
                log(str(exc) if isinstance(exc, RuntimeError) else "Unexpected response from GitLab.")
                return 1
            log(f"Report for {unquote(project)}: {len(rows)} open MR(s).")
            if rows:
                print(render_table(rows))
            return 0
        if mode == "painel":
            show_panel(client, project, interval, not args.no_notify)
            return 0
        if mode == "web":
            # O posicional, quando informado, vence os alvos guardados.
            serve_panel(client, [project] if project else saved_targets, interval, args.port, base)
            return 0
        targets = [project]
        # Ordenar deixa a chave independente da ordem dos alvos; "\n" não aparece em caminho de projeto.
        key = hashlib.sha256((f"{base}/" + "\n".join(sorted(targets))).encode()).hexdigest()[:24]
        path = ROOT / "gitlab-history" / f"{key}.json"
        path.parent.mkdir(parents=True, exist_ok=True)
        lock = acquire_lock(path.with_suffix(".lock"))
        previous = None
        if path.exists():
            stored = json.loads(path.read_text(encoding="utf-8"))
            if (not isinstance(stored, dict) or stored.get("version") != 3
                    or not isinstance(stored.get("targets"), dict)):
                # A instrução precisa CHEGAR a quem roda: levantar daqui a
                # trocaria pela mensagem genérica do except de topo, e quem
                # atualiza de uma versão anterior encontra este arquivo no
                # primeiro ciclo — o nome dele não muda com um alvo só.
                log(f"Incompatible state file from an earlier version: {path}. "
                    "Keep it and move it aside (or delete it) to restart the reference; "
                    "nothing was overwritten.")
                return 1
            previous = stored["targets"]
        log(f"Monitoring {unquote(project)} every {interval:g} minute(s). Ctrl+C to stop.")
        last_error = None
        try:
            while True:
                started = time.monotonic()
                try:
                    current, events = collect(client, targets, previous)
                    save(path, {"version": 3, "checked_at": datetime.now().astimezone().isoformat(), "targets": current})
                    if previous is None:
                        log(f"Initial reference saved: {count_snapshots(current)} open MR(s).")
                    else:
                        for event in events:
                            log(event["text"])
                        log(f"Open MRs: {count_snapshots(previous)} → {count_snapshots(current)}. {len(events)} change(s).")
                    previous = current
                    if events and not args.no_notify:
                        notify("GitLab: MR updates", "\n\n".join(event["text"] for event in events))
                    if last_error:
                        log("Connection and comparison restored.")
                    last_error = None
                except (RuntimeError, ValueError, KeyError, TypeError, OSError) as exc:
                    message = str(exc) if isinstance(exc, RuntimeError) else "Failed to read response or save state; previous reference preserved."
                    log(message)
                    if not args.no_notify and message != last_error:
                        notify("GitLab: monitor failure", message)
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
        log("Monitor stopped.")
        return 0
    except (ValueError, KeyError, TypeError, OSError):
        log("Could not start. Check the .env file, the project, the web mode port, permissions, and the state in gitlab-history/; verify no other monitor is already running.")
        return 1
    finally:
        if lock is not None:
            lock.close()


if __name__ == "__main__":
    sys.exit(main())
