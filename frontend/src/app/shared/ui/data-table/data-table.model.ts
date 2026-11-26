
/** Sentido da ordenação. */
export type SortDirection = 'asc' | 'desc';

/** Ordenação da tabela: a coluna (`key`) e o sentido. */
export interface TableSort {
  readonly key: string;
  readonly direction: SortDirection;
}

/** Densidade das células: `compact` para tabelas longas. */
export type TableDensity = 'default' | 'compact';

/**
 * Coluna de `app-data-table`. `header` já traduzido. Sem `value`, a célula
 * mostra `row[key]` (ou "—").
 *
 * `width` não existe no original do fpf-metrics-web: aqui a largura de cada
 * coluna sai do peso que o backend informa, então a coluna precisa dizer
 * quanto ocupa. `minWidth` tampouco: a tabela é `table-layout: auto`, para
 * nenhuma célula transbordar por cima da vizinha, e nesse modo a coluna de
 * texto longo é espremida ao mínimo — o piso é o que garante o espaço dela.
 */
export interface TableColumn<T> {
  readonly key: string;
  readonly header: string;
  readonly align?: 'start' | 'end';
  readonly mono?: boolean;
  /** Não quebra a linha (códigos, datas curtas). */
  readonly nowrap?: boolean;
  readonly width?: string;
  /** Piso de largura da coluna, aplicado ao cabeçalho e às células. */
  readonly minWidth?: string;
  readonly value?: (row: T) => string;
  /** O cabeçalho ordena a tabela por esta coluna. */
  readonly sortable?: boolean;
  /** Valor comparado na ordenação. Sem ele, `row[key]` (nunca o texto
   * formatado de `value`). */
  readonly sortValue?: (row: T) => string | number | null;
  /** Sentido do primeiro clique. Padrão: do maior para o menor em coluna
   * numérica (`align: 'end'`), de A a Z nas demais. */
  readonly firstDirection?: SortDirection;
  /** Ordena só no sentido inicial, sem inverter nem limpar (ordem que vem de
   * fora, ex.: a consulta ao backend). */
  readonly sortLocked?: boolean;
}
