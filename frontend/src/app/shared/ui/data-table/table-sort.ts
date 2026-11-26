import { collatorFor } from './collator';
import { SortDirection, TableColumn, TableSort } from './data-table.model';

type Comparavel = string | number | null;

function valorDe<T>(col: TableColumn<T>, row: T): Comparavel {
  const bruto: unknown = col.sortValue
    ? col.sortValue(row)
    : (row as Record<string, unknown>)[col.key];
  if (bruto === null || bruto === undefined || bruto === '') return null;
  return typeof bruto === 'number' ? bruto : String(bruto);
}

function comparar(a: Comparavel, b: Comparavel, lang: string): number {
  if (typeof a === 'number' && typeof b === 'number') return a - b;
  return collatorFor(lang).compare(String(a), String(b));
}

/**
 * Linhas na ordem pedida, sem alterar a lista recebida. Valor vazio fica sempre no fim, nos dois sentidos; empate
 * mantém a ordem original. O texto é comparado pela colação de `lang`, o idioma ativo de quem chama.
 */
export function sortRows<T>(
  rows: readonly T[],
  columns: readonly TableColumn<T>[],
  sort: TableSort | null,
  lang: string,
): readonly T[] {
  const col = sort ? columns.find((c: TableColumn<T>) => c.key === sort.key) : undefined;
  if (!sort || !col) return rows;
  const sinal = sort.direction === 'asc' ? 1 : -1;
  return [...rows].sort((x: T, y: T): number => {
    const a = valorDe(col, x);
    const b = valorDe(col, y);
    if (a === null || b === null) return a === b ? 0 : a === null ? 1 : -1;
    return sinal * comparar(a, b, lang);
  });
}

/** Sentido do primeiro clique na coluna. */
export function firstDirection<T>(col: TableColumn<T>): SortDirection {
  return col.firstDirection ?? (col.align === 'end' ? 'desc' : 'asc');
}

/** Próxima ordenação ao clicar no cabeçalho: sentido inicial, depois o inverso, depois a ordem original. */
export function nextSort<T>(atual: TableSort | null, col: TableColumn<T>): TableSort | null {
  const inicial = firstDirection(col);
  if (col.sortLocked || atual?.key !== col.key) return { key: col.key, direction: inicial };
  return atual.direction === inicial
    ? { key: col.key, direction: inicial === 'asc' ? 'desc' : 'asc' }
    : null;
}
