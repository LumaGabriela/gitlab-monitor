"""Motor das regras de destaque de linha, porte de core/rules/rule-engine.ts.

Funções puras que comparam os fatos crus de uma linha (`facts`, de
`serialize_row`) com o que a pessoa escolheu. Sem I/O e sem import do monitor.
A regra sem valor utilizável, de campo ou de operador desconhecido nunca casa.
"""

import copy
import math
import re
from datetime import datetime, timedelta

RULE_FIELD_KINDS = {
    "likes": "number",
    "unresolved": "number",
    "participants": "number",
    "ageHours": "number",
    "idleHours": "number",
    "mergeable": "boolean",
    "conflicts": "boolean",
    "mine": "boolean",
    "involved": "boolean",
    "draft": "boolean",
    "pipeline": "text",
    "author": "text",
    "assignedToMe": "boolean",
    "reviewingMine": "boolean",
    "myReviewState": "text",
    "assignees": "number",
    "reviewers": "number",
}

RULE_OPERATORS = ("gte", "lte", "eq", "neq")
RULE_TONES = ("danger", "warning", "success", "strong", "info", "neutral")
RULE_MARK_STYLES = ("solid", "dashed", "dotted", "double")
RULE_MODES = ("notify", "mute")

# O traço que cada tom já desenhava antes de cor e traço se separarem; os tons
# novos começam em "solid".
DEFAULT_MARK_STYLE = {
    "danger": "solid",
    "warning": "dashed",
    "success": "double",
    "strong": "dotted",
    "info": "solid",
    "neutral": "solid",
}


def mark_style_of(rule):
    """O traço da regra: o guardado quando é conhecido; senão, o padrão do tom."""
    stored = rule.get("markStyle")
    if isinstance(stored, str) and stored in RULE_MARK_STYLES:
        return stored
    return DEFAULT_MARK_STYLE[rule["tone"]]

# "Maior ou igual" sobre booleano ou texto nunca casa: só oferece o que compara.
RULE_OPERATORS_BY_KIND = {
    "number": ("gte", "lte", "eq", "neq"),
    "boolean": ("eq", "neq"),
    "text": ("eq", "neq"),
}


def _parse_number(raw):
    """Número finito e não negativo; qualquer outra coisa é None."""
    if not isinstance(raw, str) or raw.strip() == "" or "_" in raw:
        return None
    try:
        value = float(raw)
    except ValueError:
        return None
    return value if math.isfinite(value) and value >= 0 else None


def _parse_boolean(raw):
    value = raw.strip().lower()
    if value == "true":
        return True
    if value == "false":
        return False
    return None


def _compare_number(operator, fact, raw):
    target = _parse_number(raw)
    if target is None or isinstance(fact, bool) or not isinstance(fact, (int, float)):
        return False
    if operator == "gte":
        return fact >= target
    if operator == "lte":
        return fact <= target
    if operator == "eq":
        return fact == target
    if operator == "neq":
        return fact != target
    return False


def _compare_equality(operator, equal):
    """`neq` é a negação de `eq`; maior e menor não fazem sentido fora de número."""
    if operator == "eq":
        return equal
    if operator == "neq":
        return not equal
    return False


def matches(rule, facts):
    field = rule.get("field")
    # Chave não-hasheável (lista, dicionário) vem de JSON não confiável: não casa.
    kind = RULE_FIELD_KINDS.get(field) if isinstance(field, str) else None
    value = rule.get("value")
    # Sem checar o tom: a regra de aviso não tem tom, e quem o exige é o parse
    # das regras de destaque (`parse_highlight_rules`).
    if kind is None or not isinstance(value, str) or not isinstance(facts, dict):
        return False
    fact = facts.get(field)
    operator = rule.get("operator")
    if kind == "number":
        return _compare_number(operator, fact, value)
    if kind == "boolean":
        target = _parse_boolean(value)
        if target is None:
            return False
        # Fato desconhecido (None) não é verdadeiro nem falso: só `neq` o inclui.
        return _compare_equality(operator, fact is target)
    target = value.strip().lower()
    if target == "":
        return False
    return _compare_equality(operator, str(fact).strip().lower() == target)


def first_match(rules, facts):
    """A primeira regra ligada que casa decide a linha."""
    for rule in rules:
        if rule.get("enabled") and matches(rule, facts):
            return rule
    return None


def parse_highlight_rules(raw):
    """Descarta item de campo, operador ou tom desconhecido, ou de valor que não é texto.

    O `markStyle` ausente ou inválido não descarta: é normalizado para o padrão do tom.
    """
    if not isinstance(raw, list):
        return []
    parsed = []
    for item in raw:
        if (
            isinstance(item, dict)
            and isinstance(item.get("field"), str)
            and item["field"] in RULE_FIELD_KINDS
            and item.get("operator") in RULE_OPERATORS
            and item.get("tone") in RULE_TONES
            and isinstance(item.get("value"), str)
        ):
            parsed.append({**item, "markStyle": mark_style_of(item)})
    return parsed


# ---------------------------------------------------------------------------
# Filtro de notificação, porte de core/services/notify-rules.service.ts
# ---------------------------------------------------------------------------

NOTIFY_EVENT_KINDS = ("opened", "likes", "pipeline", "threads", "left", "review")

# Quem decide o que vira aviso: o corte geral ou os critérios. Um só vale.
NOTIFY_DECIDERS = ("general", "rules")

DEFAULT_NOTIFY_RULES = {
    "decider": "general",
    "kinds": {kind: True for kind in NOTIFY_EVENT_KINDS},
    "onlyMine": False,
    "minLikes": 0,
    "ignoreDrafts": False,
    "mutedAuthors": [],
    "quietHours": None,
    "cooldownMinutes": 0,
    "rules": [],
}

# HH:MM de 24h, com zero à esquerda. `\Z` e não `$`: o `$` aceitaria "09:00\n".
_TIME_PATTERN = re.compile(r"([01]\d|2[0-3]):[0-5]\d\Z")


def _non_negative_int(value):
    """Inteiro positivo; o resto vira 0. `True` é int em Python, e não é contagem."""
    if isinstance(value, bool) or not isinstance(value, int):
        return 0
    return value if value > 0 else 0


def _valid_time(value):
    return isinstance(value, str) and _TIME_PATTERN.match(value) is not None


def _minutes_of(time):
    hours, minutes = time.split(":")
    return int(hours) * 60 + int(minutes)


def is_quiet(quiet_hours, now):
    """Compara HH:MM locais. Com `start > end` a janela atravessa a meia-noite
    e é a união dos dois trechos; início igual ao fim é janela vazia."""
    start = _minutes_of(quiet_hours["start"])
    end = _minutes_of(quiet_hours["end"])
    current = now.hour * 60 + now.minute
    if start == end:
        return False
    if start < end:
        return start <= current < end
    return current >= start or current < end


def _is_notify_rule(item):
    """Regra de critério legível: campo, operador e modo conhecidos."""
    return (
        isinstance(item, dict)
        and isinstance(item.get("id"), str)
        and isinstance(item.get("field"), str)
        and item["field"] in RULE_FIELD_KINDS
        and item.get("operator") in RULE_OPERATORS
        and isinstance(item.get("value"), str)
        and item.get("mode") in RULE_MODES
        and isinstance(item.get("enabled"), bool)
    )


def _parse_notify_criteria(raw):
    """Descarta item ilegível, mantendo os vizinhos. `kinds` ausente, vazia ou só
    de tipos desconhecidos vale como todos os tipos (lista vazia)."""
    if not isinstance(raw, list):
        return []
    parsed = []
    for item in raw:
        if not _is_notify_rule(item):
            continue
        raw_kinds = item.get("kinds")
        kinds = (
            [kind for kind in raw_kinds if isinstance(kind, str) and kind in NOTIFY_EVENT_KINDS]
            if isinstance(raw_kinds, list)
            else []
        )
        parsed.append(
            {
                "id": item["id"],
                "field": item["field"],
                "operator": item["operator"],
                "value": item["value"],
                "mode": item["mode"],
                "kinds": kinds,
                "enabled": item["enabled"],
            }
        )
    return parsed


def covers_kind(rule, kind):
    """A regra está ligada e vale para o tipo (`kinds` vazia = todos). Só olha o
    tipo, nunca os fatos: é o que põe o tipo em regime de lista de inclusão."""
    if not rule.get("enabled"):
        return False
    kinds = rule.get("kinds")
    return not kinds or kind in kinds


def has_facts(event):
    """O evento traz fatos: ausente, `None` e o que não é objeto valem como sem
    fatos, igual a `hasFacts` do painel."""
    return isinstance(event.get("facts"), dict)


def applies(rule, event):
    """Cobre o tipo do evento e casa com os fatos dele; evento sem `facts` não casa."""
    return covers_kind(rule, event.get("kind")) and has_facts(event) and matches(rule, event["facts"])


def passes_criteria(criteria, event):
    """Fase das regras de critério, depois do corte geral. Evento sem `facts` passa
    intocado: o MR que saiu da lista não tem linha, e calá-lo por falta de fato
    seria calá-lo para sempre. Regra `mute` aplicável descarta; havendo regra
    `notify` ligada para o tipo, só passa quem casa com alguma."""
    if not has_facts(event):
        return True
    if any(rule["mode"] == "mute" and applies(rule, event) for rule in criteria):
        return False
    kind = event.get("kind")
    notify = [rule for rule in criteria if rule["mode"] == "notify"]
    if not any(covers_kind(rule, kind) for rule in notify):
        return True
    return any(applies(rule, event) for rule in notify)


def parse_notify_rules(raw):
    """Cada campo é lido sozinho: o que não se entende volta ao padrão, sem
    derrubar os vizinhos. O padrão devolvido é sempre uma cópia."""
    rules = copy.deepcopy(DEFAULT_NOTIFY_RULES)
    if not isinstance(raw, dict):
        return rules
    raw_kinds = raw.get("kinds")
    if isinstance(raw_kinds, dict):
        for kind in NOTIFY_EVENT_KINDS:
            if isinstance(raw_kinds.get(kind), bool):
                rules["kinds"][kind] = raw_kinds[kind]
    rules["decider"] = "rules" if raw.get("decider") == "rules" else "general"
    rules["onlyMine"] = raw.get("onlyMine") is True
    rules["minLikes"] = _non_negative_int(raw.get("minLikes"))
    rules["ignoreDrafts"] = raw.get("ignoreDrafts") is True
    muted = raw.get("mutedAuthors")
    if isinstance(muted, list):
        rules["mutedAuthors"] = [item for item in muted if isinstance(item, str)]
    quiet = raw.get("quietHours")
    if isinstance(quiet, dict) and _valid_time(quiet.get("start")) and _valid_time(quiet.get("end")):
        rules["quietHours"] = {"start": quiet["start"], "end": quiet["end"]}
    rules["cooldownMinutes"] = _non_negative_int(raw.get("cooldownMinutes"))
    rules["rules"] = _parse_notify_criteria(raw.get("rules"))
    return rules


class NotifyGate:
    """Quais eventos merecem aviso. O que as regras, o silêncio ou a espera
    barram é descartado: não fica numa fila para avisar depois."""

    def __init__(self, rules):
        self.rules = rules
        # Quando cada MR avisou pela última vez, pela URL; só em memória. A chave
        # é a URL e não o `mr`: dois alvos em modo projeto repetem o mesmo `!7`.
        self._last_notified = {}

    def filter(self, events, now=None):
        """Os eventos que passam, já descontados silêncio e espera. Não escreve nada."""
        now = now or datetime.now()
        rules = self.rules
        quiet = rules.get("quietHours")
        if quiet and is_quiet(quiet, now):
            return []
        muted = {author.lower() for author in rules.get("mutedAuthors", []) if isinstance(author, str)}
        cooldown = timedelta(minutes=rules.get("cooldownMinutes", 0))
        return [event for event in events if self._passes(event, rules, muted, cooldown, now)]

    def mark_notified(self, events, now=None):
        """Registra o aviso entregue, o que inicia a espera de cada MR. Separado
        de `filter` para que um lote não entregue não seja cortado quando voltar."""
        now = now or datetime.now()
        for event in events:
            url = event.get("url")
            if isinstance(url, str):
                self._last_notified[url] = now

    def _passes(self, event, rules, muted, cooldown, now):
        # A espera vale nos dois lados, como o silêncio: é limite de incômodo,
        # e não critério de interesse.
        if self._cooling_down(event.get("url"), cooldown, now):
            return False
        if rules.get("decider") == "rules":
            return passes_criteria(rules.get("rules", []), event)
        kind = event.get("kind")
        if isinstance(kind, str) and rules["kinds"].get(kind) is False:
            return False
        if rules.get("onlyMine") and not event.get("involved"):
            return False
        likes = event.get("likes")
        if _non_negative_int(likes) < rules.get("minLikes", 0):
            return False
        if rules.get("ignoreDrafts") and event.get("draft"):
            return False
        author = event.get("author")
        if isinstance(author, str) and author.lower() in muted:
            return False
        return True

    def _cooling_down(self, url, cooldown, now):
        last = self._last_notified.get(url) if isinstance(url, str) else None
        return cooldown > timedelta(0) and last is not None and now - last < cooldown
