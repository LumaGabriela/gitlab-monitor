import { Directive, ModelSignal, Signal, computed, inject, input, signal } from '@angular/core';
import { ControlValueAccessor } from '@angular/forms';
import { FIELD_CONTEXT, FieldContext } from './field-context';

/**
 * Base dos controles de formulário: a ligação com Reactive Forms e a leitura
 * do campo em volta, escritas uma vez só.
 *
 * `disabled` chega por dois caminhos que não se excluem — o input, quando
 * quem usa decide, e setDisabledState, que é como Reactive Forms desabilita.
 * `isDisabled` junta os dois; qualquer um basta.
 */
@Directive()
export abstract class ControlBase<T> implements ControlValueAccessor {
  public readonly disabled = input<boolean>(false);

  protected abstract readonly value: ModelSignal<T>;

  protected readonly field: FieldContext | null = inject(FIELD_CONTEXT, { optional: true });

  private readonly disabledByForm = signal<boolean>(false);
  public readonly isDisabled: Signal<boolean> = computed(
    (): boolean => this.disabled() || this.disabledByForm(),
  );

  private onChange: (value: T) => void = (): void => undefined;
  private onTouched: () => void = (): void => undefined;

  public writeValue(value: T): void {
    this.value.set(value);
  }

  public registerOnChange(fn: (value: T) => void): void {
    this.onChange = fn;
  }

  public registerOnTouched(fn: () => void): void {
    this.onTouched = fn;
  }

  public setDisabledState(isDisabled: boolean): void {
    this.disabledByForm.set(isDisabled);
  }

  /** Único ponto de escrita: mantém o model e o Reactive Forms em acordo. */
  protected commit(value: T): void {
    this.value.set(value);
    this.onChange(value);
  }

  protected markTouched(): void {
    this.onTouched();
  }
}
