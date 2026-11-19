import { Directive, ElementRef, InputSignal, Signal, computed, inject, input } from '@angular/core';

export type ButtonVariant = 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
export type ButtonSize = 'sm' | 'md' | 'lg';

/**
 * Botão do DS aplicado sobre o <button> ou <a> nativo, e não um componente
 * que embrulha um deles: assim o type, o disabled, o submit do formulário e
 * o teclado continuam sendo os do elemento, sem reemitir evento nenhum.
 *
 * Em um <a>, `disabled` não existe como atributo: a diretiva usa
 * aria-disabled e tira o elemento da ordem de tabulação.
 */
@Directive({
  selector: 'button[appButton], a[appButton]',
  host: {
    class: 'ui-button',
    '[class.ui-button--primary]': "variant() === 'primary'",
    '[class.ui-button--secondary]': "variant() === 'secondary'",
    '[class.ui-button--outline]': "variant() === 'outline'",
    '[class.ui-button--ghost]': "variant() === 'ghost'",
    '[class.ui-button--danger]': "variant() === 'danger'",
    '[class.ui-button--sm]': "size() === 'sm'",
    '[class.ui-button--lg]': "size() === 'lg'",
    '[class.ui-button--full-width]': 'fullWidth()',
    '[class.ui-button--loading]': 'loading()',
    '[attr.aria-busy]': "loading() ? 'true' : null",
    '[attr.aria-pressed]': 'pressed() === null ? null : pressed()',
    '[attr.disabled]': "isButton && inactive() ? '' : null",
    '[attr.aria-disabled]': "!isButton && inactive() ? 'true' : null",
    '[attr.tabindex]': '!isButton && inactive() ? -1 : null',
  },
})
export class ButtonDirective {
  public readonly variant: InputSignal<ButtonVariant> = input<ButtonVariant>('outline');
  public readonly size: InputSignal<ButtonSize> = input<ButtonSize>('md');
  public readonly loading: InputSignal<boolean> = input<boolean>(false);
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);
  public readonly pressed: InputSignal<boolean | null> = input<boolean | null>(null);
  public readonly fullWidth: InputSignal<boolean> = input<boolean>(false);

  protected readonly isButton: boolean =
    inject<ElementRef<HTMLElement>>(ElementRef).nativeElement.tagName.toLowerCase() === 'button';

  protected readonly inactive: Signal<boolean> = computed(
    (): boolean => this.disabled() || this.loading(),
  );
}
