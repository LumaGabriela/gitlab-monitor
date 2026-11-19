import { ChangeDetectionStrategy, Component, InputSignal, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { IconComponent } from '../icon/icon.component';

/** Link para fora da aplicação: nova aba, `rel` seguro, ícone e aviso para o
 * leitor de tela, que de outro modo não saberia que a aba vai mudar. */
@Component({
  selector: 'app-external-link',
  imports: [IconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <a class="ui-link ui-link--external" [href]="href()" target="_blank" rel="noopener noreferrer">
      {{ label() }}
      <app-icon name="external-link" size="sm" />
      <span class="ui-visually-hidden">({{ 'common.opens-in-new-tab' | translate }})</span>
    </a>
  `,
})
export class ExternalLinkComponent {
  public readonly href: InputSignal<string> = input.required<string>();
  public readonly label: InputSignal<string> = input.required<string>();
}
