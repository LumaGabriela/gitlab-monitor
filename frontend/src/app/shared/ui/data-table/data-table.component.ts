import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  InputSignal,
  ModelSignal,
  OutputEmitterRef,
  Signal,
  TemplateRef,
  computed,
  contentChildren,
  input,
  model,
  output,
} from '@angular/core';
import { ErrorStateComponent } from '../error-state/error-state.component';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon-registry';
import { SkeletonComponent } from '../skeleton/skeleton.component';
import { CellContext, CellDefDirective } from './cell-def.directive';
import { ROW_TONE_ICONS, TableColumn, TableDensity, TableSort } from './data-table.model';
import { nextSort, sortRows } from './table-sort';

/** `local`: a tabela ordena as linhas que recebe. `external`: só avisa
 * (`sort`) e quem ordena é a página. */
export type TableSortMode = 'local' | 'external';

/**
 * Tabela de dados: legenda, cabeçalhos com `scope`, números à direita com
 * `tabular-nums`, células com template próprio, e os estados vazio,
 * carregando e erro. Rola na horizontal dentro de uma região focável, com a
 * primeira coluna fixa. No celular (tela abaixo de `md`), cada linha vira um
 * cartão com o nome da coluna antes do valor (`stackOnNarrow`). Colunas
 * `sortable` ordenam pelo cabeçalho (`aria-sort`); `footerRows` vão no
 * `tfoot`, fora da ordenação.
 *
 * É o componente do fpf-metrics-web, com três diferenças: sem `rowLink` (não há rota de
 * detalhe de um MR; o router existe só para `/settings`), `width` por coluna (aqui a largura sai dos pesos que
 * o backend informa) e `rowTone`, que pinta a linha inteira conforme as regras de quem olha, e `rowMatch`, o texto que
 * diz por quê (ícone e texto para leitor de tela, o segundo canal além do fundo).
 */
@Component({
  selector: 'app-data-table',
  imports: [NgTemplateOutlet, IconComponent, ErrorStateComponent, SkeletonComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (error(); as mensagem) {
      <app-error-state [message]="mensagem" (retry)="retry.emit()" />
    } @else {
      <div class="ui-table-wrapper" role="region" tabindex="0" [attr.aria-label]="caption()">
        <table
          class="ui-table"
          [class.ui-table--compact]="density() === 'compact'"
          [class.ui-table--stack]="stackOnNarrow()"
          [attr.aria-busy]="loading() ? 'true' : null"
        >
          <caption [class.ui-visually-hidden]="!captionVisible()">
            {{
              caption()
            }}
          </caption>
          <colgroup>
            @for (col of columns(); track col.key) {
              <col [style.width]="col.width" />
            }
          </colgroup>
          <thead>
            <tr>
              @for (col of columns(); track col.key) {
                <th
                  scope="col"
                  [style.minWidth]="col.minWidth"
                  [class.ui-table__cell--end]="col.align === 'end'"
                  [class.ui-table__th--sortable]="col.sortable"
                  [attr.aria-sort]="ariaSort(col)"
                >
                  @if (col.sortable) {
                    <button
                      type="button"
                      class="ui-table__sort"
                      [class.ui-table__sort--active]="sort()?.key === col.key"
                      (click)="toggleSort(col)"
                    >
                      {{ col.header }}
                      <app-icon [name]="sortIcon(col)" size="sm" />
                    </button>
                  } @else {
                    {{ col.header }}
                  }
                </th>
              }
            </tr>
          </thead>
          <tbody>
            @if (loading()) {
              <tr>
                <td [attr.colspan]="columns().length">
                  <app-skeleton variant="line" [lines]="3" />
                </td>
              </tr>
            } @else {
              @for (row of sortedRows(); track trackBy()(row, $index)) {
                <ng-container
                  [ngTemplateOutlet]="linha"
                  [ngTemplateOutletContext]="{ $implicit: row }"
                />
              } @empty {
                <tr>
                  <td class="ui-table__empty" [attr.colspan]="columns().length">
                    {{ emptyMessage() }}
                  </td>
                </tr>
              }
            }
          </tbody>
          @if (!loading() && footerRows().length) {
            <tfoot>
              @for (row of footerRows(); track $index) {
                <ng-container
                  [ngTemplateOutlet]="linha"
                  [ngTemplateOutletContext]="{ $implicit: row }"
                />
              }
            </tfoot>
          }
        </table>
      </div>
    }

    <ng-template #linha let-row>
      <tr [class]="toneClass(row)">
        @let marca = marker(row);
        @for (col of columns(); track col.key; let primeira = $first) {
          <td
            [attr.data-label]="col.header"
            [style.minWidth]="col.minWidth"
            [class.ui-table__cell--end]="col.align === 'end'"
            [class.ui-table__cell--mono]="col.mono"
            [class.ui-table__cell--nowrap]="col.nowrap"
          >
            @if (primeira && marca) {
              <span class="ui-table__match">
                <app-icon [name]="marca.icon" size="sm" />
                <span class="ui-visually-hidden">{{ marca.text }}</span>
              </span>
            }
            @if (templates().get(col.key); as tpl) {
              <ng-container
                [ngTemplateOutlet]="tpl"
                [ngTemplateOutletContext]="{ $implicit: row }"
              />
            } @else {
              {{ cellText(col, row) }}
            }
          </td>
        }
      </tr>
    </ng-template>
  `,
})
export class DataTableComponent<T> {
  public readonly caption: InputSignal<string> = input.required<string>();
  public readonly captionVisible: InputSignal<boolean> = input<boolean>(false);
  public readonly columns: InputSignal<readonly TableColumn<T>[]> =
    input.required<readonly TableColumn<T>[]>();
  public readonly rows: InputSignal<readonly T[]> = input<readonly T[]>([]);
  /** Linhas do rodapé (`tfoot`): resíduo ou total que fecha a tabela, fora
   * da ordenação e da paginação. */
  public readonly footerRows: InputSignal<readonly T[]> = input<readonly T[]>([]);
  public readonly loading: InputSignal<boolean> = input<boolean>(false);
  public readonly error: InputSignal<string | null> = input<string | null>(null);
  public readonly emptyMessage: InputSignal<string> = input<string>('—');
  public readonly density: InputSignal<TableDensity> = input<TableDensity>('default');
  /** No celular (tela abaixo de `md`), cada linha vira um cartão (nome da
   * coluna antes do valor). */
  public readonly stackOnNarrow: InputSignal<boolean> = input<boolean>(true);
  /** Ordenação atual (coluna e sentido) ou nula, na ordem recebida. */
  public readonly sort: ModelSignal<TableSort | null> = model<TableSort | null>(null);
  public readonly sortMode: InputSignal<TableSortMode> = input<TableSortMode>('local');
  /** Idioma da colação da ordenação local; quem chama passa o idioma ativo. */
  public readonly lang: InputSignal<string> = input<string>('pt');
  public readonly trackBy: InputSignal<(row: T, index: number) => unknown> = input<
    (row: T, index: number) => unknown
  >((_: T, index: number): number => index);
  /** Tom da linha inteira (`danger`, `warning`, `success` ou `strong`), ou nulo para
   * a linha sem destaque. Quem decide é o chamador; a tabela só aplica a classe. */
  public readonly rowTone: InputSignal<((row: T) => string | null) | null> = input<
    ((row: T) => string | null) | null
  >(null);
  /** O texto do destaque desta linha (qual regra a destacou), ou nulo. Com o tom, a primeira
   * célula ganha um ícone por tom e o texto para o leitor de tela: o fundo sozinho não
   * é percebido por quem não distingue cores. A tabela só desenha o que recebe. */
  public readonly rowMatch: InputSignal<((row: T) => string | null) | null> = input<
    ((row: T) => string | null) | null
  >(null);
  public readonly retry: OutputEmitterRef<void> = output<void>();

  private readonly cellDefs: Signal<readonly CellDefDirective[]> =
    contentChildren(CellDefDirective);
  protected readonly templates: Signal<Map<string, TemplateRef<CellContext<unknown>>>> = computed(
    (): Map<string, TemplateRef<CellContext<unknown>>> =>
      new Map(this.cellDefs().map((d: CellDefDirective) => [d.appCellDef(), d.template])),
  );

  protected readonly sortedRows: Signal<readonly T[]> = computed((): readonly T[] =>
    this.sortMode() === 'local'
      ? sortRows(this.rows(), this.columns(), this.sort(), this.lang())
      : this.rows(),
  );

  protected toggleSort(col: TableColumn<T>): void {
    this.sort.set(nextSort(this.sort(), col));
  }

  protected ariaSort(col: TableColumn<T>): 'ascending' | 'descending' | null {
    const atual = this.sort();
    if (!col.sortable || atual?.key !== col.key) return null;
    return atual.direction === 'asc' ? 'ascending' : 'descending';
  }

  protected sortIcon(col: TableColumn<T>): IconName {
    const atual = this.sort();
    if (atual?.key !== col.key) return 'arrow-up-down';
    return atual.direction === 'asc' ? 'arrow-up' : 'arrow-down';
  }

  protected toneClass(row: T): string {
    const tone = this.rowTone()?.(row);
    return tone ? `ui-table__row--tone-${tone}` : '';
  }

  protected marker(row: T): { readonly icon: IconName; readonly text: string } | null {
    const text = this.rowMatch()?.(row);
    const icon = ROW_TONE_ICONS[this.rowTone()?.(row) ?? ''];
    return text && icon ? { icon, text } : null;
  }

  protected cellText(col: TableColumn<T>, row: T): string {
    if (col.value) return col.value(row);
    const bruto = (row as Record<string, unknown>)[col.key];
    return bruto === null || bruto === undefined || bruto === '' ? '—' : String(bruto);
  }
}
