import {
  ChangeDetectionStrategy,
  Component,
  InputSignal,
  ModelSignal,
  forwardRef,
  model,
  input,
} from '@angular/core';
import { NG_VALUE_ACCESSOR } from '@angular/forms';
import { ControlBase } from '../field/control-base';

/**
 * Entrada de texto sobre o <input> nativo. Pensado para ficar dentro de um
 * <app-field>, de onde tira o id, o aria-describedby e o estado de erro.
 *
 * **`numeric` é o campo que só aceita número inteiro**: teclado numérico no
 * celular, `pattern` para o navegador, e o que não for dígito é recusado na
 * digitação e na colagem. Não é `type="number"` de propósito — ali o navegador
 * aceita `e`, `+` e `-`, devolve string vazia quando o que está escrito não é
 * número (a tela perderia o que a pessoa vê) e desenha setas que a escala de
 * densidade não alcança.
 */
@Component({
  selector: 'app-text-input',
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: NG_VALUE_ACCESSOR, useExisting: forwardRef(() => TextInputComponent), multi: true },
  ],
  template: `
    <input
      class="ui-input"
      [id]="field?.controlId ?? null"
      [type]="type()"
      [inputMode]="numeric() ? 'numeric' : 'text'"
      [attr.pattern]="numeric() ? '[0-9]*' : null"
      [placeholder]="placeholder()"
      [disabled]="isDisabled()"
      [value]="value()"
      [attr.required]="field?.required() ? '' : null"
      [attr.aria-invalid]="field?.invalid() ? 'true' : null"
      [attr.aria-describedby]="field?.describedBy() ?? null"
      autocomplete="off"
      (input)="onInput($event)"
      (blur)="markTouched()"
    />
  `,
})
export class TextInputComponent extends ControlBase<string> {
  public override readonly value: ModelSignal<string> = model<string>('');
  public readonly placeholder: InputSignal<string> = input<string>('');
  public readonly type: InputSignal<'text' | 'search' | 'time'> = input<'text' | 'search' | 'time'>(
    'text',
  );
  /** Só dígitos entram; qualquer outro caractere é recusado. */
  public readonly numeric: InputSignal<boolean> = input<boolean>(false);

  protected onInput(event: Event): void {
    const element = event.target as HTMLInputElement;
    const raw = element.value;
    const value = this.numeric() ? raw.replace(/[^0-9]/g, '') : raw;
    if (value !== raw) this.reject(element, raw, value);
    this.commit(value);
  }

  /**
   * Devolve ao campo só o que foi aceito. Sem isto o caractere recusado ficaria
   * na tela: o valor do signal não mudou, então o Angular não repinta o input.
   * O cursor volta para depois dos dígitos que já estavam antes dele, senão
   * saltaria para o fim a cada tecla recusada no meio do número.
   */
  private reject(element: HTMLInputElement, raw: string, value: string): void {
    const caret = element.selectionStart ?? raw.length;
    const kept = raw.slice(0, caret).replace(/[^0-9]/g, '').length;
    element.value = value;
    element.setSelectionRange(kept, kept);
  }
}
