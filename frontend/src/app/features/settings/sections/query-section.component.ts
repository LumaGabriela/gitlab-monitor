import {
  ChangeDetectionStrategy,
  Component,
  OnInit,
  Signal,
  WritableSignal,
  computed,
  inject,
  linkedSignal,
  signal,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LangChangeEvent, TranslatePipe, TranslateService } from '@ngx-translate/core';
import { AvailableTargetModel } from '../../../core/models/api/panel-api.model';
import {
  GitlabMonitorService,
  MAX_TARGETS,
  MonitorWarning,
} from '../../../core/services/gitlab-monitor.service';
import { translatedOr } from '../../../shared/monitor/cell-text';
import { AlertComponent } from '../../../shared/ui/alert/alert.component';
import { ButtonDirective } from '../../../shared/ui/button/button.directive';
import { EmptyStateComponent } from '../../../shared/ui/empty-state/empty-state.component';
import { FieldComponent } from '../../../shared/ui/field/field.component';
import { MultiSelectComponent } from '../../../shared/ui/multi-select/multi-select.component';
import { SelectOption } from '../../../shared/ui/select/select.model';
import { SkeletonComponent } from '../../../shared/ui/skeleton/skeleton.component';
import { TextInputComponent } from '../../../shared/ui/text-input/text-input.component';

type TargetsLoad = 'loading' | 'failed' | 'ready';

/** O alvo da consulta: o que vai ao backend ao salvar (projetos e intervalo). */
@Component({
  selector: 'app-query-section',
  imports: [
    AlertComponent,
    ButtonDirective,
    EmptyStateComponent,
    FieldComponent,
    MultiSelectComponent,
    SkeletonComponent,
    TextInputComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ui-settings-section" id="consulta">
      <h2 class="ui-settings-section__title" data-focus-target tabindex="-1">
        {{ 'settings.query' | translate }}
      </h2>
      <p class="ui-settings__hint">{{ 'settings.query-summary' | translate }}</p>

      <form class="ui-settings" (submit)="onSubmit($event)">
        <!-- Os dois campos são o mesmo componente (app-field) na mesma grade:
             mesma largura e mesmo topo, em vez de dois blocos de tamanhos
             diferentes alinhados por baixo. -->
        <div class="ui-settings__fields">
          @switch (load()) {
            @case ('loading') {
              <app-field
                aria-busy="true"
                [label]="'settings.targets' | translate"
                [hint]="'settings.targets-loading' | translate"
              >
                <app-skeleton variant="block" />
              </app-field>
            }
            @case ('failed') {
              <app-alert tone="danger">{{ 'settings.targets-failed' | translate }}</app-alert>
            }
            @default {
              @if (options().length === 0) {
                <app-empty-state [message]="'settings.targets-empty' | translate" />
              } @else {
                <app-field
                  [label]="'settings.targets' | translate"
                  [hint]="'settings.targets-hint' | translate: { max: maxTargets }"
                >
                  <app-multi-select
                    [options]="options()"
                    [placeholder]="'settings.targets-placeholder' | translate"
                    [value]="draftTargets()"
                    (valueChange)="onTargetsChange($event)"
                  />
                </app-field>
              }
            }
          }

          <app-field
            [label]="'settings.interval' | translate"
            [hint]="'settings.interval-hint' | translate"
          >
            <app-text-input [numeric]="true" [(value)]="draftInterval" />
          </app-field>
        </div>

        <!-- O teto é do backend; avisar aqui evita o 400 e explica o
             limite antes de ele ser atingido. -->
        @if (overMax()) {
          <app-alert tone="danger">{{
            'settings.targets-over-max' | translate: { max: maxTargets }
          }}</app-alert>
        }

        <div class="ui-settings__actions ui-settings__actions--start">
          <button
            type="submit"
            appButton
            variant="primary"
            [loading]="saving()"
            [disabled]="!canSave()"
          >
            {{ 'settings.save' | translate }}
          </button>
        </div>

        <!-- A recusa aparece onde se clicou Salvar: o aviso do Painel ficaria
             numa tela que quem salvou não está olhando. -->
        @if (saveErrorText(); as erro) {
          <app-alert tone="danger">{{ erro }}</app-alert>
        }
      </form>

      <app-alert tone="info">{{ 'settings.targets-persisted' | translate }}</app-alert>
    </section>
  `,
})
export class QuerySectionComponent implements OnInit {
  private readonly monitor = inject(GitlabMonitorService);
  private readonly translate = inject(TranslateService);
  // O catálogo chega por HTTP depois da primeira renderização: sem esta
  // dependência, o texto computado ficaria preso ao que existia antes.
  private readonly language: Signal<LangChangeEvent | undefined> = toSignal(
    this.translate.onLangChange,
  );

  protected readonly saving: Signal<boolean> = this.monitor.saving;
  /** O teto do backend, para o formulário impedir antes de ele recusar. */
  protected readonly maxTargets: number = MAX_TARGETS;
  protected readonly load: WritableSignal<TargetsLoad> = signal<TargetsLoad>('loading');
  protected readonly options: WritableSignal<readonly SelectOption[]> = signal<
    readonly SelectOption[]
  >([]);
  // Signal, e não um campo solto: a regra do guia pede tipo explícito em toda
  // propriedade, e o ESLint recusa `: boolean = false` como inferível.
  private readonly edited: WritableSignal<boolean> = signal<boolean>(false);
  private readonly saveError: WritableSignal<MonitorWarning | null> = signal<MonitorWarning | null>(
    null,
  );
  private readonly interval: Signal<string> = computed((): string => {
    const interval = this.monitor.meta().interval;
    return interval ? String(interval) : '';
  });

  // A seleção parte do que o monitor consulta hoje e, assim que a pessoa mexe,
  // passa a ser dela: cada ciclo reenvia o mesmo `targets`, e sem o `edited` a
  // marcação em curso seria sobrescrita a cada resposta.
  protected readonly draftTargets: WritableSignal<readonly string[]> = linkedSignal<
    readonly string[],
    readonly string[]
  >({
    source: (): readonly string[] => this.monitor.targets(),
    computation: (source, previous): readonly string[] =>
      this.edited() && previous ? previous.value : source,
  });

  protected readonly draftInterval: WritableSignal<string> = linkedSignal<string, string>({
    source: (): string => this.interval(),
    computation: (source, previous): string => previous?.value || source,
  });

  protected readonly overMax: Signal<boolean> = computed(
    (): boolean => this.draftTargets().length > MAX_TARGETS,
  );

  protected readonly canSave: Signal<boolean> = computed(
    (): boolean => this.draftTargets().length > 0 && !this.overMax(),
  );

  /** A recusa do backend no idioma ativo: quem decide o texto é o catálogo,
   * pelo `code`; a mensagem do backend é a reserva. */
  protected readonly saveErrorText: Signal<string> = computed((): string => {
    this.language();
    const warning = this.saveError();
    if (!warning) return '';
    return translatedOr(this.translate, warning.key, warning.text ?? '', { max: MAX_TARGETS });
  });

  public ngOnInit(): void {
    void this.loadOptions();
  }

  protected onTargetsChange(value: readonly string[]): void {
    this.edited.set(true);
    this.draftTargets.set(value);
  }

  // Sem NgForm no meio (cada controle cuida do próprio valor), o submit é o
  // nativo: sem preventDefault o navegador recarregaria a página.
  protected onSubmit(event: Event): void {
    event.preventDefault();
    if (!this.canSave()) return;
    void this.save();
  }

  private async save(): Promise<void> {
    this.saveError.set(
      await this.monitor.saveSettings(this.draftTargets(), this.draftInterval().trim()),
    );
  }

  private async loadOptions(): Promise<void> {
    try {
      const targets: readonly AvailableTargetModel[] = await this.monitor.loadTargets();
      this.options.set(targets.map((t): SelectOption => ({ value: t.value, label: t.label })));
      this.load.set('ready');
    } catch {
      this.load.set('failed');
    }
  }
}
