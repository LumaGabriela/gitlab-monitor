import { ChangeDetectionStrategy, Component, InputSignal, input } from '@angular/core';

export type CardVariant = 'flat' | 'raised';
export type CardPadding = 'none' | 'sm' | 'md';

/**
 * Painel do DS: cabeçalho opcional com título, contador e ações
 * (`[card-actions]`), corpo e rodapé (`[card-footer]`). O nível do título é
 * escolhido por quem usa, porque quem decide a hierarquia da página é a
 * página, não o card.
 */
@Component({
  selector: 'app-card',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    class: 'ui-card',
    '[class.ui-card--raised]': "variant() === 'raised'",
    '[class.ui-card--dashed]': 'dashed()',
    '[class.ui-card--pad-sm]': "padding() === 'sm'",
    '[class.ui-card--pad-none]': "padding() === 'none'",
  },
  template: `
    @if (title(); as heading) {
      <header class="ui-card__header">
        <div class="ui-card__titles">
          @if (headingLevel() === 3) {
            <h3 class="ui-card__title">{{ heading }}</h3>
          } @else {
            <h2 class="ui-card__title">{{ heading }}</h2>
          }
          @if (count(); as total) {
            <span class="ui-card__count">{{ total }}</span>
          }
        </div>
        <div class="ui-card__actions"><ng-content select="[card-actions]" /></div>
      </header>
    }
    <div class="ui-card__body"><ng-content /></div>
    <div class="ui-card__footer"><ng-content select="[card-footer]" /></div>
  `,
})
export class CardComponent {
  public readonly title: InputSignal<string | null> = input<string | null>(null);
  public readonly count: InputSignal<string | null> = input<string | null>(null);
  public readonly headingLevel: InputSignal<2 | 3> = input<2 | 3>(2);
  public readonly variant: InputSignal<CardVariant> = input<CardVariant>('flat');
  public readonly dashed: InputSignal<boolean> = input<boolean>(false);
  public readonly padding: InputSignal<CardPadding> = input<CardPadding>('md');
}
