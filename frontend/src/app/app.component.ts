import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { TranslatePipe } from '@ngx-translate/core';
import { APP_NAV_SECTIONS } from './app-navigation';
import { PreferencesStore } from './core/services/preferences-store.service';
import { ShellComponent } from './shared/layout/shell/shell.component';
import { NavSection } from './shared/models/navigation.model';
import { AlertComponent } from './shared/ui/alert/alert.component';

/** Casca da aplicação: sidebar (ou gaveta) e `<main>`; o painel e as configurações entram pelo roteador. */
@Component({
  selector: 'app-root',
  imports: [RouterOutlet, AlertComponent, ShellComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  // O aviso fica sempre no DOM: uma região viva só anuncia o que muda dentro
  // dela, então criá-la junto com o texto não anunciaria nada. Sem falha, o
  // conteúdo é vazio e a caixa some do desenho, não da árvore de acessibilidade.
  template: `
    <app-shell
      [brandName]="brandName"
      [brandTagline]="'shell.brand-tagline' | translate"
      [sections]="sections"
    >
      <app-alert
        tone="warning"
        class="ui-preferences-alert"
        [class.ui-preferences-alert--quiet]="preferences.saveStatus() !== 'error'"
        >{{
          preferences.saveStatus() === 'error' ? ('preferences.save-failed' | translate) : ''
        }}</app-alert
      >
      <router-outlet />
    </app-shell>
  `,
})
export class AppComponent {
  protected readonly preferences: PreferencesStore = inject(PreferencesStore);
  protected readonly brandName: string = 'GitLab Monitor';
  protected readonly sections: readonly NavSection[] = APP_NAV_SECTIONS;
}
