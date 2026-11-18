import { ChangeDetectionStrategy, Component, InputSignal, input } from '@angular/core';
import { CapitalizePipe } from '../../pipes/capitalize.pipe';
import { IconComponent } from '../icon/icon.component';
import { IconName } from '../icon/icon-registry';

/**
 * Tons do guia "feedback" do DS, mais `strong`: o DS não tem um tom para
 * "já resolvido do ponto de vista de quem revisa" (o MR que já recebeu o seu
 * like), e usar `success` ali diria que a pipeline passou.
 */
export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'strong';

/**
 * Selo/etiqueta. `fixedWidth` reserva espaço constante nas colunas de
 * contagem, para os selos de linhas diferentes alinharem entre si em vez de
 * dançar com o número. `label` substitui o texto no leitor de tela quando o
 * rótulo visível é curto demais para fazer sentido sozinho (ex.: "3").
 *
 * O texto entra maiúsculo na primeira letra: o backend manda "sem conflito"
 * e "falhou" em caixa baixa, porque na tabela do terminal eles são valores
 * no meio de uma linha, e aqui cada um é uma etiqueta por si.
 */
@Component({
  selector: 'app-badge',
  imports: [CapitalizePipe, IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ui-tag',
    '[class.ui-tag--neutral]': "tone() === 'neutral'",
    '[class.ui-tag--success]': "tone() === 'success'",
    '[class.ui-tag--warning]': "tone() === 'warning'",
    '[class.ui-tag--danger]': "tone() === 'danger'",
    '[class.ui-tag--info]': "tone() === 'info'",
    '[class.ui-tag--strong]': "tone() === 'strong'",
    '[class.ui-tag--dashed]': 'dashed()',
    '[class.ui-tag--fixed]': 'fixedWidth()',
    '[attr.aria-label]': 'label()',
  },
  template: `
    @if (icon(); as name) {
      <app-icon [name]="name" size="sm" />
    }
    <span [attr.aria-hidden]="label() ? 'true' : null">{{ text() | appCapitalize }}</span>
    <ng-content />
  `,
})
export class BadgeComponent {
  public readonly text: InputSignal<string> = input<string>('');
  public readonly tone: InputSignal<BadgeTone> = input<BadgeTone>('neutral');
  public readonly icon: InputSignal<IconName | null> = input<IconName | null>(null);
  public readonly dashed: InputSignal<boolean> = input<boolean>(false);
  public readonly fixedWidth: InputSignal<boolean> = input<boolean>(false);
  public readonly label: InputSignal<string | null> = input<string | null>(null);
}
