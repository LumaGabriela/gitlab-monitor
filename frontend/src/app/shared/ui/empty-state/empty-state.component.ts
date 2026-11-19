import { ChangeDetectionStrategy, Component, InputSignal, input } from '@angular/core';

/** Estado vazio honesto ("nenhum MR aberto"), com ação opcional projetada.
 * Nunca mostra zero no lugar de "não há". */
@Component({
  selector: 'app-empty-state',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-empty-state">
      <p class="ui-empty-state__message">{{ message() }}</p>
      <ng-content />
    </div>
  `,
})
export class EmptyStateComponent {
  public readonly message: InputSignal<string> = input.required<string>();
}
