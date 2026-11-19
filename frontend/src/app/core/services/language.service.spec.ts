import { TestBed } from '@angular/core/testing';
import { TranslateService } from '@ngx-translate/core';
import { LanguageService, initialLanguage } from './language.service';
import { FakePreferencesStore, providePreferences } from '../../../testing/preferences';
import { provideTestTranslate } from '../../../testing/translate';

describe('LanguageService', () => {
  const create = (store: FakePreferencesStore = new FakePreferencesStore()): LanguageService => {
    TestBed.resetTestingModule();
    TestBed.configureTestingModule({
      providers: [provideTestTranslate(), providePreferences(store)],
    });
    return TestBed.inject(LanguageService);
  };

  const html = document.documentElement;

  afterEach(() => html.removeAttribute('data-language'));

  describe('initialLanguage', () => {
    it('lê data-language do <html>', () => {
      html.setAttribute('data-language', 'en');
      expect(initialLanguage()).toBe('en');
    });

    it('sem o atributo, assume português', () => {
      expect(initialLanguage()).toBe('pt');
    });

    it('idioma sem catálogo cai em português', () => {
      html.setAttribute('data-language', 'fr');
      expect(initialLanguage()).toBe('pt');
    });
  });

  it('o padrão é português', () => {
    expect(create().currentLang()).toBe('pt');
    expect(initialLanguage()).toBe('pt');
  });

  it('escolher um idioma troca o catálogo em uso', () => {
    const service = create();
    service.setLanguage('en');

    expect(service.currentLang()).toBe('en');
    expect(TestBed.inject(TranslateService).currentLang).toBe('en');
  });

  it('grava a escolha no store', () => {
    const store = new FakePreferencesStore();
    create(store).setLanguage('en');

    expect(store.writes).toEqual([{ key: 'language', value: 'en' }]);
  });

  it('restore relê o store, que pode ter chegado depois da construção', () => {
    const store = new FakePreferencesStore();
    const service = create(store);
    store.data['language'] = 'en';
    service.restore();

    expect(service.currentLang()).toBe('en');
    expect(TestBed.inject(TranslateService).currentLang).toBe('en');
  });

  it.each([['fr'], [42], [null], ['{quebrado']])(
    'valor de tipo errado no store (%j) mantém o idioma da primeira pintura',
    (value) => {
      const service = create(new FakePreferencesStore({ language: value }));
      service.restore();

      expect(service.currentLang()).toBe('pt');
    },
  );

  it('idioma sem catálogo é ignorado, em vez de deixar a tela sem texto', () => {
    const service = create();
    service.setLanguage('tlh' as 'pt');

    expect(service.currentLang()).toBe('pt');
  });

  it('o idioma do <html> é restaurado na abertura', () => {
    html.setAttribute('data-language', 'en');
    const service = create();
    service.restore();

    expect(service.currentLang()).toBe('en');
    expect(TestBed.inject(TranslateService).currentLang).toBe('en');
  });
});
