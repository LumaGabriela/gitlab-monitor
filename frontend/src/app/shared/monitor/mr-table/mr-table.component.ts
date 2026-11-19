import {
  ChangeDetectionStrategy,
  Component,
  InputSignal,
  OutputEmitterRef,
  Signal,
  computed,
  inject,
  input,
  output,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LangChangeEvent, TranslatePipe, TranslateService } from '@ngx-translate/core';
import { RowRulesService } from '../../../core/services/row-rules.service';
import { ColumnOrderService } from '../../../core/services/column-order.service';
import {
  CellModel,
  ColumnModel,
  MrRowModel,
  SortDirection,
  SortOptionModel,
} from '../../../core/models/api/panel-api.model';
import { BadgeComponent } from '../../ui/badge/badge.component';
import { CellDefDirective } from '../../ui/data-table/cell-def.directive';
import { DataTableComponent } from '../../ui/data-table/data-table.component';
import { TableColumn, TableSort } from '../../ui/data-table/data-table.model';
import { ExternalLinkComponent } from '../../ui/external-link/external-link.component';
import { StackedListComponent } from '../../ui/stacked-list/stacked-list.component';
import { ChangedMarkComponent } from '../changed-mark/changed-mark.component';
import { cellLabel, cellText, cellTitle } from '../cell-text';
import { columnLabel } from '../column-label';
import { describeRule } from '../rules/rule-description';

/**
 * Tabela dos MRs abertos, montada sobre o `app-data-table` do Design System.
 *
 * Não conhece nenhuma coluna pelo nome: traduz o que `/data` descreve para a
 * linguagem da tabela (cabeçalho, largura, quebra de linha) e dá um template
 * de célula por coluna, escolhendo o desenho pelo TIPO que a coluna declara.
 * Uma coluna nova é uma linha no gitlab_monitor.py e nada aqui.
 *
 * A ordenação é `external`: quem ordena é o backend, pela consulta. O
 * cabeçalho mostra por qual coluna a lista está ordenada e pede a troca; a
 * coluna continua `sortLocked`, porque o ciclo do Design System (natural →
 * invertida → sem ordenação) tem um terceiro passo que aqui não existe: a
 * lista do backend está sempre ordenada por algo. Clicar de novo na mesma
 * coluna inverte, e só isso.
 */

/** O que o cabeçalho pede: a ordenação e, quando foi inversão, o sentido.
 * `direction` nulo é o sentido natural daquela ordenação. */
export interface SortRequest {
  readonly value: string;
  readonly direction: SortDirection | null;
}

/**
 * Quantos `--spacing-1` cada ponto de peso vale no piso de largura da coluna.
 * Calibrado para que a coluna mais pesada (MR, peso 36) fique do tamanho de
 * duas colunas comuns, e para que o piso das estreitas continue abaixo do que
 * o conteúdo delas já pede — assim só a coluna espremida sente o piso.
 */
const MIN_WIDTH_PER_WEIGHT = 1.5;

@Component({
  selector: 'app-mr-table',
  imports: [
    BadgeComponent,
    CellDefDirective,
    ChangedMarkComponent,
    DataTableComponent,
    ExternalLinkComponent,
    StackedListComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-data-table
      [caption]="'monitor.table-caption' | translate"
      [columns]="tableColumns()"
      [rows]="rows()"
      [emptyMessage]="emptyMessage() ?? ''"
      [trackBy]="trackRow"
      [rowTone]="rowTone"
      [rowMatch]="rowMatch"
      sortMode="external"
      [sort]="tableSort()"
      (sortChange)="onSortChange($event)"
    >
      @for (column of visibleColumns(); track column.key) {
        <ng-template [appCellDef]="column.key" let-row>
          @let cell = row.cells[column.key];
          @if (cell) {
            <span class="ui-cell">
              <app-changed-mark [visible]="isChanged(row, column.key)" />
              @switch (column.cell) {
                @case ('link') {
                  <app-external-link [href]="cell.url ?? ''" [label]="cell.label" />
                }
                @case ('badge') {
                  <app-badge
                    [text]="text(column, cell)"
                    [tone]="cell.tone ?? 'neutral'"
                    [icon]="cell.icon ?? null"
                    [label]="label(column, cell)"
                  />
                }
                @case ('likes') {
                  <app-badge
                    [text]="cell.label"
                    [tone]="cell.tone ?? 'neutral'"
                    [icon]="cell.icon ?? null"
                    [fixedWidth]="true"
                    [label]="
                      (cell.mine ? 'monitor.likes-including-yours' : 'monitor.likes')
                        | translate: { count: cell.label }
                    "
                  />
                }
                @case ('people') {
                  <!-- A lista empilhada vem depois do <span>, porque <ul> não
                  cabe dentro de um elemento de frase. Aqui fica só o caso sem
                  ninguém, em que o rótulo do backend ("—") é o conteúdo. -->
                  @if (!names(cell).length) {
                    {{ text(column, cell) }}
                  }
                }
                @case ('time') {
                  <time [attr.title]="title(cell)">{{ text(column, cell) }}</time>
                }
                @default {
                  {{ text(column, cell) }}
                }
              }
            </span>
            @if (column.cell === 'people' && names(cell).length) {
              <!-- Uma pessoa por linha: lado a lado, os nomes viram um texto
              corrido em que não se vê onde um acaba e o outro começa. -->
              <app-stacked-list [items]="names(cell)" [separator]="''" variant="value" />
            }
            @let likers = cell.likers ?? [];
            @if (likers.length) {
              <app-stacked-list [items]="likers" />
            }
          }
        </ng-template>
      }
    </app-data-table>
  `,
})
export class MrTableComponent {
  private readonly translate = inject(TranslateService);
  private readonly columnOrder = inject(ColumnOrderService);
  private readonly rowRules = inject(RowRulesService);
  // O catálogo chega por HTTP depois da primeira renderização: sem esta
  // dependência, o cabeçalho ficaria preso ao que existia antes dele
  // carregar e não acompanharia a troca de idioma.
  private readonly language: Signal<LangChangeEvent | undefined> = toSignal(
    this.translate.onLangChange,
  );

  public readonly columns: InputSignal<readonly ColumnModel[]> = input<readonly ColumnModel[]>([]);
  public readonly hiddenColumns: InputSignal<readonly string[]> = input<readonly string[]>([]);
  public readonly rows: InputSignal<readonly MrRowModel[]> = input<readonly MrRowModel[]>([]);
  public readonly emptyMessage: InputSignal<string | null> = input<string | null>(null);
  public readonly sorts: InputSignal<readonly SortOptionModel[]> = input<
    readonly SortOptionModel[]
  >([]);
  public readonly sort: InputSignal<string> = input<string>('');
  /** Sentido pedido à mão; nulo quando vale o natural da ordenação em uso. */
  public readonly direction: InputSignal<SortDirection | null> = input<SortDirection | null>(null);

  public readonly sortChange: OutputEmitterRef<SortRequest> = output<SortRequest>();

  // A ordem é a escolhida por quem olha (Configurações), não a do backend;
  // ela vale antes do filtro das ocultas. Coluna oculta não é renderizada (nem <col>, nem <th>, nem <td>): como ela
  // não existe no DOM, não há o que desalinhar — ao contrário de escondê-la
  // por display:none, que no Chromium desalinhava o colgroup.
  protected readonly visibleColumns: Signal<readonly ColumnModel[]> = computed(
    (): readonly ColumnModel[] =>
      this.columnOrder
        .sort(this.columns())
        .filter((column) => !this.hiddenColumns().includes(column.key)),
  );

  /**
   * O que `/data` descreve, dito na linguagem do `app-data-table`. A largura
   * em % é proporcional ao peso informado: a soma é sempre 100%, então nunca
   * sobra nem falta espaço à direita.
   *
   * O `minWidth` sai do mesmo peso, porque a tabela é `table-layout: auto` —
   * o modo em que nenhuma célula transborda por cima da vizinha, e o único em
   * que o selo ocupa exatamente o tamanho dele. Lá a porcentagem é só uma
   * sugestão, e a coluna de texto longo acaba espremida no mínimo do conteúdo;
   * o piso devolve a ela o espaço que o peso prometia. Nas colunas estreitas o
   * piso fica abaixo do que o conteúdo já pede e não muda nada.
   */
  protected readonly tableColumns: Signal<readonly TableColumn<MrRowModel>[]> = computed(
    (): readonly TableColumn<MrRowModel>[] => {
      const visible = this.visibleColumns();
      const total = visible.reduce((sum, column) => sum + column.weight, 0) || 1;
      const ordenaveis = this.sortByColumn();
      this.language();
      return visible.map((column) => ({
        key: column.key,
        header: columnLabel(this.translate, column),
        width: `${(column.weight / total) * 100}%`,
        minWidth: `calc(var(--spacing-1) * ${column.weight * MIN_WIDTH_PER_WEIGHT})`,
        nowrap: column.cell === 'time',
        sortable: ordenaveis.has(column.key),
        // O sentido é do backend: o cabeçalho escolhe a coluna, não a
        // direção, então clicar de novo não inverte nem limpa.
        sortLocked: true,
      }));
    },
  );

  /** A ordenação de cada coluna, pela chave da coluna. Só as colunas que
   * aparecem aqui ordenam pelo cabeçalho. */
  private readonly sortByColumn: Signal<Map<string, SortOptionModel>> = computed(
    (): Map<string, SortOptionModel> =>
      new Map(this.sorts().map((option) => [option.column, option])),
  );

  /** Seta no cabeçalho da coluna que a ordenação atual usa; nula quando a
   * ordenação em uso não tem coluna correspondente. */
  protected readonly tableSort: Signal<TableSort | null> = computed((): TableSort | null => {
    const atual = this.activeSort();
    if (!atual) return null;
    return { key: atual.column, direction: this.direction() ?? atual.direction };
  });

  /**
   * Clique no cabeçalho: na coluna já ordenada, inverte o sentido; em outra,
   * pede a ordenação dela no sentido natural. Nunca fica sem ordenação, porque
   * a lista que o backend devolve está sempre ordenada por alguma coisa.
   */
  protected onSortChange(sort: TableSort | null): void {
    if (!sort) return;
    const atual = this.activeSort();
    if (atual && atual.column === sort.key) {
      const sentido = this.direction() ?? atual.direction;
      this.sortChange.emit({ value: atual.value, direction: sentido === 'asc' ? 'desc' : 'asc' });
      return;
    }
    const opcao = this.sortByColumn().get(sort.key);
    if (opcao) this.sortChange.emit({ value: opcao.value, direction: null });
  }

  /** A ordenação em uso, descrita pelo backend; nula se ele não a oferece. */
  private activeSort(): SortOptionModel | undefined {
    return this.sorts().find((option) => option.value === this.sort());
  }

  /** O MR é único pela própria URL; o índice faria a lista inteira ser
   * redesenhada a cada reordenação. */
  protected readonly trackRow = (row: MrRowModel): unknown => row.cells['mr']?.url;

  /** O tom da linha vem das regras de destaque de quem olha, comparadas com os fatos crus dela. */
  protected readonly rowTone = (row: MrRowModel): string | null => this.rowRules.toneFor(row.facts);

  /** Por que a linha foi destacada, dito por texto: o fundo sozinho não chega a quem não distingue cores. */
  protected readonly rowMatch = (row: MrRowModel): string | null => {
    // Lido aqui para que a frase siga a troca de idioma e a chegada do catálogo.
    this.language();
    const rule = this.rowRules.matchFor(row.facts);
    return rule ? describeRule(this.translate, rule) : null;
  };

  /** O texto da célula no idioma ativo; o rótulo do backend quando falta o valor cru ou a chave. */
  protected text(column: ColumnModel, cell: CellModel): string {
    this.language();
    return cellText(this.translate, column, cell, this.lang());
  }

  /** As pessoas da célula, na ordem do backend; vazio quando não há nenhuma. */
  protected names(cell: CellModel): readonly string[] {
    return cell.names ?? [];
  }

  protected label(column: ColumnModel, cell: CellModel): string | null {
    this.language();
    return cellLabel(this.translate, column, cell);
  }

  protected title(cell: CellModel): string | null {
    this.language();
    return cellTitle(cell, this.lang());
  }

  private lang(): string {
    return this.translate.getCurrentLang() || 'pt';
  }

  protected isChanged(row: MrRowModel, key: string): boolean {
    return row.changed.includes(key);
  }
}
