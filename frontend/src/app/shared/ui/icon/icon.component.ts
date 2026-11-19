import {
  ChangeDetectionStrategy,
  Component,
  computed,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { LucideDynamicIcon, LucideIcon } from '@lucide/angular';

import { ICON_REGISTRY, IconName } from './icon-registry';

export type { IconName } from './icon-registry';
export type IconSize = 'sm' | 'md' | 'lg';

/**
 * Ícone do Design System. Sem `label` é decorativo (escondido do leitor de tela); com `label` vira imagem com
 * nome acessível. O tamanho sai dos tokens `--size-icon-*` pela classe `.ui-icon--{size}`.
 */
@Component({
  selector: 'app-icon',
  imports: [LucideDynamicIcon],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ui-icon',
    '[class.ui-icon--sm]': "size() === 'sm'",
    '[class.ui-icon--md]': "size() === 'md'",
    '[class.ui-icon--lg]': "size() === 'lg'",
    '[attr.role]': "label() ? 'img' : null",
    '[attr.aria-label]': 'label()',
    '[attr.aria-hidden]': "label() ? null : 'true'",
  },
  template: `<svg [lucideIcon]="icon()" aria-hidden="true" focusable="false"></svg>`,
})
export class IconComponent {
  public readonly name: InputSignal<IconName> = input.required<IconName>();
  public readonly size: InputSignal<IconSize> = input<IconSize>('md');
  public readonly label: InputSignal<string | null> = input<string | null>(null);

  protected readonly icon: Signal<LucideIcon> = computed(
    (): LucideIcon => ICON_REGISTRY[this.name()],
  );
}
