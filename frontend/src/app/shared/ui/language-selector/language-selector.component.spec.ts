import { ComponentFixture, TestBed } from '@angular/core/testing';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { LanguageService } from '../../../core/services/language.service';
import { FakePreferencesStore, providePreferences } from '../../../../testing/preferences';
import { provideTestTranslate } from '../../../../testing/translate';
import { LanguageSelectorComponent } from './language-selector.component';

describe('LanguageSelectorComponent', () => {
  let fixture: ComponentFixture<LanguageSelectorComponent>;
  let languageService: LanguageService;

  const buttons = (): HTMLButtonElement[] =>
    Array.from(fixture.nativeElement.querySelectorAll('button')) as HTMLButtonElement[];

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [LanguageSelectorComponent],
      // Adaptação: catálogo real e preferências sem rede, como nos demais specs daqui.
      providers: [provideTestTranslate(), providePreferences(new FakePreferencesStore())],
    }).compileComponents();

    languageService = TestBed.inject(LanguageService);
    fixture = TestBed.createComponent(LanguageSelectorComponent);
    fixture.detectChanges();
  });

  it('tem um botão por idioma, com rótulo acessível traduzido e bandeira decorativa', () => {
    expect(buttons().map((b: HTMLButtonElement) => b.getAttribute('aria-label'))).toEqual([
      'Português',
      'Inglês',
    ]);
    for (const img of Array.from(fixture.nativeElement.querySelectorAll('img')) as HTMLElement[]) {
      expect(img.getAttribute('alt')).toBe('');
    }
  });

  it('marca só o botão do idioma atual como pressionado', () => {
    languageService.setLanguage('pt'); // Adaptação: currentLang é somente leitura aqui.
    fixture.detectChanges();
    expect(buttons().map((b: HTMLButtonElement) => b.getAttribute('aria-pressed'))).toEqual([
      'true',
      'false',
    ]);

    languageService.setLanguage('en'); // Adaptação: currentLang é somente leitura aqui.
    fixture.detectChanges();
    expect(buttons().map((b: HTMLButtonElement) => b.getAttribute('aria-pressed'))).toEqual([
      'false',
      'true',
    ]);
    expect(buttons()[1].classList.contains('ui-language-selector__button--active')).toBe(true);
    expect(buttons()[0].classList.contains('ui-language-selector__button--active')).toBe(false);
  });

  it('clicar em cada botão chama setLanguage com o código do idioma', () => {
    const spy = vi.spyOn(languageService, 'setLanguage').mockImplementation((): void => undefined);

    buttons()[1].click();
    expect(spy).toHaveBeenLastCalledWith('en');

    buttons()[0].click();
    expect(spy).toHaveBeenLastCalledWith('pt');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('usa as classes .ui-language-selector e .ui-language-selector__button', () => {
    expect(fixture.nativeElement.querySelector('.ui-language-selector')).toBeTruthy();
    for (const b of buttons()) {
      expect(b.classList.contains('ui-language-selector__button')).toBe(true);
    }
  });
});
