"""Tabela do terminal: desenho, largura real e preferências de coluna.

Módulo só com biblioteca padrão. Não importa `gitlab_monitor` (seria um
import circular): quem desenha passa as colunas, que precisam apenas de
`key`, `label`, `width` e `weight`.
"""

import re
import shutil
import sys
import textwrap
import unicodedata

from monitor_rules import first_match
from monitor_text import translate

# A largura de antes desta tabela se adaptar: vale quando a saída não é um
# terminal, para que quem lê o texto redirecionado continue lendo o mesmo.
FALLBACK_WIDTH = 250
# Menor largura de conteúdo que ainda deixa uma coluna legível.
MIN_COLUMN_WIDTH = 8
# A coluna de maior peso (a que carrega o texto longo) tem piso próprio: com
# o mínimo comum, um título de 90 caracteres viraria quatorze linhas de oito.
MAIN_COLUMN_MIN_WIDTH = 20


# Cor (CSI ... m) e link (OSC 8): nenhum dos dois ocupa coluna no terminal.
_ESCAPES = re.compile("\033\\[[0-9;]*m|\033\\]8;;[^\033]*\033\\\\")

# Um código por tom, escolhidos para se distinguirem em fundo claro e escuro:
# nada de branco, preto ou amarelo puro, que somem num dos dois. O destaque
# forte é negrito, sem cor, para não disputar com os quatro semânticos; o neutro
# é cinza-claro (90), legível nos dois fundos.
# O `markStyle` da regra (traço da borda) não vale no terminal, que não tem borda:
# aqui o tom escolhe só a cor e o caractere do marcador.
TONE_CODES = {
    "danger": "31",
    "warning": "38;5;172",
    "success": "32",
    "strong": "1",
    "info": "36",
    "neutral": "90",
}

# O par textual do marcador de borda do painel: a linha destacada continua
# destacada num pipe ou num terminal sem cor. Um caractere de largura 1 por tom.
ROW_MARKS = {
    "danger": "!",
    "warning": "~",
    "success": "+",
    "strong": "*",
    "info": "=",
    "neutral": "-",
}


def text_width(value):
    # Emoji e caracteres largos ocupam duas colunas no terminal.
    return sum(2 if unicodedata.east_asian_width(c) in "WF" else 1
               for c in _ESCAPES.sub("", value))


def paint(value, tone, color):
    """Pinta `value` com o tom; sem `color`, ou sem tom conhecido, não toca nele."""
    if not color or tone not in TONE_CODES or not value:
        return value
    return f"\033[{TONE_CODES[tone]}m{value}\033[0m"


def hyperlink(text, url):
    """OSC 8: o terminal mostra só o texto, e os códigos não ocupam colunas."""
    return f"\033]8;;{url}\033\\{text}\033]8;;\033\\"


def visible_columns(columns, hidden, order):
    """Tira as ocultas e aplica a ordem; a coluna que `order` não conhece vai ao fim."""
    hidden = {key for key in (hidden or ()) if isinstance(key, str)}
    position = {key: index for index, key in enumerate(order or ())
                if isinstance(key, str)}
    kept = [column for column in columns if column.key not in hidden]
    # sorted é estável: as desconhecidas ficam no fim, na ordem original.
    return sorted(kept, key=lambda column: position.get(column.key, len(position)))


def _frame_width(count):
    # "│ " + " │ " entre colunas + " │"
    return 4 + 3 * (count - 1)


def fit_columns(columns, available):
    """Distribui `available` (largura total da linha, moldura inclusa) pelos pesos.

    Nenhuma coluna passa da largura natural nem fica abaixo do mínimo; se
    os mínimos não cabem, sacrifica a de menor peso (a última, no empate).
    Sempre devolve ao menos uma coluna.
    """
    columns = list(columns)
    if not columns:
        return []
    minimum = {column.key: min(column.width, MIN_COLUMN_WIDTH) for column in columns}
    main = max(columns, key=lambda column: column.weight)
    minimum[main.key] = min(main.width, MAIN_COLUMN_MIN_WIDTH)
    kept = list(columns)
    while len(kept) > 1 and (_frame_width(len(kept)) + sum(minimum[c.key] for c in kept)
                             > available):
        # A de maior peso nunca é sacrificada: é ela que o piso protege.
        weakest = min((i for i in range(len(kept)) if kept[i] is not main),
                      key=lambda i: (kept[i].weight, -i))
        del kept[weakest]
    budget = max(1, available - _frame_width(len(kept)))
    if len(kept) == 1:
        return [(kept[0], max(1, min(kept[0].width, budget)))]

    # Cada uma começa no mínimo; só a sobra é dividida pelos pesos.
    widths = dict(minimum)
    remaining = budget - sum(widths.values())
    pending = [c for c in kept if widths[c.key] < c.width]
    while pending and remaining > 0:
        total_weight = sum(max(c.weight, 1) for c in pending)
        share = {c.key: remaining * max(c.weight, 1) / total_weight for c in pending}
        full = [c for c in pending if share[c.key] >= c.width - widths[c.key]]
        if not full:
            for column in pending:
                widths[column.key] += int(share[column.key])
            remaining = budget - sum(widths.values())
            # Os centavos da divisão vão, um a um, para os de maior peso.
            for column in sorted(pending, key=lambda c: -c.weight):
                if remaining > 0 and widths[column.key] < column.width:
                    widths[column.key] += 1
                    remaining -= 1
            break
        for column in full:
            remaining -= column.width - widths[column.key]
            widths[column.key] = column.width
            pending.remove(column)
    return [(column, widths[column.key]) for column in kept]


def wrap_width(value, limit):
    """Quebra por largura de exibição: emoji e CJK valem duas colunas, e `len` não vê isso."""
    limit = max(1, limit)
    lines = []
    for line in textwrap.wrap(value, limit):
        if text_width(line) <= limit:
            lines.append(line)
            continue
        current = ""
        for word in line.split(" "):
            candidate = f"{current} {word}" if current else word
            if text_width(candidate) <= limit:
                current = candidate
                continue
            if current:
                lines.append(current)
                current = ""
            # Palavra maior que a coluna: parte por caractere, ao menos um por linha.
            for char in word:
                if current and text_width(current + char) > limit:
                    lines.append(current)
                    current = ""
                current += char
        if current:
            lines.append(current)
    return lines


MARK_FRAME = 4


def _terminal_width():
    if sys.stdout.isatty():
        return shutil.get_terminal_size((FALLBACK_WIDTH, 24)).columns
    return FALLBACK_WIDTH


def render_table(rows, columns, width=None, links=None, hidden_columns=(),
                 column_order=(), color=False, row_rules=()):
    """Desenha as linhas em `columns`, sem passar de `width` colunas.

    Sem `width` e sem terminal, a largura é a fixa de sempre e todas as
    colunas aparecem: só um terminal de verdade se adapta.

    `color` pinta cada célula com o tom de `row["<coluna>_tone"]`. `row_rules`
    são as regras de destaque: a primeira ligada que casa com `row["facts"]`
    dá o tom da linha, e o marcador (e a cor dele) vai numa coluna estreita à
    esquerda, que só existe quando há regras.
    """
    interactive = sys.stdout.isatty()
    if links is None:
        # Redirecionado para arquivo ou pipe, o link viraria lixo no texto.
        links = interactive
    adapt = width is not None or interactive
    if width is None:
        width = _terminal_width()
    shown = visible_columns(columns, hidden_columns, column_order)
    if not shown:
        shown = list(columns)[:1]
    # Só regra ligada pode casar (`first_match`), então uma lista inteira
    # desligada não ganha coluna: ela ficaria sempre vazia, custando moldura.
    marked = any(rule.get("enabled") for rule in row_rules)
    if adapt:
        # A coluna do marcador: "m │ " a mais na moldura.
        allotted = fit_columns(shown, width - (MARK_FRAME if marked else 0))
    else:
        allotted = [(column, column.width) for column in shown]
    shown = [column for column, _ in allotted]
    limits = [limit for _, limit in allotted]

    # O cabeçalho também quebra, para que um título longo não alargue a coluna.
    head = [wrap_width(column.label, limit) or [""]
            for column, limit in zip(shown, limits)]
    body = [[wrap_width(row[column.key], limit) or [""]
             for column, limit in zip(shown, limits)] for row in rows]
    widths = [max(text_width(line) for cells in [head, *body] for line in cells[index])
              for index in range(len(shown))]
    if marked:
        widths.insert(0, 1)

    def rule(left, middle, right):
        return left + middle.join("─" * (size + 2) for size in widths) + right

    def cell(value, size, url, tone):
        # O recuo é calculado sobre o texto puro e fica fora do link e da cor:
        # escape não ocupa coluna, mas contá-lo estragaria o alinhamento.
        padding = " " * (size - text_width(value))
        if url and value:
            return hyperlink(value, url) + padding
        return paint(value, tone, color) + padding

    def block(cells, url=None, row=None, mark=None):
        out = []
        for index in range(max(len(line) for line in cells)):
            parts = [cell(line[index] if index < len(line) else "", size,
                          url if column.key == "mr" else None,
                          (row or {}).get(f"{column.key}_tone"))
                     for column, line, size in zip(shown, cells, widths[int(marked):])]
            if marked:
                # O marcador só na primeira linha da linha lógica.
                first = bool(mark) and index == 0
                parts.insert(0, paint(ROW_MARKS[mark], mark, color) if first else " ")
            out.append("│ " + " │ ".join(parts) + " │")
        return out

    lines = [rule("┌", "┬", "┐"), *block(head), rule("├", "┼", "┤")]
    for cells, row in zip(body, rows):
        match = first_match(row_rules, row.get("facts") or {}) if marked else None
        tone = match.get("tone") if match else None
        lines.extend(block(cells, row.get("url") if links else None, row,
                           tone if tone in ROW_MARKS else None))
    lines.append(rule("└", "┴", "┘"))
    return "\n".join(lines)


def summary_line(rows, language="pt", shown=None, failed=()):
    """Uma linha com o que importa nas linhas coletadas: o total aberto e,
    só quando não é zero, quantas têm pipeline falhando, quantas estão
    bloqueadas e quantas esperam a minha revisão.

    `shown` é quantas linhas o filtro deixou; só aparece quando é menor que o
    total. `failed` são os alvos que não responderam no ciclo."""
    total = len(rows)
    failing = sum(1 for row in rows if row.get("status") == "failed")
    blocked = sum(1 for row in rows
                  if row.get("mergeable_value") is False or row.get("conflicts_value"))
    awaiting = sum(1 for row in rows
                   if row.get("reviewing_mine") and row.get("my_review_state") == "unreviewed")
    parts = [translate("summary.open", language, count=total)]
    if shown is not None and shown < total:
        parts.append(translate("summary.filtered", language, shown=shown, total=total))
    for key, count in (("summary.pipeline-failed", failing), ("summary.blocked", blocked),
                       ("summary.awaiting-me", awaiting)):
        if count:
            parts.append(translate(key, language, count=count))
    if failed:
        parts.append(translate("summary.targets-failed", language, targets=", ".join(failed)))
    return " · ".join(parts)
