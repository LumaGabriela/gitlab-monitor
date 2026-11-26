"""Catálogo pt/en dos textos que o terminal imprime.

Módulo puro: um dicionário por idioma e `str.format`, sem I/O e sem import do
monitor. O nome das chaves e dos marcadores é o contrato com quem chama; o
`pt` é a referência de redação e o `en` diz o mesmo, com os mesmos marcadores.
"""

LANGUAGES = ("pt", "en")
DEFAULT_LANGUAGE = "pt"

CATALOG = {
    "pt": {
        "event.opened": "novo MR aberto",
        "event.left-merged": "mergeado",
        "event.left-closed": "fechado",
        "event.left-other": "saiu da lista de abertos ({state})",
        "event.likes": "likes {before} → {after}",
        "event.review-requested": "revisão pedida a você",
        "event.review-removed": "você não é mais revisora deste MR",
        "event.pipeline": "pipeline {before} → {after}",
        "event.discussions": "discussões {before} → {after}",
        "event.threads-resolved": "{count} thread(s) resolvida(s)",
        "event.threads-reopened": "{count} thread(s) reaberta(s)",
        "event.threads-replied": "{count} thread(s) com resposta nova",
        "summary.open": "{count} aberto(s)",
        "summary.pipeline-failed": "{count} com pipeline falha",
        "summary.blocked": "{count} bloqueado(s)",
        "summary.awaiting-me": "{count} esperando você",
        "summary.interval": "próxima coleta em {minutes} min",
        "summary.targets-failed": "sem resposta de: {targets}",
        "summary.filtered": "mostrando {shown} de {total}",
        "monitor.started": "Monitorando {targets} a cada {minutes} min. Ctrl+C para parar.",
        "monitor.reference-saved": "Referência salva ({count} MR(s)).",
        "monitor.changes": "{before} → {after}: {changes} mudança(s)",
        "monitor.muted": "{count} aviso(s) silenciado(s) pelas regras",
        "monitor.quiet": "sem mudanças",
        "legend.rule": "{mark} {text}",
    },
    "en": {
        "event.opened": "new MR opened",
        "event.left-merged": "merged",
        "event.left-closed": "closed",
        "event.left-other": "left the open list ({state})",
        "event.likes": "likes {before} → {after}",
        "event.review-requested": "review requested from you",
        "event.review-removed": "you are no longer a reviewer on this MR",
        "event.pipeline": "pipeline {before} → {after}",
        "event.discussions": "discussions {before} → {after}",
        "event.threads-resolved": "{count} thread(s) resolved",
        "event.threads-reopened": "{count} thread(s) reopened",
        "event.threads-replied": "{count} thread(s) with a new reply",
        "summary.open": "{count} open",
        "summary.pipeline-failed": "{count} with a failed pipeline",
        "summary.blocked": "{count} blocked",
        "summary.awaiting-me": "{count} waiting on you",
        "summary.interval": "next check in {minutes} min",
        "summary.targets-failed": "no response from: {targets}",
        "summary.filtered": "showing {shown} of {total}",
        "monitor.started": "Monitoring {targets} every {minutes} min. Ctrl+C to stop.",
        "monitor.reference-saved": "Reference saved ({count} MR(s)).",
        "monitor.changes": "{before} → {after}: {changes} change(s)",
        "monitor.muted": "{count} alert(s) muted by the rules",
        "monitor.quiet": "no changes",
        "legend.rule": "{mark} {text}",
    },
}


class _KeepMissing(dict):
    """Marcador sem valor volta como `{nome}`, em vez de levantar KeyError."""

    def __missing__(self, name):
        return "{" + name + "}"


def translate(key, language=DEFAULT_LANGUAGE, **values):
    """Texto da chave no idioma; chave ausente devolve a chave, idioma ausente cai em pt.

    Nunca levanta: o laço de monitoramento não pode morrer por causa de um
    texto. Marcador sem valor fica visível como `{nome}`, e o valor entra como
    dado, nunca como modelo (um título com chaves não é reinterpretado).
    """
    catalog = CATALOG.get(language) if isinstance(language, str) else None
    template = (catalog or CATALOG[DEFAULT_LANGUAGE]).get(key)
    if template is None:
        return key
    try:
        return template.format_map(_KeepMissing(values))
    except (ValueError, IndexError, KeyError, AttributeError):
        return template
