import {
  ChangeDetectionStrategy,
  Component,
  InputSignal,
  ModelSignal,
  forwardRef,
  input,
  model,
} from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { ControlBase } from '../field/control-base';
import { nextControlId } from '../field/field-context';

/**
 * Caixa de seleção com rótulo próprio: ao contrário dos outros controles,
 * este não vive dentro de um <app-field>, porque o rótulo de uma caixa fica
 * ao lado dela e é clicável junto.
 */
@Component({
  selector: 'app-checkbox',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => CheckboxComponent), multi: true },
  ],
  template: `
    <label class="ui-checkbox" [class.ui-checkbox--disabled]="isDisabled()" [attr.for]="controlId">
      <input
        class="ui-checkbox__input"
        type="checkbox"
        [id]="controlId"
        [checked]="value()"
        [disabled]="isDisabled()"
        (change)="onToggle($event)"
        (blur)="markTouched()"
      />
      <span class="ui-checkbox__label">{{ label() }}</span>
    </label>
  `,
})
export class CheckboxComponent extends ControlBase<boolean> {
  public override readonly value: ModelSignal<boolean> = model<boolean>(false);
  public readonly label: InputSignal<string> = input<string>('');

  protected readonly controlId: string = nextControlId('caixa');

  protected onToggle(event: Event): void {
    this.commit((event.target as HTMLInputElement).checked);
  }
}
