import { ChangeDetectionStrategy, Component, input, InputSignal } from '@angular/core';

/**
 * Cabeçalho de página: migalha (projetada em `[breadcrumb]`), eyebrow, título (h1) com contador ao lado,
 * subtítulo e ações (projetadas em `[actions]`). Empilha quando o espaço fica estreito.
 */
@Component({
  selector: 'app-page-header',
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <header class="ui-page-header">
      <div class="ui-page-header__breadcrumb"><ng-content select="[breadcrumb]" /></div>
      <div class="ui-page-header__row">
        <div class="ui-page-header__titles">
          @if (eyebrow()) {
            <p class="ui-page-header__eyebrow">{{ eyebrow() }}</p>
          }
          <div class="ui-page-header__title-row">
            <h1 class="ui-page-header__title">{{ title() }}</h1>
            @if (count() !== null) {
              <span class="ui-page-header__count">{{ count() }}</span>
            }
          </div>
          <div class="ui-page-header__meta"><ng-content select="[header-meta]" /></div>
          @if (subtitle()) {
            <p class="ui-page-header__subtitle">{{ subtitle() }}</p>
          }
        </div>
        <div class="ui-page-header__actions"><ng-content select="[actions]" /></div>
      </div>
    </header>
  `,
})
export class PageHeaderComponent {
  public readonly title: InputSignal<string> = input.required<string>();
  public readonly eyebrow: InputSignal<string | null> = input<string | null>(null);
  public readonly subtitle: InputSignal<string | null> = input<string | null>(null);
  public readonly count: InputSignal<string | null> = input<string | null>(null);
}
