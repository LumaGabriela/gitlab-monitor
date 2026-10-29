#!/usr/bin/env python3
"""Monitors MRs via GET, with no external Python packages (Python 3.9+).

Four modes. Without --mode, the mode is asked in the terminal:
  1 - Monitoring: tracks the MRs and alerts on every change, until Ctrl+C.
  2 - Current report: queries once and prints the table of open MRs,
      with likes, author, threads, who opened the threads and the pipeline
      status. The MR column's text links to the MR.
  3 - Terminal panel: the report's table, redrawn on every interval.
  4 - Browser panel: the same table in HTML, served on 127.0.0.1.
      The page refreshes itself, sorts and filters the table (by author and
      pipeline status), brings the parameters in a form (valid only for
      this run, never written to .env) and can notify through the browser.
      Requires the web/ folder, next to this script.
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
     python3 gitlab_monitor.py --mode relatorio
     python3 gitlab_monitor.py --mode web --port 8765
     python3 gitlab_monitor.py          # uses PROJECT and INTERVAL from .env
Equivalent shortcuts: make monitor, make report, make panel, make web
(require .venv).

The project and the interval can come from .env (PROJECT and INTERVAL) or
from the command line. Whatever is passed at run time overrides .env: the
positional argument overrides PROJECT and --interval overrides INTERVAL.
With neither, the interval is 15 minutes and the project is required on
the command line.

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

Reads GITLAB_API_URL, GITLAB_TOKEN and, optionally, PROJECT and INTERVAL from
the .env file next to this script (without executing its contents). Likes are 👍 reactions, not approvals. Discussions are counted,
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
                raise ValueError(f"Invalid value for {key} in .env.") from None
            if len(parts) != 1:
                raise ValueError(f"Invalid value for {key} in .env.")
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
                caminho = unquote(project)
                if caminho.isdigit():
                    row, _ = self.get(f"/projects/{caminho}")
                    caminho = row["path_with_namespace"]
                self._namespace_cache[project] = ("project", caminho)
        return self._namespace_cache[project]

    def acompanhar(self, project):
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
        tipo, caminho = self.namespace(project)
        is_group = tipo == "group"
        campo_filtro = "includeSubgroups: true, " if is_group else ""
        consulta = f"""
            query acompanhamento($fullPath: ID!, $paginaMR: Int, $curtida: String, $depoisDe: String) {{
              alvo: {tipo}(fullPath: $fullPath) {{
                id
                mergeRequests(state: opened, {campo_filtro}first: $paginaMR, after: $depoisDe) {{
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
                        notes(first: 1) {{ nodes {{ author {{ username }} }} }}
                      }}
                    }}
                  }}
                }}
              }}
              curtidos: {tipo}(fullPath: $fullPath) {{
                mergeRequests(state: opened, {campo_filtro}myReactionEmoji: $curtida, first: $paginaMR) {{
                  nodes {{ iid project {{ id }} }}
                }}
              }}
            }}
        """
        nos, mine, cursor = [], set(), None
        while True:
            dados = self.graphql("acompanhamento", consulta, {
                "fullPath": caminho, "paginaMR": 100, "curtida": "thumbsup",
                "depoisDe": cursor,
            })
            lote = dados["alvo"]["mergeRequests"]
            nos.extend(lote["nodes"])
            if cursor is None:
                for item in dados["curtidos"]["mergeRequests"]["nodes"]:
                    mine.add(self._chave(item, is_group))
            if not lote["pageInfo"]["hasNextPage"]:
                break
            cursor = lote["pageInfo"]["endCursor"]
        por_chave = {self._chave(no, is_group): no for no in nos}
        return nos, por_chave, mine

    @staticmethod
    def _chave(node, is_group):
        if not is_group:
            return str(node["iid"])
        projeto = node["project"]["id"].rsplit("/", 1)[-1]
        return f'{projeto}:{node["iid"]}'


def graphql_row(node, web_root):
    """Nó do GraphQL.acompanhar() no formato que snapshot()/report_row() esperam.

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
    }


def graphql_discussions(node):
    """Threads do nó no formato que thread_summary()/discussion_snapshot() esperam.

    resolvable/resolved vêm por discussão no GraphQL; o formato REST original
    os trazia por nota. Uma nota sintética, só com o que essas duas funções
    leem, reproduz o mesmo contrato sem duplicar a lógica delas.
    """
    discussoes = []
    for discussao in node["discussions"]["nodes"]:
        primeira = discussao["notes"]["nodes"][:1]
        autor = primeira[0]["author"] if primeira and primeira[0]["author"] else {"username": "—"}
        nota = {"resolvable": discussao["resolvable"], "resolved": discussao["resolved"],
               "author": autor}
        discussoes.append({"id": discussao["id"], "notes": [nota]})
    return discussoes


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
    return "no pipeline" if value is None else f'#{value["id"]} {value["status"]}'


REPORT_COLUMNS = (("likes", "Likes", 8), ("mr", "MR", 54), ("author", "Author", 18),
                  ("threads", "Threads", 15), ("openers", "Thread openers", 30),
                  ("mergeable", "Mergeable", 15), ("conflicts", "Conflicts", 15),
                  ("pipeline", "Pipeline Status", 16), ("updated_label", "Updated", 13),
                  ("created_label", "Created", 12))

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

# Marca o MR cujos likes incluem o seu. Um sinal estreito, e não um emoji: de
# largura previsível em uma coluna, sem desalinhar a tabela do terminal.
MINE_MARK = "\N{CHECK MARK}"

# Tom semântico por intenção, conforme o guia de feedback.
PIPELINE_TONES = {"success": "success", "failed": "danger", "running": "info",
                  "created": "warning", "preparing": "warning", "pending": "warning",
                  "waiting_for_resource": "warning"}

# mergeable/conflicts vêm da GraphQL (ver GitLab.acompanhar); ausentes em dados
# de teste mais antigos, daí o rótulo de "desconhecido" para None.
UNKNOWN_LABEL = "— unknown"
MERGEABLE_LABEL = {True: "\N{WHITE HEAVY CHECK MARK} mergeable", False: "\N{CROSS MARK} blocked"}
CONFLICT_LABEL = {True: "\N{CROSS MARK} conflict", False: "\N{WHITE HEAVY CHECK MARK} no conflict"}


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
        return "— no pipeline"
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
    (365 * 86400, "year", "years"), (30 * 86400, "month", "months"),
    (86400, "day", "days"), (3600, "hour", "hours"), (60, "minute", "minutes"),
)


def relative_time(moment, now=None):
    """"3 hours ago", "23 minutes ago": mesma granularidade da página do GitLab.

    now é parâmetro só para teste determinístico; na operação normal é
    sempre o instante da própria consulta, recalculado a cada ciclo.
    """
    if moment <= EPOCH:
        return "—"
    segundos = ((now or datetime.now(timezone.utc)) - moment).total_seconds()
    if segundos < 60:
        return "just now"
    for duracao, singular, plural in RELATIVE_UNITS:
        quantidade = int(segundos // duracao)
        if quantidade >= 1:
            return f"{quantidade} {singular if quantidade == 1 else plural} ago"
    return "just now"  # inalcançável: minuto já cobriu segundos >= 60


def report_row(row, discussions, mine=False):
    total, resolved, openers = thread_summary(discussions)
    created = created_at(row.get("created_at"))
    updated = created_at(row.get("updated_at"))
    mergeable = row.get("mergeable")
    conflicts = row.get("conflicts")
    return {
        "likes": f'{row["upvotes"]} \N{THUMBS UP SIGN}' + (f" {MINE_MARK}" if mine else ""),
        "mine": mine,
        # Quem reagiu com 👍, pelo awardEmoji da mesma consulta; mostrado
        # abaixo da contagem no painel web, sem chamada extra ao GitLab.
        "likers": list(row.get("likers") or []),
        "mr": f'{project_label(row["web_url"])} #{row["iid"]} {row["title"]}',
        # Campos que o monitoramento não exigia: ausência não derruba o ciclo.
        "author": (row.get("author") or {}).get("username", "—"),
        "threads": f"{resolved}/{total} resolved" if total else "no threads",
        "openers": ", ".join(openers) or "—",
        "mergeable": MERGEABLE_LABEL.get(mergeable, UNKNOWN_LABEL),
        # Só o estado-problema (bloqueado) ganha destaque; mesclável é o normal.
        "mergeable_tone": "danger" if mergeable is False else None,
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
        "updated_label": relative_time(updated),
        "updated_title": f"{updated:%d/%m/%Y %H:%M}" if updated > EPOCH else "",
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


def scan(client, project, previous=None):
    """Uma passagem: snapshots para comparação, eventos e linhas da tabela.

    Monitoramento e painéis partilham esta função para que a tabela e os
    eventos venham do mesmo conjunto de requisições, sem consultar duas vezes.
    """
    current, removed, rows = {}, {}, []
    # Um único GraphQL por ciclo: MRs, pipeline, threads (com quem abriu) e
    # likes próprios juntos. Ver GitLab.acompanhar.
    _, por_chave, mine = client.acompanhar(project)
    for chave, node in por_chave.items():
        row = graphql_row(node, client.web_root)
        discussions = graphql_discussions(node)
        current[chave] = snapshot(row, discussions)
        rows.append(report_row(row, discussions, chave in mine))
    # Confirma saídas individualmente; 403/404 nunca significam "mesclado".
    # A listagem já filtra por "opened": o que sumiu de um ciclo para o
    # outro é o único caso que ainda precisa de confirmação por MR.
    for iid in (previous or {}).keys() - current.keys():
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
            changes.append("NEW MR OPENED")
        elif new is None:
            changes.append({"merged": "MERGED", "closed": "CLOSED"}.get(
                removed[iid], f"LEFT THE OPEN LIST ({removed[iid]})"))
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


# Tokens do design guide FPF Tech (guias card e feedback). Nenhum valor de cor,
# spacing ou radius aparece fora deste bloco; o tema escuro troca só as variáveis.
# Interface do painel: templates, componentes e estilos vivem em web/, ao lado
# do script. Separar o HTML/CSS/JS do Python mantém cada peça reutilizável.
ASSETS = Path(__file__).resolve().parent / "web"

STYLE_FILES = ("styles/tokens.css", "styles/base.css", "styles/components/card.css",
               "styles/components/table.css", "styles/components/badge.css",
               "styles/components/button.css", "styles/components/toolbar.css",
               "styles/components/columns.css", "styles/components/form.css",
               "styles/components/feedback.css", "styles/responsive.css")

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
    ("recente", "Most recent", None),
    ("likes", "Most likes", lambda row: -row["upvotes"]),
    ("mr", "MR (A–Z)", lambda row: row["mr"].casefold()),
    ("autor", "Author (A–Z)", lambda row: row["author"].casefold()),
    ("threads", "Unresolved first", lambda row: -row["unresolved"]),
    ("revisores", "Thread openers", lambda row: row["openers"].casefold()),
    ("pipeline", "Pipeline status", lambda row: PIPELINE_ORDER.get(row["status"], 50)),
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
                       else "no pipeline"}
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
    return (f'<span class="changed" role="img" aria-label="changed since the '
            f'last check" title="Changed since the last check">'
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
        mine = f" {MINE_MARK}" if row.get("mine") else ""
        return badge(f'\N{THUMBS UP SIGN} {row["upvotes"]}{mine}', row.get("likes_tone"))
    if key in ("mergeable", "conflicts"):
        return badge(str(row[key]), row.get(f"{key}_tone"))
    if key == "updated_label" and row.get("updated_title"):
        # Data e hora exatas aparecem ao passar o mouse, igual à própria
        # página do GitLab sobre o texto relativo.
        return f'<time title="{escape(row["updated_title"], quote=True)}">{escape(row["updated_label"])}</time>'
    return escape(str(row[key]))


def render_cell(row, key):
    # O invólucro é uma linha flex: a marca fica sempre à esquerda do item,
    # qualquer que seja a largura da coluna, em vez de cair para cima dele.
    return (f'<span class="cell">{change_mark(row, key)}'
            f"{cell_value(row, key)}</span>")


LOADING_MESSAGE = "Querying GitLab…"
EMPTY_TARGET_MESSAGE = "No open MRs for this target."
EMPTY_FILTER_MESSAGE = "No MRs match the filters."


def empty_message(collected, filtered):
    """Três situações distintas; dizer a errada faz a página parecer quebrada."""
    if not collected:
        return LOADING_MESSAGE
    return EMPTY_FILTER_MESSAGE if filtered else EMPTY_TARGET_MESSAGE


def likers_markup(row):
    """Nomes de quem reagiu com 👍, abaixo do emblema de likes.

    Fora do <span class="cell"> (de propósito: esse invólucro é linha única,
    ver table.css), para poder cair numa segunda linha dentro da célula.
    """
    likers = row.get("likers") or []
    if not likers:
        return ""
    return f'<div class="likers">{escape(", ".join(likers))}</div>'


def render_fragment(rows, collected=True, filtered=False):
    """Todo texto vindo do GitLab passa por escape antes de entrar na página."""
    if not rows:
        return component("empty", message=empty_message(collected, filtered))
    # <col> fixa a largura de cada coluna no font-size da tabela (o padrão,
    # 16px): width em "ch" direto no <th> variava com o font-size menor do
    # cabeçalho (font-size-xs), dando uma coluna mais estreita ali do que no
    # corpo e quebrando palavras como "MERGEABLE" ao meio.
    colgroup = "".join(f'<col class="{key}">' for key, _, _ in REPORT_COLUMNS)
    headers = "".join(f'<th class="{key}">{escape(header)}</th>' for key, header, _ in REPORT_COLUMNS)
    body = "".join(
        "<tr>" + "".join(
            f'<td class="{key}">{render_cell(row, key)}'
            f'{likers_markup(row) if key == "likes" else ""}</td>'
            for key, _, _ in REPORT_COLUMNS) + "</tr>"
        for row in rows)
    return component("table", colgroup=colgroup, headers=headers, rows=body)


def sort_options(selected="recente"):
    return "".join(
        f'<option value="{name}"{" selected" if name == selected else ""}>'
        f"{escape(label)}</option>" for name, label, _ in SORTS)


def column_options():
    """Uma checkbox por coluna; a visibilidade é decidida só no navegador,
    via localStorage (ver web/scripts/columns.js e panel.js)."""
    return "".join(
        f'<label class="field field--check columns__item">'
        f'<input type="checkbox" class="columns__toggle" value="{key}" checked>'
        f'<span>{escape(label)}</span></label>'
        for key, label, _ in REPORT_COLUMNS)


def page_meta(project, shown, total, updated):
    count = f"{shown} MR(s)" if shown == total else f"{shown} of {total} MR(s)"
    return (f"{project} · {count} · updated at {updated:%d/%m/%Y %H:%M:%S}" if updated
            else f"{project} · first query in progress")


def render_html(rows, project, interval, updated=None):
    """Casca da página; a tabela é trocada pelo JS a cada consulta."""
    return fill(
        asset("templates/page.html"),
        project=escape(project),
        styles=stylesheet(),
        script=asset("scripts/panel.js"),
        theme_script=asset("scripts/theme.js"),
        columns_script=asset("scripts/columns.js"),
        meta=escape(page_meta(project, len(rows), len(rows), updated)),
        settings=component("settings", project=escape(project, quote=True),
                           interval=f"{interval:g}"),
        toolbar=component("toolbar", sort_options=sort_options()),
        columns=component("columns", options=column_options()),
        legend=component("legend", mark=CHANGE_MARK, mine=MINE_MARK),
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
        # Carimbo da última coleta: é por ele que a página sabe que a consulta
        # manual terminou, em vez de adivinhar pelo tempo.
        "updated": updated.isoformat() if updated else None,
        # Consulta local e barata: a página não fica esperando o ciclo
        # do servidor para mostrar o que já foi coletado.
        "poll": POLL_SECONDS,
    }


def apply_settings(state, payload, base, wake):
    """Validação igual à da linha de comando; nada é gravado no .env."""
    project = str(payload.get("project", "")).strip()
    interval = str(payload.get("interval", "")).strip()
    if not project:
        raise ValueError("Provide the project or group.")
    target = project_path(project, base)
    try:
        minutes = float(interval)
    except ValueError:
        raise ValueError("Interval must be a number of minutes.") from None
    if not math.isfinite(minutes) or minutes <= 0:
        raise ValueError("Interval must be a positive, finite number.")
    with state["lock"]:
        changed = target != state["project"]
        state["project"], state["interval"] = target, minutes
        if changed:
            state["rows"], state["updated"], state["events"] = [], None, []
    log(f"Panel: target {unquote(target)} every {minutes:g} minute(s), "
        "this run only.")
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
            path = self.path.split("?", 1)[0]
            if path not in ("/settings", "/refresh"):
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
            if length > 4096:
                self.reply(413, {"error": "Request too large."})
                return
            try:
                payload = json.loads(self.rfile.read(length).decode("utf-8"))
                apply_settings(state, payload, base, wake)
            except (ValueError, AttributeError, TypeError) as exc:
                self.reply(400, {"error": str(exc) or "Invalid values."})
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
        notify("GitLab: MR updates", "\n\n".join(events))


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
            current, events, rows = scan(client, project, previous)
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
                              "Overrides PROJECT from .env; without it, PROJECT is used")
    parser.add_argument("--test-notify", action="store_true", help="Test the native notification without .env or API")
    parser.add_argument("--mode", choices=[name for _, name, _ in MODES],
                         help="monitorar tracks and alerts on every change; relatorio queries once "
                              "and prints the table; painel repeats the table in the terminal; web "
                              "serves the table on localhost. Without this option, you're prompted in the terminal")
    parser.add_argument("--port", type=int, default=8765, metavar="PORT",
                         help="Port for web mode on 127.0.0.1 (default: 8765)")
    parser.add_argument("--interval", type=float, default=None, metavar="MINUTES",
                         help="Interval in minutes. Overrides INTERVAL from .env; if neither is set, 15")
    parser.add_argument("--once", action="store_true", help="Query once and exit")
    parser.add_argument("--no-notify", action="store_true",
                         help="Disable native notifications (macOS, Linux via notify-send, Windows via PowerShell)")
    parser.add_argument("--keep-history", default="false", metavar="TRUE|FALSE",
                         help="Preserve this session's reference in gitlab-history/ on exit "
                              "(default: false, deleted on exit)")
    args = parser.parse_args()
    if args.test_notify:
        return 0 if notify("GitLab Monitor", "Notification test: accents, arrow → and emoji 👍.") else 1
    try:
        defaults = env_defaults(ROOT / ".env")
    except ValueError as exc:
        parser.error(str(exc))
    project_arg = args.project or defaults.get("PROJECT")
    if not project_arg:
        parser.error("Provide the project on the command line, set PROJECT in .env, or use --test-notify.")
    interval = args.interval
    if interval is None:
        raw = defaults.get("INTERVAL")
        if raw is None:
            interval = 15
        else:
            try:
                interval = float(raw)
            except ValueError:
                parser.error("INTERVAL in .env must be a positive, finite number.")
            if not math.isfinite(interval) or interval <= 0:
                parser.error("INTERVAL in .env must be a positive, finite number.")
    elif not math.isfinite(interval) or interval <= 0:
        parser.error("--interval must be a positive, finite number.")
    keep_history = args.keep_history.strip().lower()
    if keep_history not in ("true", "false"):
        parser.error("--keep-history must be TRUE or FALSE.")
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
                raise ValueError("Incompatible state file; keep it and move it aside to restart the reference.")
            previous = stored["mrs"]
        log(f"Monitoring {unquote(project)} every {interval:g} minute(s). Ctrl+C to stop.")
        last_error = None
        try:
            while True:
                started = time.monotonic()
                try:
                    current, events = collect(client, project, previous)
                    save(path, {"version": 2, "checked_at": datetime.now().astimezone().isoformat(), "mrs": current})
                    if previous is None:
                        log(f"Initial reference saved: {len(current)} open MR(s).")
                    else:
                        for event in events:
                            log(event)
                        log(f"Open MRs: {len(previous)} → {len(current)}. {len(events)} change(s).")
                    previous = current
                    if events and not args.no_notify:
                        notify("GitLab: MR updates", "\n\n".join(events))
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
