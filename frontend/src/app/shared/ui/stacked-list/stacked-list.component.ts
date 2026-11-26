import { ChangeDetectionStrategy, Component, InputSignal, input } from '@angular/core';

/**
 * Como a lista pesa na célula. `detail` é o apoio abaixo de um valor (quem
 * deu like, quem abriu thread): menor e em tom secundário. `value` é quando a
 * lista É o valor da célula (as pessoas em revisão), e aí ela lê como
 * qualquer outro texto da tabela.
 */
export type StackedListVariant = 'detail' | 'value';

/**
 * Lista curta empilhada dentro de uma célula (quem deu like, quem abriu
 * thread). Um item por linha e sem quebra dentro do item: a célula usa
 * overflow-wrap: anywhere, que partiria "fulano.fulano" no meio do nome.
 */
@Component({
  selector: 'app-stacked-list',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    @if (items().length) {
      <ul class="ui-stacked-list" [class.ui-stacked-list--value]="variant() === 'value'">
        @for (item of items(); track item; let last = $last) {
          <li class="ui-stacked-list__item">{{ item }}{{ last ? '' : separator() }}</li>
        }
      </ul>
    }
  `,
})
export class StackedListComponent {
  public readonly items: InputSignal<readonly string[]> = input<readonly string[]>([]);
  public readonly separator: InputSignal<string> = input<string>(',');
  public readonly variant: InputSignal<StackedListVariant> = input<StackedListVariant>('detail');
}
