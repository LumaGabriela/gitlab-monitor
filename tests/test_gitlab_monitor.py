"""Na pasta do monitor: python3 -B -m unittest discover -s tests."""

import base64
import copy
from datetime import datetime, timedelta
import json
import importlib.util
import os
import re
import shutil
import subprocess
from pathlib import Path
import sys
import tempfile
import textwrap
import unicodedata
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
from io import StringIO
from urllib.parse import parse_qs, unquote, urlsplit
import threading
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import gitlab_monitor as monitor
import monitor_table


def setUpModule():
    # Nenhum teste lê (nem põe de lado) o user-data/preferences.json de quem roda.
    global _prefs_dir, _prefs_patch
    _prefs_dir = tempfile.mkdtemp()
    _prefs_patch = patch.object(monitor, "PREFERENCES_FILE", Path(_prefs_dir) / "preferences.json")
    _prefs_patch.start()


def tearDownModule():
    _prefs_patch.stop()
    shutil.rmtree(_prefs_dir, True)


def row(iid, state="opened", likes=0, pipeline=None, author="ana.lima",
        created="2026-10-01T10:00:00.000Z", updated=None, project_id=1,
        mergeable=True, conflicts=False, likers=(), assignees=(), reviewers=()):
    return {"iid": iid, "state": state, "title": f"MR {iid}",
            "web_url": f"https://gitlab.example/g/p/-/merge_requests/{iid}",
            "upvotes": likes, "head_pipeline": pipeline,
            "author": {"username": author}, "created_at": created,
            "updated_at": updated or created, "project_id": project_id,
            "mergeable": mergeable, "conflicts": conflicts, "likers": list(likers),
            "assignees": list(assignees), "reviewers": list(reviewers)}


def rest_row_to_graphql_node(r, web_root="https://gitlab.example"):
    """Nó GraphQL equivalente a uma linha REST de row()/merge_request().

    Compartilhado pelos dois dublês (Client e Mock): ambos descrevem os
    mesmos dados de teste no formato antigo, e scan() agora só fala GraphQL.
    """
    pipeline = r.get("head_pipeline")
    return {
        "iid": r["iid"], "title": r["title"], "createdAt": r["created_at"],
        "updatedAt": r.get("updated_at", r["created_at"]),
        "upvotes": r["upvotes"], "webPath": r["web_url"].removeprefix(web_root),
        "author": r.get("author") or {},
        "headPipeline": None if pipeline is None else {
            "id": pipeline["id"], "status": pipeline["status"].upper()},
        "project": {"id": f'gid://gitlab/Project/{r.get("project_id", 1)}'},
        "mergeable": r.get("mergeable", True), "conflicts": r.get("conflicts", False),
        "awardEmoji": {"nodes": [{"name": "thumbsup", "user": {"username": username}}
                                 for username in r.get("likers", ())]},
        "discussions": {"nodes": []},
        "assignees": {"nodes": [{"username": name} for name in r.get("assignees", ())]},
        "reviewers": {"nodes": [
            {"username": name, "mergeRequestInteraction": {"reviewState": state.upper()}}
            for name, state in r.get("reviewers", ())]},
    }


def graphql_response(nodes, has_next=False, end_cursor=None, liked=(), me=None):
    """Formato que GitLab.graphql() devolve: dubla client.graphql em testes
    que exercitam GitLab.track() de verdade (paginação, montagem de chave)."""
    return {
        "target": {"mergeRequests": {
            "pageInfo": {"hasNextPage": has_next, "endCursor": end_cursor},
            "nodes": list(nodes),
        }},
        "liked": {"mergeRequests": {"nodes": list(liked)}},
        "eu": {"username": me} if me else None,
    }


class Client:
    """Dubla GitLab: `opened`/`details` no formato REST de row() (o que o
    loop de saída de scan() ainda consulta via detail()/discussions()), e
    `track()` fabrica o nó GraphQL equivalente a partir das mesmas
    linhas, para não duplicar um segundo conjunto de dados por teste.
    """
    def __init__(self, opened, details, liked=(), me=None):
        self.rows = {str(item["iid"]): item for item in opened}
        self.details = {str(item["iid"]): item for item in details}
        self.mine = set(liked)
        self.me = me
        self.web_root = "https://gitlab.example"

    def detail(self, project, iid):
        return self.details[iid]

    def discussions(self, project, iid):
        return []

    def track(self, project):
        nos = [rest_row_to_graphql_node(r) for r in self.rows.values()]
        por_chave = {str(r["iid"]): rest_row_to_graphql_node(r) for r in self.rows.values()}
        return nos, por_chave, set(self.mine), self.me


class MultiClient:
    """Dubla GitLab para vários alvos: cada alvo tem as próprias linhas, e os
    de `failing` levantam RuntimeError como uma falha de rede faria."""
    def __init__(self, by_target, failing=()):
        self.by_target = by_target
        self.failing = set(failing)
        self.web_root = "https://gitlab.example"

    def track(self, project):
        if project in self.failing:
            raise RuntimeError(f"HTTP 500 em {project}")
        rows = self.by_target.get(project, [])
        por_chave = {str(r["iid"]): rest_row_to_graphql_node(r) for r in rows}
        return list(por_chave.values()), por_chave, set(), None

    def detail(self, project, iid):
        return row(int(iid), "merged")

    def discussions(self, project, iid):
        return []


class RecordingClient(MultiClient):
    """MultiClient que lembra, em ordem, que alvos foram consultados."""
    def __init__(self, by_target, failing=()):
        super().__init__(by_target, failing)
        self.tracked = []

    def track(self, project):
        self.tracked.append(project)
        return super().track(project)


def served_path(path):
    """Caminho, relativo ao build, que o servidor serviria para `path`;
    None quando ele responderia 404. Sem subir servidor HTTP."""
    target = monitor.page_fallback(path)
    return None if target is None else target.relative_to(monitor.FRONTEND_DIST).as_posix()


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

    def run_once_in(self, folder):
        """Roda `main --once --keep-history true` com ROOT em `folder`, sem rede.
        Devolve (código de saída, mensagens de log)."""
        (folder / ".env").write_text(
            "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake-local-token\n", encoding="utf-8")
        with patch.object(monitor, "ROOT", folder), \
             patch.object(monitor.sys, "argv", ["gitlab_monitor.py", "a/um", "--once", "--no-notify",
                                                "--keep-history", "true"]), \
             patch.object(monitor, "GitLab"), patch.object(monitor, "log") as log, \
             patch.object(monitor, "collect", return_value=({"a%2Fum": {"1": {}}}, [])):
            code = monitor.main()
        return code, [call.args[0] for call in log.call_args_list]

    def test_historico_grava_a_versao_3_por_alvo(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            self.assertEqual(self.run_once_in(folder)[0], 0)
            (path,) = (folder / "gitlab-history").glob("*.json")
            stored = json.loads(path.read_text(encoding="utf-8"))
            self.assertEqual(stored["version"], 3)
            self.assertEqual(list(stored["targets"]), ["a%2Fum"])
            self.assertNotIn("mrs", stored)

    def test_historico_da_versao_2_e_recusado_com_instrucao(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            self.run_once_in(folder)
            (path,) = (folder / "gitlab-history").glob("*.json")
            antigo = json.dumps({"version": 2, "checked_at": "x", "mrs": {"a%2Fum": {"1": {}}}})
            path.write_text(antigo, encoding="utf-8")
            code, messages = self.run_once_in(folder)
            self.assertEqual(code, 1)
            # Recusado, nunca sobrescrito.
            self.assertEqual(path.read_text(encoding="utf-8"), antigo)
            # A instrução específica chega a quem roda, em vez de virar a
            # mensagem genérica do except de topo.
            self.assertTrue(any("Incompatible state file from an earlier version" in message
                                and "move it aside" in message for message in messages))

    ENV_SEM_ALVO = ("GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\n"
                    "PROJECT=g/env-proj\nINTERVAL=3\n")

    def run_web(self, extra, preferences):
        """Roda `main` em modo web, capturando o que chegaria ao servidor."""
        captured = {}
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(self.ENV_SEM_ALVO, encoding="utf-8")
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor", "--mode", "web", *extra]), \
                 patch.object(monitor, "GitLab"), patch.object(monitor, "log"), \
                 patch.object(monitor, "load_preferences",
                              return_value={"version": 1, "preferences": preferences}), \
                 patch.object(monitor, "serve_panel",
                              side_effect=lambda client, targets, interval, port, base="":
                              captured.update(targets=targets, interval=interval)):
                self.assertEqual(monitor.main(), 0)
        return captured

    def test_env_defaults_nao_existe_mais(self):
        self.assertFalse(hasattr(monitor, "env_defaults"))

    def test_modo_terminal_sem_alvo_sugere_o_modo_web(self):
        # Quem atualiza vinha do .env, em que PROJECT bastava: a saída precisa
        # dizer as duas formas de seguir.
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(self.ENV_SEM_ALVO, encoding="utf-8")
            stderr = StringIO()
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor", "--mode", "monitorar"]), \
                 patch.object(monitor, "GitLab"), patch.object(monitor, "log"), \
                 patch.object(monitor.sys, "stderr", stderr):
                with self.assertRaises(SystemExit):
                    monitor.main()
            self.assertIn("--mode web", stderr.getvalue())

    def test_modo_terminal_sem_alvo_e_erro_e_ignora_o_env(self):
        # PROJECT e INTERVAL no .env não valem mais: sem posicional, é erro.
        for mode in ("monitorar", "relatorio", "painel"):
            with self.subTest(mode=mode), tempfile.TemporaryDirectory() as directory:
                (Path(directory) / ".env").write_text(self.ENV_SEM_ALVO, encoding="utf-8")
                stderr = StringIO()
                with patch.object(monitor, "ROOT", Path(directory)), \
                     patch.object(monitor.sys, "argv", ["monitor", "--mode", mode]), \
                     patch.object(monitor, "GitLab") as gitlab, patch.object(monitor, "log"), \
                     patch.object(monitor, "collect", return_value=({}, [])), \
                     patch.object(monitor, "scan", return_value=({}, [], [], [])), \
                     patch.object(monitor, "report", return_value=([], [])), \
                     patch.object(monitor.time, "sleep", side_effect=KeyboardInterrupt), \
                     patch("builtins.print"), patch.object(monitor.sys, "stderr", stderr):
                    with self.assertRaises(SystemExit) as raised:
                        monitor.main()
                self.assertEqual(raised.exception.code, 2)
                self.assertNotIn("PROJECT", stderr.getvalue())
                self.assertNotIn("INTERVAL", stderr.getvalue())
                gitlab.assert_not_called()

    def test_modo_terminal_sem_interval_usa_o_padrao_e_ignora_o_env(self):
        for extra, interval in (([], 15), (["--interval", "7"], 7)):
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as directory:
                (Path(directory) / ".env").write_text(self.ENV_SEM_ALVO, encoding="utf-8")
                logs = []
                with patch.object(monitor, "ROOT", Path(directory)), \
                     patch.object(monitor.sys, "argv", ["monitor", "g/cli", *extra, "--once", "--no-notify"]), \
                     patch.object(monitor, "GitLab"), patch.object(monitor, "collect", return_value=({}, [])), \
                     patch.object(monitor, "log", side_effect=logs.append):
                    self.assertEqual(monitor.main(), 0)
                self.assertIn(f"Monitorando g/cli a cada {interval:g} min", logs[0])

    def test_modo_web_sem_posicional_usa_as_preferencias(self):
        captured = self.run_web([], {"monitoredProjects": ["g%2Fp"], "interval": 4})
        self.assertEqual(captured["targets"], ["g%2Fp"])
        self.assertEqual(captured["interval"], 4)

    def test_modo_web_sem_posicional_e_sem_preferencia_abre_vazio(self):
        captured = self.run_web([], {})
        self.assertEqual(captured["targets"], [])
        self.assertEqual(captured["interval"], 15)

    def test_modo_web_posicional_vence_o_arquivo(self):
        prefs = {"monitoredProjects": ["g%2Fp"], "interval": 4}
        captured = self.run_web(["g/cli"], prefs)
        self.assertEqual(captured["targets"], ["g%2Fcli"])
        self.assertEqual(captured["interval"], 4)
        captured = self.run_web(["g/cli", "--interval", "9"], prefs)
        self.assertEqual(captured["interval"], 9)

    def test_scan_une_as_linhas_de_cada_alvo(self):
        client = MultiClient({"a%2Fum": [row(1)], "b%2Fdois": [row(2)]})
        current, events, rows, failed = monitor.scan(client, ["a%2Fum", "b%2Fdois"])
        self.assertEqual(sorted(current), ["a%2Fum", "b%2Fdois"])
        self.assertEqual(len(rows), 2)
        self.assertEqual(events, [])
        self.assertEqual(failed, [])

    def test_scan_compara_cada_alvo_com_o_proprio_anterior(self):
        # Um like a mais só no segundo alvo gera um evento, não dois.
        alvos = ["a%2Fum", "b%2Fdois"]
        antes = MultiClient({"a%2Fum": [row(1)], "b%2Fdois": [row(2)]})
        previous, _, _, _ = monitor.scan(antes, alvos)
        depois = MultiClient({"a%2Fum": [row(1)], "b%2Fdois": [row(2, likes=1)]})
        _, events, _, _ = monitor.scan(depois, alvos, previous)
        self.assertEqual([event["kind"] for event in events], ["likes"])

    def test_scan_mantem_os_outros_alvos_quando_um_falha(self):
        # O alvo que levanta RuntimeError não derruba o ciclo: as linhas do outro
        # continuam, e o alvo que falhou preserva o snapshot anterior.
        alvos = ["a%2Fum", "b%2Fdois"]
        previous, _, _, _ = monitor.scan(
            MultiClient({"a%2Fum": [row(1)], "b%2Fdois": [row(2)]}), alvos)
        client = MultiClient({"a%2Fum": [row(1)]}, failing={"b%2Fdois"})
        with patch.object(monitor, "log") as log:
            current, events, rows, failed = monitor.scan(client, alvos, previous)
        # Qual linha voltou importa: len(rows) == 1 também passaria com o alvo
        # errado respondendo.
        self.assertEqual([item["url"] for item in rows], [row(1)["web_url"]])
        self.assertEqual(events, [])
        self.assertEqual(current["b%2Fdois"], previous["b%2Fdois"])
        # A falha é do ciclo, não do alvo que respondeu: quem chama precisa
        # saber que a tabela saiu incompleta.
        self.assertEqual(failed, ["b%2Fdois"])
        log.assert_called_once()

    def test_scan_deixa_de_fora_o_alvo_que_falha_sem_anterior(self):
        client = MultiClient({"a%2Fum": [row(1)]}, failing={"b%2Fdois"})
        with patch.object(monitor, "log"):
            current, _, rows, failed = monitor.scan(client, ["a%2Fum", "b%2Fdois"])
        self.assertEqual(list(current), ["a%2Fum"])
        self.assertEqual([item["url"] for item in rows], [row(1)["web_url"]])
        self.assertEqual(failed, ["b%2Fdois"])

    def test_scan_um_mr_que_sai_dos_dois_alvos_gera_um_evento_left(self):
        alvos = ["a%2Fum", "groups/a"]
        previous, _, _, _ = monitor.scan(
            MultiClient({"a%2Fum": [row(1)], "groups/a": [row(1)]}), alvos)
        client = MultiClient({"a%2Fum": [], "groups/a": []})
        _, events, rows, _ = monitor.scan(client, alvos, previous)
        self.assertEqual(rows, [])
        self.assertEqual([event["kind"] for event in events], ["left"])

    def test_evento_de_likes_traz_os_facts_da_linha_do_mr(self):
        alvos = ["a%2Fum"]
        previous, _, _, _ = monitor.scan(MultiClient({"a%2Fum": [row(1)]}), alvos)
        client = MultiClient({"a%2Fum": [row(1, likes=3)]})
        _, events, rows, _ = monitor.scan(client, alvos, previous)
        self.assertEqual([event["kind"] for event in events], ["likes"])
        self.assertEqual(events[0]["facts"], monitor.serialize_row(rows[0])["facts"])
        self.assertEqual(events[0]["facts"]["likes"], 3)

    def test_eventos_do_mesmo_mr_partilham_os_mesmos_facts(self):
        alvos = ["a%2Fum"]
        previous, _, _, _ = monitor.scan(MultiClient({"a%2Fum": [row(1)]}), alvos)
        novo = row(1, likes=2, pipeline={"id": 9, "status": "failed"})
        _, events, _, _ = monitor.scan(MultiClient({"a%2Fum": [novo]}), alvos, previous)
        self.assertEqual([event["kind"] for event in events], ["likes", "pipeline"])
        self.assertEqual(events[0]["facts"], events[1]["facts"])
        self.assertEqual(events[1]["facts"]["pipeline"], "failed")

    def test_evento_de_mr_que_saiu_nao_traz_facts(self):
        # Sem linha na tabela não há o que serializar; o campo é opcional.
        alvos = ["a%2Fum"]
        previous, _, _, _ = monitor.scan(MultiClient({"a%2Fum": [row(1)]}), alvos)
        _, events, _, _ = monitor.scan(MultiClient({"a%2Fum": []}), alvos, previous)
        self.assertEqual([event["kind"] for event in events], ["left"])
        self.assertNotIn("facts", events[0])

    def test_data_entrega_os_facts_do_evento_sem_o_id_interno(self):
        alvos = ["a%2Fum"]
        previous, _, _, _ = monitor.scan(MultiClient({"a%2Fum": [row(1)]}), alvos)
        _, events, _, _ = monitor.scan(MultiClient({"a%2Fum": [row(1, likes=1)]}), alvos, previous)
        estado = monitor.panel_state(["a%2Fum"], 15)
        estado["updated"] = datetime.now().astimezone()
        estado["sequence"] = 1
        estado["events"] = [{"id": 1, **events[0]}]
        evento = monitor.panel_snapshot(estado, 0)["events"][0]
        self.assertNotIn("id", evento)
        self.assertEqual(evento["facts"], events[0]["facts"])

    def test_count_snapshots_conta_os_mrs_e_nao_os_alvos(self):
        self.assertEqual(monitor.count_snapshots({"a": {"1": {}, "2": {}}, "b": {"1": {}}, "c": {}}), 3)

    def test_scan_levanta_quando_o_unico_alvo_falha(self):
        client = MultiClient({}, failing={"a%2Fum"})
        with self.assertRaisesRegex(RuntimeError, "HTTP 500"):
            monitor.scan(client, ["a%2Fum"])

    def test_scan_levanta_quando_todos_os_alvos_falham(self):
        client = MultiClient({}, failing={"a%2Fum", "b%2Fdois"})
        with self.assertRaises(RuntimeError):
            monitor.scan(client, ["a%2Fum", "b%2Fdois"])

    def test_scan_sem_alvos_nao_e_erro(self):
        self.assertEqual(monitor.scan(MultiClient({}), []), ({}, [], [], []))

    def test_scan_nao_duplica_mr_presente_em_dois_alvos(self):
        # O mesmo MR visto pelo projeto e pelo grupo que o contém: uma linha só,
        # identificada pela URL, e um evento só.
        alvos = ["a%2Fum", "groups/a"]
        previous, _, _, _ = monitor.scan(
            MultiClient({"a%2Fum": [row(1)], "groups/a": [row(1)]}), alvos)
        client = MultiClient({"a%2Fum": [row(1, likes=1)], "groups/a": [row(1, likes=1)]})
        _, events, rows, _ = monitor.scan(client, alvos, previous)
        self.assertEqual(len(rows), 1)
        self.assertEqual([event["kind"] for event in events], ["likes"])

    def test_initial_and_unchanged_are_quiet(self):
        client = Client([row(1)], [row(1)])
        baseline, events = monitor.collect(client, ["1"], None)
        self.assertEqual(events, [])
        self.assertEqual(monitor.collect(client, ["1"], baseline), (baseline, []))

    def test_same_total_still_detects_entry_and_exit(self):
        previous = {"1": {"1": monitor.snapshot(row(1), [])}}
        current, events = monitor.collect(Client([row(2)], [row(1, "merged"), row(2)]), ["1"], previous)
        self.assertEqual(len(current["1"]), len(previous["1"]))
        self.assertIn("MERGED", events[0]["text"])
        self.assertIn("NEW MR OPENED", events[1]["text"])

    def test_likes_and_pipeline_status_or_identity(self):
        old = row(1, likes=2, pipeline={"id": 10, "status": "running"})
        previous = {"1": {"1": monitor.snapshot(old, [])}}
        for pipeline in ({"id": 10, "status": "failed"}, {"id": 11, "status": "running"}, None):
            with self.subTest(pipeline=pipeline):
                new = row(1, likes=1, pipeline=pipeline)
                _, events = monitor.collect(Client([new], [new]), ["1"], previous)
                self.assertEqual(len(events), 2)
                self.assertIn("LIKES 2 → 1", events[0]["text"])
                self.assertIn("PIPELINE", events[1]["text"])

    def test_failed_detail_preserves_baseline(self):
        previous = {"1": {"1": monitor.snapshot(row(1), [])}}
        original = copy.deepcopy(previous)
        client = Client([], [])
        with patch.object(client, "detail", side_effect=RuntimeError("HTTP 403")):
            with self.assertRaises(RuntimeError):
                monitor.collect(client, ["1"], previous)
        self.assertEqual(previous, original)

    def test_race_between_listing_and_a_later_close_self_corrects_next_cycle(self):
        # scan() confia no "opened" que a própria listagem já filtrou, em vez
        # de checar o estado de novo por MR (isso custava 1 detail a mais por
        # MR a cada ciclo). Uma mudança entre a listagem e o fim do ciclo,
        # rara e de milissegundos, aparece com um ciclo de atraso: a listagem
        # seguinte já não traz mais o MR, e o loop de saída confirma o estado.
        previous = {"1": {"1": monitor.snapshot(row(1), [])}}
        client = Client([row(1)], [row(1, "closed")])
        current, events = monitor.collect(client, ["1"], previous)
        self.assertEqual(current, previous)
        self.assertEqual(events, [])
        client.rows = {}
        current, events = monitor.collect(client, ["1"], current)
        self.assertEqual(current, {"1": {}})
        self.assertIn("CLOSED", events[0]["text"])

    def test_pagination_gap_self_heals_via_the_exit_check(self):
        # Um MR que a listagem desta passagem não trouxe (paginação, latência)
        # ainda é confirmado individualmente antes de contar como saída.
        previous = {"1": {"1": monitor.snapshot(row(1), [])}}
        current, events = monitor.collect(Client([], [row(1)]), ["1"], previous)
        self.assertEqual(current, previous)
        self.assertEqual(events, [])

    def test_track_paginates_across_graphql_pages(self):
        client = monitor.GitLab("https://gitlab.example/api/v4", "fake")
        no1, no2 = rest_row_to_graphql_node(row(1)), rest_row_to_graphql_node(row(2))
        with patch.object(client, "graphql", side_effect=[
            graphql_response([no1], has_next=True, end_cursor="C1"),
            graphql_response([no2], has_next=False),
        ]) as graphql:
            nos, por_chave, mine, _ = client.track("g%2Fp")
        self.assertEqual(set(por_chave), {"1", "2"})
        self.assertEqual(len(nos), 2)
        # A segunda página pede a partir do cursor que a primeira devolveu.
        self.assertEqual(graphql.call_args_list[1].args[2]["after"], "C1")
        self.assertIsNone(graphql.call_args_list[0].args[2]["after"])

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
            current, events = monitor.collect(client, ["groups/g"], None)
        self.assertEqual(set(current["groups/g"]), {"10:1", "20:1"})
        self.assertEqual(events, [])
        self.assertEqual(graphql.call_args.args[2]["fullPath"], "g")

    def test_group_compares_and_confirms_missing_mr_in_own_project(self):
        client = monitor.GitLab("https://gitlab.example/api/v4", "fake")
        previous = {"groups/g": {"10:1": monitor.snapshot(row(1), []),
                                 "20:1": monitor.snapshot(row(1), [])}}
        changed = rest_row_to_graphql_node(dict(row(1, likes=2), project_id=10))
        with patch.object(client, "graphql", return_value=graphql_response([changed])),              patch.object(client, "detail", return_value=row(1, "merged")) as detail:
            current, events = monitor.collect(client, ["groups/g"], previous)
        self.assertEqual(set(current["groups/g"]), {"10:1"})
        # O id do projeto sai do texto; a URL é o que distingue os dois MRs.
        self.assertNotIn("Projeto", events[0]["text"] + events[1]["text"])
        self.assertEqual(events[0]["text"].splitlines(), [
            "!1 — MR 1", "LIKES 0 → 2", "https://gitlab.example/g/p/-/merge_requests/1"])
        self.assertEqual(events[1]["text"].splitlines()[:2], ["!1 — MR 1", "MERGED"])
        # O MR que sumiu da listagem (20:1) é confirmado individualmente.
        self.assertEqual(detail.call_args.args, ("groups/g", "20:1"))

    def test_evento_diz_que_tipo_de_mudanca_foi(self):
        # O painel filtra por tipo: "LIKES 1 → 2" como texto solto não serve.
        previous = {"1": {"1": monitor.snapshot(row(1, likes=1), [])}}
        novo = row(1, likes=2)
        _, events = monitor.collect(Client([novo], [novo]), ["1"], previous)
        self.assertEqual([item["kind"] for item in events], ["likes"])
        self.assertEqual(events[0]["likes"], 2)
        self.assertIn("LIKES 1 → 2", events[0]["text"])

    def test_evento_carrega_os_campos_do_mr(self):
        previous = {"1": {"1": monitor.snapshot(row(1, author="bia"), [], mine=True)}}
        novo = dict(row(1, author="bia", pipeline={"id": 9, "status": "failed"}),
                    title="Draft: MR 1")
        _, events = monitor.collect(Client([novo], [novo]), ["1"], previous)
        evento = events[0]
        self.assertEqual(evento["kind"], "pipeline")
        self.assertEqual((evento["mr"], evento["title"], evento["author"]),
                         ("1", "Draft: MR 1", "bia"))
        self.assertEqual(evento["url"], "https://gitlab.example/g/p/-/merge_requests/1")
        self.assertTrue(evento["draft"])

    def test_cada_tipo_de_mudanca_tem_o_seu_kind(self):
        previous = {"1": {"1": monitor.snapshot(row(1), []),
                          "2": monitor.snapshot(row(2, author="caio"), [], mine=True)}}
        novo = row(1, likes=1, pipeline={"id": 3, "status": "running"})
        client = Client([novo, row(3)], [novo, row(2, "merged"), row(3)])
        _, events = monitor.collect(client, ["1"], previous)
        self.assertEqual(sorted(item["kind"] for item in events), ["left", "likes", "opened", "pipeline"])
        # O MR que saiu da lista ainda diz de quem era e se era meu.
        saiu = next(item for item in events if item["kind"] == "left")
        self.assertEqual((saiu["author"], saiu["mine"]), ("caio", True))

    def test_mudanca_de_threads_vira_kind_threads(self):
        discussao = {"id": "d1", "notes": [{"resolvable": True, "resolved": False}]}
        previous = {"1": {"1": monitor.snapshot(row(1), [discussao])}}
        _, events = monitor.collect(Client([row(1)], [row(1)]), ["1"], previous)
        self.assertEqual([item["kind"] for item in events], ["threads"])
        self.assertIn("DISCUSSIONS 1 → 0", events[0]["text"])

    def test_events_are_one_item_per_line(self):
        changed = row(1, likes=2, pipeline={"id": 9, "status": "success"})
        client = Client([changed], [changed])
        _, events = monitor.collect(client, ["1"], {"1": {"1": monitor.snapshot(row(1), [])}})
        self.assertEqual(len(events), 2)
        for event in events:
            identification, change, url = event["text"].splitlines()
            self.assertEqual(identification, "!1 — MR 1")
            self.assertTrue(change)
            self.assertEqual(url, "https://gitlab.example/g/p/-/merge_requests/1")

    def test_notification_separates_events_with_a_blank_line(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(
                "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\n", encoding="utf-8")
            textos = ["!1 — MR 1\nMESCLADO\nhttps://gitlab.example/1",
                      "!2 — MR 2\nLIKES 0 → 2\nhttps://gitlab.example/2"]
            events = [{"kind": "left", "text": texto} for texto in textos]
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor", "g/p", "--once"]), \
                 patch.object(monitor, "GitLab"), patch.object(monitor, "log"), \
                 patch.object(monitor, "collect", side_effect=[({"1": {}}, []), ({"1": {}}, events)]), \
                 patch.object(monitor.time, "sleep"), patch.object(monitor, "notify") as notify:
                monitor.main()
                monitor.main()
        self.assertEqual(notify.call_args.args[1], "\n\n".join(textos))
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
                  created="2026-10-01T10:00:00.000Z", updated=None, project_id=1):
    return {"iid": iid, "state": state, "title": title, "upvotes": likes,
            "author": {"username": author}, "created_at": created,
            "updated_at": updated or created,
            "head_pipeline": None if status is None else {"id": 1, "status": status},
            "web_url": f"https://gitlab.fpf.br/g/poc-sdd-{repo}/-/merge_requests/{iid}",
            "project_id": project_id}


def thread_notes(openers, resolved=True):
    return [{"id": index, "notes": [{"resolvable": True, "resolved": resolved,
                                     "author": {"username": who}}]}
            for index, who in enumerate(openers)]


def listing_mock(client, rows):
    """Faz um client.track() Mock responder como scan() espera.

    A mesma fonte de verdade (rows) alimenta a chamada, e por side_effect:
    um teste reatribui rows["1"] entre duas passagens, e a resposta precisa
    refletir o estado atual a cada chamada.
    """
    client.web_root = "https://gitlab.fpf.br"

    def responder(project):
        nos = [rest_row_to_graphql_node(r, web_root=client.web_root) for r in rows.values()]
        por_chave = {str(r["iid"]): rest_row_to_graphql_node(r, web_root=client.web_root)
                     for r in rows.values()}
        return nos, por_chave, set(), None
    client.track.side_effect = responder


class ReportTests(unittest.TestCase):
    mr = staticmethod(merge_request)
    threads = staticmethod(thread_notes)

    def test_o_limite_de_likes_da_preferencia_decide_o_destaque(self):
        com_6 = self.mr(7, "frontend", "t", "ana.lima", 6)
        com_1 = self.mr(8, "frontend", "t", "ana.lima", 1)
        # Zero desliga o destaque, mesmo com muitos likes.
        self.assertIsNone(monitor.report_row(com_6, [], likes_highlight=0)["likes_tone"])
        # Limite acima da contagem não destaca.
        self.assertIsNone(monitor.report_row(com_6, [], likes_highlight=7)["likes_tone"])
        # Contagem no limite, ou acima dele, destaca.
        self.assertEqual(monitor.report_row(com_6, [], likes_highlight=6)["likes_tone"], "strong")
        self.assertEqual(monitor.report_row(com_6, [], likes_highlight=5)["likes_tone"], "strong")
        # O padrão continua sendo a constante do módulo.
        self.assertEqual(monitor.report_row(com_6, [])["likes_tone"], "strong")
        self.assertIsNone(monitor.report_row(com_1, [])["likes_tone"])

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

    def test_report_row_counts_loose_comments_as_participants_not_threads(self):
        loose = [{"id": 1, "notes": [{"resolvable": False, "author": {"username": "bia.sa"}}]}]
        row = monitor.report_row(self.mr(7, "frontend", "t", "ana.lima", 0), loose)
        self.assertEqual(row["mr"], "FE #7 t")
        self.assertEqual(row["threads"], "sem threads")
        # Comentário avulso não conta como thread, mas quem comentou entra
        # nos participantes.
        self.assertEqual(row["openers"], "bia.sa")

    def test_report_row_excludes_the_mr_author_from_participants(self):
        thread = [{"id": 1, "notes": [
            {"resolvable": True, "resolved": False, "author": {"username": "ana.lima"}},
            {"author": {"username": "bia.sa"}},
        ]}]
        row = monitor.report_row(self.mr(7, "frontend", "t", "ana.lima", 0), thread)
        # ana.lima é a autora do MR: comentar no próprio MR não conta como
        # participação de outra pessoa.
        self.assertEqual(row["openers"], "bia.sa")

    def test_report_row_skips_self_only_threads_on_my_own_mr(self):
        thread = [{"id": 1, "notes": [
            {"resolvable": True, "resolved": False, "author": {"username": "ana.lima"}},
        ]}]
        row = monitor.report_row(self.mr(7, "frontend", "t", "ana.lima", 0), thread,
                                 me="ana.lima")
        # No meu próprio MR, uma thread onde só eu comentei (nota solta, sem
        # revisor) não entra na contagem.
        self.assertEqual(row["threads"], "sem threads")

    def test_report_row_still_counts_my_own_threads_as_a_reviewer(self):
        thread = [{"id": 1, "notes": [
            {"resolvable": True, "resolved": False, "author": {"username": "ana.lima"}},
        ]}]
        row = monitor.report_row(self.mr(7, "frontend", "t", "bia.sa", 0), thread,
                                 me="ana.lima")
        # O MR é de bia.sa: minha thread como revisora continua contando.
        self.assertEqual(row["threads"], "0/1 resolvidas")

    def test_report_row_still_counts_threads_with_someone_else_on_my_own_mr(self):
        thread = [{"id": 1, "notes": [
            {"resolvable": True, "resolved": False, "author": {"username": "ana.lima"}},
            {"author": {"username": "bia.sa"}},
        ]}]
        row = monitor.report_row(self.mr(7, "frontend", "t", "ana.lima", 0), thread,
                                 me="ana.lima")
        # bia.sa participou: não é "só eu mesma", então ainda conta.
        self.assertEqual(row["threads"], "0/1 resolvidas")

    def test_report_row_includes_repliers_as_participants(self):
        thread = [{"id": 1, "notes": [
            {"resolvable": True, "resolved": False, "author": {"username": "heloysa.uchoa"}},
            {"author": {"username": "luma.silva"}},
        ]}]
        row = monitor.report_row(self.mr(7, "frontend", "t", "ana.lima", 0), thread)
        self.assertEqual(row["threads"], "0/1 resolvidas")
        # Quem abriu a thread E quem respondeu, não só o primeiro.
        self.assertEqual(row["openers"], "heloysa.uchoa, luma.silva")

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
        report = monitor.report(client, ["groups/g"])[0]
        self.assertEqual([row["mr"] for row in report],
                         ["FE #2 recente", "FE #3 do meio", "BE #1 antigo"])

    def test_report_tolerates_missing_or_invalid_creation_date(self):
        rows = {"1": self.mr(1, "backend", "sem data", "ana.lima", 0, created=None),
                "2": self.mr(2, "frontend", "com data", "bia.sa", 0,
                             created="2026-10-19T10:00:00.000Z")}
        client = Mock()
        listing_mock(client, rows)
        report = monitor.report(client, ["groups/g"])[0]
        self.assertEqual([row["mr"] for row in report], ["FE #2 com data", "BE #1 sem data"])

    def test_table_lines_share_the_same_display_width(self):
        rows = [monitor.report_row(self.mr(199, "backend", "titulo bem longo " * 6, "geovana.medeiros", 2),
                                   self.threads(["heloysa.uchoa"])),
                monitor.report_row(self.mr(7, "frontend", "curto", "ana.lima", 0), [])]
        table = monitor.render_table(rows, monitor.REPORT_COLUMNS, links=False)
        self.assertEqual(len({monitor.text_width(line) for line in table.splitlines()}), 1)
        self.assertIn("Participantes", table)
        self.assertIn("Pipeline", table)
        self.assertIn("BE #199", table)

    def test_pipeline_status_covers_absent_and_unknown_states(self):
        self.assertEqual(monitor.pipeline_status(None), "— sem pipeline")
        self.assertEqual(monitor.pipeline_status({"id": 1, "status": "success"}),
                         "\N{WHITE HEAVY CHECK MARK} sucesso")
        self.assertEqual(monitor.pipeline_status({"id": 1, "status": "failed"}),
                         "\N{CROSS MARK} falhou")
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
        table = monitor.render_table(rows, monitor.REPORT_COLUMNS, links=False)
        self.assertEqual(len({monitor.text_width(line) for line in table.splitlines()}), 1)

    def test_mr_column_is_a_link_and_links_do_not_change_the_layout(self):
        rows = [monitor.report_row(
            self.mr(199, "backend", "titulo que ocupa mais de uma linha " * 3,
                    "geovana.medeiros", 2, status="running"),
            self.threads(["heloysa.uchoa"]))]
        url = rows[0]["url"]
        plain = monitor.render_table(rows, monitor.REPORT_COLUMNS, links=False)
        linked = monitor.render_table(rows, monitor.REPORT_COLUMNS, links=True)
        self.assertNotIn("\033]8;;", plain)
        # Cada linha da célula MR vira âncora para o mesmo MR, inclusive as
        # geradas pela quebra do título.
        limits = {column.key: column.width for column in monitor.REPORT_COLUMNS}
        expected = len(textwrap.wrap(rows[0]["mr"], limits["mr"]))
        self.assertGreater(expected, 1)
        self.assertEqual(linked.count(f"\033]8;;{url}\033\\"), expected)
        # Removidos os códigos, o desenho é idêntico ao da versão sem link.
        self.assertEqual(re.sub("\033\\]8;;[^\033]*\033\\\\", "", linked), plain)
        self.assertEqual(len({monitor.text_width(line) for line in plain.splitlines()}), 1)

    def test_links_are_disabled_when_output_is_not_a_terminal(self):
        rows = [monitor.report_row(self.mr(1, "backend", "um", "ana.lima", 0), [])]
        with patch.object(monitor.sys, "stdout", StringIO()):
            self.assertNotIn("\033]8;;", monitor.render_table(rows, monitor.REPORT_COLUMNS))

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
                 patch.object(monitor, "report", return_value=(built, [])) as report, \
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

    def test_serialized_cells_carry_raw_values(self):
        # O rótulo continua (é o do terminal e o fallback); ao lado dele vai o
        # valor cru, para o painel reformatar no idioma ativo.
        discussoes = self.threads(["ana.lima", "bia.sa"], resolved=True)
        row = monitor.report_row(
            {"iid": 5, "state": "opened", "upvotes": 0, "title": "t",
             "created_at": "2026-10-19T10:00:00Z", "updated_at": "2026-11-01T08:30:00Z",
             "author": {"username": "carla.dias"}, "mergeable": True, "conflicts": False,
             "head_pipeline": {"id": 1, "status": "failed"},
             "web_url": "https://gitlab.example/g/poc-sdd-backend/-/merge_requests/5"},
            discussoes)
        cells = monitor.serialize_row(row)["cells"]
        self.assertEqual(cells["pipeline"]["status"], "failed")
        self.assertEqual(cells["threads"]["resolved"], 2)
        self.assertEqual(cells["threads"]["total"], 2)
        self.assertEqual(cells["openers"]["names"], ["ana.lima", "bia.sa"])
        self.assertIs(cells["mergeable"]["value"], True)
        self.assertIs(cells["conflicts"]["value"], False)
        self.assertTrue(cells["updated_label"]["iso"].startswith("2026-11-01"))
        self.assertTrue(cells["created_label"]["iso"].startswith("2026-10-19"))
        self.assertEqual(cells["threads"]["label"], row["threads"])
        # Sem pipeline, sem data e sem threads: valores crus vazios, não inventados.
        vazia = monitor.serialize_row(self.rows[0])["cells"]
        self.assertIsNone(vazia["updated_label"]["iso"])
        self.assertEqual(vazia["threads"]["total"], 0)
        self.assertIsNone(vazia["mergeable"]["value"])

    def test_serialize_row_passes_raw_text_without_escaping_it(self):
        # O escape de HTML era feito em render_fragment()/render_html(), que
        # não existem mais: quem renderiza a página agora é o Angular, cujo
        # binding de template já escapa texto interpolado. O backend só
        # precisa devolver o texto/URL crus em JSON, sem HTML embutido.
        payload = monitor.serialize_row(self.rows[0])["cells"]
        self.assertIn('<script>alert("x")</script>', payload["mr"]["label"])
        self.assertEqual(payload["mr"]["url"],
                         "https://gitlab.example/g/poc-sdd-backend/-/merge_requests/199")
        self.assertNotIn("&lt;", payload["mr"]["label"])

    def test_data_route_polls_in_seconds_not_in_the_server_minutes_cycle(self):
        snapshot = monitor.panel_snapshot(monitor.panel_state(["g%2Fp"], 15), 0)
        # A página busca em segundos, não no ciclo de minutos do servidor.
        self.assertEqual(snapshot["poll"], monitor.POLL_SECONDS)
        self.assertLessEqual(snapshot["poll"], 30)

    def test_tone_follows_the_pipeline_status_semantics(self):
        cases = (("failed", "danger"), ("success", "success"),
                 ("running", "info"), ("pending", "warning"))
        for status, expected in cases:
            with self.subTest(status=status):
                row = monitor.report_row(
                    {"iid": 1, "state": "opened", "upvotes": 0, "title": "t",
                     "created_at": "2026-10-19T10:00:00Z", "author": {"username": "ana.lima"},
                     "head_pipeline": {"id": 1, "status": status},
                     "web_url": "https://gitlab.example/g/poc-sdd-backend/-/merge_requests/1"}, [])
                self.assertEqual(
                    monitor.serialize_row(row)["cells"]["pipeline"]["tone"], expected)
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

    def test_changed_field_names_only_the_tracked_fields_that_moved(self):
        # O wrapper visual da marca (<span class="cell">) agora é do Angular
        # (app-changed-mark/mr-table.html, com teste próprio em
        # frontend/src/app/features/mr-table/mr-table.spec.ts); aqui só
        # importa que o backend aponte exatamente os campos certos.
        atual = [self.linha(likes=3, status="failed")]
        monitor.mark_changes(atual, [self.linha(likes=1, status="failed")])
        self.assertEqual(monitor.serialize_row(atual[0])["changed"], ["likes"])

    def test_terminal_table_ignores_the_changed_field(self):
        atual = [self.linha(likes=3)]
        monitor.mark_changes(atual, [self.linha(likes=1)])
        # A marca de alteração é só do painel web; a tabela do terminal usa
        # render_table(), que nunca leu o campo "changed".
        self.assertNotIn("changed", monitor.render_table(atual, monitor.REPORT_COLUMNS, links=False))

    def test_first_load_says_it_is_loading_instead_of_reporting_an_empty_target(self):
        # A primeira consulta leva segundos; dizer "nenhum MR" nesse intervalo
        # faz a página parecer quebrada logo na primeira execução.
        estado = monitor.panel_state(["g%2Fp"], 15)
        carregando = monitor.panel_snapshot(estado, 0)
        self.assertEqual(carregando["emptyMessage"],
                         {"key": "loading", "label": monitor.LOADING_MESSAGE})
        self.assertFalse(carregando["collected"])
        # Depois da consulta, aí sim o alvo pode estar realmente vazio.
        estado["updated"] = monitor.datetime.now().astimezone()
        vazio = monitor.panel_snapshot(estado, 0)
        self.assertEqual(vazio["emptyMessage"],
                         {"key": "empty-target", "label": monitor.EMPTY_TARGET_MESSAGE})
        self.assertTrue(vazio["collected"])

    def test_each_empty_state_has_its_own_message(self):
        estado = monitor.panel_state(["g%2Fp"], 15)
        self.assertEqual(monitor.panel_snapshot(estado, 0)["emptyMessage"],
                         {"key": "loading", "label": monitor.LOADING_MESSAGE})
        estado["updated"] = monitor.datetime.now().astimezone()
        self.assertEqual(monitor.panel_snapshot(estado, 0)["emptyMessage"],
                         {"key": "empty-target", "label": monitor.EMPTY_TARGET_MESSAGE})
        estado["rows"] = self.rows
        cheio = monitor.panel_snapshot(estado, 0)
        self.assertIsNone(cheio["emptyMessage"])
        self.assertEqual(cheio["rows"][0]["cells"]["mr"]["label"], self.rows[0]["mr"])
        filtrado = monitor.panel_snapshot(estado, 0, authors=["ninguem"])
        self.assertEqual(filtrado["emptyMessage"],
                         {"key": "empty-filter", "label": monitor.EMPTY_FILTER_MESSAGE})

    def test_likes_highlight_comes_from_the_panel_preference(self):
        # Quem olha o painel escolhe a partir de quantos likes o selo
        # destaca; zero desliga. Quem decide o tom continua sendo o backend.
        linha = self.linha(likes=3)
        self.assertEqual(monitor.serialize_row(linha, 0)["cells"]["likes"]["tone"], None)
        self.assertEqual(monitor.serialize_row(linha, 3)["cells"]["likes"]["tone"], "strong")
        self.assertEqual(monitor.serialize_row(linha, 4)["cells"]["likes"]["tone"], None)

    def test_cada_linha_leva_os_fatos_crus_para_o_painel(self):
        # O painel precisa do número, não do rótulo: "2 👍" não dá para comparar.
        mr = self.mr(5, "backend", "Draft: ajusta algo", "ana.lima", 3, status="failed",
                     created="2026-10-01T10:00:00.000Z", updated="2026-10-02T10:00:00.000Z")
        mr.update(mergeable=True, conflicts=False)
        discussoes = self.threads(["bia", "caio"], resolved=False) + self.threads(["bia"])
        fatos = monitor.serialize_row(monitor.report_row(mr, discussoes, mine=True))["facts"]
        self.assertEqual(fatos, {
            "likes": 3, "unresolved": 2, "participants": 2, "mergeable": True,
            "conflicts": False, "pipeline": "failed", "author": "ana.lima",
            "mine": True, "involved": True, "draft": True, "ageHours": fatos["ageHours"],
            "idleHours": fatos["idleHours"], "assignedToMe": False,
            "reviewingMine": False, "myReviewState": "", "assignees": 0, "reviewers": 0})
        self.assertGreaterEqual(fatos["idleHours"], 0)
        self.assertGreaterEqual(fatos["ageHours"], fatos["idleHours"])
        self.assertIsInstance(fatos["ageHours"], int)

    def test_involved_cobre_autor_participante_e_curtida_mas_nao_estranho(self):
        # "involved" é "é meu ou participo": o autor quase nunca consegue curtir
        # o próprio MR, então só o 👍 (mine) deixaria os MRs dele de fora.
        def envolvida(autor, discussoes=(), mine=False, me="ana.lima"):
            mr = self.mr(1, "backend", "um", autor, 0)
            linha = monitor.report_row(mr, list(discussoes), mine, me=me)
            return linha["involved"], linha["mine"]
        self.assertEqual(envolvida("ana.lima"), (True, False))
        self.assertEqual(envolvida("bia", self.threads(["ana.lima"])), (True, False))
        self.assertEqual(envolvida("bia", mine=True), (True, True))
        self.assertEqual(envolvida("bia", self.threads(["caio"])), (False, False))
        self.assertEqual(envolvida("bia", me=None), (False, False))

    def test_involved_chega_aos_facts_e_ao_evento(self):
        mr = self.mr(1, "backend", "um", "ana.lima", 0)
        linha = monitor.report_row(mr, [], False, me="ana.lima")
        self.assertTrue(monitor.serialize_row(linha)["facts"]["involved"])
        self.assertFalse(monitor.serialize_row(linha)["facts"]["mine"])
        # Autora é a própria usuária e ninguém curtiu: envolvida sem "mine".
        previous = {"1": {"1": monitor.snapshot(row(1, author="ana.lima"), [])}}
        novo = row(1, author="ana.lima", likes=2)
        _, events = monitor.collect(Client([novo], [novo], me="ana.lima"), ["1"], previous)
        self.assertEqual(events[0]["involved"], True)
        self.assertEqual(events[0]["mine"], False)

    def test_facts_draft_ignores_case_and_only_looks_at_the_start_of_the_title(self):
        def draft(titulo):
            linha = monitor.report_row(self.mr(1, "backend", titulo, "ana.lima", 0), [])
            return monitor.serialize_row(linha)["facts"]["draft"]
        self.assertTrue(draft("wip: em andamento"))
        self.assertTrue(draft("DRAFT: em andamento"))
        self.assertFalse(draft("remove o draft: do título"))

    def test_facts_without_pipeline_or_dates_do_not_invent_values(self):
        mr = self.mr(1, "backend", "um", "ana.lima", 0, created=None)
        fatos = monitor.serialize_row(monitor.report_row(mr, []))["facts"]
        self.assertEqual(fatos["pipeline"], "")
        self.assertIsNone(fatos["mergeable"])
        self.assertIsNone(fatos["conflicts"])
        # Data ilegível não vira "parado há milhões de horas".
        self.assertEqual((fatos["ageHours"], fatos["idleHours"]), (0, 0))

    # --- assignees e revisores ------------------------------------------------

    def review_row(self, assignees=(), reviewers=(), me=None):
        mr = self.mr(1, "backend", "um", "caio", 0)
        mr.update(assignees=list(assignees), reviewers=list(reviewers))
        return monitor.report_row(mr, [], me=me)

    def test_review_column_follows_openers_and_lists_people(self):
        keys = [column.key for column in monitor.REPORT_COLUMNS]
        self.assertEqual(keys[keys.index("openers") + 1], "review")
        column = monitor.REPORT_COLUMNS[keys.index("review")]
        self.assertEqual((column.label, column.width, column.cell, column.weight),
                         ("Revisão", 24, "people", 16))

    def test_review_column_shows_assignees_and_reviewers(self):
        row = self.review_row(["ana.lima"], [("bia.sa", "unreviewed")])
        self.assertEqual(row["review"], "ana.lima · bia.sa")

    def test_review_column_names_a_person_once(self):
        row = self.review_row(["ana.lima"], [("ana.lima", "unreviewed")])
        self.assertEqual(row["review"], "ana.lima")

    def test_review_column_is_dash_without_assignee_or_reviewer(self):
        self.assertEqual(self.review_row()["review"], "—")

    def test_review_cell_ships_the_label_and_the_raw_facts(self):
        row = self.review_row(["ana.lima"], [("bia.sa", "requested_changes")], me="bia.sa")
        cell = monitor.serialize_row(row)["cells"]["review"]
        self.assertEqual(cell["label"], "ana.lima · bia.sa")
        self.assertEqual(cell["tone"], "danger")
        # Uma pessoa por linha no painel: a lista crua, não o rótulo partido.
        self.assertEqual(cell["names"], ["ana.lima", "bia.sa"])
        self.assertEqual(cell["assignees"], ["ana.lima"])
        self.assertEqual(cell["reviewers"], [{"username": "bia.sa", "state": "requested_changes"}])
        self.assertEqual(cell["state"], "requested_changes")

    def test_review_tone_only_follows_my_own_state(self):
        def tone(state, me="bia.sa"):
            return self.review_row([], [("bia.sa", state)], me=me)["review_tone"]
        self.assertEqual(tone("unreviewed"), "warning")
        self.assertEqual(tone("requested_changes"), "danger")
        self.assertEqual(tone("approved"), "success")
        self.assertEqual(tone("reviewed"), "success")
        self.assertIsNone(tone("review_started"))
        # Outra pessoa pendente não é pendência minha.
        self.assertIsNone(tone("unreviewed", me="ana.lima"))
        self.assertIsNone(self.review_row(["bia.sa"], [], me="bia.sa")["review_tone"])

    def test_review_label_has_no_glyph_for_the_terminal_or_the_web(self):
        label = self.review_row(["ana.lima"], [("bia.sa", "unreviewed")])["review"]
        self.assertTrue(all(ord(char) < 0x2000 or char == "·" for char in label))

    def test_facts_report_my_review_state(self):
        row = self.review_row(["ana.lima"], [("ana.lima", "requested_changes")], me="ana.lima")
        facts = monitor.serialize_row(row)["facts"]
        self.assertTrue(facts["assignedToMe"])
        self.assertTrue(facts["reviewingMine"])
        self.assertEqual(facts["myReviewState"], "requested_changes")
        self.assertEqual((facts["assignees"], facts["reviewers"]), (1, 1))

    def test_facts_are_neutral_when_fields_are_missing(self):
        # GraphQL que não devolve assignees/reviewers (campo ausente ou null).
        mr = self.mr(1, "backend", "um", "caio", 0)
        mr.update(assignees=None, reviewers=None)
        facts = monitor.serialize_row(monitor.report_row(mr, [], me="ana.lima"))["facts"]
        self.assertFalse(facts["assignedToMe"])
        self.assertFalse(facts["reviewingMine"])
        self.assertEqual(facts["myReviewState"], "")
        self.assertEqual((facts["assignees"], facts["reviewers"]), (0, 0))
        bare = self.mr(2, "backend", "dois", "caio", 0)
        self.assertEqual(monitor.report_row(bare, [], me="ana.lima")["review"], "—")

    def test_facts_without_me_are_never_mine(self):
        row = self.review_row(["ana.lima"], [("ana.lima", "unreviewed")], me=None)
        facts = monitor.serialize_row(row)["facts"]
        self.assertEqual((facts["assignedToMe"], facts["reviewingMine"], facts["myReviewState"]),
                         (False, False, ""))

    def test_graphql_row_normalizes_assignees_and_reviewers(self):
        node = rest_row_to_graphql_node(row(1, assignees=["ana.lima"],
                                            reviewers=[("bia.sa", "unreviewed")]))
        normal = monitor.graphql_row(node, "https://gitlab.example")
        self.assertEqual(normal["assignees"], ["ana.lima"])
        self.assertEqual(normal["reviewers"], [("bia.sa", "unreviewed")])

    def test_graphql_row_treats_absent_or_null_fields_as_empty(self):
        for patch_ in ({"assignees": None, "reviewers": None}, {}):
            node = rest_row_to_graphql_node(row(1))
            node.pop("assignees"), node.pop("reviewers")
            node.update(patch_)
            normal = monitor.graphql_row(node, "https://gitlab.example")
            self.assertEqual((normal["assignees"], normal["reviewers"]), ([], []))
        # Revisor sem interação (reviewState ausente) continua na lista.
        node = rest_row_to_graphql_node(row(1))
        node["reviewers"] = {"nodes": [{"username": "bia.sa", "mergeRequestInteraction": None}]}
        self.assertEqual(monitor.graphql_row(node, "https://gitlab.example")["reviewers"],
                         [("bia.sa", "")])

    def test_track_query_asks_for_assignees_and_reviewers_without_approvals(self):
        client = monitor.GitLab.__new__(monitor.GitLab)
        client._namespace_cache = {"g": ("group", "g")}
        queries = []
        client.graphql = lambda name, query, variables: (
            queries.append(query) or graphql_response([]))
        client.track("g")
        self.assertEqual(len(queries), 1)
        self.assertIn("assignees { nodes { username } }", queries[0])
        self.assertIn("reviewState", queries[0])
        self.assertNotIn("approved", queries[0])

    def review_sample(self):
        def build(iid, assignees=(), reviewers=()):
            mr = self.mr(iid, "backend", f"titulo {iid}", "caio", 0,
                         created=f"2026-10-0{iid}T10:00:00Z")
            mr.update(assignees=list(assignees), reviewers=list(reviewers))
            return monitor.report_row(mr, [], me="ana.lima")
        return [build(1, ["ana.lima"]), build(2, [], [("ana.lima", "unreviewed")]),
                build(3, ["bia.sa"], [("caio", "unreviewed")]), build(4)]

    def test_review_filter_keeps_only_mine(self):
        rows = self.review_sample()
        names = lambda *review: [row["mr"][-1] for row in monitor.arrange(rows, review=list(review))]
        self.assertEqual(names("assigned"), ["1"])
        self.assertEqual(names("reviewing"), ["2"])

    def test_review_filter_with_several_values_keeps_rows_matching_any(self):
        rows = self.review_sample()
        names = lambda *review: [row["mr"][-1] for row in monitor.arrange(rows, review=list(review))]
        self.assertEqual(sorted(names("assigned", "reviewing")), ["1", "2"])
        # Valor desconhecido na lista é ignorado; só os conhecidos filtram.
        self.assertEqual(names("qualquer", "assigned"), ["1"])
        self.assertEqual(len(monitor.arrange(rows, review=[])), 4)

    def test_unassigned_filter_is_for_nobody(self):
        rows = self.review_sample()
        self.assertEqual([row["mr"][-1] for row in monitor.arrange(rows, review=["unassigned"])],
                         ["4"])

    def test_unknown_review_filter_value_is_ignored(self):
        rows = self.review_sample()
        self.assertEqual(monitor.arrange(rows, review=["qualquer"]), monitor.arrange(rows))

    def test_data_route_reads_the_review_parameter(self):
        state = monitor.panel_state(["g%2Fp"], 15)
        state["rows"] = self.review_sample()
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
            self.assertEqual(len(fetch("since=0&review=assigned")["rows"]), 1)
            self.assertEqual(len(fetch("since=0&review=reviewing")["rows"]), 1)
            self.assertEqual(len(fetch("since=0&review=unassigned")["rows"]), 1)
            self.assertEqual(len(fetch("since=0&review=qualquer")["rows"]), 4)
            self.assertEqual(
                len(fetch("since=0&review=assigned&review=reviewing")["rows"]), 2)
        finally:
            server.shutdown()
            server.server_close()

    def review_events(self, before, after, me="ana.lima"):
        first = row(1, **before)
        second = row(1, **after)
        client = Client([first], [first], me=me)
        previous, _, _, _ = monitor.scan(client, ["1"])
        client = Client([second], [second], me=me)
        return monitor.scan(client, ["1"], previous)[1]

    def test_event_when_i_become_reviewer(self):
        events = self.review_events({}, {"reviewers": [("ana.lima", "unreviewed")]})
        self.assertEqual([e["kind"] for e in events], ["review"])
        self.assertEqual(events[0]["text"].count("\n"), 2)
        self.assertEqual(events[0]["mine"], False)
        self.assertIn("involved", events[0])

    def test_event_when_i_become_assignee_or_leave(self):
        self.assertEqual([e["kind"] for e in self.review_events({}, {"assignees": ["ana.lima"]})],
                         ["review"])
        self.assertEqual([e["kind"] for e in self.review_events({"assignees": ["ana.lima"]}, {})],
                         ["review"])

    def test_no_event_when_someone_else_becomes_reviewer(self):
        self.assertEqual(
            self.review_events({}, {"reviewers": [("bia.sa", "unreviewed")]}), [])
        self.assertEqual(self.review_events({}, {"assignees": ["bia.sa"]}), [])

    def test_no_event_for_a_snapshot_written_before_the_field_existed(self):
        first = row(1, reviewers=[("ana.lima", "unreviewed")])
        previous, _, _, _ = monitor.scan(Client([first], [first], me="ana.lima"), ["1"])
        del previous["1"]["1"]["reviewing"]
        events = monitor.scan(Client([first], [first], me="ana.lima"), ["1"], previous)[1]
        self.assertEqual(events, [])

    def test_detail_fallback_carries_my_review_state_forward(self):
        involved = row(1, reviewers=[("ana.lima", "unreviewed")])
        previous, _, _, _ = monitor.scan(Client([involved], [involved], me="ana.lima"), ["1"])
        # MR some da listagem mas segue aberto no REST: nada mudou para mim.
        current, events, _, _ = monitor.scan(Client([], [involved], me="ana.lima"), ["1"], previous)
        self.assertTrue(current["1"]["1"]["reviewing"])
        self.assertEqual(events, [])
        # E sem o campo no histórico, o REST também não inventa um.
        del previous["1"]["1"]["reviewing"]
        current, events, _, _ = monitor.scan(Client([], [involved], me="ana.lima"), ["1"], previous)
        self.assertNotIn("reviewing", current["1"]["1"])
        self.assertEqual(events, [])

    def test_no_event_when_my_review_state_alone_changes(self):
        events = self.review_events({"reviewers": [("ana.lima", "unreviewed")]},
                                    {"reviewers": [("ana.lima", "approved")]})
        self.assertEqual(events, [])

    def test_review_cell_is_marked_when_the_people_change(self):
        before = self.review_row(["ana.lima"], [], me="ana.lima")
        before["url"] = "u"
        after = self.review_row(["ana.lima"], [("bia.sa", "unreviewed")], me="ana.lima")
        after["url"] = "u"
        marked = monitor.mark_changes([after], [before])
        self.assertIn("review", marked[0]["changed"])

    def test_columns_carry_the_cell_kind_and_the_width_weight(self):
        # O painel desenha cada célula pelo "cell" da coluna e distribui a
        # largura pelo "weight": nenhum dos dois pode viver duplicado no
        # frontend, senão uma coluna nova exigiria mexer nos dois lados.
        estado = monitor.panel_state(["g%2Fp"], 15)
        colunas = {item["key"]: item for item in monitor.panel_snapshot(estado, 0)["columns"]}
        self.assertEqual(colunas["mr"]["cell"], "link")
        self.assertEqual(colunas["pipeline"]["cell"], "badge")
        self.assertEqual(colunas["updated_label"]["cell"], "time")
        self.assertEqual(colunas["likes"]["cell"], "likes")
        self.assertEqual(colunas["author"]["cell"], "text")
        # MR é a coluna mais pesada, e por boa margem: é a única que carrega
        # título de MR, texto longo que no painel precisa de mais de duas
        # colunas comuns para não quebrar em três linhas.
        pesos = [item["weight"] for key, item in colunas.items() if key != "mr"]
        self.assertGreater(colunas["mr"]["weight"], 2 * max(pesos))

    def test_first_pass_fills_the_table_without_emitting_events(self):
        # report e painel: a primeira passagem já devolve as linhas e nenhum
        # evento; a comparação começa da segunda em diante.
        rows = {"1": self.mr(1, "backend", "um", "ana.lima", 1)}
        client = Mock()
        listing_mock(client, rows)
        snapshots, events, linhas, _ = monitor.scan(client, ["g%2Fp"], None)
        self.assertEqual(events, [])
        self.assertEqual([linha["mr"] for linha in linhas], ["BE #1 um"])
        self.assertEqual([linha["mr"] for linha in monitor.report(client, ["g%2Fp"])[0]], ["BE #1 um"])
        # Segunda passagem, agora com referência: a mudança vira evento.
        rows["1"] = self.mr(1, "backend", "um", "ana.lima", 4)
        _, segunda, linhas, _ = monitor.scan(client, ["g%2Fp"], snapshots)
        self.assertEqual(len(linhas), 1)
        self.assertTrue(any("LIKES 1 → 4" in evento["text"] for evento in segunda))

    def test_own_like_is_marked_beside_the_count(self):
        def linha(mine):
            return monitor.report_row(self.mr(1, "backend", "um", "ana.lima", 3), [], mine)
        self.assertEqual(linha(True)["likes"], f"3 \N{THUMBS UP SIGN} {monitor.MINE_MARK}")
        self.assertEqual(linha(False)["likes"], "3 \N{THUMBS UP SIGN}")
        # serialize_row expõe "mine" como booleano à parte (o Angular decide
        # como marcar, ver app-mr-table): aqui só confere que o dado chega.
        self.assertTrue(monitor.serialize_row(linha(True))["cells"]["likes"]["mine"])
        self.assertFalse(monitor.serialize_row(linha(False))["cells"]["likes"]["mine"])

    def test_own_like_mark_keeps_the_terminal_columns_aligned(self):
        # Um sinal estreito, de uma coluna: a tabela não pode desalinhar nem
        # estourar a largura reservada aos likes.
        self.assertEqual(monitor.text_width(monitor.MINE_MARK), 1)
        rows = [monitor.report_row(self.mr(1, "backend", "um", "ana.lima", 12), [], True),
                monitor.report_row(self.mr(2, "frontend", "dois", "ana.lima", 0), [], False)]
        table = monitor.render_table(rows, monitor.REPORT_COLUMNS, links=False)
        self.assertEqual(len({monitor.text_width(line) for line in table.splitlines()}), 1)
        largura = {column.key: column.width for column in monitor.REPORT_COLUMNS}["likes"]
        self.assertLessEqual(monitor.text_width(rows[0]["likes"]), largura)

    def test_track_captures_the_current_username_from_the_same_query(self):
        client = monitor.GitLab("https://gitlab.example/api/v4", "fake")
        with patch.object(client, "graphql",
                          return_value=graphql_response([], me="ana.lima")) as graphql:
            _, _, _, meu_usuario = client.track("g%2Fp")
        self.assertEqual(meu_usuario, "ana.lima")
        self.assertEqual(graphql.call_count, 1)

    def test_own_likes_come_from_the_liked_sub_query(self):
        # Sem usuário configurado: o filtro é resolvido pelo próprio token, e
        # as duas sub-consultas (lista e liked) viajam numa única
        # requisição GraphQL, não uma listagem extra por ciclo.
        client = monitor.GitLab("https://gitlab.example/api/v4", "fake")
        curtido = {"iid": 1, "project": {"id": "gid://gitlab/Project/10"}}
        for alvo, caminho_esperado, chave in (("groups/g", "g", "10:1"), ("g%2Fp", "g/p", "1")):
            with self.subTest(alvo=alvo):
                with patch.object(client, "graphql",
                                  return_value=graphql_response([], liked=[curtido])) as graphql:
                    _, _, mine, _ = client.track(alvo)
                self.assertEqual(mine, {chave})
                self.assertEqual(graphql.call_count, 1)
                self.assertEqual(graphql.call_args.args[2]["fullPath"], caminho_esperado)
                self.assertEqual(graphql.call_args.args[2]["reaction"], "thumbsup")

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
        self.assertEqual(monitor.serialize_row(tone(2))["cells"]["likes"]["tone"], "strong")
        self.assertIsNone(monitor.serialize_row(tone(1))["cells"]["likes"]["tone"])

    def test_likers_are_listed_in_the_serialized_likes_field(self):
        base = {"iid": 1, "state": "opened", "upvotes": 2, "title": "t",
                "created_at": "2026-10-19T10:00:00Z", "author": {"username": "ana.lima"},
                "head_pipeline": None,
                "web_url": "https://gitlab.example/g/poc-sdd-backend/-/merge_requests/1"}
        com_likers = monitor.report_row(dict(base, likers=["bia.sa", "cris.me"]), [])
        self.assertEqual(monitor.serialize_row(com_likers)["cells"]["likes"]["likers"],
                         ["bia.sa", "cris.me"])
        sem_likers = monitor.report_row(base, [])
        self.assertEqual(monitor.serialize_row(sem_likers)["cells"]["likes"]["likers"], [])

    def test_mergeable_and_conflicts_columns_show_badges_with_tones(self):
        base = {"iid": 1, "state": "opened", "upvotes": 0, "title": "t",
                "created_at": "2026-10-19T10:00:00Z", "author": {"username": "ana.lima"},
                "head_pipeline": None,
                "web_url": "https://gitlab.example/g/poc-sdd-backend/-/merge_requests/1"}
        bloqueado = monitor.report_row(dict(base, mergeable=False, conflicts=True), [])
        self.assertIn("bloqueado", bloqueado["mergeable"])
        self.assertEqual(bloqueado["mergeable_tone"], "danger")
        self.assertIn("conflito", bloqueado["conflicts"])
        self.assertEqual(bloqueado["conflicts_tone"], "danger")
        livre = monitor.report_row(dict(base, mergeable=True, conflicts=False), [])
        self.assertIn("mergeável", livre["mergeable"])
        # Mesmo tom do pipeline "success": mesclável é o estado bom.
        self.assertEqual(livre["mergeable_tone"], "success")
        self.assertIn("sem conflito", livre["conflicts"])
        self.assertIsNone(livre["conflicts_tone"])
        desconhecido = monitor.report_row(base, [])
        self.assertEqual(desconhecido["mergeable"], monitor.UNKNOWN_LABEL)
        self.assertEqual(desconhecido["conflicts"], monitor.UNKNOWN_LABEL)
        payload = monitor.serialize_row(bloqueado)["cells"]
        self.assertEqual(payload["mergeable"]["tone"], "danger")
        self.assertEqual(payload["conflicts"]["tone"], "danger")
        # No painel o selo já diz o estado pela cor: o glifo da tabela do
        # terminal não vai junto, senão seria ícone escrito como texto.
        self.assertEqual(payload["mergeable"]["label"], "bloqueado")
        self.assertEqual(payload["conflicts"]["label"], "conflito")

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

    def test_sort_keys_are_english(self):
        self.assertEqual([item.key for item in monitor.SORTS],
                         ["recent", "updated", "likes", "mr", "author",
                          "threads", "participants", "pipeline"])

    def test_no_pipeline_filter_value_is_english(self):
        self.assertEqual(monitor.NO_PIPELINE, "no-pipeline")

    def test_default_order_is_newest_first(self):
        rows = monitor.arrange(self.sample())
        self.assertEqual([row["mr"] for row in rows],
                         ["FE #2 titulo 2", "FE #3 titulo 3", "BE #1 titulo 1"])

    def test_each_sort_option_orders_as_named(self):
        rows = self.sample()
        expected = {
            "likes": ["FE #2 titulo 2", "FE #3 titulo 3", "BE #1 titulo 1"],
            "mr": ["BE #1 titulo 1", "FE #2 titulo 2", "FE #3 titulo 3"],
            "author": ["FE #3 titulo 3", "BE #1 titulo 1", "FE #2 titulo 2"],
            # Duas não resolvidas, depois uma, depois nenhuma.
            "threads": ["BE #1 titulo 1", "FE #3 titulo 3", "FE #2 titulo 2"],
            # failed primeiro, success depois, sem pipeline por último.
            "pipeline": ["BE #1 titulo 1", "FE #2 titulo 2", "FE #3 titulo 3"],
        }
        for sort, order in expected.items():
            with self.subTest(sort=sort):
                self.assertEqual([row["mr"] for row in monitor.arrange(rows, sort)], order)

    def test_every_sort_can_be_asked_the_other_way_round(self):
        # Clicar de novo no cabeçalho inverte: cada ordenação tem de saber
        # sair ao contrário, inclusive a que não tem chave própria ("recent").
        rows = self.sample()
        for item in monitor.SORTS:
            with self.subTest(sort=item.key):
                # A chave já vem no sentido natural (crescente), então pedir o
                # outro sentido tem de deixá-la decrescente.
                chave = item.order or (lambda row: -row["created"].timestamp())
                outro = "asc" if item.direction == "desc" else "desc"
                self.assertEqual(
                    [row["mr"] for row in monitor.arrange(rows, item.key, direction=item.direction)],
                    [row["mr"] for row in monitor.arrange(rows, item.key)])
                valores = [chave(row) for row in
                           monitor.arrange(rows, item.key, direction=outro)]
                self.assertEqual(valores, sorted(valores, reverse=True))

    def test_unknown_direction_is_the_natural_one(self):
        rows = self.sample()
        natural = [row["mr"] for row in monitor.arrange(rows, "likes")]
        for direction in ("", "qualquer", "ASC", None):
            with self.subTest(direction=direction):
                self.assertEqual([row["mr"] for row in
                                  monitor.arrange(rows, "likes", direction=direction)],
                                 natural)

    def test_inverted_sort_still_breaks_ties_by_the_newest(self):
        # O desempate é a data, do mais novo ao mais antigo, nos DOIS sentidos:
        # inverter a ordenação não pode virar o critério de desempate junto.
        rows = [monitor.report_row(self.mr(iid, "backend", "t", "ana.lima", 1, created=created), [])
                for iid, created in ((1, "2026-10-01T10:00:00Z"), (2, "2026-10-20T10:00:00Z"))]
        rows.sort(key=lambda row: row["created"], reverse=True)
        self.assertEqual([row["mr"] for row in monitor.arrange(rows, "likes", direction="asc")],
                         ["BE #2 t", "BE #1 t"])

    def test_sort_labels_name_the_column_not_a_direction(self):
        # O sentido é escolhido no cabeçalho, então o rótulo não promete um.
        self.assertEqual([item.label for item in monitor.SORTS],
                         ["Criado", "Atualizado", "Likes", "MR", "Autor",
                          "Threads", "Participantes", "Pipeline"])

    def test_sorts_tie_break_by_date(self):
        # Mesmo número de likes: a data decide, mais recente em cima.
        rows = [monitor.report_row(self.mr(iid, "backend", "t", "ana.lima", 1, created=created), [])
                for iid, created in ((1, "2026-10-01T10:00:00Z"), (2, "2026-10-20T10:00:00Z"))]
        rows.sort(key=lambda row: row["created"], reverse=True)
        self.assertEqual([row["mr"] for row in monitor.arrange(rows, "likes")],
                         ["BE #2 t", "BE #1 t"])

    def test_every_declared_sort_is_offered_and_accepted(self):
        rows = self.sample()
        for item in monitor.SORTS:
            with self.subTest(sort=item.key):
                self.assertEqual(len(monitor.arrange(rows, item.key)), 3)
        snapshot_sorts = {item["value"]: item["label"] for item in
                          monitor.panel_snapshot(monitor.panel_state(["g%2Fp"], 15), 0)["sorts"]}
        for item in monitor.SORTS:
            self.assertEqual(snapshot_sorts[item.key], item.label)

    def test_every_sort_points_at_a_column_that_exists(self):
        # É o que deixa a seta aparecer no cabeçalho certo e o clique no
        # cabeçalho escolher a ordenação correspondente: uma ordenação
        # apontando para coluna inexistente sumiria em silêncio.
        colunas = {column.key for column in monitor.REPORT_COLUMNS}
        for item in monitor.SORTS:
            with self.subTest(sort=item.key):
                self.assertIn(item.column, colunas)
                self.assertIn(item.direction, ("asc", "desc"))

    def test_sorts_carry_the_column_and_direction_to_the_panel(self):
        estado = monitor.panel_state(["g%2Fp"], 15)
        ordens = {item["value"]: item for item in monitor.panel_snapshot(estado, 0)["sorts"]}
        self.assertEqual(ordens["likes"]["column"], "likes")
        self.assertEqual(ordens["likes"]["direction"], "desc")
        self.assertEqual(ordens["mr"]["column"], "mr")
        self.assertEqual(ordens["mr"]["direction"], "asc")

    def test_filters_narrow_by_author_and_pipeline(self):
        rows = self.sample()
        self.assertEqual([row["mr"] for row in monitor.arrange(rows, authors=["ana.lima"])],
                         ["FE #3 titulo 3", "BE #1 titulo 1"])
        self.assertEqual([row["mr"] for row in monitor.arrange(rows, pipelines=["failed"])],
                         ["BE #1 titulo 1"])
        # MR sem pipeline tem opção própria, em vez de sumir do filtro.
        self.assertEqual(
            [row["mr"] for row in monitor.arrange(rows, pipelines=[monitor.NO_PIPELINE])],
            ["FE #3 titulo 3"])
        self.assertEqual(monitor.arrange(rows, authors=["ninguem"]), [])

    def test_filter_options_come_from_all_rows_and_are_labelled(self):
        options = monitor.filter_options(self.sample())
        self.assertEqual([item["value"] for item in options["authors"]], ["ana.lima", "bia.sa"])
        values = [item["value"] for item in options["pipelines"]]
        self.assertEqual(values, ["failed", "success", monitor.NO_PIPELINE])
        labels = {item["value"]: item["label"] for item in options["pipelines"]}
        self.assertEqual(labels[monitor.NO_PIPELINE], "sem pipeline")
        self.assertIn("falhou", labels["failed"])

    def test_data_route_applies_sort_and_filter_from_the_query(self):
        state = monitor.panel_state(["g%2Fp"], 15)
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
            self.assertEqual(len(todos["rows"]), 3)
            self.assertEqual(todos["meta"]["shown"], 3)
            self.assertEqual(todos["meta"]["total"], 3)
            filtrado = fetch("since=0&author=ana.lima")
            self.assertEqual(len(filtrado["rows"]), 2)
            self.assertEqual((filtrado["meta"]["shown"], filtrado["meta"]["total"]), (2, 3))
            # Filtro não encolhe as opções oferecidas.
            self.assertEqual(len(filtrado["filters"]["authors"]), 2)
            # Ordenação desconhecida não derruba a rota: cai no padrão.
            self.assertEqual(fetch("since=0&sort=inventado")["rows"],
                             fetch("since=0&sort=recent")["rows"])
            # O valor guardado pela versão anterior também cai no padrão.
            self.assertEqual(fetch("since=0&sort=recente")["rows"],
                             fetch("since=0&sort=recent")["rows"])
            vazio = fetch("since=0&author=ninguem")
            self.assertEqual(vazio["emptyMessage"],
                             {"key": "empty-filter", "label": "Nenhum MR corresponde aos filtros."})
            # Multi-seleção: query string repetida soma os dois autores, não
            # restringe à interseção.
            dois_autores = fetch("since=0&author=ana.lima&author=bia.sa")
            self.assertEqual(len(dois_autores["rows"]), 3)
            dois_pipelines = fetch("since=0&pipeline=failed&pipeline=success")
            self.assertEqual(len(dois_pipelines["rows"]), 2)
            # O sentido pedido chega ao arrange: sem isso, a seta do cabeçalho
            # troca na tela e a lista volta igual, que é como a falha aparece.
            natural = [row["cells"]["mr"]["label"] for row in fetch("since=0&sort=mr")["rows"]]
            invertida = [row["cells"]["mr"]["label"]
                         for row in fetch("since=0&sort=mr&direction=desc")["rows"]]
            self.assertEqual(invertida, list(reversed(natural)))
            # O sentido natural de "mr" é asc: pedi-lo não muda nada.
            self.assertEqual([row["cells"]["mr"]["label"]
                              for row in fetch("since=0&sort=mr&direction=asc")["rows"]],
                             natural)
            # Sentido que não existe cai no natural, em vez de derrubar a rota.
            self.assertEqual([row["cells"]["mr"]["label"]
                              for row in fetch("since=0&sort=mr&direction=inventado")["rows"]],
                             natural)
        finally:
            server.shutdown()
            server.server_close()

    def test_created_column_is_the_last_one(self):
        ultima = monitor.REPORT_COLUMNS[-1]
        self.assertEqual((ultima.key, ultima.label), ("created_label", "Criado"))
        # Atualizado em fica imediatamente à esquerda de Criado em.
        penultima = monitor.REPORT_COLUMNS[-2]
        self.assertEqual((penultima.key, penultima.label), ("updated_label", "Atualizado"))
        self.assertEqual(monitor.REPORT_COLUMNS[-3].key, "pipeline")
        row = monitor.report_row(
            self.mr(1, "backend", "t", "ana.lima", 0, created="2026-10-19T17:45:00Z"), [])
        self.assertEqual(row["created_label"], "19/10/2026")
        self.assertEqual(monitor.serialize_row(row)["cells"]["created_label"]["label"],
                         "19/10/2026")
        semdata = monitor.report_row(self.mr(1, "backend", "t", "ana.lima", 0, created=None), [])
        self.assertEqual(semdata["created_label"], "—")

    def test_updated_label_is_relative_like_the_gitlab_page(self):
        # "updated 3 hours ago" da própria página do GitLab, só que em pt-BR;
        # a hora exata do relógio real não importa, só a distância até agora.
        agora = monitor.datetime.now(monitor.timezone.utc)
        duas_horas_atras = (agora - timedelta(hours=2)).isoformat()
        row = monitor.report_row(
            self.mr(1, "backend", "t", "ana.lima", 0, updated=duas_horas_atras), [])
        self.assertEqual(row["updated_label"], "há 2 horas")
        payload = monitor.serialize_row(row)["cells"]["updated_label"]
        self.assertEqual(payload["label"], "há 2 horas")
        self.assertIsNotNone(payload["title"])
        # updated=None no fabricador espelha o created (mesma conveniência de
        # created=None); "sem dado nenhum" é um updated_at ausente de verdade.
        sem_dado = dict(self.mr(1, "backend", "t", "ana.lima", 0), updated_at=None)
        semdata = monitor.report_row(sem_dado, [])
        self.assertEqual(semdata["updated_label"], "—")
        self.assertIsNone(
            monitor.serialize_row(semdata)["cells"]["updated_label"]["title"])

    def test_relative_time_matches_gitlab_granularity(self):
        base = monitor.datetime(2026, 10, 29, 12, 0, tzinfo=monitor.timezone.utc)
        casos = [
            (0, "agora mesmo"), (59, "agora mesmo"),
            (60, "há 1 minuto"), (120, "há 2 minutos"), (3599, "há 59 minutos"),
            (3600, "há 1 hora"), (7200, "há 2 horas"), (86399, "há 23 horas"),
            (86400, "há 1 dia"), (172800, "há 2 dias"),
            (30 * 86400, "há 1 mês"), (60 * 86400, "há 2 meses"),
            (365 * 86400, "há 1 ano"), (2 * 365 * 86400, "há 2 anos"),
        ]
        for segundos, esperado in casos:
            with self.subTest(segundos=segundos):
                momento = base - timedelta(seconds=segundos)
                self.assertEqual(monitor.relative_time(momento, now=base), esperado)
        self.assertEqual(monitor.relative_time(monitor.EPOCH, now=base), "—")

    @unittest.skipUnless((monitor.FRONTEND_DIST / "index.html").is_file(),
                        "requer o build do frontend (make front-build)")
    def test_caminho_de_pagina_cai_no_index_do_build(self):
        # /settings não é arquivo: recarregar a página não pode dar 404.
        self.assertEqual(served_path("/settings"), "index.html")

    @unittest.skipUnless((monitor.FRONTEND_DIST / "index.html").is_file(),
                        "requer o build do frontend (make front-build)")
    def test_caminho_de_arquivo_inexistente_continua_404(self):
        self.assertIsNone(served_path("/assets/i18n/xx.json"))

    @unittest.skipUnless((monitor.FRONTEND_DIST / "index.html").is_file(),
                        "requer o build do frontend (make front-build)")
    def test_server_serves_the_build_and_page_routes(self):
        state = monitor.panel_state(["g%2Fp"], 15)
        state["rows"] = self.rows
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            monitor.panel_handler(state, "https://gitlab.example/api/v4", threading.Event()))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address[0], server.server_address[1]
            # "/" e "/index.html" servem o build do Angular (frontend/dist/...);
            # quem monta a página com os dados é o Angular, consumindo /data.
            for path in ("/", "/index.html"):
                with self.subTest(path=path):
                    connection = HTTPConnection(host, port, timeout=5)
                    connection.request("GET", path)
                    response = connection.getresponse()
                    self.assertEqual(response.status, 200)
                    self.assertIn("<app-root>", response.read().decode("utf-8"))
                    connection.close()
            connection = HTTPConnection(host, port, timeout=5)
            connection.request("GET", "/data")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertIn("BE #199", response.read().decode("utf-8"))
            connection.close()
            # "/../gitlab_monitor.py" tenta escapar de FRONTEND_DIST: bloqueado.
            # "/outra" não tem ponto: é rota do Angular, então cai no index.
            connection = HTTPConnection(host, port, timeout=5)
            connection.request("GET", "/outra")
            response = connection.getresponse()
            self.assertEqual(response.status, 200)
            self.assertIn("<app-root>", response.read().decode("utf-8"))
            connection.close()
            for path in ("/assets/i18n/xx.json", "/../gitlab_monitor.py"):
                with self.subTest(path=path):
                    connection = HTTPConnection(host, port, timeout=5)
                    connection.request("GET", path)
                    response = connection.getresponse()
                    self.assertEqual(response.status, 404)
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
        state = monitor.panel_state(["alvo%2Fp"], 15)
        wake = threading.Event()
        status, data = self.settings_request(state, {}, path="/refresh", wake=wake)
        self.assertEqual((status, data), (200, {"ok": True}))
        self.assertTrue(wake.is_set())
        # O alvo e o intervalo seguem intactos: o botão só adianta o ciclo.
        self.assertEqual((state["targets"], state["interval"]), (["alvo%2Fp"], 15))

    def test_refresh_refuses_cross_origin_and_non_json_requests(self):
        state = monitor.panel_state(["alvo%2Fp"], 15)
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
        state = monitor.panel_state(["alvo%2Fp"], 15)
        status, _ = self.settings_request(state, {}, path="/qualquer")
        self.assertEqual(status, 404)

    def test_settings_override_env_values_only_in_memory(self):
        state = monitor.panel_state(["antigo%2Fprojeto"], 15)
        with patch.object(monitor, "log"):
            status, _ = self.settings_request(
                state, {"projects": ["novo/projeto"], "interval": "3"})
        self.assertEqual(status, 200)
        self.assertEqual(state["targets"], ["novo%2Fprojeto"])
        self.assertEqual(state["interval"], 3)
        # Trocar de alvo zera a referência para não comparar projetos diferentes.
        self.assertEqual((state["rows"], state["updated"], state["events"]), ([], None, []))

    def test_settings_do_not_write_to_the_env_file(self):
        with tempfile.TemporaryDirectory() as directory:
            env = Path(directory) / ".env"
            original = "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\nPROJECT=antigo/p\nINTERVAL=15\n"
            env.write_text(original, encoding="utf-8")
            state = monitor.panel_state(["antigo%2Fp"], 15)
            with patch.object(monitor, "ROOT", Path(directory)), patch.object(monitor, "log"):
                self.settings_request(state, {"projects": ["novo/p"], "interval": "2"})
            self.assertEqual(env.read_text(encoding="utf-8"), original)

    def test_settings_reject_invalid_values_and_keep_the_previous_target(self):
        cases = ({"projects": [], "interval": "5"},
                 {"projects": ["sem-barra-nem-id"], "interval": "5"},
                 {"projects": ["g/p"], "interval": "zero"},
                 {"projects": ["g/p"], "interval": "0"},
                 {"projects": ["g/p"], "interval": "-4"},
                 {"projects": ["https://outro.example/g/p"], "interval": "5"})
        for payload in cases:
            with self.subTest(payload=payload):
                state = monitor.panel_state(["antigo%2Fp"], 15)
                with patch.object(monitor, "log"):
                    status, data = self.settings_request(state, payload)
                self.assertEqual(status, 400)
                self.assertTrue(data["error"])
                # O painel é pt-BR: é pelo code que ele escolhe o texto.
                self.assertIn(data["code"], ("no-targets", "invalid-target",
                                             "invalid-interval", "interval-not-positive"))
                self.assertEqual((state["targets"], state["interval"]), (["antigo%2Fp"], 15))

    def test_apply_settings_aceita_lista_e_descarta_duplicatas(self):
        state = monitor.panel_state(["antigo%2Fp"], 15)
        with patch.object(monitor, "log"):
            monitor.apply_settings(state, {"projects": ["g/p", "g/p", "groups/g"],
                                           "interval": "5"},
                                   "https://gitlab.example/api/v4", threading.Event())
        self.assertEqual(state["targets"], ["g%2Fp", "groups/g"])
        self.assertEqual(state["interval"], 5)

    def test_apply_settings_aceita_a_forma_canonica_que_projects_devolve(self):
        """O painel devolve o `value` de /projects; ele tem de voltar igual."""
        state = monitor.panel_state(["antigo%2Fp"], 15)
        with patch.object(monitor, "log"):
            monitor.apply_settings(state,
                                   {"projects": ["g%2Fp", "groups/g%2Fsub"],
                                    "interval": "5"},
                                   "https://gitlab.example/api/v4", threading.Event())
        self.assertEqual(state["targets"], ["g%2Fp", "groups/g%2Fsub"])

    def test_apply_settings_recusa_lista_vazia(self):
        state = monitor.panel_state(["antigo%2Fp"], 15)
        with self.assertRaisesRegex(ValueError, "at least one"):
            monitor.apply_settings(state, {"projects": [], "interval": "5"},
                                   "https://gitlab.example/api/v4", threading.Event())

    def test_apply_settings_recusa_mais_que_o_teto(self):
        state = monitor.panel_state(["antigo%2Fp"], 15)
        with self.assertRaisesRegex(ValueError, "at most 20") as recusa:
            monitor.apply_settings(state, {"projects": [f"g/p{n}" for n in range(21)],
                                           "interval": "5"},
                                   "https://gitlab.example/api/v4", threading.Event())
        self.assertEqual(recusa.exception.code, "too-many-targets")

    def test_meta_traz_os_alvos_sem_escape(self):
        snapshot = monitor.panel_snapshot(monitor.panel_state(["g%2Fp", "groups/g"], 15), 0)
        self.assertEqual(snapshot["meta"]["projects"], ["g/p", "groups/g"])
        self.assertNotIn("project", snapshot["meta"])

    def test_meta_traz_a_lista_de_alvos_que_falharam(self):
        snapshot = monitor.panel_snapshot(monitor.panel_state(["g%2Fp", "groups/g"], 15), 0)
        self.assertEqual(snapshot["meta"]["failed"], [])

    def test_meta_traz_tambem_a_forma_canonica_dos_alvos(self):
        # O rótulo não volta a ser alvo: é por estes valores que o painel
        # reconcilia a escolha guardada com o que o monitor de fato consulta.
        snapshot = monitor.panel_snapshot(monitor.panel_state(["g%2Fp", "groups/g"], 15), 0)
        self.assertEqual(snapshot["meta"]["targets"], ["g%2Fp", "groups/g"])

    def test_meta_esquece_a_falha_de_um_alvo_que_saiu_da_lista(self):
        state = monitor.panel_state(["g%2Fp", "groups/g"], 15)
        state["failed"] = ["groups/g"]
        monitor.apply_settings(state, {"projects": ["g/p"], "interval": "5"},
                               "https://gitlab.example/api/v4", threading.Event())
        self.assertEqual(monitor.panel_snapshot(state, 0)["meta"]["failed"], [])

    def test_preferred_targets_cai_no_padrao_em_valor_invalido(self):
        for raw in ({"monitoredProjects": "g/p"}, {"monitoredProjects": [1]},
                    {"monitoredProjects": ["../x"]}, {"monitoredProjects": []},
                    {"monitoredProjects": ["g%2Fp", "a\nb"]},
                    {"monitoredProjects": ["g%2Fp", ""]}):
            with self.subTest(raw=raw):
                self.assertEqual(monitor.preferred_targets(raw)[0], [])
        for raw in ({"interval": "x"}, {"interval": 0}, {"interval": -3},
                    {"interval": float("inf")}, {"interval": 10**400}, {}):
            with self.subTest(raw=raw):
                self.assertEqual(monitor.preferred_targets(raw)[1], 15)

    def test_preferred_targets_le_a_lista_valida(self):
        self.assertEqual(monitor.preferred_targets(
            {"monitoredProjects": ["g%2Fp"], "interval": 7}), (["g%2Fp"], 7.0))

    def test_preferred_targets_recusa_lista_acima_do_teto(self):
        raw = {"monitoredProjects": [f"g%2Fp{n}" for n in range(monitor.MAX_TARGETS + 1)]}
        self.assertEqual(monitor.preferred_targets(raw)[0], [])

    def test_preferred_targets_aceita_grupo_e_projeto_canonicos(self):
        raw = {"monitoredProjects": ["groups/g", "groups/a%2Fb", "g%2Fp", "12"]}
        self.assertEqual(monitor.preferred_targets(raw)[0],
                         ["groups/g", "groups/a%2Fb", "g%2Fp", "12"])

    def test_apply_settings_recusa_projects_que_nao_e_lista(self):
        for projects in ("g/p", {"a": 1}, None, 3):
            with self.subTest(projects=projects):
                state = monitor.panel_state(["antigo%2Fp"], 15)
                with self.assertRaisesRegex(ValueError, "at least one"):
                    monitor.apply_settings(state, {"projects": projects, "interval": "5"},
                                           "https://gitlab.example/api/v4", threading.Event())
                self.assertEqual(state["targets"], ["antigo%2Fp"])

    def test_apply_settings_recusa_entrada_que_nao_e_texto_ou_esta_em_branco(self):
        for projects in ([1], ["g/p", None], ["g/p", "   "], [""]):
            with self.subTest(projects=projects):
                state = monitor.panel_state(["antigo%2Fp"], 15)
                with self.assertRaisesRegex(ValueError, "non-empty string"):
                    monitor.apply_settings(state, {"projects": projects, "interval": "5"},
                                           "https://gitlab.example/api/v4", threading.Event())
                self.assertEqual(state["targets"], ["antigo%2Fp"])

    def test_serve_panel_varre_uma_copia_da_lista_do_estado(self):
        # Mutar no lugar a lista guardada no estado não pode mudar o que o
        # ciclo já recebeu para varrer.
        calls, box, done = [], {}, threading.Event()
        original = monitor.panel_state

        def capture(targets, interval):
            box["state"] = original(targets, interval)
            return box["state"]

        def scan(client, targets, previous):
            calls.append(targets)
            with box["state"]["lock"]:
                if len(calls) == 1:
                    box["state"]["targets"] = ["g%2Fq"]  # alvo novo: o ciclo o adota
                elif len(calls) == 2:
                    box["state"]["targets"].append("mutada")  # no lugar, sem trocar a lista
            if len(calls) == 3:
                done.set()
            return ({}, [], [], [])

        class Server:
            def __init__(self, address, handler):
                self.server_port = address[1]

            def serve_forever(self):
                done.wait(8)
                raise KeyboardInterrupt

            def server_close(self):
                pass

        with patch.object(monitor, "ThreadingHTTPServer", Server), \
             patch.object(monitor, "panel_handler"), patch.object(monitor, "announce"), \
             patch.object(monitor, "panel_state", side_effect=capture), \
             patch.object(monitor, "scan", side_effect=scan), patch.object(monitor, "log"):
            with self.assertRaises(KeyboardInterrupt):
                monitor.serve_panel(Mock(), ["g%2Fp"], 0.001, 8765)
        self.assertEqual(calls[1], ["g%2Fq"])

    def test_serve_panel_compara_alvos_por_valor_e_copia_a_lista(self):
        # Uma lista nova com o mesmo conteúdo não recomeça a referência, e
        # mutar a lista do estado não muda o que o ciclo em curso varre.
        calls, box, done = [], {}, threading.Event()
        original = monitor.panel_state

        def capture(targets, interval):
            box["state"] = original(targets, interval)
            return box["state"]

        def scan(client, targets, previous):
            calls.append((targets, previous))
            if len(calls) == 1:
                with box["state"]["lock"]:
                    box["state"]["targets"] = ["g%2Fp"]  # mesmo valor, outra identidade
            elif len(calls) == 2:
                done.set()
            return ({"g%2Fp": {"1": {}}}, [], [], [])

        class Server:
            def __init__(self, address, handler):
                self.server_port = address[1]

            def serve_forever(self):
                done.wait(5)
                raise KeyboardInterrupt

            def server_close(self):
                pass

        with patch.object(monitor, "ThreadingHTTPServer", Server), \
             patch.object(monitor, "panel_handler"), patch.object(monitor, "announce"), \
             patch.object(monitor, "panel_state", side_effect=capture), \
             patch.object(monitor, "scan", side_effect=scan), patch.object(monitor, "log"):
            with self.assertRaises(KeyboardInterrupt):
                monitor.serve_panel(Mock(), ["g%2Fp"], 0.001, 8765)
        self.assertEqual(calls[0][1], None)
        # Mesmo conteúdo em outra lista: a referência da primeira passagem segue.
        self.assertEqual(calls[1][1], {"g%2Fp": {"1": {}}})

    def test_serve_panel_carimba_no_estado_o_alvo_que_falhou(self):
        # Ciclo parcial: o painel continua "ok" (as linhas que vieram valem),
        # mas precisa dizer de quais alvos as linhas estão faltando.
        box, done = {}, threading.Event()
        original = monitor.panel_state

        def capture(targets, interval):
            box["state"] = original(targets, interval)
            return box["state"]

        def scan(client, targets, previous):
            done.set()
            return ({"g%2Fp": {"1": {}}}, [], [], ["groups/g"])

        class Server:
            def __init__(self, address, handler):
                self.server_port = address[1]

            def serve_forever(self):
                done.wait(5)
                raise KeyboardInterrupt

            def server_close(self):
                pass

        with patch.object(monitor, "ThreadingHTTPServer", Server), \
             patch.object(monitor, "panel_handler"), patch.object(monitor, "announce"), \
             patch.object(monitor, "panel_state", side_effect=capture), \
             patch.object(monitor, "scan", side_effect=scan), patch.object(monitor, "log"):
            with self.assertRaises(KeyboardInterrupt):
                monitor.serve_panel(Mock(), ["g%2Fp", "groups/g"], 0.001, 8765)
        state = box["state"]
        self.assertEqual(state["failed"], ["groups/g"])
        self.assertIsNone(state["error"])
        snapshot = monitor.panel_snapshot(state, 0)
        self.assertEqual(snapshot["meta"]["failed"], ["groups/g"])

    def test_settings_refuse_cross_origin_and_non_json_requests(self):
        state = monitor.panel_state(["antigo%2Fp"], 15)
        with patch.object(monitor, "log"):
            foreign, _ = self.settings_request(
                state, {"projects": ["g/p"], "interval": "5"},
                headers={"Content-Type": "application/json", "Origin": "https://malicioso.example"})
            form, _ = self.settings_request(
                state, None, headers={"Content-Type": "application/x-www-form-urlencoded"},
                body="projects=g/p&interval=5")
        self.assertEqual((foreign, form), (403, 415))
        self.assertEqual(state["targets"], ["antigo%2Fp"])

    def test_data_route_delivers_only_events_newer_than_since(self):
        state = monitor.panel_state(["g%2Fp"], 15)
        state["events"] = [{"id": 1, "kind": "likes", "text": "um"},
                           {"id": 2, "kind": "left", "text": "dois"}]
        state["sequence"] = 2
        # O evento sai inteiro, só sem o id interno da sequência.
        self.assertEqual(monitor.panel_snapshot(state, 0)["events"],
                         [{"kind": "likes", "text": "um"}, {"kind": "left", "text": "dois"}])
        self.assertEqual(monitor.panel_snapshot(state, 1)["events"],
                         [{"kind": "left", "text": "dois"}])
        self.assertEqual(monitor.panel_snapshot(state, 2)["events"], [])

    # A UI e o fluxo de permissão de notificação (caixa marcada por padrão,
    # pedido só após um gesto, aviso represado até a permissão chegar, limite
    # de notificações simultâneas, linha de dica própria) agora vivem no
    # Angular — ver frontend/src/app/services/notifications.spec.ts.

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

        def registrar(events, notifications=True, language="pt", gate=None):
            avisos.append(notifications)
            pronto.set()

        with patch.object(monitor, "ThreadingHTTPServer", Server), \
             patch.object(monitor, "announce", side_effect=registrar), \
             patch.object(monitor, "scan", return_value=({}, [{"kind": "left", "text": "evento"}], [], [])), \
             patch.object(monitor, "notify") as notify, patch.object(monitor, "log"):
            with self.assertRaises(KeyboardInterrupt):
                monitor.serve_panel(Mock(), ["g%2Fp"], 15, 8765)
        # Quem avisa na tela é o navegador; o notificador do sistema fica fora.
        self.assertTrue(avisos)
        self.assertNotIn(True, avisos)
        notify.assert_not_called()

    def test_serve_panel_passes_its_client_to_the_handler(self):
        # Sem o client, GET /projects responderia 503 no painel real.
        client = Mock()

        class Server:
            def __init__(self, address, handler):
                self.server_port = address[1]

            def serve_forever(self):
                raise KeyboardInterrupt

            def server_close(self):
                pass

        with patch.object(monitor, "ThreadingHTTPServer", Server), \
             patch.object(monitor, "panel_handler") as handler, \
             patch.object(monitor, "scan", return_value=({}, [], [], [])), \
             patch.object(monitor, "log"):
            with self.assertRaises(KeyboardInterrupt):
                monitor.serve_panel(client, ["g%2Fp"], 15, 8765)
        self.assertIs(handler.call_args.args[3], client)

    def test_web_mode_still_logs_the_events_in_the_terminal(self):
        with patch.object(monitor, "notify") as notify, patch.object(monitor, "log") as log:
            monitor.announce([{"kind": "left", "text": "!1 — um\nMESCLADO\nhttps://gitlab.example/1"}],
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
             patch.object(monitor, "report", return_value=([], [])), patch.object(monitor, "log"):
            with self.assertRaises(KeyboardInterrupt):
                monitor.serve_panel(Mock(), ["g%2Fp"], 15, 8765)
        self.assertEqual(captured["address"], ("127.0.0.1", 8765))

    def test_panel_notifies_changes_without_touching_history_or_lock(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(
                "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\n", encoding="utf-8")
            printed = []
            events = [{"kind": "left", "text": "!199 — um\nMESCLADO\nhttps://gitlab.example/199"}]
            passes = [({"199": {}}, [], self.rows, []),          # referência inicial, sem evento
                      ({"199": {"x": 1}}, events, self.rows, [])]  # mudança detectada
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
            passes = [({"1": {}}, [{"kind": "left", "text": "evento"}], self.rows, [])]
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
                (subprocess.CalledProcessError(1, "helper", stderr=b"ParserError / DBus ServiceUnknown"), "exit code 1", "ServiceUnknown"),
                (subprocess.TimeoutExpired("helper", 45), "timeout", None),
                (OSError("Access denied"), "start notifier", "Access denied"),
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
                 patch.object(monitor, "collect", side_effect=[({"1": {}}, []), ({"1": {"changed": True}}, [{"kind": "left", "text": "Evento"}]), ({"1": {"changed": True}}, [])]) as collect, \
                 patch.object(monitor.time, "sleep", side_effect=[None, None, KeyboardInterrupt]):
                self.assertEqual(monitor.main(), 0)
                self.assertEqual(collect.call_count, 3)
                self.assertEqual(run.call_count, 1)
                self.assertEqual(collect.call_args.args[2], {"1": {"changed": True}})


class PreferenciasDeTerminalTests(unittest.TestCase):
    def settings(self, argv=(), preferences=None, env=None, tty=False):
        args = monitor.build_parser().parse_args(list(argv))
        with patch.object(monitor.sys.stdout, "isatty", return_value=tty), \
             patch.dict(monitor.os.environ, env or {}, clear=False):
            return monitor.terminal_settings(args, preferences or {})

    def test_flag_vence_o_arquivo(self):
        found = self.settings(["--sort", "likes", "--direction", "asc", "--language", "en",
                               "--author", "ana", "--pipeline", "failed", "--review", "assigned",
                               "--interval", "3"],
                              {"filters": {"sort": "author", "direction": "desc",
                                           "author": ["bia"], "pipeline": ["success"],
                                           "review": ["reviewing"]},
                               "language": "pt", "interval": 30})
        self.assertEqual(found.sort, "likes")
        self.assertEqual(found.direction, "asc")
        self.assertEqual(found.language, "en")
        self.assertEqual(found.authors, ("ana",))
        self.assertEqual(found.pipelines, ("failed",))
        self.assertEqual(found.review, ("assigned",))
        self.assertEqual(found.interval, 3.0)

    def test_a_precedencia_vale_campo_a_campo(self):
        # Só --sort vem da linha de comando; o resto continua vindo do arquivo.
        found = self.settings(["--sort", "likes"],
                              {"filters": {"sort": "author", "direction": "desc",
                                           "author": ["bia"]}, "likesHighlight": 5})
        self.assertEqual(found.sort, "likes")
        self.assertEqual(found.direction, "desc")
        self.assertEqual(found.authors, ("bia",))
        self.assertEqual(found.likes_highlight, 5)

    def test_arquivo_vence_o_padrao(self):
        found = self.settings(preferences={
            "filters": {"sort": "author", "direction": "desc", "author": ["bia"],
                        "pipeline": ["failed", monitor.NO_PIPELINE], "review": ["reviewing"]},
            "hiddenColumns": ["likes"], "columnOrder": ["mr", "author"],
            "likesHighlight": 7, "language": "en", "interval": 5,
            "rowRules": [{"field": "likes", "operator": "gte", "tone": "danger",
                          "value": "3", "enabled": True}],
            "notifyRules": {"minLikes": 2}})
        self.assertEqual((found.sort, found.direction), ("author", "desc"))
        self.assertEqual(found.authors, ("bia",))
        self.assertEqual(found.pipelines, ("failed", monitor.NO_PIPELINE))
        self.assertEqual(found.review, ("reviewing",))
        self.assertEqual(found.hidden_columns, ("likes",))
        self.assertEqual(found.column_order, ("mr", "author"))
        self.assertEqual(found.likes_highlight, 7)
        self.assertEqual(found.language, "en")
        self.assertEqual(found.interval, 5.0)
        self.assertEqual(len(found.row_rules), 1)
        self.assertEqual(found.notify_rules["minLikes"], 2)

    def test_sem_flag_e_sem_arquivo_vale_o_padrao(self):
        found = self.settings()
        self.assertEqual(found.targets, [])
        self.assertEqual(found.interval, float(monitor.DEFAULT_INTERVAL))
        self.assertEqual(found.sort, monitor.SORTS[0].key)
        self.assertIsNone(found.direction)
        self.assertEqual((found.authors, found.pipelines, found.review), ((), (), ()))
        self.assertEqual((found.hidden_columns, found.column_order), ((), ()))
        self.assertEqual(found.likes_highlight, 0)
        self.assertEqual(found.row_rules, [])
        self.assertEqual(found.language, "pt")

    def test_no_prefs_ignora_o_arquivo_inteiro(self):
        found = self.settings(["--no-prefs"], {
            "monitoredProjects": ["g%2Fp"], "interval": 2, "language": "en",
            "likesHighlight": 9, "hiddenColumns": ["likes"],
            "filters": {"sort": "author", "direction": "desc", "author": ["bia"]}})
        self.assertEqual(found.targets, [])
        self.assertEqual(found.interval, float(monitor.DEFAULT_INTERVAL))
        self.assertEqual(found.sort, monitor.SORTS[0].key)
        self.assertIsNone(found.direction)
        self.assertEqual(found.authors, ())
        self.assertEqual(found.language, "pt")
        self.assertEqual(found.likes_highlight, 0)
        self.assertEqual(found.hidden_columns, ())

    def test_no_prefs_ainda_aceita_as_flags(self):
        found = self.settings(["--no-prefs", "--sort", "likes", "g/p"],
                              {"filters": {"sort": "author"}})
        self.assertEqual(found.sort, "likes")
        self.assertEqual(found.targets, ["g%2Fp"])

    def test_sort_desconhecido_no_arquivo_cai_no_primeiro(self):
        found = self.settings(preferences={"filters": {"sort": "extinto"}})
        self.assertEqual(found.sort, monitor.SORTS[0].key)

    def test_direction_fora_de_asc_desc_e_o_natural(self):
        for value in ("up", "", None, 3, ["asc"]):
            with self.subTest(value=value):
                self.assertIsNone(
                    self.settings(preferences={"filters": {"direction": value}}).direction)

    def test_review_desconhecido_e_descartado_sem_derrubar_os_validos(self):
        found = self.settings(preferences={
            "filters": {"review": ["assigned", "extinto", 3, "unassigned"]}})
        self.assertEqual(found.review, ("assigned", "unassigned"))

    def test_campo_invalido_nao_derruba_os_vizinhos(self):
        found = self.settings(preferences={
            "filters": {"sort": 5, "author": "ana", "pipeline": ["failed", 7]},
            "likesHighlight": -1, "language": "fr", "hiddenColumns": "likes",
            "columnOrder": ["mr", 3, "mr", "author"], "interval": "x"})
        self.assertEqual(found.sort, monitor.SORTS[0].key)
        self.assertEqual(found.authors, ())
        self.assertEqual(found.pipelines, ("failed",))
        self.assertEqual(found.likes_highlight, 0)
        self.assertEqual(found.language, "pt")
        self.assertEqual(found.hidden_columns, ())
        self.assertEqual(found.column_order, ("mr", "author"))
        self.assertEqual(found.interval, float(monitor.DEFAULT_INTERVAL))

    def test_likes_highlight_e_inteiro_nao_negativo(self):
        for value, expected in ((0, 0), (4, 4), (-2, 0), (True, 0), (2.5, 0), ("3", 0)):
            with self.subTest(value=value):
                self.assertEqual(
                    self.settings(preferences={"likesHighlight": value}).likes_highlight,
                    expected)

    def test_alvos_vem_do_arquivo_quando_nao_ha_posicional_nem_flag(self):
        found = self.settings(preferences={"monitoredProjects": ["g%2Fp", "g%2Fq"]})
        self.assertEqual(found.targets, ["g%2Fp", "g%2Fq"])

    def test_alvos_do_arquivo_sao_tudo_ou_nada(self):
        found = self.settings(preferences={"monitoredProjects": ["g%2Fp", ""],
                                           "filters": {"sort": "likes"}})
        self.assertEqual(found.targets, [])
        self.assertEqual(found.sort, "likes")

    def test_posicional_e_project_vencem_os_alvos_do_arquivo(self):
        prefs = {"monitoredProjects": ["arquivo%2Fp"]}
        self.assertEqual(self.settings(["g/p"], prefs).targets, ["g%2Fp"])
        self.assertEqual(self.settings(["--project", "g/q"], prefs).targets, ["g%2Fq"])
        self.assertEqual(self.settings(["g/p", "--project", "g/q", "--project", "g/p"],
                                       prefs).targets, ["g%2Fp", "g%2Fq"])

    def test_project_repetido_acumula_ate_o_MAX_TARGETS(self):
        argv = [item for number in range(monitor.MAX_TARGETS)
                for item in ("--project", f"g/p{number}")]
        self.assertEqual(len(self.settings(argv).targets), monitor.MAX_TARGETS)

    def test_acima_do_MAX_TARGETS_e_erro_de_linha_de_comando(self):
        argv = [item for number in range(monitor.MAX_TARGETS + 1)
                for item in ("--project", f"g/p{number}")]
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(
                "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\n", encoding="utf-8")
            stderr = StringIO()
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor", "--mode", "relatorio", *argv]), \
                 patch.object(monitor, "GitLab") as gitlab, patch.object(monitor, "log"), \
                 patch.object(monitor.sys, "stderr", stderr):
                with self.assertRaises(SystemExit) as raised:
                    monitor.main()
        self.assertEqual(raised.exception.code, 2)
        self.assertIn(str(monitor.MAX_TARGETS), stderr.getvalue())
        gitlab.assert_not_called()

    def test_modo_terminal_sem_alvo_e_sem_preferencia_continua_sendo_erro(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(
                "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\n", encoding="utf-8")
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor", "--mode", "relatorio"]), \
                 patch.object(monitor, "GitLab"), patch.object(monitor, "log"), \
                 patch.object(monitor.sys, "stderr", StringIO()):
                with self.assertRaises(SystemExit) as raised:
                    monitor.main()
        self.assertEqual(raised.exception.code, 2)

    def test_modo_terminal_usa_os_alvos_guardados_pelo_painel(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(
                "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\n", encoding="utf-8")
            monitor.PREFERENCES_FILE.write_text(json.dumps(
                {"version": 1, "preferences": {"monitoredProjects": ["g%2Fp", "g%2Fq"]}}),
                encoding="utf-8")
            self.addCleanup(monitor.PREFERENCES_FILE.unlink)
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor", "--mode", "relatorio"]), \
                 patch.object(monitor, "GitLab"), patch.object(monitor, "log"), \
                 patch.object(monitor, "report", return_value=([], [])) as report, \
                 patch("builtins.print"):
                self.assertEqual(monitor.main(), 0)
        self.assertEqual(report.call_args.args[1], ["g%2Fp", "g%2Fq"])

    def test_cor_segue_o_terminal_e_o_NO_COLOR(self):
        env = {k: v for k, v in monitor.os.environ.items() if k != "NO_COLOR"}
        with patch.dict(monitor.os.environ, env, clear=True):
            self.assertTrue(self.settings(tty=True).color)
            self.assertFalse(self.settings(tty=False).color)
            self.assertFalse(self.settings(tty=True, env={"NO_COLOR": "1"}).color)

    def test_color_e_no_color_forcam_a_cor(self):
        env = {k: v for k, v in monitor.os.environ.items() if k != "NO_COLOR"}
        with patch.dict(monitor.os.environ, env, clear=True):
            self.assertTrue(self.settings(["--color"], tty=False).color)
            self.assertTrue(self.settings(["--color"], tty=True, env={"NO_COLOR": "1"}).color)
            self.assertFalse(self.settings(["--no-color"], tty=True).color)

    def test_flag_invalida_e_recusada_pelo_parser(self):
        for argv in (["--sort", "extinto"], ["--direction", "up"],
                     ["--review", "extinto"], ["--language", "fr"]):
            with self.subTest(argv=argv), patch.object(monitor.sys, "stderr", StringIO()):
                with self.assertRaises(SystemExit):
                    monitor.build_parser().parse_args(argv)

    # Foco de revisão 1: preferência ruim nunca derruba nem cala o modo terminal.
    def test_preferences_ilegivel_nao_derruba_o_modo_terminal(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(
                "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\n", encoding="utf-8")
            monitor.PREFERENCES_FILE.write_text("{ isto não é json", encoding="utf-8")
            built = [monitor.report_row(
                {"iid": 1, "state": "opened", "title": "um", "web_url": "https://g/1",
                 "upvotes": 0, "head_pipeline": None, "author": {"username": "ana.lima"},
                 "created_at": "2026-10-01T10:00:00.000Z",
                 "updated_at": "2026-10-01T10:00:00.000Z", "project_id": 1,
                 "mergeable": True, "conflicts": False, "likers": [],
                 "assignees": [], "reviewers": []}, [])]
            printed = []
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor", "g/p", "--mode", "relatorio"]), \
                 patch.object(monitor, "GitLab"), patch.object(monitor, "log"), \
                 patch.object(monitor, "report", return_value=(built, [])), \
                 patch("builtins.print", side_effect=lambda *a, **k: printed.append(a)):
                self.assertEqual(monitor.main(), 0)
            self.assertTrue(any("ana.lima" in str(call) for call in printed))
            # O arquivo ruim foi posto de lado, não apagado.
            self.assertTrue(list(monitor.PREFERENCES_FILE.parent.glob("preferences.corrupt-*")))
            for leftover in monitor.PREFERENCES_FILE.parent.glob("preferences.corrupt-*"):
                self.addCleanup(leftover.unlink)

    def test_preferences_de_versao_desconhecida_nao_derruba_o_modo_terminal(self):
        monitor.PREFERENCES_FILE.write_text(
            json.dumps({"version": 99, "preferences": {"language": "en"}}), encoding="utf-8")
        self.addCleanup(monitor.PREFERENCES_FILE.unlink, missing_ok=True)
        with patch.object(monitor, "log"):
            document = monitor.load_preferences()
        found = monitor.terminal_settings(
            monitor.build_parser().parse_args([]), document["preferences"])
        self.assertEqual(found.language, "pt")
        for leftover in monitor.PREFERENCES_FILE.parent.glob("preferences.corrupt-*"):
            self.addCleanup(leftover.unlink)

    def test_preferences_ausente_usa_os_padroes(self):
        self.assertFalse(monitor.PREFERENCES_FILE.exists())
        document = monitor.load_preferences()
        found = monitor.terminal_settings(
            monitor.build_parser().parse_args([]), document["preferences"])
        self.assertEqual(found.sort, monitor.SORTS[0].key)
        self.assertEqual(found.targets, [])

    def test_preferencias_que_nao_sao_objeto_nao_derrubam(self):
        for garbage in (None, [], "x", 3):
            with self.subTest(garbage=garbage):
                found = monitor.terminal_settings(
                    monitor.build_parser().parse_args([]), garbage)
                self.assertEqual(found.language, "pt")


class RelatorioDoTerminalTests(unittest.TestCase):
    """O que `relatorio` desenha, de report_row() até o texto impresso."""

    def settings(self, preferences, argv=()):
        args = monitor.build_parser().parse_args(list(argv))
        with patch.object(monitor.sys.stdout, "isatty", return_value=False):
            return monitor.terminal_settings(args, preferences)

    def linhas(self):
        quente = monitor.report_row(merge_request(1, "backend", "quente", "ana.lima", 6, status="failed"), [])
        frio = monitor.report_row(merge_request(2, "backend", "frio", "bia.souza", 0, status="success"), [])
        return [quente, frio]

    def test_regra_de_destaque_casa_com_linha_real_de_report_row(self):
        # O fato `likes` é o número de upvotes; a célula "likes" é o texto "6 👍".
        # Se o `facts` não chegasse à linha, nenhuma regra casaria, em silêncio.
        settings = self.settings({"rowRules": [{"field": "likes", "operator": "gte",
                                                "tone": "danger", "value": "3",
                                                "enabled": True}]})
        desenho = monitor.render_report(self.linhas(), settings, width=200, links=False)
        marcados = [linha for linha in desenho.splitlines() if monitor_table.ROW_MARKS["danger"] in linha]
        self.assertEqual(len(marcados), 1)
        self.assertIn("quente", marcados[0])

    def test_a_linha_desenhavel_traz_os_facts_e_mantem_o_resto(self):
        linha = monitor.drawable_row(self.linhas()[0])
        self.assertEqual(linha["facts"]["likes"], 6)
        self.assertEqual(linha["facts"]["pipeline"], "failed")
        self.assertIn("quente", linha["mr"])
        self.assertEqual(linha["pipeline_tone"], "danger")

    def test_ordenacao_filtro_e_resumo_vem_das_preferencias(self):
        settings = self.settings({"filters": {"sort": "likes", "author": ["bia.souza"]}})
        desenho = monitor.render_report(self.linhas(), settings, width=200, links=False)
        primeira, *resto = desenho.splitlines()
        self.assertEqual(primeira, "2 aberto(s) · mostrando 1 de 2 · 1 com pipeline falha")
        self.assertIn("frio", desenho)
        self.assertNotIn("quente", desenho)

    def test_ordenacao_da_preferencia_muda_a_ordem_das_linhas(self):
        mais_novo = monitor.report_row(merge_request(3, "backend", "novo", "ana.lima", 0,
                                                     created="2026-10-05T10:00:00.000Z"), [])
        rows = [*self.linhas(), mais_novo]
        por_likes = monitor.render_report(rows, self.settings({"filters": {"sort": "likes"}}),
                                          width=200, links=False)
        self.assertLess(por_likes.index("quente"), por_likes.index("novo"))
        # --sort da linha de comando vence o arquivo; "recent" põe o mais novo antes.
        recentes = monitor.render_report(rows, self.settings({"filters": {"sort": "likes"}},
                                                             ["--sort", "recent"]),
                                         width=200, links=False)
        self.assertLess(recentes.index("novo"), recentes.index("quente"))

    def test_coluna_oculta_e_ordem_chegam_ao_desenho(self):
        settings = self.settings({"hiddenColumns": ["pipeline"], "columnOrder": ["author", "mr"]})
        cabecalho = monitor.render_report(self.linhas(), settings, width=200,
                                          links=False).splitlines()[2]
        self.assertNotIn("Pipeline", cabecalho)
        self.assertLess(cabecalho.index("Autor"), cabecalho.index("MR"))

    def test_cor_chega_ao_desenho_e_sem_cor_nao_ha_escape(self):
        com = monitor.render_report(self.linhas(), self.settings({}, ["--color"]),
                                    width=200, links=False)
        sem = monitor.render_report(self.linhas(), self.settings({}), width=200, links=False)
        self.assertIn("\033[", com)
        self.assertNotIn("\033", sem)

    def test_idioma_chega_ao_resumo(self):
        desenho = monitor.render_report(self.linhas(), self.settings({"language": "en"}),
                                        width=200, links=False)
        self.assertTrue(desenho.startswith("2 open · 1 with a failed pipeline"))

    def test_o_limite_de_likes_chega_a_report_row_pela_coleta(self):
        client = Client([row(1, likes=6)], [])
        settings = self.settings({"likesHighlight": 7})
        self.assertIsNone(monitor.report(client, ["1"], settings.likes_highlight)[0][0]["likes_tone"])
        client = Client([row(1, likes=6)], [])
        self.assertEqual(monitor.report(client, ["1"], 5)[0][0]["likes_tone"], "strong")

    def test_lista_vazia_imprime_so_o_resumo(self):
        self.assertEqual(monitor.render_report([], self.settings({})), "0 aberto(s)")


class PreferencesTests(unittest.TestCase):
    def setUp(self):
        self.dir = Path(tempfile.mkdtemp())
        self.file = self.dir / "preferences.json"
        patcher = patch.object(monitor, "PREFERENCES_FILE", self.file)
        patcher.start()
        self.addCleanup(patcher.stop)
        self.addCleanup(shutil.rmtree, self.dir, True)

    def http(self, method, path, payload=None, headers=None, body=None, client=None):
        state = monitor.panel_state(["alvo%2Fp"], 15)
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            monitor.panel_handler(state, "https://gitlab.example/api/v4",
                                  threading.Event(), client))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            host, port = server.server_address
            connection = HTTPConnection(host, port, timeout=5)
            data = body if body is not None else (
                json.dumps(payload) if payload is not None else None)
            connection.request(method, path, body=data, headers=headers or {})
            response = connection.getresponse()
            text = response.read().decode("utf-8")
            try:
                parsed = json.loads(text)
            except ValueError:
                parsed = text
            connection.close()
            return response.status, parsed
        finally:
            server.shutdown()
            server.server_close()

    def test_missing_file_loads_empty(self):
        self.assertEqual(monitor.load_preferences(),
                         {"version": 1, "preferences": {}})

    def test_store_then_load_round_trip(self):
        doc = {"version": 1, "preferences": {"theme": "dark", "rowRules": [{"id": "a"}]}}
        monitor.store_preferences(doc)
        self.assertEqual(monitor.load_preferences(), doc)

    def test_unknown_keys_are_dropped(self):
        stored = monitor.store_preferences(
            {"version": 1, "preferences": {"token": "x", "theme": "dark"}})
        self.assertEqual(stored["preferences"], {"theme": "dark"})

    def test_first_paint_value_outside_the_list_is_dropped(self):
        stored = monitor.store_preferences(
            {"version": 1, "preferences": {"theme": "\"><script>", "language": "fr"}})
        self.assertEqual(stored["preferences"], {})

    def test_corrupt_file_is_moved_aside_not_overwritten(self):
        self.file.write_text("{quebrado", encoding="utf-8")
        with patch.object(monitor, "log") as log:
            self.assertEqual(monitor.load_preferences()["preferences"], {})
        self.assertFalse(self.file.exists())
        aside = list(self.dir.glob("preferences.corrupt-*.json"))
        self.assertEqual(len(aside), 1)
        self.assertEqual(aside[0].read_text(encoding="utf-8"), "{quebrado")
        self.assertIn(aside[0].name, log.call_args.args[0])

    def test_non_utf8_file_is_moved_aside(self):
        self.file.write_bytes(b"\xff\xfe")
        with patch.object(monitor, "log"):
            self.assertEqual(monitor.load_preferences(),
                             {"version": 1, "preferences": {}})
        self.assertFalse(self.file.exists())
        aside = list(self.dir.glob("preferences.corrupt-*.json"))
        self.assertEqual(len(aside), 1)
        self.assertEqual(aside[0].read_bytes(), b"\xff\xfe")

    def test_deeply_nested_file_is_moved_aside(self):
        self.file.write_text("[" * 100000, encoding="utf-8")
        with patch.object(monitor, "log"):
            self.assertEqual(monitor.load_preferences(),
                             {"version": 1, "preferences": {}})
        self.assertFalse(self.file.exists())
        self.assertEqual(len(list(self.dir.glob("preferences.corrupt-*.json"))), 1)

    def test_file_with_nan_or_infinity_is_moved_aside(self):
        for literal in ("NaN", "Infinity", "-Infinity"):
            self.file.write_text(
                '{"version": 1, "preferences": {"rowRules": [%s]}}' % literal,
                encoding="utf-8")
            with patch.object(monitor, "log"):
                self.assertEqual(monitor.load_preferences()["preferences"], {})
            self.assertFalse(self.file.exists())
        self.assertEqual(len(list(self.dir.glob("preferences.corrupt-*.json"))), 3)

    def test_store_rejects_non_finite_numbers(self):
        with self.assertRaises(ValueError):
            monitor.store_preferences(
                {"version": 1, "preferences": {"rowRules": [float("nan")]}})
        self.assertFalse(self.file.exists())

    def test_post_rejects_nan_and_infinity_with_400(self):
        headers = {"Content-Type": "application/json"}
        for literal in ("NaN", "Infinity", "-Infinity"):
            status, data = self.http(
                "POST", "/preferences", headers=headers,
                body='{"version": 1, "preferences": {"rowRules": [%s]}}' % literal)
            self.assertEqual(status, 400)
            self.assertIn("error", data)
        self.assertFalse(self.file.exists())

    @staticmethod
    def fake_gitlab(projects=(), groups=(), error=None):
        # GitLab de mentira: só o que `memberships` consome, sem rede.
        client = monitor.GitLab("https://gitlab.example/api/v4", "token-de-teste")

        def pages(path, **params):
            if error:
                raise RuntimeError(error)
            return iter(projects if path.startswith("/projects") else groups)
        client.pages = pages
        return client

    def test_memberships_lista_grupos_antes_de_projetos(self):
        client = self.fake_gitlab(
            projects=[{"path_with_namespace": "g/b"}, {"path_with_namespace": "g/a"}],
            groups=[{"full_path": "z"}, {"full_path": "g"}])
        self.assertEqual(client.memberships(), [
            {"value": "groups/g", "label": "g", "kind": "group"},
            {"value": "groups/z", "label": "z", "kind": "group"},
            {"value": "g%2Fa", "label": "g/a", "kind": "project"},
            {"value": "g%2Fb", "label": "g/b", "kind": "project"},
        ])

    def test_memberships_pede_cada_endpoint_com_uma_so_query(self):
        # Fake abaixo de `pages`: no `get`, para exercitar a URL de verdade.
        client = monitor.GitLab("https://gitlab.example/api/v4", "token-de-teste")
        urls = []

        def get(path, **params):
            url = client.base + path
            if params:
                url += "?" + monitor.urlencode(params)
            urls.append(url)
            return [], {}
        client.get = get
        client.memberships()
        self.assertEqual(len(urls), 2)
        for url in urls:
            self.assertEqual(url.count("?"), 1, url)
        groups, projects = (parse_qs(urlsplit(url).query) for url in urls)
        self.assertEqual(urlsplit(urls[0]).path, "/api/v4/groups")
        self.assertEqual(urlsplit(urls[1]).path, "/api/v4/projects")
        self.assertEqual(groups, {"min_access_level": ["10"], "per_page": ["100"], "page": ["1"]})
        self.assertEqual(projects, {"membership": ["true"], "simple": ["true"],
                                    "archived": ["false"], "per_page": ["100"], "page": ["1"]})

    def test_get_projects_com_resposta_malformada_responde_502(self):
        client = self.fake_gitlab(projects=[{"sem_caminho": 1}])
        status, body = self.http("GET", "/projects", client=client)
        self.assertEqual(status, 502)
        self.assertEqual(list(body), ["error"])

    def test_get_projects_com_linha_que_nao_e_dict_responde_502(self):
        # `row["full_path"]` levanta TypeError, não KeyError: sem ele na tupla
        # do except, a resposta morria no meio.
        client = self.fake_gitlab(groups=["texto"])
        status, body = self.http("GET", "/projects", client=client)
        self.assertEqual(status, 502)
        self.assertEqual(list(body), ["error"])

    def test_get_projects_devolve_a_lista(self):
        client = self.fake_gitlab(projects=[{"path_with_namespace": "g/b"}],
                                  groups=[{"full_path": "g"}])
        status, body = self.http("GET", "/projects", client=client)
        self.assertEqual(status, 200)
        self.assertEqual(body["targets"][0]["kind"], "group")

    def test_get_projects_sem_cliente_responde_503(self):
        status, body = self.http("GET", "/projects")
        self.assertEqual((status, body), (503, {"error": "Listing unavailable."}))

    def test_get_projects_com_falha_de_rede_responde_502_sem_vazar_o_token(self):
        message = "Connection to GitLab failed; previous state preserved."
        status, body = self.http("GET", "/projects", client=self.fake_gitlab(error=message))
        self.assertEqual((status, body), (502, {"error": message}))
        self.assertNotIn("token-de-teste", json.dumps(body))

    def test_post_deeply_nested_body_is_400(self):
        status, _ = self.http("POST", "/preferences",
                              headers={"Content-Type": "application/json"},
                              body="[" * 100000)
        self.assertEqual(status, 400)

    def test_oversized_post_closes_the_connection(self):
        state = monitor.panel_state(["alvo%2Fp"], 15)
        server = ThreadingHTTPServer(
            ("127.0.0.1", 0),
            monitor.panel_handler(state, "https://gitlab.example/api/v4", threading.Event()))
        threading.Thread(target=server.serve_forever, daemon=True).start()
        try:
            host, port = server.server_address
            connection = HTTPConnection(host, port, timeout=5)
            connection.request("POST", "/preferences",
                               body="x" * (monitor.PREFERENCES_MAX_BYTES + 1),
                               headers={"Content-Type": "application/json"})
            response = connection.getresponse()
            response.read()
            self.assertEqual(response.status, 413)
            self.assertEqual(response.getheader("Connection"), "close")
            connection.close()
        finally:
            server.shutdown()
            server.server_close()

    def test_post_preferences_reports_a_write_failure(self):
        with patch.object(monitor, "save", side_effect=OSError("disk full")), \
                patch.object(monitor, "log") as log:
            status, data = self.http(
                "POST", "/preferences", {"version": 1, "preferences": {"theme": "dark"}},
                headers={"Content-Type": "application/json"})
        self.assertEqual(status, 500)
        self.assertIn("error", data)
        self.assertNotIn("disk full", json.dumps(data))
        self.assertIn("OSError", log.call_args.args[0])

    def test_future_version_is_moved_aside(self):
        self.file.write_text('{"version": 2, "preferences": {}}', encoding="utf-8")
        with patch.object(monitor, "log"):
            monitor.load_preferences()
        self.assertEqual(len(list(self.dir.glob("preferences.corrupt-*.json"))), 1)

    def test_aside_name_never_overwrites_an_earlier_one(self):
        with patch.object(monitor, "log"):
            for _ in range(2):
                self.file.write_text("{quebrado", encoding="utf-8")
                monitor.load_preferences()
        self.assertEqual(len(list(self.dir.glob("preferences.corrupt-*.json"))), 2)

    def test_store_rejects_wrong_version_and_non_object(self):
        for bad in ({"version": 2, "preferences": {}}, {"version": 1, "preferences": []}, []):
            with self.assertRaises(ValueError):
                monitor.store_preferences(bad)

    def test_get_and_post_preferences_over_http(self):
        status, _ = self.http(
            "POST", "/preferences", {"version": 1, "preferences": {"density": "compact"}},
            headers={"Content-Type": "application/json"})
        self.assertEqual(status, 200)
        status, data = self.http("GET", "/preferences")
        self.assertEqual(status, 200)
        self.assertEqual(data["version"], 1)
        self.assertEqual(data["preferences"], {"density": "compact"})
        self.assertEqual(data["file"], "user-data/preferences.json")

    def test_post_preferences_guards(self):
        json_header = {"Content-Type": "application/json"}
        valid = {"version": 1, "preferences": {"theme": "dark"}}
        foreign, _ = self.http("POST", "/preferences", valid, headers={
            **json_header, "Origin": "http://evil.example"})
        plain, _ = self.http("POST", "/preferences", valid,
                             headers={"Content-Type": "text/plain"})
        big, _ = self.http("POST", "/preferences", headers=json_header,
                           body="x" * (monitor.PREFERENCES_MAX_BYTES + 1))
        bad, data = self.http("POST", "/preferences", {"version": 9}, headers=json_header)
        self.assertEqual((foreign, plain, big, bad), (403, 415, 413, 400))
        self.assertIn("error", data)
        self.assertFalse(self.file.exists())


    def test_first_paint_attributes_are_written_on_html(self):
        html = b'<!doctype html>\n<html lang="pt-BR">\n<head></head></html>'
        out = monitor.inject_first_paint(html, {"theme": "dark", "language": "en",
                                                "textSize": "lg", "density": "compact"})
        self.assertIn(b'<html lang="en" data-theme-choice="dark" data-language="en" '
                      b'data-text-size="lg" data-density="compact">', out)

    def test_first_paint_without_preferences_keeps_html(self):
        html = b'<html lang="pt-BR"><head></head></html>'
        self.assertEqual(monitor.inject_first_paint(html, {}), html)

    def test_first_paint_ignores_values_outside_the_list(self):
        out = monitor.inject_first_paint(b'<html lang="pt-BR"></html>', {"theme": '"><script>'})
        self.assertNotIn(b"script", out)

    @unittest.skipUnless((monitor.FRONTEND_DIST / "index.html").is_file(), "sem build")
    def test_served_index_carries_the_saved_theme(self):
        monitor.store_preferences({"version": 1, "preferences": {"theme": "dark"}})
        status, body = self.http("GET", "/settings")
        self.assertEqual(status, 200)
        self.assertIn('data-theme-choice="dark"', body)


class EventosDoTerminalTests(unittest.TestCase):
    """O `text` do evento é do painel e não muda; `key` e `params` são do terminal."""

    URL = "https://gitlab.example/g/p/-/merge_requests/{}"

    def eventos(self, previous_rows, current_rows, details=(), me=None, reviewing=False):
        before = {str(item["iid"]): monitor.snapshot(item, [], reviewing=reviewing)
                  for item in previous_rows}
        client = Client(current_rows, [*current_rows, *details], me=me)
        return monitor.collect(client, ["1"], {"1": before})[1]

    def test_o_text_do_evento_continua_identico_ao_de_hoje(self):
        # O painel o recebe por /data e o mock e as jornadas o repetem: nenhuma
        # reescrita do terminal pode tocar nesse campo. Um evento cujo text
        # passasse a sair do catálogo (pt) reprovaria aqui.
        casos = {
            "opened": (self.eventos([row(1)], [row(1), row(2)]), 0,
                       f"!2 — MR 2\nNEW MR OPENED\n{self.URL.format(2)}"),
            "merged": (self.eventos([row(1), row(2)], [row(1)], [row(2, "merged")]), 0,
                       f"!2 — MR 2\nMERGED\n{self.URL.format(2)}"),
            "closed": (self.eventos([row(1), row(2)], [row(1)], [row(2, "closed")]), 0,
                       f"!2 — MR 2\nCLOSED\n{self.URL.format(2)}"),
            "locked": (self.eventos([row(1), row(2)], [row(1)], [row(2, "locked")]), 0,
                       f"!2 — MR 2\nLEFT THE OPEN LIST (locked)\n{self.URL.format(2)}"),
            "likes": (self.eventos([row(1)], [row(1, likes=3)]), 0,
                      f"!1 — MR 1\nLIKES 0 → 3\n{self.URL.format(1)}"),
            "pipeline": (self.eventos([row(1)], [row(1, pipeline={"id": 9, "status": "success"})]), 0,
                         f"!1 — MR 1\nPIPELINE sem pipeline → #9 success\n{self.URL.format(1)}"),
            "review": (self.eventos([row(1)], [row(1, reviewers=[("ana.lima", "unreviewed")])],
                                    me="ana.lima"), 0,
                       f"!1 — MR 1\nREVIEW REQUESTED FROM YOU\n{self.URL.format(1)}"),
            "threads": (monitor.collect(Client([row(1)], [row(1)]), ["1"], {"1": {"1": monitor.snapshot(
                row(1), [{"id": "d1", "notes": [{"resolvable": True, "resolved": False}]}])}})[1], 0,
                        f"!1 — MR 1\nDISCUSSIONS 1 → 0\n{self.URL.format(1)}"),
        }
        for nome, (events, position, esperado) in casos.items():
            with self.subTest(nome=nome):
                self.assertEqual(events[position]["text"], esperado)

    def test_discussion_changes_devolve_chave_e_valores(self):
        antes = {"a": {"notes_count": 1, "resolved": False}, "b": {"notes_count": 1, "resolved": True},
                 "c": {"notes_count": 1, "resolved": False}}
        depois = {"a": {"notes_count": 1, "resolved": True}, "b": {"notes_count": 1, "resolved": False},
                  "c": {"notes_count": 2, "resolved": False}, "d": {"notes_count": 1, "resolved": False}}
        self.assertEqual(monitor.discussion_changes(antes, depois), [
            ("event.discussions", {"before": 3, "after": 4}),
            ("event.threads-resolved", {"count": 1}),
            ("event.threads-reopened", {"count": 1}),
            ("event.threads-replied", {"count": 1})])

    def test_cada_evento_traz_a_chave_e_os_valores_de_interpolacao(self):
        # Se `params` faltasse um marcador, a linha do terminal sairia "{before}".
        casos = {
            "opened": (self.eventos([row(1)], [row(1), row(2)]), ("event.opened", {})),
            "merged": (self.eventos([row(1), row(2)], [row(1)], [row(2, "merged")]),
                       ("event.left-merged", {})),
            "closed": (self.eventos([row(1), row(2)], [row(1)], [row(2, "closed")]),
                       ("event.left-closed", {})),
            "locked": (self.eventos([row(1), row(2)], [row(1)], [row(2, "locked")]),
                       ("event.left-other", {"state": "locked"})),
            "likes": (self.eventos([row(1)], [row(1, likes=3)]),
                      ("event.likes", {"before": 0, "after": 3})),
            "pipeline": (self.eventos([row(1)], [row(1, pipeline={"id": 9, "status": "success"})]),
                         ("event.pipeline", {"before": "sem pipeline", "after": "#9 success"})),
            "review": (self.eventos([row(1)], [row(1, reviewers=[("ana.lima", "unreviewed")])],
                                    me="ana.lima"), ("event.review-requested", {})),
            "retirada": (self.eventos([row(1, reviewers=[("ana.lima", "unreviewed")])], [row(1)],
                                      me="ana.lima", reviewing=True), ("event.review-removed", {})),
        }
        for nome, (events, esperado) in casos.items():
            with self.subTest(nome=nome):
                self.assertEqual((events[0]["key"], events[0]["params"]), esperado)

    def evento(self, **extra):
        base = {"kind": "likes", "key": "event.likes", "params": {"before": 0, "after": 2},
                "text": "!1 — MR 1\nLIKES 0 → 2\nhttps://gitlab.example/1",
                "mr": "1", "title": "MR 1", "author": "ana.lima", "url": "https://gitlab.example/1",
                "likes": 2, "mine": False, "involved": True, "draft": False}
        return {**base, **extra}

    def test_a_linha_do_terminal_sai_no_idioma_escolhido(self):
        aberto = self.evento(kind="opened", key="event.opened", params={})
        self.assertEqual(monitor.event_line(aberto, "pt"),
                         "!1 — MR 1\nnovo MR aberto\nhttps://gitlab.example/1")
        self.assertEqual(monitor.event_line(aberto, "en"),
                         "!1 — MR 1\nnew MR opened\nhttps://gitlab.example/1")

    def test_evento_sem_chave_cai_no_text(self):
        # Histórico e dublês antigos: sem `key` não há o que traduzir.
        self.assertEqual(monitor.event_line({"kind": "left", "text": "A\nB\nC"}, "pt"), "A\nB\nC")

    def announced(self, events, notify_result=True, gate=None, notifications=True):
        with patch.object(monitor, "log") as log, \
             patch.object(monitor, "notify", return_value=notify_result) as notify:
            muted = monitor.announce(events, notifications, "pt", gate)
        return [call.args[0] for call in log.call_args_list], notify, muted

    def test_eventos_do_mesmo_mr_saem_sob_um_cabecalho_so(self):
        eventos = [self.evento(),
                   self.evento(kind="pipeline", key="event.pipeline",
                               params={"before": "sem pipeline", "after": "#9 success"}),
                   self.evento(mr="2", title="MR 2", url="https://gitlab.example/2")]
        logs, notify, _ = self.announced(eventos)
        self.assertEqual(logs[0], "!1 — MR 1\nlikes 0 → 2\npipeline sem pipeline → #9 success\n"
                                  "https://gitlab.example/1")
        self.assertEqual(logs[1], "!2 — MR 2\nlikes 0 → 2\nhttps://gitlab.example/2")
        self.assertEqual(notify.call_args.args[1], "\n\n".join(logs))
        self.assertEqual(logs[0].count("!1 — MR 1"), 1)

    def gate(self, rules):
        return monitor.NotifyGate(monitor.parse_notify_rules(rules))

    def test_o_gate_de_aviso_corta_o_que_as_regras_barram(self):
        # O corte é ANTES de imprimir: quem o fizesse depois ainda mostraria tudo.
        poucos, muitos = self.evento(likes=1), self.evento(mr="2", title="MR 2", likes=5,
                                                           url="https://gitlab.example/2")
        logs, _, muted = self.announced([poucos, muitos], gate=self.gate({"minLikes": 3}))
        self.assertEqual(len(logs), 1)
        self.assertIn("MR 2", logs[0])
        self.assertEqual(muted, 1)

    def test_evento_barrado_nao_vai_para_a_notificacao_do_sistema(self):
        poucos, muitos = self.evento(likes=1), self.evento(mr="2", title="MR 2", likes=5,
                                                           url="https://gitlab.example/2")
        _, notify, _ = self.announced([poucos, muitos], gate=self.gate({"minLikes": 3}))
        notify.assert_called_once()
        self.assertNotIn("MR 1", notify.call_args.args[1])
        self.assertIn("MR 2", notify.call_args.args[1])

    def test_lote_inteiro_barrado_nao_notifica(self):
        _, notify, muted = self.announced([self.evento(likes=1)], gate=self.gate({"minLikes": 3}))
        notify.assert_not_called()
        self.assertEqual(muted, 1)

    def test_a_espera_so_comeca_depois_do_aviso_entregue(self):
        # Mesma razão do painel: lote não entregue volta no ciclo seguinte.
        regras = {"cooldownMinutes": 30}
        nao_entregue = self.gate(regras)
        self.announced([self.evento()], notify_result=False, gate=nao_entregue)
        logs, notify, muted = self.announced([self.evento()], gate=nao_entregue)
        self.assertEqual((len(logs), muted), (1, 0))
        notify.assert_called_once()
        # Entregue, a espera passa a valer e o segundo aviso do mesmo MR é cortado.
        entregue = self.gate(regras)
        self.announced([self.evento()], notify_result=True, gate=entregue)
        logs, notify, muted = self.announced([self.evento()], gate=entregue)
        self.assertEqual((logs, muted), ([], 1))
        notify.assert_not_called()

    def test_sem_notificacao_a_espera_nao_comeca(self):
        gate = self.gate({"cooldownMinutes": 30})
        self.announced([self.evento()], gate=gate, notifications=False)
        logs, _, muted = self.announced([self.evento()], gate=gate, notifications=False)
        self.assertEqual((len(logs), muted), (1, 0))


class ModosDeTerminalTests(unittest.TestCase):
    ENV = "GITLAB_API_URL=https://gitlab.example\nGITLAB_TOKEN=fake\n"

    def settings(self, argv=(), preferences=None):
        args = monitor.build_parser().parse_args(list(argv))
        with patch.object(monitor.sys.stdout, "isatty", return_value=False):
            return monitor.terminal_settings(args, preferences or {})

    def run_panel(self, client, settings, cycles=1):
        out = StringIO()
        with patch.object(monitor.sys, "stdout", out), \
             patch.object(monitor.time, "sleep", side_effect=[None] * (cycles - 1) + [KeyboardInterrupt]):
            with self.assertRaises(KeyboardInterrupt):
                monitor.show_panel(client, settings, notifications=False)
        return out.getvalue()

    def multi(self, failing=()):
        return RecordingClient({"a%2Fum": [row(1, likes=2)], "a%2Fdois": [row(2, author="bia")]}, failing)

    def run_main(self, folder, argv, client, sleeps=(KeyboardInterrupt,), preferences=None):
        (folder / ".env").write_text(self.ENV, encoding="utf-8")
        logs = []
        if preferences is not None:
            monitor.PREFERENCES_FILE.write_text(json.dumps({"version": 1, "preferences": preferences}),
                                                encoding="utf-8")
            self.addCleanup(monitor.PREFERENCES_FILE.unlink, True)
        with patch.object(monitor, "ROOT", folder), \
             patch.object(monitor.sys, "argv", ["monitor", *argv]), \
             patch.object(monitor, "GitLab", return_value=client), \
             patch.object(monitor, "log", side_effect=logs.append), \
             patch.object(monitor, "notify", return_value=True) as notify, \
             patch.object(monitor.time, "sleep", side_effect=list(sleeps)), \
             patch("builtins.print"):
            code = monitor.main()
        return code, logs, notify

    def test_painel_acompanha_os_alvos_das_preferencias(self):
        # Sem posicional, os alvos guardados pelo painel web valem no terminal.
        settings = self.settings([], {"monitoredProjects": ["a%2Fum", "a%2Fdois"]})
        client = self.multi()
        out = self.run_panel(client, settings)
        self.assertEqual(client.tracked, ["a%2Fum", "a%2Fdois"])
        self.assertIn("2 aberto(s)", out)

    def test_painel_aplica_as_preferencias_de_ordem_e_filtro(self):
        settings = self.settings(["a/um", "--project", "a/dois"],
                                 {"filters": {"author": ["bia"]}})
        out = self.run_panel(self.multi(), settings)
        self.assertIn("mostrando 1 de 2", out)
        self.assertIn("bia", out)
        self.assertNotIn("ana.lima", out)

    def test_painel_nao_emite_escape_sem_terminal(self):
        out = self.run_panel(self.multi(), self.settings(["a/um"]))
        self.assertNotIn("\033", out)

    def test_monitorar_acompanha_varios_alvos(self):
        client = self.multi()
        with tempfile.TemporaryDirectory() as directory:
            code, logs, _ = self.run_main(Path(directory), ["a/um", "--project", "a/dois", "--mode", "monitorar",
                                                           "--once", "--no-notify", "--keep-history", "true"], client)
            (path,) = (Path(directory) / "gitlab-history").glob("*.json")
            stored = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(code, 0)
        self.assertEqual(sorted(stored["targets"]), ["a%2Fdois", "a%2Fum"])
        self.assertEqual(client.tracked, ["a%2Fum", "a%2Fdois"])
        self.assertIn("Monitorando a/um, a/dois", logs[0])
        self.assertIn("Referência salva (2 MR(s))", logs[1])

    def test_monitorar_usa_os_alvos_das_preferencias(self):
        client = self.multi()
        with tempfile.TemporaryDirectory() as directory:
            self.run_main(Path(directory), ["--mode", "monitorar", "--once", "--no-notify"], client,
                          preferences={"monitoredProjects": ["a%2Fum", "a%2Fdois"]})
        self.assertEqual(client.tracked, ["a%2Fum", "a%2Fdois"])

    def test_a_chave_do_historico_nao_depende_da_ordem_dos_alvos(self):
        with tempfile.TemporaryDirectory() as directory:
            folder = Path(directory)
            for order in (["a/um", "--project", "a/dois"], ["a/dois", "--project", "a/um"]):
                self.run_main(folder, [*order, "--mode", "monitorar", "--once", "--no-notify",
                                       "--keep-history", "true"], self.multi())
            self.assertEqual(len(list((folder / "gitlab-history").glob("*.json"))), 1)

    def cycle_with(self, events, rules, notify_results=(True,)):
        """Dois ciclos de `monitorar`: a referência e depois `events`."""
        baseline = ({"a%2Fum": {"1": {}}}, [])
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(self.ENV, encoding="utf-8")
            logs = []
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor", "a/um", "--mode", "monitorar"]), \
                 patch.object(monitor, "GitLab"), patch.object(monitor, "log", side_effect=logs.append), \
                 patch.object(monitor, "load_preferences",
                              return_value={"version": 1, "preferences": {"notifyRules": rules}}), \
                 patch.object(monitor, "collect", side_effect=[baseline, ({"a%2Fum": {"1": {}, "2": {}}}, events)]), \
                 patch.object(monitor, "notify", side_effect=list(notify_results)) as notify, \
                 patch.object(monitor.time, "sleep", side_effect=[None, KeyboardInterrupt]):
                monitor.main()
        return logs, notify

    def test_o_resumo_do_ciclo_diz_quantos_foram_silenciados(self):
        eventos = [EventosDoTerminalTests.evento(EventosDoTerminalTests(), likes=1),
                   EventosDoTerminalTests.evento(EventosDoTerminalTests(), likes=9, mr="2", title="MR 2",
                                                 url="https://gitlab.example/2")]
        logs, notify = self.cycle_with(eventos, {"minLikes": 3})
        texto = "\n".join(logs)
        self.assertIn("1 aviso(s) silenciado(s) pelas regras", texto)
        self.assertIn("MR 2", texto)
        self.assertNotIn("!1 — MR 1", texto)
        self.assertIn("1 → 2: 2 mudança(s)", texto)
        self.assertNotIn("MR 1", notify.call_args.args[1])

    def test_monitorar_so_marca_a_espera_depois_de_entregar(self):
        eventos = [EventosDoTerminalTests.evento(EventosDoTerminalTests())]
        # Três ciclos com o mesmo evento: o aviso não entregue (False) não gasta a espera.
        baseline = ({"a%2Fum": {"1": {}}}, [])
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(self.ENV, encoding="utf-8")
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor", "a/um", "--mode", "monitorar"]), \
                 patch.object(monitor, "GitLab"), patch.object(monitor, "log"), \
                 patch.object(monitor, "load_preferences", return_value={
                     "version": 1, "preferences": {"notifyRules": {"cooldownMinutes": 30}}}), \
                 patch.object(monitor, "collect", side_effect=[baseline, (baseline[0], eventos),
                                                               (baseline[0], eventos), (baseline[0], eventos)]), \
                 patch.object(monitor, "notify", side_effect=[False, True]) as notify, \
                 patch.object(monitor.time, "sleep", side_effect=[None, None, None, KeyboardInterrupt]):
                monitor.main()
        # 1º falhou (volta), 2º entregue, 3º cortado pela espera.
        self.assertEqual(notify.call_count, 2)

    def test_report_expoe_os_alvos_que_nao_responderam(self):
        with patch.object(monitor, "log"):
            rows, failed = monitor.report(self.multi(failing=["a%2Fdois"]), ["a%2Fum", "a%2Fdois"])
        self.assertEqual([item["author"] for item in rows], ["ana.lima"])
        self.assertEqual(failed, ["a%2Fdois"])

    def test_relatorio_diz_de_que_alvo_faltam_linhas(self):
        with tempfile.TemporaryDirectory() as directory:
            (Path(directory) / ".env").write_text(self.ENV, encoding="utf-8")
            printed = []
            with patch.object(monitor, "ROOT", Path(directory)), \
                 patch.object(monitor.sys, "argv", ["monitor", "a/um", "--project", "a/dois", "--mode", "relatorio"]), \
                 patch.object(monitor, "GitLab", return_value=self.multi(failing=["a%2Fdois"])), \
                 patch.object(monitor, "log"), \
                 patch("builtins.print", side_effect=lambda *a, **k: printed.append(a[0])):
                self.assertEqual(monitor.main(), 0)
        self.assertIn("sem resposta de: a/dois", printed[0])

    # Foco de revisão 5
    def test_quando_um_alvo_falha_o_resumo_nomeia_o_que_faltou(self):
        out = self.run_panel(self.multi(failing=["a%2Fdois"]), self.settings(["a/um", "--project", "a/dois"]))
        self.assertIn("1 aberto(s)", out)
        self.assertIn("sem resposta de: a/dois", out)
        self.assertIn("ana.lima", out)

    def test_quando_todos_os_alvos_falham_o_ciclo_diz_de_quais(self):
        client = self.multi(failing=["a%2Fum", "a%2Fdois"])
        out = self.run_panel(client, self.settings(["a/um", "--project", "a/dois"]))
        self.assertIn("sem resposta de: a/um, a/dois", out)
        with tempfile.TemporaryDirectory() as directory:
            code, logs, _ = self.run_main(Path(directory), ["a/um", "--project", "a/dois", "--mode", "monitorar",
                                                           "--no-notify"], client)
        self.assertIn("sem resposta de: a/um, a/dois", "\n".join(logs))

    def test_a_ordenacao_o_sentido_e_os_filtros_chegam_ao_arranjo(self):
        # Direção, pipelines e revisão são três posições vizinhas de `arrange`:
        # trocar duas, ou omitir uma, passaria despercebido sem este teste.
        settings = self.settings(["--sort", "likes", "--direction", "asc", "--author", "ana.lima",
                                  "--pipeline", "failed", "--review", "assigned"])
        rows = [monitor.report_row(merge_request(1, "backend", "um", "ana.lima", 1), [])]
        with patch.object(monitor, "arrange", wraps=monitor.arrange) as arrange:
            monitor.render_report(rows, settings)
        self.assertEqual(arrange.call_args.args,
                         (rows, "likes", ("ana.lima",), ("failed",), ("assigned",), "asc"))


if __name__ == "__main__":
    unittest.main()
