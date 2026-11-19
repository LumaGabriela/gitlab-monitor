import { Directive, input, InputSignal } from '@angular/core';

export type IconButtonSize = 'sm' | 'md';
export type IconButtonVariant = 'ghost' | 'outline';

/**
 * Botão só com ícone (guia button, icon-only). O `label` é obrigatório e vira o nome acessível.
 * Uso: `<button type="button" appIconButton label="Fechar"><app-icon name="close" /></button>`.
 */
@Directive({
  // Adaptação: o gitlab também usa o botão de ícone como link (a[appIconButton], engrenagem de /settings)
  selector: 'button[appIconButton], a[appIconButton]',
  host: {
    class: 'ui-icon-button',
    '[class.ui-icon-button--sm]': "size() === 'sm'",
    '[class.ui-icon-button--md]': "size() === 'md'",
    '[class.ui-icon-button--outline]': "variant() === 'outline'",
    '[attr.aria-label]': 'label()',
    '[attr.disabled]': "disabled() ? '' : null",
  },
})
export class IconButtonDirective {
  public readonly label: InputSignal<string> = input.required<string>();
  public readonly size: InputSignal<IconButtonSize> = input<IconButtonSize>('md');
  public readonly variant: InputSignal<IconButtonVariant> = input<IconButtonVariant>('ghost');
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);
}
