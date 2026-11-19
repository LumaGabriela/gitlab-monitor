import {
  ChangeDetectionStrategy,
  Component,
  InputSignal,
  ModelSignal,
  input,
  model,
} from '@angular/core';
import { nextControlId } from '../field/field-context';
import { IconComponent } from '../icon/icon.component';

/**
 * Bloco recolhível: botão com chevron que gira, rótulo e valor à direita
 * (`meta`). Aberto/fechado em two-way: `[(open)]`.
 *
 * Um <details> nativo resolveria o essencial, mas não deixa estilizar o
 * marcador nem animar o giro do chevron de forma consistente entre
 * navegadores; aqui o botão carrega aria-expanded e aria-controls.
 */
@Component({
  selector: 'app-disclosure',
  imports: [IconComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-disclosure-item" [class.ui-disclosure-item--open]="open()">
      <button
        type="button"
        class="ui-disclosure-item__summary"
        [attr.aria-expanded]="open()"
        [attr.aria-controls]="bodyId"
        (click)="open.set(!open())"
      >
        <app-icon class="ui-disclosure-item__chevron" name="chevron-right" size="sm" />
        <span class="ui-disclosure-item__label">{{ label() }}</span>
        @if (meta(); as value) {
          <span class="ui-disclosure-item__meta">{{ value }}</span>
        }
      </button>
      @if (open()) {
        <div class="ui-disclosure-item__body" [id]="bodyId"><ng-content /></div>
      }
    </div>
  `,
})
export class DisclosureComponent {
  public readonly label: InputSignal<string> = input.required<string>();
  public readonly meta: InputSignal<string | null> = input<string | null>(null);
  public readonly open: ModelSignal<boolean> = model<boolean>(false);

  protected readonly bodyId: string = nextControlId('recolhivel');
}
