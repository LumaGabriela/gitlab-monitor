"""Motor de regras de destaque: o porte em Python de core/rules/rule-engine.ts."""

from datetime import datetime, timedelta
from pathlib import Path
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import monitor_rules as rules  # noqa: E402


def make_rule(field, operator, value, tone="danger", enabled=True):
    return {"field": field, "operator": operator, "value": value, "tone": tone, "enabled": enabled}


class MotorDeRegrasTests(unittest.TestCase):
    def test_regra_numerica_compara_o_fato_cru(self):
        rule = make_rule("likes", "gte", "2", "strong")
        self.assertTrue(rules.matches(rule, {"likes": 3}))
        self.assertFalse(rules.matches(rule, {"likes": 1}))

    def test_regra_sem_valor_utilizavel_nao_casa(self):
        # Valor vazio, não numérico ou negativo: nunca casa, para não pintar tudo.
        for value in ("", "abc", "-1"):
            rule = make_rule("likes", "gte", value, "strong")
            self.assertFalse(rules.matches(rule, {"likes": 99}))

    def test_regra_inutilizavel_nunca_casa(self):
        facts = {"likes": 5, "author": "ana"}
        for rule in (
            make_rule("inexistente", "eq", "x"),
            make_rule("likes", "maior", "1"),
            make_rule("likes", "gte", None),
        ):
            self.assertFalse(rules.matches(rule, facts))
        self.assertIsNone(rules.first_match([make_rule("inexistente", "eq", "x")], facts))

    def test_regra_sem_tom_casa_e_o_tom_invalido_so_barra_o_destaque(self):
        # A regra de aviso não tem tom: o motor compara, e quem exige tom é o parse.
        rule = {"field": "likes", "operator": "gte", "value": "1", "enabled": True}
        self.assertTrue(rules.matches(rule, {"likes": 3}))
        parsed = rules.parse_highlight_rules(
            [make_rule("likes", "gte", "1", tone="roxo"), make_rule("likes", "gte", "1", tone="danger")]
        )
        self.assertEqual([item["tone"] for item in parsed], ["danger"])

    def test_numero_nao_finito_nao_casa(self):
        for value in ("inf", "nan"):
            self.assertFalse(rules.matches(make_rule("likes", "gte", value), {"likes": 99}))

    def test_maior_ou_igual_sobre_texto_e_booleano_nunca_casa(self):
        rule = make_rule("author", "gte", "ana")
        self.assertFalse(rules.matches(rule, {"author": "ana"}))
        rule = make_rule("draft", "lte", "true")
        self.assertFalse(rules.matches(rule, {"draft": True}))

    def test_booleano_desconhecido_so_entra_no_diferente(self):
        # mergeable None não é verdadeiro nem falso.
        igual = make_rule("mergeable", "eq", "true", "success")
        diferente = {**igual, "operator": "neq"}
        self.assertFalse(rules.matches(igual, {"mergeable": None}))
        self.assertTrue(rules.matches(diferente, {"mergeable": None}))

    def test_texto_compara_sem_caixa_e_sem_espaco(self):
        rule = make_rule("pipeline", "eq", " Failed ")
        self.assertTrue(rules.matches(rule, {"pipeline": "failed"}))

    def test_texto_vazio_nao_casa(self):
        self.assertFalse(rules.matches(make_rule("pipeline", "neq", "  "), {"pipeline": "failed"}))

    def test_first_match_devolve_a_primeira_regra_ligada_que_casa(self):
        desligada = make_rule("likes", "gte", "0", "success", enabled=False)
        casa = make_rule("likes", "gte", "1", "danger")
        outra = make_rule("likes", "gte", "1", "warning")
        self.assertEqual(rules.first_match([desligada, casa, outra], {"likes": 5}), casa)

    def test_first_match_sem_casamento_devolve_none(self):
        self.assertIsNone(rules.first_match([make_rule("likes", "gte", "9")], {"likes": 1}))

    def test_parse_descarta_regra_de_campo_tom_ou_operador_desconhecido(self):
        raw = [
            make_rule("inexistente", "eq", "x"),
            make_rule("likes", "maior", "1"),
            make_rule("likes", "gte", "1", "roxo"),
            make_rule("likes", "gte", "1", "danger"),
        ]
        self.assertEqual(len(rules.parse_highlight_rules(raw)), 1)

    def test_parse_descarta_item_com_valor_que_nao_e_texto(self):
        raw = [make_rule("likes", "gte", 1), "lixo", make_rule("likes", "gte", "1")]
        self.assertEqual(len(rules.parse_highlight_rules(raw)), 1)

    def test_parse_de_algo_que_nao_e_lista_devolve_vazio(self):
        for raw in (None, {}, "regras", 7):
            self.assertEqual(rules.parse_highlight_rules(raw), [])

    def test_campo_lista_ou_dicionario_nao_derruba_nem_casa(self):
        for field in ([], ["likes"], {}, {"a": 1}):
            rule = make_rule(field, "eq", "x")
            self.assertFalse(rules.matches(rule, {"likes": 1}))
            self.assertEqual(rules.parse_highlight_rules([rule]), [])

    def test_catalogo_cobre_os_17_fatos_e_os_operadores_por_tipo(self):
        self.assertEqual(len(rules.RULE_FIELD_KINDS), 17)
        self.assertEqual(set(rules.RULE_FIELD_KINDS.values()), {"number", "boolean", "text"})
        self.assertEqual(rules.RULE_OPERATORS_BY_KIND["boolean"], ("eq", "neq"))
        self.assertEqual(rules.RULE_OPERATORS_BY_KIND["number"], rules.RULE_OPERATORS)


def at(hour, minute=0):
    return datetime(2026, 11, 19, hour, minute)


def make_event(**overrides):
    event = {
        "kind": "likes",
        "involved": True,
        "likes": 3,
        "author": "ana.lima",
        "draft": False,
        "url": "https://gitlab.example/g/p/-/merge_requests/7",
        "mr": "7",
    }
    event.update(overrides)
    return event


def make_gate(**overrides):
    return rules.NotifyGate({**rules.DEFAULT_NOTIFY_RULES, **overrides})


def make_rules_gate(**overrides):
    """Os critérios só decidem quando são o lado escolhido; com o Geral, não valem."""
    return make_gate(decider="rules", **overrides)


class FiltroDeAvisoTests(unittest.TestCase):
    def test_tipo_desligado_nao_passa(self):
        gate = make_gate(kinds={**rules.DEFAULT_NOTIFY_RULES["kinds"], "likes": False})
        events = [make_event(kind="likes"), make_event(kind="opened")]
        self.assertEqual(gate.filter(events, at(12)), [events[1]])

    def test_so_o_meu_exige_involved(self):
        gate = make_gate(onlyMine=True)
        events = [make_event(involved=False), make_event(involved=True)]
        self.assertEqual(gate.filter(events, at(12)), [events[1]])

    def test_likes_minimos_cortam_abaixo_do_limite(self):
        gate = make_gate(minLikes=3)
        events = [make_event(likes=2), make_event(likes=3)]
        self.assertEqual(gate.filter(events, at(12)), [events[1]])

    def test_rascunho_e_cortado_quando_pedido(self):
        events = [make_event(draft=True), make_event(draft=False)]
        self.assertEqual(make_gate(ignoreDrafts=True).filter(events, at(12)), [events[1]])
        self.assertEqual(make_gate().filter(events, at(12)), events)

    def test_autor_silenciado_e_cortado_sem_caixa(self):
        gate = make_gate(mutedAuthors=["Ana.Lima"])
        events = [make_event(author="ana.lima"), make_event(author="bia")]
        self.assertEqual(gate.filter(events, at(12)), [events[1]])

    def test_silencio_atravessando_a_meia_noite(self):
        quiet = {"start": "22:00", "end": "07:00"}
        self.assertTrue(rules.is_quiet(quiet, at(23, 30)))
        self.assertTrue(rules.is_quiet(quiet, at(2, 0)))
        self.assertFalse(rules.is_quiet(quiet, at(12, 0)))
        self.assertFalse(rules.is_quiet(quiet, at(7, 0)))
        self.assertTrue(rules.is_quiet(quiet, at(22, 0)))

    def test_silencio_no_mesmo_dia(self):
        quiet = {"start": "09:00", "end": "17:00"}
        self.assertTrue(rules.is_quiet(quiet, at(9, 0)))
        self.assertFalse(rules.is_quiet(quiet, at(17, 0)))

    def test_janela_de_silencio_vazia_nao_e_o_dia_inteiro(self):
        self.assertFalse(rules.is_quiet({"start": "09:00", "end": "09:00"}, at(9, 0)))
        self.assertFalse(rules.is_quiet({"start": "09:00", "end": "09:00"}, at(15, 0)))

    def test_silencio_barra_o_lote_inteiro(self):
        gate = make_gate(quietHours={"start": "22:00", "end": "07:00"})
        events = [make_event(), make_event(kind="opened")]
        self.assertEqual(gate.filter(events, at(23, 0)), [])
        self.assertEqual(gate.filter(events, at(12, 0)), events)

    def test_espera_so_comeca_depois_do_aviso_entregue(self):
        gate = make_gate(cooldownMinutes=10)
        events = [make_event()]
        now = at(12)
        self.assertEqual(gate.filter(events, now), events)
        self.assertEqual(gate.filter(events, now), events)
        gate.mark_notified(events, now)
        self.assertEqual(gate.filter(events, now + timedelta(minutes=9)), [])
        self.assertEqual(gate.filter(events, now + timedelta(minutes=10)), events)

    def test_sem_espera_configurada_nada_e_cortado(self):
        gate = make_gate()
        events = [make_event()]
        gate.mark_notified(events, at(12))
        self.assertEqual(gate.filter(events, at(12)), events)

    def test_espera_e_por_url_e_nao_pelo_numero_do_mr(self):
        gate = make_gate(cooldownMinutes=10)
        first = make_event(mr="7", url="https://gitlab.example/g/a/-/merge_requests/7")
        second = make_event(mr="7", url="https://gitlab.example/g/b/-/merge_requests/7")
        gate.mark_notified([first], at(12))
        self.assertEqual(gate.filter([first, second], at(12, 1)), [second])

    def test_parse_de_horario_fora_do_formato_cai_em_sem_silencio(self):
        for start in ("25:00", "9:00", 900, None, "09:60"):
            raw = {"quietHours": {"start": start, "end": "07:00"}}
            self.assertIsNone(rules.parse_notify_rules(raw)["quietHours"])
        self.assertIsNone(rules.parse_notify_rules({"quietHours": "22:00"})["quietHours"])
        ok = rules.parse_notify_rules({"quietHours": {"start": "22:00", "end": "07:00"}})
        self.assertEqual(ok["quietHours"], {"start": "22:00", "end": "07:00"})

    def test_parse_de_campo_invalido_nao_derruba_os_vizinhos(self):
        parsed = rules.parse_notify_rules(
            {
                "kinds": {"likes": False, "opened": "nao", "inexistente": False},
                "onlyMine": True,
                "minLikes": "muitos",
                "ignoreDrafts": 1,
                "mutedAuthors": ["Ana", 3, None, ["x"]],
                "quietHours": {"start": "99:99", "end": "07:00"},
                "cooldownMinutes": 5,
            }
        )
        self.assertFalse(parsed["kinds"]["likes"])
        self.assertTrue(parsed["kinds"]["opened"])
        self.assertNotIn("inexistente", parsed["kinds"])
        self.assertTrue(parsed["onlyMine"])
        self.assertEqual(parsed["minLikes"], 0)
        self.assertFalse(parsed["ignoreDrafts"])
        self.assertEqual(parsed["mutedAuthors"], ["Ana"])
        self.assertIsNone(parsed["quietHours"])
        self.assertEqual(parsed["cooldownMinutes"], 5)

    def test_parse_de_inteiro_so_aceita_positivo_de_verdade(self):
        for value in (True, False, -1, 0, 1.5, "3", None, [], float("inf")):
            parsed = rules.parse_notify_rules({"minLikes": value, "cooldownMinutes": value})
            self.assertEqual((parsed["minLikes"], parsed["cooldownMinutes"]), (0, 0))
        self.assertEqual(rules.parse_notify_rules({"minLikes": 4})["minLikes"], 4)

    def test_parse_de_documento_que_nao_e_objeto_devolve_o_padrao(self):
        for raw in (None, [], "x", 3, [{"onlyMine": True}]):
            self.assertEqual(rules.parse_notify_rules(raw), rules.DEFAULT_NOTIFY_RULES)

    def test_parse_nao_compartilha_estado_com_o_padrao(self):
        parsed = rules.parse_notify_rules(None)
        parsed["kinds"]["likes"] = False
        parsed["mutedAuthors"].append("x")
        self.assertTrue(rules.DEFAULT_NOTIFY_RULES["kinds"]["likes"])
        self.assertEqual(rules.DEFAULT_NOTIFY_RULES["mutedAuthors"], [])

    def test_parse_de_kinds_que_nao_e_objeto_usa_o_padrao(self):
        for kinds in (None, [], "x", [["likes"]]):
            parsed = rules.parse_notify_rules({"kinds": kinds})
            self.assertEqual(parsed["kinds"], rules.DEFAULT_NOTIFY_RULES["kinds"])

    def test_evento_malformado_nao_derruba_o_filtro(self):
        gate = make_gate(minLikes=1, mutedAuthors=["x"], cooldownMinutes=5)
        weird = {"kind": ["lista"], "likes": None, "author": None, "url": ["u"]}
        self.assertEqual(gate.filter([weird], at(12)), [])
        gate.mark_notified([weird], at(12))


def make_criterion(
    field="likes", operator="gte", value="3", mode="notify", kinds=None, enabled=True, rule_id="r1"
):
    return {
        "id": rule_id,
        "field": field,
        "operator": operator,
        "value": value,
        "mode": mode,
        "kinds": kinds if kinds is not None else [],
        "enabled": enabled,
    }


def with_facts(event, **facts):
    return {**event, "facts": facts}


class RegrasDeCriterioTests(unittest.TestCase):
    def parse(self, items):
        return rules.parse_notify_rules({"rules": items})["rules"]

    def test_padrao_nao_tem_regra_de_criterio(self):
        self.assertEqual(rules.DEFAULT_NOTIFY_RULES["rules"], [])
        self.assertEqual(rules.parse_notify_rules(None)["rules"], [])

    def test_kinds_ausente_vazia_ou_desconhecida_vale_todos_os_tipos(self):
        base = make_criterion()
        sem_kinds = {key: value for key, value in base.items() if key != "kinds"}
        parsed = self.parse(
            [
                sem_kinds,
                {**base, "kinds": []},
                {**base, "kinds": ["inexistente"]},
                {**base, "kinds": "likes"},
                {**base, "kinds": ["inexistente", "likes"]},
            ]
        )
        self.assertEqual([item["kinds"] for item in parsed], [[], [], [], [], ["likes"]])

    def test_item_de_campo_operador_ou_modo_desconhecido_cai_e_os_vizinhos_ficam(self):
        parsed = self.parse(
            [
                make_criterion(rule_id="a"),
                make_criterion(field="inexistente", rule_id="b"),
                make_criterion(operator="maior", rule_id="c"),
                make_criterion(mode="avisar", rule_id="d"),
                "lixo",
                make_criterion(rule_id="e"),
            ]
        )
        self.assertEqual([item["id"] for item in parsed], ["a", "e"])

    def test_rules_que_nao_e_lista_volta_a_lista_vazia(self):
        for raw in (None, "x", 3, {"a": 1}):
            self.assertEqual(self.parse(raw), [])

    def test_mute_ligada_descarta_o_evento_que_cobre(self):
        gate = make_rules_gate(rules=[make_criterion("draft", "eq", "true", "mute")])
        quieto = with_facts(make_event(), draft=True)
        normal = with_facts(make_event(), draft=False)
        self.assertEqual(gate.filter([quieto, normal], at(12)), [normal])

    def test_mute_desligada_e_ignorada(self):
        gate = make_rules_gate(rules=[make_criterion("draft", "eq", "true", "mute", enabled=False)])
        event = with_facts(make_event(), draft=True)
        self.assertEqual(gate.filter([event], at(12)), [event])

    def test_com_notify_cobrindo_o_tipo_so_passa_quem_casa(self):
        gate = make_rules_gate(rules=[make_criterion("likes", "gte", "3", "notify")])
        casa = with_facts(make_event(), likes=5)
        nao_casa = with_facts(make_event(), likes=1)
        self.assertEqual(gate.filter([casa, nao_casa], at(12)), [casa])

    def test_notify_so_restringe_os_tipos_que_cobre(self):
        gate = make_rules_gate(rules=[make_criterion("likes", "gte", "3", "notify", kinds=["likes"])])
        likes = with_facts(make_event(kind="likes"), likes=1)
        pipeline = with_facts(make_event(kind="pipeline"), likes=1)
        self.assertEqual(gate.filter([likes, pipeline], at(12)), [pipeline])

    def test_notify_desligada_nao_poe_o_tipo_em_lista_de_inclusao(self):
        gate = make_rules_gate(rules=[make_criterion("likes", "gte", "3", "notify", enabled=False)])
        event = with_facts(make_event(), likes=0)
        self.assertEqual(gate.filter([event], at(12)), [event])

    def test_mute_vence_notify_para_o_mesmo_evento(self):
        gate = make_rules_gate(
            rules=[
                make_criterion("likes", "gte", "3", "notify", rule_id="a"),
                make_criterion("author", "eq", "ana.lima", "mute", rule_id="b"),
            ]
        )
        event = with_facts(make_event(), likes=9, author="ana.lima")
        self.assertEqual(gate.filter([event], at(12)), [])

    def test_so_mute_ligada_nao_bloqueia_quem_ela_nao_cobre(self):
        gate = make_rules_gate(rules=[make_criterion("draft", "eq", "true", "mute")])
        event = with_facts(make_event(), draft=False)
        self.assertEqual(gate.filter([event], at(12)), [event])

    def test_evento_sem_facts_passa_intocado_por_criterio_nenhum(self):
        # `left` nunca traz facts: o MR saiu da lista. Nem mute o descarta, nem
        # a restrição de notify o alcança.
        gate = make_rules_gate(
            rules=[
                make_criterion("likes", "gte", "3", "notify"),
                make_criterion("draft", "neq", "true", "mute", rule_id="b"),
            ]
        )
        left = make_event(kind="left")
        self.assertNotIn("facts", left)
        self.assertEqual(gate.filter([left], at(12)), [left])

    def test_com_os_criterios_decidindo_o_tipo_desligado_no_geral_nao_cala(self):
        # Um lado só vale por vez: `kinds` é do Geral, e ali não é consultado.
        event = with_facts(make_event(kind="likes"), likes=5)
        kinds = {**rules.DEFAULT_NOTIFY_RULES["kinds"], "likes": False}
        criterios = [make_criterion("likes", "gte", "0", "notify")]
        self.assertEqual(
            make_rules_gate(kinds=kinds, rules=criterios).filter([event], at(12)), [event]
        )
        self.assertEqual(make_gate(kinds=kinds, rules=criterios).filter([event], at(12)), [])

    def test_com_o_geral_decidindo_o_criterio_mute_nao_descarta(self):
        gate = make_gate(rules=[make_criterion("draft", "eq", "true", "mute")])
        event = with_facts(make_event(), draft=True)
        self.assertEqual(gate.filter([event], at(12)), [event])

    def test_silencio_e_espera_valem_com_os_criterios(self):
        gate = make_rules_gate(
            rules=[make_criterion("likes", "gte", "0", "notify")],
            quietHours={"start": "00:00", "end": "23:59"},
        )
        self.assertEqual(gate.filter([with_facts(make_event(), likes=5)], at(12)), [])

    def test_facts_nulo_ou_que_nao_e_objeto_vale_como_sem_facts(self):
        gate = make_rules_gate(rules=[make_criterion("likes", "gte", "3", "notify")])
        for facts in (None, [], "x", 3):
            event = make_event(facts=facts)
            self.assertEqual(gate.filter([event], at(12)), [event])

    def test_regra_de_criterio_nao_precisa_de_tom(self):
        gate = make_rules_gate(rules=self.parse([make_criterion("likes", "gte", "3")]))
        event = with_facts(make_event(), likes=5)
        self.assertEqual(gate.filter([event], at(12)), [event])


class MarkStyleTests(unittest.TestCase):
    def test_devolve_o_traco_que_o_tom_ja_desenhava_sem_mark_style(self):
        self.assertEqual(rules.mark_style_of({"tone": "danger"}), "solid")
        self.assertEqual(rules.mark_style_of({"tone": "warning"}), "dashed")
        self.assertEqual(rules.mark_style_of({"tone": "success"}), "double")
        self.assertEqual(rules.mark_style_of({"tone": "strong"}), "dotted")

    def test_devolve_o_traco_guardado_quando_conhecido(self):
        self.assertEqual(rules.mark_style_of({"tone": "danger", "markStyle": "dotted"}), "dotted")

    def test_descarta_traco_desconhecido(self):
        self.assertEqual(rules.mark_style_of({"tone": "warning", "markStyle": "neon"}), "dashed")
        self.assertEqual(rules.mark_style_of({"tone": "warning", "markStyle": 42}), "dashed")

    def test_tons_novos_comecam_em_solid(self):
        self.assertEqual(rules.mark_style_of({"tone": "info"}), "solid")
        self.assertEqual(rules.mark_style_of({"tone": "neutral"}), "solid")

    def test_parse_aceita_tom_novo_e_normaliza_mark_style(self):
        raw = [make_rule("likes", "gte", "1", "info") | {"markStyle": 42}]
        parsed = rules.parse_highlight_rules(raw)
        self.assertEqual(len(parsed), 1)
        self.assertEqual(parsed[0]["markStyle"], "solid")


if __name__ == "__main__":
    unittest.main()
