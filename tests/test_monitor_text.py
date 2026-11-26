"""Catálogo pt/en dos textos do terminal: paridade entre idiomas e tradução segura."""

from pathlib import Path
import string
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import monitor_text as text  # noqa: E402

# O nome da chave e dos marcadores é o contrato com quem chama.
REQUIRED = {
    "event.opened": set(),
    "event.left-merged": set(),
    "event.left-closed": set(),
    "event.left-other": {"state"},
    "event.likes": {"before", "after"},
    "event.review-requested": set(),
    "event.review-removed": set(),
    "event.pipeline": {"before", "after"},
    "event.discussions": {"before", "after"},
    "event.threads-resolved": {"count"},
    "event.threads-reopened": {"count"},
    "event.threads-replied": {"count"},
    "summary.open": {"count"},
    "summary.pipeline-failed": {"count"},
    "summary.blocked": {"count"},
    "summary.awaiting-me": {"count"},
    "summary.interval": {"minutes"},
    "summary.targets-failed": {"targets"},
    "summary.filtered": {"shown", "total"},
    "monitor.started": {"targets", "minutes"},
    "monitor.reference-saved": {"count"},
    "monitor.changes": {"before", "after", "changes"},
    "monitor.muted": {"count"},
    "monitor.quiet": set(),
    "legend.rule": {"mark", "text"},
}


def marcadores(template):
    """Extrai os nomes dos `{nome}` de um texto, como o str.format os enxerga."""
    return {name for _, name, _, _ in string.Formatter().parse(template) if name}


class CatalogoTests(unittest.TestCase):
    def test_idiomas_oferecidos(self):
        self.assertEqual(text.LANGUAGES, ("pt", "en"))
        self.assertEqual(set(text.CATALOG), {"pt", "en"})

    def test_pt_e_en_tem_exatamente_as_mesmas_chaves(self):
        self.assertEqual(set(text.CATALOG["pt"]), set(text.CATALOG["en"]))

    def test_cada_chave_tem_os_mesmos_marcadores_nos_dois_idiomas(self):
        for key in text.CATALOG["pt"]:
            self.assertEqual(marcadores(text.CATALOG["pt"][key]),
                             marcadores(text.CATALOG["en"][key]), key)

    def test_nenhum_texto_e_vazio(self):
        for language in text.LANGUAGES:
            for key, value in text.CATALOG[language].items():
                self.assertTrue(value.strip(), f"{language}:{key}")

    def test_chaves_obrigatorias_existem_com_os_marcadores_do_contrato(self):
        for language in text.LANGUAGES:
            for key, expected in REQUIRED.items():
                self.assertIn(key, text.CATALOG[language], f"{language}:{key}")
                self.assertEqual(marcadores(text.CATALOG[language][key]), expected,
                                 f"{language}:{key}")


class TraducaoTests(unittest.TestCase):
    def test_chave_ausente_devolve_a_propria_chave(self):
        self.assertEqual(text.translate("nao.existe"), "nao.existe")
        self.assertEqual(text.translate("nao.existe", "en", count=1), "nao.existe")

    def test_idioma_desconhecido_cai_no_portugues(self):
        self.assertEqual(text.translate("summary.open", "de", count=3),
                         text.translate("summary.open", "pt", count=3))

    def test_idioma_padrao_e_portugues(self):
        self.assertEqual(text.translate("summary.open", count=3),
                         text.translate("summary.open", "pt", count=3))

    def test_idioma_nao_textual_cai_no_portugues(self):
        self.assertEqual(text.translate("summary.open", None, count=3),
                         text.translate("summary.open", "pt", count=3))

    def test_interpolacao_usa_os_valores(self):
        self.assertIn("3", text.translate("summary.open", "pt", count=3))
        self.assertIn("3", text.translate("summary.open", "en", count=3))

    def test_marcador_faltando_nao_derruba_e_fica_visivel(self):
        result = text.translate("event.likes", "pt", before=1)
        self.assertIn("1", result)
        self.assertIn("{after}", result)

    def test_valor_a_mais_e_ignorado(self):
        self.assertEqual(text.translate("event.opened", "pt", lixo=1),
                         text.CATALOG["pt"]["event.opened"])

    def test_valor_que_nomeia_marcador_existente_nao_e_reinterpretado(self):
        # Título de MR vem da API e pode conter chaves: o valor entra como dado.
        # Se fosse reinterpretado, "{after}" viraria "9" e a saída seria "likes 9 → 9".
        result = text.translate("event.likes", "pt", before="{after}", after="9")
        self.assertEqual(result, "likes {after} → 9")
        self.assertNotEqual(result, "likes 9 → 9")

    def test_valor_posicional_nao_e_reinterpretado(self):
        # "{0}" reinterpretado levantaria IndexError; tem de sair literal.
        result = text.translate("event.likes", "pt", before="{0}", after="9")
        self.assertEqual(result, "likes {0} → 9")


if __name__ == "__main__":
    unittest.main()
