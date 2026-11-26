import collections
import re
import sys
import unittest
from io import StringIO
from pathlib import Path
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import monitor_rules as rules
import monitor_table as table

Column = collections.namedtuple("Column", "key label width cell weight")
COLUNAS = (Column("likes", "Likes", 8, "likes", 10),
           Column("mr", "MR", 54, "link", 50),
           Column("author", "Autor", 18, "text", 18),
           Column("threads", "Threads", 15, "badge", 13),
           Column("openers", "Participantes", 30, "text", 20),
           Column("review", "Revisão", 24, "people", 16),
           Column("pipeline", "Pipeline", 16, "badge", 13),
           Column("created_label", "Criado", 12, "text", 14))
URL = "https://gitlab.example/g/p/-/merge_requests/1"


def linhas():
    return [{"likes": "3", "mr": "BE #1 titulo bem longo " * 3, "author": "ana.lima",
             "threads": "2/4", "openers": "joao, maria", "review": "ana",
             "pipeline": "✅ sucesso", "created_label": "há 2 dias", "url": URL},
            {"likes": "0", "mr": "FE #2 curto", "author": "joao.silva 日本語",
             "threads": "0/0", "openers": "", "review": "", "pipeline": "sem pipeline",
             "created_label": "hoje", "url": URL + "2"}]


class TabelaTests(unittest.TestCase):
    def test_sem_tty_a_largura_e_a_fixa_e_todas_as_colunas_aparecem(self):
        with patch.object(table.sys, "stdout", StringIO()):
            desenho = table.render_table(linhas(), COLUNAS)
        self.assertNotIn("\033", desenho)
        for coluna in COLUNAS:
            self.assertIn(coluna.label, desenho)
        # Largura natural de cada coluna, como antes: nenhuma é espremida.
        self.assertIn("BE #1 titulo bem longo BE #1 titulo bem longo BE #1", desenho)
        self.assertEqual(len({table.text_width(x) for x in desenho.splitlines()}), 1)

    def test_com_tty_a_tabela_nao_passa_da_largura_do_terminal(self):
        for width in (200, 120, 80, 60, 40):
            with self.subTest(width=width):
                desenho = table.render_table(linhas(), COLUNAS, width=width)
                self.assertTrue(all(table.text_width(linha) <= width
                                    for linha in desenho.splitlines()))

    def test_sem_width_com_tty_usa_o_tamanho_do_terminal(self):
        class Tty(StringIO):
            def isatty(self):
                return True
        with patch.object(table.sys, "stdout", Tty()), \
                patch.object(table.shutil, "get_terminal_size",
                             return_value=table.shutil.os.terminal_size((90, 24))):
            desenho = table.render_table(linhas(), COLUNAS)
        self.assertTrue(all(table.text_width(re.sub("\033\\]8;;[^\033]*\033\\\\", "", x)) <= 90
                            for x in desenho.splitlines()))
        self.assertIn("\033]8;;", desenho)

    def test_largura_absurda_ainda_desenha_pelo_menos_uma_coluna(self):
        for width in (0, 1, 10):
            with self.subTest(width=width):
                self.assertIn("│", table.render_table(linhas(), COLUNAS, width=width))

    def test_hidden_columns_tira_a_coluna_do_desenho(self):
        desenho = table.render_table(linhas(), COLUNAS, width=250,
                                     hidden_columns=["author", "threads"])
        self.assertNotIn("Autor", desenho)
        self.assertNotIn("Threads", desenho)
        self.assertIn("Pipeline", desenho)

    def test_column_order_reordena_e_poe_a_desconhecida_no_fim(self):
        mostradas = table.visible_columns(COLUNAS, [], ["pipeline", "mr", "naoexiste"])
        chaves = [c.key for c in mostradas]
        self.assertEqual(chaves[:2], ["pipeline", "mr"])
        self.assertEqual(chaves[2:], ["likes", "author", "threads", "openers",
                                      "review", "created_label"])
        cabecalho = table.render_table(linhas(), COLUNAS, width=250,
                                       column_order=["pipeline", "mr"]).splitlines()[1]
        self.assertLess(cabecalho.index("Pipeline"), cabecalho.index("MR"))
        self.assertLess(cabecalho.index("MR"), cabecalho.index("Likes"))

    def test_fit_columns_sacrifica_a_de_menor_peso_e_sempre_devolve_uma(self):
        ajustadas = table.fit_columns(COLUNAS, 60)
        chaves = [c.key for c, _ in ajustadas]
        self.assertIn("mr", chaves)
        self.assertNotIn("likes", chaves)
        self.assertLess(len(chaves), len(COLUNAS))
        self.assertEqual(len(table.fit_columns(COLUNAS, 0)), 1)
        self.assertEqual(table.fit_columns([], 80), [])

    def test_fit_columns_cabe_na_largura_e_respeita_o_natural(self):
        for available in (250, 120, 80):
            ajustadas = table.fit_columns(COLUNAS, available)
            total = sum(w for _, w in ajustadas) + 4 + 3 * (len(ajustadas) - 1)
            self.assertLessEqual(total, available)
            for coluna, largura in ajustadas:
                self.assertLessEqual(largura, coluna.width)

    def test_a_regua_so_aparece_abaixo_do_cabecalho(self):
        desenho = table.render_table(linhas(), COLUNAS, width=120)
        self.assertEqual(desenho.count("├"), 1)

    def test_a_coluna_mr_continua_sendo_a_clicavel(self):
        desenho = table.render_table(linhas(), COLUNAS, width=120, links=True)
        self.assertIn(f"\033]8;;{URL}\033\\", desenho)
        sem = re.sub("\033\\]8;;[^\033]*\033\\\\", "", desenho)
        self.assertNotIn("\033", sem)
        self.assertNotIn("\033]8;;", table.render_table(linhas(), COLUNAS, width=120,
                                                         links=False))

    def test_text_width_conta_caracteres_largos_como_dois(self):
        self.assertEqual(table.text_width("日本"), 4)
        self.assertEqual(table.text_width("ab"), 2)

    def test_emoji_e_cjk_nas_colunas_estreitas_nao_passam_da_largura(self):
        estreitas = [{"likes": "👍👍", "mr": "BE #1 título 日本語日本語 " * 4, "author": "日本語日本語",
                      "threads": "✅✅✅", "openers": "日本語 日本語", "review": "👀",
                      "pipeline": "✅ sucesso ❌ falhou", "created_label": "日本語",
                      "url": URL}]
        for width in (200, 120, 80, 60, 40):
            with self.subTest(width=width):
                desenho = table.render_table(estreitas, COLUNAS, width=width)
                self.assertTrue(all(table.text_width(x) <= width
                                    for x in desenho.splitlines()), desenho)

    def test_a_80_colunas_a_coluna_de_maior_peso_recebe_ao_menos_20(self):
        import gitlab_monitor as monitor
        reais = monitor.REPORT_COLUMNS
        principal = max(reais, key=lambda c: c.weight)
        ajustadas = dict((c.key, w) for c, w in table.fit_columns(reais, 80))
        self.assertGreaterEqual(ajustadas[principal.key], 20)


def regra(tone, field="likes", operator="gte", value="1", enabled=True):
    return {"field": field, "operator": operator, "value": value, "tone": tone,
            "enabled": enabled}


def com_fatos(linha, **fatos):
    return {**linha, "facts": fatos}


ANSI = re.compile("\033\\[[0-9;]*m|\033\\]8;;[^\033]*\033\\\\")


class CorETests(unittest.TestCase):
    def test_sem_cor_o_desenho_nao_tem_nenhum_escape(self):
        base = [{**l, "likes_tone": "strong", "pipeline_tone": "success"} for l in linhas()]
        desenho = table.render_table(base, COLUNAS, width=120, links=False, color=False,
                                     row_rules=[regra("danger")])
        self.assertNotIn("\033[", desenho)

    def test_com_cor_o_tom_da_celula_vira_escape(self):
        base = [{**linhas()[0], "pipeline_tone": "success"}]
        desenho = table.render_table(base, COLUNAS, width=200, links=False, color=True)
        self.assertIn(f"\033[{table.TONE_CODES['success']}m", desenho)
        # A célula sem tom (likes sem likes_tone) não ganha escape.
        self.assertEqual(desenho.count("\033[0m"), 1)

    def test_paint_sem_cor_ou_sem_tom_devolve_o_valor(self):
        self.assertEqual(table.paint("x", "danger", False), "x")
        self.assertEqual(table.paint("x", None, True), "x")
        self.assertEqual(table.paint("x", "desconhecido", True), "x")

    def test_text_width_ignora_escape_de_cor_e_de_link(self):
        self.assertEqual(table.text_width(table.paint("ab", "danger", True)), 2)
        self.assertEqual(table.text_width(table.hyperlink("日本", URL)), 4)

    def test_a_cor_nao_conta_na_largura_da_coluna(self):
        base = [{**l, "likes_tone": "strong", "threads_tone": "warning",
                 "pipeline_tone": "danger", "facts": {"likes": 3}} for l in linhas()]
        for width in (200, 120, 80, 60, 40):
            with self.subTest(width=width):
                sem = table.render_table(base, COLUNAS, width=width, links=False,
                                         row_rules=[regra("danger")])
                com = table.render_table(base, COLUNAS, width=width, links=False,
                                         color=True, row_rules=[regra("danger")])
                self.assertIn("\033[", com)
                self.assertEqual([table.text_width(x) for x in com.splitlines()],
                                 [table.text_width(x) for x in sem.splitlines()])
                self.assertEqual(ANSI.sub("", com), sem)
                self.assertTrue(all(table.text_width(x) <= width
                                    for x in com.splitlines()))

    def test_o_marcador_de_destaque_aparece_mesmo_sem_cor(self):
        base = [com_fatos(linhas()[0], likes=3)]
        desenho = table.render_table(base, COLUNAS, width=120, links=False,
                                     color=False, row_rules=[regra("danger")])
        self.assertIn(table.ROW_MARKS["danger"], desenho)
        self.assertNotIn("\033", desenho)

    def test_so_a_primeira_regra_que_casa_marca_a_linha(self):
        base = [com_fatos(linhas()[0], likes=3)]
        desenho = table.render_table(
            base, COLUNAS, width=120, links=False,
            row_rules=[regra("danger", enabled=False), regra("warning", value="9"),
                       regra("success"), regra("strong")])
        self.assertIn(table.ROW_MARKS["success"], desenho)
        for tom in ("danger", "warning", "strong"):
            self.assertNotIn(table.ROW_MARKS[tom], desenho)

    def test_linha_que_nao_casa_com_regra_nenhuma_fica_sem_marcador(self):
        base = [com_fatos(linhas()[0], likes=0), linhas()[1]]
        desenho = table.render_table(base, COLUNAS, width=120, links=False,
                                     row_rules=[regra("danger", value="5")])
        for marca in table.ROW_MARKS.values():
            self.assertNotIn(marca, desenho)

    def test_o_marcador_so_na_linha_que_casa_e_so_na_primeira_linha_dela(self):
        base = [com_fatos(linhas()[0], likes=3), com_fatos(linhas()[1], likes=0)]
        desenho = table.render_table(base, COLUNAS, width=60, links=False,
                                     row_rules=[regra("danger", value="2")])
        self.assertEqual(desenho.count(table.ROW_MARKS["danger"]), 1)

    def test_cada_tom_tem_marcador_distinto(self):
        self.assertEqual(set(table.ROW_MARKS), set(table.TONE_CODES))
        self.assertEqual(len(set(table.ROW_MARKS.values())), len(table.ROW_MARKS))
        self.assertTrue(all(table.text_width(m) == 1 for m in table.ROW_MARKS.values()))

    def test_todo_tom_do_motor_tem_cor_e_marcador(self):
        # Derivado do motor, e não fixado à mão: um tom novo em RULE_TONES que
        # não ganhar cor nem marcador reprova aqui, em vez de sumir no terminal.
        self.assertEqual(set(table.TONE_CODES), set(rules.RULE_TONES))
        self.assertEqual(set(table.ROW_MARKS), set(rules.RULE_TONES))

    def test_colorir_com_tom_info_ou_neutral_devolve_o_escape_do_tom(self):
        for tom in ("info", "neutral"):
            self.assertEqual(table.paint("x", tom, True),
                             f"\033[{table.TONE_CODES[tom]}mx\033[0m")

    def test_marcador_e_cor_da_linha_juntos(self):
        base = [com_fatos(linhas()[0], likes=3)]
        desenho = table.render_table(base, COLUNAS, width=120, links=False, color=True,
                                     row_rules=[regra("danger")])
        self.assertIn(f"\033[{table.TONE_CODES['danger']}m{table.ROW_MARKS['danger']}",
                      desenho)

    def test_sem_regras_a_tabela_nao_ganha_coluna_de_marcador(self):
        base = linhas()
        self.assertEqual(table.render_table(base, COLUNAS, width=120, links=False),
                         table.render_table(base, COLUNAS, width=120, links=False,
                                            row_rules=()))
        self.assertTrue(table.render_table(base, COLUNAS, width=120, links=False)
                        .splitlines()[1].startswith("│ Likes"))

    def test_so_regras_desligadas_nao_ganham_coluna_de_marcador(self):
        # Regra desligada nunca casa, então a coluna só gastaria moldura.
        base = [com_fatos(linhas()[0], likes=3)]
        desligadas = [regra("danger", enabled=False), regra("warning", enabled=False)]
        self.assertEqual(table.render_table(base, COLUNAS, width=120, links=False,
                                            row_rules=desligadas),
                         table.render_table(base, COLUNAS, width=120, links=False,
                                            row_rules=()))


class ResumoTests(unittest.TestCase):
    def mr(self, **fatos):
        base = {"status": "success", "mergeable_value": True, "conflicts_value": False,
                "reviewing_mine": False, "my_review_state": ""}
        return {**base, **fatos}

    def test_resumo_conta_pipeline_falhando_bloqueados_e_minha_revisao(self):
        rows = [self.mr(status="failed"),
                self.mr(mergeable_value=False),
                self.mr(conflicts_value=True),
                # Bloqueado pelas duas razões conta uma vez só.
                self.mr(mergeable_value=False, conflicts_value=True),
                self.mr(reviewing_mine=True, my_review_state="unreviewed"),
                # Revisora, mas já aprovou; e não-revisora com estado: não contam.
                self.mr(reviewing_mine=True, my_review_state="approved"),
                self.mr(reviewing_mine=False, my_review_state="unreviewed")]
        self.assertEqual(table.summary_line(rows),
                         "7 aberto(s) · 1 com pipeline falha · 3 bloqueado(s) · 1 esperando você")

    def test_mergeable_desconhecido_nao_e_bloqueado(self):
        self.assertEqual(table.summary_line([self.mr(mergeable_value=None)]), "1 aberto(s)")

    def test_resumo_omite_o_que_e_zero(self):
        self.assertEqual(table.summary_line([self.mr(), self.mr()]), "2 aberto(s)")

    def test_resumo_diz_quantas_linhas_o_filtro_deixou(self):
        rows = [self.mr(), self.mr(), self.mr()]
        self.assertIn("mostrando 1 de 3", table.summary_line(rows, shown=1))
        # Sem corte (igual ao total) ou sem filtro (None), nada a dizer.
        self.assertNotIn("mostrando", table.summary_line(rows, shown=3))
        self.assertNotIn("mostrando", table.summary_line(rows))

    def test_resumo_segue_o_idioma(self):
        rows = [self.mr(status="failed")]
        self.assertEqual(table.summary_line(rows, "en"), "1 open · 1 with a failed pipeline")
        self.assertEqual(table.summary_line(rows, "pt"), "1 aberto(s) · 1 com pipeline falha")

    def test_resumo_de_lista_vazia_nao_quebra(self):
        self.assertEqual(table.summary_line([]), "0 aberto(s)")
        self.assertEqual(table.summary_line([], shown=0), "0 aberto(s)")

    def test_resumo_nomeia_os_alvos_sem_resposta(self):
        self.assertEqual(table.summary_line([self.mr()], failed=["g/a", "g/b"]),
                         "1 aberto(s) · sem resposta de: g/a, g/b")
        self.assertEqual(table.summary_line([self.mr()], "en", failed=["g/a"]),
                         "1 open · no response from: g/a")


if __name__ == "__main__":
    unittest.main()
