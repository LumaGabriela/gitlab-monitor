import {
  ChangeDetectionStrategy,
  Component,
  InputSignal,
  OutputEmitterRef,
  input,
  output,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { ButtonDirective } from '../button/button.directive';
import { IconComponent } from '../icon/icon.component';

/**
 * Falha de leitura. Diz o que falhou e oferece tentar de novo — erro não
 * vira "sem dados", que faria a tela parecer vazia quando na verdade está
 * quebrada.
 */
@Component({
  selector: 'app-error-state',
  imports: [ButtonDirective, IconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-error-state" role="alert">
      <app-icon class="ui-error-state__icon" name="error" />
      <p class="ui-error-state__message">{{ message() }}</p>
      <button type="button" appButton variant="outline" size="sm" (click)="retry.emit()">
        {{ 'common.try-again' | translate }}
      </button>
    </div>
  `,
})
export class ErrorStateComponent {
  public readonly message: InputSignal<string> = input.required<string>();
  public readonly retry: OutputEmitterRef<void> = output<void>();
}
