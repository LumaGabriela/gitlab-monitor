import { ChangeDetectionStrategy, Component, InputSignal, input } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';
import { IconComponent } from '../../ui/icon/icon.component';

/**
 * Marca de que aquele campo mudou desde a última coleta. Carrega rótulo
 * acessível porque é o único portador da informação na célula: sem ele, quem
 * usa leitor de tela não saberia que o valor é novo.
 */
@Component({
  selector: 'app-changed-mark',
  imports: [IconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (visible()) {
      <app-icon
        class="ui-changed-mark"
        name="changed"
        size="sm"
        [label]="'monitor.changed-since-last-check' | translate"
      />
    }
  `,
})
export class ChangedMarkComponent {
  public readonly visible: InputSignal<boolean> = input<boolean>(false);
}
