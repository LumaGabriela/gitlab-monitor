import {
  ChangeDetectionStrategy,
  Component,
  ElementRef,
  InputSignal,
  OutputEmitterRef,
  input,
  output,
  viewChild,
} from '@angular/core';
import { ButtonDirective } from '../button/button.directive';

/**
 * Seletor de arquivo: um botão do DS que abre o seletor nativo. O input real
 * fica fora da tela e fora da ordem de tabulação; o teclado e o leitor de
 * tela usam o botão. Limpa o input a cada escolha para aceitar o mesmo
 * arquivo duas vezes seguidas.
 */
@Component({
  selector: 'app-file-picker',
  imports: [ButtonDirective],
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { class: 'ui-file-picker' },
  template: `
    <button type="button" appButton variant="outline" [disabled]="disabled()" (click)="open()">
      {{ label() }}
    </button>
    <input
      #native
      class="ui-file-picker__input"
      type="file"
      tabindex="-1"
      aria-hidden="true"
      [accept]="accept()"
      [disabled]="disabled()"
      (change)="onChange()"
    />
  `,
})
export class FilePickerComponent {
  public readonly label: InputSignal<string> = input.required<string>();
  public readonly accept: InputSignal<string> = input<string>('');
  public readonly disabled: InputSignal<boolean> = input<boolean>(false);
  public readonly fileSelected: OutputEmitterRef<File> = output<File>();

  private readonly native = viewChild.required<ElementRef<HTMLInputElement>>('native');

  protected open(): void {
    this.native().nativeElement.click();
  }

  protected onChange(): void {
    const input = this.native().nativeElement;
    const file = input.files?.item(0);
    if (file) this.fileSelected.emit(file);
    input.value = '';
  }
}
