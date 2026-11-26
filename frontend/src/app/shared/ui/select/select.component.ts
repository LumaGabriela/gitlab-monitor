import { CdkListbox, CdkOption, ListboxValueChangeEvent } from '@angular/cdk/listbox';
import { CdkConnectedOverlay, CdkOverlayOrigin, ConnectedPosition } from '@angular/cdk/overlay';
import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  InputSignal,
  ModelSignal,
  Signal,
  WritableSignal,
  computed,
  forwardRef,
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
import { filterOptions } from './option-filter';
import { SelectOption } from './select.model';

/**
 * Seleção (guia input, Select): gatilho `combobox` e lista própria em sobreposição, para a lista seguir o tema
 * em vez de abrir o menu do sistema. Teclado, papéis e foco vêm do CDK (`cdkListbox`, `cdkConnectedOverlay`).
 * O `placeholder` vira a primeira opção, de valor vazio.
 *
 * **O painel abre com um campo de busca**, que é quem recebe o foco: digitar
 * filtra a lista (sem acento e sem caixa, `option-filter.ts`) e a seta para
 * baixo passa o foco para ela. O termo não é estado de ninguém — some ao
 * fechar, porque a escolha é que fica.
 */
@Component({
  selector: 'app-select',
  imports: [
    CdkListbox,
    CdkOption,
    CdkConnectedOverlay,
    CdkOverlayOrigin,
    IconComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => SelectComponent), multi: true },
  ],
  template: `
    <div class="ui-select-wrap">
      <button
        type="button"
        class="ui-select"
        cdkOverlayOrigin
        #origin="cdkOverlayOrigin"
        role="combobox"
        aria-haspopup="listbox"
        [id]="id"
        [disabled]="isDisabled()"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="open() ? panelId : null"
        [attr.aria-label]="ariaLabel()"
        [attr.aria-required]="field?.required() ? 'true' : null"
        [attr.aria-invalid]="field?.invalid() ? 'true' : null"
        [attr.aria-describedby]="field?.describedBy() ?? null"
        (click)="toggleOpen()"
        (keydown.arrowdown)="openFromKeyboard($event)"
        (keydown.arrowup)="openFromKeyboard($event)"
        (blur)="markTouched()"
      >
        <span class="ui-select__value" [class.ui-select__value--empty]="isEmpty()">{{
          label()
        }}</span>
      </button>
      <app-icon class="ui-select-wrap__chevron" name="chevron-down" size="sm" />
    </div>

    <ng-template
      cdkConnectedOverlay
      [cdkConnectedOverlayOrigin]="origin"
      [cdkConnectedOverlayOpen]="open()"
      [cdkConnectedOverlayWidth]="width()"
      [cdkConnectedOverlayPositions]="positions"
      (attach)="focusSearch()"
      (overlayOutsideClick)="close(false)"
      (overlayKeydown)="closeOnEscape($event)"
      (detach)="close(false)"
    >
      <div class="ui-select-panel">
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
            (keydown.arrowdown)="focusList($event)"
          />
        </div>

        <ul
          #list
          class="ui-select-panel__list"
          cdkListbox
          [id]="panelId"
          [cdkListboxValue]="selection()"
          [attr.aria-label]="ariaLabel()"
          (cdkListboxValueChange)="choose($event)"
        >
          @if (placeholder() !== null && !term().trim()) {
            <li class="ui-select-panel__option" [cdkOption]="''">{{ placeholder() }}</li>
          }
          @for (option of filtered(); track option.value) {
            <li
              class="ui-select-panel__option"
              [cdkOption]="option.value"
              [cdkOptionDisabled]="option.disabled ?? false"
            >
              {{ option.label }}
            </li>
          }
        </ul>

        @if (!filtered().length) {
          <p class="ui-select-panel__empty" role="status">{{ 'select.no-results' | translate }}</p>
        }
      </div>
    </ng-template>
  `,
})
export class SelectComponent extends ControlBase<string> {
  public override readonly value: ModelSignal<string> = model<string>('');
  public readonly options: InputSignal<readonly SelectOption[]> = input<readonly SelectOption[]>(
    [],
  );
  public readonly placeholder: InputSignal<string | null> = input<string | null>(null);
  public readonly ariaLabel: InputSignal<string | null> = input<string | null>(null);

  private readonly trigger: Signal<ElementRef<HTMLButtonElement> | undefined> = viewChild(
    CdkOverlayOrigin,
    { read: ElementRef },
  );
  private readonly list: Signal<ElementRef<HTMLElement> | undefined> =
    viewChild<ElementRef<HTMLElement>>('list');
  private readonly search: Signal<ElementRef<HTMLInputElement> | undefined> =
    viewChild<ElementRef<HTMLInputElement>>('search');

  protected readonly id: string = this.field?.controlId ?? nextControlId('selection');
  protected readonly panelId: string = `${this.id}-list`;
  /** Abaixo do gatilho; acima quando não couber. O respiro é a margem do painel, em token. */
  protected readonly positions: ConnectedPosition[] = [
    { originX: 'start', originY: 'bottom', overlayX: 'start', overlayY: 'top' },
    { originX: 'start', originY: 'top', overlayX: 'start', overlayY: 'bottom' },
  ];

  protected readonly open: WritableSignal<boolean> = signal(false);
  /** O que foi digitado na busca; zerado a cada abertura. */
  protected readonly term: WritableSignal<string> = signal<string>('');
  protected readonly filtered: Signal<readonly SelectOption[]> = computed(
    (): readonly SelectOption[] => filterOptions(this.options(), this.term()),
  );
  /** Largura do gatilho, medida ao abrir: o painel não pode ficar mais estreito que o campo. */
  protected readonly width: WritableSignal<number> = signal(0);

  /**
   * Valor do `cdkListbox`, que trabalha com lista mesmo na escolha única.
   *
   * **Só entra aqui o valor que tem uma opção na tela.** O CDK confere isso em
   * `ngAfterContentInit` e, quando não bate, lança "Listbox has selected values
   * that do not match any of its options" — **antes** de registrar o
   * gerenciador de teclado e a escuta de clique. A lista fica surda para
   * sempre: o painel abre, mas clicar numa opção não faz nada.
   *
   * Era o que acontecia ao abrir o painel antes de `/data` trazer as
   * ordenações: o valor guardado já valia e opção nenhuma existia ainda. Só
   * aparecia sob carga, porque depende de a resposta demorar mais que o clique.
   *
   * O rótulo do gatilho sai de `value()`, e não daqui, então nada some da tela
   * enquanto a opção correspondente não existe.
   */
  protected readonly selection: Signal<readonly string[]> = computed((): readonly string[] => {
    const current: string = this.value();
    const placeholderShown: boolean = this.placeholder() !== null && !this.term().trim();
    const rendered: boolean =
      (placeholderShown && current === '') ||
      this.filtered().some((option: SelectOption): boolean => option.value === current);
    return rendered ? [current] : [];
  });
  protected readonly isEmpty: Signal<boolean> = computed((): boolean => this.value() === '');
  protected readonly label: Signal<string> = computed((): string => {
    const chosen: SelectOption | undefined = this.options().find(
      (o: SelectOption): boolean => o.value === this.value(),
    );
    return chosen?.label ?? this.placeholder() ?? '';
  });

  protected toggleOpen(): void {
    if (this.isDisabled()) return;
    if (this.open()) {
      this.close(true);
      return;
    }
    this.width.set(this.trigger()?.nativeElement.offsetWidth ?? 0);
    // Zerado ao abrir: o termo é passageiro, e reabrir com o filtro da vez
    // anterior esconderia opções sem ninguém ter pedido.
    this.term.set('');
    this.open.set(true);
  }

  protected openFromKeyboard(event: Event): void {
    if (this.open()) return;
    event.preventDefault();
    this.toggleOpen();
  }

  protected close(restoreFocus: boolean): void {
    if (!this.open()) return;
    this.open.set(false);
    if (restoreFocus) this.trigger()?.nativeElement.focus();
  }

  /** Ao abrir, o foco vai para a busca: é por onde se chega à opção numa lista
   * longa, e a seta para baixo leva à lista sem tirar a mão do teclado. */
  protected focusSearch(): void {
    this.search()?.nativeElement.focus();
  }

  protected focusList(event?: Event): void {
    event?.preventDefault();
    this.list()?.nativeElement.focus();
  }

  protected updateTerm(event: Event): void {
    this.term.set((event.target as HTMLInputElement).value);
  }

  protected closeOnEscape(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      event.preventDefault();
      this.close(true);
    }
  }

  protected choose(event: ListboxValueChangeEvent<string>): void {
    this.commit(event.value[0] ?? '');
    this.close(true);
  }
}
