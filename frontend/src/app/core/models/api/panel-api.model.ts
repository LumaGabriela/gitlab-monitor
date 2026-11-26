/**
 * Contrato de /data, espelhando serialize_row e panel_snapshot do
 * gitlab_monitor.py. Nada é derivado aqui: o backend já manda o texto, o tom
 * semântico, o tipo de célula e o peso de largura de cada coluna, e a tela
 * só desenha o que a coluna descreve.
 */

/**
 * Tom semântico de uma célula, no vocabulário do backend (`serialize_row`).
 *
 * A lista é a mesma do `BadgeTone` do Design System, mas está declarada aqui
 * porque `core/` não depende de `shared/` (§3): o contrato da API não é um
 * componente, e o dia em que o backend mandar um tom que o selo não desenha,
 * o erro tem de aparecer na borda, não dentro do primitivo. As duas listas
 * ficam travadas juntas por `shared/monitor/cell-contract.spec.ts`.
 */
export type CellTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'strong';

/**
 * Os ícones que uma célula pode trazer. Hoje o `serialize_row` manda só estes
 * dois (likes e threads); o resto dos ícones da tela é escolha do painel, não
 * do backend. Mesma trava de `CellTone` contra o registro de ícones.
 */
export type CellIconName = 'likes' | 'threads';

export interface LabeledValueModel {
  readonly value: string;
  readonly label: string;
}

/** Sentido de uma ordenação, como o backend o nomeia. */
export type SortDirection = 'asc' | 'desc';

/**
 * Uma opção de ordenação. `column` e `direction` ligam a ordenação à coluna
 * que ela ordena: é o que deixa a seta aparecer no cabeçalho certo, e o
 * clique no cabeçalho escolher a ordenação correspondente.
 *
 * `direction` é o sentido NATURAL, o que vale sem ninguém pedir outro; clicar
 * de novo no mesmo cabeçalho pede o contrário, e aí a consulta leva
 * `direction`.
 */
export interface SortOptionModel {
  readonly value: string;
  readonly label: string;
  readonly column: string;
  readonly direction: SortDirection;
}

/** Uma célula de qualquer coluna; quais campos além de `label` vêm
 * preenchidos depende do `cell` da coluna correspondente. */
export interface CellModel {
  readonly label: string;
  readonly url?: string;
  readonly title?: string | null;
  readonly tone?: CellTone | null;
  readonly icon?: CellIconName | null;
  readonly mine?: boolean;
  readonly likers?: readonly string[];
  /** Valores crus, ao lado do `label`: o painel reformata no idioma ativo e
   * cai no `label` quando o idioma não tem o texto. */
  readonly iso?: string | null;
  /** Status cru da pipeline; vazio sem pipeline. */
  readonly status?: string;
  readonly resolved?: number;
  readonly total?: number;
  /** `mergeable` e `conflicts`: o booleano do GitLab, ou nulo se desconhecido. */
  readonly value?: boolean | null;
  readonly names?: readonly string[];
}

/**
 * Números e estados crus de uma linha, para comparar em vez de ler o texto
 * das células ("2 👍" não dá para comparar). Espelha `facts` do serialize_row.
 */
export interface RowFactsModel {
  readonly likes: number;
  readonly unresolved: number;
  readonly participants: number;
  readonly mergeable: boolean | null;
  readonly conflicts: boolean | null;
  /** Status cru do GitLab: success, failed, running…; vazio sem pipeline. */
  readonly pipeline: string;
  readonly author: string;
  /** Eu reagi com 👍. */
  readonly mine: boolean;
  /** Sou a autora, participei de uma thread ou curti. */
  readonly involved: boolean;
  readonly draft: boolean;
  /** Horas desde a criação. */
  readonly ageHours: number;
  /** Horas desde a última atualização. */
  readonly idleHours: number;
  /** Sou assignee do MR. */
  readonly assignedToMe: boolean;
  /** Sou revisora do MR. */
  readonly reviewingMine: boolean;
  /** O MEU estado de revisão, como o GitLab o escreve (em minúsculas):
   * `unreviewed`, `reviewed`, `requested_changes`, `approved`, mas também
   * `review_started`, `unapproved` e o que vier a existir. Texto, não uma
   * união fechada; a ausência é `''`, nunca `null`. */
  readonly myReviewState: string;
  /** Quantos assignees o MR tem. */
  readonly assignees: number;
  /** Quantos revisores o MR tem. */
  readonly reviewers: number;
}

export interface MrRowModel {
  readonly cells: Readonly<Record<string, CellModel | undefined>>;
  readonly facts: RowFactsModel;
  /** Chaves de coluna alteradas desde a última coleta. */
  readonly changed: readonly string[];
}

export type CellKind = 'text' | 'link' | 'badge' | 'time' | 'likes' | 'people';

export interface ColumnModel {
  readonly key: string;
  readonly label: string;
  readonly cell: CellKind;
  /** Fatia da largura da tabela, proporcional à soma dos pesos visíveis. */
  readonly weight: number;
}

export interface PanelMetaModel {
  /** Os alvos em rótulo, sem escape; é o que a faixa de estado mostra. */
  readonly projects: readonly string[];
  /** Os mesmos alvos na forma canônica, a que o POST /settings aceita de
   * volta. O rótulo não serve: o `unquote` do backend desfaz o escape. */
  readonly targets: readonly string[];
  /** Os alvos que não responderam na última coleta, em rótulo. As linhas
   * deles faltam na tabela mesmo quando a coleta terminou sem erro. */
  readonly failed: readonly string[];
  readonly interval: number;
  readonly shown: number;
  readonly total: number;
  readonly updated: string | null;
}

export interface PanelFiltersModel {
  readonly authors: readonly LabeledValueModel[];
  readonly pipelines: readonly LabeledValueModel[];
}

/** O tipo da mudança: é por ele que o painel decide o que merece aviso. */
export type PanelEventKind = 'opened' | 'likes' | 'pipeline' | 'threads' | 'left' | 'review';

export interface PanelEventModel {
  readonly kind: PanelEventKind;
  /** O mesmo texto de três linhas do terminal; é o que vai no aviso. */
  readonly text: string;
  /** "projeto:iid", a chave do MR no servidor. */
  readonly mr: string;
  readonly title: string;
  readonly author: string;
  readonly url: string;
  readonly likes: number;
  /** Eu reagi com 👍. */
  readonly mine: boolean;
  /** Sou a autora, participei ou curti: o que o filtro "só o que é meu" usa. */
  readonly involved: boolean;
  readonly draft: boolean;
  /** Os fatos crus do MR no momento do evento, os mesmos de `RowFactsModel`.
   * Opcional de propósito: histórico antigo, backend mais velho e o evento de
   * um MR que saiu não os trazem, e quem avalia regra trata a falta. */
  readonly facts?: RowFactsModel;
}

/** `key` é `loading`, `empty-filter` ou `empty-target`; `label` é o texto do backend. */
export interface EmptyMessageModel {
  readonly key: string;
  readonly label: string;
}

export interface PanelSnapshotModel {
  readonly rows: readonly MrRowModel[];
  readonly collected: boolean;
  readonly emptyMessage: EmptyMessageModel | null;
  readonly columns: readonly ColumnModel[];
  readonly sorts: readonly SortOptionModel[];
  readonly meta: PanelMetaModel;
  readonly filters: PanelFiltersModel;
  readonly error: string | null;
  readonly events: readonly PanelEventModel[];
  readonly sequence: number;
  readonly updated: string | null;
  /** Segundos até a próxima consulta, decididos pelo servidor. */
  readonly poll: number;
}

/** Um alvo que a pessoa pode escolher: `value` é a forma canônica que o
 * backend aceita de volta, `label` é o que se mostra. */
export interface AvailableTargetModel {
  readonly value: string;
  readonly label: string;
  readonly kind: 'project' | 'group';
}

/** Resposta de `GET /projects`: grupos primeiro, depois projetos. */
export interface TargetsResponseModel {
  readonly targets: readonly AvailableTargetModel[];
}

export interface SettingsResponseModel {
  readonly error?: string;
  /** Por que o backend recusou (`no-targets`, `invalid-target`,
   * `too-many-targets`, `invalid-interval`, `interval-not-positive`). É o
   * catálogo que decide o texto; `error` é a reserva. */
  readonly code?: string;
}
