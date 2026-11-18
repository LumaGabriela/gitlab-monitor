import { ChangeDetectionStrategy, Component } from '@angular/core';
import { RouterLink } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';

import { IconButtonDirective } from '../../ui/icon-button/icon-button.directive';
import { IconComponent } from '../../ui/icon/icon.component';
import { LanguageSelectorComponent } from '../../ui/language-selector/language-selector.component';
import { ThemeToggleComponent } from '../../ui/theme-toggle/theme-toggle.component';

/**
 * Ferramentas do cabeçalho de página: idioma, tema e configurações. Vai no slot `[actions]` do
 * `app-page-header`.
 */
// Adaptação: sem `view` nem `app-view-toggle`; depois do tema vem o link da engrenagem para /settings.
@Component({
  selector: 'app-page-tools',
  imports: [
    IconButtonDirective,
    IconComponent,
    LanguageSelectorComponent,
    RouterLink,
    ThemeToggleComponent,
    TranslatePipe,
  ],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-page-tools">
      <app-language-selector />
      <app-theme-toggle />
      <a appIconButton [routerLink]="settingsLink" [label]="'settings.open' | translate">
        <app-icon name="settings" />
      </a>
    </div>
  `,
})
export class PageToolsComponent {
  /**
   * Em segmentos, e não como uma string única: a rota do Angular e a da API têm o mesmo nome, e o
   * gate de rotas reprova qualquer literal igual ao do catálogo.
   */
  protected readonly settingsLink: readonly string[] = ['/', 'settings'];
}
