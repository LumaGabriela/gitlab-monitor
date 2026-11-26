import { ChangeDetectionStrategy, Component, InputSignal, input } from '@angular/core';

export type AlertTone = 'neutral' | 'info' | 'success' | 'warning' | 'danger';

/**
 * Aviso em bloco (guia "feedback"). `role="status"` para que uma mensagem que
 * aparece depois do carregamento — um erro de consulta, por exemplo — seja
 * anunciada sem roubar o foco de quem está digitando.
 */
@Component({
  selector: 'app-alert',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ui-alert',
    role: 'status',
    '[class.ui-alert--info]': "tone() === 'info'",
    '[class.ui-alert--success]': "tone() === 'success'",
    '[class.ui-alert--warning]': "tone() === 'warning'",
    '[class.ui-alert--danger]': "tone() === 'danger'",
  },
  template: `<ng-content />`,
})
export class AlertComponent {
  public readonly tone: InputSignal<AlertTone> = input<AlertTone>('info');
}
