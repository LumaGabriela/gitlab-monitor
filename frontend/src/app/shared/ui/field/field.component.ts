import {
  ChangeDetectionStrategy,
  Component,
  InputSignal,
  Signal,
  computed,
  input,
} from '@angular/core';
import { FIELD_CONTEXT, FieldContext, nextControlId } from './field-context';

/**
 * Moldura de um campo: rótulo, controle projetado, ajuda e erro. Não conhece
 * o controle que recebe — quem precisa dos ids injeta FIELD_CONTEXT.
 */
@Component({
  selector: 'app-field',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ui-field' },
  providers: [{ provide: FIELD_CONTEXT, useExisting: FieldComponent }],
  template: `
    @if (label(); as text) {
      <label class="ui-field__label" [attr.for]="controlId">
        {{ text }}
        @if (required()) {
          <span class="ui-field__required" aria-hidden="true">*</span>
        }
      </label>
    }

    <ng-content />

    @if (error(); as message) {
      <span class="ui-field__error" [id]="errorId">{{ message }}</span>
    } @else if (hint(); as message) {
      <span class="ui-field__helper" [id]="hintId">{{ message }}</span>
    }
  `,
})
export class FieldComponent implements FieldContext {
  public readonly label: InputSignal<string | null> = input<string | null>(null);
  public readonly hint: InputSignal<string | null> = input<string | null>(null);
  public readonly error: InputSignal<string | null> = input<string | null>(null);
  public readonly required: InputSignal<boolean> = input<boolean>(false);

  public readonly controlId: string = nextControlId('campo');
  protected readonly hintId: string = `${this.controlId}-ajuda`;
  protected readonly errorId: string = `${this.controlId}-erro`;

  public readonly invalid: Signal<boolean> = computed((): boolean => this.error() !== null);

  // Só um dos dois é renderizado por vez, então o aria-describedby aponta
  // exatamente para o texto que está na tela.
  public readonly describedBy: Signal<string | null> = computed((): string | null => {
    if (this.error()) return this.errorId;
    if (this.hint()) return this.hintId;
    return null;
  });
}
