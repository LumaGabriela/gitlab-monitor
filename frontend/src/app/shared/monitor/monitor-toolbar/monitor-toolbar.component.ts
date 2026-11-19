import {
  ChangeDetectionStrategy,
  Component,
  Injector,
  InputSignal,
  OutputEmitterRef,
  Signal,
  afterNextRender,
  computed,
  inject,
  input,
  output,
  viewChild,
} from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LangChangeEvent, TranslatePipe, TranslateService } from '@ngx-translate/core';
import { LabeledValueModel } from '../../../core/models/api/panel-api.model';
import { REVIEW_FILTER_VALUES } from '../../../core/services/gitlab-monitor.service';
import { ButtonDirective } from '../../ui/button/button.directive';
import { FieldComponent } from '../../ui/field/field.component';
import { MultiSelectComponent } from '../../ui/multi-select/multi-select.component';
import { SelectComponent } from '../../ui/select/select.component';
import { translatedOr } from '../cell-text';

/** Barra de ordenação e filtros. Só emite o que foi escolhido — quem guarda
 * e aplica é o serviço, uma camada acima. */
@Component({
  selector: 'app-monitor-toolbar',
  imports: [ButtonDirective, FieldComponent, MultiSelectComponent, SelectComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ui-toolbar" [attr.aria-label]="'monitor.filters' | translate">
      <app-field class="ui-toolbar__field" [label]="'monitor.sort-by' | translate">
        <app-select
          [options]="sortOptions()"
          [value]="sort()"
          (valueChange)="sortChange.emit($event)"
        />
      </app-field>

      <app-field class="ui-toolbar__field" [label]="'monitor.author' | translate">
        <app-multi-select
          [options]="authors()"
          [value]="author()"
          [placeholder]="'monitor.all' | translate"
          (valueChange)="authorChange.emit($event)"
        />
      </app-field>

      <app-field class="ui-toolbar__field" [label]="'monitor.pipeline' | translate">
        <app-multi-select
          [options]="pipelines()"
          [value]="pipeline()"
          [placeholder]="'monitor.all' | translate"
          (valueChange)="pipelineChange.emit($event)"
        />
      </app-field>

      <app-field class="ui-toolbar__field" [label]="'monitor.filter-review' | translate">
        <app-multi-select
          [options]="reviewOptions()"
          [value]="review()"
          [placeholder]="'monitor.all' | translate"
          (valueChange)="reviewChange.emit($event)"
        />
      </app-field>

      <app-field class="ui-toolbar__field" [label]="'monitor.preset' | translate">
        <app-select
          #presetSelect
          data-test="preset-select"
          [options]="presets()"
          [value]="activePreset()"
          [placeholder]="'monitor.preset-apply' | translate"
          (valueChange)="onPreset($event)"
        />
      </app-field>

      <button
        type="button"
        class="ui-toolbar__reset"
        appButton
        variant="ghost"
        (click)="clearFilters.emit()"
      >
        {{ 'monitor.clear-filters' | translate }}
      </button>
    </section>
  `,
})
export class MonitorToolbarComponent {
  private readonly translate = inject(TranslateService);
  private readonly injector = inject(Injector);
  private restoringPreset = false;
  private readonly presetSelect: Signal<SelectComponent | undefined> = viewChild(
    'presetSelect',
    { read: SelectComponent },
  );
  // O catálogo chega por HTTP depois da primeira renderização: sem esta
  // dependência, as opções ficariam presas ao que existia antes dele carregar.
  private readonly language: Signal<LangChangeEvent | undefined> = toSignal(
    this.translate.onLangChange,
  );

  public readonly sorts: InputSignal<readonly LabeledValueModel[]> = input<
    readonly LabeledValueModel[]
  >([]);
  public readonly authors: InputSignal<readonly LabeledValueModel[]> = input<
    readonly LabeledValueModel[]
  >([]);
  public readonly pipelines: InputSignal<readonly LabeledValueModel[]> = input<
    readonly LabeledValueModel[]
  >([]);
  public readonly sort: InputSignal<string> = input<string>('recent');
  public readonly author: InputSignal<readonly string[]> = input<readonly string[]>([]);
  public readonly pipeline: InputSignal<readonly string[]> = input<readonly string[]>([]);

  public readonly review: InputSignal<readonly string[]> = input<readonly string[]>([]);
  /** Os presets oferecidos, com o nome já no idioma ativo. */
  public readonly presets: InputSignal<readonly LabeledValueModel[]> = input<
    readonly LabeledValueModel[]
  >([]);
  /** O preset que o estado atual reproduz, ou vazio: é o que o seletor mostra. */
  public readonly activePreset: InputSignal<string> = input<string>('');

  public readonly sortChange: OutputEmitterRef<string> = output<string>();
  public readonly authorChange: OutputEmitterRef<readonly string[]> = output<readonly string[]>();
  public readonly pipelineChange: OutputEmitterRef<readonly string[]> = output<readonly string[]>();
  public readonly reviewChange: OutputEmitterRef<readonly string[]> = output<readonly string[]>();
  public readonly presetChange: OutputEmitterRef<string> = output<string>();
  public readonly clearFilters: OutputEmitterRef<void> = output<void>();

  /** Revisão no idioma ativo: valor fixo do backend, rótulo do catálogo. */
  protected readonly reviewOptions: Signal<readonly LabeledValueModel[]> = computed(
    (): readonly LabeledValueModel[] => {
      this.language();
      return REVIEW_FILTER_VALUES.map((value) => ({
        value,
        label: translatedOr(this.translate, `monitor.review-${value}`, value),
      }));
    },
  );

  /** As ordenações no idioma ativo; chave fora do catálogo cai no rótulo do backend. */
  protected readonly sortOptions: Signal<readonly LabeledValueModel[]> = computed(
    (): readonly LabeledValueModel[] => {
      this.language();
      return this.sorts().map((option) => ({
        value: option.value,
        label: translatedOr(this.translate, `sorts.${option.value}`, option.label),
      }));
    },
  );

  /** Escolher o item de apresentação (valor vazio) não aplica nada. */
  protected onPreset(id: string): void {
    // O valor que volta do próprio ajuste abaixo não é uma escolha.
    if (!id || this.restoringPreset) return;
    this.presetChange.emit(id);
    // O select já guarda a escolha; se o preset não passou a corresponder ao
    // estado (aplicado só em parte), o `activePreset` não muda e o select
    // seguiria afirmando o que não é verdade. Depois da renderização, volta
    // ao que o estado diz.
    afterNextRender(
      (): void => {
        const select: SelectComponent | undefined = this.presetSelect();
        if (!select) return;
        // `value` é um model: escrever nele emite `valueChange`, que volta a
        // `onPreset`. Sem a bandeira, o ajuste reaplicaria o preset anterior.
        this.restoringPreset = true;
        try {
          select.value.set(this.activePreset());
        } finally {
          this.restoringPreset = false;
        }
      },
      { injector: this.injector },
    );
  }
}
