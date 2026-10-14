"""Na pasta do monitor: python3 -B -m unittest discover -s tests."""

import base64
import copy
import json
import importlib.util
import os
import re
import subprocess
from pathlib import Path
import sys
import tempfile
import textwrap
import unicodedata
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from io import StringIO
from urllib.parse import unquote, urlsplit
import threading
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gitlab_monitor as monitor


def row(iid, state="opened", likes=0, pipeline=None, author="ana.lima",
        created="2026-10-01T10:00:00.000Z", project_id=1):
    return {"iid": iid, "state": state, "title": f"MR {iid}",
            "web_url": f"https://gitlab.example/g/p/-/merge_requests/{iid}",
            "upvotes": likes, "head_pipeline": pipeline,
            "author": {"username": author}, "created_at": created,
            "project_id": project_id}


def rest_row_to_graphql_node(r, web_root="https://gitlab.example"):
    """Nó GraphQL equivalente a uma linha REST de row()/merge_request().

    Compartilhado pelos dois dublês (Client e Mock): ambos descrevem os
    mesmos dados de teste no formato antigo, e scan() agora só fala GraphQL.
    """
    pipeline = r.get("head_pipeline")
    return {
        "iid": r["iid"], "title": r["title"], "createdAt": r["created_at"],
        "upvotes": r["upvotes"], "webPath": r["web_url"].removeprefix(web_root),
        "author": r.get("author") or {},
        "headPipeline": None if pipeline is None else {
            "id": pipeline["id"], "status": pipeline["status"].upper()},
        "project": {"id": f'gid://gitlab/Project/{r.get("project_id", 1)}'},
        "discussions": {"nodes": []},
    }


def graphql_response(nodes, has_next=False, end_cursor=None, liked=()):
    """Formato que GitLab.graphql() devolve: dubla client.graphql em testes
    que exercitam GitLab.acompanhar() de verdade (paginação, montagem de chave)."""
    return {
        "alvo": {"mergeRequests": {
            "pageInfo": {"hasNextPage": has_next, "endCursor": end_cursor},
            "nodes": list(nodes),
        }},
        "curtidos": {"mergeRequests": {"nodes": list(liked)}},
    }


class Client:
    """Dubla GitLab: `opened`/`details` no formato REST de row() (o que o
    loop de saída de scan() ainda consulta via detail()/discussions()), e
    `acompanhar()` fabrica o nó GraphQL equivalente a partir das mesmas
    linhas, para não duplicar um segundo conjunto de dados por teste.
    """
    def __init__(self, opened, details, liked=()):
        self.rows = {str(item["iid"]): item for item in opened}
        self.details = {str(item["iid"]): item for item in details}
        self.mine = set(liked)
        self.web_root = "https://gitlab.example"

    def detail(self, project, iid):
        return self.details[iid]

    def discussions(self, project, iid):
        return []

    def acompanhar(self, project):
        nos = [rest_row_to_graphql_node(r) for r in self.rows.values()]
        por_chave = {str(r["iid"]): rest_row_to_graphql_node(r) for r in self.rows.values()}
        return nos, por_chave, set(self.mine)


class MonitorTests(unittest.TestCase):
    def test_relocated_script_reads_own_env_from_another_working_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            parent = Path(directory)
            folder = parent / "gitlab-monitor"
            folder.mkdir()
            script = folder / "gitlab_monitor.py"
            script.write_text(Path(monitor.__file__).read_text(encoding="utf-8"), encoding="utf-8")
            (folder / ".env").write_text(
                "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake-local-token\n", encoding="utf-8")
            # O arquivo da pasta pai não deve substituir a configuração própria.
            (parent / ".env").write_text("GITLAB_API_URL=invalid\n", encoding="utf-8")
            elsewhere = parent / "elsewhere"
            elsewhere.mkdir()
            spec = importlib.util.spec_from_file_location("relocated_monitor", script)
            relocated = importlib.util.module_from_spec(spec)
            spec.loader.exec_module(relocated)
            original_cwd = Path.cwd()
            try:
                os.chdir(elsewhere)
                with patch.object(relocated.sys, "argv", [str(script), "g/p", "--once", "--no-notify", "--keep-history", "true"]), \
                     patch.object(relocated, "GitLab") as gitlab, \
                     patch.object(relocated, "collect", return_value=({}, [])), patch.object(relocated, "log"):
                    self.assertEqual(relocated.main(), 0)
                    gitlab.assert_called_once_with("https://gitlab.example/api/v4", "fake-local-token")
            finally:
                os.chdir(original_cwd)
            self.assertEqual(relocated.ROOT, folder.resolve())
            self.assertEqual(len(list((folder / "gitlab-history").glob("*.json"))), 1)
            self.assertFalse((parent / "gitlab-history").exists())

    def test_command_line_overrides_env_project_and_interval(self):
        env = ('GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\n'
               'PROJECT = "g/env-proj"\nINTERVAL = "3"\n')
        cases = (([], "g/env-proj", 3),
                 (["g/cli-proj"], "g/cli-proj", 3),
                 (["--interval", "7"], "g/env-proj", 7),
                 (["g/cli-proj", "--interval", "7"], "g/cli-proj", 7))
        for extra, project, interval in cases:
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as directory:
                (Path(directory) / ".env").write_text(env, encoding="utf-8")
                logs = []
                with patch.object(monitor, "ROOT", Path(directory)), \
                     patch.object(monitor.sys, "argv", ["monitor", *extra, "--once", "--no-notify"]), \
                     patch.object(monitor, "GitLab"), patch.object(monitor, "collect", return_value=({}, [])), \
                     patch.object(monitor, "log", side_effect=logs.append):
                    self.assertEqual(monitor.main(), 0)
                self.assertIn(f"Monitorando {project} a cada {interval:g} minuto(s)", logs[0])

    def test_project_is_required_when_env_has_none(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(
                "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\nPROJECT=\n", encoding="utf-8")
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor"]), patch.object(monitor.sys, "stderr", StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    monitor.main()
                self.assertEqual(raised.exception.code, 2)

    def test_initial_and_unchanged_are_quiet(self):
        client = Client([row(1)], [row(1)])
        baseline, events = monitor.collect(client, "1", None)
        self.assertEqual(events, [])
        self.assertEqual(monitor.collect(client, "1", baseline), (baseline, []))

    def test_same_total_still_detects_entry_and_exit(self):
        previous = {"1": monitor.snapshot(row(1), [])}
        current, events = monitor.collect(Client([row(2)], [row(1, "merged"), row(2)]), "1", previous)
        self.assertEqual(len(current), len(previous))
        self.assertIn("MESCLADO", events[0])
        self.assertIn("NOVO MR ABERTO", events[1])

    def test_likes_and_pipeline_status_or_identity(self):
        old = row(1, likes=2, pipeline={"id": 10, "status": "running"})
        previous = {"1": monitor.snapshot(old, [])}
        for pipeline in ({"id": 10, "status": "failed"}, {"id": 11, "status": "running"}, None):
            with self.subTest(pipeline=pipeline):
                new = row(1, likes=1, pipeline=pipeline)
                _, events = monitor.collect(Client([new], [new]), "1", previous)
                self.assertEqual(len(events), 2)
                self.assertIn("LIKES 2 → 1", events[0])
                self.assertIn("PIPELINE", events[1])

    def test_failed_detail_preserves_baseline(self):
        previous = {"1": monitor.snapshot(row(1), [])}
        original = copy.deepcopy(previous)
        client = Client([], [])
        with patch.object(client, "detail", side_effect=RuntimeError("HTTP 403")):
            with self.assertRaises(RuntimeError):
                monitor.collect(client, "1", previous)
        self.assertEqual(previous, original)

    def test_race_between_listing_and_a_later_close_self_corrects_next_cycle(self):
        # scan() confia no "opened" que a própria listagem já filtrou, em vez
        # de checar o estado de novo por MR (isso custava 1 detail a mais por
        # MR a cada ciclo). Uma mudança entre a listagem e o fim do ciclo,
        # rara e de milissegundos, aparece com um ciclo de atraso: a listagem
        # seguinte já não traz mais o MR, e o loop de saída confirma o estado.
        previous = {"1": monitor.snapshot(row(1), [])}
        client = Client([row(1)], [row(1, "closed")])
        current, events = monitor.collect(client, "1", previous)
        self.assertEqual(current, previous)
        self.assertEqual(events, [])
        client.rows = {}
        current, events = monitor.collect(client, "1", current)
        self.assertEqual(current, {})
        self.assertIn("FECHADO", events[0])

    def test_pagination_gap_self_heals_via_the_exit_check(self):
        # Um MR que a listagem desta passagem não trouxe (paginação, latência)
        # ainda é confirmado individualmente antes de contar como saída.
        previous = {"1": monitor.snapshot(row(1), [])}
        current, events = monitor.collect(Client([], [row(1)]), "1", previous)
        self.assertEqual(current, previous)
        self.assertEqual(events, [])

    def test_acompanhar_paginates_across_graphql_pages(self):
        client = monitor.GitLab("https://gitlab.example/api/v4", "fake")
        no1, no2 = rest_row_to_graphql_node(row(1)), rest_row_to_graphql_node(row(2))
        with patch.object(client, "graphql", side_effect=[
            graphql_response([no1], has_next=True, end_cursor="C1"),
            graphql_response([no2], has_next=False),
        ]) as graphql:
            nos, por_chave, mine = client.acompanhar("g%2Fp")
        self.assertEqual(set(por_chave), {"1", "2"})
        self.assertEqual(len(nos), 2)
        # A segunda página pede a partir do cursor que a primeira devolveu.
        self.assertEqual(graphql.call_args_list[1].args[2]["depoisDe"], "C1")
        self.assertIsNone(graphql.call_args_list[0].args[2]["depoisDe"])

    def test_ids_from_api_cannot_steer_the_request_path(self):
        client = monitor.GitLab("https://gitlab.example/api/v4", "fake")
        # project já vem escapado de project_path: não pode ser escapado de novo.
        self.assertEqual(client.target("g%2Fsub%2Fp", "7"),
                         "/projects/g%2Fsub%2Fp/merge_requests/7")
        self.assertEqual(client.target("groups/flake%2Fsiga", "12:7"),
                         "/projects/12/merge_requests/7")
        # Separadores vindos da API viram %2F/%23/%3F e ficam presos no segmento.
        hostile = (("groups/flake%2Fsiga", "../../../admin/users#:7"),
                   ("groups/flake%2Fsiga", "12:../../../admin/users?x=1"),
                   ("p", "../../../admin/users#"))
        for project, iid in hostile:
            with self.subTest(iid=iid):
                path = client.target(project, iid)
                head, project_id, middle, number = path.split("/")[1:]
                self.assertEqual((head, middle), ("projects", "merge_requests"))
                for segment in (project_id, number):
                    self.assertFalse(set(segment) & set("/#?"), segment)

    def test_detail_and_discussions_escape_ids_before_sending_the_token(self):
        client = monitor.GitLab("https://gitlab.example/api/v4", "fake")
        requests = []

        def capture(request, timeout=None):
            requests.append(request.full_url)
            raise monitor.HTTPError(request.full_url, 404, "Not Found", {}, None)

        with patch.object(client.opener, "open", side_effect=capture):
            for call in (lambda: client.detail("groups/g", "../../x#:1"),
                         lambda: client.discussions("groups/g", "1:../../x#")):
                with self.assertRaises(RuntimeError):
                    call()
        self.assertEqual(len(requests), 2)
        for url in requests:
            parts = urlsplit(url)
            self.assertEqual((parts.scheme, parts.netloc, parts.fragment), ("https", "gitlab.example", ""))
            self.assertEqual(parts.path.split("/")[:4], ["", "api", "v4", "projects"])

    def test_credentials_paths_and_atomic_state(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / ".env"
            env.write_text('export GITLAB_API_URL="https://gitlab.example/api/v4" # test\n'
                           "GITLAB_TOKEN='literal#$(do-not-execute)'\n", encoding="utf-8")
            base, token = monitor.credentials(env)
            self.assertEqual(token, "literal#$(do-not-execute)")
            self.assertEqual(monitor.project_path("https://gitlab.example/g/sub/p/-/merge_requests", base), "g%2Fsub%2Fp")
            with self.assertRaises(ValueError):
                monitor.project_path("https://other.example/g/p", base)
            state = Path(directory) / "state.json"
            monitor.save(state, {"mrs": {}})
            original = state.read_bytes()
            with patch.object(monitor.os, "fsync", side_effect=OSError):
                with self.assertRaises(OSError):
                    monitor.save(state, {"mrs": {"1": {}}})
            self.assertEqual(state.read_bytes(), original)

    def test_target_survives_a_round_trip_through_the_panel_form(self):
        # O formulário devolve o alvo como o monitor o exibe. Se essa forma não
        # for aceita de volta, salvar sem editar nada troca o alvo e dá 404.
        base = "https://gitlab.example/api/v4"
        for entrada in ("https://gitlab.example/groups/flake/siga/-/merge_requests/",
                        "https://gitlab.example/flake/siga/projeto",
                        "groups/flake/siga", "flake/siga/projeto", "123"):
            with self.subTest(entrada=entrada):
                alvo = monitor.project_path(entrada, base)
                self.assertEqual(monitor.project_path(unquote(alvo), base), alvo)

    def test_canonical_group_path_is_not_read_as_a_project(self):
        base = "https://gitlab.example/api/v4"
        self.assertEqual(monitor.project_path("groups/flake/siga", base), "groups/flake%2Fsiga")
        # Antes, isto virava projects/groups%2Fflake%2Fsiga e o GitLab devolvia 404.
        client = monitor.GitLab(base, "fake")
        self.assertTrue(monitor.project_path("groups/flake/siga", base).startswith("groups/"))
        self.assertEqual(client.target("groups/flake%2Fsiga", "12:7"),
                         "/projects/12/merge_requests/7")
        for invalido in ("groups/", "groups/..", "groups/a//b"):
            with self.subTest(invalido=invalido), self.assertRaises(ValueError):
                monitor.project_path(invalido, base)

    def test_group_url_requires_merge_requests_suffix(self):
        base = "https://gitlab.fpf.br/api/v4"
        url = "https://gitlab.fpf.br/groups/flake/siga/-/merge_requests"
        for suffix in ("", "/", "/?sort=created_date&state=opened&first_page_size=20"):
            self.assertEqual(monitor.project_path(url + suffix, base), "groups/flake%2Fsiga")
        for invalid in ("https://gitlab.fpf.br/groups/flake/siga", url + "/12", url.replace("merge_requests", "issues")):
            with self.assertRaises(ValueError):
                monitor.project_path(invalid, base)

    def test_group_merge_requests_key_by_project_and_iid(self):
        client = monitor.GitLab("https://gitlab.example/api/v4", "fake")
        first = rest_row_to_graphql_node(dict(row(1), project_id=10))
        second = rest_row_to_graphql_node(dict(row(1), project_id=20))
        with patch.object(client, "graphql", return_value=graphql_response([first, second])) as graphql:
            current, events = monitor.collect(client, "groups/g", None)
        self.assertEqual(set(current), {"10:1", "20:1"})
        self.assertEqual(events, [])
        self.assertEqual(graphql.call_args.args[2]["fullPath"], "g")

    def test_group_compares_and_confirms_missing_mr_in_own_project(self):
        client = monitor.GitLab("https://gitlab.example/api/v4", "fake")
        previous = {"10:1": monitor.snapshot(row(1), []), "20:1": monitor.snapshot(row(1), [])}
        changed = rest_row_to_graphql_node(dict(row(1, likes=2), project_id=10))
        with patch.object(client, "graphql", return_value=graphql_response([changed])),              patch.object(client, "detail", return_value=row(1, "merged")) as detail:
            current, events = monitor.collect(client, "groups/g", previous)
        self.assertEqual(set(current), {"10:1"})
        # O id do projeto sai do texto; a URL é o que distingue os dois MRs.
        self.assertNotIn("Projeto", events[0] + events[1])
        self.assertEqual(events[0].splitlines(), [
            "!1 — MR 1", "LIKES 0 → 2", "https://gitlab.example/g/p/-/merge_requests/1"])
        self.assertEqual(events[1].splitlines()[:2], ["!1 — MR 1", "MESCLADO"])
        # O MR que sumiu da listagem (20:1) é confirmado individualmente.
        self.assertEqual(detail.call_args.args, ("groups/g", "20:1"))

    def test_events_are_one_item_per_line(self):
        changed = row(1, likes=2, pipeline={"id": 9, "status": "success"})
        client = Client([changed], [changed])
        _, events = monitor.collect(client, "1", {"1": monitor.snapshot(row(1), [])})
        self.assertEqual(len(events), 2)
        for event in events:
            identification, change, url = event.splitlines()
            self.assertEqual(identification, "!1 — MR 1")
            self.assertTrue(change)
            self.assertEqual(url, "https://gitlab.example/g/p/-/merge_requests/1")

    def test_notification_separates_events_with_a_blank_line(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(
                "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\n", encoding="utf-8")
            events = ["!1 — MR 1\nMESCLADO\nhttps://gitlab.example/1",
                      "!2 — MR 2\nLIKES 0 → 2\nhttps://gitlab.example/2"]
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor", "g/p", "--once"]), \
                 patch.object(monitor, "GitLab"), patch.object(monitor, "log"), \
                 patch.object(monitor, "collect", side_effect=[({"1": {}}, []), ({"1": {}}, events)]), \
                 patch.object(monitor.time, "sleep"), patch.object(monitor, "notify") as notify:
                monitor.main()
                monitor.main()
        self.assertEqual(notify.call_args.args[1], "\n\n".join(events))
        self.assertIn("MESCLADO\nhttps://gitlab.example/1\n\n!2 — MR 2", notify.call_args.args[1])

    def test_log_indents_continuation_lines(self):
        with patch.object(monitor.sys, "stdout", StringIO()) as stream:
            monitor.log("!1 — MR 1\nLIKES 0 → 2\nhttps://gitlab.example/x")
            printed = stream.getvalue()
        self.assertNotIn("\nLIKES", printed)
        self.assertIn("\n  LIKES 0 → 2\n  https://gitlab.example/x", printed)

    def test_notification_passes_text_as_data(self):
        with patch.object(monitor.sys, "platform", "darwin"), patch.object(monitor.shutil, "which", return_value="osascript"), patch.object(monitor.subprocess, "run") as run:
            monitor.notify("GitLab", 'Título "com aspas" $(literal)')
            self.assertEqual(run.call_args.args[0][-1], 'Título "com aspas" $(literal)')


def merge_request(iid, repo, title, author, likes, state="opened", status=None,
                  created="2026-10-01T10:00:00.000Z", project_id=1):
    return {"iid": iid, "state": state, "title": title, "upvotes": likes,
            "author": {"username": author}, "created_at": created,
            "head_pipeline": None if status is None else {"id": 1, "status": status},
            "web_url": f"https://gitlab.fpf.br/g/poc-sdd-{repo}/-/merge_requests/{iid}",
            "project_id": project_id}


def thread_notes(openers, resolved=True):
    return [{"id": index, "notes": [{"resolvable": True, "resolved": resolved,
                                     "author": {"username": who}}]}
            for index, who in enumerate(openers)]


def listing_mock(client, rows):
    """Faz um client.acompanhar() Mock responder como scan() espera.

    A mesma fonte de verdade (rows) alimenta a chamada, e por side_effect:
    um teste reatribui rows["1"] entre duas passagens, e a resposta precisa
    refletir o estado atual a cada chamada.
    """
    client.web_root = "https://gitlab.fpf.br"

    def responder(project):
        nos = [rest_row_to_graphql_node(r, web_root=client.web_root) for r in rows.values()]
        por_chave = {str(r["iid"]): rest_row_to_graphql_node(r, web_root=client.web_root)
                     for r in rows.values()}
        return nos, por_chave, set()
    client.acompanhar.side_effect = responder


class ReportTests(unittest.TestCase):
    mr = staticmethod(merge_request)
    threads = staticmethod(thread_notes)

    def test_report_row_summarizes_threads_authors_and_project(self):
        row = monitor.report_row(
            self.mr(199, "backend", "feat(#ANT-8951): cadastro", "geovana.medeiros", 2),
            self.threads(["heloysa.uchoa", "luma.silva", "heloysa.uchoa"]))
        self.assertEqual(row["likes"], "2 \N{THUMBS UP SIGN}")
        self.assertEqual(row["mr"], "BE #199 feat(#ANT-8951): cadastro")
        self.assertEqual(row["author"], "geovana.medeiros")
        self.assertEqual(row["threads"], "3/3 resolvidas")
        # Nome de usuário completo, sem repetir quem abriu mais de uma thread.
        self.assertEqual(row["openers"], "heloysa.uchoa, luma.silva")

    def test_report_row_ignores_comments_without_thread_state(self):
        loose = [{"id": 1, "notes": [{"resolvable": False, "author": {"username": "ana.lima"}}]}]
        row = monitor.report_row(self.mr(7, "frontend", "t", "ana.lima", 0), loose)
        self.assertEqual(row["mr"], "FE #7 t")
        self.assertEqual(row["threads"], "sem threads")
        self.assertEqual(row["openers"], "—")

    def test_project_label_falls_back_to_the_repository_name(self):
        self.assertEqual(monitor.project_label("https://g.example/a/b/outro-repo/-/merge_requests/1"),
                         "outro-repo")

    def test_report_sorts_by_creation_date_not_likes(self):
        # O mais curtido é o mais antigo: a ordem segue a data, não os likes.
        # Um MR mesclado não entra aqui: a própria listagem já filtra por
        # "opened" no servidor, e scan() não confere o estado de novo por MR
        # (ver test_race_between_listing_and_a_later_close_self_corrects_next_cycle).
        rows = {"1": self.mr(1, "backend", "antigo", "ana.lima", 9,
                             created="2026-09-01T10:00:00.000Z"),
                "2": self.mr(2, "frontend", "recente", "bia.sa", 0,
                             created="2026-10-19T10:00:00.000Z"),
                "3": self.mr(3, "frontend", "do meio", "cris.me", 3,
                             created="2026-10-02T10:00:00.000Z")}
        client = Mock()
        listing_mock(client, rows)
        report = monitor.report(client, "groups/g")
        self.assertEqual([row["mr"] for row in report],
                         ["FE #2 recente", "FE #3 do meio", "BE #1 antigo"])

    def test_report_tolerates_missing_or_invalid_creation_date(self):
        rows = {"1": self.mr(1, "backend", "sem data", "ana.lima", 0, created=None),
                "2": self.mr(2, "frontend", "com data", "bia.sa", 0,
                             created="2026-10-19T10:00:00.000Z")}
        client = Mock()
        listing_mock(client, rows)
        report = monitor.report(client, "groups/g")
        self.assertEqual([row["mr"] for row in report], ["FE #2 com data", "BE #1 sem data"])

    def test_table_lines_share_the_same_display_width(self):
        rows = [monitor.report_row(self.mr(199, "backend", "titulo bem longo " * 6, "geovana.medeiros", 2),
                                   self.threads(["heloysa.uchoa"])),
                monitor.report_row(self.mr(7, "frontend", "curto", "ana.lima", 0), [])]
        table = monitor.render_table(rows, links=False)
        self.assertEqual(len({monitor.text_width(line) for line in table.splitlines()}), 1)
        self.assertIn("Devs que abriram", table)
        self.assertIn("Pipeline Status", table)
        self.assertIn("BE #199", table)

    def test_pipeline_status_covers_absent_and_unknown_states(self):
        self.assertEqual(monitor.pipeline_status(None), "— sem pipeline")
        self.assertEqual(monitor.pipeline_status({"id": 1, "status": "success"}),
                         "\N{WHITE HEAVY CHECK MARK} success")
        self.assertEqual(monitor.pipeline_status({"id": 1, "status": "failed"}),
                         "\N{CROSS MARK} failed")
        # Estado novo do GitLab aparece como veio, em vez de sumir da tabela.
        self.assertEqual(monitor.pipeline_status({"id": 1, "status": "inedito"}),
                         "\N{BULLET} inedito")

    def test_every_pipeline_emoji_has_unambiguous_width(self):
        # Emoji de largura ambígua desalinha a tabela em boa parte dos
        # terminais; esta regra vale para qualquer estado acrescentado depois.
        for status, label in monitor.PIPELINE_STATUS.items():
            with self.subTest(status=status):
                emoji = label.split(" ")[0]
                self.assertTrue(all(unicodedata.east_asian_width(c) in "WF" for c in emoji), emoji)
                self.assertEqual(monitor.text_width(emoji), 2)

    def test_table_stays_aligned_with_every_pipeline_state(self):
        states = [*monitor.PIPELINE_STATUS, None, "estado-novo"]
        rows = [monitor.report_row(
            self.mr(index, "backend", f"titulo {state}", "ana.lima", index, status=state), [])
            for index, state in enumerate(states)]
        table = monitor.render_table(rows, links=False)
        self.assertEqual(len({monitor.text_width(line) for line in table.splitlines()}), 1)

    def test_mr_column_is_a_link_and_links_do_not_change_the_layout(self):
        rows = [monitor.report_row(
            self.mr(199, "backend", "titulo que ocupa mais de uma linha " * 3,
                    "geovana.medeiros", 2, status="running"),
            self.threads(["heloysa.uchoa"]))]
        url = rows[0]["url"]
        plain = monitor.render_table(rows, links=False)
        linked = monitor.render_table(rows, links=True)
        self.assertNotIn("\033]8;;", plain)
        # Cada linha da célula MR vira âncora para o mesmo MR, inclusive as
        # geradas pela quebra do título.
        limits = {key: limit for key, _, limit in monitor.REPORT_COLUMNS}
        expected = len(textwrap.wrap(rows[0]["mr"], limits["mr"]))
        self.assertGreater(expected, 1)
        self.assertEqual(linked.count(f"\033]8;;{url}\033\\"), expected)
        # Removidos os códigos, o desenho é idêntico ao da versão sem link.
        self.assertEqual(re.sub("\033\\]8;;[^\033]*\033\\\\", "", linked), plain)
        self.assertEqual(len({monitor.text_width(line) for line in plain.splitlines()}), 1)

    def test_links_are_disabled_when_output_is_not_a_terminal(self):
        rows = [monitor.report_row(self.mr(1, "backend", "um", "ana.lima", 0), [])]
        with patch.object(monitor.sys, "stdout", StringIO()):
            self.assertNotIn("\033]8;;", monitor.render_table(rows))

    def test_mode_prompt_defaults_to_monitoring_and_rejects_invalid_input(self):
        with patch.object(monitor.sys.stdin, "isatty", return_value=False):
            self.assertEqual(monitor.choose_mode(), "monitorar")
        for answers, expected in ((["1"], "monitorar"), ([""], "monitorar"), (["2"], "relatorio"),
                                  (["3"], "painel"), (["4"], "web"), (["9", "2"], "relatorio")):
            with self.subTest(answers=answers), \
                 patch.object(monitor.sys.stdin, "isatty", return_value=True), \
                 patch("builtins.input", side_effect=answers), patch("builtins.print"):
                self.assertEqual(monitor.choose_mode(), expected)

    def test_report_mode_does_not_lock_notify_or_write_history(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(
                "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\n", encoding="utf-8")
            built = [monitor.report_row(self.mr(1, "backend", "um", "ana.lima", 1), [])]
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor", "g/p", "--mode", "relatorio"]), \
                 patch.object(monitor, "GitLab"), patch.object(monitor, "log"), \
                 patch.object(monitor, "report", return_value=built) as report, \
                 patch.object(monitor, "acquire_lock") as lock, \
                 patch.object(monitor, "notify") as notify, \
                 patch.object(monitor, "collect") as collect, patch("builtins.print"):
                self.assertEqual(monitor.main(), 0)
            report.assert_called_once()
            lock.assert_not_called()
            notify.assert_not_called()
            collect.assert_not_called()
            self.assertFalse((Path(directory) / "gitlab-history").exists())


class PanelTests(unittest.TestCase):
    mr = staticmethod(merge_request)
    threads = staticmethod(thread_notes)
    rows = None

    def setUp(self):
        self.rows = [monitor.report_row(
            {"iid": 199, "state": "opened", "upvotes": 2, "created_at": "2026-10-19T10:00:00Z",
             "title": 'cadastro & <script>alert("x")</script>',
             "author": {"username": "geovana.medeiros"},
             "head_pipeline": {"id": 1, "status": "failed"},
             "web_url": "https://gitlab.example/g/poc-sdd-backend/-/merge_requests/199"}, [])]

    def test_html_escapes_gitlab_text_and_links_the_mr(self):
        page = monitor.render_html(self.rows, "flake/siga", 15)
        # A casca tem o script do painel; o conteúdo do GitLab, não.
        fragment = monitor.render_fragment(self.rows)
        self.assertNotIn("<script>", fragment)
        self.assertNotIn('alert("x")', page)
        self.assertIn("&lt;script&gt;alert(&quot;x&quot;)&lt;/script&gt;", page)
        self.assertIn('<a href="https://gitlab.example/g/poc-sdd-backend/-/merge_requests/199"'
                      ' target="_blank" rel="noopener noreferrer">', page)
        for _, header, _ in monitor.REPORT_COLUMNS:
            self.assertIn(f"<th>{header}</th>", page)

    def test_page_refreshes_itself_without_meta_refresh(self):
        page = monitor.render_html([], "flake/siga", 15)
        # meta refresh recarregava a página inteira e só no fim do intervalo.
        self.assertNotIn("http-equiv=\"refresh\"", page)
        self.assertIn("setTimeout(poll", page)
        self.assertIn("fetch('data?' + query()", page)
        snapshot = monitor.panel_snapshot(monitor.panel_state("g%2Fp", 15), 0)
        # A página busca em segundos, não no ciclo de minutos do servidor.
        self.assertEqual(snapshot["poll"], monitor.POLL_SECONDS)
        self.assertLessEqual(snapshot["poll"], 30)

    def test_html_uses_semantic_tones_from_the_design_guide(self):
        cases = (("failed", "badge--danger"), ("success", "badge--success"),
                 ("running", "badge--info"), ("pending", "badge--warning"))
        for status, expected in cases:
            with self.subTest(status=status):
                row = monitor.report_row(
                    {"iid": 1, "state": "opened", "upvotes": 0, "title": "t",
                     "created_at": "2026-10-19T10:00:00Z", "author": {"username": "ana.lima"},
                     "head_pipeline": {"id": 1, "status": status},
                     "web_url": "https://gitlab.example/g/poc-sdd-backend/-/merge_requests/1"}, [])
                self.assertIn(expected, monitor.render_html([row], "g", 60))
        # Estado sem tom definido cai no badge neutro.
        neutral = monitor.report_row(
            {"iid": 1, "state": "opened", "upvotes": 0, "title": "t",
             "created_at": "2026-10-19T10:00:00Z", "author": {"username": "ana.lima"},
             "head_pipeline": {"id": 1, "status": "manual"},
             "web_url": "https://gitlab.example/g/poc-sdd-backend/-/merge_requests/1"}, [])
        self.assertIsNone(neutral["pipeline_tone"])

    def test_threads_tone_follows_resolution(self):
        notes = lambda resolved: [{"id": 1, "notes": [{"resolvable": True, "resolved": resolved,
                                                       "author": {"username": "ana.lima"}}]}]
        base = {"iid": 1, "state": "opened", "upvotes": 0, "title": "t",
                "created_at": "2026-10-19T10:00:00Z", "author": {"username": "ana.lima"},
                "head_pipeline": None,
                "web_url": "https://gitlab.example/g/poc-sdd-backend/-/merge_requests/1"}
        self.assertEqual(monitor.report_row(base, notes(True))["threads_tone"], "success")
        self.assertEqual(monitor.report_row(base, notes(False))["threads_tone"], "warning")
        self.assertIsNone(monitor.report_row(base, [])["threads_tone"])

    def test_stylesheet_keeps_colors_in_tokens_and_supports_dark_mode(self):
        tokens = monitor.asset("styles/tokens.css")
        self.assertIn(':root[data-theme="dark"]', tokens)
        for token in ("--surface-default", "--border-default", "--content-primary",
                      "--status-success-content", "--status-danger-content",
                      "--radius-md", "--space-4", "--font-family"):
            self.assertIn(token, tokens, token)
        # Critério do guia: cor, spacing e radius só no arquivo de tokens.
        for name in monitor.STYLE_FILES:
            if name.endswith("tokens.css"):
                continue
            with self.subTest(stylesheet=name):
                rules = monitor.asset(name)
                self.assertNotIn("#", rules)
                self.assertNotIn("rgba(", rules)
                # "Sem valores hex ou px hardcoded": a única exceção é a
                # condição de @media, que não aceita custom property.
                medidas = [linha for linha in rules.splitlines()
                           if re.search(r"\b\d+px\b", linha) and "@media" not in linha]
                self.assertEqual(medidas, [], medidas)
        self.assertIn("--surface-default", monitor.stylesheet())

    def test_tokens_follow_the_design_system_palette(self):
        tokens = monitor.asset("styles/tokens.css")
        # Valores publicados nos guias button e input.
        for token, valor in (("--interactive-primary", "#B3C50E"),
                             ("--interactive-primary-hover", "#8FA00B"),
                             ("--interactive-primary-on", "#383839"),
                             ("--border-focus", "#B3C50E"),
                             ("--content-tertiary", "#8C8C8C")):
            with self.subTest(token=token):
                self.assertIn(f"{token}: {valor};", tokens)
        # Dark mode precisa redefinir o que muda de tema.
        escuro = tokens.split(':root[data-theme="dark"]', 1)[1]
        for token in ("--interactive-primary-hover", "--interactive-primary-on",
                      "--surface-default", "--content-tertiary"):
            with self.subTest(dark=token):
                self.assertIn(token, escuro)

    def test_theme_can_be_chosen_and_falls_back_to_the_system(self):
        page = monitor.render_html([], "flake/siga", 15)
        for valor in ('value="auto"', 'value="light"', 'value="dark"'):
            self.assertIn(valor, page)
        inicial = monitor.asset("scripts/theme.js")
        # O tema é resolvido no <head>, antes da folha de estilo, para a
        # página não piscar clara antes de escurecer.
        self.assertLess(page.index(inicial[:40]), page.index("<style>"))
        self.assertIn("prefers-color-scheme: dark", inicial)
        self.assertIn("localStorage.getItem('tema')", inicial)
        painel = monitor.asset("scripts/panel.js")
        self.assertIn("localStorage.setItem('tema'", painel)
        # No automático, seguir a troca do sistema sem recarregar.
        self.assertIn("sistemaEscuro.addEventListener('change'", painel)

    def test_dark_tokens_live_in_a_single_block(self):
        tokens = monitor.asset("styles/tokens.css")
        # Dois blocos escuros (um por media query, outro por atributo) sairiam
        # de sincronia; o automático é resolvido em JavaScript justamente
        # para que exista só um.
        self.assertEqual(tokens.count(':root[data-theme="dark"]'), 1)
        self.assertNotIn("prefers-color-scheme", tokens)

    def test_button_and_input_cover_the_required_states(self):
        botao = monitor.asset("styles/components/button.css")
        for estado in (":hover", ":active", ":focus-visible", ":disabled", 'aria-busy="true"'):
            with self.subTest(estado=estado):
                self.assertIn(estado, botao)
        for variante in (".button--primary", ".button--ghost"):
            self.assertIn(variante, botao)
        campo = monitor.asset("styles/components/form.css")
        for estado in (":focus", 'aria-invalid="true"', ":disabled", "[readonly]", "::placeholder"):
            with self.subTest(estado=estado):
                self.assertIn(estado, campo)
        # Foco usa o token da marca, não uma cor qualquer.
        self.assertIn("outline: var(--focus-ring) solid var(--border-focus)", campo)
        self.assertIn("outline: var(--focus-ring) solid var(--border-focus)", botao)

    def test_actions_use_the_design_system_button(self):
        page = monitor.render_html([], "flake/siga", 15)
        self.assertIn('class="button button--primary"', page)
        self.assertIn("button button--ghost", page)

    def test_every_stylesheet_listed_exists_on_disk(self):
        for name in monitor.STYLE_FILES:
            with self.subTest(stylesheet=name):
                self.assertTrue((monitor.ASSETS / name).is_file(), name)
        for name in ("templates/page.html", "scripts/panel.js", "components/badge.html",
                     "components/table.html", "components/empty.html",
                     "components/toolbar.html", "components/settings.html"):
            with self.subTest(asset=name):
                self.assertTrue((monitor.ASSETS / name).is_file(), name)

    def linha(self, iid=1, likes=0, status=None, discussoes=()):
        return monitor.report_row(
            self.mr(iid, "backend", f"titulo {iid}", "ana.lima", likes, status=status),
            list(discussoes))

    def test_only_the_fields_that_changed_are_marked(self):
        anterior = [self.linha(likes=1, status="running",
                               discussoes=self.threads(["ana.lima"], resolved=False))]
        atual = [self.linha(likes=3, status="running",
                            discussoes=self.threads(["ana.lima"], resolved=False))]
        monitor.mark_changes(atual, anterior)
        self.assertEqual(atual[0]["changed"], frozenset({"likes"}))

        atual = [self.linha(likes=1, status="success",
                            discussoes=self.threads(["ana.lima"], resolved=False))]
        monitor.mark_changes(atual, anterior)
        self.assertEqual(atual[0]["changed"], frozenset({"pipeline"}))

        # Thread resolvida muda a célula de threads, não a de quem abriu.
        atual = [self.linha(likes=1, status="running",
                            discussoes=self.threads(["ana.lima"], resolved=True))]
        monitor.mark_changes(atual, anterior)
        self.assertEqual(atual[0]["changed"], frozenset({"threads"}))

        # Thread nova de outra pessoa muda as duas.
        atual = [self.linha(likes=1, status="running",
                            discussoes=self.threads(["ana.lima", "bia.sa"], resolved=False))]
        monitor.mark_changes(atual, anterior)
        self.assertEqual(atual[0]["changed"], frozenset({"threads", "openers"}))

    def test_nothing_is_marked_without_a_previous_pass_or_without_changes(self):
        atual = [self.linha(likes=2)]
        monitor.mark_changes(atual, None)
        self.assertEqual(atual[0]["changed"], frozenset())
        # MR que ainda não existia na passagem anterior também não é marcado.
        monitor.mark_changes(atual, [self.linha(iid=99, likes=0)])
        self.assertEqual(atual[0]["changed"], frozenset())
        igual = [self.linha(likes=2)]
        monitor.mark_changes(igual, [self.linha(likes=2)])
        self.assertEqual(igual[0]["changed"], frozenset())

    def test_mark_appears_inside_the_changed_cell_only(self):
        atual = [self.linha(likes=3, status="failed")]
        monitor.mark_changes(atual, [self.linha(likes=1, status="failed")])
        html = monitor.render_fragment(atual)
        self.assertEqual(html.count(monitor.CHANGE_MARK), 1)
        likes = html.split('<td class="likes">')[1].split("</td>")[0]
        self.assertIn(monitor.CHANGE_MARK, likes)
        # A marca vem antes do conteúdo da célula.
        self.assertLess(likes.index(monitor.CHANGE_MARK), likes.index("badge"))
        # E dentro do invólucro flex, que impede a quebra para a linha de cima.
        self.assertTrue(likes.startswith('<span class="cell">'), likes)
        for coluna in ("pipeline", "threads", "openers", "mr"):
            with self.subTest(coluna=coluna):
                celula = html.split(f'<td class="{coluna}">')[1].split("</td>")[0]
                self.assertNotIn(monitor.CHANGE_MARK, celula)

    def test_cell_wrapper_keeps_the_mark_beside_the_content(self):
        atual = [self.linha(likes=3, status="failed",
                            discussoes=self.threads(["ana.lima"], resolved=False))]
        monitor.mark_changes(atual, [self.linha(likes=1, status="success",
                                                discussoes=self.threads(["bia.sa"]))])
        html = monitor.render_fragment(atual)
        # Toda célula sai embrulhada, marcada ou não: o invólucro é o que
        # garante marca e conteúdo lado a lado em qualquer largura de coluna.
        for key, _, _ in monitor.REPORT_COLUMNS:
            with self.subTest(coluna=key):
                celula = html.split(f'<td class="{key}">')[1].split("</td>")[0]
                self.assertTrue(celula.startswith('<span class="cell">'), celula)
        estilo = monitor.asset("styles/components/table.css")
        self.assertIn(".cell {", estilo)
        self.assertIn("display: inline-flex", estilo)
        # Margem entre a marca e a borda da célula.
        self.assertIn("margin-left: var(--space-1)", estilo)

    def test_terminal_table_has_no_change_marks(self):
        atual = [self.linha(likes=3)]
        monitor.mark_changes(atual, [self.linha(likes=1)])
        # A marca é só do painel web; a tabela do terminal segue limpa.
        self.assertNotIn(monitor.CHANGE_MARK, monitor.render_table(atual, links=False))

    def test_mr_links_open_in_a_new_tab_without_handing_over_the_page(self):
        html = monitor.render_fragment(self.rows)
        self.assertEqual(html.count('target="_blank"'), len(self.rows))
        # rel evita que a guia aberta possa manipular esta página.
        self.assertEqual(html.count('rel="noopener noreferrer"'), len(self.rows))

    def test_panel_offers_an_on_demand_notification_test(self):
        # Sem isso, silêncio no painel é ambíguo: pode ser que nada mudou nos
        # MRs, ou que o aviso saiu daqui e o sistema o engoliu.
        page = monitor.render_html(self.rows, "g/p", 15)
        self.assertIn('id="test-notify"', page)
        # Botão fora do envio do formulário: testar não pode salvar o alvo.
        self.assertIn('type="button" class="button" id="test-notify"', page)
        script = monitor.asset("scripts/panel.js")
        self.assertIn("panel.test.addEventListener('click'", script)
        self.assertIn("Notificação de teste", script)

    def test_legend_explains_the_change_mark(self):
        page = monitor.render_html([], "flake/siga", 15)
        legenda = page.split('class="legend"')[1].split("</p>")[0]
        self.assertIn(monitor.CHANGE_MARK, legenda)
        self.assertIn("mudou desde a verificação anterior", legenda)
        self.assertIn(monitor.MINE_MARK, legenda)
        self.assertIn("seu like está entre eles", legenda)

    def test_first_load_says_it_is_loading_instead_of_reporting_an_empty_target(self):
        # A primeira consulta leva segundos; dizer "nenhum MR" nesse intervalo
        # faz a página parecer quebrada logo na primeira execução.
        carregando = monitor.render_html([], "flake/siga", 15)
        self.assertIn(monitor.LOADING_MESSAGE, carregando)
        self.assertNotIn(monitor.EMPTY_TARGET_MESSAGE, carregando)
        self.assertNotIn("<table>", carregando)
        # Depois da consulta, aí sim o alvo pode estar realmente vazio.
        vazio = monitor.render_html([], "flake/siga", 15, monitor.datetime.now().astimezone())
        self.assertIn(monitor.EMPTY_TARGET_MESSAGE, vazio)
        self.assertNotIn(monitor.LOADING_MESSAGE, vazio)

    def test_each_empty_state_has_its_own_message(self):
        estado = monitor.panel_state("g%2Fp", 15)
        self.assertIn(monitor.LOADING_MESSAGE, monitor.panel_snapshot(estado, 0)["table"])
        estado["updated"] = monitor.datetime.now().astimezone()
        self.assertIn(monitor.EMPTY_TARGET_MESSAGE, monitor.panel_snapshot(estado, 0)["table"])
        estado["rows"] = self.rows
        self.assertIn("BE #199", monitor.panel_snapshot(estado, 0)["table"])
        filtrado = monitor.panel_snapshot(estado, 0, author="ninguem")["table"]
        self.assertIn(monitor.EMPTY_FILTER_MESSAGE, filtrado)

    def test_first_pass_fills_the_table_without_emitting_events(self):
        # report e painel: a primeira passagem já devolve as linhas e nenhum
        # evento; a comparação começa da segunda em diante.
        rows = {"1": self.mr(1, "backend", "um", "ana.lima", 1)}
        client = Mock()
        listing_mock(client, rows)
        snapshots, events, linhas = monitor.scan(client, "g%2Fp", None)
        self.assertEqual(events, [])
        self.assertEqual([linha["mr"] for linha in linhas], ["BE #1 um"])
        self.assertEqual([linha["mr"] for linha in monitor.report(client, "g%2Fp")], ["BE #1 um"])
        # Segunda passagem, agora com referência: a mudança vira evento.
        rows["1"] = self.mr(1, "backend", "um", "ana.lima", 4)
        _, segunda, linhas = monitor.scan(client, "g%2Fp", snapshots)
        self.assertEqual(len(linhas), 1)
        self.assertTrue(any("LIKES 1 → 4" in evento for evento in segunda))

    def test_own_like_is_marked_beside_the_count(self):
        def linha(mine):
            return monitor.report_row(self.mr(1, "backend", "um", "ana.lima", 3), [], mine)
        self.assertEqual(linha(True)["likes"], f"3 \N{THUMBS UP SIGN} {monitor.MINE_MARK}")
        self.assertEqual(linha(False)["likes"], "3 \N{THUMBS UP SIGN}")
        # A marca fica à direita do número, com o lado esquerdo livre para a
        # marca de alteração, e some quando o like não é seu.
        self.assertIn(f"3 {monitor.MINE_MARK}", monitor.render_fragment([linha(True)]))
        self.assertNotIn(monitor.MINE_MARK, monitor.render_fragment([linha(False)]))

    def test_own_like_mark_keeps_the_terminal_columns_aligned(self):
        # Um sinal estreito, de uma coluna: a tabela não pode desalinhar nem
        # estourar a largura reservada aos likes.
        self.assertEqual(monitor.text_width(monitor.MINE_MARK), 1)
        rows = [monitor.report_row(self.mr(1, "backend", "um", "ana.lima", 12), [], True),
                monitor.report_row(self.mr(2, "frontend", "dois", "ana.lima", 0), [], False)]
        table = monitor.render_table(rows, links=False)
        self.assertEqual(len({monitor.text_width(line) for line in table.splitlines()}), 1)
        largura = dict((key, width) for key, _, width in monitor.REPORT_COLUMNS)["likes"]
        self.assertLessEqual(monitor.text_width(rows[0]["likes"]), largura)

    def test_own_likes_come_from_the_curtidos_sub_query(self):
        # Sem usuário configurado: o filtro é resolvido pelo próprio token, e
        # as duas sub-consultas (lista e curtidos) viajam numa única
        # requisição GraphQL, não uma listagem extra por ciclo.
        client = monitor.GitLab("https://gitlab.example/api/v4", "fake")
        curtido = {"iid": 1, "project": {"id": "gid://gitlab/Project/10"}}
        for alvo, caminho_esperado, chave in (("groups/g", "g", "10:1"), ("g%2Fp", "g/p", "1")):
            with self.subTest(alvo=alvo):
                with patch.object(client, "graphql",
                                  return_value=graphql_response([], liked=[curtido])) as graphql:
                    _, _, mine = client.acompanhar(alvo)
                self.assertEqual(mine, {chave})
                self.assertEqual(graphql.call_count, 1)
                self.assertEqual(graphql.call_args.args[2]["fullPath"], caminho_esperado)
                self.assertEqual(graphql.call_args.args[2]["curtida"], "thumbsup")

    def test_namespace_resolves_a_numeric_project_id_once(self):
        # A GraphQL só aceita grupo/projeto pelo caminho: um ID numérico
        # exige 1 resolução REST, guardada para não repetir a cada ciclo.
        client = monitor.GitLab("https://gitlab.example/api/v4", "fake")
        with patch.object(client, "get", return_value=({"path_with_namespace": "flake/siga/poc-sdd-backend"}, {})) as get:
            self.assertEqual(client.namespace("12"), ("project", "flake/siga/poc-sdd-backend"))
            self.assertEqual(client.namespace("12"), ("project", "flake/siga/poc-sdd-backend"))
        self.assertEqual(get.call_count, 1)
        self.assertEqual(get.call_args.args[0], "/projects/12")

    def test_likes_get_a_highlight_from_two_upvotes_on(self):
        def tone(likes):
            return monitor.report_row(
                {"iid": 1, "state": "opened", "upvotes": likes, "title": "t",
                 "created_at": "2026-10-19T10:00:00Z", "author": {"username": "ana.lima"},
                 "head_pipeline": None,
                 "web_url": "https://gitlab.example/g/poc-sdd-backend/-/merge_requests/1"}, [])
        self.assertIsNone(tone(0)["likes_tone"])
        self.assertIsNone(tone(monitor.LIKES_HIGHLIGHT - 1)["likes_tone"])
        self.assertEqual(tone(monitor.LIKES_HIGHLIGHT)["likes_tone"], "strong")
        self.assertEqual(tone(monitor.LIKES_HIGHLIGHT + 5)["likes_tone"], "strong")
        self.assertIn("badge--strong", monitor.render_fragment([tone(2)]))
        self.assertNotIn("badge--strong", monitor.render_fragment([tone(1)]))

    def sample(self):
        def build(iid, repo, author, likes, status, created, total, pending):
            notes = [{"id": index,
                      "notes": [{"resolvable": True, "resolved": index >= pending,
                                 "author": {"username": f"rev{index}.sobrenome"}}]}
                     for index in range(total)]
            return monitor.report_row(
                self.mr(iid, repo, f"titulo {iid}", author, likes,
                        status=status, created=created), notes)
        return [
            build(1, "backend", "ana.lima", 0, "failed", "2026-10-01T10:00:00Z", 2, 2),
            build(2, "frontend", "bia.sa", 5, "success", "2026-10-20T10:00:00Z", 3, 0),
            build(3, "frontend", "ana.lima", 2, None, "2026-10-10T10:00:00Z", 1, 1),
        ]

    def test_default_order_is_newest_first(self):
        rows = monitor.arrange(self.sample())
        self.assertEqual([row["mr"] for row in rows],
                         ["FE #2 titulo 2", "FE #3 titulo 3", "BE #1 titulo 1"])

    def test_each_sort_option_orders_as_named(self):
        rows = self.sample()
        expected = {
            "likes": ["FE #2 titulo 2", "FE #3 titulo 3", "BE #1 titulo 1"],
            "mr": ["BE #1 titulo 1", "FE #2 titulo 2", "FE #3 titulo 3"],
            "autor": ["FE #3 titulo 3", "BE #1 titulo 1", "FE #2 titulo 2"],
            # Duas não resolvidas, depois uma, depois nenhuma.
            "threads": ["BE #1 titulo 1", "FE #3 titulo 3", "FE #2 titulo 2"],
            # failed primeiro, success depois, sem pipeline por último.
            "pipeline": ["BE #1 titulo 1", "FE #2 titulo 2", "FE #3 titulo 3"],
        }
        for sort, order in expected.items():
            with self.subTest(sort=sort):
                self.assertEqual([row["mr"] for row in monitor.arrange(rows, sort)], order)

    def test_sorts_tie_break_by_date(self):
        # Mesmo número de likes: a data decide, mais recente em cima.
        rows = [monitor.report_row(self.mr(iid, "backend", "t", "ana.lima", 1, created=created), [])
                for iid, created in ((1, "2026-10-01T10:00:00Z"), (2, "2026-10-20T10:00:00Z"))]
        rows.sort(key=lambda row: row["created"], reverse=True)
        self.assertEqual([row["mr"] for row in monitor.arrange(rows, "likes")],
                         ["BE #2 t", "BE #1 t"])

    def test_every_declared_sort_is_offered_and_accepted(self):
        rows = self.sample()
        markup = monitor.sort_options("likes")
        for name, label, _ in monitor.SORTS:
            with self.subTest(sort=name):
                self.assertIn(f'value="{name}"', markup)
                self.assertIn(label.replace("–", "–"), markup)
                self.assertEqual(len(monitor.arrange(rows, name)), 3)
        self.assertIn('value="likes" selected', markup)

    def test_filters_narrow_by_author_and_pipeline(self):
        rows = self.sample()
        self.assertEqual([row["mr"] for row in monitor.arrange(rows, author="ana.lima")],
                         ["FE #3 titulo 3", "BE #1 titulo 1"])
        self.assertEqual([row["mr"] for row in monitor.arrange(rows, pipeline="failed")],
                         ["BE #1 titulo 1"])
        # MR sem pipeline tem opção própria, em vez de sumir do filtro.
        self.assertEqual(
            [row["mr"] for row in monitor.arrange(rows, pipeline=monitor.NO_PIPELINE)],
            ["FE #3 titulo 3"])
        self.assertEqual(monitor.arrange(rows, author="ninguem"), [])

    def test_filter_options_come_from_all_rows_and_are_labelled(self):
        options = monitor.filter_options(self.sample())
        self.assertEqual([item["value"] for item in options["authors"]], ["ana.lima", "bia.sa"])
        values = [item["value"] for item in options["pipelines"]]
        self.assertEqual(values, ["failed", "success", monitor.NO_PIPELINE])
        labels = {item["value"]: item["label"] for item in options["pipelines"]}
        self.assertEqual(labels[monitor.NO_PIPELINE], "sem pipeline")
        self.assertIn("failed", labels["failed"])

    def test_data_route_applies_sort_and_filter_from_the_query(self):
        state = monitor.panel_state("g%2Fp", 15)
        state["rows"] = self.sample()
        state["updated"] = monitor.datetime.now().astimezone()
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            monitor.panel_handler(state, "https://gitlab.example/api/v4", threading.Event()))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            def fetch(query):
                connection = HTTPConnection(host, port, timeout=5)
                connection.request("GET", "/data?" + query)
                payload = json.loads(connection.getresponse().read().decode("utf-8"))
                connection.close()
                return payload
            todos = fetch("since=0")
            self.assertEqual(todos["table"].count("<tr>"), 4)  # 3 linhas + cabeçalho
            self.assertIn("3 MR(s)", todos["meta"])
            filtrado = fetch("since=0&author=ana.lima")
            self.assertEqual(filtrado["table"].count("<tr>"), 3)
            self.assertIn("2 de 3 MR(s)", filtrado["meta"])
            # Filtro não encolhe as opções oferecidas.
            self.assertEqual(len(filtrado["filters"]["authors"]), 2)
            # Ordenação desconhecida não derruba a rota: cai no padrão.
            self.assertEqual(fetch("since=0&sort=inventado")["table"],
                             fetch("since=0&sort=recente")["table"])
            vazio = fetch("since=0&author=ninguem")
            self.assertIn("Nenhum MR corresponde aos filtros", vazio["table"])
        finally:
            server.shutdown()
            server.server_close()

    def test_created_column_is_the_last_one(self):
        key, header, _ = monitor.REPORT_COLUMNS[-1]
        self.assertEqual((key, header), ("created_label", "Criado em"))
        self.assertEqual(monitor.REPORT_COLUMNS[-2][0], "pipeline")
        row = monitor.report_row(
            self.mr(1, "backend", "t", "ana.lima", 0, created="2026-10-19T17:45:00Z"), [])
        self.assertEqual(row["created_label"], "19/10/2026")
        self.assertIn("19/10/2026", monitor.render_fragment([row]))
        semdata = monitor.report_row(self.mr(1, "backend", "t", "ana.lima", 0, created=None), [])
        self.assertEqual(semdata["created_label"], "—")

    def test_server_answers_only_the_root_path(self):
        state = monitor.panel_state("g%2Fp", 15)
        state["rows"] = self.rows
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            monitor.panel_handler(state, "https://gitlab.example/api/v4", threading.Event()))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address[0], server.server_address[1]
            for path, status in (("/", 200), ("/index.html", 200), ("/data", 200),
                                 ("/outra", 404), ("/../gitlab_monitor.py", 404)):
                with self.subTest(path=path):
                    connection = HTTPConnection(host, port, timeout=5)
                    connection.request("GET", path)
                    response = connection.getresponse()
                    self.assertEqual(response.status, status)
                    if status == 200:
                        self.assertIn("BE #199", response.read().decode("utf-8"))
                    connection.close()
        finally:
            server.shutdown()
            server.server_close()

    def settings_request(self, state, payload, headers=None, body=None,
                         path="/settings", wake=None):
        base = "https://gitlab.example/api/v4"
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            monitor.panel_handler(state, base, wake or threading.Event()))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            connection = HTTPConnection(host, port, timeout=5)
            data = body if body is not None else json.dumps(payload)
            connection.request("POST", path, body=data,
                               headers=headers or {"Content-Type": "application/json"})
            response = connection.getresponse()
            texto = response.read().decode("utf-8")
            # 404 vem do BaseHTTPRequestHandler, em HTML: devolve o texto cru.
            try:
                corpo = json.loads(texto)
            except ValueError:
                corpo = texto
            result = (response.status, corpo)
            connection.close()
            return result
        finally:
            server.shutdown()
            server.server_close()

    def test_refresh_wakes_the_cycle_without_touching_the_target(self):
        # Consulta manual: encurta a espera do laço, não abre coleta própria.
        state = monitor.panel_state("alvo%2Fp", 15)
        wake = threading.Event()
        status, data = self.settings_request(state, {}, path="/refresh", wake=wake)
        self.assertEqual((status, data), (200, {"ok": True}))
        self.assertTrue(wake.is_set())
        # O alvo e o intervalo seguem intactos: o botão só adianta o ciclo.
        self.assertEqual((state["project"], state["interval"]), ("alvo%2Fp", 15))

    def test_refresh_refuses_cross_origin_and_non_json_requests(self):
        state = monitor.panel_state("alvo%2Fp", 15)
        wake = threading.Event()
        foreign, _ = self.settings_request(
            state, {}, headers={"Content-Type": "application/json",
                                "Origin": "http://evil.example"},
            path="/refresh", wake=wake)
        form, _ = self.settings_request(
            state, {}, headers={"Content-Type": "application/x-www-form-urlencoded"},
            path="/refresh", wake=wake)
        self.assertEqual((foreign, form), (403, 415))
        # Recusada, a requisição não pode ter adiantado o ciclo.
        self.assertFalse(wake.is_set())

    def test_unknown_post_paths_stay_unhandled(self):
        state = monitor.panel_state("alvo%2Fp", 15)
        status, _ = self.settings_request(state, {}, path="/qualquer")
        self.assertEqual(status, 404)

    def test_settings_override_env_values_only_in_memory(self):
        state = monitor.panel_state("antigo%2Fprojeto", 15)
        with patch.object(monitor, "log"):
            status, _ = self.settings_request(
                state, {"project": "novo/projeto", "interval": "3"})
        self.assertEqual(status, 200)
        self.assertEqual(state["project"], "novo%2Fprojeto")
        self.assertEqual(state["interval"], 3)
        # Trocar de alvo zera a referência para não comparar projetos diferentes.
        self.assertEqual((state["rows"], state["updated"], state["events"]), ([], None, []))

    def test_settings_do_not_write_to_the_env_file(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / ".env"
            original = "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\nPROJECT=antigo/p\nINTERVAL=15\n"
            env.write_text(original, encoding="utf-8")
            state = monitor.panel_state("antigo%2Fp", 15)
            with patch.object(monitor, "ROOT", Path(directory)), patch.object(monitor, "log"):
                self.settings_request(state, {"project": "novo/p", "interval": "2"})
            self.assertEqual(env.read_text(encoding="utf-8"), original)

    def test_settings_reject_invalid_values_and_keep_the_previous_target(self):
        cases = ({"project": "", "interval": "5"},
                 {"project": "sem-barra-nem-id", "interval": "5"},
                 {"project": "g/p", "interval": "zero"},
                 {"project": "g/p", "interval": "0"},
                 {"project": "g/p", "interval": "-4"},
                 {"project": "https://outro.example/g/p", "interval": "5"})
        for payload in cases:
            with self.subTest(payload=payload):
                state = monitor.panel_state("antigo%2Fp", 15)
                with patch.object(monitor, "log"):
                    status, data = self.settings_request(state, payload)
                self.assertEqual(status, 400)
                self.assertTrue(data["error"])
                self.assertEqual((state["project"], state["interval"]), ("antigo%2Fp", 15))

    def test_settings_refuse_cross_origin_and_non_json_requests(self):
        state = monitor.panel_state("antigo%2Fp", 15)
        with patch.object(monitor, "log"):
            foreign, _ = self.settings_request(
                state, {"project": "g/p", "interval": "5"},
                headers={"Content-Type": "application/json", "Origin": "https://malicioso.example"})
            form, _ = self.settings_request(
                state, None, headers={"Content-Type": "application/x-www-form-urlencoded"},
                body="project=g/p&interval=5")
        self.assertEqual((foreign, form), (403, 415))
        self.assertEqual(state["project"], "antigo%2Fp")

    def test_data_route_delivers_only_events_newer_than_since(self):
        state = monitor.panel_state("g%2Fp", 15)
        state["events"] = [{"id": 1, "text": "um"}, {"id": 2, "text": "dois"}]
        state["sequence"] = 2
        self.assertEqual(monitor.panel_snapshot(state, 0)["events"], ["um", "dois"])
        self.assertEqual(monitor.panel_snapshot(state, 1)["events"], ["dois"])
        self.assertEqual(monitor.panel_snapshot(state, 2)["events"], [])

    def test_browser_notifications_come_enabled_by_default(self):
        page = monitor.render_html([], "flake/siga", 15)
        self.assertIn('<input type="checkbox" id="notify" checked>', page)
        script = monitor.asset("scripts/panel.js")
        # A caixa marcada só vale se o painel resolver a permissão sozinho.
        self.assertIn("setupNotifications();", script)
        for estado in ("'granted'", "'denied'"):
            self.assertIn(estado, script)
        # Permissão ainda não decidida: o pedido espera um gesto, como o
        # navegador exige, em vez de ser feito no carregamento e falhar.
        self.assertIn("addEventListener('pointerdown', pedir, { once: true })", script)
        self.assertIn("addEventListener('keydown', pedir, { once: true })", script)

    def test_events_are_held_until_the_browser_can_show_them(self):
        script = monitor.asset("scripts/panel.js")
        # Sem permissão, announce devolve false e o poll não avança o "since":
        # o servidor guarda os eventos até o navegador poder exibi-los.
        self.assertIn("Notification.permission !== 'granted') return false", script)
        self.assertIn("const entregues = !data.events.length || announce(data.events)", script)
        self.assertIn("if (entregues || !panel.toggle.checked) panel.since = data.sequence",
                      script)
        # Conceder a permissão busca na hora o que ficou represado.
        self.assertIn("hint('');\n    poll();", script)

    def test_each_change_gets_its_own_notification_up_to_a_limit(self):
        script = monitor.asset("scripts/panel.js")
        # Etiqueta por evento inteiro: duas mudanças no mesmo MR não se
        # substituem, mas o mesmo aviso repetido substitui o anterior.
        self.assertIn("tag: text", script)
        self.assertNotIn("tag: lines[0]", script)
        self.assertIn("MAX_NOTIFICATIONS", script)
        self.assertIn("atualizações nos MRs", script)

    def test_permission_hint_has_its_own_line_so_polling_cannot_erase_it(self):
        page = monitor.render_html([], "flake/siga", 15)
        self.assertIn('id="hint"', page)
        self.assertIn('id="warning"', page)
        script = monitor.asset("scripts/panel.js")
        # poll() limpa a linha de erro a cada consulta; a dica usa outra.
        self.assertIn("warn(data.error)", script)
        self.assertNotIn("hint(data.error)", script)
        for mensagem in ("hint('Notificações bloqueadas", "hint('Notificações do navegador ligadas"):
            self.assertIn(mensagem, script)

    def test_web_mode_never_uses_the_system_notifier(self):
        avisos = []
        pronto = threading.Event()

        class Server:
            def __init__(self, address, handler):
                self.server_port = address[1]

            def serve_forever(self):
                pronto.wait(5)
                raise KeyboardInterrupt

            def server_close(self):
                pass

        def registrar(events, notifications=True):
            avisos.append(notifications)
            pronto.set()

        with patch.object(monitor, "ThreadingHTTPServer", Server), \
             patch.object(monitor, "announce", side_effect=registrar), \
             patch.object(monitor, "scan", return_value=({}, ["evento"], [])), \
             patch.object(monitor, "notify") as notify, patch.object(monitor, "log"):
            with self.assertRaises(KeyboardInterrupt):
                monitor.serve_panel(Mock(), "g%2Fp", 15, 8765)
        # Quem avisa na tela é o navegador; o notificador do sistema fica fora.
        self.assertTrue(avisos)
        self.assertNotIn(True, avisos)
        notify.assert_not_called()

    def test_web_mode_still_logs_the_events_in_the_terminal(self):
        with patch.object(monitor, "notify") as notify, patch.object(monitor, "log") as log:
            monitor.announce(["!1 — um\nMESCLADO\nhttps://gitlab.example/1"],
                             notifications=False)
        log.assert_called_once()
        self.assertIn("MESCLADO", log.call_args.args[0])
        notify.assert_not_called()

    def test_server_binds_only_to_loopback(self):
        captured = {}

        class Server:
            def __init__(self, address, handler):
                captured["address"] = address
                self.server_port = address[1]

            def serve_forever(self):
                raise KeyboardInterrupt

            def server_close(self):
                pass

        with patch.object(monitor, "ThreadingHTTPServer", Server), \
             patch.object(monitor, "report", return_value=[]), patch.object(monitor, "log"):
            with self.assertRaises(KeyboardInterrupt):
                monitor.serve_panel(Mock(), "g%2Fp", 15, 8765)
        self.assertEqual(captured["address"], ("127.0.0.1", 8765))

    def test_panel_notifies_changes_without_touching_history_or_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(
                "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\n", encoding="utf-8")
            printed = []
            events = ["!199 — um\nMESCLADO\nhttps://gitlab.example/199"]
            passes = [({"199": {}}, [], self.rows),          # referência inicial, sem evento
                      ({"199": {"x": 1}}, events, self.rows)]  # mudança detectada
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor", "g/p", "--mode", "painel"]), \
                 patch.object(monitor, "GitLab"), patch.object(monitor, "log"), \
                 patch.object(monitor, "scan", side_effect=passes) as scan, \
                 patch.object(monitor, "acquire_lock") as lock, \
                 patch.object(monitor, "notify") as notify, \
                 patch.object(monitor.time, "sleep", side_effect=[None, KeyboardInterrupt]), \
                 patch("builtins.print", side_effect=lambda *a, **k: printed.append(a)):
                self.assertEqual(monitor.main(), 0)
            # A referência da passagem anterior é reaproveitada na seguinte.
            self.assertEqual([call.args[2] for call in scan.call_args_list],
                             [None, {"199": {}}])
            notify.assert_called_once()
            self.assertIn("MESCLADO", notify.call_args.args[1])
            lock.assert_not_called()
            self.assertFalse((Path(directory) / "gitlab-history").exists())
            self.assertTrue(any("BE #199" in str(call) for call in printed))

    def test_panel_respects_no_notify(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(
                "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\n", encoding="utf-8")
            passes = [({"1": {}}, ["evento"], self.rows)]
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv",
                              ["monitor", "g/p", "--mode", "painel", "--no-notify"]), \
                 patch.object(monitor, "GitLab"), patch.object(monitor, "log"), \
                 patch.object(monitor, "scan", side_effect=passes), \
                 patch.object(monitor, "notify") as notify, \
                 patch.object(monitor.time, "sleep", side_effect=KeyboardInterrupt), \
                 patch("builtins.print"):
                self.assertEqual(monitor.main(), 0)
            notify.assert_not_called()


class NotificationTests(unittest.TestCase):
    def test_windows_keeps_untrusted_text_out_of_code(self):
        title = 'GitLab: "aspas" e acentos'
        message = 'Título $(Write-Output INDEVIDO); & | ` <b> → 👍\nOutra linha'
        with patch.object(monitor.sys, "platform", "win32"), \
             patch.object(monitor.shutil, "which", return_value="powershell.exe"), \
             patch.object(monitor.subprocess, "run") as run:
            self.assertTrue(monitor.notify(title, message))
        command = run.call_args.args[0]
        code = base64.b64decode(command[-1]).decode("utf-16-le")
        self.assertEqual(code, monitor.WINDOWS_NOTIFY_SCRIPT)
        self.assertNotIn(message, code)
        self.assertNotIn(title, command)
        self.assertEqual(json.loads(run.call_args.kwargs["input"]), {"title": title, "message": message})
        self.assertTrue(run.call_args.kwargs["input"].isascii())
        self.assertIn("-Sta", command)

    def test_windows_summarizes_long_payload_without_breaking_emoji(self):
        with patch.object(monitor.sys, "platform", "win32"), \
             patch.object(monitor.shutil, "which", return_value="powershell.exe"), \
             patch.object(monitor.subprocess, "run") as run:
            monitor.notify("👍" * 40, "👍" * 200)
        payload = json.loads(run.call_args.kwargs["input"])
        for key, limit in (("title", 63), ("message", 255)):
            self.assertLessEqual(len(payload[key].encode("utf-16-le")) // 2, limit)
            self.assertTrue(payload[key].endswith("…"))
            self.assertNotIn("\ufffd", payload[key])

    def test_linux_passes_literal_arguments_and_escapes_markup(self):
        with patch.object(monitor.sys, "platform", "linux"), \
             patch.object(monitor.shutil, "which", return_value="/usr/bin/notify-send"), \
             patch.object(monitor.subprocess, "run") as run:
            self.assertTrue(monitor.notify("--help", '<b>MR</b> & $(literal)\n👍'))
        self.assertEqual(run.call_args.args[0], ["/usr/bin/notify-send", "--app-name=GitLab Monitor",
                                                "--", "--help", "&lt;b&gt;MR&lt;/b&gt; &amp; $(literal)\n👍"])
        self.assertNotIn("shell", run.call_args.kwargs)

    def test_missing_dependency_is_actionable_and_does_not_launch_process(self):
        for platform, executable in (("win32", "powershell.exe"), ("linux", "notify-send")):
            with self.subTest(platform=platform), patch.object(monitor.sys, "platform", platform), \
                 patch.object(monitor.shutil, "which", return_value=None), \
                 patch.object(monitor.subprocess, "run") as run, patch.object(monitor, "log") as log:
                self.assertFalse(monitor.notify("GitLab", "Teste"))
                run.assert_not_called()
                self.assertIn(executable, log.call_args.args[0])
                if platform == "linux":
                    self.assertIn("libnotify-bin", log.call_args.args[0])

    def test_failures_report_different_causes_on_both_platforms(self):
        for platform in ("win32", "linux"):
            failures = [
                (subprocess.CalledProcessError(1, "helper", stderr=b"ParserError / DBus ServiceUnknown"), "código 1", "ServiceUnknown"),
                (subprocess.TimeoutExpired("helper", 45), "tempo limite", None),
                (OSError("Access denied"), "iniciar notificador", "Access denied"),
            ]
            for error, expected, detail in failures:
                with self.subTest(platform=platform, error=type(error).__name__), \
                     patch.object(monitor.sys, "platform", platform), \
                     patch.object(monitor.shutil, "which", return_value="helper"), \
                     patch.object(monitor.subprocess, "run", side_effect=error), patch.object(monitor, "log") as log:
                    self.assertFalse(monitor.notify("GitLab", "Teste"))
                    self.assertIn(expected, log.call_args.args[0])
                    if detail:
                        self.assertIn(detail, log.call_args.args[0])

    def test_notification_test_never_loads_credentials_or_calls_gitlab(self):
        for result in (True, False):
            with self.subTest(result=result), patch.object(monitor.sys, "argv", ["monitor", "--test-notify"]), \
                 patch.object(monitor, "notify", return_value=result), \
                 patch.object(monitor, "credentials") as credentials, patch.object(monitor, "GitLab") as gitlab:
                self.assertEqual(monitor.main(), 0 if result else 1)
                credentials.assert_not_called()
                gitlab.assert_not_called()

    def test_monitor_continues_polling_after_notification_failure(self):
        for platform in ("win32", "linux"):
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as directory, \
                 patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "platform", platform), \
                 patch.object(monitor.sys, "argv", ["monitor", "g/p"]), \
                 patch.object(monitor, "credentials", return_value=("https://gitlab.example/api/v4", "fake")), \
                 patch.object(monitor, "acquire_lock"), patch.object(monitor, "GitLab"), \
                 patch.object(monitor, "log"), \
                 patch.object(monitor.shutil, "which", return_value="helper"), \
                 patch.object(monitor.subprocess, "run", side_effect=subprocess.CalledProcessError(1, "helper", stderr=b"unavailable")) as run, \
                 patch.object(monitor, "collect", side_effect=[({"1": {}}, []), ({"1": {"changed": True}}, ["Evento"]), ({"1": {"changed": True}}, [])]) as collect, \
                 patch.object(monitor.time, "sleep", side_effect=[None, None, KeyboardInterrupt]):
                self.assertEqual(monitor.main(), 0)
                self.assertEqual(collect.call_count, 3)
                self.assertEqual(run.call_count, 1)
                self.assertEqual(collect.call_args.args[2], {"1": {"changed": True}})


if __name__ == "__main__":
    unittest.main()
