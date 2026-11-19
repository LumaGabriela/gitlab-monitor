import {
  ChangeDetectionStrategy,
  Component,
  inject,
  input,
  InputSignal,
  Signal,
} from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { ThemeMode, ThemeService } from '../../../core/services/theme.service';
import { IconButtonDirective } from '../icon-button/icon-button.directive';
import { IconComponent } from '../icon/icon.component';

/** Alterna entre claro e escuro. O botão é o `appIconButton`; `square` usa o tamanho pequeno. */
@Component({
  selector: 'app-theme-toggle',
  imports: [IconButtonDirective, IconComponent, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <button
      type="button"
      appIconButton
      [size]="square() ? 'sm' : 'md'"
      [label]="
        (currentTheme() === 'dark' ? 'theme.switch-to-light' : 'theme.switch-to-dark') | translate
      "
      (click)="toggle()"
    >
      <app-icon [name]="currentTheme() === 'dark' ? 'sun' : 'moon'" />
    </button>
  `,
})
// Adaptação: chaves de tradução aninhadas (theme.*) no template.
export class ThemeToggleComponent {
  private readonly themeService: ThemeService = inject(ThemeService);

  public readonly square: InputSignal<boolean> = input<boolean>(false);

  public readonly currentTheme: Signal<ThemeMode> = this.themeService.currentTheme;

  public toggle(): void {
    this.themeService.toggleTheme();
  }
}
