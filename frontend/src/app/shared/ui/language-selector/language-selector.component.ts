import { ChangeDetectionStrategy, Component, inject, Signal } from '@angular/core';
import { TranslatePipe } from '@ngx-translate/core';

import { LanguageService, SupportedLanguage } from '../../../core/services/language.service';
import { IconButtonDirective } from '../icon-button/icon-button.directive';

interface LanguageOption {
  // Adaptação: SupportedLanguage ('pt' | 'en') do LanguageService daqui, no lugar de SupportedLocale.
  readonly locale: SupportedLanguage;
  readonly labelKey: string;
  readonly flag: string;
}

/** Troca o idioma da aplicação. A bandeira é decorativa; o nome acessível é o rótulo traduzido. */
@Component({
  selector: 'app-language-selector',
  imports: [IconButtonDirective, TranslatePipe],
  changeDetection: ChangeDetectionStrategy.OnPush,
  template: `
    <div class="ui-language-selector">
      @for (option of options; track option.locale) {
        <button
          type="button"
          appIconButton
          size="sm"
          class="ui-language-selector__button"
          [class.ui-language-selector__button--active]="currentLang() === option.locale"
          [attr.aria-pressed]="currentLang() === option.locale"
          [label]="option.labelKey | translate"
          (click)="setLang(option.locale)"
        >
          <!-- eslint-disable-next-line @angular-eslint/template/prefer-ngsrc --
               NgOptimizedImage exige width/height fixos em px, e o tamanho da
               bandeira sai de --spacing-4, que a densidade reescala (§5). São
               dois PNG locais de poucos bytes: não há o que otimizar. -->
          <img [src]="option.flag" alt="" class="ui-language-selector__flag" />
        </button>
      }
    </div>
  `,
})
export class LanguageSelectorComponent {
  private readonly languageService: LanguageService = inject(LanguageService);

  // Adaptação: chaves de tradução aninhadas (language.*).
  protected readonly options: readonly LanguageOption[] = [
    { locale: 'pt', labelKey: 'language.pt', flag: '/assets/images/brazil.png' },
    { locale: 'en', labelKey: 'language.en', flag: '/assets/images/usa.png' },
  ];

  public readonly currentLang: Signal<SupportedLanguage> = this.languageService.currentLang;

  public setLang(locale: SupportedLanguage): void {
    this.languageService.setLanguage(locale);
  }
}
