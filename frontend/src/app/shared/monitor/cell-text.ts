import { TranslateService } from '@ngx-translate/core';
import { CellModel, ColumnModel } from '../../core/models/api/panel-api.model';
import { JUST_NOW_KEY, formatDate, formatRelative, formatTime } from './cell-format';

/**
 * O texto de uma chave no idioma de quem olha, ou `fallback` quando a chave
 * não existe no catálogo (ou ele ainda não chegou): o rótulo do backend
 * aparece, nunca a chave crua. Mesma regra do `columnLabel()`.
 *
 * Quem chama precisa ler o sinal de idioma antes, porque o catálogo chega
 * por HTTP depois da primeira renderização.
 */
export function translatedOr(
  translate: TranslateService,
  key: string,
  fallback: string,
  params?: Record<string, unknown>,
): string {
  const traduzido = String(translate.instant(key, params));
  return traduzido === key ? fallback : traduzido;
}

/** Texto da célula no idioma ativo, a partir dos valores crus que o backend
 * manda ao lado do rótulo. Sem o valor cru, vale o rótulo. */
export function cellText(
  translate: TranslateService,
  column: ColumnModel,
  cell: CellModel,
  lang: string,
): string {
  const label = cell.label;
  switch (column.key) {
    case 'updated_label':
    case 'created_label': {
      if (!cell.iso) return label;
      if (column.cell !== 'time') return formatDate(cell.iso, lang) || label;
      const relativo = formatRelative(cell.iso, lang);
      if (!relativo) return label;
      return relativo === JUST_NOW_KEY ? translatedOr(translate, JUST_NOW_KEY, label) : relativo;
    }
    case 'pipeline': {
      if (cell.status === undefined) return label;
      const chave = cell.status ? `pipeline.${cell.status.replace(/_/g, '-')}` : 'pipeline.none';
      return translatedOr(translate, chave, label);
    }
    case 'threads': {
      if (cell.total === undefined || cell.resolved === undefined) return label;
      return cell.total
        ? translatedOr(translate, 'monitor.threads-count', label, {
            resolved: cell.resolved,
            total: cell.total,
          })
        : translatedOr(translate, 'monitor.threads-none', label);
    }
    case 'mergeable':
    case 'conflicts': {
      if (cell.value === undefined) return label;
      // "desconhecido" é um texto só para as duas colunas, como no backend.
      const estado = cell.value === null ? 'mergeable-unknown' : `${column.key}-${cell.value}`;
      return translatedOr(translate, `monitor.${estado}`, label);
    }
    case 'openers':
      if (!cell.names) return label;
      return cell.names.length
        ? cell.names.join(', ')
        : translatedOr(translate, 'common.none', label);
    default:
      return label;
  }
}

/**
 * Nome acessível do selo, quando o texto visível é curto demais para se
 * explicar sozinho. Hoje só a coluna de threads: na tela cabe "4/7", mas no
 * leitor de tela isso não diz o que é resolvido nem o que é total.
 *
 * Devolve `null` quando o texto visível já basta — aí o selo não ganha
 * `aria-label` e é lido como está.
 */
export function cellLabel(
  translate: TranslateService,
  column: ColumnModel,
  cell: CellModel,
): string | null {
  if (column.key !== 'threads') return null;
  if (!cell.total || cell.resolved === undefined) return null;
  return translatedOr(translate, 'monitor.threads-count-long', cell.label, {
    resolved: cell.resolved,
    total: cell.total,
  });
}

/** Dica da célula de tempo: data e hora exatas no idioma ativo, ou a do backend. */
export function cellTitle(cell: CellModel, lang: string): string | null {
  if (!cell.iso) return cell.title ?? null;
  return `${formatDate(cell.iso, lang)} ${formatTime(cell.iso, lang)}`.trim();
}
