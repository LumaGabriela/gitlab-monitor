import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  Injector,
  Signal,
  WritableSignal,
  afterNextRender,
  computed,
  inject,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LangChangeEvent, TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ColumnModel } from '../../../core/models/api/panel-api.model';
import { ColumnOrderService } from '../../../core/services/column-order.service';
import { ColumnVisibilityService } from '../../../core/services/column-visibility.service';
import { GitlabMonitorService } from '../../../core/services/gitlab-monitor.service';
import { columnLabel } from '../../../shared/monitor/column-label';
import { CardComponent } from '../../../shared/ui/card/card.component';
import { ButtonDirective } from '../../../shared/ui/button/button.directive';
import { CheckboxComponent } from '../../../shared/ui/checkbox/checkbox.component';
import { IconComponent } from '../../../shared/ui/icon/icon.component';
import { IconButtonDirective } from '../../../shared/ui/icon-button/icon-button.directive';

/** Quais colunas a tabela mostra e em que ordem. Preferência local, sem botão Salvar. */
@Component({
  selector: 'app-columns-section',
  imports: [
    CardComponent,
    ButtonDirective,
    CheckboxComponent,
    IconButtonDirective,
    IconComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <app-card>
      <section class="ui-settings-section" id="colunas">
        <h2 class="ui-settings-section__title" data-focus-target tabindex="-1">
          {{ 'settings.columns' | translate }}
        </h2>
        <p class="ui-settings__hint">{{ 'settings.columns-summary' | translate }}</p>
        <!-- Uma coluna por linha, duas quando a largura dá: a lista inteira
             lado a lado ficaria com nomes cortados em tela estreita. A ordem
             muda por botão e não por arrastar: o teclado é o caminho principal. -->
        <ul class="ui-settings__columns">
          @for (column of columns(); track column.key; let first = $first; let last = $last) {
            <li class="ui-settings__column" [attr.data-column]="column.key">
              <app-checkbox
                [label]="columnLabel(column)"
                [value]="isVisible(column.key)"
                (valueChange)="columnVisibility.setHidden(column.key, !$event)"
              />
              <span class="ui-settings__column-actions">
                <button
                  type="button"
                  appIconButton
                  size="sm"
                  data-move="-1"
                  [label]="'settings.move-up' | translate: { column: columnLabel(column) }"
                  [disabled]="first"
                  (click)="move(column.key, -1)"
                >
                  <app-icon name="arrow-up" />
                </button>
                <button
                  type="button"
                  appIconButton
                  size="sm"
                  data-move="1"
                  [label]="'settings.move-down' | translate: { column: columnLabel(column) }"
                  [disabled]="last"
                  (click)="move(column.key, 1)"
                >
                  <app-icon name="arrow-down" />
                </button>
              </span>
            </li>
          }
        </ul>
        <!-- Sempre no DOM: uma região viva só anuncia o que muda dentro dela. -->
        <p class="ui-visually-hidden" role="status" aria-live="polite">{{ announcement() }}</p>
        <div class="ui-settings__actions">
          <button
            type="button"
            appButton
            variant="ghost"
            data-test="reset-order"
            (click)="columnOrder.reset()"
          >
            {{ 'settings.reset-order' | translate }}
          </button>
        </div>
      </section>
    </app-card>
  `,
})
export class ColumnsSectionComponent {
  protected readonly columnVisibility = inject(ColumnVisibilityService);
  protected readonly columnOrder = inject(ColumnOrderService);
  private readonly monitor = inject(GitlabMonitorService);
  private readonly translate = inject(TranslateService);
  private readonly host: ElementRef<HTMLElement> = inject(ElementRef);
  private readonly injector = inject(Injector);
  // Mesma razão da seção de exibição: sem a dependência, o rótulo ficaria
  // preso ao catálogo que existia antes de ele chegar.
  private readonly language: Signal<LangChangeEvent | undefined> = toSignal(
    this.translate.onLangChange,
  );

  // As colunas que /data descreve, já na ordem preferida de quem olha.
  protected readonly columns: Signal<readonly ColumnModel[]> = computed(
    (): readonly ColumnModel[] => this.columnOrder.sort(this.monitor.columns()),
  );

  // A coluna que acabou de mudar de lugar: a posição anunciada é lida da lista já
  // reordenada, então nunca fica diferente da tela.
  private readonly movedKey: WritableSignal<string | null> = signal<string | null>(null);

  protected readonly announcement: Signal<string> = computed((): string => {
    this.language();
    const key = this.movedKey();
    const columns = this.columns();
    const index = columns.findIndex((column) => column.key === key);
    if (index < 0) return '';
    return this.translate.instant('settings.moved', {
      column: columnLabel(this.translate, columns[index]),
      position: index + 1,
      total: columns.length,
    });
  });

  /** O nome da coluna no idioma do painel; o rótulo do backend é o reserva. */
  protected columnLabel(column: ColumnModel): string {
    this.language();
    return columnLabel(this.translate, column);
  }

  protected move(key: string, delta: -1 | 1): void {
    this.movedKey.set(key);
    this.columnOrder.move(key, delta);
    // O @for move o nó da linha e o botão pode ficar desabilitado na ponta:
    // nos dois casos o foco se perderia. Depois de renderizar, ele volta ao
    // botão da coluna movida, ou ao oposto quando o primeiro já não serve.
    afterNextRender((): void => this.restoreFocus(key, delta), { injector: this.injector });
  }

  private restoreFocus(key: string, delta: -1 | 1): void {
    const row = this.host.nativeElement.querySelector<HTMLElement>(
      `.ui-settings__column[data-column="${CSS.escape(key)}"]`,
    );
    const same = row?.querySelector<HTMLButtonElement>(`[data-move="${delta}"]`);
    const opposite = row?.querySelector<HTMLButtonElement>(`[data-move="${-delta}"]`);
    (same && !same.disabled ? same : opposite)?.focus();
  }

  protected isVisible(key: string): boolean {
    return !this.columnVisibility.hidden().includes(key);
  }
}
