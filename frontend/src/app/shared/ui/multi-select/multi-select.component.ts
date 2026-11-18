import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  InputSignal,
  Injector,
  ModelSignal,
  Signal,
  WritableSignal,
  afterNextRender,
  computed,
  forwardRef,
  inject,
  input,
  model,
  signal,
  viewChild,
} from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { TranslatePipe } from '@ngx-translate/core';
import { ControlBase } from '../field/control-base';
import { nextControlId } from '../field/field-context';
import { IconComponent } from '../icon/icon.component';
import { filterOptions } from '../select/option-filter';
import { SelectOption } from '../select/select.model';

/**
 * Escolha múltipla: um gatilho que resume o que está marcado e um painel de
 * caixas de seleção.
 *
 * Não é um <select multiple>, que no desktop exige Ctrl+clique para somar
 * uma opção e no celular vira uma lista rolante sem rótulo. Também não é um
 * menu do CDK: lá o clique do mouse fecha o painel a cada item (é o que
 * `CdkMenuItem.trigger()` faz), e marcar três autores exigiria reabrir três
 * vezes.
 *
 * O que sobra é o que o navegador já resolve: caixas de seleção de verdade,
 * com Tab e Espaço nativos. O painel fecha no Esc e ao sair o foco.
 *
 * **O painel abre com um campo de busca**, que é quem recebe o foco, com a
 * mesma regra do `app-select` (`option-filter.ts`): sem acento e sem caixa, em
 * qualquer parte do rótulo. Filtrar não desmarca nada — o que está marcado e
 * não casa com o termo continua marcado, e volta à vista ao limpar a busca.
 */
@Component({
  selector: 'app-multi-select',
  imports: [IconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ui-multi-select',
    '(keydown.escape)': 'close()',
    '(focusout)': 'closeOnFocusOut($event)',
  },
  providers: [
    {
      provide: NG_VALUE_ACCESSOR,
      useExisting: forwardRef(() => MultiSelectComponent),
      multi: true,
    },
  ],
  template: `
    <button
      type="button"
      class="ui-multi-select__trigger"
      [id]="field?.controlId ?? null"
      [disabled]="isDisabled()"
      [attr.aria-expanded]="open()"
      [attr.aria-controls]="panelId"
      [attr.aria-describedby]="field?.describedBy() ?? null"
      (click)="toggleOpen()"
    >
      <span class="ui-multi-select__value" [class.ui-multi-select__value--empty]="!value().length">
        @if (!value().length) {
          {{ placeholder() }}
        } @else if (value().length === 1) {
          {{ labelFor(value()[0]) }}
        } @else {
          {{ 'multi-select.selected' | translate: { count: value().length } }}
        }
      </span>
      <app-icon name="chevron-down" size="sm" />
    </button>

    @if (open()) {
      <div class="ui-multi-select__panel" [id]="panelId" role="group">
        <div class="ui-select-panel__search">
          <app-icon name="search" size="sm" />
          <input
            #search
            type="text"
            class="ui-select-panel__search-input"
            autocomplete="off"
            [attr.aria-label]="'select.search' | translate"
            [attr.placeholder]="'select.search' | translate"
            [value]="term()"
            (input)="updateTerm($event)"
          />
        </div>

        @for (option of filtered(); track option.value) {
          <label class="ui-checkbox ui-multi-select__option">
            <input
              class="ui-checkbox__input"
              type="checkbox"
              [checked]="isSelected(option.value)"
              (change)="toggle(option.value)"
            />
            <span class="ui-checkbox__label">{{ option.label }}</span>
          </label>
        } @empty {
          <p class="ui-select-panel__empty" role="status">{{ 'select.no-results' | translate }}</p>
        }
      </div>
    }
  `,
})
export class MultiSelectComponent extends ControlBase<readonly string[]> {
  public override readonly value: ModelSignal<readonly string[]> = model<readonly string[]>([]);
  public readonly options: InputSignal<readonly SelectOption[]> = input<readonly SelectOption[]>(
    [],
  );
  /** Texto do gatilho quando nada está marcado. Já traduzido por quem usa. */
  public readonly placeholder: InputSignal<string> = input<string>('');

  protected readonly open: WritableSignal<boolean> = signal<boolean>(false);
  protected readonly panelId: string = nextControlId('multi-select-painel');
  /** O que foi digitado na busca; zerado a cada abertura. */
  protected readonly term: WritableSignal<string> = signal<string>('');
  protected readonly filtered: Signal<readonly SelectOption[]> = computed(
    (): readonly SelectOption[] => filterOptions(this.options(), this.term()),
  );

  private readonly host = inject<ElementRef<HTMLElement>>(ElementRef);
  private readonly injector = inject(Injector);
  private readonly search: Signal<ElementRef<HTMLInputElement> | undefined> =
    viewChild<ElementRef<HTMLInputElement>>('search');

  protected toggleOpen(): void {
    if (this.open()) {
      this.close();
      return;
    }
    // Zerado ao abrir: o termo é passageiro, e reabrir com o filtro da vez
    // anterior esconderia opções sem ninguém ter pedido.
    this.term.set('');
    this.open.set(true);
    // O campo só existe depois que o painel é renderizado.
    afterNextRender((): void => void this.search()?.nativeElement.focus(), {
      injector: this.injector,
    });
  }

  protected close(): void {
    this.open.set(false);
  }

  protected updateTerm(event: Event): void {
    this.term.set((event.target as HTMLInputElement).value);
  }

  /** Sair do componente inteiro fecha; andar entre as caixas, não. */
  protected closeOnFocusOut(event: FocusEvent): void {
    const next = event.relatedTarget;
    if (next instanceof Node && this.host.nativeElement.contains(next)) return;
    this.markTouched();
    this.close();
  }

  protected isSelected(value: string): boolean {
    return this.value().includes(value);
  }

  protected toggle(value: string): void {
    const current = this.value();
    this.commit(
      current.includes(value) ? current.filter((item) => item !== value) : [...current, value],
    );
  }

  /** Um nome quando é só um; a contagem quando são vários, porque a lista
   * inteira estouraria a largura do gatilho. */
  protected labelFor(value: string): string {
    return this.options().find((option) => option.value === value)?.label ?? value;
  }
}
