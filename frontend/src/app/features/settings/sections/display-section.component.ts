import { ChangeDetectionStrategy, Component, Signal, computed, inject } from '@angular/core';
import { toSignal } from '@angular/core/rxjs-interop';
import { LangChangeEvent, TranslatePipe, TranslateService } from '@ngx-translate/core';
import { GitlabMonitorService } from '../../../core/services/gitlab-monitor.service';
import { DENSITIES, Density, DensityService } from '../../../core/services/density.service';
import { TEXT_SIZES, TextSize, TextSizeService } from '../../../core/services/text-size.service';
import { FieldComponent } from '../../../shared/ui/field/field.component';
import { SelectComponent } from '../../../shared/ui/select/select.component';
import { SelectOption } from '../../../shared/ui/select/select.model';
import { TextInputComponent } from '../../../shared/ui/text-input/text-input.component';

/**
 * Preferências de exibição, guardadas no navegador: nada aqui vai ao
 * backend ao salvar, então a seção não tem botão Salvar.
 */
@Component({
  selector: 'app-display-section',
  imports: [FieldComponent, SelectComponent, TextInputComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <section class="ui-settings-section" id="exibicao">
      <h2 class="ui-settings-section__title" data-focus-target tabindex="-1">
        {{ 'settings.display' | translate }}
      </h2>
      <p class="ui-settings__hint">{{ 'settings.display-summary' | translate }}</p>

      <div class="ui-settings__fields">
        <app-field [label]="'settings.density' | translate">
          <app-select
            [options]="densityOptions()"
            [value]="density()"
            (valueChange)="onDensityChange($event)"
          />
        </app-field>

        <app-field [label]="'settings.text-size' | translate">
          <app-select
            [options]="textSizeOptions()"
            [value]="textSize()"
            (valueChange)="onTextSizeChange($event)"
          />
        </app-field>

        <app-field
          [label]="'settings.likes-highlight' | translate"
          [hint]="'settings.likes-highlight-hint' | translate"
        >
          <app-text-input
            [numeric]="true"
            [value]="likesHighlightText()"
            (valueChange)="onLikesHighlightChange($event)"
          />
        </app-field>
      </div>
    </section>
  `,
})
export class DisplaySectionComponent {
  private readonly monitor = inject(GitlabMonitorService);
  private readonly densityPref = inject(DensityService);
  private readonly textSizePref = inject(TextSizeService);
  private readonly translate = inject(TranslateService);

  protected readonly density: Signal<Density> = this.densityPref.density;
  protected readonly textSize: Signal<TextSize> = this.textSizePref.size;
  protected readonly likesHighlight: Signal<number> = this.monitor.likesHighlight;

  // O catálogo chega por HTTP depois da primeira renderização: sem esta
  // dependência, o computed ficaria preso ao que existia antes dele carregar
  // e a chave crua apareceria no lugar do rótulo.
  private readonly language: Signal<LangChangeEvent | undefined> = toSignal(
    this.translate.onLangChange,
  );

  protected readonly likesHighlightText: Signal<string> = computed((): string =>
    String(this.likesHighlight()),
  );

  protected readonly densityOptions: Signal<readonly SelectOption[]> = computed(
    (): readonly SelectOption[] => {
      this.language();
      return DENSITIES.map((value) => ({
        value,
        label: String(this.translate.instant(`settings.density-${value}`)),
      }));
    },
  );

  protected readonly textSizeOptions: Signal<readonly SelectOption[]> = computed(
    (): readonly SelectOption[] => {
      this.language();
      return TEXT_SIZES.map((value) => ({
        value,
        label: String(this.translate.instant(`settings.text-size-${value}`)),
      }));
    },
  );

  protected onDensityChange(value: string): void {
    this.densityPref.setDensity(value as Density);
  }

  protected onTextSizeChange(value: string): void {
    this.textSizePref.setSize(value as TextSize);
  }

  /** Vazio, negativo ou texto valem como zero: a preferência é "a partir de
   * quantos likes destacar", e abaixo de um não há limite a aplicar. */
  protected onLikesHighlightChange(value: string): void {
    const limite = Number.parseInt(value, 10);
    this.monitor.setLikesHighlight(Number.isFinite(limite) && limite > 0 ? limite : 0);
  }
}
