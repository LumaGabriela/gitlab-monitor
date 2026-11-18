import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  Signal,
  computed,
  inject,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { RouterLink } from '@angular/router';
import { LangChangeEvent, TranslatePipe, TranslateService } from '@ngx-translate/core';
import { ColumnVisibilityService } from '../../../../core/services/column-visibility.service';
import { RowRulesService } from '../../../../core/services/row-rules.service';
import { PresetsService } from '../../../../core/services/presets.service';
import { GitlabMonitorService } from '../../../../core/services/gitlab-monitor.service';
import { MonitorBootstrapService } from '../../../../core/services/monitor-bootstrap.service';
import { PageHeaderComponent } from '../../../../shared/layout/page-header/page-header.component';
import { PageToolsComponent } from '../../../../shared/layout/page-tools/page-tools.component';
import { MonitorLegendComponent } from '../../../../shared/monitor/monitor-legend/monitor-legend.component';
import { MonitorToolbarComponent } from '../../../../shared/monitor/monitor-toolbar/monitor-toolbar.component';
import { MrTableComponent } from '../../../../shared/monitor/mr-table/mr-table.component';
import { LabeledValueModel } from '../../../../core/models/api/panel-api.model';
import { AlertComponent } from '../../../../shared/ui/alert/alert.component';
import {
  JUST_NOW_KEY,
  formatDate,
  formatRelative,
  formatTime,
} from '../../../../shared/monitor/cell-format';
import { presetLabel } from '../../../../shared/monitor/preset-label';
import { translatedOr } from '../../../../shared/monitor/cell-text';
import { ButtonDirective } from '../../../../shared/ui/button/button.directive';
import { EmptyStateComponent } from '../../../../shared/ui/empty-state/empty-state.component';
import { CardComponent } from '../../../../shared/ui/card/card.component';
import { IconComponent, IconName } from '../../../../shared/ui/icon/icon.component';

type StatusState = 'ok' | 'loading' | 'error';

interface CollectedAt {
  readonly relative: string;
  readonly full: string;
}

const STATUS_ICONS: Record<StatusState, IconName> = {
  ok: 'check',
  loading: 'refresh',
  error: 'error',
};

/**
 * A tela. Só posiciona componentes e liga dados: não desenha nada por conta
 * própria e não tem estilo local.
 */
@Component({
  selector: 'app-monitor-page',
  imports: [
    AlertComponent,
    ButtonDirective,
    CardComponent,
    EmptyStateComponent,
    IconComponent,
    MonitorLegendComponent,
    MonitorToolbarComponent,
    MrTableComponent,
    PageHeaderComponent,
    PageToolsComponent,
    RouterLink,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ui-page' },
  template: `
    <app-page-header [title]="'monitor.title' | translate" [count]="shownCount()">
      <p
        header-meta
        class="ui-status-line"
        [class.ui-status-line--ok]="status() === 'ok'"
        [class.ui-status-line--loading]="status() === 'loading'"
        [class.ui-status-line--error]="status() === 'error'"
      >
        <app-icon [name]="statusIcon()" />
        <!-- A região viva cobre só o alvo e o estado. O tempo relativo fica
             fora: ele muda de minuto em minuto sozinho, e dentro daqui faria
             o leitor de tela reanunciar a faixa inteira para sempre. A data e
             a hora completas continuam no atributo title. -->
        <span class="ui-status-line__state" aria-live="polite">
          <!-- Sem alvo não há o que nomear: "Alvos:" vazio contradiria o
               convite para escolher um, logo abaixo. Um alvo por elemento, e
               não uma string com vírgulas: é o que dá o espaço entre eles e o
               que deixa a lista empilhar em tela estreita. -->
          <span class="ui-status-line__target">
            @if (monitor.meta().projects.length) {
              <span class="ui-status-line__label">{{ 'monitor.status-targets' | translate }}</span>
              @for (alvo of monitor.meta().projects; track alvo) {
                <span class="ui-status-line__item">{{ alvo }}</span>
              }
            } @else if (noTargets()) {
              {{ 'monitor.status-no-target' | translate }}
            }
          </span>
          @if (status() !== 'ok') {
            <span>{{ statusKey() | translate }}</span>
          }
        </span>
        @if (collectedAt(); as collected) {
          <span class="ui-status-line__when" [attr.title]="collected.full">{{
            'monitor.status-ok' | translate: { when: collected.relative }
          }}</span>
        }
      </p>
      <app-page-tools actions />
    </app-page-header>

    <!-- Sempre no DOM: uma região viva só anuncia o que muda dentro dela, e
         este é o único lugar onde o detalhe da falha é dito. Sem aviso, o
         conteúdo fica vazio e a faixa não ocupa espaço. -->
    <app-alert
      tone="warning"
      class="ui-monitor-alert"
      [class.ui-monitor-alert--quiet]="!warningText()"
      >{{ warningText() }}</app-alert
    >

    <!-- Um painel só: filtros, legenda e tabela moram no mesmo card, como
         no fpf-metrics-web, em vez de três caixas soltas na página. -->
    <app-card>
      <div class="ui-monitor-panel">
        <app-monitor-toolbar
          [sorts]="monitor.sorts()"
          [authors]="monitor.filters().authors"
          [pipelines]="monitor.filters().pipelines"
          [sort]="monitor.sort()"
          [author]="monitor.author()"
          [pipeline]="monitor.pipeline()"
          [review]="monitor.review()"
          [presets]="presetOptions()"
          [activePreset]="presets.activeId()"
          (sortChange)="monitor.setSort($event)"
          (authorChange)="monitor.setAuthor($event)"
          (pipelineChange)="monitor.setPipeline($event)"
          (reviewChange)="monitor.setReview($event)"
          (presetChange)="presets.apply($event)"
          (clearFilters)="monitor.resetFilters()"
        />

        <app-monitor-legend [rules]="rowRules.rules()" />

        @if (noTargets()) {
          <app-empty-state [message]="'monitor.no-targets' | translate">
            <a appButton variant="primary" [routerLink]="settingsQuery">{{
              'monitor.no-targets-action' | translate
            }}</a>
          </app-empty-state>
        } @else {
          <app-mr-table
            [rows]="monitor.rows()"
            [columns]="monitor.columns()"
            [hiddenColumns]="columnVisibility.hidden()"
            [emptyMessage]="emptyText() ?? ('monitor.querying' | translate)"
            [sorts]="monitor.sorts()"
            [sort]="monitor.sort()"
            [direction]="monitor.sortDirection()"
            (sortChange)="monitor.setSort($event.value, $event.direction)"
          />
        }
      </div>
    </app-card>
  `,
})
export class MonitorPage implements OnInit {
  protected readonly monitor = inject(GitlabMonitorService);
  protected readonly columnVisibility = inject(ColumnVisibilityService);
  protected readonly rowRules = inject(RowRulesService);
  protected readonly presets = inject(PresetsService);
  private readonly bootstrap = inject(MonitorBootstrapService);
  private readonly translate = inject(TranslateService);
  // O catálogo chega por HTTP depois da primeira renderização: sem esta
  // dependência, os textos computados ficariam presos ao que existia antes.
  private readonly language: Signal<LangChangeEvent | undefined> = toSignal(
    this.translate.onLangChange,
  );

  /** Os presets no idioma ativo, para o seletor da barra. */
  protected readonly presetOptions: Signal<readonly LabeledValueModel[]> = computed(
    (): readonly LabeledValueModel[] => {
      this.language();
      return this.presets.presets().map((preset) => ({
        value: preset.id,
        label: presetLabel(this.translate, preset),
      }));
    },
  );

  protected readonly settingsQuery: readonly string[] = ['/', 'settings', 'query'];

  /** Nenhum alvo escolhido: estado válido, não erro. Só vale depois da
   * primeira resposta, quando ainda não se sabe quais são os alvos. */
  protected readonly noTargets: Signal<boolean> = computed((): boolean => {
    const meta = this.monitor.meta();
    return meta.updated !== null && meta.projects.length === 0;
  });

  /** Por que a tabela está vazia, no idioma ativo; o texto do backend se a
   * chave não existir no catálogo. */
  protected readonly emptyText: Signal<string | null> = computed((): string | null => {
    this.language();
    const message = this.monitor.snapshot().emptyMessage;
    if (!message) return null;
    const key = `monitor.empty-${message.key.replace(/^empty-/, '')}`;
    return translatedOr(this.translate, key, message.label);
  });

  /** O aviso no idioma ativo: o texto do backend quando ele vem, a chave do
   * catálogo quando não. String vazia sem aviso, porque o recipiente fica
   * sempre no DOM para continuar sendo a região viva que o anuncia. */
  protected readonly warningText: Signal<string> = computed((): string => {
    this.language();
    const warning = this.monitor.warning();
    if (!warning) return '';
    return warning.text ?? String(this.translate.instant(warning.key, warning.params));
  });

  /** Vai no contador ao lado do título; vazio antes da primeira resposta,
   * para não mostrar "0" onde ainda não se sabe o número. */
  protected readonly shownCount: Signal<string | null> = computed((): string | null => {
    const meta = this.monitor.meta();
    if (!meta.updated) return null;
    return meta.shown === meta.total ? String(meta.shown) : `${meta.shown}/${meta.total}`;
  });

  /**
   * Falha vence coleta em andamento: o aviso só some quando uma consulta
   * termina bem, então enquanto ele existe a última coleta segue sem sucesso e
   * afirmar "coletando" esconderia isso. Sem erro, coleta em curso (ou nenhuma
   * resposta ainda) é "carregando"; só o resto é "ok".
   *
   * A coleta do ciclo normal só conta depois do limiar do serviço: a volta de
   * dez segundos responde antes disso e piscaria o ícone à toa. A verificação
   * manual conta na hora, porque ali a espera foi pedida por quem clicou.
   */
  protected readonly status: Signal<StatusState> = computed((): StatusState => {
    if (this.monitor.warning()) return 'error';
    if (this.monitor.collecting() || this.monitor.refreshing()) return 'loading';
    return this.monitor.meta().updated ? 'ok' : 'loading';
  });

  protected readonly statusIcon: Signal<IconName> = computed(
    (): IconName => STATUS_ICONS[this.status()],
  );

  protected readonly statusKey: Signal<string> = computed(
    (): string => `monitor.status-${this.status()}`,
  );

  /** Tempo relativo da última coleta e, no `title`, a data e a hora inteiras.
   * Lê o idioma para recalcular quando o catálogo chega ou muda. */
  protected readonly collectedAt: Signal<CollectedAt | null> = computed((): CollectedAt | null => {
    this.language();
    const updated = this.monitor.meta().updated;
    if (!updated) return null;
    const lang = this.translate.getCurrentLang() || 'pt';
    const relative = formatRelative(updated, lang);
    return {
      relative: relative === JUST_NOW_KEY ? String(this.translate.instant(relative)) : relative,
      full: `${formatDate(updated, lang)} ${formatTime(updated, lang)}`.trim(),
    };
  });

  public ngOnInit(): void {
    this.bootstrap.start();
  }
}
